import { evenSplit, splitKind, splitLeft } from '@snag/supabase-queries';

// Sharing a bill between rooms. A split is stored as dollars, so evenly has to
// be worked out once and add up to the cent — or a third of a bill leaves a
// one-cent row on Whole job for ever.

describe('evenSplit', () => {
  it('adds up to the bill exactly, odd cents first', () => {
    expect(evenSplit(1000, 3)).toEqual([333.34, 333.33, 333.33]);
    expect(evenSplit(0.05, 2)).toEqual([0.03, 0.02]);
    for (const [total, n] of [[43987.5, 7], [1, 3], [2480, 4], [19.99, 6]] as const) {
      const shares = evenSplit(total, n);
      expect(shares).toHaveLength(n);
      expect(Math.round(shares.reduce((a, b) => a + b, 0) * 100)).toBe(Math.round(total * 100));
    }
  });

  it('gives nothing for no rooms', () => {
    expect(evenSplit(100, 0)).toEqual([]);
  });
});

describe('splitKind', () => {
  it('reads back what was chosen', () => {
    expect(splitKind(null, 1000)).toBe('none');
    expect(splitKind([null, null], 1000)).toBe('none');
    expect(splitKind([333.33, 333.34, 333.33], 1000)).toBe('even');
    expect(splitKind([600, 400], 1000)).toBe('amounts');
  });

  it('calls an even split whose bill was corrected afterwards amounts, which it now is', () => {
    expect(splitKind([500, 500], 1200)).toBe('amounts');
  });
});

describe('splitLeft', () => {
  it('is what stays on the whole job, negative when the rooms add up to more', () => {
    expect(splitLeft(1000, [600, 300])).toBe(100);
    expect(splitLeft(1000, [600, 400])).toBe(0);
    expect(splitLeft(1000, [600, 500])).toBe(-100);
    expect(splitLeft(0.3, [0.1, 0.2])).toBe(0);
  });
});
