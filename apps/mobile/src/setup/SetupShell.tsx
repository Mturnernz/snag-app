import React from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';

import Button from '../components/Button';
import Icon, { type IconName } from '../components/Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useEdgeInsets } from '../hooks/useEdgeInsets';
import { useKeyboardInset } from '../hooks/useKeyboardInset';

interface Action {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

interface Props {
  /** Where in the run this is, for the dots. Absent on a screen outside the steps. */
  progress?: { index: number; total: number };
  onBack?: () => void;
  icon?: IconName;
  title: string;
  /** One line, never a paragraph: a question worth asking answers itself. */
  body?: string;
  children?: React.ReactNode;
  /** The one filled button. */
  primary?: Action;
  /** Words to press under it — *Set up later*, *Take me to the list*. */
  secondary?: Action;
}

/**
 * One question to a screen, the way a new phone asks them.
 *
 * Every step of first-run setup is drawn by this, so they read as one run
 * rather than a set of forms: dots at the top saying how far there is to go, a
 * large friendly title, at most one line under it, whatever the step needs,
 * and at the foot one filled button and, where there is one, a quiet second
 * choice. The foot is pinned, so the button never scrolls away from the
 * question it answers.
 *
 * The keyboard: `KeyboardAvoidingView` works on native and does nothing in a
 * browser, so the foot also takes `useKeyboardInset` as a margin — each is zero
 * where the other is working (see lib/keyboardInset.ts).
 */
export default function SetupShell({
  progress, onBack, icon, title, body, children, primary, secondary,
}: Props) {
  const edge = useEdgeInsets();
  const keyboard = useKeyboardInset();

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.top, { paddingTop: edge.top + Spacing.sm }]}>
        <View style={styles.backSlot}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              style={styles.back}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Icon name="chevron-back" size="lg" color={Colors.textPrimary} />
            </Pressable>
          ) : null}
        </View>
        {progress && progress.total > 1 ? (
          <View
            style={styles.dots}
            accessibilityRole="progressbar"
            accessibilityLabel={`Step ${progress.index + 1} of ${progress.total}`}
          >
            {Array.from({ length: progress.total }, (_, i) => (
              <View key={i} style={[styles.dot, i === progress.index && styles.dotOn]} />
            ))}
          </View>
        ) : null}
        <View style={styles.backSlot} />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {icon ? (
          <View style={styles.badge}>
            <Icon name={icon} size="xl" color={Colors.primary} />
          </View>
        ) : null}
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        {body ? <Text style={styles.body}>{body}</Text> : null}
        {children ? <View style={styles.children}>{children}</View> : null}
      </ScrollView>

      {primary || secondary ? (
        <View
          style={[
            styles.foot,
            { marginBottom: keyboard, paddingBottom: (keyboard > 0 ? 0 : edge.bottom) + Spacing.lg },
          ]}
        >
          {primary ? (
            <Button
              label={primary.label}
              onPress={primary.onPress}
              disabled={primary.disabled || primary.loading}
              loading={primary.loading}
              fullWidth
            />
          ) : null}
          {secondary ? (
            <Button
              label={secondary.label}
              variant="ghost"
              onPress={secondary.onPress}
              disabled={secondary.disabled || secondary.loading}
              loading={secondary.loading}
              fullWidth
            />
          ) : null}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** A labelled box, the one shape of text field in setup. */
export const setupStyles = StyleSheet.create({
  label: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    minHeight: MIN_TOUCH_TARGET + 4,
  },
  hint: { fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 19 },
});

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
  },
  backSlot: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET },
  back: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', gap: Spacing.sm - 2, alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.border },
  dotOn: { width: 20, backgroundColor: Colors.primary },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: Typography.largeTitle,
    lineHeight: 41,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  body: { fontSize: Typography.body, lineHeight: 24, color: Colors.textSecondary },
  children: { marginTop: Spacing.md, gap: Spacing.md },
  foot: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm, gap: Spacing.xs },
});
