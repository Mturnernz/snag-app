import React from 'react';
import { render } from '../test/render';
import ThingCard from './ThingCard';

jest.mock('./SignedImage', () => () => null);

const thing = (over: Partial<any> = {}): any => ({
  id: 't1', householdId: 'h', propertyId: 'p', kind: 'appliance',
  name: 'Heat pump', room: 'Living room', photoPaths: [],
  make: 'Mitsubishi', model: 'MSZ-AP50VGK', serial: null, consumables: [], documentPaths: [],
  installedAt: null, warrantyUntil: null, serviceDays: null, spec: {}, notes: null,
  createdBy: 'me', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  propertyName: 'Home', snagCount: 0, openSnagCount: 0,
  ...over,
});

const said = (r: ReturnType<typeof render>) => r.getAllByType('Text')
  .map((n: any) => [].concat(n.props.children ?? []).join(''));

describe('ThingCard', () => {
  it('says who services it when somebody said', () => {
    const r = render(<ThingCard thing={thing({ spec: { servicedBy: 'Aircon Experts' } })} onPress={jest.fn()} />);
    expect(said(r)).toContain('Serviced by Aircon Experts');
  });

  it('says nothing about servicing when nobody said, or said only spaces', () => {
    for (const spec of [{}, { servicedBy: '   ' }]) {
      const r = render(<ThingCard thing={thing({ spec })} onPress={jest.fn()} />);
      expect(said(r).some((t) => t.startsWith('Serviced by'))).toBe(false);
    }
  });
});
