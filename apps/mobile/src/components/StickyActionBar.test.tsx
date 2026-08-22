import React from 'react';
import { Text } from 'react-native';
import { render, flattenStyle } from '../test/render';
import { Spacing } from '../constants/theme';
import StickyActionBar from './StickyActionBar';

// The bar sits above other fixed chrome on some screens — a tab bar, the snag
// detail screen's comment bar — and against the device edge on others, and that
// is one prop rather than two components. Getting it wrong is
// invisible in a simulator with no home indicator and obvious on a real phone,
// which is why it is pinned here rather than eyeballed.

const BOTTOM_INSET = 34;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: BOTTOM_INSET, left: 0, right: 0 }),
}));

jest.mock('expo-blur', () => {
  const { View } = require('react-native');
  return { BlurView: View };
});

const innerPad = (result: ReturnType<typeof render>) => {
  const inner = result.root
    .findAll((n) => typeof n.type === 'string', { deep: true })
    .map((n) => flattenStyle(n.props.style))
    .find((s) => typeof s.paddingBottom === 'number' && s.paddingTop === Spacing.md);
  return inner?.paddingBottom;
};

describe('StickyActionBar', () => {
  it('clears the home indicator on a stack screen', () => {
    const r = render(<StickyActionBar><Text>Go</Text></StickyActionBar>);
    expect(innerPad(r)).toBe(BOTTOM_INSET + Spacing.md);
  });

  it('leaves the inset to whatever fixed bar sits below it', () => {
    const r = render(<StickyActionBar stacked><Text>Go</Text></StickyActionBar>);
    expect(innerPad(r)).toBe(Spacing.md);
  });

  it('shows a hint only when given one', () => {
    expect(render(<StickyActionBar><Text>Go</Text></StickyActionBar>).queryByText('2 steps left')).toBeNull();
    expect(
      render(<StickyActionBar hint="2 steps left"><Text>Go</Text></StickyActionBar>).getByText('2 steps left')
    ).toBeTruthy();
  });
});
