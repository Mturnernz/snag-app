import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Card from '../components/Card';
import Button from '../components/Button';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { signOut, upsertProfile } from '../lib/supabase';
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
});
