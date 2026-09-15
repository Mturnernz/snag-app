import { REPEAT_PRESETS, SERVICE_CYCLES } from '../types';
import { describeCycle } from '@snag/supabase-queries';

// One vocabulary, two selections from it — snag repeats and thing services —
// and the invariant that binds them: **every interval either list offers has to
// come back out in the words the chip that set it used.**
//
// It didn't. `describeCycle` only reaches months on a multiple of 30, and
// REPEAT_PRESETS offered six months as 182 days, so pressing "Every 6 months"
// produced a snag the app then described as repeating "every 26 weeks". The
// service sheet meanwhile used 180 for the same phrase, so six months meant two
// different numbers depending on which screen you were standing on — and since
// scheduling a service creates a snag carrying that number, two snags with
// identical intent ended up with different repeats and different sentences.
//
// Asserting the numbers would only restate the fix. These assert the property,
// so the next interval added to either list cannot reintroduce it.

const everyOffered = [
  ...REPEAT_PRESETS.map((p) => ({ from: 'REPEAT_PRESETS', days: p.days })),
  ...SERVICE_CYCLES.map((days) => ({ from: 'SERVICE_CYCLES', days })),
];

describe('every interval the app offers', () => {
  it.each(everyOffered)('$from $days days reads as months or years', ({ days }) => {
    const said = describeCycle(days);
    expect(said).toMatch(/^(month|year|\d+ (months|years))$/);
  });

  // "26 weeks" and "180 days" are both true and both wrong here: nobody sets a
  // reminder in weeks, and the words have to match the chip.
  it.each(everyOffered)('$from $days days never falls back to weeks or days', ({ days }) => {
    expect(describeCycle(days)).not.toMatch(/week|day/);
  });

  it('is a whole number of months or years, which is why the above can hold', () => {
    for (const { days } of everyOffered) {
      expect(days % 30 === 0 || days % 365 === 0).toBe(true);
    }
  });
});

describe('the two lists agree about what a word means', () => {
  // The bug in one line: the same phrase, two numbers. Any interval in both
  // lists must be the same number of days, and any phrase used by both must
  // mean the same interval.
  it('never gives one phrase two different day counts', () => {
    const byPhrase = new Map<string, number>();
    for (const { days } of everyOffered) {
      const phrase = describeCycle(days);
      const seen = byPhrase.get(phrase);
      if (seen !== undefined) expect(days).toBe(seen);
      byPhrase.set(phrase, days);
    }
  });

  it('describes six months the same way from either list', () => {
    const repeat = REPEAT_PRESETS.find((p) => p.label === 'Every 6 months')!;
    expect(repeat.days).toBe(180);
    expect(SERVICE_CYCLES).toContain(repeat.days);
    expect(describeCycle(repeat.days)).toBe('6 months');
  });
});

describe('a preset says what it does', () => {
  // The label on the chip and the sentence the app says afterwards are written
  // in two different places; this is what stops them drifting apart again.
  it.each(REPEAT_PRESETS)('$label matches how $days days is described', ({ days, label }) => {
    const said = describeCycle(days);
    const expected = said === 'month' ? 'Monthly'
      : said === 'year' ? 'Yearly'
      : `Every ${said}`;
    expect(label).toBe(expected);
  });
});
