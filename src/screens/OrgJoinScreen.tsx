import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getInvitePreview, acceptInvite, InvitePreview } from '../lib/supabase';
import { ROLE_LABELS } from '../types';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import Button from '../components/Button';
import Card from '../components/Card';
import Icon from '../components/Icon';

interface Props {
  userId: string;
  onComplete: () => void;
  onBack: () => void;
}

export default function OrgJoinScreen({ onComplete, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [name, setName] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLookUp() {
    if (!token.trim()) {
      setError('Please paste the invite code from your email.');
      return;
    }
    setLoadingPreview(true);
    setError(null);
    const { data, error } = await getInvitePreview(token.trim());
    setLoadingPreview(false);

    if (error || !data) {
      setError('That invite code is invalid or has expired.');
      return;
    }
    if (data.status !== 'pending') {
      setError('That invite has already been used or was revoked.');
      return;
    }
    setPreview(data as InvitePreview);
  }

  async function handleAccept() {
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    setAccepting(true);
    setError(null);
    const { error } = await acceptInvite(token.trim(), name.trim());
    setAccepting(false);
    if (error) {
      setError(error.message);
      return;
    }
    onComplete();
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        {!preview ? (
          <>
            <Text style={styles.heading}>Enter your invite code</Text>
            <Text style={styles.subheading}>Paste the code your admin or supervisor emailed you.</Text>

            <TextInput
              style={styles.input}
              placeholder="Invite code"
              placeholderTextColor={Colors.textMuted}
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleLookUp}
              autoFocus
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Button label="Look Up Invite" onPress={handleLookUp} loading={loadingPreview} fullWidth />
          </>
        ) : (
          <>
            <Text style={styles.heading}>Join {preview.org_name}</Text>
            <Text style={styles.subheading}>
              {preview.site_name ? `${preview.site_name} · ` : ''}{ROLE_LABELS[preview.role]}
            </Text>

            <Card variant="outlined">
              <Text style={styles.previewEmail}>{preview.email}</Text>
            </Card>

            <TextInput
              style={styles.input}
              placeholder="Your name"
              placeholderTextColor={Colors.textMuted}
              value={name}
              onChangeText={setName}
              returnKeyType="done"
              onSubmitEditing={handleAccept}
              autoFocus
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Button label="Accept & Join" onPress={handleAccept} loading={accepting} fullWidth />
          </>
        )}

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
  previewEmail: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
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
