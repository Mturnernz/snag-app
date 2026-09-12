import {
  describeCycle, searchThings, thingDetailLine, thingHeadline, thingSearchText,
} from '@snag/supabase-queries';
import type { Thing } from '../types';

// The house record has one job that has to work under pressure: somebody in a
// hardware aisle, on a bad connection, typing a half-remembered noun. These pin
// the three pieces of that — what is searchable, what a card leads with, and
// how an interval is said out loud.

const thing = (over: Partial<Thing>): Thing => ({
  id: 'x', householdId: 'h', propertyId: 'p', kind: 'appliance',
  name: null, room: null, photoPaths: [],
  make: null, model: null, serial: null, consumables: [],
  installedAt: null, warrantyUntil: null, serviceDays: null, spec: {}, notes: null,
  createdBy: 'me', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  propertyName: 'Home', snagCount: 0, openSnagCount: 0,
  ...over,
});

describe('searching the house record', () => {
  it('finds a thing by what it takes, not only by what it is', () => {
    // The load-bearing case. Standing in the aisle holding a dead bulb, the
    // word you have is the fitting — and the fitting is never the name of
    // anything in the house.
    const things = [
      thing({ id: 'lights', name: 'Downlights', consumables: ['GU10 2700K'], room: 'Living room' }),
      thing({ id: 'pump', name: 'Heat pump', model: 'MSZ-AP50VGK', consumables: ['MAC-2360FT'] }),
    ];
    expect(searchThings(things, 'gu10').map((t) => t.id)).toEqual(['lights']);
    expect(searchThings(things, 'MAC-2360').map((t) => t.id)).toEqual(['pump']);
  });

  it('matches every word typed, in any order, ignoring case', () => {
    const things = [
      thing({ id: 'hall', name: 'Walls', make: 'Resene', model: '7BB 83/018', room: 'Hallway', kind: 'finish' }),
      thing({ id: 'trim', name: 'Trim', make: 'Resene', room: 'Hallway', kind: 'finish' }),
    ];
    expect(searchThings(things, 'resene hallway').map((t) => t.id)).toEqual(['hall', 'trim']);
    expect(searchThings(things, 'HALLWAY walls').map((t) => t.id)).toEqual(['hall']);
    // Not a phrase match: the words are somewhere, not next to each other.
    expect(searchThings(things, 'walls resene').map((t) => t.id)).toEqual(['hall']);
  });

  it('searches the per-kind tail as well as the columns', () => {
    // A tint formula is only ever in `spec`, and it is one of the strings most
    // likely to be read off a lid and typed back in.
    const paint = thing({ kind: 'finish', name: 'Walls', spec: { tint: 'BS2 Y12.5 R3.0' } });
    expect(thingSearchText(paint)).toContain('bs2 y12.5 r3.0');
    expect(searchThings([paint], 'y12.5')).toHaveLength(1);
  });

  it('returns everything for an empty or blank query', () => {
    const things = [thing({ id: 'a', name: 'A' }), thing({ id: 'b', name: 'B' })];
    expect(searchThings(things, '')).toHaveLength(2);
    expect(searchThings(things, '   ')).toHaveLength(2);
  });
});

describe('what a card leads with', () => {
  it('shows the name above, and the model number as the answer below', () => {
    const pump = thing({ name: 'Heat pump · indoor', make: 'Mitsubishi', model: 'MSZ-AP50VGK' });
    expect(thingHeadline(pump)).toBe('Heat pump · indoor');
    expect(thingDetailLine(pump)).toBe('Mitsubishi MSZ-AP50VGK');
  });

  it('promotes make and model when there is no name', () => {
    // A photograph of a rating plate with nothing typed yet. "Something in the
    // house" would be true and useless; the plate's own words are better.
    const plate = thing({ make: 'Bosch', model: 'SMS46MI01A' });
    expect(thingHeadline(plate)).toBe('Bosch SMS46MI01A');
    // And the line below does not repeat the headline back.
    expect(thingDetailLine(plate)).toBe('SMS46MI01A');
  });

  it('falls back to the room, then to something honest', () => {
    expect(thingHeadline(thing({ room: 'Garage' }))).toBe('Something in the garage');
    expect(thingHeadline(thing({}))).toBe('Something in the house');
  });
});

describe('saying an interval out loud', () => {
  it('speaks in months and years, never in days', () => {
    expect(describeCycle(180)).toBe('6 months');
    expect(describeCycle(90)).toBe('3 months');
    expect(describeCycle(365)).toBe('year');
    expect(describeCycle(730)).toBe('2 years');
  });

  it('still says something sensible for an interval nobody picked from the rail', () => {
    expect(describeCycle(7)).toBe('week');
    expect(describeCycle(1)).toBe('day');
    expect(describeCycle(45)).toBe('45 days');
  });
});
