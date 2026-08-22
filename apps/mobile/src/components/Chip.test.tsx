import React from 'react';
import { render, flattenStyle } from '../test/render';
import { Colors } from '../constants/theme';
import Chip from './Chip';

// The segmented variant's active state used to be a style on the selected
// segment. It is now a single thumb drawn underneath them, positioned from
// measurements — so the things worth pinning are that exactly one thumb
// exists however many options there are, that it isn't a per-segment style
// again, and that the label still says which one is selected. The slide
// itself is Reanimated's problem, not this file's.

const OPTIONS = [
  { key: 'fixit' as const, label: 'Fixit' },
  { key: 'improvement' as const, label: 'Improvement' },
];

// TouchableOpacity renders through a couple of host wrappers, so the handler
// is on an ancestor rather than the Text's immediate parent.
const pressableAround = (node: ReturnType<typeof render>['root']) => {
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (typeof n.props?.onPress === 'function') return n;
  }
  throw new Error('no pressable ancestor');
};

const thumbs = (root: ReturnType<typeof render>['root']) =>
  root.findAll(
    (n) => typeof n.type === 'string' && flattenStyle(n.props.style).position === 'absolute',
    { deep: true }
  );

describe('Chip, segmented', () => {
  it('draws exactly one thumb, whatever the option count', () => {
    const two = render(<Chip options={OPTIONS} value="fixit" onChange={() => {}} variant="segmented" />);
    expect(thumbs(two.root)).toHaveLength(1);

    const three = render(
      <Chip
        options={[...OPTIONS, { key: 'other' as const, label: 'Other' }]}
        value="fixit"
        onChange={() => {}}
        variant="segmented"
      />
    );
    expect(thumbs(three.root)).toHaveLength(1);
  });

  it('marks the selected label and only that one', () => {
    const { getByText } = render(
      <Chip options={OPTIONS} value="improvement" onChange={() => {}} variant="segmented" />
    );
    expect(flattenStyle(getByText('Improvement').props.style).color).toBe(Colors.textPrimary);
    expect(flattenStyle(getByText('Fixit').props.style).color).toBe(Colors.textSecondary);
  });

  it('reports the pressed option', () => {
    const onChange = jest.fn();
    const { getByText } = render(
      <Chip options={OPTIONS} value="fixit" onChange={onChange} variant="segmented" />
    );
    pressableAround(getByText('Improvement')).props.onPress();
    expect(onChange).toHaveBeenCalledWith('improvement');
  });

  it('leaves the chip variant alone — it has no thumb', () => {
    const { root } = render(<Chip options={OPTIONS} value="fixit" onChange={() => {}} />);
    expect(thumbs(root)).toHaveLength(0);
  });
});
