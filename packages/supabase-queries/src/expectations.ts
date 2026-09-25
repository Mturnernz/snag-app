/**
 * Which expected payment a bill pays off.
 *
 * An expected cost is money somebody has earmarked before anybody has billed
 * for it — "Reliabuilder payment 3/4", $43,987.50. When the bill for it
 * arrives, both would count: the bill in Agreed and the expectation in
 * Undecided, so the Expected total carries the same claim twice until somebody
 * deletes the expectation by hand. `project_expected_costs.settled_by` is the
 * link that stops that — every rollup already drops a settled expectation —
 * and this file finds the bill to link.
 *
 * **The same business, and an amount within 10%.** The business is compared
 * with `businessKey`, which reads *RELIABUILDER LIMITED* and *ReliaBuilder* as
 * one. An expectation that names no supplier is matched by its **own name**:
 * "Reliabuilder payment 3/4" is ReliaBuilder's, which is how the live job's two
 * earmarked claims were written. The amount is GST-inclusive on both sides:
 *
 *   - **strong** — within 1% or a dollar;
 *   - **possible** — within 10%, or an expectation with no figure at all.
 *
 * Further out than 10% is a different payment. **Strong first, then closest,
 * then oldest**, so of two identical claims the first bill pays off 3/4 and the
 * next one 4/4.
 *
 * **It suggests; a person confirms.** The best match arrives ticked beside the
 * bill, and saving writes the link — the bill's own screen is where it is seen
 * and where it can be taken back. A bill already paying off one expectation is
 * never offered another: one bill, one expectation.
 *
 * Pure, so `expectations.test.ts` can pin it without a network.
 */
import type { ProjectExpectedCost, ProjectQuote } from '@snag/shared-types';
import { businessKey, isInsideAnotherBill } from './papers';

/** An amount this close is the same payment: 1%, or a dollar either way. */
export const EXPECTED_STRONG = 0.01;
/** Further than this and it is a different payment. */
export const EXPECTED_TOLERANCE = 0.1;

export type ExpectedMatchStrength = 'strong' | 'possible';

export interface ExpectedMatch {
  expected: ProjectExpectedCost;
  strength: ExpectedMatchStrength;
  /** How far the bill is from the expectation, or null when either has no figure. */
  difference: number | null;
}

export interface BillMatch {
  quote: ProjectQuote;
  strength: ExpectedMatchStrength;
  difference: number | null;
}

