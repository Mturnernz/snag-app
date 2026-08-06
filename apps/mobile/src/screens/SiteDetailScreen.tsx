import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';

import { Profile, Organisation, RootStackParamList, ROLE_LABELS } from '../types';
import {
  supabase,
  getOrgMembers,
  getSitesWithDetail,
  getWorkGroupsWithDetail,
  getSiteSnagCount,
  updateSite,
  archiveSite,
  deleteSite,
  addSiteMember,
  removeSiteMember,
  assignSiteSupervisor,
  removeSiteSupervisor,
  setSiteDefaultOwner,
  setSitePublicIntake,
  setOrgPublicMode,
  SiteDetail as SiteDetailRow,
  WorkGroupDetail,
} from '../lib/supabase';

// The QR always encodes the web export's URL, so it works with or without the
// native app installed; see PublicQrReportScreen.tsx / App.tsx for the landing
// side of this link. The host lives in one place because these codes get
// printed — see lib/appUrl.
import { APP_URL } from '../lib/appUrl';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../hooks/useToast';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'SiteDetail'>;

// Everything about one site, in the order somebody sets a site up: name it,
// staff it, decide whether the public can report into it, then see which teams
// its snags can be routed to.
//
// Before this screen the same four things lived on three screens — the QR on
// Manage Sites, the switch that makes the QR work on Manage Organisation, and
// the site's work groups on Manage Work Groups, which also had its own "+ New
// site" box. The point of gathering them is not tidiness: a site now has an
// address, which is what lets the admin dashboard link to the site that has no
// Site Lead instead of to a list.
export default function SiteDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { siteId } = useRoute<Route>().params;
  const { showToast } = useToast();

  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [org, setOrg] = useState<Organisation | null>(null);
  const [site, setSite] = useState<SiteDetailRow | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [workGroups, setWorkGroups] = useState<WorkGroupDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Details
  const [editingDetails, setEditingDetails] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [locationDraft, setLocationDraft] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // People
  const [busyPerson, setBusyPerson] = useState<string | null>(null);

  // Public reporting
  const [togglingQr, setTogglingQr] = useState(false);
  const [savingPublicMode, setSavingPublicMode] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);

  // Retiring the site. `snagCount` decides which of the two verbs is even
  // offered — see the danger zone below.
  const [snagCount, setSnagCount] = useState<number | null>(null);
  const [retiring, setRetiring] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('profiles')
      .select('*, organisation:organisations!profiles_org_id_fkey(id, name, is_public, public_intake_site_id)')
      .eq('id', user.id)
      .single();

    if (data) {
      const profile = data as unknown as Profile;
      setCurrentUser(profile);
      setOrg((profile.organisation as Organisation | undefined) ?? null);

      if (profile.org_id) {
        const [sites, orgMembers, groups, count] = await Promise.all([
          getSitesWithDetail(),
          getOrgMembers(profile.org_id),
          getWorkGroupsWithDetail(),
          getSiteSnagCount(siteId),
        ]);
        const found = sites.find((s) => s.id === siteId) ?? null;
        setSite(found);
        setMembers(orgMembers);
        setWorkGroups(groups);
        setSnagCount(count);
        if (found) {
          setNameDraft(found.name);
          setLocationDraft(found.location ?? '');
        }
      }
    }
    setLoading(false);
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Re-reads every site and keeps this one. The people RPCs return nothing
  // useful, and assign_site_supervisor writes a site_members row too (see
  // 20260801120000_supervising_implies_membership.sql) — so a toggle can change
  // a row the caller didn't touch, and re-reading is the only honest refresh.
  async function refreshSite() {
    const sites = await getSitesWithDetail();
    setSite(sites.find((s) => s.id === siteId) ?? null);
  }

  async function handleSaveDetails() {
    if (!site || !nameDraft.trim()) return;
    setSavingDetails(true);
    const { error } = await updateSite(site.id, nameDraft.trim(), locationDraft.trim() || null);
    setSavingDetails(false);
    if (error) {
      showToast(error.message ?? 'Could not update this site');
      return;
    }
    setEditingDetails(false);
    showToast('Site updated');
    await refreshSite();
  }

  async function runPersonAction(key: string, fn: () => PromiseLike<{ error: any }>) {
    setBusyPerson(key);
    const { error } = await fn();
    if (error) showToast(error.message ?? 'Could not update this site');
    await refreshSite();
    setBusyPerson(null);
  }

  async function handleToggleQr(enable: boolean) {
    if (!site) return;
    setTogglingQr(true);
    const { error } = await setSitePublicIntake(site.id, enable);
    setTogglingQr(false);
    if (error) {
      showToast(error.message ?? 'Could not update the site QR code');
      return;
    }
    await refreshSite();
    showToast(enable ? 'Public QR enabled — any code already printed for this site stops working' : 'Public QR disabled');
  }

  // The org-wide switch, offered here because a site's QR does nothing without
  // it. Manage → Organisation is still where it lives; this is the same call,
  // reachable from the place that made you want it. Turning it on from here
  // targets this site, which is the site the reader is looking at.
  async function handleEnableOrgPublic() {
    setSavingPublicMode(true);
    const { error } = await setOrgPublicMode(true, org?.public_intake_site_id ?? siteId);
    setSavingPublicMode(false);
    if (error) {
      showToast(error.message ?? 'Could not turn on public reports');
      return;
    }
    showToast('Now accepting public reports');
    await load();
  }

  async function handleArchive(archived: boolean) {
    if (!site) return;
    setConfirmArchive(false);
    setRetiring(true);
    const { error } = await archiveSite(site.id, archived);
    setRetiring(false);
    if (error) {
      // Includes the last-active-site refusal, whose message names the fix.
      showToast(error.message ?? 'Could not archive this site');
      return;
    }
    showToast(archived ? `${site.name} archived` : `${site.name} restored`);
    await load();
  }

  async function handleDelete() {
    if (!site) return;
    setConfirmDelete(false);
    setRetiring(true);
    const { error } = await deleteSite(site.id);
    setRetiring(false);
    if (error) {
      showToast(error.message ?? 'Could not delete this site');
      return;
    }
    showToast(`${site.name} deleted`);
    // The site this screen is about no longer exists, so there is nothing to
    // reload into — go back to the list rather than render a "not found".
    navigation.goBack();
  }

  async function handleCopyLink() {
    if (!site?.publicReportToken) return;
    await Clipboard.setStringAsync(`${APP_URL}/?report=${site.publicReportToken}`);
    showToast('Link copied');
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Site" />
        <View style={styles.centre}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </View>
    );
  }

  const isAdmin = currentUser?.role === 'officer_admin';

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Site" />
        <View style={styles.centre}>
          <EmptyState
            icon="lock-closed-outline"
            title="Managers only"
            message="Only an organisation manager can change a site's setup."
          />
        </View>
      </View>
    );
  }

  if (!site) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Site" />
        <View style={styles.centre}>
          <EmptyState
            icon="location-outline"
            title="Site not found"
            message="It may have been removed, or it belongs to another organisation."
          />
        </View>
      </View>
    );
  }

  const sortedMembers = [...members].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  const link = site.publicReportToken ? `${APP_URL}/?report=${site.publicReportToken}` : null;
  const orgIsPublic = !!org?.is_public;
  const isArchived = !!site.archivedAt;

  // Empty siteIds means the group applies everywhere — see SiteMultiSelect's
  // "All sites", which clears the selection rather than naming every site.
  const groupsHere = workGroups.filter(
    (g) => !g.isDefault && (g.siteIds.length === 0 || g.siteIds.includes(site.id))
  );

  return (
    <View style={styles.container}>
      <ScreenHeader title={site.name} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        {isArchived && (
          <Card variant="elevated" style={styles.archivedBanner}>
            <Icon name="archive-outline" size="md" color={Colors.textSecondary} />
            <Text style={styles.archivedText}>
              This site is archived. It takes no new reports, and its people and public QR are
              inactive — everything already filed here is untouched.
            </Text>
          </Card>
        )}

        {/* ── Details ─────────────────────────────────────────────────────── */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.sectionLabel}>DETAILS</Text>
          {editingDetails ? (
            <>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                style={styles.input}
                value={nameDraft}
                onChangeText={setNameDraft}
                autoFocus
                placeholder="Site name"
                placeholderTextColor={Colors.textMuted}
              />
              <Text style={styles.fieldLabel}>Location</Text>
              <TextInput
                style={styles.input}
                value={locationDraft}
                onChangeText={setLocationDraft}
                placeholder="e.g. 12 Kaiwharawhara Rd"
                placeholderTextColor={Colors.textMuted}
              />
              <View style={styles.rowButtons}>
                <Button
                  label="Cancel"
                  variant="outline"
                  onPress={() => {
                    setNameDraft(site.name);
                    setLocationDraft(site.location ?? '');
                    setEditingDetails(false);
                  }}
                  style={styles.flex1}
                />
                <Button
                  label="Save"
                  onPress={handleSaveDetails}
                  loading={savingDetails}
                  disabled={!nameDraft.trim()}
                  style={styles.flex1}
                />
              </View>
            </>
          ) : (
            <View style={styles.detailsRow}>
              <Icon name="location-outline" size="md" color={Colors.primary} />
              <View style={styles.detailsText}>
                <Text style={styles.detailsName} numberOfLines={2}>{site.name}</Text>
                <Text style={styles.detailsMeta} numberOfLines={2}>
                  {site.location || 'No location set'}
                </Text>
              </View>
              <TouchableOpacity style={styles.editButton} onPress={() => setEditingDetails(true)} hitSlop={8}>
                <Icon name="create-outline" size="md" color={Colors.primary} />
              </TouchableOpacity>
            </View>
          )}
        </Card>

        {/* ── People ──────────────────────────────────────────────────────── */}
        <Card variant="elevated" style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>PEOPLE</Text>
            <Text style={styles.sectionCount}>
              {site.memberIds.length} member{site.memberIds.length !== 1 ? 's' : ''}
              {' · '}
              {site.supervisorIds.length} Site Lead{site.supervisorIds.length !== 1 ? 's' : ''}
            </Text>
          </View>
          <Text style={styles.hint}>
            Members can report into this site. Site Leads oversee it — and can run an investigation
            here, which nobody else at the site can. The default owner is auto-assigned new snags.
          </Text>

          {site.supervisorIds.length === 0 && (
            <View style={styles.warnRow}>
              <Icon name="warning-outline" size="sm" color={Colors.serious} />
              <Text style={styles.warnText}>
                No Site Lead — only a Manager can triage a serious report or run an investigation
                here.
              </Text>
            </View>
          )}

          {sortedMembers.map((m) => {
            const isMember = site.memberIds.includes(m.id);
            const isLead = site.supervisorIds.includes(m.id);
            const isOwner = site.defaultOwnerId === m.id;
            return (
              <View key={m.id} style={styles.personRow}>
                <View style={styles.personInfo}>
                  <Text style={styles.personName} numberOfLines={1}>{m.name || m.email}</Text>
                  <Text style={styles.personRole}>{ROLE_LABELS[m.role]}</Text>
                </View>
                <View style={styles.personActions}>
                  <AssignToggle
                    label="Member"
                    active={isMember}
                    busy={busyPerson === `mem-${m.id}`}
                    onPress={() => runPersonAction(
                      `mem-${m.id}`,
                      () => isMember ? removeSiteMember(site.id, m.id) : addSiteMember(site.id, m.id)
                    )}
                  />
                  <AssignToggle
                    label="Site Lead"
                    active={isLead}
                    busy={busyPerson === `sup-${m.id}`}
                    onPress={() => runPersonAction(
                      `sup-${m.id}`,
                      () => isLead ? removeSiteSupervisor(site.id, m.id) : assignSiteSupervisor(site.id, m.id)
                    )}
                  />
                  <AssignToggle
                    label="Owner"
                    active={isOwner}
                    busy={busyPerson === `own-${m.id}`}
                    onPress={() => !isOwner && runPersonAction(`own-${m.id}`, () => setSiteDefaultOwner(site.id, m.id))}
                  />
                </View>
              </View>
            );
          })}

          {sortedMembers.length === 0 && (
            <Text style={styles.hintMuted}>No members in this organisation yet.</Text>
          )}
        </Card>

        {/* ── Public reporting ────────────────────────────────────────────── */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.sectionLabel}>PUBLIC REPORTING</Text>

          {/* Archiving clears the token, so the only way to reach a live QR on
              a closed site is to switch one on here afterwards. That code would
              scan fine and fail at submit — the snags trigger refuses an
              archived site — i.e. after somebody has taken a photo and typed a
              description. Note set_site_public_intake itself does not check
              archived_at, so this is the control being withheld rather than the
              server refusing it. */}
          {isArchived ? (
            <Text style={styles.hint}>
              Unavailable while this site is archived — it accepts no reports, public or otherwise.
              Restore it first if you need a QR code here again.
            </Text>
          ) : !orgIsPublic ? (
            <>
              <Text style={styles.hint}>
                A site QR code only works while {org?.name ?? 'your organisation'} is accepting public
                reports. That switch is organisation-wide and lives on Manage → Organisation — you can
                turn it on from here.
              </Text>
              <Button
                label="Accept public reports"
                variant="outline"
                icon="globe-outline"
                onPress={handleEnableOrgPublic}
                loading={savingPublicMode}
                fullWidth
              />
            </>
          ) : link ? (
            <>
              <Text style={styles.hint}>
                Anyone who scans this lands straight on a report form for {site.name} — no account
                needed. Regenerate it to invalidate anything already printed or shared.
              </Text>
              <View style={styles.qrWrap}>
                <QRCode value={link} size={180} />
              </View>
              <TouchableOpacity style={styles.codeRow} onPress={handleCopyLink} activeOpacity={0.7}>
                <Text style={styles.codeText} numberOfLines={1}>{link}</Text>
                <Icon name="copy-outline" size="md" color={Colors.primary} />
              </TouchableOpacity>
              <Button
                label="Regenerate"
                variant="outline"
                onPress={() => setConfirmRotate(true)}
                loading={togglingQr}
                fullWidth
              />
              <Button
                label="Disable Public QR"
                variant="dangerOutline"
                onPress={() => setConfirmDisable(true)}
                loading={togglingQr}
                fullWidth
                style={styles.topGap}
              />
            </>
          ) : (
            <>
              <Text style={styles.hint}>
                Generate a QR code that lets anyone report straight into {site.name} with no account —
                good for a poster at the site entrance.
              </Text>
              <Button label="Enable Public QR" onPress={() => handleToggleQr(true)} loading={togglingQr} fullWidth />
            </>
          )}
        </Card>

        {/* ── Work groups ─────────────────────────────────────────────────── */}
        <Card variant="elevated" style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>WORK GROUPS HERE</Text>
            <Text style={styles.sectionCount}>{groupsHere.length}</Text>
          </View>
          <Text style={styles.hint}>
            The teams a snag reported at {site.name} can be routed to.
          </Text>

          {groupsHere.map((g) => (
            <View key={g.id} style={styles.groupRow}>
              <View style={[styles.groupSwatch, { backgroundColor: g.color ?? Colors.textMuted }]} />
              <View style={styles.groupInfo}>
                <Text style={styles.groupName} numberOfLines={1}>{g.name}</Text>
                <Text style={styles.groupMeta}>
                  {g.siteIds.length === 0 ? 'All sites' : 'This site'}
                  {' · '}
                  {g.supervisorIds.length} Site Lead{g.supervisorIds.length !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>
          ))}

          {groupsHere.length === 0 && (
            <Text style={styles.hintMuted}>
              No work groups apply here — snags reported at {site.name} go straight to the queue.
            </Text>
          )}

          <Button
            label="Manage work groups"
            variant="outline"
            icon="people-circle-outline"
            onPress={() => navigation.navigate('Manage', { tab: 'teams' })}
            fullWidth
            style={styles.topGap}
          />
        </Card>

        {/* ── Retiring the site ───────────────────────────────────────────── */}
        {/* Two verbs, and which one is offered is decided by the data rather
            than by the reader. Deleting a site with snags on it is impossible,
            not merely unwise: the cascade hits the unconditional delete block
            on snags (golden rule #4) and aborts. So for a used site "delete"
            is not a stronger "archive" — it is an operation that cannot
            succeed, and offering it would only produce a baffling error about
            a table nobody mentioned. `delete_site` refuses it server-side with
            the count; this hides the button and says why. */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.sectionLabel}>RETIRE THIS SITE</Text>

          {isArchived ? (
            <>
              <Text style={styles.hint}>
                Archived{site.archivedAt ? ` on ${new Date(site.archivedAt).toLocaleDateString()}` : ''}.
                It takes no new reports and appears in no picker. Everything filed here is still on
                record, and still counts in Reports.
              </Text>
              <Button
                label="Restore this site"
                variant="outline"
                icon="refresh-outline"
                onPress={() => handleArchive(false)}
                loading={retiring}
                fullWidth
              />
            </>
          ) : (
            <>
              <Text style={styles.hint}>
                Archiving closes {site.name} to new reports and takes it out of every picker.
                {snagCount !== null && snagCount > 0
                  ? ` The ${snagCount} report${snagCount !== 1 ? 's' : ''} already filed here stay on record.`
                  : ''}
              </Text>
              <Button
                label="Archive this site"
                variant="outline"
                icon="archive-outline"
                onPress={() => setConfirmArchive(true)}
                loading={retiring}
                fullWidth
              />

              {snagCount === 0 ? (
                <>
                  <Text style={styles.hintMuted}>
                    Nothing has ever been reported here, so this site can also be deleted outright.
                  </Text>
                  <Button
                    label="Delete this site"
                    variant="dangerOutline"
                    icon="trash-outline"
                    onPress={() => setConfirmDelete(true)}
                    loading={retiring}
                    fullWidth
                  />
                </>
              ) : snagCount !== null ? (
                <Text style={styles.hintMuted}>
                  This site can't be deleted: {snagCount} report{snagCount !== 1 ? 's' : ''} would go
                  with it, along with every investigation, witness statement and piece of evidence on
                  them. Archive it instead.
                </Text>
              ) : null}
            </>
          )}
        </Card>
      </ScrollView>

      <ConfirmDialog
        visible={confirmRotate}
        title="Regenerate this QR code?"
        message={`Any poster or printed code for ${site.name} stops working immediately. You'll need to print the new one.`}
        confirmLabel="Regenerate"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => { setConfirmRotate(false); handleToggleQr(true); }}
        onCancel={() => setConfirmRotate(false)}
      />

      <ConfirmDialog
        visible={confirmDisable}
        title="Disable public reporting here?"
        message={`Nobody will be able to report into ${site.name} without an account, and any printed code stops working.`}
        confirmLabel="Disable"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => { setConfirmDisable(false); handleToggleQr(false); }}
        onCancel={() => setConfirmDisable(false)}
      />

      <ConfirmDialog
        visible={confirmArchive}
        title={`Archive ${site.name}?`}
        message={
          `It stops accepting reports and disappears from every picker. ` +
          (snagCount && snagCount > 0
            ? `The ${snagCount} report${snagCount !== 1 ? 's' : ''} already filed here stay on record and in Reports. `
            : '') +
          `Any printed QR code for this site stops working. You can restore it later.`
        }
        confirmLabel="Archive"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => handleArchive(true)}
        onCancel={() => setConfirmArchive(false)}
      />

      <ConfirmDialog
        visible={confirmDelete}
        title={`Delete ${site.name}?`}
        message={
          `This site has never had a report filed on it, so nothing is lost but the site itself — ` +
          `its members, Site Leads, default owner and work-group scoping go with it. This cannot be undone.`
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}

