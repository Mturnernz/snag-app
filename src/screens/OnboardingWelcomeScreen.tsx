import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing, Typography, IconSize } from '../constants/theme';
import Card from '../components/Card';
import Icon from '../components/Icon';

interface Props {
  onReport: () => void;
  onShowMe: () => void;
}

// First screen a new worker sees. A deliberately bigger visual moment than
// the rest of the app's plain single-primary-action pattern — two large
// tappable cards rather than a button row, since this is the one place we
// want to slow someone down for a second before they start using the app.
export default function OnboardingWelcomeScreen({ onReport, onShowMe }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.xxxl, paddingBottom: insets.bottom + Spacing.xl }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Welcome to Snag</Text>
        <Text style={styles.subtitle}>Report issues, hazards, and incidents at your site in seconds.</Text>
      </View>

      <View style={styles.cards}>
        <TouchableOpacity activeOpacity={0.8} onPress={onReport}>
          <Card variant="elevated" elevation="md" style={styles.card}>
            <View style={styles.iconCircle}>
              <Icon name="camera-outline" size={IconSize.xl} color={Colors.primary} />
            </View>
            <Text style={styles.cardTitle}>Report a Snag</Text>
            <Text style={styles.cardSubtitle}>Jump straight into reporting an issue.</Text>
          </Card>
        </TouchableOpacity>

        <TouchableOpacity activeOpacity={0.8} onPress={onShowMe}>
          <Card variant="elevated" elevation="md" style={styles.card}>
            <View style={styles.iconCircle}>
              <Icon name="play-circle-outline" size={IconSize.xl} color={Colors.primary} />
            </View>
            <Text style={styles.cardTitle}>Show me how it works</Text>
            <Text style={styles.cardSubtitle}>A quick overview before you get started.</Text>
          </Card>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.xl,
    justifyContent: 'center',
  },
  header: {
    marginBottom: Spacing.xxxl,
    gap: Spacing.sm,
  },
  title: {
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: Typography.base,
    color: Colors.textSecondary,
    lineHeight: 21,
  },
  cards: {
    gap: Spacing.lg,
  },
  card: {
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: Radius.avatar,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  cardTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  cardSubtitle: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
  },
});
