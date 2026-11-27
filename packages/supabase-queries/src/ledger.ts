import type { ProjectQuote } from '@snag/shared-types';
import { businessKey } from './papers';

/**
 * The project's money, the way the wireframe reads it (November 2026 reset).
 *
 * One pure function over a project's prices. A supplier's **Total** is what
 * they have invoiced; **Paid** and **Outstanding** follow from it. The
 * project's **Expected total** takes, for each supplier, whichever is more:
 * what they have invoiced, or the quotes from them that were accepted — so a
 * signed contract counts in full while its claims are still coming, and an
 * architect billing monthly with no quote counts at what they have billed.
 * **Difference** is the budget less that.
 *
 * Three rules keep it from counting money twice:
 * - a declined price counts nothing;
 * - a bill inside another bill (`billedThroughId`) counts once, through the
 *   bill that holds it;
 * - two spellings of one business are one supplier (`businessKey`).
 */

export interface LedgerSupplier {
  /** `businessKey` of the name, or `none` for prices naming nobody. */
  key: string;
  /** The spelling on the newest price. Null for prices naming nobody. */
  name: string | null;
  invoiced: number;
  paid: number;
  outstanding: number;
  acceptedQuotes: number;
  expected: number;
  /** Not declined, newest first. */
  invoices: ProjectQuote[];
  /** Every quote, declined ones too (the page dims them), newest first. */
  quotes: ProjectQuote[];
}

export interface QuotedRange {
  count: number;
  min: number;
  max: number;
}

export interface ProjectLedger {
  suppliers: LedgerSupplier[];
  invoiced: number;
  paid: number;
  outstanding: number;
  expected: number;
  /** Budget less expected. Null with no budget. Positive is under budget. */
  difference: number | null;
  /** The quotes nobody has turned down, for a planned project's card. */
  quotedRange: QuotedRange | null;
}

export const NO_SUPPLIER_KEY = 'none';

/** The key a price is grouped under. */
export function supplierKeyOf(supplier: string | null | undefined): string {
  return businessKey(supplier) ?? NO_SUPPLIER_KEY;
}

const isBill = (q: ProjectQuote) => q.kind === 'invoice' || q.kind === 'receipt';

const byNewest = (a: ProjectQuote, b: ProjectQuote) =>
  (b.dated ?? b.createdAt ?? '').localeCompare(a.dated ?? a.createdAt ?? '');

/** What is still owing on one bill. A receipt is paid by definition. */
export function billOutstanding(q: ProjectQuote): number {
  if (!isBill(q) || q.status === 'declined') return 0;
  if (q.kind === 'receipt') return 0;
  return Math.max(q.unpaid ?? q.amountIncl ?? 0, 0);
}

const round = (n: number) => Math.round(n * 100) / 100;

export function projectLedger(prices: ProjectQuote[], budget: number | null): ProjectLedger {
  const groups = new Map<string, LedgerSupplier & { latest: string }>();
  for (const q of prices) {
    const key = supplierKeyOf(q.supplier);
    let g = groups.get(key);
    if (!g) {
      g = {
        key, name: q.supplier?.trim() || null, invoiced: 0, paid: 0, outstanding: 0,
        acceptedQuotes: 0, expected: 0, invoices: [], quotes: [], latest: q.dated ?? q.createdAt ?? '',
      };
      groups.set(key, g);
    } else {
      const when = q.dated ?? q.createdAt ?? '';
      if (when >= g.latest && q.supplier?.trim()) {
        g.latest = when;
        g.name = q.supplier.trim();
      }
    }
    if (isBill(q)) {
      if (q.status === 'declined') continue;
      g.invoices.push(q);
      if (q.billedThroughId) continue;
      const amount = q.amountIncl ?? 0;
      const owing = billOutstanding(q);
      g.invoiced += amount;
      g.outstanding += owing;
      g.paid += Math.max(amount - owing, 0);
    } else {
      g.quotes.push(q);
      if (q.status === 'accepted') g.acceptedQuotes += q.amountIncl ?? 0;
    }
  }

  const suppliers: LedgerSupplier[] = [...groups.values()].map(({ latest: _latest, ...g }) => ({
    ...g,
    invoiced: round(g.invoiced),
    paid: round(g.paid),
    outstanding: round(g.outstanding),
    acceptedQuotes: round(g.acceptedQuotes),
    expected: round(Math.max(g.invoiced, g.acceptedQuotes)),
    invoices: g.invoices.sort(byNewest),
    quotes: g.quotes.sort(byNewest),
  }));
  // Biggest first: the builder before the man who trimmed the tree.
  suppliers.sort((a, b) => b.expected - a.expected || (a.name ?? '').localeCompare(b.name ?? ''));

  const sum = (f: (s: LedgerSupplier) => number) => round(suppliers.reduce((n, s) => n + f(s), 0));
  const expected = sum((s) => s.expected);
  const live = prices.filter((q) => q.kind === 'quote' && q.status !== 'declined' && q.amountIncl !== null);
  const amounts = live.map((q) => q.amountIncl as number);

  return {
    suppliers,
    invoiced: sum((s) => s.invoiced),
    paid: sum((s) => s.paid),
    outstanding: sum((s) => s.outstanding),
    expected,
    difference: budget === null || budget <= 0 ? null : round(budget - expected),
    quotedRange: amounts.length === 0
      ? null
      : { count: amounts.length, min: Math.min(...amounts), max: Math.max(...amounts) },
  };
}

/** "3 quotes · $850–$1,400", "$850", or null when there are none. */
export function describeQuoted(range: QuotedRange | null, money: (n: number) => string): string | null {
  if (!range) return null;
  if (range.count === 1 || range.min === range.max) {
    return range.count === 1 ? money(range.min) : `${range.count} quotes · ${money(range.min)}`;
  }
  return `${range.count} quotes · ${money(range.min)}–${money(range.max)}`;
}

/** "$1,200 under" / "$3,400 over" / "On budget". */
export function describeDifference(difference: number, money: (n: number) => string): { text: string; over: boolean } {
  if (Math.abs(difference) < 0.005) return { text: 'On budget', over: false };
  return difference > 0
    ? { text: `${money(difference)} under`, over: false }
    : { text: `${money(-difference)} over`, over: true };
}
