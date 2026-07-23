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
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';

import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Profile, Organisation, UserRole, RootStackParamList, ROLE_LABELS } from '../types';
import {
  supabase,
  getOrgMembers,
  getPendingInvites,
  cancelInvite,
  updateMemberRole,
  removeOrgMember,
  inviteUser,
  regenerateOrgJoinCode,
  setOrgPublicMode,
  renameOrganisation,
  getSitesWithDetail,
  SiteDetail,
} from '../lib/supabase';

// Matches the edge functions' SNAG_APP_URL default — the QR always encodes
// the web export's URL (works with or without the native app installed);
// see PublicQrReportScreen.tsx / App.tsx for the landing side of this link.
const APP_URL = 'https://snagv1.netlify.app';
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
const INVITE_PREVIEW_COUNT = 3;

interface PendingInvite {
  id: string;
  email: string;
  role: UserRole;
  status: string;
  created_at: string;
  expires_at: string;
}

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ManageOrganisationScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
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
  const [cancellingInvite, setCancellingInvite] = useState<string | null>(null);
  const [showAllInvites, setShowAllInvites] = useState(false);

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

  async function handleCancelInvite(invite: PendingInvite) {
    setCancellingInvite(invite.id);
    const { error } = await cancelInvite(invite.id);
    setCancellingInvite(null);
    if (!error) {
      setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
      showToast(`Invite to ${invite.email} cancelled`);
    } else {
      showToast(error.message ?? 'Could not cancel invite');
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
            title="Managers only"
            message="Only an organisation manager can manage sites, members and settings."
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

        <Button
          label="Manage Sites"
          variant="outline"
          icon="location-outline"
          onPress={() => navigation.navigate('ManageSites')}
          fullWidth
        />

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

          {(showAllInvites ? pendingInvites : pendingInvites.slice(0, INVITE_PREVIEW_COUNT)).map((invite) => (
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
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleCancelInvite(invite)}
                  disabled={cancellingInvite === invite.id}
                  hitSlop={8}
                >
                  {cancellingInvite === invite.id ? (
                    <ActivityIndicator size="small" color={Colors.danger} />
                  ) : (
                    <Icon name="trash-outline" size="md" color={Colors.danger} />
                  )}
                </TouchableOpacity>
              </View>
            </Card>
          ))}

          {pendingInvites.length > INVITE_PREVIEW_COUNT && (
            <TouchableOpacity onPress={() => setShowAllInvites((v) => !v)} style={styles.showMoreRow}>
              <Text style={styles.showMoreText}>
                {showAllInvites ? 'Show less' : `Show all ${pendingInvites.length} pending`}
              </Text>
              <Icon name={showAllInvites ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.primary} />
            </TouchableOpacity>
          )}

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
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => handleTogglePublicMode(!org?.is_public)}
            disabled={savingPublicMode || (!org?.is_public && sites.length === 0)}
            activeOpacity={0.7}
          >
            <Icon
              name={org?.is_public ? 'checkbox' : 'square-outline'}
              size="md"
              color={org?.is_public ? Colors.primary : Colors.textMuted}
            />
            <Text style={styles.checkboxLabel}>Accept public reports</Text>
            {savingPublicMode && <ActivityIndicator size="small" color={Colors.primary} />}
          </TouchableOpacity>

          {org?.is_public ? (
            <Text style={styles.hint}>
              Anyone can find {orgName} in the app and submit a report
              {sites.find((s) => s.id === org.public_intake_site_id)
                ? ` — reports land in ${sites.find((s) => s.id === org.public_intake_site_id)!.name}`
                : ''}
              . They only ever see their own submissions.
            </Text>
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
            </>
          )}
        </Card>
      </ScrollView>

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
  showMoreRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  showMoreText: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.primary },

  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  checkboxLabel: { flex: 1, fontSize: Typography.base, fontWeight: Typography.medium, color: Colors.textPrimary },

  qrCard: { gap: Spacing.sm, alignItems: 'stretch' },
  qrWrap: { alignItems: 'center', paddingVertical: Spacing.md },
  codeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.background, borderRadius: Radius.button,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
  },
  codeText: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary, letterSpacing: 4 },
});
