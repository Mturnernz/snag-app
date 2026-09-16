import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, flattenStyle } from '../test/render';
import MoneyField from './MoneyField';
import { Colors } from '../constants/theme';

/**
 * The GST pill, which is the difference between a renovation on budget and one
 * fifteen percent over.
 *
 * There is deliberately no household-wide GST setting anywhere in this app: New
 * Zealand quotes come both ways, and assuming once at setup is how a project
 * total ends up quietly wrong. Quietly wrong is the only way this feature can
 * actually hurt somebody, so the pill is on every box.
 */

function arrange(props: Partial<React.ComponentProps<typeof MoneyField>> = {}) {
  return render(
    <MoneyField
      label="Amount"
      value=""
      onChangeValue={jest.fn()}
      inclusive
      onChangeInclusive={jest.fn()}
      {...props}
    />
  );
}

/** The pressable half, not its host view — the same shape the other specs use. */
const pill = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
      && !!n.props?.onPress,
    { deep: true }
  )[0];

/** The inner pill view, which is where the fill lives. */
const fillOf = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type === 'string' && n.props?.accessibilityLabel === label,
    { deep: true }
  )[0];

it('offers two named halves rather than one chip that toggles', () => {
  const r = arrange();
  // One chip would leave the other answer as the unlabelled absence of a press
  // — and here that unlabelled answer is worth 15%. The same argument that made
  // capture's priority step two named pills.
  r.getByText('incl GST');
  r.getByText('excl');
});

it('lights the half that is selected, in the app’s one chip styling', () => {
  const r = arrange({ inclusive: true });
  // Solid fern when on — never primaryLight, which is the tint behind fern
  // text and not a selected state for a control.
  expect(flattenStyle(fillOf(r, 'Includes GST').props.style).backgroundColor).toBe(Colors.primary);
  expect(flattenStyle(fillOf(r, 'Excludes GST').props.style).backgroundColor).toBeUndefined();
});

it('shows the other figure as it is typed, rather than asserting a conversion', () => {
  // Somebody typing a trade price ex-GST sees what it actually comes to before
  // they save it. Nothing is converted on save: the figure stored is the figure
  // typed, and the flag records what it meant.
  const r = arrange({ value: '1000', inclusive: false });
  r.getByText('$1,150 with GST');
});

it('shows the pre-GST figure when the amount already includes it', () => {
  const r = arrange({ value: '1150', inclusive: true });
  r.getByText('$1,000 before GST');
});

it('says nothing at all until there is a number to say it about', () => {
  const r = arrange({ value: '' });
  expect(r.queryByText('$0 with GST')).toBeNull();
  expect(r.queryByText('$0 before GST')).toBeNull();
});

it('reports which way it was answered, and each half is its own control', () => {
  const onChangeInclusive = jest.fn();
  const r = arrange({ inclusive: true, onChangeInclusive });

  expect(pill(r, 'Includes GST').props.accessibilityState.selected).toBe(true);
  expect(pill(r, 'Excludes GST').props.accessibilityState.selected).toBe(false);

  TestRenderer.act(() => pill(r, 'Excludes GST').props.onPress());
  expect(onChangeInclusive).toHaveBeenCalledWith(false);

  // Pressing the half that is already lit is a no-op in meaning, but it still
  // reports — the caller decides, so the control never holds an opinion the
  // stored row does not.
  TestRenderer.act(() => pill(r, 'Includes GST').props.onPress());
  expect(onChangeInclusive).toHaveBeenLastCalledWith(true);
});
