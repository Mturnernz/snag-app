import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';

import { Colors, Spacing, Typography } from '../constants/theme';
import { countActiveOffscreen, FilterButtonLayout } from '../lib/filterSummary';
import Icon from './Icon';

// The snag list's filter bar: seven controls that don't fit one phone-width
// row, so the bar scrolls and the last two or three sit off the right-hand
// edge with nothing saying so. Two things address that, and they're the same
// fix twice:
//
//  - a fade on the right edge while there is more to scroll to, which is the
//    standard way to say "there's more" without spending a control on it;
//  - a count in that fade of how many *active* filters are currently out of
//    sight. The bar's rule is that a button renders active only when it
//    differs from its default — a fine rule right up until the button doing
//    the filtering is off screen. See lib/filterSummary.ts.
//
// The bar owns its own scroll position rather than lifting it to the screen,
// so a scroll frame re-renders seven chips and not the grid below them. It
// lives here rather than inside IssueListScreen so it can be rendered in a
// test at all: that screen imports lib/supabase, which throws at module scope
// without credentials.

export interface FilterButtonSpec {
  key: string;
  label: string;
  active: boolean;
  /** Opens a dropdown (chevron shown). Trending/Public/Assigned toggle on tap. */
  dropdown?: boolean;
  onPress: () => void;
}

const FILTER_FADE_WIDTH = 56;

export default function FilterBar({ buttons }: { buttons: FilterButtonSpec[] }) {
  const [scrollX, setScrollX] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [layouts, setLayouts] = useState<Record<string, FilterButtonLayout>>({});

  const measure = useCallback((key: string, layout: FilterButtonLayout) => {
    setLayouts((prev) => {
      const seen = prev[key];
      if (seen && seen.x === layout.x && seen.width === layout.width) return prev;
      return { ...prev, [key]: layout };
    });
  }, []);

  // 1px of slack — content and viewport widths are floats and can land a hair
  // apart at rest, which would leave the fade permanently on.
  const canScrollRight = contentWidth - viewportWidth - scrollX > 1;
  const hiddenActive = countActiveOffscreen(buttons, layouts, scrollX, viewportWidth);

  return (
    <View style={styles.filterWrap} onLayout={(e) => setViewportWidth(e.nativeEvent.layout.width)}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBarRow}
        scrollEventThrottle={32}
        onScroll={(e) => setScrollX(e.nativeEvent.contentOffset.x)}
        onContentSizeChange={(w) => setContentWidth(w)}
      >
        {buttons.map((b) => (
          <FilterBarButton key={b.key} spec={b} onMeasure={measure} />
        ))}
      </ScrollView>

      {canScrollRight && (
        <View style={styles.filterFade} pointerEvents="none">
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <LinearGradient id="filterFade" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={Colors.surface} stopOpacity="0" />
                <Stop offset="1" stopColor={Colors.surface} stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#filterFade)" />
          </Svg>
          {hiddenActive > 0 && (
            <View style={styles.filterHiddenCount}>
              <Text style={styles.filterHiddenCountText}>{hiddenActive}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// The chips are 34px tall — the one place this page bends MIN_TOUCH_TARGET
// (48), so seven controls fit a single scrollable row. That trade was about
// pixels on screen; it was never about the tap area, which nobody can see.
//
// The expansion is padding on the touchable pulled back by an equal negative
// margin, *not* hitSlop. hitSlop would be the obvious way to do this and it
// does not work: react-native-web's TouchableOpacity is built on
// usePressEvents and never reads the prop, so on the shipped web build
// (app.snaghq.co.nz) the chips would have silently stayed 34px targets — the
// same trap as calling Alert.alert directly. Padding is layout, so both
// platforms honour it.
//
// 7 vertical takes the box to 48 while it still occupies 34 of layout, so
// nothing moves. 4 horizontal is the most the row's Spacing.sm (8) gap
// allows: it leaves adjacent touch boxes exactly flush, never overlapping.
const CHIP_TOUCH_PAD_Y = 7;
const CHIP_TOUCH_PAD_X = 4;

function FilterBarButton({
  spec,
  onMeasure,
}: {
  spec: FilterButtonSpec;
  onMeasure: (key: string, layout: FilterButtonLayout) => void;
}) {
  const { key, label, active, onPress, dropdown = true } = spec;
  return (
    <TouchableOpacity
      style={styles.filterChipTouch}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onLayout={(e) => onMeasure(key, { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width })}
    >
      {/* The pill itself. Separate from the touchable because the touchable is
          48 tall and the pill has to stay 34 — put the border and fill on one
          element and the expansion becomes visible. */}
      <View style={[styles.filterBarButton, active && styles.filterBarButtonActive]}>
        <Text style={[styles.filterBarButtonText, active && styles.filterBarButtonTextActive]}>{label}</Text>
        {dropdown && (
          <Icon name="chevron-down" size="sm" color={active ? Colors.primary : Colors.textSecondary} />
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  filterWrap: {
    backgroundColor: Colors.surface,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  // Stops 1px short of the bottom so it doesn't paint over the bar's own
  // bottom border and leave a notch in it.
  filterFade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 1,
    width: FILTER_FADE_WIDTH,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: Spacing.lg,
  },
  filterHiddenCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterHiddenCountText: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.white,
  },
  filterBarRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  filterChipTouch: {
    paddingVertical: CHIP_TOUCH_PAD_Y,
    marginVertical: -CHIP_TOUCH_PAD_Y,
    paddingHorizontal: CHIP_TOUCH_PAD_X,
    marginHorizontal: -CHIP_TOUCH_PAD_X,
  },
  filterBarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 34,
    paddingHorizontal: Spacing.md,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  filterBarButtonActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  filterBarButtonText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  filterBarButtonTextActive: {
    color: Colors.primary,
    fontWeight: Typography.semibold,
  },
});

// Exported for the spec: the touch box has to reach MIN_TOUCH_TARGET on both
// platforms while the pill stays 34px, and that arithmetic is the whole fix.
export const CHIP_TOUCH_PADDING = { y: CHIP_TOUCH_PAD_Y, x: CHIP_TOUCH_PAD_X };
