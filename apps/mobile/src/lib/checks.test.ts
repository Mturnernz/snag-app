import {
  asksWhenPaid, businessKey, claimCandidates, depositBillFor, reviewClaim, reviewQuote, duplicateQuotes, paidDayChoices, paymentEchoes, priceSaysQuote, quoteNumbersNamed, reviewSaysQuote,
  soundsLikeAClaim, suggestAreas, suggestedClaim, unlinkedClaims,
} from '@snag/supabase-queries';
import { quote } from '../test/projectFixtures';

/**
 * What a job's own paperwork says that its records do not.
 *
 * Every case here is a real paper from the October 2026 review of the live
 * projects, where three of five jobs showed a wrong figure and each wrong
 * figure had a sentence on the paper that would have caught it.
 */

const deckQuote = quote({ id: 'qu111', projectId: 'p1', supplier: 'RELIABUILDER LIMITED', invoiceNumber: 'QU-0111', amount: 49482.2, status: 'accepted', detail: 'Deck and sub structure replacement' });
const bill = (id: string, detail: string, amount: number, over: any = {}) =>
  quote({ id, projectId: 'p1', supplier: 'RELIABUILDER LIMITED', kind: 'invoice', status: 'tbc', detail, amount, ...over });

describe('claims a bill’s own words describe', () => {
  const deposit = bill('0177', 'Deposit Required 20%', 9896.44);
  const progress = bill('0182', 'Deck and sub structure replacement - progress payment - 45%', 22266.99);
  const roof = bill('0167', 'Deposit of 50% Required - Quote 0104', 29434.25);
  const variation = bill('0184', 'Variations', 5587.85);

  it('reads the quote number a bill names, however it is written', () => {
    expect(quoteNumbersNamed('Balance of 50% Required - Quote 0104')).toEqual(['104']);
    expect(quoteNumbersNamed('Claim against QU-0115')).toEqual(['115']);
    expect(quoteNumbersNamed('Structural Engineering')).toEqual([]);
  });

  it('knows a stage of something bigger when it reads one', () => {
    expect(soundsLikeAClaim('Deposit of 25% plus GST')).toBe(true);
    expect(soundsLikeAClaim('Claim 2 of 25% plus GST')).toBe(true);
    expect(soundsLikeAClaim('Downstairs renovation/extension - Claim 3')).toBe(true);
    expect(soundsLikeAClaim('Architectural Services – to date')).toBe(false);
  });

  it('offers the contract a deposit or a progress payment is a stage of', () => {
    expect(suggestedClaim(deposit, [deckQuote, deposit])?.contract.id).toBe('qu111');
    expect(suggestedClaim(progress, [deckQuote, progress])?.reason).toBe('stage');
  });

  it('never offers a contract to a bill that names a different quote', () => {
    // The roof's 50% payments are against Quote 0104, which is not on the job.
    // Reading them as draws on the deck quote is what put −$61,982.24 on the page.
    expect(suggestedClaim(roof, [deckQuote, roof])).toBeNull();
  });

  it('offers the named quote over a guess', () => {
    const roofQuote = quote({ id: 'qu104', projectId: 'p1', supplier: 'ReliaBuilder', invoiceNumber: 'QU-0104', amount: 58868.5, status: 'accepted' });
    expect(suggestedClaim(roof, [deckQuote, roofQuote, roof])).toMatchObject({ contract: { id: 'qu104' }, reason: 'names' });
  });

  it('says nothing about a bill that is not a stage, or another business’s', () => {
    expect(suggestedClaim(variation, [deckQuote, variation])).toBeNull();
    const plumber = quote({ id: 'fp', projectId: 'p1', supplier: 'Force Plumbing', kind: 'invoice', detail: 'Deposit 50%', amount: 500 });
    expect(suggestedClaim(plumber, [deckQuote, plumber])).toBeNull();
  });

  it('says nothing when two quotes from the business could be the one', () => {
    const twin = quote({ id: 'dup', projectId: 'p1', supplier: 'ReliaBuilder', amount: 49482.2 });
    expect(suggestedClaim(deposit, [deckQuote, twin, deposit])).toBeNull();
  });

  it('leaves alone a bill already linked, inside another bill, or a quote', () => {
    expect(suggestedClaim({ ...deposit, againstQuoteId: 'qu111' }, [deckQuote])).toBeNull();
    expect(suggestedClaim({ ...deposit, billedThroughId: 'x' }, [deckQuote])).toBeNull();
    expect(suggestedClaim(deckQuote, [deckQuote])).toBeNull();
  });

  it('lists the business’s own quotes first, at the bill’s scope only', () => {
    const other = quote({ id: 'o', projectId: 'p1', supplier: 'Kitchen Mania', amount: 100 });
    const elsewhere = quote({ id: 'e', elementId: 'eL', projectId: null, supplier: 'ReliaBuilder', amount: 100 });
    expect(claimCandidates(deposit, [other, elsewhere, deckQuote]).map((q) => q.id)).toEqual(['qu111', 'o']);
  });

  it('finds every unlinked claim on the job at once', () => {
    expect(unlinkedClaims([deckQuote, deposit, progress, roof, variation]).map((s) => s.bill.id)).toEqual(['0177', '0182']);
  });

  it('notices one quote recorded twice', () => {
    const a = quote({ id: 'a', projectId: 'p1', supplier: 'RELIABUILDER LIMITED', invoiceNumber: 'QU-0115', amount: 176755 });
    const b = quote({ id: 'b', projectId: 'p1', supplier: 'RELIABUILDER LIMITED', amount: 176755 });
    const c = quote({ id: 'c', projectId: 'p1', supplier: 'Kitchen Mania', amount: 176755 });
    expect(duplicateQuotes([a, b, c]).map((d) => [d.quote.id, d.twin.id])).toEqual([['a', 'b']]);
  });
});

