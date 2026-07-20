import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';

import { setNotifiableFlag, nominateNotifyingPcbu, getMemberships, Membership } from '../lib/supabase';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { useToast } from '../hooks/useToast';
import Button from './Button';
import Icon from './Icon';

interface Props {
  issueId: string;
  isNotifiable: boolean;
  notifiableMarkedAt: string | null;
  /** Multi-PCBU notification nomination — who's taken on telling WorkSafe,
   *  when more than one PCBU is involved (e.g. a contractor on this site). */
  notifyingOrgId: string | null;
  notifyingOrgName?: string | null;
  notifyingPcbuNote: string | null;
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

export default function NotifiableEventPanel({
  issueId, isNotifiable, notifiableMarkedAt,
  notifyingOrgId, notifyingOrgName, notifyingPcbuNote, canEdit, onChanged,
}: Props) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState<Decision>(null);
  const [showUnsureNote, setShowUnsureNote] = useState(false);

  // Other organisations the current user personally belongs to — a
  // realistic quick-pick when the same person works across the customer's
  // org and a contractor's, since site_members has no per-row org context
  // to derive this automatically. A free-text fallback covers everyone else.
  const [otherOrgs, setOtherOrgs] = useState<Membership[]>([]);
  const [showNominateForm, setShowNominateForm] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [pcbuNote, setPcbuNote] = useState('');
  const [nominating, setNominating] = useState(false);

  const decided = isNotifiable || notifiableMarkedAt !== null;
  const hasNomination = Boolean(notifyingOrgId || notifyingPcbuNote);

  useEffect(() => {
    if (isNotifiable && canEdit) {
      getMemberships().then((all) => setOtherOrgs(all.filter((m) => !m.is_active)));
    }
  }, [isNotifiable, canEdit]);

  async function handleDecision(value: boolean) {
    setBusy(value ? 'yes' : 'no');
    const { error } = await setNotifiableFlag(issueId, value);
    setBusy(null);
    if (error) showToast(error.message ?? 'Could not save this decision');
    else onChanged();
  }

  async function handleNominate() {
    if (!selectedOrgId && !pcbuNote.trim()) {
      showToast('Pick an organisation or enter a name');
      return;
    }
    setNominating(true);
    const { error } = await nominateNotifyingPcbu(issueId, selectedOrgId, selectedOrgId ? null : pcbuNote.trim());
    setNominating(false);
    if (error) {
      showToast(error.message ?? 'Could not save the notifying PCBU');
    } else {
      setShowNominateForm(false);
      setSelectedOrgId(null);
      setPcbuNote('');
      onChanged();
    }
  }

  return (
    <>
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

          {/* Multi-PCBU notification nomination — only one notification is
              needed per event even with multiple PCBUs involved, but all
              remain responsible for making sure it happens. */}
          <View style={styles.divider} />
          {hasNomination ? (
            <View style={styles.nominationBlock}>
              <Text style={styles.nominationLabel}>Notifying PCBU</Text>
              <Text style={styles.decidedMeta}>{notifyingOrgName || notifyingPcbuNote}</Text>
              {canEdit && (
                <Button
                  label="Change"
                  variant="ghost"
                  onPress={() => setShowNominateForm(true)}
                />
              )}
            </View>
          ) : (
            <View style={styles.nominationBlock}>
              <Text style={styles.nominationLabel}>Who's notifying WorkSafe?</Text>
              <Text style={styles.decidedMeta}>
                If a contractor or another business is involved, record who's taking this on —
                only one notification is needed, but everyone stays responsible for it happening.
              </Text>
              {canEdit && !showNominateForm && (
                <Button label="Record notifying PCBU" variant="outline" onPress={() => setShowNominateForm(true)} fullWidth />
              )}
            </View>
          )}
          {canEdit && showNominateForm && (
            <View style={styles.nominateForm}>
              {otherOrgs.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
                  {otherOrgs.map((m) => (
                    <TouchableOpacity
                      key={m.org_id}
                      onPress={() => setSelectedOrgId(m.org_id)}
                      style={[styles.optionChip, selectedOrgId === m.org_id && styles.optionChipActive]}
                    >
                      <Text style={[styles.optionChipText, selectedOrgId === m.org_id && styles.optionChipTextActive]}>
                        {m.org_name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <TextInput
                style={styles.input}
                placeholder="Or type the PCBU's name"
                placeholderTextColor={Colors.textMuted}
                value={pcbuNote}
                onChangeText={(t) => { setPcbuNote(t); setSelectedOrgId(null); }}
              />
              <View style={styles.decisionRow}>
                <Button
                  label="Cancel"
                  variant="outline"
                  onPress={() => { setShowNominateForm(false); setSelectedOrgId(null); setPcbuNote(''); }}
                  style={styles.decisionButton}
                />
                <Button label="Save" onPress={handleNominate} loading={nominating} style={styles.decisionButton} />
              </View>
            </View>
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
    </>
  );
}

const styles = StyleSheet.create({
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

  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.xs,
  },
  nominationBlock: { gap: Spacing.xs },
  nominationLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  nominateForm: { gap: Spacing.sm, marginTop: Spacing.xs },
  optionRow: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  optionChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.chip,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  optionChipActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  optionChipText: { fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.medium },
  optionChipTextActive: { color: Colors.primary },
  input: {
    minHeight: 44,
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
});
