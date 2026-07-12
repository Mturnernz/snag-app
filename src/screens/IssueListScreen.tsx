import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  Snag, SnagStatus, SnagKind, SnagSeverity, STATUS_LABELS, KIND_LABELS, SEVERITY_LABELS, UserRole, RootStackParamList,
} from '../types';
import { Colors, Spacing, Typography, Radius, Shadow } from '../constants/theme';
import { supabase, getSnagPhotoUrls, getProfile, mergeSnags } from '../lib/supabase';
import IssueCard from '../components/IssueCard';
import Chip from '../components/Chip';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import OrgSwitcherHeader from '../components/OrgSwitcherHeader';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type FilterOption = 'all' | 'public' | 'unassigned' | SnagStatus;
type SortOption = 'newest' | 'site' | 'comments' | 'votes';

const FILTER_OPTIONS: { key: FilterOption; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'flagged', label: STATUS_LABELS.flagged },
  { key: 'in_progress', label: STATUS_LABELS.in_progress },
  { key: 'resolved', label: STATUS_LABELS.resolved },
];

// Members also get an "Unassigned" triage queue and the public-submissions
// queue; their default view shows internal reports only.
const MEMBER_FILTER_OPTIONS: { key: FilterOption; label: string }[] = [
  ...FILTER_OPTIONS,
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'public', label: 'Public' },
];

const SORT_OPTIONS: { key: SortOption; label: string; icon: React.ComponentProps<typeof Icon>['name'] }[] = [
  { key: 'newest', label: 'Newest first', icon: 'time-outline' },
  { key: 'site', label: 'Site', icon: 'business-outline' },
  { key: 'comments', label: 'Most commented', icon: 'chatbubble-outline' },
  { key: 'votes', label: 'Highest voted', icon: 'caret-up-outline' },
];