describe('a quote recorded as a bill', () => {
  const card = (over: any) => ({
    kind: 'invoice' as const, paid: false, detail: null, invoiceNumber: null, sourceSubject: null, documentPaths: [] as string[], ...over,
  });

  it('notices a card whose email or paper calls it a quote or a proposal', () => {
    expect(reviewSaysQuote(card({ sourceSubject: 'Fwd: Fw: Quote 81914 from ELITE BATHROOMWARE for ALYSSA TURN' }))).toBe(true);
    expect(reviewSaysQuote(card({ sourceSubject: 'Fwd: 32 Le Roy Terrace, Birkenhead- fee proposal' }))).toBe(true);
    expect(reviewSaysQuote(card({ detail: 'New Kitchen Proposal' }))).toBe(true);
  });

  it('leaves a bill alone when anything on it says invoice, or that it was paid', () => {
    expect(reviewSaysQuote(card({ sourceSubject: 'Fwd: Invoice INV-15879 from Kitchen Mania Limited' }))).toBe(false);
    expect(reviewSaysQuote(card({ sourceSubject: 'Fwd: Quote', paid: true }))).toBe(false);
    expect(reviewSaysQuote(card({ kind: 'quote', sourceSubject: 'Quote 1' }))).toBe(false);
  });

  it('notices an invoice on the job whose own words call it a quotation', () => {
    expect(priceSaysQuote({ kind: 'invoice', detail: 'Customer Quotation No. 33737', documentPaths: [] })).toBe(true);
    expect(priceSaysQuote({ kind: 'invoice', detail: null, documentPaths: ['h/docs/1-2-Quote 81914 20260608.pdf'] })).toBe(true);
    expect(priceSaysQuote({ kind: 'invoice', detail: 'KITCHEN, Supply and install', documentPaths: ['h/docs/1-2-Invoice INV-15879.pdf'] })).toBe(false);
  });
});

describe('money counted twice', () => {
  const kitchen = quote({ id: 'inv', projectId: 'p1', supplier: 'Kitchen Mania Limited', kind: 'invoice', amount: 27480.37, invoiceNumber: 'INV-15879' });
  const v3 = quote({ id: 'v3', projectId: 'p1', supplier: 'kitchenmania', kind: 'invoice', amount: 8244.11, invoiceNumber: 'V3' });
  const pay = (id: string, quoteId: string, amount: number) => ({
    id, quoteId, amount, amountInclGst: true, paidOn: null, reference: null, notes: null, photoPaths: [], documentPaths: [], createdAt: '',
  });

  it('flags a part payment that is exactly another bill from the same business', () => {
    const echoes = paymentEchoes([kitchen, v3], [pay('a', 'inv', 8244.11), pay('b', 'inv', 19236.26), pay('c', 'v3', 8244.11)]);
    expect(echoes.map((e) => [e.bill.id, e.twin.id, e.payment.id])).toEqual([['inv', 'v3', 'a']]);
  });

  it('says nothing about a bill paid in full, or a match from another business', () => {
    const other = quote({ id: 'o', projectId: 'p1', supplier: 'Tile Space', kind: 'invoice', amount: 8244.11 });
    expect(paymentEchoes([kitchen, other], [pay('a', 'inv', 8244.11)])).toEqual([]);
    expect(paymentEchoes([v3, kitchen], [pay('c', 'v3', 8244.11)])).toEqual([]);
  });
});

describe('the rooms a bill’s words name', () => {
  const el = (id: string, name: string, implicit = false) => ({ id, name, room: name, implicit } as any);
  const parts = [el('lau', 'Laundry'), el('work', 'Workshop'), el('bath', 'Downstairs Bathroom')];

  it('reads a room however the bill writes it, and never a qualifier', () => {
    expect(suggestAreas('Bath And Laundry', parts)).toEqual(['lau', 'bath']);
    expect(suggestAreas('elitebathroomware', parts)).toEqual(['bath']);
    expect(suggestAreas('Downstairs renovation/extension - Claim 3', parts)).toEqual([]);
    expect(suggestAreas('Structural Engineering', parts)).toEqual([]);
  });

  it('never suggests a part nobody named, or the hidden one', () => {
    expect(suggestAreas('Laundry', [el('x', 'Laundry', true)])).toEqual([]);
    expect(suggestAreas(null, parts)).toEqual([]);
  });
});

