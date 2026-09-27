import {
  applyLabelReading, brandCase, consumableOnList, labelOffers, labelOffersUpdate, parseLabelGuess,
  parseLabelReading, swatchColour, yearMade, type LabelFields, type LabelReading,
} from '@snag/supabase-queries';
import type { Snag, Thing } from '../types';

// Three small rules that each decide whether the house record can be believed
// in a shop: a swatch is drawn only from a colour that parses, a label reading
// never writes over what somebody typed, and the cart never files one
// cartridge twice.

describe('swatchColour', () => {
  it.each([
    ['#EAE8DF', '#EAE8DF'],
    ['eae8df', '#EAE8DF'],
    [' #abc ', '#AABBCC'],
  ])('reads %p as %p', (hex, want) => {
    expect(swatchColour({ hex })).toBe(want);
  });

  it.each(['', 'white', '#EAE8D', '#GGGGGG', 'rgb(1,2,3)'])(
    'draws nothing for %p rather than a guess',
    (hex) => {
      expect(swatchColour({ hex })).toBeNull();
    }
  );

  it('draws nothing for a paint nobody gave a colour', () => {
    expect(swatchColour({ sheen: 'Low sheen' })).toBeNull();
  });
});

const snag = (over: Partial<Snag>): Snag => ({
  id: 'x', reference: 'SNAG-0001', householdId: 'h', propertyId: 'p',
  linkedThings: [],
  room: null, photoPaths: [], description: 'A thing', status: 'doing',
  parts: [], bought: [], needsParts: false, dueAt: null, repeatDays: null,
  assigneeId: null, thingId: null, thingName: null, thingMake: null, thingModel: null,
  projectId: null, projectName: null,
  projectItemId: null, projectItemName: null, projectElementName: null,
  reporterId: 'me', reporterName: 'Me', assigneeName: null, propertyName: 'Home',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  lastDoneAt: null, doneAt: null, commentCount: 0,
  ...over,
});

const linked = [{ id: 't1', name: 'Heat pump', room: null, make: null, model: null, kind: 'appliance' as const }];

describe('consumableOnList', () => {
  it('finds a job about this thing still waiting on the item', () => {
    const job = snag({ linkedThings: linked, parts: ['RFC-24'] });
    expect(consumableOnList([job], 't1', 'RFC-24')).toBe(job);
  });

  it('matches the words however they were cased or spaced', () => {
    const job = snag({ linkedThings: linked, parts: [' rfc-24 '] });
    expect(consumableOnList([job], 't1', 'RFC-24')).toBe(job);
  });

  it('counts the retired single link too', () => {
    const job = snag({ thingId: 't1', parts: ['RFC-24'] });
    expect(consumableOnList([job], 't1', 'RFC-24')).toBe(job);
  });

  it('does not count one already bought — pressing again means another', () => {
    const job = snag({ linkedThings: linked, parts: ['RFC-24'], bought: ['RFC-24'] });
    expect(consumableOnList([job], 't1', 'RFC-24')).toBeNull();
  });

  it('does not count a finished job, or a job about something else', () => {
    expect(consumableOnList([snag({ linkedThings: linked, parts: ['RFC-24'], status: 'done' })], 't1', 'RFC-24')).toBeNull();
    expect(consumableOnList([snag({ thingId: 't2', parts: ['RFC-24'] })], 't1', 'RFC-24')).toBeNull();
  });
});

const read = (over: Partial<LabelReading>): LabelReading => ({
  legible: true, make: null, model: null, serial: null, manufactured: null, colourName: null, colourCode: null,
  product: null, sheen: null, tint: null, hex: null, consumables: [], ...over,
});
const blank: LabelFields = { name: '', make: '', model: '', serial: '', takes: '', spec: {} };

