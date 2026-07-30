import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';

import { ROLE_LABELS } from '../types';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { SiteAssignee } from '../lib/supabase';
import Icon from './Icon';

interface Props {
  assignees: SiteAssignee[];
  currentOwnerId: string | null;
  onSelect: (ownerId: string | null) => void;
  /** Hide the "Unassigned" chip — for pickers only ever offered on already-
   *  unassigned items, where clearing back to unassigned doesn't apply. */
  allowUnassign?: boolean;
  /** Add a filter box above the chips and stack them vertically. Worth it on a
   *  site with more than a handful of people, where the horizontal strip means
   *  scrolling past everyone to reach a name you already know. Off by default
   *  so the existing one-tap quick-assign spots stay as they are. */
  searchable?: boolean;
  /** Placeholder for the filter box. Ignored unless `searchable`. */
  searchPlaceholder?: string;
}

// Extracted from ManageIssuePanel's inline owner chip list so the same
// site-scoped assign UI can be reused as a one-click widget elsewhere (the
// dashboard's unassigned-snags quick-assign) without duplicating the
// chip-rendering markup. onSelect fires immediately — callers decide
// whether that means an instant RPC call or staging into a batched save,
// same as ManageIssuePanel already did before this extraction.
//
// The list is site-scoped on purpose: assign_snag_owner validates the owner
// against site_members/site_supervisors (or an org admin), so offering the
// whole organisation would list people the server then refuses.
export default function OwnerPicker({
  assignees, currentOwnerId, onSelect, allowUnassign = true,
  searchable = false, searchPlaceholder = 'Search by name',
}: Props) {
  const [query, setQuery] = useState('');

  // `includes`, not `startsWith` (which is what the @mention picker uses) —
  // people search on a surname at least as often as a first name.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assignees;
    return assignees.filter((m) => (m.name ?? '').toLowerCase().includes(q));
  }, [assignees, query]);

  if (!searchable) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
        {allowUnassign && <UnassignedChip active={!currentOwnerId} onPress={() => onSelect(null)} />}
        {assignees.map((member) => (
          <AssigneeChip
            key={member.id}
            member={member}
            active={currentOwnerId === member.id}
            onPress={() => onSelect(member.id)}
          />
        ))}
      </ScrollView>
    );
  }

  return (
    <View style={styles.searchWrap}>
      <View style={styles.searchBox}>
        <Icon name="search-outline" size="sm" color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder}
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={searchPlaceholder}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
            <Icon name="close-circle-outline" size="sm" color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {allowUnassign && !query && (
        <UnassignedChip active={!currentOwnerId} onPress={() => onSelect(null)} full />
      )}

      {shown.length === 0 ? (
        <Text style={styles.noMatch}>Nobody at this site matches “{query.trim()}”.</Text>
      ) : (
        shown.map((member) => (
          <AssigneeChip
            key={member.id}
            member={member}
            active={currentOwnerId === member.id}
            onPress={() => onSelect(member.id)}
            full
          />
        ))
      )}
    </View>
  );
}

function UnassignedChip({ active, onPress, full = false }: { active: boolean; onPress: () => void; full?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.optionChip, full && styles.optionChipFull, active && styles.optionChipActive]}
    >
      <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>Unassigned</Text>
    </TouchableOpacity>
  );
}

function AssigneeChip({
  member, active, onPress, full = false,
}: { member: SiteAssignee; active: boolean; onPress: () => void; full?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.optionChip, full && styles.optionChipFull, active && styles.optionChipActive]}
    >
      <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>
        {member.name} · {ROLE_LABELS[member.role]}
      </Text>
      {full && active && <Icon name="checkmark" size="sm" color={Colors.primary} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  optionRow: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  searchWrap: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  searchInput: {
    flex: 1,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  noMatch: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    paddingVertical: Spacing.sm,
  },
  optionChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.chip,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  optionChipFull: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET,
  },
  optionChipActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  optionChipText: { fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.medium },
  optionChipTextActive: { color: Colors.primary },
});
