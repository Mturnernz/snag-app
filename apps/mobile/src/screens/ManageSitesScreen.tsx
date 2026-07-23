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
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';

import { Profile, ROLE_LABELS } from '../types';
import {
  supabase,
  getOrgMembers,
  getSitesWithDetail,
  createSite,
  addSiteMember,
  removeSiteMember,
  assignSiteSupervisor,
  removeSiteSupervisor,
  setSiteDefaultOwner,
  setSitePublicIntake,
  SiteDetail,
} from '../lib/supabase';

// Matches the edge functions' SNAG_APP_URL default — the QR always encodes
// the web export's URL (works with or without the native app installed);
// see PublicQrReportScreen.tsx / App.tsx for the landing side of this link.
const APP_URL = 'https://snagv1.netlify.app';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import { useToast } from '../hooks/useToast';

export default function ManageSitesScreen() {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [sites, setSites] = useState<SiteDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [newSiteName, setNewSiteName] = useState('');
  const [creatingSite, setCreatingSite] = useState(false);
  const [assignSite, setAssignSite] = useState<SiteDetail | null>(null);
  const [qrSite, setQrSite] = useState<SiteDetail | null>(null);
  const [togglingQr, setTogglingQr] = useState(false);
  const [orgIsPublic, setOrgIsPublic] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('profiles')
      .select('*, organisation:organisations!profiles_org_id_fkey(id, is_public)')
      .eq('id', user.id)
      .single();

    if (data) {
      const profile = data as unknown as Profile;
      setCurrentUser(profile);
      setOrgIsPublic(!!(profile.organisation as any)?.is_public);

      if (profile.org_id) {
        const [list, siteDetails] = await Promise.all([
          getOrgMembers(profile.org_id),
          getSitesWithDetail(),
        ]);
        setMembers(list);
        setSites(siteDetails);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function handleCreateSite() {
    if (!newSiteName.trim()) return;
    setCreatingSite(true);
    const { error } = await createSite(newSiteName.trim());
    setCreatingSite(false);
    if (!error) {
      setNewSiteName('');
      showToast('Site created');
      setSites(await getSitesWithDetail());
    } else {
      showToast(error.message ?? 'Could not create site');
    }
  }

  // Called by the assignment modal after each change so the parent list and
  // the modal's own `assignSite` reference stay in sync.
  async function refreshSites() {
    const fresh = await getSitesWithDetail();
    setSites(fresh);
    setAssignSite((prev) => (prev ? fresh.find((s) => s.id === prev.id) ?? null : null));
  }

  async function handleToggleSiteQr(enable: boolean) {
    if (!qrSite) return;
    setTogglingQr(true);
    const { error } = await setSitePublicIntake(qrSite.id, enable);
    setTogglingQr(false);
    if (error) {
      showToast(error.message ?? 'Could not update the site QR code');
      return;
    }
    const fresh = await getSitesWithDetail();
    setSites(fresh);
    setQrSite(fresh.find((s) => s.id === qrSite.id) ?? null);
    showToast(enable ? 'Public QR enabled — old codes for this site (if any) no longer work' : 'Public QR disabled');
  }

  async function handleCopySiteQrLink() {
    if (!qrSite?.publicReportToken) return;
    await Clipboard.setStringAsync(`${APP_URL}/?report=${qrSite.publicReportToken}`);
    showToast('Link copied');
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Manage Sites" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </View>
    );
  }

  const isAdmin = currentUser?.role === 'officer_admin';

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Manage Sites" />
        <View style={styles.loadingContainer}>
          <EmptyState
            icon="lock-closed-outline"
            title="Managers only"
            message="Only an organisation manager can manage sites."
          />
        </View>
      </View>
    );
  }

  const sortedMembers = [...members].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));

  return (
    <View style={styles.container}>
      <ScreenHeader title="Manage Sites" />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>SITES</Text>
            <Text style={styles.sectionCount}>{sites.length} site{sites.length !== 1 ? 's' : ''}</Text>
          </View>

          {sites.map((site) => (
            <Card key={site.id} variant="elevated" style={styles.siteCard}>
              <View style={styles.siteTop}>
                <Icon name="location-outline" size="md" color={Colors.primary} />
                <View style={styles.siteInfo}>
                  <Text style={styles.siteName}>{site.name}</Text>
                  <Text style={styles.siteMeta}>
                    {site.memberIds.length} member{site.memberIds.length !== 1 ? 's' : ''}
                    {' · '}
                    {site.supervisorIds.length} Site Lead{site.supervisorIds.length !== 1 ? 's' : ''}
                  </Text>
                </View>
              </View>
              <View style={styles.rowButtons}>
                <Button
                  label="Assign People"
                  variant="outline"
                  onPress={() => setAssignSite(site)}
                  style={styles.flex1}
                />
                <Button
                  label="Public QR"
                  variant={site.publicReportToken ? 'secondary' : 'outline'}
                  icon="qr-code-outline"
                  onPress={() => setQrSite(site)}
                  style={styles.flex1}
                />
              </View>
            </Card>
          ))}

          <Card variant="elevated" style={styles.card}>
            <Text style={styles.fieldLabel}>Add a site</Text>
            <View style={styles.rowButtons}>
              <TextInput
                style={[styles.input, styles.flex1]}
                placeholder="e.g. North Warehouse"
                placeholderTextColor={Colors.textMuted}
                value={newSiteName}
                onChangeText={setNewSiteName}
              />
              <Button label="Add" onPress={handleCreateSite} loading={creatingSite} />
            </View>
          </Card>
        </View>
      </ScrollView>

      <SiteAssignmentModal
        site={assignSite}
        members={sortedMembers}
        onClose={() => setAssignSite(null)}
        onChanged={refreshSites}
        showToast={showToast}
      />

      <SiteQrModal
        site={qrSite}
        orgIsPublic={orgIsPublic}
        busy={togglingQr}
        onEnable={() => handleToggleSiteQr(true)}
        onDisable={() => handleToggleSiteQr(false)}
        onCopyLink={handleCopySiteQrLink}
        onClose={() => setQrSite(null)}
      />
    </View>
  );
}

