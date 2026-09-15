import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Icon from '../components/Icon';
import { Colors, Fonts, Radius, Spacing, Typography } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { getSnags, recordSnagAdvice } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import {
  ACTIONS_FENCE, adviceSource, matchAdviceToSnags, parseSnagActions, snagHeadline,
  type ParsedAdvice,
} from '@snag/supabase-queries';
import { ADVICE_VERDICT_LABELS, Snag } from '../types';

/**
 * The other half of a briefed extract: what came back, read into the list.
 *
 * **Nothing is written until somebody has seen what it would change.** A paste
 * is a blob of somebody else's text that names a dozen jobs, and one tap
 * applying all of it unseen is how a household's list gets quietly rewritten by
 * a reply nobody read to the end. So the screen is two moments: read it, then
 * file it.
 *
 * Three rules, and each is a way this fails quietly otherwise.
 *
 * - **An unknown reference is named, never guessed at.** The snags read here are
 *   the ones this person can see at this place, so a reference that isn't among
 *   them is a job from somewhere else, a job since deleted, or an invention.
 *   All three get the same answer — not written, and said out loud — because
 *   silently filing eleven of twelve is the version nobody notices.
 * - **Filing advice does not touch the snags.** `record_snag_advice` writes its
 *   own row and nothing else; the parts it suggests reach the shopping list one
 *   tap at a time, from the snag's own page. Applying them here would mark every
 *   job in the house as being worked on the moment somebody pasted.
 * - **A failure says how far it got.** Twelve rows is twelve writes, and "some
 *   of that didn't save" with no count is worse than the error itself.
 */
export default function PasteAdviceScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const { activeProperty } = useHousehold();
  const { showToast } = useToast();

  const [reply, setReply] = useState('');
  const [snags, setSnags] = useState<Snag[]>([]);
  const [loading, setLoading] = useState(true);
  const [read, setRead] = useState<{ entries: ParsedAdvice[]; error: string | null } | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Every snag at this place, done ones included: an answer can perfectly well
  // mention a job somebody finished while the PDF was open, and naming it as
  // unknown would be wrong.
  // Keyed on the id rather than the object: a property whose identity changes
  // on every context render would re-read the list forever.
  const propertyId = activeProperty?.id ?? null;

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      setSnags(await getSnags({ propertyId }));
    } catch (err: any) {
      showAlert("Couldn't load the list", err?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const { matched, unknown } = useMemo(
    () => matchAdviceToSnags(read?.entries ?? [], snags),
    [read, snags],
  );

  const chosen = matched.filter(({ advice }) => !skip.has(advice.reference));

  function handleRead() {
    const next = parseSnagActions(reply);
    setRead(next);
    setSkip(new Set());
  }

  async function handleFile() {
    if (chosen.length === 0) return;
    setBusy(true);
    const source = adviceSource();
    let filed = 0;
    try {
      for (const { snag, advice } of chosen) {
        const { reference, ...rest } = advice;
        await recordSnagAdvice(snag.id, rest, source);
        filed += 1;
      }
      showToast(`${filed} ${filed === 1 ? 'job' : 'jobs'} updated`);
      navigation.goBack();
    } catch (err: any) {
      // How far it got, always. The alternative leaves somebody re-pasting the
      // lot with no idea which half is already filed.
      showAlert(
        filed === 0 ? "Nothing was saved" : `Saved ${filed} of ${chosen.length}`,
        err?.message ?? 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const toggle = (reference: string) => setSkip((current) => {
    const next = new Set(current);
    if (next.has(reference)) next.delete(reference);
    else next.add(reference);
    return next;
  });

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Paste the reply" subtitle={activeProperty?.name} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Card elevation="md" style={styles.section}>
          <Text style={styles.body}>
            Paste the whole reply to a briefed PDF, including the block at the end. Nothing is
            saved until you have seen what it would change.
          </Text>
          <TextInput
            style={styles.input}
            value={reply}
            onChangeText={setReply}
            placeholder={'It looks like the flush valve seal…\n\n```' + ACTIONS_FENCE + '\n{ … }\n```'}
            placeholderTextColor={Colors.textMuted}
            multiline
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="The reply"
          />
          <Button
            label="Read it"
            onPress={handleRead}
            disabled={!reply.trim() || loading}
            fullWidth
          />
        </Card>

        {loading ? <ActivityIndicator color={Colors.primary} /> : null}

        {read?.error ? (
          <View style={styles.note}>
            <Icon name="alert-circle-outline" size="sm" color={Colors.textMuted} />
            <Text style={styles.noteText}>{read.error}</Text>
          </View>
        ) : null}

        {read && !read.error ? (
          <Card elevation="md" style={styles.section}>
            <Text style={styles.sectionTitle}>
              {matched.length} {matched.length === 1 ? 'job' : 'jobs'} answered
            </Text>

            {matched.map(({ snag, advice }) => {
              const off = skip.has(advice.reference);
              return (
                <Pressable
                  key={advice.reference}
                  onPress={() => toggle(advice.reference)}
                  style={styles.row}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !off }}
                  accessibilityLabel={`${advice.reference}, ${snagHeadline(snag)}`}
                >
                  <Icon
                    name={off ? 'square-outline' : 'checkbox-outline'}
                    size="md"
                    color={off ? Colors.textMuted : Colors.primary}
                  />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowTitle, off && styles.rowOff]} numberOfLines={1}>
                      {snagHeadline(snag)}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {advice.reference} · {ADVICE_VERDICT_LABELS[advice.verdict]}
                      {advice.parts.length > 0
                        ? ` · ${advice.parts.length} to pick up`
                        : ''}
                      {advice.tradies.length > 0
                        ? ` · ${advice.tradies.length} to ring`
                        : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}

            {/* Named rather than dropped in silence: a reference nobody here
                recognises is the one thing about a paste worth querying. */}
            {unknown.length > 0 ? (
              <View style={styles.note}>
                <Icon name="help-circle-outline" size="sm" color={Colors.textMuted} />
                <Text style={styles.noteText}>
                  {unknown.length === 1
                    ? `${unknown[0]} isn't on this list, so it was left out.`
                    : `${unknown.length} references aren't on this list, so they were left out: `
                      + `${unknown.join(', ')}.`}
                </Text>
              </View>
            ) : null}

            <Text style={styles.hint}>
              Suggested parts stay suggestions — you add them to the shopping list from the job
              itself.
            </Text>
          </Card>
        ) : null}
      </ScrollView>

      {read && !read.error && matched.length > 0 ? (
        <View
          style={[
            styles.footer,
            keyboard > 0
              ? { marginBottom: keyboard }
              : { paddingBottom: insets.bottom + Spacing.md },
          ]}
        >
          <Button
            label={chosen.length === 1 ? 'Update 1 job' : `Update ${chosen.length} jobs`}
            onPress={handleFile}
            loading={busy}
            disabled={busy || chosen.length === 0}
            fullWidth
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.md },
  section: { gap: Spacing.sm },
  sectionTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  body: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 20 },
  input: {
    minHeight: 180,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
    padding: Spacing.md,
    fontSize: Typography.sm,
    fontFamily: Fonts.mono,
    color: Colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: Typography.sm, color: Colors.textPrimary },
  rowOff: { color: Colors.textMuted, textDecorationLine: 'line-through' },
  rowMeta: { fontSize: Typography.xs, color: Colors.textMuted },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.button,
    padding: Spacing.md,
  },
  noteText: { flex: 1, fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },
  hint: { fontSize: Typography.xs, color: Colors.textMuted, lineHeight: 17 },
  footer: {
    padding: Spacing.lg,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
});
