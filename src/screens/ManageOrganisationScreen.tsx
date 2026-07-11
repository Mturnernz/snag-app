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

import { Profile, Organisation, UserRole, ROLE_LABELS } from '../types';
import {
  supabase,
  getOrgMembers,
  getPendingInvites,
  updateMemberRole,
  removeOrgMember,
  inviteUser,
  regenerateOrgJoinCode,
  setOrgPublicMode,
  renameOrganisation,
  getSitesWithDetail,
  createSite,
  addSiteMember,
  removeSiteMember,
  assignSiteSupervisor,
  removeSiteSupervisor,
  setSiteDefaultOwner,
  SiteDetail,
} from '../lib/supabase';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Avatar from '../components/Avatar';
import Chip from '../components/Chip';
import Button from '../components/Button';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../hooks/useToast';

const ROLES: UserRole[] = ['worker', 'supervisor', 'officer_admin'];
const ROLE_OPTIONS = ROLES.map((r) => ({ key: r, label: ROLE_LABELS[r] }));

interface PendingInvite {
  id: string;
  email: string;
  role: UserRole;
  status: string;
  created_at: string;
  expires_at: string;
}

export default function ManageOrganisationScreen() {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [org, setOrg] = useState<Organisation | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [sites, setSites] = useState<SiteDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Organisation name
  const [nameDraft, setNameDraft] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);

  // Invite
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('worker');
  const [inviteSiteId, setInviteSiteId] = useState<string>('');
  const [sendingInvite, setSendingInvite] = useState(false);

  // Members
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [removingMember, setRemovingMember] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<Profile | null>(null);

  // Sites
  const [newSiteName, setNewSiteName] = useState('');
  const [creatingSite, setCreatingSite] = useState(false);
  const [assignSite, setAssignSite] = useState<SiteDetail | null>(null);

  // QR
  const [regeneratingCode, setRegeneratingCode] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  // Public reports
  const [intakeSiteId, setIntakeSiteId] = useState<string | null>(null);
  const [savingPublicMode, setSavingPublicMode] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('profiles')
      .select('*, organisation:organisations!profiles_org_id_fkey(id, name, industry, plan_tier, join_code, is_public, public_intake_site_id, created_at)')
      .eq('id', user.id)
      .single();

    if (data) {
      const profile = data as unknown as Profile;
      setCurrentUser(profile);
      const organisation = (profile.organisation as Organisation | undefined) ?? null;
      setOrg(organisation);
      setNameDraft(organisation?.name ?? '');

      if (profile.org_id) {
        const [list, invites, siteDetails] = await Promise.all([
          getOrgMembers(profile.org_id),
          getPendingInvites(profile.org_id),
          getSitesWithDetail(),
        ]);
        setMembers(list);
        setPendingInvites(invites as PendingInvite[]);
        setSites(siteDetails);
        setIntakeSiteId(organisation?.public_intake_site_id ?? siteDetails[0]?.id ?? null);
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

  const orgName = org?.name ?? 'Your Organisation';

  // ── Organisation name ────────────────────────────────────────────────────
  async function handleSaveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === org?.name) { setEditingName(false); return; }
    setSavingName(true);
    const { error } = await renameOrganisation(trimmed);
    setSavingName(false);
    if (!error) {
      setOrg((prev) => (prev ? { ...prev, name: trimmed } : prev));
      setEditingName(false);
      showToast('Organisation name updated');
    } else {
      showToast(error.message ?? 'Could not rename organisation');
    }
  }

  // ── Invite ───────────────────────────────────────────────────────────────
  async function handleSendInvite() {
    if (!inviteEmail.trim()) return;
    setSendingInvite(true);
    const { error } = await inviteUser(inviteEmail.trim(), inviteRole, inviteSiteId || null);
    setSendingInvite(false);
    if (!error) {
      showToast('Invite sent');
      setInviteEmail('');
      setInviteRole('worker');
      setInviteSiteId('');
      if (currentUser?.org_id) getPendingInvites(currentUser.org_id).then((i) => setPendingInvites(i as PendingInvite[]));
    } else {
      showToast(error.message ?? 'Could not send invite');
    }
  }

  // ── Members ──────────────────────────────────────────────────────────────
  async function handleRoleChange(member: Profile, newRole: UserRole) {
    setUpdatingRole(member.id);
    const { error } = await updateMemberRole(member.id, newRole);
    setUpdatingRole(null);
    if (!error) {
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role: newRole } : m)));
    } else {
      showToast(error.message ?? 'Could not update role');
    }
  }

  async function handleRemoveMember() {
    if (!memberToRemove) return;
    const member = memberToRemove;
    setMemberToRemove(null);
    setRemovingMember(member.id);
    const { error } = await removeOrgMember(member.id);
    setRemovingMember(null);
    if (!error) {
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      showToast(`${member.name || member.email} removed from ${orgName}`);
    } else {
      showToast(error.message ?? 'Could not remove member');
    }
  }

  // ── Sites ────────────────────────────────────────────────────────────────
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

  // ── QR ───────────────────────────────────────────────────────────────────
  async function handleCopyCode() {
    if (!org?.join_code) return;
    await Clipboard.setStringAsync(org.join_code);
    showToast('Join code copied');
  }

  async function handleRegenerateCode() {
    setConfirmRegenerate(false);
    setRegeneratingCode(true);
    const { code, error } = await regenerateOrgJoinCode();
    setRegeneratingCode(false);
    if (code) {
      setOrg((prev) => (prev ? { ...prev, join_code: code } : prev));
      showToast('Join code regenerated — old QR codes no longer work');
    } else {
      showToast(error?.message ?? 'Could not regenerate join code');
    }
  }

  // ── Public reports ─────────────────────────────────────────────────────────
  async function handleTogglePublicMode(enable: boolean) {
    if (enable && !intakeSiteId) {
      showToast('Add a site first — public reports need somewhere to land');
      return;
    }
    setSavingPublicMode(true);
    const { error } = await setOrgPublicMode(enable, enable ? intakeSiteId : null);
    setSavingPublicMode(false);
    if (!error) {
      showToast(enable ? 'Now accepting public reports' : 'Public reports turned off');
      load();
    } else {
      showToast(error.message ?? 'Could not update public mode');
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Manage Organisation" />
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
        <ScreenHeader title="Manage Organisation" />
        <View style={styles.loadingContainer}>
          <EmptyState
            icon="lock-closed-outline"
            title="Admins only"
            message="Only an organisation admin can manage sites, members and settings."
          />
        </View>
      </View>
    );
  }

  const sortedMembers = [...members].sort((a, b) => {
    const ri = (r: UserRole) => ROLES.indexOf(r);
    if (ri(b.role) !== ri(a.role)) return ri(b.role) - ri(a.role);
    return (a.name || a.email).localeCompare(b.name || b.email);
  });

  const siteOptions = [
    { key: '', label: 'Any site' },
    ...sites.map((s) => ({ key: s.id, label: s.name })),
  ];

  return (
    <View style={styles.container}>
      <ScreenHeader title="Manage Organisation" />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        {/* Organisation name */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.sectionLabel}>ORGANISATION NAME</Text>
          {editingName ? (
            <>
              <TextInput
                style={styles.input}
                value={nameDraft}
                onChangeText={setNameDraft}
                autoFocus
                placeholder="Organisation name"
                placeholderTextColor={Colors.textMuted}
              />
              <View style={styles.rowButtons}>
                <Button label="Cancel" variant="outline" onPress={() => { setNameDraft(org?.name ?? ''); setEditingName(false); }} style={styles.flex1} />
                <Button label="Save" onPress={handleSaveName} loading={savingName} style={styles.flex1} />
              </View>
            </>
          ) : (
            <View style={styles.nameRow}>
              <Text style={styles.nameValue} numberOfLines={1}>{orgName}</Text>
              <TouchableOpacity style={styles.editButton} onPress={() => setEditingName(true)} hitSlop={8}>
                <Icon name="create-outline" size="md" color={Colors.primary} />
              </TouchableOpacity>
            </View>
          )}
        </Card>

        {/* Invite */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.sectionLabel}>INVITE A TEAM MEMBER</Text>
          <TextInput
            style={styles.input}
            placeholder="colleague@example.com"
            placeholderTextColor={Colors.textMuted}
            value={inviteEmail}
            onChangeText={setInviteEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Text style={styles.fieldLabel}>Role</Text>
          <Chip options={ROLE_OPTIONS} value={inviteRole} onChange={setInviteRole} variant="segmented" />
          {sites.length > 0 && (
            <>
              <Text style={styles.fieldLabel}>Assign to site</Text>
              <Chip options={siteOptions} value={inviteSiteId} onChange={setInviteSiteId} variant="segmented" />
            </>
          )}
          <Button label="Send Invite" onPress={handleSendInvite} loading={sendingInvite} fullWidth style={styles.topGap} />
        </Card>

        {/* Sites */}
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
                    {site.supervisorIds.length} supervisor{site.supervisorIds.length !== 1 ? 's' : ''}
                  </Text>
                </View>
              </View>
              <Button
                label="Assign People"
                variant="outline"
                onPress={() => setAssignSite(site)}
                fullWidth
              />
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

        {/* Members */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>MEMBERS</Text>
            <Text style={styles.sectionCount}>
              {members.length} member{members.length !== 1 ? 's' : ''}
              {pendingInvites.length > 0 ? ` · ${pendingInvites.length} pending` : ''}
            </Text>
          </View>

          {sortedMembers.map((member) => {
            const isSelf = member.id === currentUser?.id;
            return (
              <Card key={member.id} variant="elevated" style={styles.memberCard}>
                <View style={styles.memberTop}>
                  <Avatar name={member.name} email={member.email} size={40} />
                  <View style={styles.memberInfo}>
                    <View style={styles.memberNameRow}>
                      <Text style={styles.memberName} numberOfLines={1}>{member.name || '—'}</Text>
                      {isSelf && <Text style={styles.selfTag}>you</Text>}
                    </View>
                    <Text style={styles.memberEmail} numberOfLines={1}>{member.email}</Text>
                  </View>
                </View>
                <View style={styles.memberActionsRow}>
                  <View style={styles.roleControl}>
                    {updatingRole === member.id ? (
                      <ActivityIndicator size="small" color={Colors.primary} style={styles.roleSpinner} />
                    ) : isSelf ? (
                      <View style={styles.roleReadout}>
                        <Text style={styles.roleReadoutText}>{ROLE_LABELS[member.role]}</Text>
                      </View>
                    ) : (
                      <Chip options={ROLE_OPTIONS} value={member.role} onChange={(role) => handleRoleChange(member, role)} variant="segmented" />
                    )}
                  </View>
                  {!isSelf && (
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => setMemberToRemove(member)}
                      disabled={removingMember === member.id}
                      hitSlop={8}
                    >
                      {removingMember === member.id ? (
                        <ActivityIndicator size="small" color={Colors.danger} />
                      ) : (
                        <Icon name="trash-outline" size="md" color={Colors.danger} />
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </Card>
            );
          })}

          {pendingInvites.map((invite) => (
            <Card key={invite.id} variant="elevated" style={styles.memberCard}>
              <View style={styles.memberTop}>
                <Avatar name={invite.email} email={invite.email} size={40} />
                <View style={styles.memberInfo}>
                  <View style={styles.memberNameRow}>
                    <Text style={styles.memberName} numberOfLines={1}>{invite.email}</Text>
                    <View style={styles.pendingPill}>
                      <Text style={styles.pendingPillText}>Pending</Text>
                    </View>
                  </View>
                  <Text style={styles.memberEmail} numberOfLines={1}>{ROLE_LABELS[invite.role]} invite</Text>
                </View>
              </View>
            </Card>
          ))}

          {members.length === 0 && pendingInvites.length === 0 && (
            <EmptyState icon="people-outline" title="No team members yet" message="Invite your team above so they can join." />
          )}
        </View>

        {/* QR join code */}
        {org?.join_code && (
          <Card variant="elevated" style={styles.qrCard}>
            <Text style={styles.sectionLabel}>SCAN TO JOIN</Text>
            <Text style={styles.hint}>
              Anyone who scans this joins {orgName} as a worker. Regenerate it to invalidate old QR codes.
            </Text>
            <View style={styles.qrWrap}>
              <QRCode value={org.join_code} size={180} />
            </View>
            <TouchableOpacity style={styles.codeRow} onPress={handleCopyCode} activeOpacity={0.7}>
              <Text style={styles.codeText} selectable>{org.join_code}</Text>
              <Icon name="copy-outline" size="md" color={Colors.primary} />
            </TouchableOpacity>
            <Button label="Regenerate Code" variant="outline" onPress={() => setConfirmRegenerate(true)} loading={regeneratingCode} fullWidth />
          </Card>
        )}

        {/* Public reports */}
        <Card variant="elevated" style={styles.card}>
          <Text style={styles.sectionLabel}>PUBLIC REPORTS</Text>
          {org?.is_public ? (
            <>
              <Text style={styles.hint}>
                Anyone can find {orgName} in the app and submit a report
                {sites.find((s) => s.id === org.public_intake_site_id)
                  ? ` — reports land in ${sites.find((s) => s.id === org.public_intake_site_id)!.name}`
                  : ''}
                . They only ever see their own submissions.
              </Text>
              <Button label="Stop Accepting Public Reports" variant="outline" onPress={() => handleTogglePublicMode(false)} loading={savingPublicMode} fullWidth />
            </>
          ) : (
            <>
              <Text style={styles.hint}>
                Let anyone — not just members — submit reports to {orgName}. Pick the site that receives them.
              </Text>
              {sites.length > 0 ? (
                <Chip
                  options={sites.map((s) => ({ key: s.id, label: s.name }))}
                  value={intakeSiteId ?? ''}
                  onChange={(id) => setIntakeSiteId(id)}
                  variant="segmented"
                />
              ) : (
                <Text style={styles.hintMuted}>Your organisation has no sites yet — add one above first.</Text>
              )}
              <Button label="Accept Public Reports" onPress={() => handleTogglePublicMode(true)} loading={savingPublicMode} disabled={sites.length === 0} fullWidth />
            </>
          )}
        </Card>
      </ScrollView>

      {/* Per-site assignment modal */}
      <SiteAssignmentModal
        site={assignSite}
        members={sortedMembers}
        onClose={() => setAssignSite(null)}
        onChanged={refreshSites}
        showToast={showToast}
      />

      <ConfirmDialog
        visible={!!memberToRemove}
        title="Remove this member?"
        message={`${memberToRemove?.name || memberToRemove?.email} will immediately lose access to ${orgName}. Their past reports and comments stay on record.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleRemoveMember}
        onCancel={() => setMemberToRemove(null)}
      />

      <ConfirmDialog
        visible={confirmRegenerate}
        title="Regenerate join code?"
        message="Any QR codes or posters showing the current code will stop working immediately."
        confirmLabel="Regenerate"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleRegenerateCode}
        onCancel={() => setConfirmRegenerate(false)}
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
            Members can report into this site. Supervisors oversee it. The default owner is auto-assigned new snags here.
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
                      label="Supervisor"
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
  hint: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 18 },
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

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  nameValue: { flex: 1, fontSize: Typography.lg, fontWeight: Typography.semibold, color: Colors.textPrimary },
  editButton: {
    width: 40, height: 40, borderRadius: Radius.button,
    backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },

  siteCard: { gap: Spacing.md },
  siteTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  siteInfo: { flex: 1, gap: 2 },
  siteName: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  siteMeta: { fontSize: Typography.sm, color: Colors.textMuted },

  memberCard: { gap: Spacing.sm },
  memberTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  memberInfo: { flex: 1, gap: 2 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  memberName: { fontSize: Typography.base, fontWeight: Typography.medium, color: Colors.textPrimary, flexShrink: 1 },
  selfTag: {
    fontSize: Typography.xs, color: Colors.textMuted, backgroundColor: Colors.background,
    borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1,
  },
  memberEmail: { fontSize: Typography.sm, color: Colors.textMuted },
  memberActionsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  roleControl: { flex: 1 },
  roleSpinner: { height: 38 },
  roleReadout: { height: 38, borderRadius: Radius.button, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  roleReadoutText: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textSecondary },
  deleteButton: {
    width: 38, height: 38, borderRadius: Radius.button,
    backgroundColor: Colors.priority.highBg, alignItems: 'center', justifyContent: 'center',
  },
  pendingPill: { backgroundColor: Colors.status.inProgressBg, borderRadius: Radius.chip, paddingHorizontal: 6, paddingVertical: 1 },
  pendingPillText: { fontSize: Typography.xs, fontWeight: Typography.bold, color: Colors.status.inProgress },

  qrCard: { gap: Spacing.sm, alignItems: 'stretch' },
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
