import {
  declinedReviews, describePaidInference, invoiceReviewHeadline, pendingReviews, reviewAlert,
  wasInferred,
} from '@snag/supabase-queries';
import type { InvoiceReview } from '../types';
import {
  isHorizontalDrag, SWIPE_FLOOR, swipeDecision, swipeLean, swipeProgress, swipeThreshold,
} from './swipeDecision';

// An invoice arrives before anybody has decided what it is, and the whole
// feature is built against one failure: **an inference presented as a fact**.
// What these pin is the wording that keeps the guesses visible as guesses, and
// the thresholds that keep a thumb resting on a card from spending money.

const review = (over: Partial<InvoiceReview> = {}): InvoiceReview => ({
  id: 'r1', projectId: 'p1', elementId: null,
  supplier: 'ReliaBuilder Limited', detail: null,
  amount: 43987.5, amountInclGst: true,
  invoiceNumber: 'INV-0208', dated: '2026-07-02', dueOn: '2026-07-02',
  paid: false, paidOn: null, paidEvidence: null, category: null,
  sourceRef: null, sourceSubject: null, sourceFrom: null, sourceAt: null,
  inferred: [], state: 'pending', quoteId: null, decidedAt: null,
  photoPaths: [], documentPaths: [], roomIds: [], roomAmounts: null,
  createdAt: '2026-07-02T00:00:00Z',
  ...over,
});

describe('what the bell says', () => {
  it('counts what is waiting, in words', () => {
    expect(reviewAlert([review(), review({ id: 'r2' })])).toBe('You have 2 objects to review');
  });

  it('says one object rather than 1 objects', () => {
    expect(reviewAlert([review()])).toBe('You have 1 object to review');
  });

  // The shopping pill's rule, and *Fit* in PhotoViewer: at nought it would be
  // a control dressed as a choice, and a bell that is always there teaches
  // people it never means anything.
  it('is absent at nought rather than reading zero', () => {
    expect(reviewAlert([])).toBeNull();
    expect(reviewAlert([review({ state: 'declined' }), review({ id: 'r2', state: 'approved' })]))
      .toBeNull();
  });

  // Counting the bin would make the number climb as somebody cleared the deck,
  // which is the screen contradicting the work being done to it.
  it('counts pending only, so removing one makes it go down', () => {
    const deck = [review(), review({ id: 'r2' }), review({ id: 'r3' })];
    expect(reviewAlert(deck)).toBe('You have 3 objects to review');

    const afterRemoving = deck.map((r) => (r.id === 'r3' ? { ...r, state: 'declined' as const } : r));
    expect(reviewAlert(afterRemoving)).toBe('You have 2 objects to review');
  });
});

describe('the deck and the bin', () => {
  it('keeps the two apart', () => {
    const rows = [
      review({ id: 'a' }),
      review({ id: 'b', state: 'declined', decidedAt: '2026-09-01T00:00:00Z' }),
      review({ id: 'c', state: 'approved' }),
    ];
    expect(pendingReviews(rows).map((r) => r.id)).toEqual(['a']);
    expect(declinedReviews(rows).map((r) => r.id)).toEqual(['b']);
  });

  // A mistake is looked for straight after it is made, so the most recent
  // removal is the one at the top.
  it('puts the newest removal first in the bin', () => {
    const rows = [
      review({ id: 'old', state: 'declined', decidedAt: '2026-09-01T00:00:00Z' }),
      review({ id: 'new', state: 'declined', decidedAt: '2026-09-20T00:00:00Z' }),
    ];
    expect(declinedReviews(rows).map((r) => r.id)).toEqual(['new', 'old']);
  });

  // An approved card is not in the bin: it has a bill hanging off it, and
  // offering to put it back would be two records of one invoice.
  it('never shows an approved one as something to put back', () => {
    expect(declinedReviews([review({ state: 'approved' })])).toEqual([]);
  });
});

describe('what a card is called', () => {
  it('leads with the supplier and disambiguates with the number', () => {
    expect(invoiceReviewHeadline(review())).toBe('ReliaBuilder Limited · INV-0208');
  });

  it('falls back through the number, then the subject it arrived under', () => {
    expect(invoiceReviewHeadline(review({ supplier: null }))).toBe('INV-0208');
    expect(invoiceReviewHeadline(review({
      supplier: null, invoiceNumber: null, sourceSubject: 'Claim 2 - 32 Le Roy',
    }))).toBe('Claim 2 - 32 Le Roy');
  });

  // `snagHeadline`'s argument: a blank heading is worse than a dull one.
  it('never comes back empty', () => {
    expect(invoiceReviewHeadline(review({
      supplier: null, invoiceNumber: null, sourceSubject: null,
    }))).toBe('An invoice');
  });
});

