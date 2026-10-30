/**
 * What a job's own paperwork says that its records do not.
 *
 * Every check here came out of one review of the live projects (October 2026),
 * where three of five jobs showed a wrong figure and each wrong figure had a
 * sentence on the paper that would have caught it: *"Claim 2 of 25% plus
 * GST"*, *"Customer Quotation No. 33737"*, a deposit paid on one invoice that
 * was also recorded as its own. The checks read those sentences and **offer**;
 * nothing here writes, and nothing is applied without a press.
 *
 * Pure, so `checks.test.ts` can pin them without a network.
 */
import type { InvoiceReview, ProjectElement, ProjectPayment, ProjectQuote } from '@snag/shared-types';
import { businessKey } from './papers';

const round = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- claims

const scopeOf = (q: Pick<ProjectQuote, 'itemId' | 'elementId' | 'projectId'>): string =>
  q.itemId ? `i:${q.itemId}` : q.elementId ? `e:${q.elementId}` : `p:${q.projectId}`;

/** The digits a quote's number is known by: "QU-0111" → "0111", "Quote 0104" → "0104". */
function numberDigits(text: string | null | undefined): string | null {
  const digits = (text ?? '').replace(/\D/g, '');
  return digits.length >= 3 ? digits.replace(/^0+(?=\d{3})/, '') : null;
}

/** Quote numbers a bill's words name — "Balance of 50% Required - Quote 0104" names 0104. */
export function quoteNumbersNamed(text: string | null | undefined): string[] {
  const found: string[] = [];
  const re = /\b(?:quote|qu|quotation|estimate)\s*(?:no\.?|number|#)?\s*[-:]?\s*([a-z]{0,3}-?\d{3,})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? '')) !== null) {
    const digits = numberDigits(m[1]);
    if (digits) found.push(digits);
  }
  return found;
}

/** Whether a bill's words describe a stage of something bigger: a deposit, a claim, a percentage. */
export function soundsLikeAClaim(text: string | null | undefined): boolean {
  return /\b(deposit|claim|progress|instal?ment|balance|stage|final payment)\b|\d+(?:\.\d+)?\s*%/i.test(text ?? '');
}

/** The quotes a bill could be a claim against: at its scope, not turned down, its own business first. */
export function claimCandidates(bill: ProjectQuote, quotes: ProjectQuote[]): ProjectQuote[] {
  const key = businessKey(bill.supplier);
  return quotes
    .filter((q) => q.kind === 'quote' && q.status !== 'declined' && q.id !== bill.id && scopeOf(q) === scopeOf(bill))
    .sort((a, b) => Number(businessKey(b.supplier) === key) - Number(businessKey(a.supplier) === key));
}

export interface ClaimSuggestion {
  bill: ProjectQuote;
  contract: ProjectQuote;
  /** `names` — the bill quotes the contract's number; `stage` — it reads as a stage and there is one candidate. */
  reason: 'names' | 'stage';
}

/**
 * The contract one bill is most likely a claim against, or null.
 *
 * Offered only when the paper says so: the bill names the quote's number, or
 * it describes a stage ("Deposit of 25%", "Progress payment - 45%") and its
 * business has exactly one quote at that scope. **A bill that names a quote
 * the job does not hold gets nothing** — the roof's "Quote 0104" payments are
 * not claims on the deck's QU-0111, and guessing that they were is the mistake
 * that put −$61,982.24 on the live page.
 */
export function suggestedClaim(bill: ProjectQuote, quotes: ProjectQuote[]): ClaimSuggestion | null {
  if (bill.kind !== 'invoice' || bill.againstQuoteId || bill.billedThroughId || bill.status === 'declined') return null;
  const key = businessKey(bill.supplier);
  if (!key) return null;
  const mine = claimCandidates(bill, quotes).filter((q) => businessKey(q.supplier) === key);
  if (mine.length === 0) return null;

  const words = [bill.detail, bill.notes].filter(Boolean).join(' ');
  const named = quoteNumbersNamed(words);
  if (named.length > 0) {
    const contract = mine.find((q) => {
      const digits = numberDigits(q.invoiceNumber);
      return digits !== null && named.includes(digits);
    });
    return contract ? { bill, contract, reason: 'names' } : null;
  }
  if (soundsLikeAClaim(words) && mine.length === 1) return { bill, contract: mine[0], reason: 'stage' };
  return null;
}

/**
 * Quotes that look like one quote recorded twice: the same business, at the
 * same scope, for the same figure. The Downstairs job holds ReliaBuilder's
 * $176,755 twice — one numbered QU-0115, one with no number — and while both
 * are there no bill can be told which one it claims against.
 */
