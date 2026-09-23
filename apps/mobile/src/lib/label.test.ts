import {
  applyLabelReading, consumableOnList, parseLabelReading, swatchColour,
  type LabelFields, type LabelReading,
} from '@snag/supabase-queries';
import type { Snag } from '../types';

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
  legible: true, make: null, model: null, serial: null, colourName: null, colourCode: null,
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

  it('gives a paint no serial and an appliance no swatch', () => {
    expect(applyLabelReading(blank, read({ serial: '123' }), 'finish').next.serial).toBe('');
    expect(applyLabelReading(blank, read({ hex: '#FFFFFF' }), 'appliance').next.spec).toEqual({});
  });
});
