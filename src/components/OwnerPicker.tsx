import React from 'react';
import { Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';

import { ROLE_LABELS } from '../types';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { SiteAssignee } from '../lib/supabase';

interface Props {
  assignees: SiteAssignee[];
  currentOwnerId: string | null;
  onSelect: (ownerId: string | null) => void;
  /** Hide the "Unassigned" chip — for pickers only ever offered on already-
   *  unassigned items, where clearing back to unassigned doesn't apply. */
  allowUnassign?: boolean;
}

// Extracted from ManageIssuePanel's inline owner chip list so the same
// site-scoped assign UI can be reused as a one-click widget elsewhere (the
// dashboard's unassigned-snags quick-assign) without duplicating the
// chip-rendering markup. onSelect fires immediately — callers decide
// whether that means an instant RPC call or staging into a batched save,
// same as ManageIssuePanel already did before this extraction.
export default function OwnerPicker({ assignees, currentOwnerId, onSelect, allowUnassign = true }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
      {allowUnassign && (
        <TouchableOpacity
          onPress={() => onSelect(null)}
          style={[styles.optionChip, !currentOwnerId && styles.optionChipActive]}
        >
          <Text style={[styles.optionChipText, !currentOwnerId && styles.optionChipTextActive]}>Unassigned</Text>
        </TouchableOpacity>
      )}
      {assignees.map((member) => (
        <TouchableOpacity
          key={member.id}
          onPress={() => onSelect(member.id)}
          style={[styles.optionChip, currentOwnerId === member.id && styles.optionChipActive]}
        >
          <Text style={[styles.optionChipText, currentOwnerId === member.id && styles.optionChipTextActive]}>
            {member.name} · {ROLE_LABELS[member.role]}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
});
