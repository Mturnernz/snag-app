import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '../components/Button';
import Icon from '../components/Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { createHousehold, upsertProfile, signOut } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { Profile } from '../types';

interface Props {
  /** Null for an account that hasn't given a name yet. */
  profile: Profile | null;
  onReady: () => Promise<void>;
}

/**
 * Everything between signing up and using the app — which for a household is
 * two text fields, once, ever.
 *
 * The retired product needed eleven screens here: choose or create an
 * organisation, scan or paste a join code, pick a site, set up an admin, watch
 * an onboarding carousel. All of that existed to get a stranger into a company.
 * Nobody is a stranger to their own house.
 *
 * The second person doesn't create anything — they're added by the first, by
 * the address they signed up with, so their branch is just a message saying so.
 */
export default function SetupScreen({ profile, onReady }: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [householdName, setHouseholdName] = useState('');
  const [saving, setSaving] = useState(false);
  const [joining, setJoining] = useState(false);

  async function handleCreate() {
    if (!name.trim() || !householdName.trim()) return;
    setSaving(true);
    try {
      await upsertProfile(name.trim());
      await createHousehold(householdName.trim());
      await onReady();
    } catch (err: any) {
      showAlert("Couldn't set that up", err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleWaitToBeAdded() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // Saving the name is what makes this account addable: add_member_by_email
      // refuses an account with no profile row, because a household member with
      // no name is a blank row in every list.
      await upsertProfile(name.trim());
      setJoining(true);
    } catch (err: any) {
      showAlert("Couldn't save your name", err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (joining) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Icon name="home-outline" size="xxl" color={Colors.primary} />
        <Text style={styles.title}>You're ready</Text>
        <Text style={styles.body}>
          Ask whoever set up your household to add you. They'll need the email address you just
          signed up with.
        </Text>
        <Button label="Check again" onPress={onReady} fullWidth />
        <Button label="Sign out" variant="ghost" onPress={() => signOut()} fullWidth />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.xxxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Icon name="home" size="xxl" color={Colors.primary} />
        <Text style={styles.title}>Set up your house</Text>

        <Text style={styles.label}>What should we call you?</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Mike"
          placeholderTextColor={Colors.textMuted}
          maxLength={80}
          autoCapitalize="words"
        />

        <Text style={styles.label}>And the house?</Text>
        <TextInput
          style={styles.input}
          value={householdName}
          onChangeText={setHouseholdName}
          placeholder="Home"
          placeholderTextColor={Colors.textMuted}
          maxLength={80}
          autoCapitalize="words"
        />

        <Button
          label="Create it"
          onPress={handleCreate}
          loading={saving}
          disabled={!name.trim() || !householdName.trim() || saving}
          fullWidth
          style={styles.primaryAction}
        />

        <Text style={styles.divider}>or</Text>

        <Button
          label="Someone else set ours up"
          variant="outline"
          onPress={handleWaitToBeAdded}
          disabled={!name.trim() || saving}
          fullWidth
        />

        <Button label="Sign out" variant="ghost" onPress={() => signOut()} fullWidth />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xl, gap: Spacing.sm, alignItems: 'stretch' },
  centered: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.xl,
    gap: Spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  body: {
    fontSize: Typography.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  label: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    minHeight: MIN_TOUCH_TARGET,
  },
  primaryAction: { marginTop: Spacing.xl },
  divider: {
    textAlign: 'center',
    color: Colors.textMuted,
    fontSize: Typography.sm,
    marginVertical: Spacing.sm,
  },
});
