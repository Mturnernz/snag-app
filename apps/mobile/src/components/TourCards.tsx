import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, type LayoutChangeEvent,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';

import Icon, { type IconName } from './Icon';
import Button from './Button';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { labelReadingEnabled } from '../lib/labelReading';
import type { FirstAction } from '../hooks/useFirstCapture';

export interface TourCard {
  key: FirstAction;
  icon: IconName;
  title: string;
  body: string;
  /** What *Try it* opens, in words. */
  tryLabel: string;
}

/**
 * The three things Snag is for, one card each.
 *
 * Every sentence is something the app does today. The appliance card says the
 * label is read **only while label reading is on** (`lib/labelReading.ts`):
 * a tour promising the label fills itself in, on a build where it does not,
 * would be the app's first claim to somebody and an untrue one.
 */
export function tourCards(): TourCard[] {
  return [
    {
      key: 'addRoom',
      icon: 'home-outline',
      title: 'Set up your house',
      body: 'Add the rooms you have on the House tab. Jobs and everything you record are filed by room.',
      tryLabel: 'Add a room',
    },
    {
      key: 'addThing',
      icon: 'cube-outline',
      title: 'Add an appliance',
      body: labelReadingEnabled()
        ? 'Photograph its label. Snag reads the make and model, and suggests the room — you check it before it is kept.'
        : 'Photograph its label and add the make and model, so the right part is on hand in the shop.',
      tryLabel: 'Record an appliance',
    },
    {
      key: 'logJob',
      icon: 'camera-outline',
      title: 'Log an issue',
      body: 'Tap + on the list and photograph what needs doing, or type a line. It goes on the list your house shares.',
      tryLabel: 'Log a job',
    },
  ];
}

interface Props {
  index: number;
  onIndex: (next: number) => void;
  /** *Try it* on each card. Absent where there is nothing to open into. */
  onTry?: (action: FirstAction) => void;
}

/**
 * Swipeable, with dots, and driven by `index` so the screen's own buttons can
 * page it too — a desktop has no swipe, and a carousel that only moves under a
 * finger is one half the people opening this cannot turn.
 */
export default function TourCards({ index, onIndex, onTry }: Props) {
  const cards = tourCards();
  const [width, setWidth] = useState(0);
  const scroller = useRef<ScrollView>(null);

  useEffect(() => {
    if (width > 0) scroller.current?.scrollTo({ x: index * width, animated: true });
  }, [index, width]);

  function onLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  function onSettle(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (width <= 0) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index && next >= 0 && next < cards.length) onIndex(next);
  }

  return (
    <View onLayout={onLayout}>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onSettle}
        accessibilityRole="adjustable"
        accessibilityLabel={`${cards[index].title}, ${index + 1} of ${cards.length}`}
      >
        {cards.map((card) => (
          <View key={card.key} style={[styles.page, width > 0 && { width }]}>
            <View style={styles.card}>
              <View style={styles.badge}>
                <Icon name={card.icon} size="xl" color={Colors.primary} />
              </View>
              <Text style={styles.title}>{card.title}</Text>
              <Text style={styles.body}>{card.body}</Text>
              {onTry ? (
                <Button
                  label={card.tryLabel}
                  variant="outline"
                  onPress={() => onTry(card.key)}
                />
              ) : null}
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {cards.map((card, i) => (
          <View key={card.key} style={[styles.dot, i === index && styles.dotOn]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: Spacing.xs },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.xl,
    gap: Spacing.md,
    alignItems: 'flex-start',
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  body: { fontSize: Typography.base, color: Colors.textSecondary, lineHeight: 22 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm - 2, marginTop: Spacing.md },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.border },
  dotOn: { width: 20, backgroundColor: Colors.primary },
});
