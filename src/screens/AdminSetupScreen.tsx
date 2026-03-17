import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  Clipboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Profile, Organisation } from '../types';
import { updateProfile } from '../lib/supabase';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';

interface Props {
  profile: Profile;
  onDone: (name: string) => void;
}

export default function AdminSetupScreen({ profile, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(profile.name ?? '');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const orgInviteCode = (profile.organisation as Organisation | undefined)?.invite_code ?? profile.invite_code;

  function handleCopyCode() {
    Clipboard.setString(orgInviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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
        <Text style={styles.bold}>{orgName}</Text> is ready. Set your name and share your invite code so your team can join.
      </Text>

      {/* Invite code */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>YOUR INVITE CODE</Text>
        <Text style={styles.inviteCode}>{orgInviteCode}</Text>
        <Text style={styles.cardHint}>
          Share this 6-character code with colleagues so they can join your organisation.
        </Text>
        <TouchableOpacity
          style={[styles.copyButton, copied && styles.copyButtonDone]}
          onPress={handleCopyCode}
          activeOpacity={0.8}
        >
          <Text style={[styles.copyButtonText, copied && styles.copyButtonTextDone]}>
            {copied ? '✓  Copied to clipboard' : '⧉  Copy Code'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Name */}
      <View style={styles.card}>
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
      </View>

      <TouchableOpacity
        style={[styles.button, saving && styles.buttonDisabled]}
        onPress={handleDone}
        disabled={saving}
        activeOpacity={0.85}
      >
        {saving ? (
          <ActivityIndicator color={Colors.white} />
        ) : (
          <Text style={styles.buttonLabel}>Enter App →</Text>
        )}
      </TouchableOpacity>
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
    fontSize: 32,
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
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  cardLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.8,
  },
  inviteCode: {
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    letterSpacing: 6,
    textAlign: 'center',
    paddingVertical: Spacing.sm,
  },
  cardHint: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    lineHeight: 18,
  },
  copyButton: {
    height: MIN_TOUCH_TARGET - 8,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyButtonDone: {
    backgroundColor: '#ECFDF5',
  },
  copyButtonText: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
  copyButtonTextDone: {
    color: '#10B981',
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
  button: {
    height: MIN_TOUCH_TARGET + 8,
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonLabel: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.white,
  },
});