describe('parseLabelReading', () => {
  it('is not a reading unless it says it read something', () => {
    expect(parseLabelReading({ legible: false, make: 'Smeg' })).toBeNull();
    expect(parseLabelReading(null)).toBeNull();
    expect(parseLabelReading('Smeg')).toBeNull();
  });

  it('trims, drops what is not text, and keeps only a hex that parses', () => {
    const got = parseLabelReading({
      legible: true, make: '  Smeg ', model: 42, serial: '', hex: 'greyish',
      consumables: ['E14 25W', '', 7],
    });
    expect(got).toMatchObject({ make: 'Smeg', model: null, serial: null, hex: null, consumables: ['E14 25W'] });
  });

  it('writes a shouted brand the way the brand writes itself', () => {
    expect(parseLabelReading({ legible: true, make: 'MITSUBISHI ELECTRIC' })?.make).toBe('Mitsubishi Electric');
  });

  it('carries nothing the model remembers about the model — only what the label says', () => {
    // A reply from a function still deployed with the old instructions: the
    // suggestions it sends are not read, because they were never on the label.
    const got = parseLabelReading({
      legible: true, make: 'Mitsubishi Electric', model: 'MSZ-GS60VFD', consumables: [],
      suggestedConsumables: [{ item: 'Air cleaning filter', code: 'MAC-2370FT-E' }],
      suggestedServiceMonths: 12,
    });
    expect(got).not.toHaveProperty('suggestedConsumables');
    expect(got).not.toHaveProperty('suggestedServiceDays');
    expect(got?.consumables).toEqual([]);
  });

  it('keeps a year of manufacture only when it is plainly a year this unit could be', () => {
    expect(parseLabelReading({ legible: true, manufactured: '2019' })?.manufactured).toBe('2019');
    expect(parseLabelReading({ legible: true, manufactured: '2019.06' })?.manufactured).toBe('2019');
    expect(parseLabelReading({ legible: true, manufactured: 2017 })?.manufactured).toBe('2017');
    expect(parseLabelReading({ legible: true, manufactured: '06/2019' })?.manufactured).toBeNull();
    expect(parseLabelReading({ legible: true, manufactured: '1890' })?.manufactured).toBeNull();
    expect(parseLabelReading({ legible: true, manufactured: 'recent' })?.manufactured).toBeNull();
    expect(parseLabelReading({ legible: true })?.manufactured).toBeNull();
  });
});

describe('yearMade', () => {
  it('refuses a year after this one', () => {
    const now = new Date(2026, 8, 27);
    expect(yearMade('2026', now)).toBe('2026');
    expect(yearMade('2027', now)).toBeNull();
  });
});

describe('brandCase', () => {
  it.each([
    ['SAMSUNG', 'Samsung'],
    ['FISHER & PAYKEL', 'Fisher & Paykel'],
    ['DE\'LONGHI', 'De\'Longhi'],
    ['LG', 'LG'],
    ['AEG', 'AEG'],
    ['3M', '3M'],
    ['RESENE', 'Resene'],
  ])('reads %p as %p', (shouted, want) => {
    expect(brandCase(shouted)).toBe(want);
  });

  it('leaves a name that already has its own capitals alone', () => {
    expect(brandCase('iRobot')).toBe('iRobot');
    expect(brandCase('Smeg')).toBe('Smeg');
  });
});

