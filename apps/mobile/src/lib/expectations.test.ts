import {
  billsForExpected,
  expectedPaidBy,
  expectedPayee,
  expectedToPay,
  matchExpected,
  matchExpectedEach,
} from '@snag/supabase-queries';
import { quote } from '../test/projectFixtures';

/**
 * Which expected payment a bill pays off: the same business, within 10%, the
 * closest and then the oldest first. It suggests and never links on its own —
 * the screens write `settled_by` when a person saves.
 */

const expected = (over: any = {}): any => ({
  id: 'x1', projectId: 'p1', elementId: null, name: 'Reliabuilder payment 3/4',
  amount: 43987.5, amountInclGst: true, likelySupplier: null, note: null,
  confirmed: false, settledBy: null, createdAt: '2026-09-24T09:33:57Z', ...over,
});
const claim3 = expected();
const claim4 = expected({ id: 'x2', name: 'Reliabuilder payment 4/4', createdAt: '2026-09-24T09:34:47Z' });
const bill = (over: any = {}): any => quote({
  id: 'b9', kind: 'invoice', status: 'accepted', supplier: 'RELIABUILDER LIMITED', amount: 43987.5,
  createdAt: '2026-09-26T00:00:00Z', ...over,
});

describe('matchExpected', () => {
  it('reads the business off the name when the expectation names no supplier', () => {
    const [best] = matchExpected({ supplier: 'RELIABUILDER LIMITED', amountIncl: 43987.5 }, [claim3]);
    expect(best.expected.id).toBe('x1');
    expect(best.strength).toBe('strong');
  });

  it('takes the expectation’s own supplier when it has one, and then its name does not count', () => {
    const architect = expected({ id: 'a', name: 'Reliabuilder paperwork', likelySupplier: 'Gibson Architects' });
    expect(matchExpected({ supplier: 'Gibson Architects Ltd', amountIncl: 43987.5 }, [architect])).toHaveLength(1);
    expect(matchExpected({ supplier: 'ReliaBuilder', amountIncl: 43987.5 }, [architect])).toHaveLength(0);
  });

  it('matches whole words only — "cabinet" is not the business "AB"', () => {
    const cabinet = expected({ name: 'Cabinet install', amount: 500 });
    expect(matchExpected({ supplier: 'AB', amountIncl: 500 }, [cabinet])).toHaveLength(0);
    expect(matchExpected({ supplier: 'Relia Builder', amountIncl: 43987.5 }, [expected({ name: 'Relia Builder claim' })]))
      .toHaveLength(1);
  });

  it('is strong within 1% or a dollar, possible to 10%, and nothing beyond', () => {
    const at = (amountIncl: number) => matchExpected({ supplier: 'ReliaBuilder', amountIncl }, [claim3])[0]?.strength;
    expect(at(43988.4)).toBe('strong');
    expect(at(44400)).toBe('strong'); // 0.94%
    expect(at(47000)).toBe('possible'); // 6.8%
    expect(at(48386)).toBe('possible'); // 9.99%
    expect(at(48400)).toBeUndefined(); // 10.03%
    expect(at(30000)).toBeUndefined();
  });

  it('offers an expectation with no figure as possible', () => {
    const [m] = matchExpected({ supplier: 'ReliaBuilder', amountIncl: 5000 }, [expected({ amount: null })]);
    expect(m.strength).toBe('possible');
    expect(m.difference).toBeNull();
  });

  it('compares GST-inclusive on both sides', () => {
    const exGst = expected({ amount: 38250, amountInclGst: false }); // $43,987.50 incl
    expect(matchExpected({ supplier: 'ReliaBuilder', amountIncl: 43987.5 }, [exGst])[0].strength).toBe('strong');
  });

  it('pays off the oldest of two identical claims first, and never one already paid off', () => {
    const facts = { supplier: 'ReliaBuilder', amountIncl: 43987.5 };
    expect(matchExpected(facts, [claim4, claim3]).map((m) => m.expected.id)).toEqual(['x1', 'x2']);
    expect(matchExpected(facts, [claim4, { ...claim3, settledBy: 'b1' }]).map((m) => m.expected.id)).toEqual(['x2']);
  });

  it('puts the closest first, whatever their age', () => {
    const near = expected({ id: 'near', amount: 44000, createdAt: '2026-09-25T00:00:00Z' });
    const far = expected({ id: 'far', amount: 46000 });
    expect(matchExpected({ supplier: 'ReliaBuilder', amountIncl: 44100 }, [far, near])[0].expected.id).toBe('near');
  });

  it('says nothing for a bill that names no supplier', () => {
    expect(matchExpected({ supplier: null, amountIncl: 43987.5 }, [claim3])).toEqual([]);
  });
});

