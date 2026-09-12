import {
  describeCycle, formatLooseDate, ghostsForRoom, parseLooseDate, searchThings, thingDetailLine,
  thingHeadline, thingSearchText,
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

describe('dates off a rating plate', () => {
  it('accepts every form the label and the person are likely to use', () => {
    // The column is a real `date`. Anything this cannot read reaches Postgres
    // as a 22008 raised inside an RPC — a database error shown to somebody who
    // answered the question correctly.
    expect(parseLooseDate('2019')).toBe('2019-01-01');
    expect(parseLooseDate('2019-11')).toBe('2019-11-01');
    expect(parseLooseDate('11/2019')).toBe('2019-11-01');
    expect(parseLooseDate('Nov 2019')).toBe('2019-11-01');
    expect(parseLooseDate('November 2019')).toBe('2019-11-01');
    expect(parseLooseDate('nov. 2019')).toBe('2019-11-01');
    expect(parseLooseDate('2019-11-08')).toBe('2019-11-08');
    expect(parseLooseDate('8 Nov 2019')).toBe('2019-11-08');
  });

  it('clears on empty, and says it cannot tell rather than guessing', () => {
    expect(parseLooseDate('')).toBeNull();
    expect(parseLooseDate('   ')).toBeNull();
    // Undefined is "keep what they typed and say why" — never a wrong date
    // stored silently.
    expect(parseLooseDate('sometime in the winter')).toBeUndefined();
    expect(parseLooseDate('Smarch 2019')).toBeUndefined();
  });

  it('reads a stored date back the way the plate says it', () => {
    expect(formatLooseDate('2019-11-01')).toBe('Nov 2019');
    expect(formatLooseDate('2019-01-01')).toBe('Jan 2019');
    // A day that somebody actually gave is shown; the first of the month is
    // what a month-only answer is stored as, so showing it back would invent
    // a precision nobody offered.
    expect(formatLooseDate('2019-11-08')).toBe('8 Nov 2019');
    expect(formatLooseDate(null)).toBe('');
  });

  it('round-trips what it accepted', () => {
    for (const typed of ['Nov 2019', '11/2019', '2019-11']) {
      expect(formatLooseDate(parseLooseDate(typed) as string)).toBe('Nov 2019');
    }
  });
});

describe('what a room still shows', () => {
  // The furniture the House tab arrives holding. The rule these protect is the
  // one the whole design rests on: a ghost is never a row, so it must vanish
  // the moment a real one exists — an app that keeps nagging about the
  // dishwasher you just recorded is an app that gets ignored.
  const inRoom = (room: string, name: string) => thing({ id: name, room, name });

  it('offers what a New Zealand kitchen has, and stops offering what is recorded', () => {
    const ghosts = ghostsForRoom('Kitchen', [inRoom('Kitchen', 'Dishwasher')], []);
    const names = ghosts.map((g) => g.name);
    expect(names).toContain('Rangehood');
    expect(names).toContain('Oven');
    expect(names).not.toContain('Dishwasher');
  });

  it('counts a thing filed under a longer name as having answered the prompt', () => {
    // Somebody who files it as "Bosch dishwasher" has plainly dealt with the
    // Dishwasher prompt. Leaving the ghost up is the app failing to notice work
    // that was done, which is worse than the occasional early hide — that costs
    // one tap on the +, and a permanent nag costs the screen.
    const ghosts = ghostsForRoom('Kitchen', [inRoom('Kitchen', 'Bosch dishwasher')], []);
    expect(ghosts.map((g) => g.name)).not.toContain('Dishwasher');
  });

  it('does not let a thing in one room answer another room\'s prompt', () => {
    const ghosts = ghostsForRoom('Kitchen', [inRoom('Laundry', 'Dishwasher')], []);
    expect(ghosts.map((g) => g.name)).toContain('Dishwasher');
  });

  it('drops what this house hasn\'t got, case and spacing aside', () => {
    const ghosts = ghostsForRoom('Laundry', [], [
      { propertyId: 'p', room: 'Laundry', name: '  dryer  ' },
    ]);
    expect(ghosts.map((g) => g.name)).not.toContain('Dryer');
    expect(ghosts.map((g) => g.name)).toContain('Washing machine');
  });

  it('offers nothing for a room with no catalogue, rather than guessing', () => {
    // `Elsewhere` is the escape hatch in the location seed. Suggesting the
    // contents of a room whose whole point is "somewhere else" is nonsense.
    expect(ghostsForRoom('Elsewhere', [], [])).toEqual([]);
    expect(ghostsForRoom('Sleepout', [], [])).toEqual([]);
  });

  it('only ever suggests kinds the app can actually describe', () => {
    // Suggesting a toby or a bulb fitting before `fabric` and `fitting` are
    // built would open a walkthrough that ends on a spec sheet with the wrong
    // words on it — a prompt that becomes a dead end.
    for (const room of ['Kitchen', 'Bathroom', 'Living room', 'Garage', 'Outside']) {
      for (const suggestion of ghostsForRoom(room, [], [])) {
        expect(['appliance', 'finish']).toContain(suggestion.kind);
      }
    }
  });
});
