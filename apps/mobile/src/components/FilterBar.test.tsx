import React from 'react';
import TestRenderer from 'react-test-renderer';
import { View, ScrollView, TouchableOpacity } from 'react-native';
import { render, flattenStyle } from '../test/render';
import { MIN_TOUCH_TARGET } from '../constants/theme';
import FilterBar, { FilterButtonSpec, CHIP_TOUCH_PADDING } from './FilterBar';

const spec = (over: Partial<FilterButtonSpec> & { key: string }): FilterButtonSpec => ({
  label: over.key,
  active: false,
  onPress: () => {},
  ...over,
});

// Drives the measurements the bar would get from a real layout pass: the
// wrapper's width, the scrolled content's width, each chip's position, and
// where the reader has scrolled to.
function layOut(
  root: ReturnType<typeof render>['root'],
  opts: {
    viewportWidth: number;
    contentWidth: number;
    chips: { key: string; x: number; width: number }[];
    scrollX?: number;
  }
) {
  const wrapper = root.findAllByType(View).find((n) => typeof n.props.onLayout === 'function');
  const scroll = root.findByType(ScrollView);
  const touchables = root.findAllByType(TouchableOpacity);

  TestRenderer.act(() => {
    wrapper?.props.onLayout({ nativeEvent: { layout: { width: opts.viewportWidth, height: 59 } } });
    scroll.props.onContentSizeChange(opts.contentWidth, 59);
    opts.chips.forEach((chip, i) => {
      touchables[i].props.onLayout({ nativeEvent: { layout: { x: chip.x, width: chip.width } } });
    });
    scroll.props.onScroll({ nativeEvent: { contentOffset: { x: opts.scrollX ?? 0 } } });
  });
}

describe('FilterBar chips', () => {
  it('renders one chip per spec', () => {
    const { getByText } = render(
      <FilterBar buttons={[spec({ key: 'Status' }), spec({ key: 'Trending', dropdown: false })]} />
    );
    expect(getByText('Status')).toBeTruthy();
    expect(getByText('Trending')).toBeTruthy();
  });

  it('calls the spec\'s onPress when tapped', () => {
    const onPress = jest.fn();
    const { root } = render(<FilterBar buttons={[spec({ key: 'Status', onPress })]} />);

    TestRenderer.act(() => root.findByType(TouchableOpacity).props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // The whole point of the touch-target fix, and the reason it is padding
  // rather than hitSlop: react-native-web's TouchableOpacity never reads
  // hitSlop, so on the shipped web build the chips would have silently stayed
  // 34px targets. Padding is layout, so it lands on both platforms — and the
  // negative margin means the bar's height doesn't change.
  it('gives each chip a 48px touch box while the pill stays 34px', () => {
    const { root } = render(<FilterBar buttons={[spec({ key: 'Status' })]} />);

    const touchable = root.findByType(TouchableOpacity);
    const touch = flattenStyle(touchable.props.style);
    // TouchableOpacity renders its own wrapper view around the children, so
    // the pill is the innermost host View — the one holding the label.
    const hostViews = touchable.findAll((n) => String(n.type) === 'View');
    const pill = flattenStyle(hostViews[hostViews.length - 1].props.style);

    expect(pill.height).toBe(34);
    expect((pill.height as number) + CHIP_TOUCH_PADDING.y * 2).toBe(MIN_TOUCH_TARGET);
    expect(touch.paddingVertical).toBe(CHIP_TOUCH_PADDING.y);
    // Pulled back by an equal margin, so the expanded box costs no layout.
    expect(touch.marginVertical).toBe(-CHIP_TOUCH_PADDING.y);
    expect(touch.paddingHorizontal).toBe(CHIP_TOUCH_PADDING.x);
    expect(touch.marginHorizontal).toBe(-CHIP_TOUCH_PADDING.x);
  });
});

describe('FilterBar overflow hint', () => {
  const chips = [
    { key: 'scope', x: 0, width: 80 },
    { key: 'status', x: 88, width: 80 },
    { key: 'trending', x: 176, width: 80 },  // midpoint 216 — past a 200 edge
  ];

  it('shows no fade while the whole bar fits', () => {
    const { root, queryByText } = render(
      <FilterBar buttons={[spec({ key: 'scope' }), spec({ key: 'status' }), spec({ key: 'trending' })]} />
    );
    layOut(root, { viewportWidth: 400, contentWidth: 256, chips });

    expect(root.findAllByType(ScrollView)).toHaveLength(1);
    expect(queryByText('1')).toBeNull();
  });

  it('counts an active filter that is scrolled out of sight', () => {
    const { root, getByText } = render(
      <FilterBar buttons={[
        spec({ key: 'scope' }),
        spec({ key: 'status' }),
        spec({ key: 'trending', active: true }),
      ]} />
    );
    layOut(root, { viewportWidth: 200, contentWidth: 256, chips });

    expect(getByText('1')).toBeTruthy();
  });

  // The count is not "how many filters are on" — that would be redundant next
  // to buttons already rendering their own active style. It is only ever the
  // ones the reader cannot see.
  it('says nothing about active filters that are already on screen', () => {
    const { root, queryByText } = render(
      <FilterBar buttons={[
        spec({ key: 'scope', active: true }),
        spec({ key: 'status', active: true }),
        spec({ key: 'trending' }),
      ]} />
    );
    layOut(root, { viewportWidth: 200, contentWidth: 256, chips });

    expect(queryByText('2')).toBeNull();
    expect(queryByText('1')).toBeNull();
  });

  it('drops the count once the chip has been scrolled to', () => {
    const { root, queryByText } = render(
      <FilterBar buttons={[
        spec({ key: 'scope' }),
        spec({ key: 'status' }),
        spec({ key: 'trending', active: true }),
      ]} />
    );
    layOut(root, { viewportWidth: 200, contentWidth: 256, chips, scrollX: 56 });

    expect(queryByText('1')).toBeNull();
  });
});
