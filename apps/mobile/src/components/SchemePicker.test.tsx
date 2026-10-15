import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import SchemePicker from './SchemePicker';

// The You tab's colour schemes: fern and the five asked for, a choice already
// made marked in ink, and the lit one doing nothing when pressed again.

const choice = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll((n: any) => n.props?.accessibilityLabel === `${label} colour scheme` && n.props?.onPress)[0];

it('offers all six, with the current one selected', () => {
  const r = render(<SchemePicker current="bronze" onChoose={jest.fn()} />);
  for (const label of ['Fern', 'Blue', 'Orange', 'Silver', 'Metallic', 'Bronze']) {
    expect(choice(r, label)).toBeDefined();
  }
  expect(choice(r, 'Bronze').props.accessibilityState).toEqual({ selected: true });
  expect(choice(r, 'Fern').props.accessibilityState).toEqual({ selected: false });
});

it('chooses another, and ignores the one already lit', async () => {
  const onChoose = jest.fn();
  const r = render(<SchemePicker current="fern" onChoose={onChoose} />);
  await TestRenderer.act(async () => { choice(r, 'Metallic').props.onPress(); });
  await TestRenderer.act(async () => { choice(r, 'Fern').props.onPress(); });
  expect(onChoose.mock.calls).toEqual([['metallic']]);
});
