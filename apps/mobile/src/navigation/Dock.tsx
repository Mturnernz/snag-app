import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import Icon, { type IconName } from '../components/Icon';
import { Text } from '../components/Text';
import { Colors, MIN_TOUCH_TARGET, Radius, Shadow, Spacing, Typography } from '../constants/theme';
import { useEdgeInsets } from '../hooks/useEdgeInsets';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import type { MainTabParamList } from '../types';

/**
 * The tab bar, as a floating glass dock — and the capture + beside it.
 *
 * **Glass floats; it never stacks.** The dock sits 26pt above the foot of the
 * screen with 16pt gutters, over the content rather than under it, so a list
 * scrolls on underneath and its photographs show through the blur. That is
 * what glass is for in Bone & Glass, and it is the only glass on a tab: a
 * sheet over the dock covers it rather than adding a second pane.
 *
 * **The + is the screen's, drawn by the dock.** The List's *Capture a new job*
 * and the House tab's *Add something to the house* are each a `Fab` in their
 * own screen, and a `Fab` inside the dock's provider hands itself to the dock
 * rather than drawing itself: one geometry, so the + and the dock line up on
 * every phone, and the dock gives up the + 's width only on a tab that has one.
 * A screen with no provider around it — every screen test — draws its own.
 *
 * **Nothing ends under the glass.** A tab's scroll pads its foot by
 * `useDockClearance()`, which is the dock's height and its gap and nothing on
 * a screen with no dock.
 *
 * **It gets out of the way of the keyboard.** A floating bar over a box being
 * typed into is a bar in front of the words, so it goes while the keyboard is
 * up.
 */

export const DOCK_HEIGHT = 64;
const FAB = 56;

interface DockAction {
  onPress: () => void;
  label: string;
  icon: IconName;
  disabled: boolean;
}

interface DockApi {
  register: (routeKey: string, action: DockAction | null) => void;
  bottom: number;
}

const DockContext = createContext<DockApi | null>(null);

/** Whether this screen is inside the dock — `Fab` hands itself over when it is. */
export function useDock(): DockApi | null {
  return useContext(DockContext);
}

/** How far a tab's scroll must pad its foot so its last row clears the dock. */
export function useDockClearance(): number {
  const dock = useContext(DockContext);
  return dock ? dock.bottom + DOCK_HEIGHT + Spacing.lg : 0;
}

const TAB_GLYPHS: Record<keyof MainTabParamList, [IconName, IconName]> = {
  // [inactive, active] — a filled glyph only for the active tab.
  Snags: ['list', 'list-fill'],
  House: ['house', 'house-fill'],
  Projects: ['projects', 'projects-fill'],
  Schedule: ['calendar', 'calendar-fill'],
  Profile: ['person', 'person-fill'],
};

/** Holds what each tab's + does, so the dock can draw the focused one's. */
export function DockProvider({ children }: { children: React.ReactNode }) {
  const edge = useEdgeInsets();
  const [actions, setActions] = useState<Record<string, DockAction>>({});
  const register = useCallback((routeKey: string, action: DockAction | null) => {
    setActions((now) => {
      const before = now[routeKey];
      if (!action) {
        if (!before) return now;
        const next = { ...now };
        delete next[routeKey];
        return next;
      }
      if (before && before.label === action.label && before.icon === action.icon
        && before.disabled === action.disabled && before.onPress === action.onPress) return now;
      return { ...now, [routeKey]: action };
    });
  }, []);
  // 26pt above the foot where the safe area is the 16pt floor, and the same
  // 10pt above a home indicator.
  const bottom = edge.bottom + 10;
  const api = useMemo(() => ({ register, bottom }), [register, bottom]);
  return (
    <DockContext.Provider value={api}>
      <DockActions.Provider value={actions}>{children}</DockActions.Provider>
    </DockContext.Provider>
  );
}

const DockActions = createContext<Record<string, DockAction>>({});

export default function Dock({ state, descriptors, navigation }: BottomTabBarProps) {
  const dock = useContext(DockContext);
  const actions = useContext(DockActions);
  const keyboard = useKeyboardInset();
  if (keyboard > 0) return null;

  const focused = state.routes[state.index];
  const action = actions[focused.key];
  const crowded = state.routes.length > 4;
  const bottom = dock?.bottom ?? Spacing.xxl;

  return (
    <View style={[styles.row, { bottom }]} pointerEvents="box-none">
      <View style={styles.dock}>
        {Platform.OS === 'web' ? (
          <View style={[StyleSheet.absoluteFill, styles.webGlass]} />
        ) : (
          <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
        )}
        <View style={[StyleSheet.absoluteFill, styles.tint]} />
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const { options } = descriptors[route.key];
          const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : route.name;
          const [inactive, active] = TAB_GLYPHS[route.name as keyof MainTabParamList] ?? ['list', 'list-fill'];
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={label}
            >
              <View style={[styles.capsule, isFocused && styles.capsuleOn]}>
                <Icon
                  name={isFocused ? active : inactive}
                  size="lg"
                  color={isFocused ? Colors.primary : Colors.chevron}
                />
                <Text
                  style={[styles.label, crowded && styles.labelCrowded, isFocused && styles.labelOn]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {action ? (
        <Pressable
          onPress={action.onPress}
          disabled={action.disabled}
          style={({ pressed }) => [styles.fab, action.disabled && styles.fabOff, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled: action.disabled }}
        >
          <Icon name={action.icon} size="xl" color={Colors.onPrimary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  dock: {
    flex: 1,
    height: DOCK_HEIGHT,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.glassEdge,
    ...Shadow.float,
  },
  // The web build's glass: a real backdrop blur where the browser has one, and
  // paper at 94% where it has not, so the words stay legible either way.
  webGlass: {
    backgroundColor: Colors.glassSolid,
    // @ts-expect-error react-native-web passes these through to CSS.
    backdropFilter: 'blur(18px) saturate(1.6)',
    WebkitBackdropFilter: 'blur(18px) saturate(1.6)',
  },
  tint: { backgroundColor: Platform.OS === 'web' ? 'transparent' : Colors.glass },
  tab: {
    flex: 1,
    height: DOCK_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: MIN_TOUCH_TARGET,
  },
  capsule: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
    minWidth: 52,
  },
  capsuleOn: { backgroundColor: Colors.primaryLight },
  label: {
    fontSize: Typography.footnote,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  labelCrowded: { fontSize: Typography.xs },
  labelOn: { color: Colors.primary, fontWeight: Typography.semibold },
  fab: {
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.fab,
  },
  fabOff: { backgroundColor: Colors.textMuted },
  pressed: { opacity: 0.85 },
});
