import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Organisation, Profile, UserRole, RootStackParamList } from '../types';
import {
  supabase, getSiteBreakdown, SiteBreakdown, getMemberships, setOrganisationActive, Membership,
  getUnassignedSnags, UnassignedSnag, getSiteAssignees, SiteAssignee, assignSnagOwner,
  getOverdueActions, getRcaOutstanding, getSeriousIncidentOwners, getSitesWithDetail, SiteDetail,
} from '../lib/supabase';
import type { OverdueActionRow, RcaOutstandingRow } from '@snag/supabase-queries';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { showAlert } from '../lib/alert';
import { shouldShowHint, markHintSeen } from '../lib/firstRunHints';
import Card from '../components/Card';
import Button from '../components/Button';
import Icon from '../components/Icon';
import OrgSwitcherHeader from '../components/OrgSwitcherHeader';
import OwnerPicker from '../components/OwnerPicker';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Which of a site's numbers is expanded beneath it. */
type ExpandMetric = 'unassigned' | 'rca' | 'overdue';

/**
 * Why a resolved snag is sitting in an outstanding list.
 *
 * The count is right — an RCA is owed on a serious snag until one is accepted
 * or waived, and resolving it doesn't discharge that — but the row alone reads
 * as a bug in it. So each row says which of the two it is: still owed an
 * analysis on a finished investigation, or closed over an unfinished one, with
 * or without somebody's reason on the record. The last of those is the only one
 * that needs chasing, and it's the only one styled to be chased.
 */
function rcaOutstandingNote(row: RcaOutstandingRow): { note: string | null; noteWarn: boolean } {
  if (row.status !== 'resolved' || row.unmet_count === 0) return { note: null, noteWarn: false };
  const steps = `${row.unmet_count} step${row.unmet_count === 1 ? '' : 's'}`;
  return row.resolution_exception_reason
    ? { note: `Closed with ${steps} outstanding — ${row.resolution_exception_reason}`, noteWarn: false }
    : { note: `Closed with ${steps} outstanding · no reason recorded`, noteWarn: true };
}

