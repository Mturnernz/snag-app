import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Card from './Card';
import Icon from './Icon';
import { openUrl } from '../lib/openUrl';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { ADVICE_VERDICT_LABELS, type SnagAdvice } from '../types';

interface Props {
  advice: SnagAdvice;
  /** The snag's shopping list, so an accepted part reads as accepted. */
  parts: string[];
  busy?: boolean;
  onAccept: (item: string) => void;
  onRemove: () => void;
}

const VERDICT_ICONS: Record<SnagAdvice['verdict'], 'construct-outline' | 'call-outline' | 'help-circle-outline'> = {
  diy: 'construct-outline',
  trade: 'call-outline',
  unclear: 'help-circle-outline',
};

/**
 * What came back about this job.
 *
 * **It reads as a claim, because nothing in this app can check it.** The source
 * line says where it came from and when, in words, for the same reason the
 * invitation card says Snag doesn't email anybody: the failure that matters is
 * never the row, it is a screen asserting something it cannot verify. So there
 * is no tick, no confidence score and no colour — this is somebody's reading of
 * a photograph, and the page says so and then gets out of the way.
 *
 * **A suggested part is an offer, not a line on the shopping list.** Each one
 * has a + that puts it there, one tap at a time, and the tap is what matters:
 * filling the parts list is the act that moves a snag to 'doing', so a reply
 * that wrote twelve shopping lists would mark a whole house as being worked on
 * while nobody had touched anything. Already-accepted items go quiet rather
 * than disappearing, so the advice still reads as the advice it gave.
 *
 * **The tradesmen are collapsed until asked for.** A snag with three phone
 * numbers open on it buries the note the other person left, and the note is
 * usually why the screen was opened. Each carries the page it was found on,
 * because that is the only part of a name and a number this end can check.
 *
 * No hue anywhere: the palette's four are spent on state, and an assessment is
 * not a state.
 */
