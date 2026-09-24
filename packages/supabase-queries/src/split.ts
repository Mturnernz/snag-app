/**
 * Sharing one bill between rooms: the arithmetic, kept pure so
 * `split.test.ts` can pin it without a network.
 *
 * A split is stored as **amounts**, never as fractions. Evenly is arithmetic the
 * app does once, when somebody chooses it, so what reads back is the dollars
 * each room took — and a third of $1,000 is $333.34, $333.33, $333.33, not three
 * rows of $333.33 and a cent left over on *Whole job* for ever.
 */

/** How a set of rooms reads: not split, split evenly, or split by amount. */
export type SplitKind = 'none' | 'even' | 'amounts';

const cents = (n: number): number => Math.round(n * 100);

/**
 * `total` shared evenly between `n` rooms, to the cent, adding up exactly.
 *
 * The odd cents go to the first rooms, so the list is stable for a given
 * order and its sum is always the total.
 */
export function evenSplit(total: number, n: number): number[] {
  if (n <= 0) return [];
  const whole = cents(total);
  const each = Math.floor(whole / n);
  const odd = whole - each * n;
  return Array.from({ length: n }, (_, i) => (each + (i < odd ? 1 : 0)) / 100);
}

/**
 * What a stored split is, so the sheet can open on the answer somebody gave.
 *
 * `even` means exactly what `evenSplit` would write for this total — so a bill
 * whose figure was corrected after an even split reads as amounts, which is
 * true: the rooms no longer cover it evenly, and saying otherwise would hide
 * the money now sitting on the whole job.
 */
export function splitKind(amounts: (number | null)[] | null, total: number | null): SplitKind {
  if (!amounts || amounts.length === 0 || amounts.some((a) => a === null)) return 'none';
  if (total !== null) {
    const even = evenSplit(total, amounts.length).map(cents).sort((a, b) => a - b);
    const got = (amounts as number[]).map(cents).sort((a, b) => a - b);
    if (even.every((c, i) => c === got[i])) return 'even';
  }
  return 'amounts';
}

/**
 * What a split leaves on the whole job. Negative means the rooms add up to more
 * than the bill, which the server refuses — the sheet says so before it asks.
 */
export function splitLeft(total: number, amounts: number[]): number {
  return (cents(total) - amounts.reduce((sum, a) => sum + cents(a), 0)) / 100;
}