// ── Site assignment modal ────────────────────────────────────────────────────
// Per member of the org: toggle site membership, toggle supervisor, and pick a
// single default owner for the site. Each action hits its RPC then refreshes.
function SiteAssignmentModal({
  site,
  members,
  onClose,
  onChanged,
  showToast,
}: {
  site: SiteDetail | null;
  members: Profile[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  showToast: (msg: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<string | null>(null);

  if (!site) return null;

  async function run(key: string, fn: () => PromiseLike<{ error: any }>) {
    setBusy(key);
    const { error } = await fn();
    if (error) showToast(error.message ?? 'Could not update site');
    await onChanged();
    setBusy(null);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>{site.name}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon name="close" size="md" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>
            Members can report into this site. Site Leads oversee it. The default owner is auto-assigned new snags here.
          </Text>

          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            {members.map((m) => {
              const isMember = site.memberIds.includes(m.id);
              const isSup = site.supervisorIds.includes(m.id);
              const isOwner = site.defaultOwnerId === m.id;
              return (
                <View key={m.id} style={styles.assignRow}>
                  <View style={styles.assignInfo}>
                    <Text style={styles.assignName} numberOfLines={1}>{m.name || m.email}</Text>
                    <Text style={styles.assignRole}>{ROLE_LABELS[m.role]}</Text>
                  </View>
                  <View style={styles.assignActions}>
                    <AssignToggle
                      label="Member"
                      active={isMember}
                      busy={busy === `mem-${m.id}`}
                      onPress={() => run(`mem-${m.id}`, () => isMember ? removeSiteMember(site.id, m.id) : addSiteMember(site.id, m.id))}
                    />
                    <AssignToggle
                      label="Site Lead"
                      active={isSup}
                      busy={busy === `sup-${m.id}`}
                      onPress={() => run(`sup-${m.id}`, () => isSup ? removeSiteSupervisor(site.id, m.id) : assignSiteSupervisor(site.id, m.id))}
                    />
                    <AssignToggle
                      label="Owner"
                      active={isOwner}
                      busy={busy === `own-${m.id}`}
                      onPress={() => !isOwner && run(`own-${m.id}`, () => setSiteDefaultOwner(site.id, m.id))}
                    />
                  </View>
                </View>
              );
            })}
            {members.length === 0 && (
              <Text style={styles.hintMuted}>No members to assign yet.</Text>
            )}
          </ScrollView>

          <Button label="Done" onPress={onClose} fullWidth style={styles.topGap} />
        </View>
      </View>
    </Modal>
  );
}

// One QR code per site, scoped by an opaque token (sites.public_report_token)
// rather than the org-wide "public reports" picker flow on Manage Organisation
// — scanning it skips straight to a report form pre-targeted at this site, no
// browsing, no account (paired with anonymous auth on the landing side — see
// App.tsx).
function SiteQrModal({
  site,
  orgIsPublic,
  busy,
  onEnable,
  onDisable,
  onCopyLink,
  onClose,
}: {
  site: SiteDetail | null;
  orgIsPublic: boolean;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onCopyLink: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!site) return null;

  const link = site.publicReportToken ? `${APP_URL}/?report=${site.publicReportToken}` : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>{site.name} — Public QR</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon name="close" size="md" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          {!orgIsPublic ? (
            <Text style={styles.modalHint}>
              Turn on "Accept public reports" on Manage Organisation first — a site's QR code only
              works while the organisation is accepting public reports.
            </Text>
          ) : link ? (
            <>
              <Text style={styles.modalHint}>
                Anyone who scans this lands straight on a report form for {site.name} — no account
                needed. Regenerate it to invalidate anything already printed or shared.
              </Text>
              <View style={styles.qrWrap}>
                <QRCode value={link} size={180} />
              </View>
              <TouchableOpacity style={styles.codeRow} onPress={onCopyLink} activeOpacity={0.7}>
                <Text style={styles.codeText} numberOfLines={1}>{link}</Text>
                <Icon name="copy-outline" size="md" color={Colors.primary} />
              </TouchableOpacity>
              <Button label="Regenerate" variant="outline" onPress={onEnable} loading={busy} fullWidth />
              <Button label="Disable Public QR" variant="dangerOutline" onPress={onDisable} loading={busy} fullWidth style={styles.topGap} />
            </>
          ) : (
            <>
              <Text style={styles.modalHint}>
                Generate a QR code that lets anyone report straight into {site.name} with no
                account — good for a poster at the site entrance.
              </Text>
              <Button label="Enable Public QR" onPress={onEnable} loading={busy} fullWidth />
            </>
          )}

          <Button label="Done" onPress={onClose} variant="ghost" fullWidth style={styles.topGap} />
        </View>
      </View>
    </Modal>
  );
}

function AssignToggle({ label, active, busy, onPress }: { label: string; active: boolean; busy: boolean; onPress: () => void }) {
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
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  scroll: { padding: Spacing.lg, gap: Spacing.lg },

  card: { gap: Spacing.sm },
  section: { gap: Spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xs },
  sectionLabel: { fontSize: Typography.xs, fontWeight: Typography.bold, color: Colors.textMuted, letterSpacing: 0.8 },
  sectionCount: { fontSize: Typography.xs, color: Colors.textMuted },
  fieldLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary, marginTop: Spacing.xs },
  hintMuted: { fontSize: Typography.sm, color: Colors.textMuted, fontStyle: 'italic' },
  topGap: { marginTop: Spacing.sm },
  flex1: { flex: 1 },
  rowButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

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

  siteCard: { gap: Spacing.md },
  siteTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  siteInfo: { flex: 1, gap: 2 },
  siteName: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  siteMeta: { fontSize: Typography.sm, color: Colors.textMuted },

  qrWrap: { alignItems: 'center', paddingVertical: Spacing.md },
  codeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.background, borderRadius: Radius.button,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
  },
  codeText: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary, letterSpacing: 4 },

  // Modal
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
  assignRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  assignInfo: { flex: 1, gap: 2 },
  assignName: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textPrimary },
  assignRole: { fontSize: Typography.xs, color: Colors.textMuted },
  assignActions: { flexDirection: 'row', gap: Spacing.xs },
  toggle: {
    minWidth: 60, height: 34, paddingHorizontal: Spacing.sm, borderRadius: Radius.button,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  toggleActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleText: { fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textSecondary },
  toggleTextActive: { color: Colors.white },
});
