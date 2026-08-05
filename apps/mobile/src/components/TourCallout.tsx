import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, LayoutChangeEvent } from 'react-native';
import { TourStep } from '@snag/onboarding-guide';

import { Colors, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { navigationRef } from '../lib/navigationRef';
import Icon from './Icon';

interface Props {
  step: TourStep | null;
  stepNumber: number;
  stepCount: number;
  finished: boolean;
  canAdvance: boolean;
  onNext: () => void;
  onBack: () => void;
  onPause: () => void;
  onFinish: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
}

/**
 * The verb, per step action.
 *
 * A card that opens with "Tap" or "Type" reads as an instruction; one that
 * opens with the title alone reads as a caption, and people press Next without
 * doing anything. `look` gets no lead-in on purpose — there is nothing to do,
 * and inventing an imperative for it would train people to ignore the others.
 */
const ACTION_LEAD: Record<TourStep['action'], { label: string; icon: React.ComponentProps<typeof Icon>['name'] } | null> = {
  tap: { label: 'Tap', icon: 'hand-left-outline' },
  type: { label: 'Type', icon: 'create-outline' },
  choose: { label: 'Choose', icon: 'options-outline' },
  look: null,
};

export default function TourCallout({
  step,
  stepNumber,
  stepCount,
  finished,
  canAdvance,
  onNext,
  onBack,
  onPause,
  onFinish,
  onLayout,
}: Props) {
  // `navigationRef`, not `useNavigation` — this renders inside the overlay,
  // which is mounted wrapping the navigator rather than inside it, so the
  // navigation context isn't available here.
  const openGuide = (section?: string) => {
    if (navigationRef.isReady()) navigationRef.navigate('HelpGuide', section ? { section } : undefined);
  };

  if (finished) {
    return (
      <View style={styles.card} onLayout={onLayout}>
        <View style={styles.headerRow}>
          <Icon name="checkmark-circle" size="md" color={Colors.success} />
          <Text style={styles.title}>That&apos;s the tour</Text>
        </View>
        <Text style={styles.body}>
          You can run it again any time from Profile → Walkthrough, and the full guide — written
          for your role — is under Help &amp; guide.
        </Text>
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.readMore}
            onPress={() => {
              onFinish();
              openGuide();
            }}
            hitSlop={8}
          >
            <Text style={styles.readMoreText}>Open the guide</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navButton, styles.navButtonPrimary]} onPress={onFinish}>
            <Text style={styles.navButtonPrimaryText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!step) return <View onLayout={onLayout} />;

  const lead = ACTION_LEAD[step.action];
  const isFirst = stepNumber <= 1;
  const blocked = !canAdvance;

  return (
    <View style={styles.card} onLayout={onLayout}>
      <View style={styles.headerRow}>
        {lead && <Icon name={lead.icon} size="sm" color={Colors.primary} />}
        <Text style={styles.progress}>
          Step {stepNumber} of {stepCount}
        </Text>
        <View style={styles.spacer} />
        <TouchableOpacity
          onPress={onPause}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Pause the walkthrough"
          style={styles.pause}
        >
          <Icon name="pause-outline" size="sm" color={Colors.textMuted} />
          <Text style={styles.pauseText}>Pause</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>{step.title}</Text>
      <Text style={styles.body}>
        {lead ? <Text style={styles.lead}>{lead.label} — </Text> : null}
        {step.body}
      </Text>

      {blocked && (
        <View style={styles.blockedRow}>
          <Icon name="arrow-up-circle-outline" size="sm" color={Colors.primary} />
          <Text style={styles.blockedText}>
            Give it a go — Next opens up once you have.
          </Text>
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity
          onPress={onBack}
          disabled={isFirst}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous step"
          style={[styles.navButton, isFirst && styles.navButtonDisabled]}
        >
          <Icon
            name="chevron-back"
            size="sm"
            color={isFirst ? Colors.textMuted : Colors.textPrimary}
          />
          <Text style={[styles.navButtonText, isFirst && styles.navButtonTextDisabled]}>Back</Text>
        </TouchableOpacity>

        {/* The escape hatch on a gated step. Without it an empty org, a denied
            camera permission or a flat battery on the site's only tablet is a
            walkthrough nobody can get past. */}
        {blocked && (
          <TouchableOpacity onPress={onNext} hitSlop={8} style={styles.skip}>
            <Text style={styles.skipText}>Skip this step</Text>
          </TouchableOpacity>
        )}

        <View style={styles.spacer} />

        <TouchableOpacity
          onPress={onNext}
          disabled={blocked}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={stepNumber >= stepCount ? 'Finish the walkthrough' : 'Next step'}
          style={[styles.navButton, styles.navButtonPrimary, blocked && styles.navButtonDisabled]}
        >
          <Text
            style={[styles.navButtonPrimaryText, blocked && styles.navButtonTextDisabled]}
          >
            {stepNumber >= stepCount ? 'Finish' : 'Next'}
          </Text>
          <Icon
            name="chevron-forward"
            size="sm"
            color={blocked ? Colors.textMuted : Colors.white}
          />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.readMore}
        // Pause rather than dismiss: reading the long form is a detour, not a
        // decision to abandon the walkthrough, and the resume bar is what
        // brings somebody back from it.
        onPress={() => {
          onPause();
          openGuide(step.sectionId);
        }}
        hitSlop={8}
      >
        <Icon name="book-outline" size="sm" color={Colors.primary} />
        <Text style={styles.readMoreText}>Read more in the guide</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  progress: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.primary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  spacer: { flex: 1 },
  pause: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  pauseText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  title: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  body: {
    fontSize: Typography.base,
    lineHeight: 21,
    color: Colors.textSecondary,
  },
  lead: {
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.button,
    padding: Spacing.sm,
  },
  blockedText: {
    flex: 1,
    fontSize: Typography.sm,
    color: Colors.textPrimary,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.button,
  },
  navButtonPrimary: {
    backgroundColor: Colors.primary,
  },
  navButtonDisabled: {
    opacity: 0.5,
  },
  navButtonText: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  navButtonPrimaryText: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.white,
  },
  navButtonTextDisabled: {
    color: Colors.textMuted,
  },
  skip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  skipText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textDecorationLine: 'underline',
  },
  readMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  readMoreText: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
});