export function duplicateQuotes(quotes: ProjectQuote[]): { quote: ProjectQuote; twin: ProjectQuote }[] {
  const live = quotes.filter((q) => q.kind === 'quote' && q.status !== 'declined' && q.amountIncl !== null);
  const pairs: { quote: ProjectQuote; twin: ProjectQuote }[] = [];
  live.forEach((q, i) => {
    const key = businessKey(q.supplier);
    const twin = live.slice(i + 1).find((o) =>
      key !== null && businessKey(o.supplier) === key && scopeOf(o) === scopeOf(q)
      && Math.abs((o.amountIncl ?? 0) - (q.amountIncl ?? 0)) < 0.01);
    if (twin) pairs.push({ quote: q, twin });
  });
  return pairs;
}

/** Every bill on the job that reads like a claim on a contract it is not linked to. */
export function unlinkedClaims(quotes: ProjectQuote[]): ClaimSuggestion[] {
  return quotes
    .map((bill) => suggestedClaim(bill, quotes))
    .filter((s): s is ClaimSuggestion => s !== null);
}

/**
 * The contract a waiting card's bill is a stage of, read as `suggestedClaim`
 * reads a bill on the job: the quote its words name, or the one quote its
 * business has when it reads as a stage. At any scope, because allocating a
 * claim puts it where its contract sits. Never a guess past that.
 */
export function reviewClaim(
  review: Pick<InvoiceReview, 'kind' | 'supplier' | 'detail' | 'sourceSubject'>,
  quotes: ProjectQuote[],
): ClaimSuggestion['contract'] | null {
  if (review.kind !== 'invoice') return null;
  const key = businessKey(review.supplier);
  if (!key) return null;
  const mine = quotes.filter((q) => q.kind === 'quote' && q.status !== 'declined' && businessKey(q.supplier) === key);
  if (mine.length === 0) return null;
  const named = quoteNumbersNamed([review.detail, review.sourceSubject].filter(Boolean).join(' · '));
  if (named.length > 0) {
    return mine.find((q) => {
      const digits = numberDigits(q.invoiceNumber);
      return digits !== null && named.includes(digits);
    }) ?? null;
  }
  return soundsLikeAClaim(review.detail) && mine.length === 1 ? mine[0] : null;
}

/**
 * The bill already on the job that a waiting card says was paid before it:
 * the same business, for exactly the card's *less deposit paid*. Kitchen
 * Mania's V3 ($8,244.11) is INV-15879's deposit; recorded as its own bill and
 * paid again inside the final, it counted twice. Allocating puts it inside.
 */
export function depositBillFor(
  review: Pick<InvoiceReview, 'supplier' | 'alreadyPaid' | 'amountInclGst'>,
  quotes: ProjectQuote[],
): ProjectQuote | null {
  if (review.alreadyPaid == null) return null;
  const key = businessKey(review.supplier);
  if (!key) return null;
  const paid = round(review.amountInclGst ? review.alreadyPaid : review.alreadyPaid * 1.15);
  return quotes.find((q) =>
    q.kind === 'invoice' && q.status !== 'declined' && !q.billedThroughId && !q.againstQuoteId
    && businessKey(q.supplier) === key && q.amountIncl !== null && Math.abs(q.amountIncl - paid) < 0.01) ?? null;
}

// ---------------------------------------------------------- quote or bill

const QUOTE_WORDS = /\b(quote|quotation|proposal|estimate|fee proposal)\b/i;
const BILL_WORDS = /\b(tax invoice|invoice|receipt|statement|paid)\b/i;

/**
 * Whether a waiting card's own words call it a quote while it is down as an
 * invoice.
 *
 * Four papers on the live projects were recorded as paid invoices while they
 * called themselves a quote or a proposal — "Quote 81914", "New Kitchen
 * Proposal", "Customer Quotation No. 33737", a "fee proposal" — and an
 * invoice counts as money that has gone out. The subject, the description and
 * the files' names are read; a word for a bill anywhere outweighs them, so an
 * email titled "Quote" carrying a tax invoice is left alone.
 */
export function reviewSaysQuote(
  review: Pick<InvoiceReview, 'kind' | 'paid' | 'detail' | 'invoiceNumber' | 'sourceSubject' | 'documentPaths'>,
): boolean {
  // A paper that says it has been paid is a bill, whatever the email was called.
  if (review.kind !== 'invoice' || review.paid) return false;
  const names = review.documentPaths.map((p) => p.split('/').pop() ?? '');
  const words = [review.sourceSubject, review.detail, review.invoiceNumber, ...names].filter(Boolean).join(' · ');
  return QUOTE_WORDS.test(words) && !BILL_WORDS.test(words);
}

/** The same test for a price already on the job: an invoice whose words call it a quote. */
export function priceSaysQuote(q: Pick<ProjectQuote, 'kind' | 'detail' | 'documentPaths'>): boolean {
  if (q.kind !== 'invoice') return false;
  const names = q.documentPaths.map((p) => p.split('/').pop() ?? '');
  const words = [q.detail, ...names].filter(Boolean).join(' · ');
  return QUOTE_WORDS.test(words) && !BILL_WORDS.test(words);
}

