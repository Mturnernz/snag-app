import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Card from '../components/Card';
import Button from '../components/Button';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import ConfirmDialog from '../components/ConfirmDialog';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import {
  deleteMyAccount, deleteStoredFiles, getMyOrphanFilePaths, signOut, upsertProfile,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { profile, household, members, locations, reloadAccount } = useHousehold();
  const { showToast } = useToast();

  const [name, setName] = useState(profile.displayName);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = name.trim() !== profile.displayName && name.trim().length > 0;

  async function handleSave() {
    setSaving(true);
    try {
      await upsertProfile(name.trim());
      await reloadAccount();
      showToast('Saved');
    } catch (err: any) {
      showAlert("Couldn't save that", err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAccount() {
    setConfirmDelete(false);
    try {
      // Files first. The storage delete policy asks whether you are a member of
      // the household a file's folder names, so an account that has just deleted
      // itself can no longer clear up after itself — and deleteStoredFiles never
      // throws, so every refusal would pass in silence. Same rule as deleting a
      // household, for the same reason. See 20260914161000.
      await deleteStoredFiles(await getMyOrphanFilePaths());
      await deleteMyAccount();
      // The session now belongs to an account that doesn't exist. signOut is
      // bounded and falls back to dropping the stored session, so it gets out
      // even though nothing it asks the server can succeed.
      await signOut();
    } catch (err: any) {
      showAlert("Couldn't delete your account", err?.message ?? 'Please try again.');
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.md }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Avatar name={profile.displayName} size={64} ring />
        <Text style={styles.name}>{profile.displayName}</Text>
      </View>

      <Card elevation="md" style={styles.section}>
        <Text style={styles.sectionTitle}>Your name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          maxLength={80}
          autoCapitalize="words"
        />
        {dirty ? (
          <Button label="Save" onPress={handleSave} loading={saving} fullWidth />
        ) : null}
      </Card>

      <Pressable onPress={() => navigation.navigate('Household')}>
        <Card elevation="md" style={styles.linkRow}>
          <Icon name="home-outline" size="md" color={Colors.primary} />
          <View style={styles.linkBody}>
            <Text style={styles.linkTitle}>{household.name}</Text>
            <Text style={styles.linkHint}>
              {members.length} {members.length === 1 ? 'person' : 'people'}
            </Text>
          </View>
          <Icon name="chevron-forward" size="md" color={Colors.textMuted} />
        </Card>
      </Pressable>

      {/*
        The tags are the one piece of setup a household actually outgrows —
        `Elsewhere` was the escape hatch until this screen existed. It lives here
        rather than at capture because it is a sit-down job, and capture is not.
      */}
      <Pressable onPress={() => navigation.navigate('LocationTags')}>
        <Card elevation="md" style={styles.linkRow}>
          <Icon name="pricetags-outline" size="md" color={Colors.primary} />
          <View style={styles.linkBody}>
            <Text style={styles.linkTitle}>Location tags</Text>
            <Text style={styles.linkHint}>
              {locations.length} offered when you add something
            </Text>
          </View>
          <Icon name="chevron-forward" size="md" color={Colors.textMuted} />
        </Card>
      </Pressable>

      <Button
        label="Sign out"
        variant="outline"
        onPress={async () => {
          const { forced } = await signOut();
          if (forced) showToast('Signed out');
        }}
        fullWidth
        style={styles.signOut}
      />

      {/* Signing out is the everyday door and deleting is the other one, so it
          sits below, quieter, and asks for the name to be typed — the same gate
          deleting a place uses, for the same reason: this one takes other
          people's work with it if you are the only one in the house. */}
      <Button
        label="Delete my account"
        variant="ghost"
        onPress={() => setConfirmDelete(true)}
        fullWidth
      />
      <Text style={styles.deleteHint}>
        Any household you're the only one in goes with you, and so does everything in it. Ones you
        share stay, and so does what you filed in them.
      </Text>

      <ConfirmDialog
        visible={confirmDelete}
        title="Delete your account?"
        message={
          "You'll be signed out for good. Any household you're the only one in is deleted with " +
          'every snag, thing and photo in it. This cannot be undone.'
        }
        confirmLabel="Delete"
        confirmText={profile.displayName}
        destructive
        onConfirm={handleDeleteAccount}
        onCancel={() => setConfirmDelete(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxxl },
  header: { alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  name: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  section: { gap: Spacing.sm },
  sectionTitle: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  input: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    minHeight: MIN_TOUCH_TARGET,
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  linkBody: { flex: 1 },
  linkTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  linkHint: { fontSize: Typography.sm, color: Colors.textMuted },
  signOut: { marginTop: Spacing.md },
  deleteHint: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
});