/** What a bill is, as far as matching needs to know. */
export interface BillForMatching {
  supplier: string | null;
  /** GST-inclusive. */
  amountIncl: number | null;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** An expectation's figure, GST-inclusive, or null when it has none. */
export function expectedAmountIncl(x: ProjectExpectedCost): number | null {
  if (x.amount === null) return null;
  return x.amountInclGst ? x.amount : round(x.amount * 1.15);
}

/** The words of a name, lower case, letters and digits. */
function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Whether a run of whole words in `text` spells the business `key`. "Relia
 * Builder payment" spells `reliabuilder`; "cabinet" does not spell `ab`, which
 * a plain substring test would say it does.
 */
function namesBusiness(text: string, key: string): boolean {
  const ws = words(text);
  for (let i = 0; i < ws.length; i += 1) {
    let run = '';
    for (let j = i; j < ws.length && run.length < key.length; j += 1) {
      run += ws[j];
      if (run === key) return true;
    }
  }
  return false;
}

/** Whether an expectation belongs to this business: its supplier, or failing that its name. */
function isFrom(x: ProjectExpectedCost, key: string): boolean {
  const own = businessKey(x.likelySupplier);
  if (own) return own === key;
  return namesBusiness(x.name, key);
}

function grade(billAmount: number | null, x: ProjectExpectedCost):
  { strength: ExpectedMatchStrength; difference: number | null } | null {
  const expected = expectedAmountIncl(x);
  if (expected === null || billAmount === null) return { strength: 'possible', difference: null };
  const difference = round(Math.abs(billAmount - expected));
  const share = expected > 0 ? difference / expected : difference > 0 ? Infinity : 0;
  if (difference <= 1 || share <= EXPECTED_STRONG) return { strength: 'strong', difference };
  if (share <= EXPECTED_TOLERANCE) return { strength: 'possible', difference };
  return null;
}

function byBest<T extends { strength: ExpectedMatchStrength; difference: number | null }>(
  created: (row: T) => string,
) {
  return (a: T, b: T): number => {
    if (a.strength !== b.strength) return a.strength === 'strong' ? -1 : 1;
    const da = a.difference ?? Infinity;
    const db = b.difference ?? Infinity;
    if (da !== db) return da - db;
    return created(a).localeCompare(created(b));
  };
}

/**
 * The expected payments a bill could pay off, best first. Empty when the bill
 * names no supplier: an amount alone is not enough to say whose it is.
 */
export function matchExpected(bill: BillForMatching, expected: ProjectExpectedCost[]): ExpectedMatch[] {
  const key = businessKey(bill.supplier);
  if (!key) return [];
  return expected
    .filter((x) => x.settledBy === null && isFrom(x, key))
    .flatMap((x) => {
      const g = grade(bill.amountIncl, x);
      return g ? [{ expected: x, ...g }] : [];
    })
    .sort(byBest<ExpectedMatch>((m) => m.expected.createdAt));
}

/** Whether a price can pay off an expectation: a live bill that counts on its own. */
export function canSettleExpected(q: ProjectQuote): boolean {
  return q.kind === 'invoice' && q.status !== 'declined' && !isInsideAnotherBill(q);
}

/**
 * The bills on the job that could have paid this expectation — the ones from
 * its business within 10%, best first — and every other bill that could, newest
 * first, for when the paper says something the names do not. A bill already
 * paying off another expectation is in neither.
 *
 * **A bill recorded before the earmark was made is never a match.** Money is
 * earmarked for a bill that has not come yet, so one already on the job was
 * already counted: ReliaBuilder's deposit and second claim are the same
 * $43,987.50 as the two earmarked claims, and offering them as "looks like it"
 * would be offering to count a paid claim as the unpaid one. They stay in
 * `others`, where a person can still choose one.
 */
export function billsForExpected(
  x: ProjectExpectedCost,
  quotes: ProjectQuote[],
  expected: ProjectExpectedCost[],
): { matches: BillMatch[]; others: ProjectQuote[] } {
  const used = new Set(expected.filter((e) => e.id !== x.id && e.settledBy).map((e) => e.settledBy!));
  const bills = quotes.filter((q) => canSettleExpected(q) && !used.has(q.id));
  const earmarked = Date.parse(x.createdAt);
  const since = (q: ProjectQuote) => q.id === x.settledBy || !(Date.parse(q.createdAt) < earmarked);
  const matches = bills
    .flatMap((q) => {
      if (!since(q)) return [];
      const key = businessKey(q.supplier);
      if (!key || !isFrom(x, key)) return [];
      const g = grade(q.amountIncl, x);
      return g ? [{ quote: q, ...g }] : [];
    })
    .sort(byBest<BillMatch>((m) => m.quote.createdAt));
  const matched = new Set(matches.map((m) => m.quote.id));
  const others = bills
    .filter((q) => !matched.has(q.id))
    .sort((a, b) => (b.dated ?? b.createdAt).localeCompare(a.dated ?? a.createdAt));
  return { matches, others };
}

/**
 * Who an expectation will be paid to, as a heading: its supplier, or the
 * supplier on the job its name spells, in that supplier's own spelling. So
 * "Reliabuilder payment 3/4" sits under *RELIABUILDER LIMITED* beside the bills.
 */
export function expectedPayee(x: ProjectExpectedCost, quotes: ProjectQuote[]): string | null {
  const own = x.likelySupplier?.trim();
  if (own) return own;
  let best: string | null = null;
  let bestLength = 0;
  for (const q of quotes) {
    const name = q.supplier?.trim();
    const key = businessKey(name);
    if (name && key && key.length > bestLength && namesBusiness(x.name, key)) {
      best = name;
      bestLength = key.length;
    }
  }
  return best;
}

/** The expectation a bill pays off, if one does. */
export function expectedPaidBy(quoteId: string, expected: ProjectExpectedCost[]): ProjectExpectedCost | null {
  return expected.find((x) => x.settledBy === quoteId) ?? null;
}

/** What is still expected: the total of the figures, and how many have none. */
export function expectedToPay(expected: ProjectExpectedCost[]): { total: number; unpriced: number; count: number } {
  const open = expected.filter((x) => x.settledBy === null);
  return {
    total: round(open.reduce((sum, x) => sum + (expectedAmountIncl(x) ?? 0), 0)),
    unpriced: open.filter((x) => x.amount === null).length,
    count: open.length,
  };
}

/**
 * Matches for several bills at once — the cards waiting in the deck — without
 * offering one expectation to two of them. The bills are taken in the order
 * given (the caller passes oldest first), and each one's best match is set
 * aside before the next is asked, so two ReliaBuilder claims waiting side by
 * side offer 3/4 and 4/4 rather than 3/4 twice.
 */
export function matchExpectedEach(
  bills: (BillForMatching & { id: string })[],
  expected: ProjectExpectedCost[],
): Map<string, ExpectedMatch[]> {
  const taken = new Set<string>();
  const out = new Map<string, ExpectedMatch[]>();
  for (const bill of bills) {
    const found = matchExpected(bill, expected.filter((x) => !taken.has(x.id)));
    if (found.length === 0) continue;
    taken.add(found[0].expected.id);
    out.set(bill.id, found);
  }
  return out;
}
