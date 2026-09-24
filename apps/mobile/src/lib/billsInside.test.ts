import {
  agreedContribution,
  billHosts,
  billsInside,
  guessFileTag,
  isInsideAnotherBill,
} from '@snag/supabase-queries';
import { quote } from '../test/projectFixtures';

/**
 * A bill inside another bill, and what a paper most likely is.
 *
 * The first is the fix for money counted twice: a plumber's variation made out
 * to the builder is already inside the builder's invoice. The link is
 * `billed_through_id`, which the views already read as passed through, so these
 * pin the page's half — what it offers, what it lists, and that Agreed drops
 * the inner bill exactly as the views do.
 */

const builder = quote({ id: 'rb', projectId: 'p1', supplier: 'RELIABUILDER LIMITED', kind: 'invoice', amount: 5587.85 });
const plumber = quote({ id: 'fp', projectId: 'p1', supplier: 'Force Plumbing', kind: 'invoice', amount: 1138.71 });
const sparky = quote({ id: 'gc', projectId: 'p1', supplier: 'Good Connections', kind: 'invoice', amount: 1549.26 });

describe('billHosts — what a bill could be inside', () => {
  it('offers the other bills, largest first, never itself', () => {
    expect(billHosts(plumber, [plumber, sparky, builder]).map((q) => q.id)).toEqual(['rb', 'gc']);
  });

  it('offers a signed price but not one still being compared, and never a declined one', () => {
    const contract = quote({ id: 'c', projectId: 'p1', kind: 'quote', status: 'accepted', amount: 150000 });
    const comparing = quote({ id: 't', projectId: 'p1', kind: 'quote', status: 'tbc', amount: 9000 });
    const refused = quote({ id: 'd', projectId: 'p1', kind: 'invoice', status: 'declined', amount: 9000 });
    expect(billHosts(plumber, [plumber, contract, comparing, refused]).map((q) => q.id)).toEqual(['c']);
  });

  // A chain would leave the reader following links to find what counts.
  it('never offers a bill that is itself inside another, or a progress claim', () => {
    const nested = { ...sparky, billedThroughId: 'rb' };
    const claim = quote({ id: 'cl', projectId: 'p1', kind: 'invoice', againstQuoteId: 'c', amount: 9000 });
    expect(billHosts(plumber, [plumber, nested, claim, builder]).map((q) => q.id)).toEqual(['rb']);
  });
});

describe('billsInside and isInsideAnotherBill', () => {
  const inPlumber = { ...plumber, billedThroughId: 'rb' };
  const inSparky = { ...sparky, billedThroughId: 'rb' };

  it('lists the bills inside one, largest first', () => {
    expect(billsInside(builder, [builder, inPlumber, inSparky]).map((q) => q.id)).toEqual(['gc', 'fp']);
  });

  // The same link on a price answering a set-aside means billed through the
  // builder's contract, which the thing's own sheet decides — not this.
  it('leaves a price answering a set-aside alone', () => {
    const answering = quote({ id: 'a', kind: 'invoice', billedThroughId: 'rb', supersedesLineId: 'l1' });
    expect(isInsideAnotherBill(answering)).toBe(false);
    expect(billsInside(builder, [builder, answering])).toEqual([]);
  });

  it('is a bill with the link, and nothing else', () => {
    expect(isInsideAnotherBill(inPlumber)).toBe(true);
    expect(isInsideAnotherBill(plumber)).toBe(false);
  });
});

describe('agreedContribution — the room breakdown drops it as the views do', () => {
  it('counts a bill of its own, and nothing for one inside another', () => {
    const inPlumber = { ...plumber, billedThroughId: 'rb' };
    const page = { quotes: [builder, inPlumber] };
    expect(agreedContribution(page, plumber)).toBe(1138.71);
    expect(agreedContribution(page, inPlumber)).toBe(0);
    expect(agreedContribution(page, builder)).toBe(5587.85);
  });
});

describe('guessFileTag — what a paper most likely is', () => {
  it.each([
    ['Electrical Certificate of Compliance & Electrical Safety Certificate', 'compliance'],
    ['Electrical - Certificate of Compliance.pdf', 'compliance'],
    ['PS3 producer statement', 'compliance'],
    ['Oven warranty card', 'warranty'],
    ['Mitsubishi MSZ-AP product data sheet', 'product_sheet'],
    ['Installation guide', 'product_sheet'],
  ])('reads "%s" as %s', (text, tag) => {
    expect(guessFileTag(text)).toBe(tag);
  });

  // A certificate's own title often names the product it certifies.
  it('puts a certificate ahead of the product it names', () => {
    expect(guessFileTag('Certificate of compliance — heat pump product installation')).toBe('compliance');
  });

  it('never guesses Other, and says nothing when the words say nothing', () => {
    expect(guessFileTag('Variation - Force Plumbing.pdf')).toBeNull();
    expect(guessFileTag(null, undefined, '')).toBeNull();
  });

  it('reads across every text it is given', () => {
    expect(guessFileTag('Tax invoice INV-1529', 'Warranty terms.pdf')).toBe('warranty');
  });
});