export default function AdminDashboardScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { isWide } = useBreakpoint();

  const [org, setOrg] = useState<Organisation | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [siteBreakdown, setSiteBreakdown] = useState<SiteBreakdown[]>([]);
  // One-click assign — tapping a site's "Unassigned" count expands its
  // unassigned snags right there, each with an OwnerPicker that assigns
  // immediately (no staged-edit step, unlike ManageIssuePanel's own use of
  // the same picker).
  // Which site is expanded, and under which of its numbers. Was a bare site id
  // when Unassigned was the only figure you could open; the two alert numbers
  // were counts with nothing behind them, which is the thing being fixed.
  const [expanded, setExpanded] = useState<{ siteId: string; metric: ExpandMetric } | null>(null);
  const [unassignedBySite, setUnassignedBySite] = useState<Record<string, UnassignedSnag[]>>({});
  const [overdueBySite, setOverdueBySite] = useState<Record<string, OverdueActionRow[]>>({});
  const [rcaBySite, setRcaBySite] = useState<Record<string, RcaOutstandingRow[]>>({});
  const [siteAssigneesCache, setSiteAssigneesCache] = useState<Record<string, SiteAssignee[]>>({});
  const [assigningSnagId, setAssigningSnagId] = useState<string | null>(null);
  const [ownedOrgs, setOwnedOrgs] = useState<Membership[]>([]);
  const [togglingOrgId, setTogglingOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Distinguished from "no sites yet" — get_site_breakdown raises when the org
  // it's asked about isn't the caller's active org, and that used to surface as
  // an empty card on an org with three sites. See PRODUCT_REVIEW.md §3.4.
  const [breakdownError, setBreakdownError] = useState(false);
  // Who a serious report reaches, and who can act on it once it lands. These
  // are configuration facts with no home in the app: nothing told a manager
  // that every hazard in the organisation notifies one person, or that a site
  // has nobody able to run an investigation at it.
  const [incidentOwnerCount, setIncidentOwnerCount] = useState<number | null>(null);
  // Shown once, the first time someone opens this tab. It appears the day they
  // are promoted, with nothing to say what it is for.
  const [showManagerHint, setShowManagerHint] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [sitesDetail, setSitesDetail] = useState<SiteDetail[]>([]);

  const canManageWorkGroups = role === 'officer_admin' || role === 'supervisor';

  const sitesWithoutLead = sitesDetail.filter((s) => s.supervisorIds.length === 0).map((s) => s.name);
  const sitesWithoutDefaultOwner = sitesDetail.filter((s) => !s.defaultOwnerId).map((s) => s.name);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setUserId(user.id);
    setShowManagerHint(await shouldShowHint('managerTab', user.id));

    const { data } = await supabase
      .from('profiles')
      .select('*, organisation:organisations!profiles_org_id_fkey(id, name, industry, plan_tier, join_code, is_public, public_intake_site_id, created_at, is_active)')
      .eq('id', user.id)
      .single();

    if (data) {
      const profile = data as unknown as Profile;
      setOrg((profile.organisation as Organisation | undefined) ?? null);
      setRole(profile.role);
      setIsAdmin(profile.role === 'officer_admin');
    }

    // Every org this user administers, active or not — the only place
    // deactivated orgs remain visible/manageable.
    const memberships = await getMemberships();
    setOwnedOrgs(memberships.filter((m) => m.role === 'officer_admin'));

    // Drive the breakdown off the ACTIVE membership rather than
    // profiles.org_id. That column only mirrors the active org, while the RPC
    // compares against user_active_org — any drift between the two threw an
    // error the old code swallowed into an empty state.
    // This screen is only reachable via the Admin tab, already gated to
    // supervisor/officer_admin — no extra role check needed here.
    const activeOrgId = memberships.find((m) => m.is_active && m.org_active)?.org_id ?? null;
    if (activeOrgId) {
      const { data: rows, error } = await getSiteBreakdown(activeOrgId);
      setSiteBreakdown(rows);
      setBreakdownError(Boolean(error));

      // Independent of each other and of the breakdown above.
      const [owners, sites] = await Promise.all([
        getSeriousIncidentOwners(activeOrgId),
        getSitesWithDetail(),
      ]);
      setIncidentOwnerCount(owners.length);
      setSitesDetail(sites);
    }

    setLoading(false);
  }, []);

  // Tapping the same number again closes it; tapping a different one swaps,
  // rather than opening two panels under one row.
  async function toggleExpand(siteId: string, metric: ExpandMetric) {
    if (expanded?.siteId === siteId && expanded.metric === metric) { setExpanded(null); return; }
    setExpanded({ siteId, metric });

    if (metric === 'unassigned') {
      if (!unassignedBySite[siteId]) {
        const snags = await getUnassignedSnags(siteId);
        setUnassignedBySite((prev) => ({ ...prev, [siteId]: snags }));
      }
      if (!siteAssigneesCache[siteId]) {
        const { data } = await getSiteAssignees(siteId);
        setSiteAssigneesCache((prev) => ({ ...prev, [siteId]: data }));
      }
      return;
    }
    if (metric === 'overdue' && !overdueBySite[siteId]) {
      const rows = await getOverdueActions(siteId);
      setOverdueBySite((prev) => ({ ...prev, [siteId]: rows }));
      return;
    }
    if (metric === 'rca' && !rcaBySite[siteId]) {
      const rows = await getRcaOutstanding(siteId);
      setRcaBySite((prev) => ({ ...prev, [siteId]: rows }));
    }
  }

  async function handleQuickAssign(siteId: string, snagId: string, ownerId: string) {
    setAssigningSnagId(snagId);
    const { error } = await assignSnagOwner(snagId, ownerId);
    setAssigningSnagId(null);
    if (error) {
      showAlert('Error', error.message ?? 'Could not assign this snag');
      return;
    }
    setUnassignedBySite((prev) => ({ ...prev, [siteId]: prev[siteId].filter((s) => s.id !== snagId) }));
    const memberships = await getMemberships();
    const activeOrgId = memberships.find((m) => m.is_active && m.org_active)?.org_id ?? null;
    if (activeOrgId) {
      const { data: rows, error } = await getSiteBreakdown(activeOrgId);
      if (!error) setSiteBreakdown(rows);
    }
  }

  function handleToggleActive(m: Membership) {
    const deactivating = m.org_active;
    showAlert(
      deactivating ? 'Deactivate organisation?' : 'Reactivate organisation?',
      deactivating
        ? `${m.org_name} will be hidden from every member's org switcher, and they won't be able to view or submit snags there until you reactivate it.`
        : `${m.org_name} will be visible again and members will be able to switch to it, view, and submit snags.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: deactivating ? 'Deactivate' : 'Reactivate',
          style: deactivating ? 'destructive' : 'default',
          onPress: async () => {
            setTogglingOrgId(m.org_id);
            const { error } = await setOrganisationActive(m.org_id, !deactivating);
            setTogglingOrgId(null);
            if (error) {
              showAlert('Error', error.message ?? 'Could not update organisation status');
            } else {
              await load();
            }
          },
        },
      ]
    );
  }

  // Reload on focus — the org this dashboard reflects is the active org, which
  // may have changed via the Profile switcher or a QR scan.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <OrgSwitcherHeader title="Admin" role={role} orgName={org?.name ?? null} onSwitched={load} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* Outstanding work — open investigations, unassigned reports, and
            overdue corrective actions, by site. The full org-wide status/
            type/severity breakdown still lives on Reports; this is the
            site-scoped complement, not a replacement. */}
        {showManagerHint && (
          <Card variant="elevated" style={styles.hintCard}>
            <View style={styles.hintHeader}>
              <Icon name="information-circle-outline" size="md" color={Colors.primary} />
              <Text style={styles.hintTitle}>This is the Manager tab</Text>
            </View>
            <Text style={styles.hintBody}>
              Outstanding work by site, so nothing sits waiting on somebody who doesn&apos;t know it&apos;s
              theirs. Tap any number to see what it counts. Cover below shows who a serious report
              reaches and who can act on it once it lands.
            </Text>
            <Button
              label="Got it"
              variant="outline"
              onPress={() => { setShowManagerHint(false); markHintSeen('managerTab', userId); }}
            />
          </Card>
        )}

        <Card variant="elevated" style={styles.breakdownCard}>
          <Text style={styles.sectionLabel}>OUTSTANDING WORK</Text>
          {breakdownError ? (
            <View style={styles.errorRow}>
              <Icon name="alert-circle-outline" size="sm" color={Colors.danger} />
              <Text style={styles.errorText}>
                Couldn&apos;t load outstanding work. Pull down to try again.
              </Text>
            </View>
          ) : siteBreakdown.length === 0 ? (
            <Text style={styles.hintMuted}>No sites yet.</Text>
          ) : isWide ? (
            <View style={styles.siteTable}>
              <View style={styles.siteTableHeaderRow}>
                <Text style={[styles.siteTableHeaderCell, styles.siteNameCol]}>Site</Text>
                <Text style={styles.siteTableHeaderCell}>Open investigations</Text>
                <Text style={styles.siteTableHeaderCell}>Unassigned</Text>
                <Text style={styles.siteTableHeaderCell}>RCA outstanding</Text>
                <Text style={styles.siteTableHeaderCell}>Overdue actions</Text>
              </View>
              {siteBreakdown.map((s) => (
                <React.Fragment key={s.siteId}>
                  <View style={styles.siteTableRow}>
                    <Text style={[styles.siteTableCell, styles.siteNameCol, styles.siteNameCellText]} numberOfLines={1}>
                      {s.siteName}
                    </Text>
                    <SiteCountCell value={s.openInvestigations} />
                    <SiteCountCell
                      value={s.unassigned}
                      onPress={s.unassigned > 0 ? () => toggleExpand(s.siteId, 'unassigned') : undefined}
                    />
                    <SiteCountCell
                      value={s.rcaOutstanding}
                      alert
                      onPress={s.rcaOutstanding > 0 ? () => toggleExpand(s.siteId, 'rca') : undefined}
                    />
                    <SiteCountCell
                      value={s.overdueActions}
                      alert
                      onPress={s.overdueActions > 0 ? () => toggleExpand(s.siteId, 'overdue') : undefined}
                    />
                  </View>
                  {expanded?.siteId === s.siteId && expanded.metric === 'unassigned' && (
                    <UnassignedQuickAssign
                      siteId={s.siteId}
                      snags={unassignedBySite[s.siteId] ?? []}
                      assignees={siteAssigneesCache[s.siteId] ?? []}
                      assigningSnagId={assigningSnagId}
                      onAssign={handleQuickAssign}
                    />
                  )}
                  {expanded?.siteId === s.siteId && expanded.metric === 'rca' && (
                    <OutstandingList
                      rows={(rcaBySite[s.siteId] ?? []).map((r) => ({
                        key: r.snag_id, snagId: r.snag_id, reference: r.reference,
                        detail: r.description ?? 'No description',
                        ...rcaOutstandingNote(r),
                      }))}
                      emptyLabel="No RCAs outstanding at this site."
                      onOpen={(snagId) => navigation.navigate('IssueDetail', { issueId: snagId, step: 'rca' })}
                    />
                  )}
                  {expanded?.siteId === s.siteId && expanded.metric === 'overdue' && (
                    <OutstandingList
                      rows={(overdueBySite[s.siteId] ?? []).map((r) => ({
                        key: r.action_id, snagId: r.snag_id, reference: r.reference,
                        detail: `${r.action_description} · due ${r.due_date}`,
                      }))}
                      emptyLabel="No overdue actions at this site."
                      onOpen={(snagId) => navigation.navigate('IssueDetail', { issueId: snagId, step: 'correctiveActions' })}
                    />
                  )}
                </React.Fragment>
              ))}
            </View>
          ) : (
            siteBreakdown.map((s) => (
              <React.Fragment key={s.siteId}>
                <View style={styles.siteCardMobile}>
                  <Text style={styles.siteNameCellText}>{s.siteName}</Text>
                  <View style={styles.siteStatRow}>
                    <SiteStat label="Open investigations" value={s.openInvestigations} />
                    <SiteStat
                      label="Unassigned"
                      value={s.unassigned}
                      onPress={s.unassigned > 0 ? () => toggleExpand(s.siteId, 'unassigned') : undefined}
                    />
                    <SiteStat
                      label="RCA outstanding"
                      value={s.rcaOutstanding}
                      alert
                      onPress={s.rcaOutstanding > 0 ? () => toggleExpand(s.siteId, 'rca') : undefined}
                    />
                    <SiteStat
                      label="Overdue actions"
                      value={s.overdueActions}
                      alert
                      onPress={s.overdueActions > 0 ? () => toggleExpand(s.siteId, 'overdue') : undefined}
                    />
                  </View>
                  {expanded?.siteId === s.siteId && expanded.metric === 'unassigned' && (
                    <UnassignedQuickAssign
                      siteId={s.siteId}
                      snags={unassignedBySite[s.siteId] ?? []}
                      assignees={siteAssigneesCache[s.siteId] ?? []}
                      assigningSnagId={assigningSnagId}
                      onAssign={handleQuickAssign}
                    />
                  )}
                  {expanded?.siteId === s.siteId && expanded.metric === 'rca' && (
                    <OutstandingList
                      rows={(rcaBySite[s.siteId] ?? []).map((r) => ({
                        key: r.snag_id, snagId: r.snag_id, reference: r.reference,
                        detail: r.description ?? 'No description',
                        ...rcaOutstandingNote(r),
                      }))}
                      emptyLabel="No RCAs outstanding at this site."
                      onOpen={(snagId) => navigation.navigate('IssueDetail', { issueId: snagId, step: 'rca' })}
                    />
                  )}
                  {expanded?.siteId === s.siteId && expanded.metric === 'overdue' && (
                    <OutstandingList
                      rows={(overdueBySite[s.siteId] ?? []).map((r) => ({
                        key: r.action_id, snagId: r.snag_id, reference: r.reference,
                        detail: `${r.action_description} · due ${r.due_date}`,
                      }))}
                      emptyLabel="No overdue actions at this site."
                      onOpen={(snagId) => navigation.navigate('IssueDetail', { issueId: snagId, step: 'correctiveActions' })}
                    />
                  )}
                </View>
              </React.Fragment>
            ))
          )}
        </Card>

        {/* Cover — who a serious report reaches, and who can act on it.
            Read-only: every fix lives on a Manage screen, and putting the
            controls here would be a third place to change the same thing. */}
        {incidentOwnerCount !== null && (
          <Card variant="elevated" style={styles.breakdownCard}>
            <Text style={styles.sectionLabel}>COVER</Text>

            <CoverRow
              label="Serious incident owners"
              value={String(incidentOwnerCount)}
              // One is the minimum the server allows, and it means every hazard
              // and incident in the organisation notifies one person and is
              // assigned to them by default. If they are away, a serious report
              // lands nowhere anybody is watching.
              warn={incidentOwnerCount <= 1}
              hint={incidentOwnerCount <= 1 ? 'Every serious report goes to one person' : undefined}
              onPress={isAdmin ? () => navigation.navigate('ManageOrganisation') : undefined}
            />

            <CoverRow
              label="Sites with no site lead"
              value={String(sitesWithoutLead.length)}
              // can_edit_site is what triage, assignment and the investigation
              // writes require, and it needs a real site_supervisors row. A site
              // with none has nobody who can run an investigation at it.
              warn={sitesWithoutLead.length > 0}
              hint={sitesWithoutLead.length > 0 ? sitesWithoutLead.join(', ') : undefined}
              onPress={isAdmin ? () => navigation.navigate('ManageSites') : undefined}
            />

            <CoverRow
              label="Sites with no default owner"
              value={String(sitesWithoutDefaultOwner.length)}
              // Not an alert: apply_default_owner still names the earliest
              // serious incident owner, so nothing arrives ownerless on the
              // serious lane. It does mean niggles land unassigned.
              hint={sitesWithoutDefaultOwner.length > 0 ? sitesWithoutDefaultOwner.join(', ') : undefined}
              onPress={isAdmin ? () => navigation.navigate('ManageSites') : undefined}
            />

            {org?.is_public && (
              <CoverRow
                label="Public reporting"
                value="On"
                hint="Anyone with a site QR code can file a report"
                onPress={isAdmin ? () => navigation.navigate('ManageOrganisation') : undefined}
              />
            )}
          </Card>
        )}

        {/* Actions */}
        {isAdmin && (
          <>
            <Button
              label="Manage Organisation"
              icon="business-outline"
              onPress={() => navigation.navigate('ManageOrganisation')}
              fullWidth
            />
            <Button
              label="Manage Sites"
              variant="outline"
              icon="location-outline"
              onPress={() => navigation.navigate('ManageSites')}
              fullWidth
            />
          </>
        )}
        {canManageWorkGroups && (
          <Button
            label="Manage Work Groups"
            variant="outline"
            icon="people-circle-outline"
            onPress={() => navigation.navigate('ManageWorkGroups')}
            fullWidth
          />
        )}
        <Button
          label="View Reports"
          variant="outline"
          icon="bar-chart-outline"
          onPress={() => navigation.navigate('Reports')}
          fullWidth
        />

        {!isAdmin && (
          <View style={styles.noteRow}>
            <Icon name="information-circle-outline" size="sm" color={Colors.textMuted} />
            <Text style={styles.noteText}>
              Organisation settings and sites are managed by a manager.
            </Text>
          </View>
        )}

        {/* Owned organisations, active or not — the only place a deactivated
            org stays visible and manageable. */}
        {ownedOrgs.length > 0 && (
          <Card variant="elevated" style={styles.ownedCard}>
            <Text style={styles.sectionLabel}>YOUR ORGANISATIONS</Text>
            {ownedOrgs.map((m) => (
              <View key={m.org_id} style={styles.ownedRow}>
                <View style={styles.ownedRowText}>
                  <View style={styles.ownedRowNameRow}>
                    <Text style={styles.ownedRowName}>{m.org_name}</Text>
                    {m.org_id === org?.id && <Text style={styles.ownedRowCurrent}>Current</Text>}
                  </View>
                  <View style={[styles.statusPill, m.org_active ? styles.statusPillActive : styles.statusPillInactive]}>
                    <Text style={[styles.statusPillText, m.org_active ? styles.statusPillTextActive : styles.statusPillTextInactive]}>
                      {m.org_active ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                </View>
                {togglingOrgId === m.org_id ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <Button
                    label={m.org_active ? 'Deactivate' : 'Reactivate'}
                    variant={m.org_active ? 'dangerOutline' : 'outline'}
                    onPress={() => handleToggleActive(m)}
                  />
                )}
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

// Tappable variants get a MIN_TOUCH_TARGET-high hit area — the number alone is
// well under the 48px the design system mandates.
// A site's outstanding work, listed under the number that counts it. Rows are
// read-only and open the snag at the step that owes the work — unlike the
// Unassigned expander, which assigns in place, because "who owns this" is one
// tap and "why is this RCA outstanding" is not.
// One configuration fact, with the gap named rather than left as a number to
// interpret. Tappable only for an admin, since only an admin can fix any of
// them — a row that navigates to a screen you can't act on is worse than a
// static one.
function CoverRow({
  label, value, warn, hint, onPress,
}: {
  label: string;
  value: string;
  warn?: boolean;
  hint?: string;
  onPress?: () => void;
}) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={styles.coverRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.coverText}>
        <Text style={styles.coverLabel}>{label}</Text>
        {hint && <Text style={[styles.coverHint, warn && styles.coverHintWarn]} numberOfLines={2}>{hint}</Text>}
      </View>
      <Text style={[styles.coverValue, warn && styles.coverValueWarn]}>{value}</Text>
      {onPress && <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />}
    </Wrapper>
  );
}

function OutstandingList({
  rows, emptyLabel, onOpen,
}: {
  rows: {
    key: string; snagId: string; reference: string; detail: string;
    /** A second line under the detail — why a row that looks finished isn't. */
    note?: string | null;
    /** Warn styling for the one case that needs chasing rather than reading. */
    noteWarn?: boolean;
  }[];
  emptyLabel: string;
  onOpen: (snagId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <View style={styles.outstandingWrap}>
        <Text style={styles.outstandingEmpty}>{emptyLabel}</Text>
      </View>
    );
  }
  return (
    <View style={styles.outstandingWrap}>
      {rows.map((r) => (
        <TouchableOpacity
          key={r.key}
          style={styles.outstandingRow}
          onPress={() => onOpen(r.snagId)}
          activeOpacity={0.7}
        >
          <View style={styles.outstandingText}>
            <Text style={styles.outstandingRef}>{r.reference}</Text>
            <Text style={styles.outstandingDetail} numberOfLines={2}>{r.detail}</Text>
            {r.note && (
              <Text
                style={[styles.outstandingNote, r.noteWarn && styles.outstandingNoteWarn]}
                numberOfLines={2}
              >
                {r.note}
              </Text>
            )}
          </View>
          <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function SiteCountCell({ value, alert, onPress }: { value: number; alert?: boolean; onPress?: () => void }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      style={[styles.siteTableCell, onPress && styles.tappableCell]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <Text style={[styles.siteCountText, alert && value > 0 && styles.siteCountTextAlert, onPress && styles.siteCountTextTappable]}>
        {value}
      </Text>
    </Wrapper>
  );
}

function SiteStat({ label, value, alert, onPress }: { label: string; value: number; alert?: boolean; onPress?: () => void }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      style={styles.siteStat}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <Text style={[styles.siteCountText, alert && value > 0 && styles.siteCountTextAlert, onPress && styles.siteCountTextTappable]}>
        {value}
      </Text>
      <Text style={styles.siteStatLabel}>{label}</Text>
    </Wrapper>
  );
}

// One-click assign — the list of a site's unassigned snags, each with an
// inline OwnerPicker that assigns immediately on tap (no staged-edit step).
function UnassignedQuickAssign({
  siteId, snags, assignees, assigningSnagId, onAssign,
}: {
  siteId: string;
  snags: UnassignedSnag[];
  assignees: SiteAssignee[];
  assigningSnagId: string | null;
  onAssign: (siteId: string, snagId: string, ownerId: string) => void;
}) {
  if (snags.length === 0) {
    return <Text style={styles.hintMuted}>Nothing unassigned here right now.</Text>;
  }
  return (
    <View style={styles.quickAssignBlock}>
      {snags.map((snag) => (
        <View key={snag.id} style={styles.quickAssignRow}>
          <Text style={styles.quickAssignDescription} numberOfLines={1}>
            {snag.reference} · {snag.description || 'No description'}
          </Text>
          {assigningSnagId === snag.id ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <OwnerPicker
              assignees={assignees}
              currentOwnerId={null}
              allowUnassign={false}
              onSelect={(ownerId) => { if (ownerId) onAssign(siteId, snag.id, ownerId); }}
            />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },

  scroll: { padding: Spacing.lg, gap: Spacing.lg },

  breakdownCard: { gap: Spacing.sm },
  sectionLabel: { fontSize: Typography.xs, fontWeight: Typography.bold, color: Colors.textMuted, letterSpacing: 0.8 },

  // Outstanding-work site breakdown — table layout on wide (web/tablet)
  // viewports, stacked cards on phone width. First responsive layout in
  // the app; see useBreakpoint.
  siteTable: { gap: 2 },
  siteTableHeaderRow: { flexDirection: 'row', paddingBottom: Spacing.xs, borderBottomWidth: 1, borderBottomColor: Colors.border },
  siteTableHeaderCell: { flex: 1, fontSize: Typography.xs, fontWeight: Typography.bold, color: Colors.textMuted, textAlign: 'center' },
  siteTableRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  siteTableCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  siteNameCol: { flex: 1.4, textAlign: 'left' },
  siteNameCellText: { fontSize: Typography.base, fontWeight: Typography.medium, color: Colors.textPrimary },

  siteCardMobile: {
    gap: Spacing.sm, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  // Four stats on a narrow phone: a fixed two-column grid rather than
  // content-width items with a gap. Sized items wrapped into ragged columns
  // whose numbers and labels lined up with nothing above or below them.
  siteStatRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.md },
  siteStat: {
    width: '50%',
    paddingRight: Spacing.md,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: 2,
    // On every stat, not just the tappable ones: the touch target is what set
    // the row height, so giving it to one item pushed that number and its
    // label off the baseline its neighbours sat on.
    minHeight: MIN_TOUCH_TARGET,
  },
  siteStatLabel: { fontSize: Typography.xs, color: Colors.textMuted },
  hintCard: { gap: Spacing.sm },
  hintHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  hintTitle: {
    flex: 1,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  hintBody: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  coverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  coverText: {
    flex: 1,
    gap: 2,
  },
  coverLabel: {
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  coverHint: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
  },
  coverHintWarn: {
    color: Colors.serious,
  },
  coverValue: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  coverValueWarn: {
    color: Colors.serious,
  },
  outstandingWrap: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingVertical: Spacing.xs,
  },
  outstandingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  outstandingText: {
    flex: 1,
    gap: 2,
  },
  outstandingRef: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  outstandingDetail: {
    fontSize: Typography.sm,
    color: Colors.textPrimary,
  },
  outstandingNote: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  outstandingNoteWarn: {
    color: Colors.serious,
  },
  outstandingEmpty: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  tappableCell: { minHeight: MIN_TOUCH_TARGET },
  siteCountText: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  siteCountTextAlert: { color: Colors.danger },
  siteCountTextTappable: { color: Colors.primary, textDecorationLine: 'underline' },

  quickAssignBlock: { gap: Spacing.sm, paddingVertical: Spacing.sm, paddingLeft: Spacing.sm },
  quickAssignRow: { gap: Spacing.xs },
  quickAssignDescription: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textPrimary },

  noteRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', paddingHorizontal: Spacing.xs },
  noteText: { flex: 1, fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 18 },

  ownedCard: { gap: Spacing.md },
  ownedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  ownedRowText: { flex: 1, gap: Spacing.xs },
  ownedRowNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ownedRowName: { fontSize: Typography.base, fontWeight: Typography.medium, color: Colors.textPrimary },
  ownedRowCurrent: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.primary,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  statusPillActive: { backgroundColor: Colors.successBg },
  statusPillInactive: { backgroundColor: Colors.priority.mediumBg },
  statusPillText: { fontSize: Typography.xs, fontWeight: Typography.semibold },
  statusPillTextActive: { color: Colors.success },
  statusPillTextInactive: { color: Colors.priority.medium },

  hintMuted: { fontSize: Typography.sm, color: Colors.textMuted, fontStyle: 'italic' },

  errorRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  errorText: { flex: 1, fontSize: Typography.sm, color: Colors.danger, lineHeight: 18 },
});
