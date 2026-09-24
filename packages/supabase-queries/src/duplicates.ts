/**
 * Is this bill already on the job?
 *
 * The same bill gets in twice in two ordinary ways: it is forwarded to the
 * job's address a second time, or it is typed in through the money sheet and
 * then arrives by email as well. On the live job INV-15879 and 25.010 went in
 * twice each and 81914 three times, and were found by eye and deleted.
 *
 * **This warns; it never refuses.** Two bills from one supplier for the same
 * amount are usually two progress claims — ReliaBuilder's deposit and claim 2
 * are both $43,987.50 — so the answer is a judgement for the person holding
 * the paper, and the screen offers *add it anyway* beside the warning.
 *
 * The rules, strongest first:
 *
 *   1. **The same invoice number from the same supplier** is the same bill.
 *      Numbers are compared ignoring case, spaces and punctuation, so
 *      `INV-0208` and `inv 0208` agree. Where one side names no supplier —
 *      an emailed bill the reader could not place — the number has to be
 *      backed by the same amount, because a bare `81914` could be anybody's.
 *   2. **Two different numbers are two bills**, whatever else matches. This is
 *      what keeps the two ReliaBuilder claims apart.
 *   3. **With a number missing on either side, the same supplier and amount,
 *      on dates that do not disagree,** is likely the same bill. Two different
 *      dates are two bills — a consultant billing the same retainer monthly —
 *      but a bill typed in by hand carries no date on the paper at all, so a
 *      missing date is not taken as a difference.
 *
 * An older bill may carry its number only in free text — the money sheet used
 * to fold it into `detail` as "INV-0208 — Claim 2" — so a bill with no number
 * is also searched for the candidate's number as a whole word of its text.
 *
 * Pure and GST-aware without importing `index` (which re-exports this file):
 * callers pass figures already grossed, or use the two adapters below.
 */
import type { InvoiceReview, ProjectQuote } from '@snag/shared-types';

export interface BillFacts {
  id: string;
  supplier: string | null;
  invoiceNumber: string | null;
  /** GST-inclusive, as every rollup reads it. */
  amountIncl: number | null;
  /** The date on the paper. */
  dated: string | null;
  /** Free text an older row may have folded its number into. */
  text?: (string | null)[];
}

export type DuplicateReason = 'number' | 'amount';

export interface DuplicateMatch<T extends BillFacts = BillFacts> {
  match: T;
  reason: DuplicateReason;
}

/** An invoice number as it is compared: upper case, letters and digits only. */
export function invoiceKey(value: string | null | undefined): string | null {
  const key = (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return key.length > 0 ? key : null;
}

const supplierKey = (value: string | null | undefined): string | null => {
  const key = (value ?? '').trim().toLowerCase();
  return key.length > 0 ? key : null;
};

const sameCents = (a: number | null, b: number | null): boolean =>
  a !== null && b !== null && Math.round(a * 100) === Math.round(b * 100);

/** Whether `key` appears as a whole word of any of the texts. */
function textCarries(texts: (string | null)[] | undefined, key: string): boolean {
  return (texts ?? []).some((text) =>
    (text ?? '').split(/[\s,;:()/—–]+|\s-\s/).some((word) => invoiceKey(word) === key));
}

export function findDuplicateBill<T extends BillFacts>(
  existing: T[],
  candidate: Omit<BillFacts, 'id'> & { id?: string | null },
): DuplicateMatch<T> | null {
  const number = invoiceKey(candidate.invoiceNumber);
  const supplier = supplierKey(candidate.supplier);
  let byAmount: T | null = null;

  for (const bill of existing) {
    if (candidate.id && bill.id === candidate.id) continue;
    const theirs = supplierKey(bill.supplier);
    const sameSupplier = supplier !== null && theirs !== null && supplier === theirs;
    const eitherUnnamed = supplier === null || theirs === null;
    const theirNumber = invoiceKey(bill.invoiceNumber);

    if (number && theirNumber) {
      if (number !== theirNumber) continue;
      if (sameSupplier || (eitherUnnamed && sameCents(candidate.amountIncl, bill.amountIncl))) {
        return { match: bill, reason: 'number' };
      }
      continue;
    }

    if (number && !theirNumber && sameSupplier && textCarries(bill.text, number)) {
      return { match: bill, reason: 'number' };
    }

    if (
      !byAmount
      && sameSupplier
      && sameCents(candidate.amountIncl, bill.amountIncl)
      && (candidate.dated === null || bill.dated === null || candidate.dated === bill.dated)
    ) {
      byAmount = bill;
    }
  }

  return byAmount ? { match: byAmount, reason: 'amount' } : null;
}

const gross = (amount: number | null, incl: boolean): number | null =>
  amount === null ? null : incl ? amount : Math.round(amount * 115) / 100;

/**
 * The bills already on a job, as the check reads them. Only live bills: a quote
 * is not a bill, and a declined one is not on the job.
 */
export function billsOnJob(quotes: ProjectQuote[]): (BillFacts & { quote: ProjectQuote })[] {
  return quotes
    .filter((q) => q.kind === 'invoice' && q.status !== 'declined')
    .map((q) => ({
      id: q.id,
      supplier: q.supplier,
      invoiceNumber: q.invoiceNumber,
      amountIncl: q.amountIncl,
      dated: q.dated,
      text: [q.detail, q.notes],
      quote: q,
    }));
}

/** A waiting card, as the check reads it. */
export function billFactsOfReview(review: InvoiceReview): BillFacts {
  return {
    id: review.id,
    supplier: review.supplier,
    invoiceNumber: review.invoiceNumber,
    amountIncl: gross(review.amount, review.amountInclGst),
    dated: review.dated,
  };
}

/**
 * Each waiting card that looks like a bill already on the job, or like an
 * earlier card still waiting — the same email forwarded twice is two cards.
 * Keyed by review id; a card with no likely twin is absent. Paperwork is
 * never checked, and never matched against.
 */
export function duplicateReviews(
  quotes: ProjectQuote[],
  pending: InvoiceReview[],
): Map<string, { reason: DuplicateReason; quote: ProjectQuote | null; review: InvoiceReview | null }> {
  const onJob = billsOnJob(quotes);
  const found = new Map<string, { reason: DuplicateReason; quote: ProjectQuote | null; review: InvoiceReview | null }>();
  const earlier: (BillFacts & { review: InvoiceReview })[] = [];

  for (const review of pending) {
    // Paperwork is filed, never paid, so it cannot be a bill paid twice. A
    // subcontractor's variation made out to the builder can carry the same
    // figure as a line on the builder's invoice, and warning about that would
    // teach people to ignore the warning.
    if (review.kind === 'paperwork') continue;
    const facts = billFactsOfReview(review);
    const hit = findDuplicateBill(onJob, facts);
    if (hit) {
      found.set(review.id, { reason: hit.reason, quote: hit.match.quote, review: null });
    } else {
      const twin = findDuplicateBill(earlier, facts);
      if (twin) found.set(review.id, { reason: twin.reason, quote: null, review: twin.match.review });
    }
    earlier.push({ ...facts, review });
  }
  return found;
}
