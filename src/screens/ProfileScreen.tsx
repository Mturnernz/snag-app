import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Clipboard,
} from 'react-native';
import Toast from '../components/Toast';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Profile, Organisation, IssueStatus, STATUS_LABELS, ROLE_LABELS, RootStackParamList } from '../types';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { supabase, signOut } from '../lib/supabase';
import { getUserTitle } from '../lib/points';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function AvatarCircle({ name, size = 72 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarInitials, { fontSize: size * 0.36 }]}>{initials}</Text>
    </View>
  );
}

type IssueCounts = Record<IssueStatus, number>;

const STATUS_ORDER: IssueStatus[] = ['open', 'in_progress', 'resolved', 'closed'];

const STATUS_COLORS: Record<IssueStatus, { text: string; bg: string }> = {
  open: { text: Colors.status.open, bg: Colors.status.openBg },
  in_progress: { text: Colors.status.inProgress, bg: Colors.status.inProgressBg },
  resolved: { text: Colors.status.resolved, bg: Colors.status.resolvedBg },
  closed: { text: Colors.status.closed, bg: Colors.status.closedBg },
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userPoints, setUserPoints] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [showCopiedToast, setShowCopiedToast] = useState(false);

  // Name editing
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Issue stats
  const [issueCounts, setIssueCounts] = useState<IssueCounts | null>(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  async function fetchProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('profiles')
      .select('*, organisation:organisations(id, name, invite_code)')
      .eq('id', user.id)
      .single();

    if (data) {
      setProfile(data as Profile);
      setNameInput(data.name ?? '');
      fetchIssueCounts(user.id);
      if (data.organisation_id) {
        fetchUserPoints(user.id, data.organisation_id);
      }
    }
    setLoading(false);
  }

  async function fetchUserPoints(userId: string, orgId: string) {
    const { data } = await supabase
      .from('user_points')
      .select('points')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .single();
    if (data) setUserPoints(data.points ?? 0);
  }

  async function fetchIssueCounts(userId: string) {
    const { data } = await supabase
      .from('issues')
      .select('status')
      .eq('reporter_id', userId);

    if (!data) return;

    const counts: IssueCounts = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
    for (const row of data) {
      if (row.status in counts) counts[row.status as IssueStatus]++;
    }
    setIssueCounts(counts);
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

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          await signOut();
          setSigningOut(false);
        },
      },
    ]);
  }

  function copyInviteCode() {
    const code = (profile?.organisation as Organisation | undefined)?.invite_code;
    if (code) {
      Clipboard.setString(code);
      setShowCopiedToast(true);
      setTimeout(() => setShowCopiedToast(false), 2000);
    }
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
  const orgInviteCode = org?.invite_code ?? null;
  const roleLabel = profile?.role ? ROLE_LABELS[profile.role] : null;
  const totalIssues = issueCounts
    ? Object.values(issueCounts).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar + name */}
        <View style={styles.profileSection}>
          <AvatarCircle name={displayName} size={72} />

          {/* Name — view or edit */}
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
              <Text style={styles.editIcon}>✎</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.email}>{profile?.email ?? ''}</Text>

          {/* Org + role pills */}
          <View style={styles.orgPill}>
            <Text style={styles.orgPillText}>{orgName}</Text>
          </View>
          {roleLabel && (
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>{roleLabel}</Text>
            </View>
          )}
          <View style={styles.titleRow}>
            <Text style={styles.userTitle}>{getUserTitle(userPoints)}</Text>
            <Text style={styles.userPoints}>{userPoints} pts</Text>
          </View>
          <TouchableOpacity
            style={styles.leaderboardBtn}
            onPress={() => navigation.navigate('Leaderboard')}
            activeOpacity={0.8}
          >
            <Text style={styles.leaderboardBtnText}>🏆 View Leaderboard</Text>
          </TouchableOpacity>
        </View>

        {/* My reporting stats */}
        {issueCounts !== null && (
          <View style={styles.statsCard}>
            <View style={styles.statsHeader}>
              <Text style={styles.statsTitle}>My Reported Issues</Text>
              <Text style={styles.statsTotal}>{totalIssues} total</Text>
            </View>
            <View style={styles.statsGrid}>
              {STATUS_ORDER.map((status) => (
                <View
                  key={status}
                  style={[styles.statItem, { backgroundColor: STATUS_COLORS[status].bg }]}
                >
                  <Text style={[styles.statCount, { color: STATUS_COLORS[status].text }]}>
                    {issueCounts[status]}
                  </Text>
                  <Text style={[styles.statLabel, { color: STATUS_COLORS[status].text }]}>
                    {STATUS_LABELS[status]}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Invite code card — shown to all org members so anyone can invite colleagues */}
        {orgInviteCode ? (
          <View style={styles.inviteCard}>
            <View style={styles.inviteRow}>
              <View>
                <Text style={styles.inviteLabel}>Invite code</Text>
                <Text style={styles.inviteCode}>{orgInviteCode}</Text>
              </View>
              <TouchableOpacity
                style={styles.copyButton}
                onPress={copyInviteCode}
                activeOpacity={0.7}
              >
                <Text style={styles.copyIcon}>⧉</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.inviteHint}>
              Share this code with colleagues to join your organisation.
            </Text>
          </View>
        ) : null}

        {/* Sign out */}
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          disabled={signingOut}
          activeOpacity={0.8}
        >
          {signingOut ? (
            <ActivityIndicator color={Colors.danger} size="small" />
          ) : (
            <Text style={styles.signOutLabel}>Sign Out</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
      <Toast message="Copied to clipboard!" visible={showCopiedToast} />
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
  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
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
  avatar: {
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  avatarInitials: {
    color: Colors.primary,
    fontWeight: Typography.bold,
  },

  // Name display + edit
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
  editIcon: {
    fontSize: Typography.base,
    color: Colors.textMuted,
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
    borderRadius: 99,
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
    borderRadius: 99,
  },
  rolePillText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },

  // Title + leaderboard
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  userTitle: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  userPoints: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  leaderboardBtn: {
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  leaderboardBtnText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.primary,
  },

  // Issue stats
  statsCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.md,
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
  },
  statItem: {
    flex: 1,
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

  // Invite card
  inviteCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inviteLabel: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    fontWeight: Typography.medium,
    marginBottom: 2,
  },
  inviteCode: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    letterSpacing: 3,
  },
  copyButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyIcon: {
    fontSize: 22,
    color: Colors.textSecondary,
  },
  inviteHint: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    lineHeight: 18,
  },

  // Sign out
  signOutButton: {
    height: MIN_TOUCH_TARGET,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  signOutLabel: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.danger,
  },
});
