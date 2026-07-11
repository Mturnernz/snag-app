import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Colors, Spacing, Typography, Radius } from '../constants/theme';
import { Membership, setOrganisationActive } from '../lib/supabase';
import Button from '../components/Button';
import Icon from '../components/Icon';

interface Props {
  /** Every org this user belongs to — all confirmed inactive by the caller. */
  memberships: Membership[];
  /** Re-run org resolution — called after a reactivation, or on demand. */
  onRecheck: () => void | Promise<void>;
  onSignOut: () => void;
}

// Shown when every org a signed-in user belongs to has been deactivated by
// its owner. An officer_admin among them can reactivate straight from here
// (their only way back in, since the rest of the app is otherwise
// unreachable without a usable active org); anyone else just sees why.
export default function OrgInactiveScreen({ memberships, onRecheck, onSignOut }: Props) {
  const [reactivating, setReactivating] = useState<string | null>(null);
  const ownedOrgs = memberships.filter((m) => m.role === 'officer_admin');

  async function handleReactivate(orgId: string, orgName: string) {
    Alert.alert('Reactivate organisation?', `${orgName} will become visible and usable again for every member.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reactivate',
        onPress: async () => {
          setReactivating(orgId);
          const { error } = await setOrganisationActive(orgId, true);
          setReactivating(null);
          if (error) {
            Alert.alert('Error', error.message ?? 'Could not reactivate organisation');
          } else {
            await onRecheck();
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Icon name="business-outline" size="xxl" color={Colors.textMuted} />
        <Text style={styles.title}>Organisation inactive</Text>
        <Text style={styles.message}>
          {ownedOrgs.length > 0
            ? "Your organisation has been deactivated. You can reactivate it below, or contact whoever else administers it."
            : "Your organisation has been deactivated by its admin. Contact them for more information."}
        </Text>

        {ownedOrgs.map((m) => (
          <View key={m.org_id} style={styles.orgRow}>
            <Text style={styles.orgName}>{m.org_name}</Text>
            {reactivating === m.org_id ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Button label="Reactivate" onPress={() => handleReactivate(m.org_id, m.org_name)} />
            )}
          </View>
        ))}

        <Button label="Check again" variant="outline" onPress={() => onRecheck()} fullWidth />
        <Button label="Sign Out" variant="ghost" onPress={onSignOut} fullWidth />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
  },
  content: {
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  title: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  message: {
    fontSize: Typography.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  orgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  orgName: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.textPrimary,
  },
});