// ----------------------------------------------------- money counted twice

export interface PaymentEcho {
  /** The bill a payment was recorded against. */
  bill: ProjectQuote;
  payment: ProjectPayment;
  /** Another bill from the same business for exactly the payment's figure. */
  twin: ProjectQuote;
}

/**
 * A payment on one bill that is exactly another bill from the same business.
 *
 * Kitchen Mania's INV-15879 ($27,480.37) was paid as $8,244.11 and then
 * $19,236.26 — and V3, the same $8,244.11, is on the job as its own paid
 * invoice. If V3 is the deposit, it is in every total twice. Only the person
 * holding the papers can say, so this is a question on the page, never a fix.
 */
export function paymentEchoes(quotes: ProjectQuote[], payments: ProjectPayment[]): PaymentEcho[] {
  const live = quotes.filter((q) => q.kind === 'invoice' && q.status !== 'declined' && !q.billedThroughId);
  const echoes: PaymentEcho[] = [];
  for (const payment of payments) {
    const bill = live.find((q) => q.id === payment.quoteId);
    if (!bill) continue;
    const paid = round(payment.amountInclGst ? payment.amount : payment.amount * 1.15);
    // A payment for the whole bill is the bill being paid, not a part of it.
    if (bill.amountIncl !== null && Math.abs(paid - bill.amountIncl) < 0.01) continue;
    const key = businessKey(bill.supplier);
    const twin = live.find((q) =>
      q.id !== bill.id && key !== null && businessKey(q.supplier) === key
      && q.amountIncl !== null && Math.abs(q.amountIncl - paid) < 0.01);
    if (twin) echoes.push({ bill, payment, twin });
  }
  return echoes;
}

// ------------------------------------------------------------- the rooms

const QUALIFIERS = new Set([
  'downstairs', 'upstairs', 'main', 'master', 'guest', 'new', 'old', 'the', 'and', 'of', 'room', 'area', 'level',
  'ground', 'first', 'second', 'front', 'back', 'rear', 'lower', 'upper',
]);

const wordsOf = (text: string): string[] =>
  text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3);

const sameWord = (a: string, b: string): boolean =>
  a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

/**
 * The parts of the job a bill's words name: "Bath And Laundry" names the
 * Laundry and the Downstairs Bathroom; "elitebathroomware" names the bathroom.
 *
 * An offer for the card, never applied — 17 of the 18 prices on the live
 * Downstairs job sat on the whole job, two of them shared out to rooms by hand
 * afterwards. Qualifiers (*Downstairs*, *Master*) are not what a room is
 * called on a bill, so they are not matched; and more than three rooms named
 * is a bill about the job, so it suggests nothing.
 */
export function suggestAreas(text: string | null | undefined, elements: ProjectElement[]): string[] {
  const tokens = wordsOf(text ?? '');
  if (tokens.length === 0) return [];
  const hits = elements
    .filter((e) => !e.implicit)
    .filter((e) => {
      const own = wordsOf(e.room ?? e.name).filter((w) => !QUALIFIERS.has(w));
      return own.length > 0 && own.some((w) => tokens.some((t) => sameWord(t, w) || (t.length > w.length && t.includes(w) && w.length >= 4)));
    })
    .map((e) => e.id);
  return hits.length <= 3 ? hits : [];
}

// ------------------------------------------------------------ paid when

export interface PaidDay {
  key: 'due' | 'dated' | 'today';
  /** YYYY-MM-DD. */
  day: string;
}

/**
 * Whether marking a bill paid should ask when.
 *
 * Twenty-two of the twenty-six payments on the live projects were dated the
 * day they were typed in, so the April deposit read "paid 24/09/2026" and a
 * 2022 bathroom read "paid 27/09/2026". A bill whose due date — or, without
 * one, its own date — is already past was most likely paid then, not today,
 * so the press asks. A bill due today or later, or with no dates at all, is
 * paid today in one press, as it always was.
 */
export function asksWhenPaid(bill: { dated: string | null; dueOn: string | null }, today: string): boolean {
  const reference = bill.dueOn ?? bill.dated;
  return reference !== null && reference < today;
}

/** The days offered for "When was it paid?": the due date, the bill's date, today — each once, in that order. */
export function paidDayChoices(bill: { dated: string | null; dueOn: string | null }, today: string): PaidDay[] {
  const choices: PaidDay[] = [];
  if (bill.dueOn && bill.dueOn <= today) choices.push({ key: 'due', day: bill.dueOn });
  if (bill.dated && bill.dated <= today && !choices.some((c) => c.day === bill.dated)) choices.push({ key: 'dated', day: bill.dated });
  if (!choices.some((c) => c.day === today)) choices.push({ key: 'today', day: today });
  return choices;
}
