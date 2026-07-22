import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Profile } from '../types';
import { updateProfile } from '../lib/supabase';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import Card from '../components/Card';
import Button from '../components/Button';

interface Props {
  profile: Profile;
  onDone: (name: string) => void;
}

export default function AdminSetupScreen({ profile, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(profile.name ?? '');
  const [saving, setSaving] = useState(false);

  async function handleDone() {
    setSaving(true);
    if (name.trim()) {
      await updateProfile(profile.id, { name: name.trim() });
    }
    setSaving(false);
    onDone(name.trim());
  }

  const orgName = (profile.organisation as any)?.name ?? 'Your Organisation';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.appName}>Snag</Text>
      <Text style={styles.heading}>Welcome, Admin!</Text>
      <Text style={styles.subheading}>
        <Text style={styles.bold}>{orgName}</Text> is ready. Set your name to get started — you can invite your team from the Admin tab.
      </Text>

      <Card variant="elevated" elevation="md">
        <Text style={styles.cardLabel}>YOUR NAME</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Jane Smith"
          placeholderTextColor={Colors.textMuted}
          value={name}
          onChangeText={setName}
          returnKeyType="done"
          onSubmitEditing={handleDone}
        />
        <Text style={styles.cardHint}>This is how you'll appear to your team.</Text>
      </Card>

      <Button label="Enter App" onPress={handleDone} loading={saving} fullWidth icon="arrow-forward" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
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
  bold: {
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  cardLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  cardHint: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    lineHeight: 18,
    marginTop: Spacing.sm,
  },
  input: {
    height: MIN_TOUCH_TARGET,
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
});
