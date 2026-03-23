import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Clipboard,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Profile, Organisation, UserRole, ROLE_LABELS, RootStackParamList } from '../types';
import { supabase, getOrgMembers, updateMemberRole } from '../lib/supabase';
import { useUserProfile } from '../context/UserProfileContext';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const ROLES: UserRole[] = ['worker', 'manager', 'admin'];

const ROLE_COLORS: Record<UserRole, { active: string; text: string }> = {
  worker:  { active: Colors.border,        text: Colors.textSecondary },
  manager: { active: Colors.primaryLight,  text: Colors.primary },
  admin:   { active: '#FEF3C7',            text: '#B45309' },
};

function initials(name: string, email: string): string {
  const src = name.trim() || email;
  return src.split(/[\s@]/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function MemberCard({
  member,
  isSelf,
  issueCount,
  isAdmin,
  updatingRole,
  onRoleChange,
}: {
  member: Profile;
  isSelf: boolean;
  issueCount: number;
  isAdmin: boolean;
  updatingRole: boolean;
  onRoleChange: (role: UserRole) => void;
}) {
  return (
    <View style={styles.memberCard}>
      {/* Avatar + info row */}
      <View style={styles.memberTop}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(member.name, member.email)}</Text>
        </View>
        <View style={styles.memberInfo}>
          <View style={styles.memberNameRow}>
            <Text style={styles.memberName} numberOfLines={1}>
              {member.name || '—'}
            </Text>
            {isSelf && <Text style={styles.selfTag}>you</Text>}
          </View>
          <Text style={styles.memberEmail} numberOfLines={1}>{member.email}</Text>
        </View>
        <View style={styles.issuesBadge}>
          <Text style={styles.issuesBadgeCount}>{issueCount}</Text>
          <Text style={styles.issuesBadgeLabel}>issue{issueCount !== 1 ? 's' : ''}</Text>
        </View>
      </View>

      {/* Role selector */}
      <View style={styles.roleSelector}>
        {updatingRole ? (
          <ActivityIndicator size="small" color={Colors.primary} style={styles.roleSpinner} />
        ) : (
          ROLES.map(role => {
            const active = member.role === role;
            const colors = ROLE_COLORS[role];
            const canTap = isAdmin && !isSelf;
            return (
              <TouchableOpacity
                key={role}
                style={[
                  styles.roleBtn,
                  active && { backgroundColor: colors.active },
                  !active && styles.roleBtnInactive,
                ]}
                onPress={() => canTap && !active && onRoleChange(role)}
                activeOpacity={canTap && !active ? 0.7 : 1}
                disabled={!canTap || active}
              >
                <Text style={[
                  styles.roleBtnText,
                  active ? { color: colors.text, fontWeight: Typography.semibold } : undefined,
                ]}>
                  {ROLE_LABELS[role]}
                </Text>
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </View>
  );
}

export default function AdminDashboardScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  // Profile and orgId come from context — no auth re-fetch on mount.
  const { profile: currentUser, orgId } = useUserProfile();

  const [members, setMembers] = useState<Profile[]>([]);
  const [issueCounts, setIssueCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }

    const [list, issuesRes] = await Promise.all([
      getOrgMembers(orgId),
      supabase
        .from('issues')
        .select('reporter_id')
        .eq('organisation_id', orgId),
    ]);

    setMembers(list);

    const counts: Record<string, number> = {};
    for (const row of issuesRes.data ?? []) {
      counts[row.reporter_id] = (counts[row.reporter_id] ?? 0) + 1;
    }
    setIssueCounts(counts);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function handleRoleChange(member: Profile, newRole: UserRole) {
    setUpdatingRole(member.id);
    const { error } = await updateMemberRole(member.id, newRole);
    if (!error) {
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: newRole } : m));
    }
    setUpdatingRole(null);
  }

  function handleCopyCode() {
    const code = (currentUser?.organisation as Organisation | undefined)?.invite_code;
    if (!code) return;
    Clipboard.setString(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const org = currentUser?.organisation as Organisation | undefined;
  const orgInviteCode = org?.invite_code;
  const orgName = org?.name ?? 'Your Organisation';
  const isAdmin = currentUser?.role === 'admin';

  // Sort: admins first, then managers, then workers; alphabetically within each group
  const sorted = [...members].sort((a, b) => {
    const ri = (r: UserRole) => ROLES.indexOf(r);
    if (ri(b.role) !== ri(a.role)) return ri(b.role) - ri(a.role);
    return (a.name || a.email).localeCompare(b.name || b.email);
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Admin</Text>
          <Text style={styles.headerSub}>{orgName}</Text>
        </View>
        <TouchableOpacity
          style={styles.reportsBtn}
          onPress={() => navigation.navigate('Reports')}
          activeOpacity={0.8}
        >
          <Text style={styles.reportsBtnText}>Reports →</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >

        {/* Invite code */}
        {orgInviteCode && (
          <View style={styles.inviteCard}>
            <Text style={styles.sectionLabel}>ORGANISATION INVITE CODE</Text>
            <View style={styles.inviteRow}>
              <Text style={styles.inviteCode}>{orgInviteCode}</Text>
              <TouchableOpacity style={styles.copyBtn} onPress={handleCopyCode} activeOpacity={0.7}>
                <Text style={[styles.copyBtnText, copied && styles.copyBtnDone]}>
                  {copied ? '✓ Copied' : '⧉ Copy'}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.inviteHint}>
              Share this code with colleagues — they'll join as Workers by default.
            </Text>
          </View>
        )}

        {/* User access management */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>MANAGE USER ACCESS</Text>
            <Text style={styles.sectionCount}>{members.length} member{members.length !== 1 ? 's' : ''}</Text>
          </View>

          {sorted.map(member => (
            <MemberCard
              key={member.id}
              member={member}
              isSelf={member.id === currentUser?.id}
              issueCount={issueCounts[member.id] ?? 0}
              isAdmin={isAdmin}
              updatingRole={updatingRole === member.id}
              onRoleChange={(role) => handleRoleChange(member, role)}
            />
          ))}

          {members.length === 0 && (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>👥</Text>
              <Text style={styles.emptyTitle}>No team members yet</Text>
              <Text style={styles.emptyText}>
                Share the invite code above with your team so they can join.
              </Text>
              {orgInviteCode && (
                <TouchableOpacity style={styles.emptyAction} onPress={handleCopyCode} activeOpacity={0.85}>
                  <Text style={styles.emptyActionText}>
                    {copied ? '✓ Copied!' : `Copy Code: ${orgInviteCode}`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

      </ScrollView>
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

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  headerSub: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    marginTop: 2,
  },
  reportsBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.button,
  },
  reportsBtnText: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },

  scroll: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },

  // Invite card
  inviteCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inviteCode: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    letterSpacing: 4,
  },
  copyBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center',
  },
  copyBtnText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  copyBtnDone: {
    color: '#10B981',
  },
  inviteHint: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    lineHeight: 18,
  },

  // Section
  section: {
    gap: Spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  sectionLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.8,
  },
  sectionCount: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
  },

  // Member card
  memberCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  memberTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: Typography.sm,
    fontWeight: Typography.bold,
    color: Colors.primary,
  },
  memberInfo: {
    flex: 1,
    gap: 2,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  memberName: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.textPrimary,
    flexShrink: 1,
  },
  selfTag: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    backgroundColor: Colors.background,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  memberEmail: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  issuesBadge: {
    alignItems: 'center',
    minWidth: 44,
  },
  issuesBadgeCount: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  issuesBadgeLabel: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
  },

  // Role selector
  roleSelector: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  roleSpinner: {
    flex: 1,
    height: MIN_TOUCH_TARGET - 16,
  },
  roleBtn: {
    flex: 1,
    height: 32,
    borderRadius: Radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBtnInactive: {
    backgroundColor: Colors.background,
  },
  roleBtnText: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
  },

  emptyContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: Spacing.xs,
  },
  emptyTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: Spacing.md,
  },
  emptyAction: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET - 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyActionText: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.white,
  },
});
