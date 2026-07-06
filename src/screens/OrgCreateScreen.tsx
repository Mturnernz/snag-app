import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createOrganisationAndOwner } from '../lib/supabase';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import Button from '../components/Button';
import Icon from '../components/Icon';

interface Props {
  userId: string;
  onComplete: () => void;
  onBack: () => void;
}

export default function OrgCreateScreen({ onComplete, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [orgName, setOrgName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateOrg() {
    if (!orgName.trim()) {
      setError('Please enter your organisation name.');
      return;
    }
    setLoading(true);
    setError(null);
    // Owner name is intentionally blank here — AdminSetupScreen collects and
    // saves the real name right after org creation via updateProfile.
    const { error } = await createOrganisationAndOwner(orgName.trim(), '');
    if (error) {
      setError(error.message ?? 'Could not create organisation.');
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

        <Button label="Create Organisation" onPress={handleCreateOrg} loading={loading} fullWidth />

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
