import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { UserRole, ROLE_LABELS } from '../types';
import { Colors, Spacing, Typography, Radius, Shadow } from '../constants/theme';
import { getMemberships, setActiveOrg, Membership } from '../lib/supabase';
import Icon from './Icon';

interface Props {
  title: string;
  role: UserRole | null;
  orgName: string | null;
  /** Called after a successful switch so the screen can refetch whatever it
   *  shows for the newly active org. */
  onSwitched?: () => void | Promise<void>;
}

// Shared by every main tab's header (Snags, Admin, Profile): tap the org name
// to switch which of your organisations is active. Only interactive when you
// actually belong to more than one.
export default function OrgSwitcherHeader({ title, role, orgName, onSwitched }: Props) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [switching, setSwitching] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getMemberships().then(setMemberships);
    }, [])
  );

  async function handleSwitch(m: Membership) {
    setShowSwitcher(false);
    if (m.is_active) return;
    setSwitching(true);
    try {
      await setActiveOrg(m.org_id);
      await onSwitched?.();
    } finally {
      setSwitching(false);
    }
  }

  return (
    <>
      <TouchableOpacity
        style={styles.header}
        activeOpacity={memberships.length > 1 ? 0.7 : 1}
        disabled={memberships.length <= 1 || switching}
        onPress={() => setShowSwitcher(true)}
      >
        <View style={styles.side}>
          <Text style={styles.title}>{title}</Text>
        </View>
        <View style={styles.center}>
          {role && <Text style={styles.role} numberOfLines={1}>{ROLE_LABELS[role]}</Text>}
        </View>
        <View style={[styles.side, styles.sideRight]}>
          {switching ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <View style={styles.orgRow}>
              {orgName && <Text style={styles.orgName} numberOfLines={1}>{orgName}</Text>}
              {memberships.length > 1 && (
                <Icon name="chevron-down" size="sm" color={Colors.primary} />
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>

      <Modal visible={showSwitcher} transparent animationType="fade" onRequestClose={() => setShowSwitcher(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowSwitcher(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Switch organisation</Text>
            {memberships.map((m) => (
              <TouchableOpacity
                key={m.org_id}
                style={styles.orgOption}
                onPress={() => handleSwitch(m)}
                activeOpacity={0.7}
              >
                <View style={styles.orgOptionText}>
                  <Text style={styles.orgOptionName}>{m.org_name}</Text>
                  <Text style={styles.orgOptionRole}>{ROLE_LABELS[m.role]}</Text>
                </View>
                {m.is_active && <Icon name="checkmark-circle" size="md" color={Colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  side: {
    flex: 1,
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  role: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  orgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  orgName: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.xs,
    ...Shadow.lg,
  },
  sheetTitle: {
    fontSize: Typography.sm,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  orgOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
  },
  orgOptionText: {
    gap: 1,
  },
  orgOptionName: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.textPrimary,
  },
  orgOptionRole: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
});
