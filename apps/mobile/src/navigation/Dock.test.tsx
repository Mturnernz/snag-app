import React from 'react';
import { StyleSheet, Text } from 'react-native';
import TestRenderer from 'react-test-renderer';
import { NavigationRouteContext } from '@react-navigation/native';

import Dock, { DOCK_HEIGHT, DockProvider, useDockClearance } from './Dock';
import Fab from '../components/Fab';
import { Spacing } from '../constants/theme';

// The dock is the one thing on screen that must not move when the tab does.
// It used to give up the + 's width on List and House, so it was a different
// size there from Projects, Schedule and You, and its labels ran together.
// These pin one width on every tab, and the + as the dock's own centre item
// on all of them (November 2026): floating above the list it covered a tick.

jest.mock('expo-blur', () => ({ BlurView: () => null }));

const ROUTES = ['Snags', 'House', 'Projects', 'Schedule', 'Profile'].map((name) => ({
  key: `${name}-key`,
  name,
}));

function dockProps(index: number): any {
  return {
    state: { index, routes: ROUTES },
    descriptors: Object.fromEntries(ROUTES.map((r) => [r.key, { options: {} }])),
    navigation: { emit: () => ({ defaultPrevented: false }), navigate: jest.fn() },
  };
}

/** A tab's screen: optionally a +, and the clearance it pads its scroll by. */
function Screen({ withFab }: { withFab: boolean }) {
  const clearance = useDockClearance();
  return (
    <>
      <Text testID="clearance">{String(clearance)}</Text>
      {withFab ? <Fab onPress={() => {}} accessibilityLabel="Capture a new job" /> : null}
    </>
  );
}

function renderTab(index: number, withFab: boolean) {
  const route = ROUTES[index];
  let tree!: TestRenderer.ReactTestRenderer;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <DockProvider>
        <NavigationRouteContext.Provider value={route as any}>
          <Screen withFab={withFab} />
        </NavigationRouteContext.Provider>
        <Dock {...dockProps(index)} />
      </DockProvider>,
    );
  });
  return tree;
}

/** The dock's own frame: the absolutely placed view holding the tabs. */
function dockFrame(tree: TestRenderer.ReactTestRenderer) {
  const frames = tree.root.findAll((n) => {
    if (typeof n.type !== 'string') return false;
    const style = StyleSheet.flatten(n.props.style);
    return style?.position === 'absolute' && style?.height === DOCK_HEIGHT;
  });
  expect(frames).toHaveLength(1);
  return StyleSheet.flatten(frames[0].props.style);
}

const plus = (tree: TestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityLabel === label);

const clearance = (tree: TestRenderer.ReactTestRenderer) =>
  Number(tree.root.findByProps({ testID: 'clearance' }).props.children);

describe('Dock', () => {
  it('is the same full width on a tab with a + of its own and on one without', () => {
    const withPlus = dockFrame(renderTab(0, true));
    const without = dockFrame(renderTab(3, false));

    for (const frame of [withPlus, without]) {
      expect(frame.left).toBe(Spacing.lg);
      expect(frame.right).toBe(Spacing.lg);
      expect(frame.flex).toBeUndefined();
    }
    expect(withPlus.bottom).toBe(without.bottom);
  });

  it("draws the tab's own + in the dock's row, never floating over the list", () => {
    const tree = renderTab(0, true);
    const found = plus(tree, 'Capture a new job');
    expect(found).toHaveLength(1);
    // In the flow of its row: nothing absolutely placed over the rows' ticks.
    expect(StyleSheet.flatten(found[0].props.style).position).toBeUndefined();
    expect(plus(tree, 'New job')).toHaveLength(0);
  });

  it('offers New job on a tab with no + of its own, which opens the list on its capture sheet', () => {
    const route = ROUTES[3];
    const props = dockProps(3);
    let tree!: TestRenderer.ReactTestRenderer;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <DockProvider>
          <NavigationRouteContext.Provider value={route as any}>
            <Screen withFab={false} />
          </NavigationRouteContext.Provider>
          <Dock {...props} />
        </DockProvider>,
      );
    });
    const found = plus(tree, 'New job');
    expect(found).toHaveLength(1);
    TestRenderer.act(() => found[0].props.onClick?.() ?? found[0].props.onPress?.());
    expect(props.navigation.navigate).toHaveBeenCalledWith('Snags', { newJob: expect.any(Number) });
  });

  it('pads every tab the same, since the + is in the dock', () => {
    expect(clearance(renderTab(0, true))).toBe(clearance(renderTab(3, false)));
  });
});