describe('applyLabelReading', () => {
  it('fills an appliance’s empty boxes and says which', () => {
    const { next, filled } = applyLabelReading(
      blank,
      read({ make: 'Smeg', model: 'C6GMXA8', serial: '1690428', consumables: ['E14 25W 300°C'] }),
      'appliance'
    );
    expect(next).toMatchObject({ make: 'Smeg', model: 'C6GMXA8', serial: '1690428', takes: 'E14 25W 300°C' });
    expect(filled).toEqual(['make', 'model', 'serial', 'what it takes']);
  });

  it('fills the year made from the plate, into the spec, and says so', () => {
    const { next, filled } = applyLabelReading(blank, read({ make: 'Rinnai', manufactured: '2016' }), 'appliance');
    expect(next.spec).toEqual({ manufactured: '2016' });
    expect(filled).toEqual(['make', 'year made']);
    // Typed first, kept.
    const typed = applyLabelReading({ ...blank, spec: { manufactured: '2015' } }, read({ manufactured: '2016' }), 'appliance');
    expect(typed.next.spec.manufactured).toBe('2015');
    // A tin of paint was not "made" in a year anybody records.
    expect(applyLabelReading(blank, read({ manufactured: '2016' }), 'finish').next.spec).toEqual({});
  });

  it('never writes over a box somebody typed into', () => {
    // The rule the feature rests on: the person holding the appliance knows
    // better than a photograph of it.
    const { next, filled } = applyLabelReading(
      { ...blank, model: 'MSZ-AP50VGK' },
      read({ make: 'Mitsubishi', model: 'MSZ-AP50VG' }),
      'appliance'
    );
    expect(next.model).toBe('MSZ-AP50VGK');
    expect(filled).toEqual(['make']);
  });

  it('files a paint’s colour as its name, brand as make and code as model', () => {
    const { next } = applyLabelReading(
      blank,
      read({
        make: 'Resene', colourName: 'Wan White', colourCode: 'N93-005-105',
        sheen: 'Low sheen', tint: 'BS2 Y 12.5', hex: '#EAE8DF', serial: 'nope',
      }),
      'finish'
    );
    expect(next).toMatchObject({ name: 'Wan White', make: 'Resene', model: 'N93-005-105', serial: '' });
    expect(next.spec).toEqual({ sheen: 'Low sheen', tint: 'BS2 Y 12.5', hex: '#EAE8DF' });
  });

  it('takes a swatch only as the published value of a colour the tin names', () => {
    // A hex with no colour to be the value *of* can only be the photo judged by
    // eye, and a white under a kitchen bulb photographs grey.
    expect(applyLabelReading(blank, read({ make: 'Resene', hex: '#E4E2DC' }), 'finish').next.spec).toEqual({});
    const named = applyLabelReading(blank, read({ colourName: 'Wan White', hex: '#E4E2DC' }), 'finish');
    expect(named.next.spec).toEqual({ hex: '#E4E2DC' });
    expect(named.filled).toContain('swatch');
  });

  it('gives a paint no serial and an appliance no swatch', () => {
    expect(applyLabelReading(blank, read({ serial: '123' }), 'finish').next.serial).toBe('');
    expect(applyLabelReading(blank, read({ hex: '#FFFFFF' }), 'appliance').next.spec).toEqual({});
  });
});