function AssignToggle({
  label, active, busy, onPress,
}: { label: string; active: boolean; busy: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.toggle, active && styles.toggleActive]}
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.7}
    >
      {busy ? (
        <ActivityIndicator size="small" color={active ? Colors.white : Colors.primary} />
      ) : (
        <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  scroll: { padding: Spacing.lg, gap: Spacing.lg },

  card: { gap: Spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { fontSize: Typography.xs, fontWeight: Typography.bold, color: Colors.textMuted, letterSpacing: 0.8 },
  sectionCount: { fontSize: Typography.xs, color: Colors.textMuted },
  fieldLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary, marginTop: Spacing.xs },
  hint: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 18 },
  hintMuted: { fontSize: Typography.sm, color: Colors.textMuted, fontStyle: 'italic' },
  topGap: { marginTop: Spacing.sm },
  flex1: { flex: 1 },
  rowButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },

  input: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },

  detailsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  detailsText: { flex: 1, gap: 2 },
  detailsName: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  detailsMeta: { fontSize: Typography.sm, color: Colors.textMuted },
  editButton: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center',
  },

  // Colors.serious, matching the admin dashboard's "Sites with no site lead"
  // cover row — the same fact, and it belongs to the serious lane rather than
  // to snag priority.
  warnRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.seriousBg, borderRadius: Radius.button, padding: Spacing.sm,
  },
  warnText: { flex: 1, fontSize: Typography.sm, color: Colors.seriousFg, lineHeight: 18 },

  personRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  personInfo: { flex: 1, gap: 2 },
  personName: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textPrimary },
  personRole: { fontSize: Typography.xs, color: Colors.textMuted },
  personActions: { flexDirection: 'row', gap: Spacing.xs },
  toggle: {
    minWidth: 60, height: 34, paddingHorizontal: Spacing.sm, borderRadius: Radius.button,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  toggleActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleText: { fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textSecondary },
  toggleTextActive: { color: Colors.white },

  qrWrap: { alignItems: 'center', paddingVertical: Spacing.md },
  codeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.background, borderRadius: Radius.button,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, marginBottom: Spacing.sm,
  },
  codeText: { flex: 1, fontSize: Typography.sm, color: Colors.textSecondary },

  archivedBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  archivedText: { flex: 1, fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 18 },

  groupRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xs },
  groupSwatch: { width: 32, height: 32, borderRadius: Radius.button },
  groupInfo: { flex: 1, gap: 2 },
  groupName: { fontSize: Typography.base, fontWeight: Typography.medium, color: Colors.textPrimary },
  groupMeta: { fontSize: Typography.xs, color: Colors.textMuted },
});
