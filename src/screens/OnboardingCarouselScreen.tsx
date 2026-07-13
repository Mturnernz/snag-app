import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing, Typography, IconSize } from '../constants/theme';
import Icon from '../components/Icon';
import Button from '../components/Button';

interface Slide {
  icon: React.ComponentProps<typeof Icon>['name'];
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    icon: 'git-compare-outline',
    title: 'Niggle vs Serious Incident',
    body: 'Everyday niggles — like broken gear — and serious incidents — like injuries or hazards — are tracked in separate lanes, so pick the right one when you report.',
  },
  {
    icon: 'camera-outline',
    title: 'How to log a snag',
    body: 'Take a photo, pick a category, and add a quick description. Most reports take under a minute.',
  },
  {
    icon: 'shield-checkmark-outline',
    title: 'Serious incidents',
    body: "You don't investigate serious incidents yourself — reporting one flags it straight to your supervisor or admin.",
  },
  {
    icon: 'list-outline',
    title: 'Your Snag List',
    body: 'Filter your Snag List by status, date, or category to see what’s open, in progress, or resolved.',
  },
];

interface Props {
  onFinish: () => void;
}

// Reusable 4-screen overview carousel — mounted two ways: as part of the
// first-run onboarding gate in App.tsx (onFinish marks the flag seen), and
// as a "Replay tutorial" modal route from Profile (onFinish just navigates
// back). No pager dependency: reuses the same horizontal paging ScrollView
// + onScroll index-tracking pattern already used for the multi-photo
// gallery in IssueDetailScreen.
export default function OnboardingCarouselScreen({ onFinish }: Props) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const width = Dimensions.get('window').width;

  function goToNext() {
    if (index >= SLIDES.length - 1) {
      onFinish();
      return;
    }
    scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.skip, { top: insets.top + Spacing.md }]}
        onPress={onFinish}
        hitSlop={8}
      >
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
        }}
        scrollEventThrottle={32}
      >
        {SLIDES.map((slide) => (
          <View key={slide.title} style={[styles.slide, { width }]}>
            <View style={styles.iconCircle}>
              <Icon name={slide.icon} size={IconSize.xxl} color={Colors.primary} />
            </View>
            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.body}>{slide.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={styles.dots}>
          {SLIDES.map((slide, i) => (
            <View key={slide.title} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
        <Button
          label={index === SLIDES.length - 1 ? 'Got it' : 'Next'}
          onPress={goToNext}
          fullWidth
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  skip: {
    position: 'absolute',
    right: Spacing.lg,
    zIndex: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  skipText: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxxl,
    gap: Spacing.lg,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: Radius.avatar,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontSize: Typography.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    gap: Spacing.lg,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.avatar,
    backgroundColor: Colors.border,
  },
  dotActive: {
    backgroundColor: Colors.primary,
    width: 20,
  },
});
