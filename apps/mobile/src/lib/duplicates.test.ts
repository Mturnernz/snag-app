import {
  billsOnJob, describeDuplicate, duplicateReviews, findDuplicateBill, invoiceKey, type BillFacts,
} from '@snag/supabase-queries';
import { quote } from '../test/projectFixtures';

/**
 * Is this bill already on the job?
 *
 * The rule that must not erode is the second one: two different invoice
 * numbers are two bills, whatever else matches. ReliaBuilder's deposit and
 * claim 2 are both $43,987.50, and a check that flagged the second would be
 * wrong exactly where the money is largest — and teach people to ignore it.
 */

const bill = (over: Partial<BillFacts> = {}): BillFacts => ({
  id: 'b1', supplier: 'MSC Consulting Group Ltd', invoiceNumber: 'INV87022',
  amountIncl: 437, dated: '2026-08-31', ...over,
});

describe('invoiceKey', () => {
  it('ignores case, spaces and punctuation', () => {
    expect(invoiceKey('INV-0208')).toBe('INV0208');
    expect(invoiceKey(' inv 0208 ')).toBe('INV0208');
    expect(invoiceKey('25.010')).toBe('25010');
  });

  it('is nothing for an empty box', () => {
    expect(invoiceKey('  ')).toBeNull();
    expect(invoiceKey(null)).toBeNull();
  });
});

describe('findDuplicateBill', () => {
  it('matches the same number from the same supplier, however it was typed', () => {
    const hit = findDuplicateBill([bill()], {
      supplier: 'msc consulting group ltd ', invoiceNumber: 'inv-87022', amountIncl: 500, dated: null,
    });
    expect(hit).toEqual({ match: bill(), reason: 'number' });
  });

  it('never matches two different numbers — two progress claims for one figure are two bills', () => {
    const deposit = bill({ supplier: 'RELIABUILDER LIMITED', invoiceNumber: 'INV-0197', amountIncl: 43987.5, dated: '2026-04-21' });
    expect(findDuplicateBill([deposit], {
      supplier: 'RELIABUILDER LIMITED', invoiceNumber: 'INV-0208', amountIncl: 43987.5, dated: '2026-04-21',
    })).toBeNull();
  });

  it('does not match one number from two named suppliers', () => {
    expect(findDuplicateBill([bill()], {
      supplier: 'Tile Space', invoiceNumber: 'INV87022', amountIncl: 437, dated: null,
    })).toBeNull();
  });

  it('matches a number from an unnamed supplier only when the figure agrees too', () => {
    const elite = bill({ supplier: 'elitebathroomware', invoiceNumber: '81914', amountIncl: 2300 });
    expect(findDuplicateBill([elite], { supplier: null, invoiceNumber: '81914', amountIncl: 2300, dated: null }))
      .toEqual({ match: elite, reason: 'number' });
    expect(findDuplicateBill([elite], { supplier: null, invoiceNumber: '81914', amountIncl: 99, dated: null }))
      .toBeNull();
  });

  it('finds a number an older bill folded into what it was for', () => {
    const typed = bill({ invoiceNumber: null, amountIncl: 999, text: ['INV87022 — Structural Engineering', null] });
    expect(findDuplicateBill([typed], {
      supplier: 'MSC Consulting Group Ltd', invoiceNumber: 'INV87022', amountIncl: 437, dated: null,
    })?.reason).toBe('number');
  });

  it('does not find a number inside a longer one', () => {
    const typed = bill({ invoiceNumber: null, amountIncl: 999, text: ['INV870221 — Structural'] });
    expect(findDuplicateBill([typed], {
      supplier: 'MSC Consulting Group Ltd', invoiceNumber: 'INV87022', amountIncl: 437, dated: null,
    })).toBeNull();
  });

  it('with a number missing, matches the same supplier and figure on dates that do not disagree', () => {
    const noNumber = bill({ invoiceNumber: null });
    expect(findDuplicateBill([noNumber], {
      supplier: 'MSC Consulting Group Ltd', invoiceNumber: null, amountIncl: 437, dated: null,
    })?.reason).toBe('amount');
    expect(findDuplicateBill([noNumber], {
      supplier: 'MSC Consulting Group Ltd', invoiceNumber: 'INV1', amountIncl: 437, dated: '2026-08-31',
    })?.reason).toBe('amount');
  });

  it('does not match the same retainer billed on two dates', () => {
    const july = bill({ invoiceNumber: null, dated: '2026-07-31' });
    expect(findDuplicateBill([july], {
      supplier: 'MSC Consulting Group Ltd', invoiceNumber: null, amountIncl: 437, dated: '2026-08-31',
    })).toBeNull();
  });

  it('compares figures to the cent', () => {
    const noNumber = bill({ invoiceNumber: null, amountIncl: 437 });
    expect(findDuplicateBill([noNumber], {
      supplier: 'MSC Consulting Group Ltd', invoiceNumber: null, amountIncl: 437.01, dated: null,
    })).toBeNull();
  });

  it('prefers a number match over a figure match', () => {
    const byFigure = bill({ id: 'a', invoiceNumber: null });
    const byNumber = bill({ id: 'n', amountIncl: 1 });
    expect(findDuplicateBill([byFigure, byNumber], {
      supplier: 'MSC Consulting Group Ltd', invoiceNumber: 'INV87022', amountIncl: 437, dated: null,
    })?.match.id).toBe('n');
  });

  it('never matches a bill with itself', () => {
    expect(findDuplicateBill([bill()], { ...bill() })).toBeNull();
  });
});

