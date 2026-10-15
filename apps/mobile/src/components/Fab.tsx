import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import * as Navigation from '@react-navigation/native';

import Icon, { type IconName } from './Icon';
import { Colors, Shadow, Spacing } from '../constants/theme';
import { useDock } from '../navigation/Dock';

/**
 * The capture + — the List tab's way to capture a job and the House tab's way
 * to record a thing. One component so the two cannot drift apart.
 *
 * **Inside the app it is drawn by the dock**, beside the floating tab bar
 * (`navigation/Dock.tsx`): this hands the dock what it does and draws nothing
 * itself, so the + and the dock share one geometry. Outside a dock — a screen
 * rendered on its own, as every screen test is — it draws itself in the
 * bottom-right corner, 56pt and `Spacing.lg` in, as it always did.
 */
// A screen test that mocks the navigation library has no route context; it
// then reads as "not inside a tab", and the + draws itself.
const NoRoute = createContext<{ key: string } | undefined>(undefined);
const RouteContext = (Navigation as { NavigationRouteContext?: typeof NoRoute }).NavigationRouteContext ?? NoRoute;

export default function Fab({
  onPress, accessibilityLabel, icon = 'add', bottom = Spacing.lg, disabled = false,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  icon?: IconName;
  bottom?: number;
  disabled?: boolean;
}) {
  const dock = useDock();
  const route = useContext(RouteContext);
  const latest = useRef(onPress);
  latest.current = onPress;
  // One stable function per mount, so the dock is not re-rendered on every
  // render of the screen; it calls whatever `onPress` is current.
  const stable = useRef(() => latest.current()).current;
  const handled = !!(dock && route);

  useEffect(() => {
    if (!dock || !route) return undefined;
    dock.register(route.key, { onPress: stable, label: accessibilityLabel, icon, disabled });
    return () => dock.register(route.key, null);
  }, [dock, route?.key, accessibilityLabel, icon, disabled]);

  if (handled) return null;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.fab, { bottom }, disabled && styles.off]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <Icon name={icon} size="xl" color={Colors.white} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.fab,
  },
  off: { backgroundColor: Colors.textMuted },
});
