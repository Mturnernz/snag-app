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
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  Snag, SnagStatus, SnagKind, SnagSeverity, STATUS_LABELS, KIND_LABELS, SEVERITY_LABELS, UserRole, RootStackParamList,
  Profile,
} from '../types';
import { Colors, Spacing, Typography, Radius, Shadow } from '../constants/theme';
import {
  supabase, getSnagPhotoUrls, getProfile, mergeSnags, getOrgMembers, getWorkGroupsWithDetail, WorkGroupDetail,
  updateSnagStatus, resolveSnag, assignSnagOwner, assignSnagWorkGroup, getOrgSites, getMySiteIds,
} from '../lib/supabase';
import IssueCard from '../components/IssueCard';
import Chip from '../components/Chip';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import OrgSwitcherHeader from '../components/OrgSwitcherHeader';
import { useToast } from '../hooks/useToast';
import { useBadge } from '../context/BadgeContext';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type SortMode = 'newest' | 'oldest' | 'trending';
type DropdownKey = 'status' | 'date' | 'site' | null;

const STATUS_FILTER_OPTIONS: { key: SnagStatus; label: string }[] = [
  { key: 'flagged', label: STATUS_LABELS.flagged },
  { key: 'in_progress', label: STATUS_LABELS.in_progress },
  { key: 'resolved', label: STATUS_LABELS.resolved },
  { key: 'rca_pending', label: STATUS_LABELS.rca_pending },
];

// Resolved snags are noise once you're triaging what's still open, so they're
// hidden unless someone explicitly checks the Resolved box in the Status
// filter — this is that default, and what a cleared/first-run filter resets to.
const DEFAULT_STATUS_FILTERS: Set<SnagStatus> = new Set(['flagged', 'in_progress', 'rca_pending']);

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// Per-user, persisted across app opens (see the load/save effects below).
const STATUS_FILTER_STORAGE_PREFIX = 'snag.statusFilters.';

const PAGE_SIZE = 50;

