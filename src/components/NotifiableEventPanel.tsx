import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { setNotifiableFlag } from '../lib/supabase';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { useToast } from '../hooks/useToast';
import Card from './Card';
import Button from './Button';
import Icon from './Icon';

interface Props {
  issueId: string;
  isNotifiable: boolean;
  notifiableMarkedAt: string | null;
  /** Supervisor/admin gate — same as InvestigationPanel's canManageInvestigation. */
  canEdit: boolean;
  onChanged: () => void;
}

// Condensed from WorkSafe's notifiable-injury/illness guidance — not
// exhaustive, not legal advice. A "notifiable incident" (the broader,
// separate category — a near-miss serious enough someone could have been
// killed or badly hurt) isn't itemised here; the Unsure path exists for
// exactly that kind of judgement call.
const NOTIFIABLE_CRITERIA = [
  'Injury or illness needing hospital admission as an inpatient',
  'Amputation, or a serious head, eye, or spinal injury',
  'A serious burn needing intensive or critical care',
  'Loss of a bodily function (consciousness, speech, a limb, an organ, a sense)',
  'A serious laceration involving muscle, tendon, nerve, or blood vessel damage',
  'A serious work-related infection',
  'Any near-miss serious enough that someone could have been killed or badly hurt',
];

type Decision = 'yes' | 'no' | null;

export default function NotifiableEventPanel({ issueId, isNotifiable, notifiableMarkedAt, canEdit, onChanged }: Props) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState<Decision>(null);
  const [showUnsureNote, setShowUnsureNote] = useState(false);

  const decided = isNotifiable || notifiableMarkedAt !== null;

  async function handleDecision(value: boolean) {
    setBusy(value ? 'yes' : 'no');
    const { error } = await setNotifiableFlag(issueId, value);
    setBusy(null);
    if (error) showToast(error.message ?? 'Could not save this decision');
    else onChanged();
  }

  return (
    <Card variant="elevated" style={styles.card}>
      <Text style={styles.panelLabel}>NOTIFIABLE EVENT</Text>

      {isNotifiable ? (
        <View style={styles.decidedBlock}>
          <View style={styles.decidedRow}>
            <Icon name="warning" size="md" color={Colors.serious} />
            <Text style={styles.decidedTitle}>Flagged as notifiable</Text>
          </View>
          {notifiableMarkedAt && (
            <Text style={styles.decidedMeta}>
              Marked {new Date(notifiableMarkedAt).toLocaleString()}
            </Text>
          )}
          <View style={styles.preserveBox}>
            <Text style={styles.preserveText}>
              Preserve the site until a WorkSafe inspector permits work to resume, and notify
              WorkSafe as soon as possible (0800 030 040) if you haven't already. Use the
              checklist below to record when the site was preserved.
            </Text>
          </View>
          {canEdit && (
            <Button
              label="This isn't notifiable after all"
              variant="ghost"
              onPress={() => handleDecision(false)}
              loading={busy === 'no'}
              fullWidth
            />
          )}
        </View>
      ) : notifiableMarkedAt !== null ? (
        <View style={styles.decidedBlock}>
          <Text style={styles.decidedMeta}>
            Reviewed {new Date(notifiableMarkedAt).toLocaleString()} — not notifiable.
          </Text>
          {canEdit && (
            <Button
              label="Actually, this is notifiable"
              variant="seriousOutline"
              onPress={() => handleDecision(true)}
              loading={busy === 'yes'}
              fullWidth
            />
          )}
        </View>
      ) : (
        <View style={styles.decisionBlock}>
          <Text style={styles.intro}>
            Does this meet WorkSafe's threshold for a notifiable event? A death, a notifiable
            injury or illness, or a notifiable incident must be reported to WorkSafe as soon as
            possible.
          </Text>
          {NOTIFIABLE_CRITERIA.map((c) => (
            <View key={c} style={styles.criterionRow}>
              <Icon name="ellipse" size="sm" color={Colors.textMuted} />
              <Text style={styles.criterionText}>{c}</Text>
            </View>
          ))}
          <Text style={styles.disclaimer}>
            General guidance only, not legal advice — if in doubt, treat it as notifiable and
            confirm with WorkSafe or your own adviser.
          </Text>

          {canEdit ? (
            <>
              <View style={styles.decisionRow}>
                <Button
                  label="Yes — notifiable"
                  variant="serious"
                  onPress={() => handleDecision(true)}
                  loading={busy === 'yes'}
                  style={styles.decisionButton}
                />
                <Button
                  label="No"
                  variant="outline"
                  onPress={() => handleDecision(false)}
                  loading={busy === 'no'}
                  style={styles.decisionButton}
                />
              </View>
              <Button
                label="Unsure — flag for follow-up"
                variant="ghost"
                onPress={() => setShowUnsureNote(true)}
                fullWidth
              />
              {showUnsureNote && (
                <Text style={styles.unsureNote}>
                  Left undecided for now. Preserve the site and check back with a supervisor or
                  admin as soon as possible — this shouldn't sit unresolved for long.
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.decidedMeta}>Waiting on a supervisor or admin to review this.</Text>
          )}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm, marginTop: Spacing.sm },
  panelLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.8,
  },

  intro: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  criterionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    paddingVertical: 2,
  },
  criterionText: {
    flex: 1,
    fontSize: Typography.sm,
    color: Colors.textPrimary,
    lineHeight: 19,
  },

  disclaimer: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    fontStyle: 'italic',
    marginTop: Spacing.xs,
  },

  decisionBlock: { gap: Spacing.sm },
  decisionRow: { flexDirection: 'row', gap: Spacing.sm },
  decisionButton: { flex: 1 },
  unsureNote: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    lineHeight: 19,
  },

  decidedBlock: { gap: Spacing.sm },
  decidedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  decidedTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.serious,
  },
  decidedMeta: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  preserveBox: {
    backgroundColor: Colors.seriousBg,
    borderRadius: Radius.button,
    padding: Spacing.sm,
  },
  preserveText: {
    fontSize: Typography.sm,
    color: Colors.serious,
    lineHeight: 19,
  },
});
