import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createOrganisation, joinOrganisationByCode, signOut } from '../lib/supabase';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';

interface Props {
  userId: string;
  onComplete: () => void;
}

type Mode = 'choose' | 'create' | 'join';

export default function OrgSetupScreen({ userId, onComplete }: Props) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('choose');
  const [orgName, setOrgName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateOrg() {
    if (!orgName.trim()) {
      setError('Please enter your organisation name.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await createOrganisation(orgName.trim(), userId);
    if (error) {
      setError(error.message ?? 'Could not create organisation.');
    } else {
      onComplete();
    }
    setLoading(false);
  }

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
        <Text style={styles.appName}>Snag</Text>

        {mode === 'choose' && (
          <>
            <Text style={styles.heading}>Get started</Text>
            <Text style={styles.subheading}>Are you setting up Snag for your workplace, or joining an existing one?</Text>

            <TouchableOpacity style={styles.optionCard} onPress={() => setMode('create')} activeOpacity={0.85}>
              <Text style={styles.optionIcon}>🏢</Text>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>Create organisation</Text>
                <Text style={styles.optionDesc}>I'm setting up Snag for my workplace</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.optionCard} onPress={() => setMode('join')} activeOpacity={0.85}>
              <Text style={styles.optionIcon}>🔑</Text>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>Join with invite code</Text>
                <Text style={styles.optionDesc}>I have a code from my manager</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => signOut()} style={styles.signOutLink}>
              <Text style={styles.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </>
        )}

        {mode === 'create' && (
          <>
            <Text style={styles.heading}>Name your organisation</Text>
            <Text style={styles.subheading}>This is how your workplace will appear in Snag.</Text>

            <TextInput
              style={styles.input}
              placeholder="e.g. Acme Warehouse"
              placeholderTextColor={Colors.textMuted}
              value={orgName}
              onChangeText={setOrgName}
              returnKeyType="done"
              onSubmitEditing={handleCreateOrg}
              autoFocus
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleCreateOrg}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.buttonLabel}>Create Organisation</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => { setMode('choose'); setError(null); }}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
          </>
        )}

        {mode === 'join' && (
          <>
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

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleJoinOrg}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.buttonLabel}>Join Organisation</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => { setMode('choose'); setError(null); }}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
          </>
        )}
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
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  optionIcon: {
    fontSize: 28,
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
    color: '#DC2626',
    backgroundColor: '#FEF2F2',
    borderRadius: Radius.button,
    padding: Spacing.sm,
    textAlign: 'center',
  },
  button: {
    height: MIN_TOUCH_TARGET + 8,
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonLabel: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.white,
  },
  backText: {
    fontSize: Typography.sm,
    color: Colors.primary,
    textAlign: 'center',
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
