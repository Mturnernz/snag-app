import React from 'react';
import { View, Text, StyleSheet, Clipboard } from 'react-native';
import { Colors, Spacing, Typography, Radius } from '../constants/theme';
import Card from './Card';
import Button from './Button';
import { useToast } from '../hooks/useToast';

interface Props {
  code: string;
  hint?: string;
  variant?: 'card' | 'compact';
}

export default function InviteCodeCard({
  code,
  hint = 'Share this 6-character code with colleagues so they can join your organisation.',
  variant = 'card',
}: Props) {
  const { showToast } = useToast();

  function handleCopy() {
    Clipboard.setString(code);
    showToast('Copied to clipboard');
  }

  if (variant === 'compact') {
    return (
      <View style={styles.compactRow}>
        <Text style={styles.compactCode}>{code}</Text>
        <Button label="Copy" variant="secondary" icon="copy-outline" onPress={handleCopy} />
      </View>
    );
  }

  return (
    <Card variant="elevated" elevation="md">
      <Text style={styles.label}>INVITE CODE</Text>
      <Text style={styles.code}>{code}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <Button label="Copy Code" variant="secondary" icon="copy-outline" onPress={handleCopy} style={styles.button} />
    </Card>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.8,
  },
  code: {
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    letterSpacing: 6,
    textAlign: 'center',
    paddingVertical: Spacing.sm,
  },
  hint: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  button: {
    marginTop: Spacing.xs,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.background,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  compactCode: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    letterSpacing: 3,
  },
});
