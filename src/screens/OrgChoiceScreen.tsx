import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Typography } from '../constants/theme';
import Card from '../components/Card';
import Icon from '../components/Icon';

interface Props {
  onSelectCreate: () => void;
  onSelectJoin: () => void;
  onSignOut: () => void;
}

export default function OrgChoiceScreen({ onSelectCreate, onSelectJoin, onSignOut }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.inner}>
        <Text style={styles.appName}>Snag</Text>
        <Text style={styles.heading}>Get started</Text>
        <Text style={styles.subheading}>Are you setting up Snag for your workplace, or joining an existing one?</Text>

        <TouchableOpacity onPress={onSelectCreate} activeOpacity={0.85}>
          <Card variant="elevated" style={styles.optionCard}>
            <Icon name="business-outline" size="xl" color={Colors.primary} />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Create organisation</Text>
              <Text style={styles.optionDesc}>I'm setting up Snag for my workplace</Text>
            </View>
          </Card>
        </TouchableOpacity>

        <TouchableOpacity onPress={onSelectJoin} activeOpacity={0.85}>
          <Card variant="elevated" style={styles.optionCard}>
            <Icon name="key-outline" size="xl" color={Colors.primary} />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Join with invite code</Text>
              <Text style={styles.optionDesc}>I have a code from my manager</Text>
            </View>
          </Card>
        </TouchableOpacity>

        <TouchableOpacity onPress={onSignOut} style={styles.signOutLink}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.lg,
  },
  appName: {
    fontSize: Typography.xxxl,
    fontWeight: Typography.bold,
    color: Colors.primary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  heading: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  subheading: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: -Spacing.sm,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  optionDesc: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
  },
  signOutLink: {
    alignItems: 'center',
    paddingTop: Spacing.sm,
  },
  signOutText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
});
