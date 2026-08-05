import { CommonActions, createNavigationContainerRef } from '@react-navigation/native';

import { RootStackParamList, MainTabParamList } from '../types';

// A navigation handle for code that sits outside the navigator.
//
// The walkthrough is the reason this exists. It has to switch tabs — a step
// pointing at the filter bar is useless while the Report tab is showing — but
// it is mounted wrapping `RootNavigator`, not inside it, so `useNavigation()`
// throws there. It has to be mounted at that level: an overlay rendered inside
// a screen cannot cut a hole over the tab bar, and the tab bar is the first
// thing the walkthrough points at.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Switch to a tab inside MainTabNavigator.
 *
 * Nested tab selection is `navigate('Main', { screen })`, which `RootStackParamList`
 * deliberately doesn't type — saying so needs React Navigation's
 * `NavigatorScreenParams`, and that type lives in a package `@snag/shared-types`
 * is shared with `apps/web` and shouldn't drag in. `CommonActions.navigate`
 * takes the same action untyped, so this is the one place that knows the shape
 * and every caller gets a checked `keyof MainTabParamList` instead of a cast.
 */
export function navigateToTab(tab: keyof MainTabParamList): void {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(CommonActions.navigate({ name: 'Main', params: { screen: tab } }));
}

/**
 * The focused tab, or null before the navigator is ready.
 *
 * Used to skip navigating to the tab somebody is already on: on the web build
 * React Navigation writes the URL back on every navigation, and re-navigating
 * on each Next would rewrite it for no reason.
 */
export function currentTabName(): keyof MainTabParamList | null {
  if (!navigationRef.isReady()) return null;
  const root = navigationRef.getRootState();
  const active = root.routes[root.index];
  if (active?.name !== 'Main') return null;
  const tabs = active.state;
  if (!tabs || tabs.index === undefined) return null;
  return (tabs.routes[tabs.index]?.name as keyof MainTabParamList) ?? null;
}