describe('when a bill was paid', () => {
  const today = '2026-10-30';

  it('asks for a bill that fell due before today, and not for one due later or undated', () => {
    expect(asksWhenPaid({ dated: '2026-04-21', dueOn: '2026-04-21' }, today)).toBe(true);
    expect(asksWhenPaid({ dated: '2025-05-31', dueOn: null }, today)).toBe(true);
    expect(asksWhenPaid({ dated: '2026-10-29', dueOn: '2026-11-20' }, today)).toBe(false);
    expect(asksWhenPaid({ dated: null, dueOn: null }, today)).toBe(false);
  });

  it('offers the due date, then the bill’s date, then today, each once', () => {
    expect(paidDayChoices({ dated: '2026-06-30', dueOn: '2026-07-20' }, today)).toEqual([
      { key: 'due', day: '2026-07-20' }, { key: 'dated', day: '2026-06-30' }, { key: 'today', day: today },
    ]);
    expect(paidDayChoices({ dated: '2026-04-21', dueOn: '2026-04-21' }, today).map((c) => c.key)).toEqual(['due', 'today']);
  });
});

describe('an emailed bill, before it lands', () => {
  const deck = quote({ id: 'qu111', projectId: 'p1', supplier: 'ReliaBuilder', invoiceNumber: 'QU-0111', amount: 49482.2, status: 'accepted' });
  const card = (over: any) => ({ kind: 'invoice' as const, supplier: 'RELIABUILDER LIMITED', detail: null, sourceSubject: null, ...over });

  it('names the contract a claim is a stage of, at any scope, from its words or its subject', () => {
    const onRoom = { ...deck, projectId: null, elementId: 'deck-part' };
    expect(reviewClaim(card({ detail: 'Deck — progress payment 45%' }), [onRoom])?.id).toBe('qu111');
    expect(reviewClaim(card({ sourceSubject: 'Fwd: Claim 2 against Quote QU-0111' }), [deck])?.id).toBe('qu111');
  });

  it('names nothing for a quote the job does not hold, a quote card, or a bill that is not a stage', () => {
    expect(reviewClaim(card({ detail: 'Balance of 50% Required - Quote 0104' }), [deck])).toBeNull();
    expect(reviewClaim(card({ kind: 'quote', detail: 'Deposit 20%' }), [deck])).toBeNull();
    expect(reviewClaim(card({ detail: 'Variations' }), [deck])).toBeNull();
  });

  it('goes with the quote chosen on the card, or none, over what its words name', () => {
    const other = quote({ id: 'qu104', projectId: 'p1', supplier: 'ReliaBuilder', invoiceNumber: 'QU-0104', amount: 58868.5 });
    const words = card({ detail: 'Deck — progress payment 45%', againstQuoteId: null, claimDecided: false });
    expect(reviewQuote(words, [deck])?.id).toBe('qu111');
    expect(reviewQuote({ ...words, claimDecided: true, againstQuoteId: 'qu104' }, [deck, other])?.id).toBe('qu104');
    expect(reviewQuote({ ...words, claimDecided: true, againstQuoteId: null }, [deck])).toBeNull();
    // A chosen quote since deleted is none, never the words' guess.
    expect(reviewQuote({ ...words, claimDecided: true, againstQuoteId: 'gone' }, [deck])).toBeNull();
    expect(reviewQuote({ ...words, kind: 'quote' }, [deck])).toBeNull();
  });

  it('finds the deposit already on the job that the paper says was paid', () => {
    const v3 = quote({ id: 'v3', projectId: 'p1', supplier: 'kitchenmania', kind: 'invoice', amount: 8244.11 });
    const final = { supplier: 'Kitchen Mania Limited', alreadyPaid: 8244.11, amountInclGst: true };
    expect(depositBillFor(final, [v3])?.id).toBe('v3');
    expect(depositBillFor({ ...final, alreadyPaid: 8000 }, [v3])).toBeNull();
    expect(depositBillFor({ ...final, alreadyPaid: null }, [v3])).toBeNull();
    expect(depositBillFor(final, [{ ...v3, billedThroughId: 'already-inside' }])).toBeNull();
  });

  it('compares a business the way the database does', () => {
    // `home.business_key` is held to these same answers by emailed_bills_say_more.sql.
    expect(businessKey('RELIABUILDER LIMITED')).toBe('reliabuilder');
    expect(businessKey('Kitchen Mania Ltd.')).toBe(businessKey('kitchenmania'));
    expect(businessKey('Fisher & Paykel NZ')).toBe('fisherpaykel');
    expect(businessKey('Co-op Builders')).toBe('opbuilders');
    expect(businessKey('  ')).toBeNull();
  });
});
