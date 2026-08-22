import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, LayoutChangeEvent } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing, ReduceMotion } from 'react-native-reanimated';
import { Colors, Spacing, Typography, Radius, Shadow } from '../constants/theme';

interface Option<T extends string> {
  key: T;
  label: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 'chip' scrolls horizontally with pill-shaped chips (filters).
   *  'segmented' is a fixed-width equal-share row (form controls). */
  variant?: 'chip' | 'segmented';
}

// Track padding, mirrored in styles.segmentedRow. The thumb is positioned
// against the track's padding box, which is where an absolutely positioned
// child starts and where onLayout measures a flex child from — so the two
// share one coordinate space and the thumb can be placed from measurements
// alone, with no arithmetic over borders and gaps.
const TRACK_PADDING = 3;
const SEGMENT_HEIGHT = 38;

interface Rect {
  x: number;
  width: number;
}

export default function Chip<T extends string>({ options, value, onChange, variant = 'chip' }: Props<T>) {
  const [rects, setRects] = useState<Record<string, Rect>>({});
  // The first measurement places the thumb; every later change slides it.
  // Without this the control would animate in from the left edge on mount.
  const placed = useRef(false);
  const x = useSharedValue(0);
  const width = useSharedValue(0);

  const moveTo = useCallback(
    (rect: Rect) => {
      if (placed.current) {
        const opts = { duration: 180, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System };
        x.value = withTiming(rect.x, opts);
        width.value = withTiming(rect.width, opts);
      } else {
        x.value = rect.x;
        width.value = rect.width;
        placed.current = true;
      }
    },
    [x, width]
  );

  const onSegmentLayout = useCallback(
    (key: string) => (e: LayoutChangeEvent) => {
      const { x: nx, width: nw } = e.nativeEvent.layout;
      setRects((prev) => {
        const cur = prev[key];
        if (cur && cur.x === nx && cur.width === nw) return prev;
        const next = { ...prev, [key]: { x: nx, width: nw } };
        // A re-layout (rotation, a font scale change) must move the thumb even
        // though `value` hasn't changed.
        if (key === value) moveTo(next[key]);
        return next;
      });
    },
    [value, moveTo]
  );

  const select = useCallback(
    (key: T) => {
      const rect = rects[key];
      if (rect) moveTo(rect);
      onChange(key);
    },
    [rects, moveTo, onChange]
  );

  const thumbStyle = useAnimatedStyle(() => ({
    width: width.value,
    transform: [{ translateX: x.value }],
  }));

  if (variant === 'segmented') {
    return (
      <View style={styles.segmentedRow}>
        {/* Drawn under the labels, so a label never fades with the thumb. Hidden
            until the first measurement lands, which is why width starts at 0. */}
        <Animated.View style={[styles.thumb, thumbStyle]} pointerEvents="none" />
        {options.map((opt) => {
          const active = opt.key === value;
          return (
            <TouchableOpacity
              key={opt.key}
              style={styles.segment}
              onLayout={onSegmentLayout(opt.key)}
              onPress={() => select(opt.key)}
              activeOpacity={0.7}
            >
              {/* Segments are equal-share, so a label longer than a third of the
                  screen wraps — and the row's fixed height clips the second line
                  rather than growing. Site names go in here (the invite form's
                  site picker, Manage's own tab bar), and they are as long as
                  somebody typed. */}
              <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]} numberOfLines={1}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <TouchableOpacity
            key={opt.key}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(opt.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  chipActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  chipLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  chipLabelActive: {
    color: Colors.primary,
    fontWeight: Typography.semibold,
  },
  segmentedRow: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: TRACK_PADDING,
    gap: 3,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    top: TRACK_PADDING,
    height: SEGMENT_HEIGHT,
    borderRadius: Radius.button - 2,
    backgroundColor: Colors.surface,
    ...Shadow.sm,
  },
  segment: {
    flex: 1,
    height: SEGMENT_HEIGHT,
    borderRadius: Radius.button - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  segmentLabelActive: {
    color: Colors.textPrimary,
    fontWeight: Typography.semibold,
  },
});
