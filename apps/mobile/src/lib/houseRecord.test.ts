import {
  catalogueSuggestions, describeCycle, documentFileName, documentName, formatLooseDate,
  ghostsForRoom, matchSuggestions, parseLooseDate, searchThings, thingDetailLine,
  thingHeadline, thingSearchText, thingsInArea,
} from '@snag/supabase-queries';
import type { Thing } from '../types';

// The house record has one job that has to work under pressure: somebody in a
// hardware aisle, on a bad connection, typing a half-remembered noun. These pin
// the three pieces of that — what is searchable, what a card leads with, and
// how an interval is said out loud.

const thing = (over: Partial<Thing>): Thing => ({
  id: 'x', householdId: 'h', propertyId: 'p', kind: 'appliance',
  name: null, room: null, photoPaths: [], documentPaths: [],
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

  it('offers nothing for Elsewhere, whose whole point is being nowhere', () => {
    // The escape hatch in the location seed. Suggesting the contents of a room
    // that means "somewhere else" is nonsense — and it is listed in the
    // catalogue as deliberately empty rather than left out, which is what tells
    // it apart from a room somebody added.
    expect(ghostsForRoom('Elsewhere', [], [])).toEqual([]);
  });

  it('offers paint in a room nobody catalogued, so it is not invisible', () => {
    // A conservatory, a study, a movie room. Every room in every house has
    // walls, and a room created with nothing to show would not be drawn at all
    // — a section with no things and no ghosts does not render, so somebody
    // would add a room and watch nothing happen.
    expect(ghostsForRoom('Conservatory', [], []).map((g) => g.name)).toEqual(['Paint']);
    expect(ghostsForRoom('Movie room', [], []).map((g) => g.name)).toEqual(['Paint']);
    // And it behaves like any other paint prompt once one is recorded.
    const painted = [thing({ id: 'a', room: 'Study', kind: 'finish', name: 'Resene Rakaia' })];
    expect(ghostsForRoom('Study', painted, [])).toEqual([]);
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

describe('paint, of which a room has several', () => {
  // A room has one rangehood and a name for it. A room has as many paints as it
  // has surfaces, and their names are colours — so the paint prompt behaves
  // differently from every other suggestion, and these pin how.
  const paint = (over: Partial<Thing>) => thing({ kind: 'finish', ...over });

  it('prompts once per room, in general terms', () => {
    const names = ghostsForRoom('Bathroom', [], []).map((g) => g.name);
    expect(names).toContain('Paint');
    expect(names.filter((n) => n === 'Paint')).toHaveLength(1);
  });

  it('stops prompting as soon as any paint in that room is recorded', () => {
    // Neither "Half Spanish White" nor "Quarter Alabaster" contains the word
    // "Paint", so a name match would leave the prompt sitting under two
    // recorded paints — the app failing to notice work already done.
    const recorded = [
      paint({ id: 'a', room: 'Bathroom', name: 'Half Spanish White', notes: 'Main wall' }),
      paint({ id: 'b', room: 'Bathroom', name: 'Quarter Alabaster', notes: 'Windows' }),
    ];
    expect(ghostsForRoom('Bathroom', recorded, []).map((g) => g.name)).not.toContain('Paint');
    // And it is per room: the bathroom being painted says nothing about the kitchen.
    expect(ghostsForRoom('Kitchen', recorded, []).map((g) => g.name)).toContain('Paint');
  });

  it('is not answered by an appliance in the same room', () => {
    const recorded = [thing({ id: 'a', room: 'Bathroom', name: 'Extractor fan' })];
    expect(ghostsForRoom('Bathroom', recorded, []).map((g) => g.name)).toContain('Paint');
  });

  it('leads with the colour, because that is the answer somebody came for', () => {
    const wall = paint({
      name: 'Half Spanish White', make: 'Resene', model: '7BB 83/018', notes: 'Main wall',
    });
    expect(thingHeadline(wall)).toBe('Half Spanish White');
    expect(thingDetailLine(wall)).toBe('Resene 7BB 83/018');
  });

  it('finds a colour by its code as readily as its name', () => {
    const bathroom = [
      paint({ id: 'a', room: 'Bathroom', name: 'Half Spanish White', model: '7BB 83/018' }),
      paint({ id: 'b', room: 'Bathroom', name: 'Quarter Alabaster', model: 'N93-002-072' }),
    ];
    expect(searchThings(bathroom, 'alabaster').map((t) => t.id)).toEqual(['b']);
    expect(searchThings(bathroom, '7BB').map((t) => t.id)).toEqual(['a']);
  });
});

describe('picking something to add, when the house is not laid out like the catalogue', () => {
  // The room's own list is what most taps hit. The rest of the house's
  // vocabulary is what makes a study with a heat pump in it — or a flat with
  // the washing machine in the bathroom — an ordinary house rather than one
  // the app refuses to describe.
  it('offers every name the catalogue knows, once each', () => {
    const all = catalogueSuggestions();
    const names = all.map((one) => one.name);
    expect(new Set(names).size).toBe(names.length);
    // Paint is in nearly every room and Smoke alarm in three; both appear once.
    expect(names.filter((n) => n === 'Paint')).toHaveLength(1);
    expect(names.filter((n) => n === 'Smoke alarm')).toHaveLength(1);
    // And it reaches across rooms, so a bedroom can offer a dishwasher.
    expect(names).toEqual(expect.arrayContaining(['Dishwasher', 'Washing machine', 'Wood burner']));
  });

  it('only ever carries kinds the app can describe', () => {
    for (const one of catalogueSuggestions()) {
      expect(['appliance', 'finish']).toContain(one.kind);
    }
  });

  it('narrows on part of a word, in any case', () => {
    const all = catalogueSuggestions();
    // Substring, not prefix — and "wash" is inside "Dishwasher" too, which is
    // the right answer rather than a near miss: somebody typing it may well
    // mean either, and a short list costs nothing to read past.
    expect(matchSuggestions(all, 'wash').map((o) => o.name).sort()).toEqual([
      'Dishwasher', 'Washing machine',
    ]);
    expect(matchSuggestions(all, 'HEAT').map((o) => o.name)).toEqual(
      expect.arrayContaining(['Heat pump · indoor', 'Heat pump head'])
    );
    // Matching anywhere, not only at the start — nobody searching for the
    // rangehood types "range" and then gives up because it is a "hood".
    expect(matchSuggestions(all, 'hood').map((o) => o.name)).toContain('Rangehood');
  });

  it('returns everything for a blank query, and nothing for a miss', () => {
    const all = catalogueSuggestions();
    expect(matchSuggestions(all, '')).toHaveLength(all.length);
    expect(matchSuggestions(all, '   ')).toHaveLength(all.length);
    // The miss is the interesting case: it is what puts "Add it yourself" on
    // screen rather than an empty list and a dead end.
    expect(matchSuggestions(all, 'wine fridge')).toEqual([]);
  });
});

// A document's filename is its label. The storage key keeps it for that reason
// alone — a paperwork list of UUIDs answers nothing, and "which manual" is the
// entire question somebody has when they open this.
describe('attached documents', () => {
  it('keeps the original name in the key, under the household folder', () => {
    const key = documentFileName('house-1', 'Rangehood manual.pdf');
    // Segment one is the only thing the storage policy reads, so it has to be
    // the household and nothing else.
    expect(key.startsWith('house-1/docs/')).toBe(true);
    expect(key.endsWith('Rangehood manual.pdf')).toBe(true);
  });

  it('reads the name back off the key', () => {
    const key = documentFileName('house-1', 'Rangehood manual.pdf');
    expect(documentName(key)).toBe('Rangehood manual.pdf');
  });

  it('keeps hyphens in a name rather than mistaking them for the prefix', () => {
    // The prefix is digits-digits-; a name that merely contains hyphens must
    // survive it, or "CS2-600-1 manual.pdf" loses its model number.
    const key = documentFileName('house-1', 'CS2-600-1 manual.pdf');
    expect(documentName(key)).toBe('CS2-600-1 manual.pdf');
  });

  it('gives two files uploaded together different keys', () => {
    // Uploads are upsert: false, so a collision is a failure, not an overwrite.
    const a = documentFileName('house-1', 'manual.pdf');
    const b = documentFileName('house-1', 'manual.pdf');
    expect(a).not.toBe(b);
  });

  it('strips characters a storage key cannot carry', () => {
    const key = documentFileName('house-1', 'recei/pt?2019.pdf');
    expect(documentName(key)).toBe('receipt2019.pdf');
    expect(key.split('/').length).toBe(3);
  });

  it('leaves a name alone when it was never given our prefix', () => {
    expect(documentName('house-1/docs/manual.pdf')).toBe('manual.pdf');
    expect(documentName('manual.pdf')).toBe('manual.pdf');
  });

  it('falls back rather than minting a key with no name at all', () => {
    expect(documentName(documentFileName('house-1', '???'))).toBe('document.pdf');
  });
});

// The offer the capture sheet makes after the room has been answered. A house
// holds tens of things and a snag is about one of them, so "only this room" is
// the whole feature — offering the lot turns a two-second tag into a search.

describe('what a snag can be said to be about', () => {
  it('offers the room that was tagged and no other', () => {
    const found = thingsInArea([
      thing({ id: 'a', name: 'Dishwasher', room: 'Kitchen' }),
      thing({ id: 'b', name: 'Dryer', room: 'Laundry' }),
      thing({ id: 'c', name: 'Rangehood', room: 'Kitchen' }),
    ], 'Kitchen');
    expect(found.map((t) => t.id)).toEqual(['a', 'c']);
  });

  // "Whole house" is not a room; it is where a thing belonging to the place
  // rather than to a room in it lives, on both tables, as null.
  it('offers the place-wide things to a snag with no room', () => {
    const found = thingsInArea([
      thing({ id: 'a', name: 'Switchboard', room: null }),
      thing({ id: 'b', name: 'Dishwasher', room: 'Kitchen' }),
    ], null);
    expect(found.map((t) => t.id)).toEqual(['a']);
  });

  it('is empty for a room with nothing recorded in it, which removes the step', () => {
    expect(thingsInArea([thing({ name: 'Dishwasher', room: 'Kitchen' })], 'Roof')).toEqual([]);
  });

  // A rail somebody scans for a noun should be in the order of the nouns.
  it('is in the order of what the chips will say, not of when they were added', () => {
    const found = thingsInArea([
      thing({ id: 'a', name: 'Rangehood', room: 'Kitchen' }),
      thing({ id: 'b', make: 'Bosch', model: 'SMS46MI01A', room: 'Kitchen' }),
      thing({ id: 'c', name: 'Dishwasher', room: 'Kitchen' }),
    ], 'Kitchen');
    expect(found.map(thingHeadline)).toEqual(['Bosch SMS46MI01A', 'Dishwasher', 'Rangehood']);
  });
});