export default function AdviceCard({ advice, parts, busy = false, onAccept, onRemove }: Props) {
  const [showTradies, setShowTradies] = useState(false);
  const accepted = new Set(parts.map((part) => part.toLowerCase()));

  const open = openUrl;

  return (
    <Card elevation="md" style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.title}>What this looks like</Text>
        <Text style={styles.source}>{advice.source}</Text>
      </View>

      {advice.diagnosis ? <Text style={styles.body}>{advice.diagnosis}</Text> : null}

      <View style={styles.verdictRow}>
        <Icon name={VERDICT_ICONS[advice.verdict]} size="sm" color={Colors.textSecondary} />
        <Text style={styles.verdict}>
          {ADVICE_VERDICT_LABELS[advice.verdict]}
          {advice.trade ? ` — ${advice.trade}` : ''}
        </Text>
      </View>
      {advice.reason ? <Text style={styles.reason}>{advice.reason}</Text> : null}
      {advice.needToSee ? (
        <Text style={styles.reason}>What would help: {advice.needToSee}</Text>
      ) : null}

      {advice.steps.length > 0 ? (
        <View style={styles.steps}>
          {advice.steps.map((step, index) => (
            <View key={`${index}-${step}`} style={styles.stepRow}>
              <Text style={styles.stepNumber}>{index + 1}</Text>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {advice.parts.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.fieldLabel}>Suggested</Text>
          {advice.parts.map((part, index) => {
            const on = accepted.has(part.item.toLowerCase());
            return (
              <View key={`${index}-${part.item}`} style={styles.partRow}>
                <View style={styles.partText}>
                  <Text style={[styles.partItem, on && styles.partItemOn]}>{part.item}</Text>
                  {part.where || part.approxNzd ? (
                    <Text style={styles.partMeta}>
                      {[part.where, part.approxNzd ? `about $${part.approxNzd}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  ) : null}
                </View>
                {on ? (
                  <View style={styles.partOn}>
                    <Icon name="checkmark" size="sm" color={Colors.textMuted} />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => onAccept(part.item)}
                    disabled={busy}
                    style={styles.partAdd}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${part.item} to the shopping list`}
                  >
                    <Icon name="add" size="md" color={Colors.white} />
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      ) : null}

      {advice.tradies.length > 0 ? (
        <View style={styles.block}>
          <Pressable
            onPress={() => setShowTradies((shown) => !shown)}
            style={styles.disclose}
            accessibilityRole="button"
            accessibilityLabel={
              showTradies
                ? 'Hide who to ring'
                : `Show ${advice.tradies.length} to ring`
            }
          >
            <Icon
              name={showTradies ? 'chevron-down' : 'chevron-forward'}
              size="sm"
              color={Colors.textSecondary}
            />
            <Text style={styles.discloseLabel}>
              {advice.tradies.length} to ring
            </Text>
          </Pressable>

          {showTradies ? (
            <>
              {advice.tradies.map((tradie, index) => (
                <View key={`${index}-${tradie.name}`} style={styles.tradie}>
                  <Text style={styles.tradieName}>{tradie.name}</Text>
                  {tradie.calloutNzd || tradie.totalNzd ? (
                    <Text style={styles.tradieMeta}>
                      {[
                        tradie.calloutNzd ? `$${tradie.calloutNzd} to come out` : null,
                        tradie.totalNzd ? `$${tradie.totalNzd} all up` : null,
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  <View style={styles.tradieActions}>
                    {tradie.phone ? (
                      <Pressable
                        onPress={() => open(`tel:${tradie.phone!.replace(/\s/g, '')}`)}
                        style={styles.tradieAction}
                        accessibilityRole="button"
                        accessibilityLabel={`Ring ${tradie.name}`}
                      >
                        <Icon name="call-outline" size="sm" color={Colors.primary} />
                        <Text style={styles.tradiePhone}>{tradie.phone}</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => open(tradie.url ?? tradie.source)}
                      style={styles.tradieAction}
                      accessibilityRole="button"
                      accessibilityLabel={`Where ${tradie.name} came from`}
                    >
                      <Icon name="open-outline" size="sm" color={Colors.textMuted} />
                      <Text style={styles.tradieSource}>Where this came from</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
              {/* Said once, under the list, rather than on every row. Nobody
                  here has rung these people. */}
              <Text style={styles.caveat}>
                Nobody at this end has checked these. Prices are indicative and the register is
                worth a look before you book.
              </Text>
            </>
          ) : null}
        </View>
      ) : null}

      <Pressable
        onPress={onRemove}
        disabled={busy}
        style={styles.remove}
        accessibilityRole="button"
        accessibilityLabel="Remove this assessment"
      >
        <Text style={styles.removeLabel}>Remove this assessment</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  source: { fontSize: Typography.xs, color: Colors.textMuted },
  body: { fontSize: Typography.sm, color: Colors.textPrimary, lineHeight: 20 },
  verdictRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  verdict: { flex: 1, fontSize: Typography.sm, color: Colors.textSecondary },
  reason: { fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 19 },
  steps: { gap: Spacing.xs, marginTop: Spacing.xs },
  stepRow: { flexDirection: 'row', gap: Spacing.sm },
  stepNumber: {
    width: 16,
    fontSize: Typography.xs,
    color: Colors.textMuted,
    fontFamily: Fonts.mono,
    lineHeight: 19,
  },
  stepText: { flex: 1, fontSize: Typography.sm, color: Colors.textPrimary, lineHeight: 19 },
  block: { gap: Spacing.xs, marginTop: Spacing.xs },
  fieldLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  partRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  partText: { flex: 1, minWidth: 0 },
  partItem: { fontSize: Typography.sm, color: Colors.textPrimary },
  partItemOn: { color: Colors.textMuted },
  partMeta: { fontSize: Typography.xs, color: Colors.textMuted },
  partAdd: {
    width: 36,
    height: 36,
    borderRadius: Radius.button,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partOn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  disclose: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  discloseLabel: { fontSize: Typography.sm, color: Colors.textSecondary },
  tradie: {
    gap: 2,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  tradieName: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  tradieMeta: { fontSize: Typography.xs, color: Colors.textMuted },
  tradieActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, marginTop: 2 },
  tradieAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  tradiePhone: { fontSize: Typography.sm, color: Colors.primary, fontFamily: Fonts.mono },
  tradieSource: { fontSize: Typography.xs, color: Colors.textMuted },
  caveat: { fontSize: Typography.xs, color: Colors.textMuted, lineHeight: 17 },
  remove: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  removeLabel: { fontSize: Typography.xs, color: Colors.textMuted },
});
