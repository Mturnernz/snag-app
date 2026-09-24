/**
 * One email, several papers: how the waiting cards from one forwarded email are
 * read together, and where a piece of paperwork is offered a home.
 *
 * `supabase/functions/inbound-bill` reads each attachment on its own and files
 * a card per paper, so an email carrying the builder's variation invoice, two
 * subcontractors' variations made out to the builder, a certificate of
 * compliance and a photo of the deck arrives as five cards. These helpers are
 * the page's half of that: they keep the five visibly one email, say what is
 * in it, and — for paperwork, which is filed rather than allocated — put the
 * likely bill to file it on first.
 *
 * Pure, and importing nothing from `index` (which re-exports this file).
 */
import type { InvoiceReview, InvoiceReviewKind, ProjectQuote } from '@snag/shared-types';

/**
 * Whether nothing has been read off a card or typed onto it. Only such a card
 * is offered *Read again*, and it is the same test `home.review_is_unread`
 * holds the server to, so the button never offers what the refile would refuse.
 */
export function isUnreadReview(review: InvoiceReview): boolean {
  return [review.supplier, review.detail, review.amount, review.invoiceNumber, review.dated, review.dueOn]
    .every((value) => value === null || value === undefined);
}

export interface ReviewGroup {
  /** The email id, or the card's own id for a card that came alone. */
  key: string;
  subject: string | null;
  reviews: InvoiceReview[];
}

/**
 * Cards grouped by the email they came in, in the order the deck already has,
 * each group in the email's own order of papers.
 *
 * A card from an email of one, or typed in by hand, is a group of one — the
 * page draws no heading for it, because a heading over one card says nothing
 * the card does not.
 */
export function reviewGroups(reviews: InvoiceReview[]): ReviewGroup[] {
  const groups: ReviewGroup[] = [];
  const byRef = new Map<string, ReviewGroup>();
  for (const review of reviews) {
    const ref = review.sourceRef;
    const existing = ref ? byRef.get(ref) : undefined;
    if (existing) {
      existing.reviews.push(review);
      continue;
    }
    const group: ReviewGroup = { key: ref ?? review.id, subject: review.sourceSubject, reviews: [review] };
    groups.push(group);
    if (ref) byRef.set(ref, group);
  }
  for (const group of groups) group.reviews.sort((a, b) => (a.sourcePart ?? 0) - (b.sourcePart ?? 0));
  return groups;
}

const KIND_WORDS: Record<InvoiceReviewKind, [string, string]> = {
  invoice: ['bill', 'bills'],
  quote: ['quote', 'quotes'],
  paperwork: ['to file', 'to file'],
};

/**
 * What one email held, in counts: "2 bills · 1 quote · 3 to file". Counted, so
 * somebody can check it against the email they forwarded — five papers sent,
 * five cards here.
 */
export function describeEmailGroup(reviews: InvoiceReview[]): string {
  const order: InvoiceReviewKind[] = ['invoice', 'quote', 'paperwork'];
  return order
    .map((kind) => {
      const n = reviews.filter((r) => r.kind === kind).length;
      if (n === 0) return null;
      const [one, many] = KIND_WORDS[kind];
      return `${n} ${n === 1 ? one : many}`;
    })
    .filter(Boolean)
    .join(' · ');
}

/**
 * The sentence a paperwork card carries when it was read as somebody else's
 * bill. It says why it is not a bill to pay, because a figure on a card with
 * no *Allocate* button is otherwise a card that looks broken.
 */
export function describeAddressedTo(review: InvoiceReview): string | null {
  if (review.kind !== 'paperwork' || !review.addressedTo) return null;
  return `Made out to ${review.addressedTo}, not you — kept as paperwork so it isn’t counted twice`;
}

/**
 * A business name as compared: lower case, letters and digits, without the
 * "Limited" the invoice prints and the email leaves off. "RELIABUILDER
 * LIMITED" and "ReliaBuilder" are one supplier.
 */
export function businessKey(name: string | null | undefined): string | null {
  const key = (name ?? '')
    .toLowerCase()
    .replace(/\b(limited|ltd|nz|new zealand|group|co)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
  return key.length > 0 ? key : null;
}

export interface PaperworkHomes {
  /**
   * Bills and quotes on the job from the business the paper names — who
   * issued it, or who it was made out to. The electrician's certificate goes
   * with the electrician's invoice; the plumber's variation made out to the
   * builder goes with the builder's.
   */
  suggested: ProjectQuote[];
  /** Every other bill or quote on the job, newest first. */
  others: ProjectQuote[];
}

/**
 * Where a piece of paperwork is offered a home, beyond the job and its parts.
 *
 * A declined price is left out — a certificate filed on a quote nobody took is
 * a certificate nobody will find. Suggestions come first because the
 * household's question is "which bill is this about", and the answer is nearly
 * always the one from the same business.
 */
export function paperworkHomes(review: InvoiceReview, quotes: ProjectQuote[]): PaperworkHomes {
  const keys = new Set([businessKey(review.supplier), businessKey(review.addressedTo)].filter(Boolean) as string[]);
  const live = quotes
    .filter((q) => q.status !== 'declined')
    .sort((a, b) => (b.dated ?? '').localeCompare(a.dated ?? ''));
  const suggested = live.filter((q) => {
    const key = businessKey(q.supplier);
    return key !== null && keys.has(key);
  });
  return { suggested, others: live.filter((q) => !suggested.includes(q)) };
}