describe('billsForExpected', () => {
  it('offers the bills from its business within 10% first, and every other live bill after', () => {
    const quotes = [
      bill({ id: 'rb' }),
      bill({ id: 'far', amount: 20000 }),
      bill({ id: 'msc', supplier: 'MSC Consulting', amount: 437 }),
    ];
    const { matches, others } = billsForExpected(claim3, quotes, [claim3]);
    expect(matches.map((m) => m.quote.id)).toEqual(['rb']);
    expect(others.map((q) => q.id).sort()).toEqual(['far', 'msc']);
  });

  it('never offers a quote, a declined bill, a bill inside another, or one already paying off another', () => {
    const quotes = [
      bill({ id: 'price', kind: 'quote' }),
      bill({ id: 'declined', status: 'declined' }),
      bill({ id: 'inside', billedThroughId: 'host' }),
      bill({ id: 'used' }),
    ];
    const { matches, others } = billsForExpected(claim4, quotes, [claim4, { ...claim3, settledBy: 'used' }]);
    expect([...matches.map((m) => m.quote.id), ...others.map((q) => q.id)]).toEqual([]);
  });

  it('never offers as a match a bill that was on the job before the money was earmarked', () => {
    // The live job: the deposit and claim 2 are the same figure as claims 3 and 4.
    const deposit = bill({ id: 'dep', invoiceNumber: 'INV-0197', createdAt: '2026-09-24T05:23:58Z' });
    const { matches, others } = billsForExpected(claim3, [deposit, bill({ id: 'c3' })], [claim3]);
    expect(matches.map((m) => m.quote.id)).toEqual(['c3']);
    expect(others.map((q) => q.id)).toEqual(['dep']);
  });

  it('still offers the bill that already pays off this one', () => {
    const early = bill({ id: 'rb', createdAt: '2026-09-01T00:00:00Z' });
    const { matches } = billsForExpected({ ...claim3, settledBy: 'rb' }, [early], [{ ...claim3, settledBy: 'rb' }]);
    expect(matches.map((m) => m.quote.id)).toEqual(['rb']);
  });
});

describe('the section', () => {
  it('heads an expectation with the supplier its name spells, in that supplier’s spelling', () => {
    expect(expectedPayee(claim3, [bill()])).toBe('RELIABUILDER LIMITED');
    expect(expectedPayee(expected({ likelySupplier: 'Gibson Architects' }), [bill()])).toBe('Gibson Architects');
    expect(expectedPayee(expected({ name: 'Council fees' }), [bill()])).toBeNull();
  });

  it('totals what is still expected, GST-inclusive, and counts the unpriced in words', () => {
    const open = expectedToPay([claim3, claim4, expected({ id: 'c', amount: null }), { ...claim3, id: 'd', settledBy: 'b1' }]);
    expect(open).toEqual({ total: 87975, unpriced: 1, count: 3 });
  });

  it('finds the expectation a bill pays off', () => {
    expect(expectedPaidBy('b1', [claim3, { ...claim4, settledBy: 'b1' }])?.id).toBe('x2');
    expect(expectedPaidBy('b2', [claim3])).toBeNull();
  });
});

describe('matchExpectedEach', () => {
  it('offers two waiting claims the two expectations, oldest bill first, never one twice', () => {
    const facts = { supplier: 'RELIABUILDER LIMITED', amountIncl: 43987.5 };
    const each = matchExpectedEach([{ id: 'r1', ...facts }, { id: 'r2', ...facts }], [claim4, claim3]);
    expect(each.get('r1')?.[0].expected.id).toBe('x1');
    expect(each.get('r2')?.map((m) => m.expected.id)).toEqual(['x2']);
  });

  it('leaves out a bill nothing matches', () => {
    const each = matchExpectedEach([{ id: 'r1', supplier: 'MSC', amountIncl: 437 }], [claim3]);
    expect(each.has('r1')).toBe(false);
  });
});