describe('billsOnJob', () => {
  it('reads only live bills — not quotes, not declined ones', () => {
    const rows = billsOnJob([
      quote({ id: 'q', kind: 'quote', amount: 437 }),
      quote({ id: 'd', kind: 'invoice', status: 'declined', amount: 437 }),
      quote({ id: 'b', kind: 'invoice', status: 'accepted', amount: 437, invoiceNumber: 'X1' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['b']);
    expect(rows[0].invoiceNumber).toBe('X1');
  });
});

describe('duplicateReviews', () => {
  const review = (over: any = {}): any => ({
    id: 'r1', supplier: 'MSC Consulting Group Ltd', invoiceNumber: 'INV87022',
    amount: 437, amountInclGst: true, dated: '2026-08-31', ...over,
  });
  const onJob = quote({
    id: 'b1', kind: 'invoice', status: 'accepted', supplier: 'MSC Consulting Group Ltd',
    invoiceNumber: 'INV87022', amount: 437, dated: '2026-08-31',
  });

  it('flags a card that is already on the job, and names the bill', () => {
    const found = duplicateReviews([onJob], [review()]);
    expect(found.get('r1')).toEqual({ reason: 'number', quote: onJob, review: null });
  });

  it('flags the later of two cards for the same email, not the first', () => {
    const first = review({ id: 'r1', invoiceNumber: '25.010', supplier: 'Gibson' });
    const again = review({ id: 'r2', invoiceNumber: '25.010', supplier: 'Gibson' });
    const found = duplicateReviews([], [first, again]);
    expect(found.has('r1')).toBe(false);
    expect(found.get('r2')?.review).toBe(first);
  });

  it('grosses an ex-GST card before comparing figures', () => {
    const exGst = review({ invoiceNumber: null, amount: 380, amountInclGst: false });
    expect(duplicateReviews([onJob], [exGst]).get('r1')?.reason).toBe('amount');
  });
});

describe('describeDuplicate', () => {
  it('names the number, who from, the figure and the date', () => {
    expect(describeDuplicate(bill(), 'on the job'))
      .toBe('Looks like INV87022 from MSC Consulting Group Ltd ($437, 31 Aug 2026), already on the job');
  });

  it('says a bill when there is no number, and waiting for a card', () => {
    expect(describeDuplicate(bill({ invoiceNumber: null, dated: null }), 'waiting'))
      .toBe('Looks like a bill from MSC Consulting Group Ltd ($437), also waiting');
  });
});
