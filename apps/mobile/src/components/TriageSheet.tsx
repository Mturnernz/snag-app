import React, { useState } from 'react';
import * as Haptics from 'expo-haptics';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { INVESTIGATION_MODE_OPTIONS } from '../types';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  assignInvestigation, assignSnagOwner, setNotifiableFlag,
  InvestigationMode, SiteAssignee,
} from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import Icon from './Icon';
import Sheet from './Sheet';
import OwnerPicker from './OwnerPicker';

/** Answered, or explicitly deferred. Nothing is written for 'later'. */
type NotifiableAnswer = 'yes' | 'no' | 'later';

const NOTIFIABLE_OPTIONS: { value: NotifiableAnswer; label: string; detail: string }[] = [
  {
    value: 'yes',
    label: 'Yes — notifiable',
    detail: 'It has to be reported to WorkSafe as soon as possible, and the site preserved.',
  },
  {
    value: 'no',
    label: 'No',
    detail: "Recorded as reviewed and below the threshold — not as a question nobody asked.",
  },
  {
    value: 'later',
    label: "I'm not sure yet",
    detail: 'Nothing is recorded, and this asks again next time. The snag cannot be resolved until it is answered.',
  },
];

interface Props {
  visible: boolean;
  snagId: string;
  reference: string;
  description: string | null;
  /** Site-scoped, same list assign_snag_owner validates against. */
  assignees: SiteAssignee[];
  /** Usually the auto-assigned serious-incident owner, offered as the default. */
  currentOwnerId: string | null;
  currentMode: InvestigationMode;
  /** Fires after a successful save so the screen re-reads the snag. */
  onDone: () => void;
}

/**
 * Triage, as one moment.
 *
 * The three decisions that constitute triaging a serious snag — how it is
 * investigated, who runs it, whether it is notifiable — were in three different
 * collapsed places, and on the serious lane the allocation controls sat *below*
 * the whole investigation they configure. So a hazard could sit flagged for days
 * having been read by a supervisor who never scrolled to the part that assigns
 * it.
 *
 * This asks all three the moment a supervisor opens an untriaged serious snag,
 * and does not take no for an answer on the first two: they are the supervisor's
 * call and the reason the snag is in front of them. The notifiable question can
 * be deferred, because it carries a statutory threshold and a modal is no place
 * to make somebody guess — but deferring is a choice they have to make, not the
 * default that happens when they scroll past.
 *
 * The snag's reference and description are in the sheet so it can be triaged
 * without needing to see the page behind it.
 */
export default function TriageSheet({
  visible, snagId, reference, description, assignees, currentOwnerId, currentMode, onDone,
}: Props) {
  const { showToast } = useToast();

  const [mode, setMode] = useState<InvestigationMode>(currentMode);
  const [investigatorId, setInvestigatorId] = useState<string | null>(currentOwnerId);
  const [notifiable, setNotifiable] = useState<NotifiableAnswer | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!investigatorId || !notifiable || saving) return;
    setSaving(true);

    // Order matters. assign_snag_owner fires notify_after_snag_update, which
    // mails the new owner — and the mail names how the investigation is being
    // run, so the investigations row has to exist by then. Assigning the
    // investigation first also means a failure here leaves the snag untriaged
    // rather than owned-but-unallocated.
    const { error: modeError } = await assignInvestigation(snagId, investigatorId, mode);
    if (modeError) {
      setSaving(false);
      showToast(modeError.message ?? 'Could not allocate the investigation');
      return;
    }

    const { error: ownerError } = await assignSnagOwner(snagId, investigatorId);
    if (ownerError) {
      setSaving(false);
      showToast(ownerError.message ?? 'Could not assign the investigator');
      return;
    }

    if (notifiable !== 'later') {
      const { error: notifiableError } = await setNotifiableFlag(snagId, notifiable === 'yes');
      if (notifiableError) {
        setSaving(false);
        showToast(notifiableError.message ?? 'Could not record the notifiable decision');
        return;
      }
    }

    setSaving(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(notifiable === 'later' ? 'Allocated — the notifiable decision is still outstanding' : 'Allocated');
    onDone();
  }

  const investigatorName = investigatorId
    ? assignees.find((a) => a.id === investigatorId)?.name ?? null
    : null;

  return (
    <Sheet
      visible={visible}
      dismissible={false}
      title="Triage this incident"
      subtitle={`${reference} — three decisions before anyone can work on it.`}
      submitLabel="Start the investigation"
      onSubmit={handleSubmit}
      submitting={saving}
      submitDisabled={!investigatorId || !notifiable}
      onClose={onDone}
    >
      {description ? <Text style={styles.description}>{description}</Text> : null}

      <Text style={styles.question}>How will this be investigated?</Text>
      <View style={styles.optionList}>
        {INVESTIGATION_MODE_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[styles.option, mode === option.value && styles.optionActive]}
            onPress={() => { Haptics.selectionAsync(); setMode(option.value); }}
            accessibilityRole="radio"
            accessibilityState={{ selected: mode === option.value }}
          >
            <Icon
              name={mode === option.value ? 'radio-button-on' : 'radio-button-off'}
              size="sm"
              color={mode === option.value ? Colors.primary : Colors.textMuted}
            />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>{option.title}</Text>
              <Text style={styles.optionDetail}>{option.detail}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.question}>Who is running it?</Text>
      <Text style={styles.hint}>
        They get the checklist, the witness statements, the evidence and
        {mode === 'document' ? ' the investigation document' : ' the root cause'} — whatever their role.
      </Text>
      <OwnerPicker
        assignees={assignees}
        currentOwnerId={investigatorId}
        onSelect={setInvestigatorId}
        allowUnassign={false}
        searchable
        searchPlaceholder="Search people at this site"
      />
      {investigatorName ? (
        <Text style={styles.chosen}>Assigning to {investigatorName}.</Text>
      ) : (
        <Text style={styles.chosen}>Pick someone — the investigation needs a lead.</Text>
      )}

      <Text style={styles.question}>Is this a notifiable event?</Text>
      <View style={styles.optionList}>
        {NOTIFIABLE_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[styles.option, notifiable === option.value && styles.optionActive]}
            onPress={() => { Haptics.selectionAsync(); setNotifiable(option.value); }}
            accessibilityRole="radio"
            accessibilityState={{ selected: notifiable === option.value }}
          >
            <Icon
              name={notifiable === option.value ? 'radio-button-on' : 'radio-button-off'}
              size="sm"
              color={notifiable === option.value ? Colors.primary : Colors.textMuted}
            />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>{option.label}</Text>
              <Text style={styles.optionDetail}>{option.detail}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  description: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    lineHeight: 19,
    paddingBottom: Spacing.xs,
  },
  question: {
    fontSize: Typography.base,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    paddingTop: Spacing.sm,
  },
  hint: { fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 18 },
  chosen: { fontSize: Typography.sm, color: Colors.textSecondary },

  optionList: { gap: Spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    padding: Spacing.md,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  optionActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textPrimary },
  optionDetail: { fontSize: Typography.xs, color: Colors.textSecondary, lineHeight: 17 },
});
