import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Profile, Organisation, UserRole, ROLE_LABELS, RootStackParamList } from '../types';
import {
  supabase, getOrgMembers, updateMemberRole, inviteUser, getPendingInvites,
} from '../lib/supabase';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import Card from '../components/Card';
import Avatar from '../components/Avatar';
import Chip from '../components/Chip';
import Button from '../components/Button';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import { useToast } from '../hooks/useToast';

type Nav = NativeStackNavigationProp<RootStackParamList>;

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

function MemberCard({
  member,
  isSelf,
  snagCount,
  isAdmin,
  updatingRole,
  onRoleChange,
}: {
  member: Profile;
  isSelf: boolean;
  snagCount: number;
  isAdmin: boolean;
  updatingRole: boolean;
  onRoleChange: (role: UserRole) => void;
}) {
  const canEdit = isAdmin && !isSelf;
  return (
    <Card variant="elevated" style={styles.memberCard}>
      <View style={styles.memberTop}>
        <Avatar name={member.name} email={member.email} size={40} />
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
          <Text style={styles.issuesBadgeCount}>{snagCount}</Text>
          <Text style={styles.issuesBadgeLabel}>snag{snagCount !== 1 ? 's' : ''}</Text>
        </View>
      </View>

      {updatingRole ? (
        <ActivityIndicator size="small" color={Colors.primary} style={styles.roleSpinner} />
      ) : canEdit ? (
        <Chip options={ROLE_OPTIONS} value={member.role} onChange={onRoleChange} variant="segmented" />
      ) : (
        <View style={styles.roleReadout}>
          <Text style={styles.roleReadoutText}>{ROLE_LABELS[member.role]}</Text>
        </View>
      )}
    </Card>
  );
}

export default function AdminDashboardScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { showToast } = useToast();

  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [snagCounts, setSnagCounts] = useState<Record<string, number>>({});
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('worker');
  const [sendingInvite, setSendingInvite] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('profiles')
      .select('*, organisation:organisations(id, name, industry, plan_tier, created_at)')
      .eq('id', user.id)
      .single();

    if (data) {
      const profile = data as unknown as Profile;
      setCurrentUser(profile);

      if (profile.org_id) {
        const [list, snagsRes, invites] = await Promise.all([
          getOrgMembers(profile.org_id),
          supabase.from('snags').select('reporter_id').eq('org_id', profile.org_id),
          getPendingInvites(profile.org_id),
        ]);

        setMembers(list);
        setPendingInvites(invites as PendingInvite[]);

        const counts: Record<string, number> = {};
        for (const row of snagsRes.data ?? []) {
          counts[row.reporter_id] = (counts[row.reporter_id] ?? 0) + 1;
        }
        setSnagCounts(counts);
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

  async function handleRoleChange(member: Profile, newRole: UserRole) {
    setUpdatingRole(member.id);
    const { error } = await updateMemberRole(member.id, newRole);
    if (!error) {
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: newRole } : m));
    }
    setUpdatingRole(null);
  }

  async function handleSendInvite() {
    if (!inviteEmail.trim()) return;
    setSendingInvite(true);
    const { error } = await inviteUser(inviteEmail.trim(), inviteRole, null);
    setSendingInvite(false);
    if (!error) {
      showToast('Invite sent');
      setInviteEmail('');
      setInviteRole('worker');
      if (currentUser?.org_id) {
        getPendingInvites(currentUser.org_id).then(setPendingInvites);
      }
    }
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const org = currentUser?.organisation as Organisation | undefined;
  const orgName = org?.name ?? 'Your Organisation';
  const isAdmin = currentUser?.role === 'officer_admin';

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
          <Text style={styles.reportsBtnText}>Reports</Text>
          <Icon name="chevron-forward" size="sm" color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >

        {isAdmin && (
          <Card variant="elevated" style={styles.inviteCard}>
            <Text style={styles.sectionLabel}>INVITE A TEAM MEMBER</Text>
            <TextInput
              style={styles.inviteInput}
              placeholder="colleague@example.com"
              placeholderTextColor={Colors.textMuted}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Chip options={ROLE_OPTIONS} value={inviteRole} onChange={setInviteRole} variant="segmented" />
            <Button label="Send Invite" onPress={handleSendInvite} loading={sendingInvite} fullWidth />

            {pendingInvites.length > 0 && (
              <View style={styles.pendingList}>
                <Text style={styles.pendingLabel}>PENDING</Text>
                {pendingInvites.map((invite) => (
                  <View key={invite.id} style={styles.pendingRow}>
                    <Text style={styles.pendingEmail} numberOfLines={1}>{invite.email}</Text>
                    <Text style={styles.pendingRole}>{ROLE_LABELS[invite.role]}</Text>
                  </View>
                ))}
              </View>
            )}
          </Card>
        )}

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
              snagCount={snagCounts[member.id] ?? 0}
              isAdmin={isAdmin}
              updatingRole={updatingRole === member.id}
              onRoleChange={(role) => handleRoleChange(member, role)}
            />
          ))}

          {members.length === 0 && (
            <EmptyState
              icon="people-outline"
              title="No team members yet"
              message="Invite your team above so they can join."
            />
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
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

  inviteCard: {
    gap: Spacing.sm,
  },
  inviteInput: {
    height: MIN_TOUCH_TARGET,
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  pendingList: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  pendingLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.8,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pendingEmail: {
    fontSize: Typography.sm,
    color: Colors.textPrimary,
    flex: 1,
  },
  pendingRole: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
  },

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

  memberCard: {
    gap: Spacing.sm,
  },
  memberTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
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

  roleSpinner: {
    height: 38,
  },
  roleReadout: {
    height: 38,
    borderRadius: Radius.button,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleReadoutText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
});
