import React, { useState } from 'react';
import { View, Text, TextInput, Modal, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';

import {
  describeReasonShortfall, describeUnmetConditions, RESOLUTION_EXCEPTION_MIN_LENGTH,
  type ResolveGateKey,
} from '@snag/supabase-queries';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { recordResolutionException } from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import Card from './Card';
import Button from './Button';
import Icon from './Icon';

interface Props {
  issueId: string;
  /** What was outstanding when it was closed — the snapshot on the snag, not a
   *  recomputation. What has happened since doesn't change what was decided. */
  unmetAtResolution?: string[] | null;
  reason?: string | null;
  byName?: string | null;
  at?: string | null;
  /** Unmet *now*, used only when no reason is on record: the ask is "explain
   *  this", so it has to describe the snag as it currently stands. */
  unmetNow: ResolveGateKey[];
  /** Supervisor or admin of this site — require_serious_snag refuses anyone
   *  else, so nobody else is offered the field. */
  canRecord: boolean;
  onRecorded: () => void;
}

/**
 * A serious snag that closed with its investigation unfinished, and why.
 *
 * Two states, and the second is the one that matters. With a reason on record
 * this is a receipt: who decided, when, and what was outstanding. Without one —
 * every snag resolved before update_snag_status had a gate, plus the ones the
 * niggle resolve path used to close by cascade — it's an open question put to
 * whoever can answer it, because the alternative is a snag that sits in the
 * dashboard's outstanding list forever with nothing on it saying why.
 */
export default function ResolutionExceptionCard({
  issueId, unmetAtResolution, reason, byName, at, unmetNow, canRecord, onRecorded,
}: Props) {
  const { showToast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const recorded = Boolean(reason);
  const outstanding = recorded
    ? describeUnmetConditions(unmetAtResolution)
    : describeUnmetConditions(unmetNow);
  /** Non-null while the reason is too short — shown under the field, and the
   *  reason Record is disabled, so the length is never a surprise. */
  const shortfall = describeReasonShortfall(text);

  async function handleRecord() {
    const trimmed = text.trim();
    // A backstop now that the button is disabled while `shortfall` is set: it
    // should be unreachable, and it still has to name the length if it isn't.
    if (trimmed.length < RESOLUTION_EXCEPTION_MIN_LENGTH) {
      showToast(`Say a bit more — at least ${RESOLUTION_EXCEPTION_MIN_LENGTH} characters`);
      return;
    }
    setSaving(true);
    const { error } = await recordResolutionException(issueId, trimmed);
    setSaving(false);
    if (error) {
      showToast(error.message ?? 'Could not record the reason');
      return;
    }
    setModalOpen(false);
    setText('');
    showToast('Reason recorded');
    onRecorded();
  }

  return (
    <Card variant="elevated" style={styles.card}>
      <View style={styles.header}>
        <Icon name="alert-circle" size="md" color={Colors.serious} />
        <Text style={styles.title}>Closed with the investigation incomplete</Text>
      </View>

      {outstanding && (
        <Text style={styles.outstanding}>
          {recorded ? 'Outstanding when it was closed' : 'Still outstanding'}: {outstanding}.
        </Text>
      )}

      {recorded ? (
        <>
          <Text style={styles.reason}>{reason}</Text>
          <Text style={styles.meta}>
            {byName ?? 'A supervisor'}
            {at ? ` · ${new Date(at).toLocaleDateString()}` : ''}
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.missing}>
            No reason was recorded. This snag was closed before the app asked for one.
          </Text>
          {canRecord && (
            <Button
              label="Record why"
              variant="seriousOutline"
              icon="create-outline"
              onPress={() => { setText(''); setModalOpen(true); }}
              fullWidth
            />
          )}
        </>
      )}

      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Why was this closed?</Text>
            <Text style={styles.modalHint}>
              {outstanding
                ? `This was resolved without ${outstanding}. Say why — it stays on the snag with your name against it.`
                : 'Say why this was resolved early. It stays on the snag with your name against it.'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Why was this closed here?"
              placeholderTextColor={Colors.textMuted}
              value={text}
              onChangeText={setText}
              multiline
              textAlignVertical="top"
            />
            <Text style={styles.shortfall}>{shortfall ?? ' '}</Text>
            <View style={styles.modalButtons}>
              <Button label="Cancel" variant="outline" onPress={() => setModalOpen(false)} style={styles.modalButton} />
              <Button
                label="Record"
                variant="serious"
                onPress={handleRecord}
                loading={saving}
                disabled={shortfall !== null}
                style={styles.modalButton}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm, backgroundColor: Colors.seriousBg },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { flex: 1, fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.serious },
  outstanding: { fontSize: Typography.sm, color: Colors.serious, lineHeight: 19 },
  reason: { fontSize: Typography.base, color: Colors.textPrimary, lineHeight: 21 },
  meta: { fontSize: Typography.xs, color: Colors.textMuted },
  missing: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  modalCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  modalTitle: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  modalHint: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },
  input: {
    minHeight: 88,
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  // Rendered with a space when there's no shortfall rather than unmounted, so
  // the buttons don't shift up under the thumb as the tenth character lands.
  shortfall: { fontSize: Typography.xs, color: Colors.textMuted, minHeight: 16 },
  modalButtons: { flexDirection: 'row', gap: Spacing.sm },
  modalButton: { flex: 1 },
});
