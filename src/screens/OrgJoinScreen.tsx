import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { joinOrganisationByCode } from '../lib/supabase';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import Button from '../components/Button';
import Icon from '../components/Icon';

interface Props {
  userId: string;
  onComplete: () => void;
  onBack: () => void;
}

export default function OrgJoinScreen({ userId, onComplete, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoinOrg() {
    if (!inviteCode.trim()) {
      setError('Please enter an invite code.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await joinOrganisationByCode(inviteCode.trim(), userId);
    if (error) {
      setError(error.message ?? 'Could not join organisation.');
    } else {
      onComplete();
    }
    setLoading(false);
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.heading}>Enter invite code</Text>
        <Text style={styles.subheading}>Ask your manager for the 6-character code from their profile.</Text>

        <TextInput
          style={[styles.input, styles.codeInput]}
          placeholder="ABC123"
          placeholderTextColor={Colors.textMuted}
          value={inviteCode}
          onChangeText={(t) => setInviteCode(t.toUpperCase())}
          autoCapitalize="characters"
          maxLength={6}
          returnKeyType="done"
          onSubmitEditing={handleJoinOrg}
          autoFocus
        />

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Button label="Join Organisation" onPress={handleJoinOrg} loading={loading} fullWidth />

        <TouchableOpacity onPress={onBack} style={styles.backRow}>
          <Icon name="arrow-back" size="sm" color={Colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
  input: {
    height: MIN_TOUCH_TARGET,
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  codeInput: {
    textAlign: 'center',
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    letterSpacing: 8,
  },
  errorText: {
    fontSize: Typography.sm,
    color: Colors.danger,
    backgroundColor: Colors.priority.highBg,
    borderRadius: Radius.button,
    padding: Spacing.sm,
    textAlign: 'center',
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  backText: {
    fontSize: Typography.sm,
    color: Colors.primary,
  },
});
