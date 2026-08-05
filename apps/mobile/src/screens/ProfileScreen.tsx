import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Profile, Organisation, SnagStatus, STATUS_LABELS, ROLE_LABELS, RootStackParamList } from '../types';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { supabase, signOut, getMemberships, getOrgSnagSummary, updatePassword, OrgSnagSummary, Membership } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { failureReason } from '../lib/deadline';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Avatar from '../components/Avatar';
import Card from '../components/Card';
import Button from '../components/Button';
import Icon from '../components/Icon';
import Sheet from '../components/Sheet';
import OrgSwitcherHeader from '../components/OrgSwitcherHeader';
import TourAnchor from '../components/TourAnchor';
import { useBadge } from '../context/BadgeContext';
import { useTour } from '../context/TourContext';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type SnagCounts = Record<SnagStatus, number>;

const STATUS_ORDER: SnagStatus[] = ['flagged', 'in_progress', 'resolved', 'rca_pending'];

const STATUS_COLORS: Record<SnagStatus, { text: string; bg: string }> = {
  flagged: { text: Colors.status.flagged, bg: Colors.status.flaggedBg },
  in_progress: { text: Colors.status.inProgress, bg: Colors.status.inProgressBg },
  resolved: { text: Colors.status.resolved, bg: Colors.status.resolvedBg },
  rca_pending: { text: Colors.status.rcaPending, bg: Colors.status.rcaPendingBg },
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { mentionCount } = useBadge();
  const tour = useTour();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  // Name editing
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Snag stats
  const [snagCounts, setSnagCounts] = useState<SnagCounts | null>(null);

  // Changing a password you still know — an existing session authorises it, so
  // this never goes near the recovery-email round trip.
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Organisations (multi-org) — read-only summary list; switching happens
  // via the header now.
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [orgSummaries, setOrgSummaries] = useState<Record<string, OrgSnagSummary | null>>({});

  useEffect(() => {
    fetchProfile();
  }, []);

  // Refresh when regaining focus — e.g. after scanning a QR code switched
  // or added an organisation.
  useFocusEffect(
    React.useCallback(() => {
      fetchProfile();
    }, [])
  );

  async function fetchProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('profiles')
      .select('*, organisation:organisations!profiles_org_id_fkey(id, name, industry, plan_tier, created_at)')
      .eq('id', user.id)
      .single();

    if (data) {
      setProfile(data as unknown as Profile);
      setNameInput(data.name ?? '');
      fetchSnagCounts(user.id, data.org_id);
    }
    getMemberships().then((all) => {
      // Deactivated orgs are hidden everywhere except the admin tab.
      const ms = all.filter((m) => m.org_active);
      setMemberships(ms);
      ms.forEach((m) => {
        getOrgSnagSummary(m.org_id).then((summary) => {
          setOrgSummaries((prev) => ({ ...prev, [m.org_id]: summary }));
        });
      });
    });
    setLoading(false);
  }

  async function fetchSnagCounts(userId: string, orgId: string | null | undefined) {
    if (!orgId) return;

    const { data } = await supabase
      .from('snags')
      .select('status')
      .eq('reporter_id', userId)
      .eq('org_id', orgId);

    if (!data) return;

    const counts: SnagCounts = { flagged: 0, in_progress: 0, resolved: 0, rca_pending: 0 };
    for (const row of data) {
      if (row.status in counts) counts[row.status as SnagStatus]++;
    }
    setSnagCounts(counts);
  }

  async function handleSaveName() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setSavingName(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase
        .from('profiles')
        .update({ name: trimmed })
        .eq('id', user.id);
      if (!error) {
        setProfile((p) => p ? { ...p, name: trimmed } : p);
        setEditingName(false);
      }
    }
    setSavingName(false);
  }

  function closePasswordSheet() {
    setPasswordOpen(false);
    setNewPassword('');
    setConfirmPassword('');
  }

  async function handleChangePassword() {
    if (newPassword.length < 8) {
      showAlert('Too short', 'Use at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert("Those don't match", 'Type the same password in both fields.');
      return;
    }
    setSavingPassword(true);
    const { error } = await updatePassword(newPassword);
    setSavingPassword(false);
    if (error) {
      showAlert('Could not change it', error.message ?? 'Please try again.');
      return;
    }
    closePasswordSheet();
    showAlert('Password changed', 'Use the new one next time you sign in.');
  }

  async function handleSignOut() {
    showAlert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            // signOut() is bounded and falls back to dropping the session
            // locally, so this resolves either way — but the spinner comes off
            // in a finally regardless, because a spinner that outlives its
            // work is indistinguishable from an app that has stopped.
            const { error } = await signOut();
            if (error) showAlert('Still signed in', failureReason(error));
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const displayName = profile?.name || 'Your Name';
  const org = profile?.organisation as Organisation | undefined;
  const orgName = org?.name ?? 'No Organisation';
  const roleLabel = profile?.role ? ROLE_LABELS[profile.role] : null;
  const totalSnags = snagCounts
    ? Object.values(snagCounts).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <OrgSwitcherHeader
        title="Profile"
        role={profile?.role ?? null}
        orgName={org?.name ?? null}
        onSwitched={fetchProfile}
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar + name */}
        <View style={styles.profileSection}>
          <Avatar name={displayName} size={72} />

          {editingName ? (
            <View style={styles.nameEditRow}>
              <TextInput
                style={styles.nameInput}
                value={nameInput}
                onChangeText={setNameInput}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSaveName}
              />
              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleSaveName}
                disabled={savingName}
                activeOpacity={0.7}
              >
                {savingName
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={styles.saveButtonText}>Save</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => { setEditingName(false); setNameInput(profile?.name ?? ''); }}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.nameRow}
              onPress={() => setEditingName(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.name}>{displayName}</Text>
              <Icon name="create-outline" size="sm" color={Colors.textMuted} />
            </TouchableOpacity>
          )}

          <Text style={styles.email}>{profile?.email ?? ''}</Text>

          <View style={styles.orgPill}>
            <Text style={styles.orgPillText}>{orgName}</Text>
          </View>
          {roleLabel && (
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>{roleLabel}</Text>
            </View>
          )}
        </View>

        {/* My reporting stats */}
        {snagCounts !== null && (
          <Card variant="elevated" style={styles.statsCard}>
            <View style={styles.statsHeader}>
              <Text style={styles.statsTitle}>My Reported Snags</Text>
              <Text style={styles.statsTotal}>{totalSnags} total</Text>
            </View>
            <View style={styles.statsGrid}>
              {STATUS_ORDER.map((status) => (
                <View
                  key={status}
                  style={[styles.statItem, { backgroundColor: STATUS_COLORS[status].bg }]}
                >
                  <Text style={[styles.statCount, { color: STATUS_COLORS[status].text }]}>
                    {snagCounts[status]}
                  </Text>
                  <Text style={[styles.statLabel, { color: STATUS_COLORS[status].text }]}>
                    {STATUS_LABELS[status]}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        )}

        <TourAnchor id="profile-mentions">
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('Mentions')}>
            <Card variant="elevated" style={styles.mentionsCard}>
              <View style={styles.mentionsRow}>
                <Icon name="at-outline" size="md" color={Colors.primary} />
                <Text style={styles.mentionsTitle}>Mentions</Text>
                {mentionCount > 0 && (
                  <View style={styles.mentionsBadge}>
                    <Text style={styles.mentionsBadgeText}>{mentionCount}</Text>
                  </View>
                )}
                <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
              </View>
            </Card>
          </TouchableOpacity>
        </TourAnchor>

        {/* The org's document register. All roles: the policies and procedures
            kept here are the ones workers are expected to follow, and until now
            they only existed in the portal, which workers can't reach. */}
        <TourAnchor id="profile-documents">
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('DocumentLibrary')}>
            <Card variant="elevated" style={styles.mentionsCard}>
              <View style={styles.mentionsRow}>
                <Icon name="folder-open-outline" size="md" color={Colors.primary} />
                <Text style={styles.mentionsTitle}>Documents</Text>
                <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
              </View>
            </Card>
          </TouchableOpacity>
        </TourAnchor>

        {/* Changing a password you still know. Forgetting one is handled at
            sign-in, which has to go through the portal's reset page — this
            doesn't, because there's already a session to authorise it. */}
        <TouchableOpacity activeOpacity={0.7} onPress={() => setPasswordOpen(true)}>
          <Card variant="elevated" style={styles.mentionsCard}>
            <View style={styles.mentionsRow}>
              <Icon name="key-outline" size="md" color={Colors.primary} />
              <Text style={styles.mentionsTitle}>Change password</Text>
              <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
            </View>
          </Card>
        </TouchableOpacity>

        {/* The full onboarding guide, filtered to this member's role. Sits
            above the walkthrough because it's the deeper of the two: the
            walkthrough points at controls, this is the manual behind them. */}
        <TourAnchor id="profile-help">
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('HelpGuide')}>
            <Card variant="elevated" style={styles.mentionsCard}>
              <View style={styles.mentionsRow}>
                <Icon name="help-circle-outline" size="md" color={Colors.primary} />
                <Text style={styles.mentionsTitle}>Help & guide</Text>
                <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
              </View>
            </Card>
          </TouchableOpacity>
        </TourAnchor>

        {/* The guided walkthrough — all roles. Its label follows its state, so
            somebody who paused halfway is offered the thing they actually want
            rather than being asked to start again. */}
        <TourAnchor id="profile-walkthrough">
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => tour.start({ restart: tour.status !== 'paused' })}
          >
            <Card variant="elevated" style={styles.mentionsCard}>
              <View style={styles.mentionsRow}>
                <Icon name="school-outline" size="md" color={Colors.primary} />
                <Text style={styles.mentionsTitle}>
                  {tour.status === 'paused' ? 'Resume walkthrough' : 'Walkthrough'}
                </Text>
                {tour.status === 'paused' && (
                  <Text style={styles.walkthroughProgress}>
                    {tour.stepNumber} of {tour.stepCount}
                  </Text>
                )}
                <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
              </View>
            </Card>
          </TouchableOpacity>
        </TourAnchor>

        {/* Organisations — a read-only summary of every org you belong to.
            Switch which one is active from the header above, or scan a QR
            to join a new one. */}
        <Card variant="elevated" style={styles.orgsCard}>
          <Text style={styles.orgsTitle}>Organisations</Text>
          {memberships.map((m) => {
            const summary = orgSummaries[m.org_id];
            return (
              <View key={m.org_id} style={styles.orgRow}>
                <View style={styles.orgRowText}>
                  <View style={styles.orgRowNameRow}>
                    <Text style={styles.orgRowName}>{m.org_name}</Text>
                    {m.is_active && (
                      <Icon name="checkmark-circle" size="sm" color={Colors.primary} />
                    )}
                  </View>
                  <Text style={styles.orgRowRole}>{ROLE_LABELS[m.role]}</Text>
                </View>
                <View style={styles.orgRowSummary}>
                  <Text style={styles.orgRowSummaryCount}>
                    {summary === undefined ? '…' : summary?.total ?? 0}
                  </Text>
                  <Text style={styles.orgRowSummaryLabel}>snags</Text>
                </View>
              </View>
            );
          })}
          <Button
            label="Scan QR to join"
            variant="outline"
            icon="qr-code-outline"
            onPress={() => navigation.navigate('ScanOrgCode')}
            fullWidth
          />
        </Card>

        {/* Retention policy — general guidance, not legal advice. Serious/
            notifiable records are kept in full for defensibility; ordinary
            niggle detail is minimised after a few years rather than kept
            forever. See the compliance proposal for the underlying policy. */}
        <Card variant="elevated" style={styles.retentionCard}>
          <View style={styles.retentionHeader}>
            <Icon name="shield-checkmark-outline" size="sm" color={Colors.textMuted} />
            <Text style={styles.retentionTitle}>Data & retention</Text>
          </View>
          <Text style={styles.retentionText}>
            Health & safety records (hazards, incidents, and anything flagged notifiable) are
            kept in full — this is what NZ's Health and Safety at Work Act requires. Ordinary,
            resolved everyday snags have their description and photos minimised after a few
            years to limit how long personal detail is kept, in line with the Privacy Act. This
            is general guidance, not legal advice.
          </Text>
        </Card>

        <Button
          label="Sign Out"
          variant="dangerOutline"
          onPress={handleSignOut}
          loading={signingOut}
          icon="log-out-outline"
        />
      </ScrollView>

      <Sheet
        visible={passwordOpen}
        title="Change password"
        subtitle="This is the same account as the supervisor portal — it changes both."
        submitLabel="Save new password"
        onSubmit={handleChangePassword}
        submitting={savingPassword}
        onClose={closePasswordSheet}
      >
        <Text style={styles.passwordLabel}>New password</Text>
        <TextInput
          style={styles.passwordInput}
          placeholder="At least 8 characters"
          placeholderTextColor={Colors.textMuted}
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoCapitalize="none"
          textContentType="newPassword"
        />
        <Text style={styles.passwordLabel}>Type it again</Text>
        <TextInput
          style={styles.passwordInput}
          placeholder="Same password"
          placeholderTextColor={Colors.textMuted}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoCapitalize="none"
          textContentType="newPassword"
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  profileSection: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },

  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  name: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  nameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  nameInput: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.primary,
    paddingVertical: 2,
    minWidth: 140,
  },
  saveButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    height: 32,
    justifyContent: 'center',
  },
  saveButtonText: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  cancelButton: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    height: 32,
    justifyContent: 'center',
  },
  cancelButtonText: {
    color: Colors.textMuted,
    fontSize: Typography.sm,
  },

  email: {
    fontSize: Typography.base,
    color: Colors.textMuted,
  },
  orgPill: {
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.avatar,
  },
  orgPillText: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
  rolePill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    backgroundColor: Colors.border,
    borderRadius: Radius.avatar,
  },
  rolePillText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },

  // Organisations
  orgsCard: {
    gap: Spacing.sm,
  },
  orgsTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  orgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingVertical: Spacing.xs,
  },
  orgRowText: {
    flex: 1,
    gap: 2,
  },
  orgRowNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  orgRowName: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.textPrimary,
  },
  orgRowRole: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  orgRowSummary: {
    alignItems: 'center',
  },
  orgRowSummaryCount: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  orgRowSummaryLabel: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
  },

  // Snag stats
  statsCard: {
    gap: Spacing.md,
  },
  mentionsCard: {
    paddingVertical: Spacing.md,
  },
  mentionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  mentionsTitle: {
    flex: 1,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  walkthroughProgress: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  mentionsBadge: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  mentionsBadgeText: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.white,
  },
  statsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statsTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  statsTotal: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  statItem: {
    flexBasis: '18%',
    flexGrow: 1,
    borderRadius: Radius.chip,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    gap: 2,
  },
  statCount: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
  },
  statLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
    textAlign: 'center',
  },

  // Retention policy note
  passwordLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  passwordInput: {
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

  retentionCard: {
    gap: Spacing.xs,
  },
  retentionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  retentionTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  retentionText: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
});