export default function IssueListScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { refreshOpenIssueCount } = useBadge();

  // Filters/sort — five independent controls in the filter bar: Status and
  // Site are multi-select (empty = no filter), Date/Trending share one sort
  // mode, Public is a plain toggle only shown when relevant.
  const [statusFilters, setStatusFilters] = useState<Set<SnagStatus>>(new Set(DEFAULT_STATUS_FILTERS));
  const [siteFilters, setSiteFilters] = useState<Set<string>>(new Set());
  // Set once the persisted-preference load effect below resolves the signed-in
  // user; guards the save effect against writing before we know who "this
  // user" is (and from overwriting one user's saved filter with another's on
  // a shared device).
  const userIdRef = React.useRef<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [publicOnly, setPublicOnly] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<DropdownKey>(null);
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [isPublicOrg, setIsPublicOrg] = useState(false);
  const [hasPublicSnags, setHasPublicSnags] = useState(false);

  const [issues, setIssues] = useState<Snag[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [hasOrg, setHasOrg] = useState<boolean | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Pagination — the list loads PAGE_SIZE at a time and appends on scroll.
  // queryCtxRef snapshots the org scope resolved by the last full fetch so
  // loadMore can rebuild the identical query without re-resolving the org.
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const queryCtxRef = React.useRef<{ memberOfOrg: boolean; activeOrgId: string | null }>({
    memberOfOrg: false,
    activeOrgId: null,
  });

  // Select mode — long-press a card to enter it. selectedIds is ordered:
  // the first entry is the "anchor" whose content seeds a new merge parent.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mergeModalVisible, setMergeModalVisible] = useState(false);
  const [bulkModalVisible, setBulkModalVisible] = useState(false);
  const canMerge = role === 'officer_admin' || role === 'supervisor';
  const { showToast } = useToast();

  const hasActiveFilters = !setsEqual(statusFilters, DEFAULT_STATUS_FILTERS) || siteFilters.size > 0 || publicOnly;

  function toggleStatusFilter(s: SnagStatus) {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  function toggleSiteFilter(id: string) {
    setSiteFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // One page of the list query, identical for the first load and loadMore.
  const buildSnagQuery = useCallback((memberOfOrg: boolean, activeOrgId: string | null, from: number, to: number) => {
    let query = supabase
      .from('snags_with_details')
      .select('id, reference, status, kind, lane, severity, photo_path, created_at, reporter_id, reporter_name, owner_id, owner_name, comment_count, vote_score, description, site_id, site_name, is_public_submission, child_count')
      // Merged children are hidden here — only visible from the parent's own
      // "Merged snags" section. A parent is never itself a child (single-
      // level hierarchy, enforced server-side), so parents always show.
      .is('parent_snag_id', null)
      .range(from, to);

    if (memberOfOrg && activeOrgId) {
      // Members: internal reports by default; the Public button shows the
      // public-submissions queue. Explicitly scope to the active org — RLS
      // also allows any snag you personally reported even in a *different*
      // org (so a cross-org/public reporter can track their own report's
      // status), which would otherwise leak other-org snags into this list.
      query = query.eq('org_id', activeOrgId).eq('is_public_submission', publicOnly);
    }

    if (statusFilters.size > 0) {
      query = query.in('status', Array.from(statusFilters));
    }
    if (siteFilters.size > 0) {
      query = query.in('site_id', Array.from(siteFilters));
    }

    return query.order('created_at', { ascending: sortMode === 'oldest' });
  }, [statusFilters, siteFilters, sortMode, publicOnly]);

  const mapRows = (rows: any[]): Snag[] =>
    rows.map((row: any) => ({
      ...row,
      reporter: row.reporter_id ? { id: row.reporter_id, name: row.reporter_name } : undefined,
      owner: row.owner_id ? { id: row.owner_id, name: row.owner_name } : null,
    }));

  // Injury snags float to the top regardless of the active sort, unless
  // already resolved. Trending re-ranks everything else by combined
  // engagement (votes + comments); otherwise the DB order (newest/oldest)
  // is preserved (Array.sort is stable).
  const sortSnags = useCallback((arr: Snag[]): Snag[] => {
    const isPinned = (s: Snag) => s.severity === 'injury' && s.status !== 'resolved';
    const engagement = (s: Snag) => (s.vote_score ?? 0) + (s.comment_count ?? 0);
    return [...arr].sort((a, b) => {
      const pinDiff = Number(isPinned(b)) - Number(isPinned(a));
      if (pinDiff !== 0) return pinDiff;
      return sortMode === 'trending' ? engagement(b) - engagement(a) : 0;
    });
  }, [sortMode]);

  const fetchIssues = useCallback(async () => {
    // Re-check org state every fetch — it changes with the org switcher, and
    // it decides both the screen title and the public-submission filtering.
    const { data: { user } } = await supabase.auth.getUser();
    let memberOfOrg = false;
    let activeOrgId: string | null = null;
    let userRole: UserRole | null = null;
    let orgIsPublic = false;
    if (user) {
      const profile = await getProfile(user.id);
      memberOfOrg = Boolean(profile?.org_id);
      activeOrgId = profile?.org_id ?? null;
      userRole = profile?.role ?? null;
      orgIsPublic = Boolean(profile?.organisation?.is_public);
      setRole(userRole);
      setOrgName(profile?.organisation?.name ?? null);
      setIsPublicOrg(orgIsPublic);
    }
    setHasOrg(memberOfOrg);
    queryCtxRef.current = { memberOfOrg, activeOrgId };

    // The page query, the site-filter options, and the Public-button check
    // are independent — run them concurrently instead of serially.
    const [{ data, error }, siteList, publicFlag] = await Promise.all([
      buildSnagQuery(memberOfOrg, activeOrgId, 0, PAGE_SIZE - 1),
      (async () => {
        // Sites available to filter by: every org site for admin/supervisor,
        // only the worker's own assigned sites otherwise.
        if (!memberOfOrg || !activeOrgId) return [] as { id: string; name: string }[];
        const allSites = await getOrgSites(activeOrgId);
        if (userRole === 'officer_admin' || userRole === 'supervisor') return allSites;
        const mineIds = new Set(await getMySiteIds());
        return allSites.filter((s) => mineIds.has(s.id));
      })(),
      (async () => {
        // The Public button only ever shows for orgs that are both public
        // and actually have a public submission on record.
        if (!memberOfOrg || !activeOrgId || !orgIsPublic) return false;
        const { data: pub } = await supabase
          .from('snags')
          .select('id')
          .eq('org_id', activeOrgId)
          .eq('is_public_submission', true)
          .limit(1);
        return Boolean(pub && pub.length > 0);
      })(),
    ]);

    setSites(siteList);
    setHasPublicSnags(publicFlag);

    if (!error && data) {
      setIssues(sortSnags(mapRows(data)));
      setHasMore(data.length === PAGE_SIZE);
      const paths = data.map((row: any) => row.photo_path).filter(Boolean);
      getSnagPhotoUrls(paths).then(setPhotoUrls);
    }

    // Keep the Snags tab badge in sync — cheap enough to refresh on every
    // load rather than only on app foreground, so merges/status changes
    // made in this session are reflected immediately.
    refreshOpenIssueCount();
  }, [buildSnagQuery, sortSnags, refreshOpenIssueCount]);

  // Infinite scroll: fetch the next page with the same filters and append.
  // Offset-based paging can double up a row if something is inserted while
  // scrolling, so appends are deduped by id; a pull-to-refresh resets.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading || refreshing) return;
    setLoadingMore(true);
    const { memberOfOrg, activeOrgId } = queryCtxRef.current;
    const { data, error } = await buildSnagQuery(
      memberOfOrg, activeOrgId, issues.length, issues.length + PAGE_SIZE - 1
    );
    if (!error && data) {
      const fresh = mapRows(data);
      setIssues((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        return sortSnags([...prev, ...fresh.filter((s) => !seen.has(s.id))]);
      });
      setHasMore(data.length === PAGE_SIZE);
      const paths = data.map((row: any) => row.photo_path).filter(Boolean);
      if (paths.length > 0) {
        getSnagPhotoUrls(paths).then((map) => setPhotoUrls((prev) => ({ ...prev, ...map })));
      }
    }
    setLoadingMore(false);
  }, [loadingMore, hasMore, loading, refreshing, issues.length, buildSnagQuery, sortSnags]);

  // Load this user's saved Status filter (if any) once on mount, overriding
  // the default. Runs before the first fetchIssues below normally resolves
  // (both start on mount), and fetchIssues re-runs automatically if this
  // changes statusFilters, since it depends on buildSnagQuery which does.
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      userIdRef.current = user.id;
      const raw = await AsyncStorage.getItem(STATUS_FILTER_STORAGE_PREFIX + user.id);
      if (!raw) return;
      try {
        const saved: SnagStatus[] = JSON.parse(raw);
        setStatusFilters(new Set(saved));
      } catch {
        // Ignore malformed storage — keep the default.
      }
    });
  }, []);

  // Persist on every change so it's remembered next time this user opens the
  // app. Guarded on userIdRef so this can't fire (and overwrite the saved
  // preference with the default) before the load effect above has resolved.
  useEffect(() => {
    if (!userIdRef.current) return;
    AsyncStorage.setItem(STATUS_FILTER_STORAGE_PREFIX + userIdRef.current, JSON.stringify(Array.from(statusFilters)));
  }, [statusFilters]);

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
          <View style={styles.selectBarTop}>
            <TouchableOpacity onPress={exitSelectMode} style={styles.selectBarCancel}>
              <Text style={styles.selectBarCancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.selectBarCount}>{selectedIds.length} selected</Text>
          </View>
          <View style={styles.selectBarActions}>
            <Button
              label="Bulk Actions"
              variant="outline"
              onPress={() => setBulkModalVisible(true)}
              disabled={selectedIds.length === 0}
              style={styles.flex1}
            />
            <Button
              label="Merge Snags"
              onPress={() => setMergeModalVisible(true)}
              disabled={selectedIds.length < 2}
              style={styles.flex1}
            />
          </View>
        </View>
      ) : (
        <View style={styles.filterWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterBarRow}>
            <FilterBarButton
              label="Status"
              active={!setsEqual(statusFilters, DEFAULT_STATUS_FILTERS)}
              onPress={() => setOpenDropdown('status')}
            />
            <FilterBarButton
              label={sortMode === 'oldest' ? 'Oldest' : 'Date'}
              active={sortMode === 'oldest'}
              onPress={() => setOpenDropdown('date')}
            />
            {hasOrg && (
              <FilterBarButton
                label="Site"
                active={siteFilters.size > 0}
                onPress={() => setOpenDropdown('site')}
              />
            )}
            <FilterBarButton
              label="Trending"
              active={sortMode === 'trending'}
              dropdown={false}
              onPress={() => setSortMode((prev) => (prev === 'trending' ? 'newest' : 'trending'))}
            />
            {isPublicOrg && hasPublicSnags && (
              <FilterBarButton
                label="Public"
                active={publicOnly}
                dropdown={false}
                onPress={() => setPublicOnly((prev) => !prev)}
              />
            )}
          </ScrollView>
        </View>
      )}

      <Modal visible={openDropdown !== null} transparent animationType="fade" onRequestClose={() => setOpenDropdown(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setOpenDropdown(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sortSheet}>
            {openDropdown === 'status' && (
              <>
                <Text style={styles.sortSheetTitle}>Status</Text>
                {STATUS_FILTER_OPTIONS.map((opt) => {
                  const active = statusFilters.has(opt.key);
                  return (
                    <TouchableOpacity key={opt.key} style={styles.sortOption} onPress={() => toggleStatusFilter(opt.key)} activeOpacity={0.7}>
                      <Text style={[styles.sortOptionText, active && styles.sortOptionTextActive]}>{opt.label}</Text>
                      {active && <Icon name="checkmark" size="sm" color={Colors.primary} />}
                    </TouchableOpacity>
                  );
                })}
                <Button label="Submit" onPress={() => setOpenDropdown(null)} fullWidth style={styles.dropdownSubmit} />
              </>
            )}
            {openDropdown === 'date' && (
              <>
                <Text style={styles.sortSheetTitle}>Date</Text>
                {(['newest', 'oldest'] as SortMode[]).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={styles.sortOption}
                    onPress={() => { setSortMode(m); setOpenDropdown(null); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.sortOptionText, sortMode === m && styles.sortOptionTextActive]}>
                      {m === 'newest' ? 'Most recent' : 'Oldest'}
                    </Text>
                    {sortMode === m && <Icon name="checkmark" size="sm" color={Colors.primary} />}
                  </TouchableOpacity>
                ))}
              </>
            )}
            {openDropdown === 'site' && (
              <>
                <Text style={styles.sortSheetTitle}>Site</Text>
                <ScrollView style={styles.dropdownScroll}>
                  {sites.map((s) => {
                    const active = siteFilters.has(s.id);
                    return (
                      <TouchableOpacity key={s.id} style={styles.sortOption} onPress={() => toggleSiteFilter(s.id)} activeOpacity={0.7}>
                        <Text style={[styles.sortOptionText, active && styles.sortOptionTextActive]}>{s.name}</Text>
                        {active && <Icon name="checkmark" size="sm" color={Colors.primary} />}
                      </TouchableOpacity>
                    );
                  })}
                  {sites.length === 0 && <Text style={styles.hintMuted}>No sites available.</Text>}
                </ScrollView>
                <Button label="Submit" onPress={() => setOpenDropdown(null)} fullWidth style={styles.dropdownSubmit} />
              </>
            )}
          </TouchableOpacity>
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
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={Colors.primary} style={styles.footerSpinner} /> : null
          }
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
              title={hasActiveFilters ? 'No matching snags' : 'No snags yet'}
              message={
                hasActiveFilters
                  ? 'Try adjusting your filters or report a new issue.'
                  : 'Be the first to report an issue in your workplace.'
              }
              actionLabel={!hasActiveFilters ? 'Report a Snag' : undefined}
              onAction={
                !hasActiveFilters
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

      <BulkActionsModal
        visible={bulkModalVisible}
        snags={issues.filter((i) => selectedIds.includes(i.id))}
        onClose={() => setBulkModalVisible(false)}
        onApplied={async (message) => {
          setBulkModalVisible(false);
          exitSelectMode();
          await fetchIssues();
          showToast(message);
        }}
      />
    </View>
  );
}

