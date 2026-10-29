import React from 'react';
import type { ReactTestInstance } from 'react-test-renderer';
import { render, flattenStyle } from '../test/render';
import { Pill, Row } from './Grouped';

// On a 360pt phone a figure and a pill side by side took half the row, and
// the name beside them broke mid-word: "RELIABUILDE / R LIMITED". And a row
// passed words as its value ("Part of" and a contract's name) pushed its own
// title to nothing and ran off the card.

const ancestors = (node: ReactTestInstance): ReactTestInstance[] => {
  const out: ReactTestInstance[] = [];
  for (let n = node.parent; n; n = n.parent) out.push(n);
  return out;
};
const insideButton = (node: ReactTestInstance, label: string) =>
  ancestors(node).some((n) => n.props?.accessibilityLabel === label);
const door = (node: ReactTestInstance) => ancestors(node).find((n) => typeof n.props?.onPress === 'function');

describe('a row with a figure and a pill', () => {
  it('puts the figure above the pill, out of the name’s way, and still opens the row', () => {
    const open = jest.fn();
    const billed = jest.fn();
    const r = render(
      <Row
        title="RELIABUILDER LIMITED"
        subtitle="Reliabuilder payment 4/4"
        value="$43,987.50"
        onPress={open}
        accessory={<Pill label="Billed" onPress={billed} />}
      />,
    );
    const figure = r.getByText('$43,987.50');
    expect(insideButton(figure, 'RELIABUILDER LIMITED')).toBe(false);
    // The figure and the pill share a column of their own: the closest thing
    // holding both does not hold the name.
    const pill = ancestors(r.getByText('Billed'));
    const column = ancestors(figure).find((n) => pill.includes(n))!;
    expect(column.findAll((n) => n.props?.children === 'RELIABUILDER LIMITED')).toHaveLength(0);

    door(figure)!.props.onPress();
    expect(open).toHaveBeenCalledTimes(1);
    expect(billed).not.toHaveBeenCalled();
  });
});

describe('a row with a figure and no pill', () => {
  it('keeps the figure beside the name, capped so words cannot push the name away', () => {
    const r = render(<Row title="Part of" value="Downstairs renovation — fixed price contract" onPress={jest.fn()} />);
    const value = r.getByText('Downstairs renovation — fixed price contract');
    expect(insideButton(value, 'Part of')).toBe(true);
    expect(flattenStyle(value.props.style).maxWidth).toBe('60%');
    r.getByText('Part of');
  });
});