// A reading that lands after *Add it* is offered on the thing's page rather
// than written. These pin what it may offer: the empty boxes together, a
// disagreement on its own, and nothing it already agrees with.
describe('labelOffers', () => {
  const thing = (over: Partial<Thing>): Thing => ({
    id: 't', householdId: 'h', propertyId: 'p', kind: 'appliance',
    name: 'Heat pump', room: 'Living room', photoPaths: ['h/plate.jpg'], documentPaths: [],
    make: null, model: null, serial: null, consumables: [],
    installedAt: null, warrantyUntil: null, serviceDays: null, spec: {}, notes: null,
    createdBy: 'me', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    propertyName: 'Home', snagCount: 0, openSnagCount: 0,
    ...over,
  });
  const plate = (over: Partial<LabelReading> = {}): LabelReading => ({
    legible: true, make: 'Mitsubishi Electric', model: 'MSZ-AP50VGK', serial: '7A204871', manufactured: null,
    colourName: null, colourCode: null, product: null, sheen: null, tint: null, hex: null,
    consumables: [],
    ...over,
  });

  it('offers every empty box together', () => {
    const offers = labelOffers(thing({}), plate());
    expect(offers.fill.map((one) => [one.key, one.value])).toEqual([
      ['make', 'Mitsubishi Electric'], ['model', 'MSZ-AP50VGK'], ['serial', '7A204871'],
    ]);
    expect(offers.differ).toEqual([]);
  });

  it('never offers over a box somebody filled — a disagreement is its own row, with what the record says', () => {
    const offers = labelOffers(thing({ model: 'MSZ-AP50', make: 'mitsubishi  electric' }), plate());
    expect(offers.fill.map((one) => one.key)).toEqual(['serial']);
    // Same words in other capitals and spacing is agreement, not a question.
    expect(offers.differ).toEqual([
      { key: 'model', label: 'Model', value: 'MSZ-AP50VGK', current: 'MSZ-AP50' },
    ]);
  });

  it('offers nothing a record already agrees with', () => {
    const offers = labelOffers(
      thing({ make: 'Mitsubishi Electric', model: 'MSZ-AP50VGK', serial: '7A204871' }),
      plate(),
    );
    expect(offers).toEqual({ fill: [], differ: [], parts: [] });
  });

  it('offers only part numbers the label printed, and drops one the thing already takes', () => {
    const offers = labelOffers(
      thing({ consumables: ['gu10 35w'] }),
      plate({ consumables: ['GU10 35W', 'Filter RFC-24'] }),
    );
    expect(offers.parts).toEqual(['Filter RFC-24']);
  });

  it('offers the year made the plate printed, beside the other boxes', () => {
    const offers = labelOffers(thing({ spec: {} }), plate({ manufactured: '2019' }));
    expect(offers.fill.map((one) => one.key)).toContain('manufactured');
    expect(labelOffersUpdate(offers.fill.filter((one) => one.key === 'manufactured')))
      .toEqual({ spec: { manufactured: '2019' } });
    const differ = labelOffers(thing({ spec: { manufactured: '2018' } }), plate({ manufactured: '2019' })).differ;
    expect(differ).toEqual([{ key: 'manufactured', label: 'Year made', value: '2019', current: '2018' }]);
  });

  it('reads a paint as a paint: its code, its spec, and a swatch only for a named colour', () => {
    const paint = thing({ kind: 'finish', name: 'Wan White' });
    const offers = labelOffers(paint, plate({
      make: 'Resene', model: null, serial: null, colourName: 'Wan White', colourCode: 'N93-005-105',
      sheen: 'Low sheen', hex: '#EAE8DF',
    }));
    expect(offers.fill.map((one) => [one.key, one.label, one.value])).toEqual([
      ['make', 'Brand', 'Resene'], ['model', 'Colour code', 'N93-005-105'],
      ['sheen', 'Sheen', 'Low sheen'], ['hex', 'Swatch', '#EAE8DF'],
    ]);
    expect(offers.parts).toEqual([]);
    const unnamed = labelOffers(paint, plate({ make: 'Resene', model: null, serial: null, hex: '#EAE8DF' }));
    expect(unnamed.fill.some((one) => one.key === 'hex')).toBe(false);
  });

  it('writes what was taken in one update, columns and spec apart', () => {
    expect(labelOffersUpdate([
      { key: 'make', label: 'Brand', value: 'Resene', current: null },
      { key: 'sheen', label: 'Sheen', value: 'Low sheen', current: null },
    ])).toEqual({ make: 'Resene', spec: { sheen: 'Low sheen' } });
  });
});

describe('parseLabelGuess', () => {
  it('reads what the photo shows, with a capital, and only kinds the walkthrough offers', () => {
    expect(parseLabelGuess({ whatItIs: 'heat pump', kindGuess: 'appliance' }))
      .toEqual({ name: 'Heat pump', kind: 'appliance' });
    expect(parseLabelGuess({ whatItIs: 'Paint', kindGuess: 'contact' })).toEqual({ name: 'Paint', kind: null });
    expect(parseLabelGuess({ whatItIs: '  ', kindGuess: null })).toBeNull();
    expect(parseLabelGuess(null)).toBeNull();
  });
});