// ── Filter bar button ────────────────────────────────────────────────────────
// Status/Date/Site open a dropdown (chevron shown); Trending/Public are
// plain toggles applied immediately on tap.
function FilterBarButton({
  label,
  active,
  onPress,
  dropdown = true,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  dropdown?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.filterBarButton, active && styles.filterBarButtonActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.filterBarButtonText, active && styles.filterBarButtonTextActive]}>{label}</Text>
      {dropdown && (
        <Icon name="chevron-down" size="sm" color={active ? Colors.primary : Colors.textSecondary} />
      )}
    </TouchableOpacity>
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

// ── Bulk actions modal ───────────────────────────────────────────────────────
// Change status / assign to person / assign to work group, applied across the
// whole selection. Each item goes through the exact same RPC (and gates) as
// the single-snag equivalents — results are just summarized afterward rather
// than pre-validated client-side, since the server is the source of truth for
// eligibility (site scoping, investigation gates, lane rules).
function BulkActionsModal({
  visible,
  snags,
  onClose,
  onApplied,
}: {
  visible: boolean;
  snags: Snag[];
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'menu' | 'status' | 'person' | 'workgroup'>('menu');
  const [targetStatus, setTargetStatus] = useState<SnagStatus>('flagged');
  const [note, setNote] = useState('');
  const [members, setMembers] = useState<Profile[]>([]);
  const [targetPersonId, setTargetPersonId] = useState<string | null | undefined>(undefined);
  const [workGroups, setWorkGroups] = useState<WorkGroupDetail[]>([]);
  const [targetWorkGroupId, setTargetWorkGroupId] = useState<string | null | undefined>(undefined);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStep('menu');
    setTargetStatus('flagged');
    setNote('');
    setTargetPersonId(undefined);
    setTargetWorkGroupId(undefined);
    getOrgMembers().then(setMembers);
    getWorkGroupsWithDetail().then(setWorkGroups);
  }, [visible]);

  if (!visible) return null;

  function finish(ok: number, errors: string[]) {
    const message = errors.length === 0
      ? `Updated ${ok} snag${ok === 1 ? '' : 's'}`
      : `Updated ${ok}, ${errors.length} failed`;
    onApplied(message);
  }

  async function applyStatus() {
    setApplying(true);
    let ok = 0;
    const errors: string[] = [];
    await Promise.all(snags.map(async (s) => {
      let err: { message?: string } | null = null;
      if (targetStatus === 'resolved') {
        if (s.lane === 'serious') {
          ({ error: err } = await updateSnagStatus(s.id, 'resolved', note.trim() || null));
        } else if (note.trim()) {
          ({ error: err } = await resolveSnag(s.id, note.trim()));
        } else {
          err = { message: 'Add a note to resolve niggles' };
        }
      } else if (s.lane === 'serious') {
        ({ error: err } = await updateSnagStatus(s.id, targetStatus));
      } else {
        err = { message: 'Niggles can only be marked Resolved' };
      }
      if (err) errors.push(`${s.reference}: ${err.message ?? 'failed'}`); else ok++;
    }));
    setApplying(false);
    finish(ok, errors);
  }

  async function applyPerson() {
    if (targetPersonId === undefined) return;
    setApplying(true);
    let ok = 0;
    const errors: string[] = [];
    await Promise.all(snags.map(async (s) => {
      const { error } = await assignSnagOwner(s.id, targetPersonId);
      if (error) errors.push(`${s.reference}: ${error.message ?? 'failed'}`); else ok++;
    }));
    setApplying(false);
    finish(ok, errors);
  }

  async function applyWorkGroup() {
    if (targetWorkGroupId === undefined) return;
    setApplying(true);
    let ok = 0;
    const errors: string[] = [];
    await Promise.all(snags.map(async (s) => {
      const { error } = await assignSnagWorkGroup(s.id, targetWorkGroupId);
      if (error) errors.push(`${s.reference}: ${error.message ?? 'failed'}`); else ok++;
    }));
    setApplying(false);
    finish(ok, errors);
  }

  const stepTitle = step === 'menu' ? `Bulk actions (${snags.length})`
    : step === 'status' ? 'Change status'
    : step === 'person' ? 'Assign to person'
    : 'Assign to work group';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{stepTitle}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon name="close" size="md" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          {step === 'menu' && (
            <ScrollView style={styles.modalScroll}>
              <TouchableOpacity style={styles.bulkMenuRow} onPress={() => setStep('status')} activeOpacity={0.7}>
                <Icon name="swap-horizontal-outline" size="md" color={Colors.primary} />
                <Text style={styles.bulkMenuLabel}>Change status</Text>
                <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.bulkMenuRow} onPress={() => setStep('person')} activeOpacity={0.7}>
                <Icon name="person-outline" size="md" color={Colors.primary} />
                <Text style={styles.bulkMenuLabel}>Assign to person</Text>
                <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.bulkMenuRow} onPress={() => setStep('workgroup')} activeOpacity={0.7}>
                <Icon name="people-outline" size="md" color={Colors.primary} />
                <Text style={styles.bulkMenuLabel}>Assign to work group</Text>
                <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
              </TouchableOpacity>
            </ScrollView>
          )}

          {step === 'status' && (
            <>
              <Text style={styles.modalHint}>
                Serious-lane snags apply directly. Niggles can only be marked Resolved, and need a note.
              </Text>
              <Chip
                options={[
                  { key: 'flagged' as SnagStatus, label: STATUS_LABELS.flagged },
                  { key: 'in_progress' as SnagStatus, label: STATUS_LABELS.in_progress },
                  { key: 'resolved' as SnagStatus, label: STATUS_LABELS.resolved },
                ]}
                value={targetStatus}
                onChange={setTargetStatus}
                variant="segmented"
              />
              {targetStatus === 'resolved' && (
                <TextInput
                  style={styles.modalInput}
                  placeholder="Resolution note (required for niggles)"
                  placeholderTextColor={Colors.textMuted}
                  value={note}
                  onChangeText={setNote}
                  multiline
                />
              )}
              <View style={styles.modalActions}>
                <Button label="Back" variant="outline" onPress={() => setStep('menu')} style={styles.flex1} />
                <Button label={`Apply to ${snags.length}`} onPress={applyStatus} loading={applying} style={styles.flex1} />
              </View>
            </>
          )}

          {step === 'person' && (
            <>
              <ScrollView style={styles.modalScroll}>
                <TouchableOpacity
                  style={[styles.pickerRow, targetPersonId === null && styles.pickerRowActive]}
                  onPress={() => setTargetPersonId(null)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.pickerRowText}>Unassigned</Text>
                  {targetPersonId === null && <Icon name="checkmark" size="sm" color={Colors.primary} />}
                </TouchableOpacity>
                {members.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.pickerRow, targetPersonId === m.id && styles.pickerRowActive]}
                    onPress={() => setTargetPersonId(m.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.pickerRowText}>{m.name || m.email}</Text>
                    {targetPersonId === m.id && <Icon name="checkmark" size="sm" color={Colors.primary} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={styles.modalActions}>
                <Button label="Back" variant="outline" onPress={() => setStep('menu')} style={styles.flex1} />
                <Button
                  label={`Apply to ${snags.length}`}
                  onPress={applyPerson}
                  loading={applying}
                  disabled={targetPersonId === undefined}
                  style={styles.flex1}
                />
              </View>
            </>
          )}

          {step === 'workgroup' && (
            <>
              <ScrollView style={styles.modalScroll}>
                <TouchableOpacity
                  style={[styles.pickerRow, targetWorkGroupId === null && styles.pickerRowActive]}
                  onPress={() => setTargetWorkGroupId(null)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.pickerRowText}>None</Text>
                  {targetWorkGroupId === null && <Icon name="checkmark" size="sm" color={Colors.primary} />}
                </TouchableOpacity>
                {workGroups.map((wg) => (
                  <TouchableOpacity
                    key={wg.id}
                    style={[styles.pickerRow, targetWorkGroupId === wg.id && styles.pickerRowActive]}
                    onPress={() => setTargetWorkGroupId(wg.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.pickerRowText}>{wg.name}</Text>
                    {targetWorkGroupId === wg.id && <Icon name="checkmark" size="sm" color={Colors.primary} />}
                  </TouchableOpacity>
                ))}
                {workGroups.length === 0 && (
                  <Text style={styles.hintMuted}>This organisation has no work groups yet.</Text>
                )}
              </ScrollView>
              <View style={styles.modalActions}>
                <Button label="Back" variant="outline" onPress={() => setStep('menu')} style={styles.flex1} />
                <Button
                  label={`Apply to ${snags.length}`}
                  onPress={applyWorkGroup}
                  loading={applying}
                  disabled={targetWorkGroupId === undefined}
                  style={styles.flex1}
                />
              </View>
            </>
          )}
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
    backgroundColor: Colors.surface,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filterBarRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  filterBarButton: {
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
  filterBarButtonActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  filterBarButtonText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  filterBarButtonTextActive: {
    color: Colors.primary,
    fontWeight: Typography.semibold,
  },
  dropdownScroll: {
    maxHeight: 320,
  },
  dropdownSubmit: {
    marginTop: Spacing.sm,
  },

  // Select mode
  selectBar: {
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  selectBarTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  selectBarActions: { flexDirection: 'row', gap: Spacing.sm },
  selectBarCancel: { paddingVertical: Spacing.xs },
  selectBarCancelText: { fontSize: Typography.base, color: Colors.primary },
  selectBarCount: { flex: 1, fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },

  // Bulk actions modal
  bulkMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  bulkMenuLabel: { flex: 1, fontSize: Typography.base, fontWeight: Typography.medium, color: Colors.textPrimary },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.button,
  },
  pickerRowActive: { backgroundColor: Colors.primaryLight },
  pickerRowText: { fontSize: Typography.base, color: Colors.textPrimary },
  hintMuted: { fontSize: Typography.sm, color: Colors.textMuted, fontStyle: 'italic', paddingVertical: Spacing.sm },

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
  footerSpinner: {
    paddingVertical: Spacing.lg,
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
