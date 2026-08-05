import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import Icon from './Icon';

interface Props {
  stepNumber: number;
  stepCount: number;
  /** The paused step's title, so the bar says what you'd be going back to. */
  title: string;
  onResume: () => void;
  onDismiss: () => void;
}

/**
 * The way back into a paused walkthrough.
 *
 * A pause with no visible way to un-pause is an abandon with extra steps —
 * Profile → Walkthrough exists, but nobody who paused at step 4 goes hunting
 * for it. This sits above the tab bar on every screen until the walkthrough is
 * resumed or finished.
 *
 * Dismiss is session-only, on purpose. The bar is mildly annoying and that is
 * the point: it is the only thing between a half-configured organisation and
 * one nobody ever came back to.
 */
export default function TourResumeBar({ stepNumber, stepCount, title, onResume, onDismiss }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      // Sits above the 60pt tab bar rather than over it, so it never covers the
      // thing somebody is trying to tap to get away from it.
      style={[styles.wrap, { bottom: insets.bottom + TAB_BAR_HEIGHT + Spacing.sm }]}
      pointerEvents="box-none"
    >
      <View style={styles.bar}>
        <Icon name="school-outline" size="sm" color={Colors.primary} />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            Walkthrough paused
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            Step {stepNumber} of {stepCount}
            {title ? ` · ${title}` : ''}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onResume}
          style={styles.resume}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Resume the walkthrough"
        >
          <Text style={styles.resumeText}>Resume</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Hide until next time"
          style={styles.dismiss}
        >
          <Icon name="close" size="sm" color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Mirrors `navigation/index.tsx`'s tabBar height. */
const TAB_BAR_HEIGHT = 60;

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    ...Shadow.lg,
  },
  text: { flex: 1 },
  title: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
  },
  resume: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  resumeText: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
  dismiss: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
});