describe('the paid flag never travels alone', () => {
  // The whole point. "Paid" on its own is the app asserting something it has
  // no bank statement for; the sentence is what a reader can disagree with.
  it('quotes what it was read from', () => {
    expect(describePaidInference(review({
      paid: true, paidEvidence: 'you replied “This is now paid” on 7 Jul',
    }))).toBe('Paid — you replied “This is now paid” on 7 Jul');
  });

  it('says so rather than borrowing confidence it has not got', () => {
    expect(describePaidInference(review({ paid: true })))
      .toBe('Paid — no sentence to show for it');
  });

  // Not paid is an answer too, and it is the one that costs money if it is
  // wrong — so it is stated rather than left as the absence of a tick.
  it('states the unpaid answer rather than staying silent', () => {
    expect(describePaidInference(review({ paid: false })))
      .toBe('Nothing in the thread says it was paid');
    expect(describePaidInference(review({
      paid: false, paidEvidence: 'Alyssa forwarded it asking for it to be paid',
    }))).toBe('Nothing in the thread says it was paid — Alyssa forwarded it asking for it to be paid');
  });
});

describe('a guess is marked as one', () => {
  it('names only the fields that were guessed', () => {
    const r = review({ inferred: ['category', 'paid'] });
    expect(wasInferred(r, 'category')).toBe(true);
    expect(wasInferred(r, 'paid')).toBe(true);
    expect(wasInferred(r, 'amount')).toBe(false);
  });

  it('marks nothing on a card read straight off the invoice', () => {
    expect(wasInferred(review(), 'amount')).toBe(false);
  });
});

describe('what a drag decides', () => {
  const WIDTH = 320;

  it('is right for yes and left for no', () => {
    expect(swipeDecision(200, WIDTH)).toBe('approve');
    expect(swipeDecision(-200, WIDTH)).toBe('decline');
  });

  // The common answer, and deliberately the default: a drag that did not
  // clearly mean either snaps back and asks again rather than guessing.
  it('decides nothing short of the threshold, in either direction', () => {
    expect(swipeDecision(0, WIDTH)).toBeNull();
    expect(swipeDecision(20, WIDTH)).toBeNull();
    expect(swipeDecision(-20, WIDTH)).toBeNull();
    expect(swipeDecision(swipeThreshold(WIDTH) - 1, WIDTH)).toBeNull();
  });

  it('decides exactly at the threshold, so the hint and the outcome agree', () => {
    expect(swipeDecision(swipeThreshold(WIDTH), WIDTH)).toBe('approve');
    expect(swipeProgress(swipeThreshold(WIDTH), WIDTH)).toBe(1);
  });

  // A quarter of a narrow card is a thumb resting. The floor is what keeps the
  // cheapest accident expensive enough to be deliberate.
  it('never asks for less than the floor, however narrow the card', () => {
    expect(swipeThreshold(100)).toBe(SWIPE_FLOOR);
    expect(swipeDecision(40, 100)).toBeNull();
    expect(swipeThreshold(400)).toBe(100);
  });

  // Above 1 is a no-op on native and a validation error in some web engines,
  // and the difference is a card that renders nothing at all.
  it('clamps the hint at one rather than running on', () => {
    expect(swipeProgress(10_000, WIDTH)).toBe(1);
    expect(swipeProgress(-10_000, WIDTH)).toBe(1);
    expect(swipeProgress(0, WIDTH)).toBe(0);
  });

  // The hint leans early so somebody can see the answer coming and change
  // their mind; the decision still needs the whole threshold.
  it('leans before it decides', () => {
    expect(swipeLean(10)).toBe('approve');
    expect(swipeDecision(10, WIDTH)).toBeNull();
    expect(swipeLean(-10)).toBe('decline');
    expect(swipeLean(0)).toBeNull();
  });

  // A card that claims every touch is a page that cannot be scrolled, which
  // reads as the screen having frozen.
  it('leaves a vertical drag to the page it sits on', () => {
    expect(isHorizontalDrag(4, 80)).toBe(false);
    expect(isHorizontalDrag(30, 60)).toBe(false);
    expect(isHorizontalDrag(60, 30)).toBe(true);
  });

  it('ignores a tap that wandered a few pixels', () => {
    expect(isHorizontalDrag(5, 0)).toBe(false);
    expect(isHorizontalDrag(20, 0)).toBe(true);
  });
});