export default function IssueListScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const [filter, setFilter] = useState<FilterOption>('all');
  const [sort, setSort] = useState<SortOption>('newest');
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [issues, setIssues] = useState<Snag[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [hasOrg, setHasOrg] = useState<boolean | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Merge — long-press a card to enter select mode. selectedIds is ordered:
  // the first entry is the "anchor" whose content seeds the new parent.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mergeModalVisible, setMergeModalVisible] = useState(false);
  const canMerge = role === 'officer_admin' || role === 'supervisor';

  const fetchIssues = useCallback(async () => {
    // Re-check org state every fetch — it changes with the org switcher, and
    // it decides both the screen title and the public-submission filtering.
    const { data: { user } } = await supabase.auth.getUser();
    let memberOfOrg = false;
    let activeOrgId: string | null = null;
    if (user) {
      const profile = await getProfile(user.id);
      memberOfOrg = Boolean(profile?.org_id);
      activeOrgId = profile?.org_id ?? null;
      setRole(profile?.role ?? null);
      setOrgName(profile?.organisation?.name ?? null);
    }
    setHasOrg(memberOfOrg);

    let query = supabase
      .from('snags_with_details')
      .select('id, reference, status, kind, severity, photo_path, created_at, reporter_id, reporter_name, owner_id, owner_name, comment_count, vote_score, description, site_id, site_name, is_public_submission')
      // Merged children are hidden here — only visible from the parent's own
      // "Merged snags" section. A parent is never itself a child (single-
      // level hierarchy, enforced server-side), so parents always show.
      .is('parent_snag_id', null)
      .limit(50);

    if (memberOfOrg && activeOrgId) {
      // Members: internal reports by default; the Public chip shows the
      // public-submissions queue. Explicitly scope to the active org — RLS
      // also allows any snag you personally reported even in a *different*
      // org (so a cross-org/public reporter can track their own report's
      // status), which would otherwise leak other-org snags into this list.
      query = query.eq('org_id', activeOrgId).eq('is_public_submission', filter === 'public');
    }

    switch (sort) {
      case 'site':
        query = query.order('site_name', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
        break;
      case 'comments':
        query = query.order('comment_count', { ascending: false }).order('created_at', { ascending: false });
        break;
      case 'votes':
        query = query.order('vote_score', { ascending: false }).order('created_at', { ascending: false });
        break;
      case 'newest':
      default:
        query = query.order('created_at', { ascending: false });
    }

    if (filter === 'unassigned') {
      // Supervisor triage queue — snags with no owner yet (RLS already scopes
      // these to the viewer's sites).
      query = query.is('owner_id', null);
    } else if (filter !== 'all' && filter !== 'public') {
      query = query.eq('status', filter);
    }

    const { data, error } = await query;

    if (!error && data) {
      const mapped = data.map((row: any) => ({
        ...row,
        reporter: row.reporter_id ? { id: row.reporter_id, name: row.reporter_name } : undefined,
        owner: row.owner_id ? { id: row.owner_id, name: row.owner_name } : null,
      }));
      // Injury snags float to the top regardless of the active sort, unless
      // already resolved — everything else keeps its existing relative order
      // (Array.sort is stable).
      const isPinned = (s: Snag) => s.severity === 'injury' && s.status !== 'resolved';
      mapped.sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)));
      setIssues(mapped);
      const paths = data.map((row: any) => row.photo_path).filter(Boolean);
      getSnagPhotoUrls(paths).then(setPhotoUrls);
    }
  }, [filter, sort]);

  useEffect(() => {
    setLoading(true);
    fetchIssues().finally(() => setLoading(false));
  }, [fetchIssues]);

  // Refetch on focus — the visible snags are scoped to the active org, which
  // may have changed (org switcher / QR scan) since this tab last rendered.
  useFocusEffect(
    useCallback(() => {
      fetchIssues();
    }, [fetchIssues])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchIssues();
    setRefreshing(false);
  }, [fetchIssues]);

  function handleLongPress(id: string) {
    if (!canMerge) return;
    setSelectMode(true);
    setSelectedIds([id]);
  }

  function handleCardPress(item: Snag) {
    if (selectMode) {
      setSelectedIds((prev) =>
        prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
      );
      return;
    }
    navigation.navigate('IssueDetail', { issueId: item.id });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds([]);
  }

  async function handleMerged(newSnag: { id: string; reference: string }) {
    setMergeModalVisible(false);
    exitSelectMode();
    await fetchIssues();
    navigation.navigate('IssueDetail', { issueId: newSnag.id });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <OrgSwitcherHeader
        title={hasOrg === false ? 'My Reports' : 'Snags'}
        role={role}
        orgName={orgName}
        onSwitched={fetchIssues}
      />

      {selectMode ? (
        <View style={styles.selectBar}>
          <TouchableOpacity onPress={exitSelectMode} style={styles.selectBarCancel}>
            <Text style={styles.selectBarCancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.selectBarCount}>{selectedIds.length} selected</Text>
          <Button
            label="Merge Snags"
            onPress={() => setMergeModalVisible(true)}
            disabled={selectedIds.length < 2}
          />
        </View>
      ) : (
        <View style={styles.filterWrap}>
          <View style={styles.filterChips}>
            <Chip
              options={hasOrg ? MEMBER_FILTER_OPTIONS : FILTER_OPTIONS}
              value={filter}
              onChange={setFilter}
              variant="chip"
            />
          </View>
          <TouchableOpacity style={styles.sortButton} onPress={() => setSortModalVisible(true)} activeOpacity={0.7}>
            <Icon name="swap-vertical-outline" size="sm" color={Colors.textSecondary} />
            <Text style={styles.sortButtonText}>{SORT_OPTIONS.find((o) => o.key === sort)?.label}</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={sortModalVisible} transparent animationType="fade" onRequestClose={() => setSortModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSortModalVisible(false)}>
          <View style={styles.sortSheet}>
            <Text style={styles.sortSheetTitle}>Sort by</Text>
            {SORT_OPTIONS.map((option) => {
              const active = option.key === sort;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={styles.sortOption}
                  onPress={() => {
                    setSort(option.key);
                    setSortModalVisible(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Icon name={option.icon} size="md" color={active ? Colors.primary : Colors.textSecondary} />
                  <Text style={[styles.sortOptionText, active && styles.sortOptionTextActive]}>{option.label}</Text>
                  {active && <Icon name="checkmark" size="sm" color={Colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={issues}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          renderItem={({ item }) => (
            <IssueCard
              issue={item}
              compact
              photoUrl={item.photo_path ? photoUrls[item.photo_path] ?? null : null}
              onPress={() => handleCardPress(item)}
              onLongPress={() => handleLongPress(item.id)}
              selectable={selectMode}
              selected={selectedIds.includes(item.id)}
            />
          )}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 16 },
          ]}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          removeClippedSubviews
          windowSize={5}
          initialNumToRender={8}
          maxToRenderPerBatch={5}
          updateCellsBatchingPeriod={50}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="build-outline"
              title={filter === 'all' ? 'No snags yet' : `No ${filter.replace('_', ' ')} snags`}
              message={
                filter === 'all'
                  ? 'Be the first to report an issue in your workplace.'
                  : 'Try a different filter or report a new issue.'
              }
              actionLabel={filter === 'all' ? 'Report a Snag' : undefined}
              onAction={
                filter === 'all'
                  ? () => navigation.navigate('Main' as any, { screen: 'Report' } as any)
                  : undefined
              }
            />
          }
        />
      )}

      <MergeModal
        visible={mergeModalVisible}
        snags={issues.filter((i) => selectedIds.includes(i.id))}
        anchorId={selectedIds[0]}
        onCancel={() => setMergeModalVisible(false)}
        onMerged={handleMerged}
      />
    </View>
  );
}

// ── Merge modal ──────────────────────────────────────────────────────────────
// Always shows an editable description (pre-filled from the anchor — the
// first card long-pressed). Kind/severity/site pickers only appear when that
// field is actually ambiguous across the current selection; severity is only
// blocking when the resolved kind is hazard/incident.
function MergeModal({
  visible,
  snags,
  anchorId,
  onCancel,
  onMerged,
}: {
  visible: boolean;
  snags: Snag[];
  anchorId: string | undefined;
  onCancel: () => void;
  onMerged: (snag: { id: string; reference: string }) => void;
}) {
  const insets = useSafeAreaInsets();
  const [description, setDescription] = useState('');
  const [pickedKind, setPickedKind] = useState<SnagKind | null>(null);
  const [pickedSeverity, setPickedSeverity] = useState<SnagSeverity | null>(null);
  const [pickedSiteId, setPickedSiteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anchor = snags.find((s) => s.id === anchorId) ?? snags[0];
  const kindValues = [...new Set(snags.map((s) => s.kind))];
  const kindAmbiguous = kindValues.length > 1;
  const resolvedKind = kindAmbiguous ? pickedKind : kindValues[0] ?? null;

  const severityValues = [...new Set(snags.map((s) => s.severity).filter((v): v is SnagSeverity => Boolean(v)))];
  const severityAmbiguous = (resolvedKind === 'hazard' || resolvedKind === 'incident') && severityValues.length > 1;

  const siteOptions = [...new Map(snags.map((s) => [s.site_id, s.site_name ?? 'Unknown site'])).entries()];
  const siteAmbiguous = siteOptions.length > 1;

  useEffect(() => {
    if (!visible) return;
    setDescription(anchor?.description ?? '');
    setPickedKind(null);
    setPickedSeverity(null);
    setPickedSiteId(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, anchorId]);

  if (!visible) return null;

  const canConfirm =
    snags.length >= 2 &&
    (!kindAmbiguous || pickedKind) &&
    (!severityAmbiguous || pickedSeverity) &&
    (!siteAmbiguous || pickedSiteId);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    const { data, error: mergeError } = await mergeSnags({
      snagIds: snags.map((s) => s.id),
      description: description.trim() || null,
      kind: pickedKind,
      severity: pickedSeverity,
      siteId: pickedSiteId,
    });
    setSubmitting(false);
    if (mergeError || !data) {
      setError(mergeError?.message ?? 'Could not merge those snags');
      return;
    }
    onMerged(data);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Merge {snags.length} snags</Text>
            <TouchableOpacity onPress={onCancel} hitSlop={8}>
              <Icon name="close" size="md" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>
            This creates a parent snag covering all {snags.length}. Changing the parent's status will change
            every child's status too — each child keeps its current status until then.
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled" style={styles.modalScroll}>
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={styles.modalInput}
              value={description}
              onChangeText={setDescription}
              multiline
              placeholder="What's the combined issue?"
              placeholderTextColor={Colors.textMuted}
            />

            {kindAmbiguous && (
              <>
                <Text style={styles.fieldLabel}>These have different categories — pick one</Text>
                <Chip<SnagKind | ''>
                  options={kindValues.map((k) => ({ key: k, label: KIND_LABELS[k] }))}
                  value={pickedKind ?? ''}
                  onChange={(k) => setPickedKind(k || null)}
                  variant="segmented"
                />
              </>
            )}

            {severityAmbiguous && (
              <>
                <Text style={styles.fieldLabel}>These have different severities — pick one</Text>
                <Chip<SnagSeverity | ''>
                  options={severityValues.map((s) => ({ key: s, label: SEVERITY_LABELS[s] }))}
                  value={pickedSeverity ?? ''}
                  onChange={(s) => setPickedSeverity(s || null)}
                  variant="segmented"
                />
              </>
            )}

            {siteAmbiguous && (
              <>
                <Text style={styles.fieldLabel}>These are at different sites — pick one</Text>
                <Chip
                  options={siteOptions.map(([id, name]) => ({ key: id ?? '', label: name }))}
                  value={pickedSiteId ?? ''}
                  onChange={setPickedSiteId}
                  variant="segmented"
                />
              </>
            )}

            {error && <Text style={styles.modalError}>{error}</Text>}
          </ScrollView>

          <View style={styles.modalActions}>
            <Button label="Cancel" variant="outline" onPress={onCancel} style={styles.flex1} />
            <Button
              label="Confirm Merge"
              onPress={handleConfirm}
              loading={submitting}
              disabled={!canConfirm}
              style={styles.flex1}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  filterWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filterChips: {
    flex: 1,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 34,
    paddingHorizontal: Spacing.md,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  sortButtonText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },

  // Merge select mode
  selectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  selectBarCancel: { paddingVertical: Spacing.xs },
  selectBarCancelText: { fontSize: Typography.base, color: Colors.primary },
  selectBarCount: { flex: 1, fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },

  // Merge modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card,
    padding: Spacing.lg, gap: Spacing.sm, maxHeight: '85%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { flex: 1, fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  modalHint: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 18 },
  modalScroll: { marginTop: Spacing.sm },
  fieldLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary, marginTop: Spacing.sm, marginBottom: Spacing.xs },
  modalInput: {
    minHeight: 80,
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    textAlignVertical: 'top',
  },
  modalError: {
    fontSize: Typography.sm,
    color: Colors.danger,
    backgroundColor: Colors.priority.highBg,
    borderRadius: Radius.button,
    padding: Spacing.sm,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  modalActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  flex1: { flex: 1 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    justifyContent: 'flex-end',
  },
  sortSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.xs,
    ...Shadow.lg,
  },
  sortSheetTitle: {
    fontSize: Typography.sm,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  sortOptionText: {
    flex: 1,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  sortOptionTextActive: {
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
  listContent: {
    padding: Spacing.lg,
  },
  columnWrapper: {
    gap: Spacing.sm,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
