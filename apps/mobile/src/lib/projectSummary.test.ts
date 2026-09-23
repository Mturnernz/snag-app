import {
  describeRoom,
  formatMoney,
  projectSummary,
} from '@snag/supabase-queries';
import { bill, downstairs, element, item, page, project, quote } from '../test/projectFixtures';

const money = (n: number) => formatMoney(n) ?? '';

describe('projectSummary — the downstairs conversion', () => {
  const s = projectSummary(downstairs());

  it('takes the open set-aside out of Agreed and puts it in Undecided', () => {
    expect(s.agreed).toBe(196320);
    expect(s.undecided).toBe(12000);
  });

  it('is exactly agreed plus undecided, against the budget', () => {
    expect(s.expected).toBe(208320);
    expect(s.expected).toBe(s.agreed + s.undecided);
    expect(s.budget).toBe(230000);
    expect(s.left).toBe(21680);
  });

  it('lists what is left to decide with its price range, cheapest first', () => {
    expect(s.toDecide.map((d) => d.item.name)).toEqual(['Toilet', 'Vanity', 'Shower mixer']);
    const toilet = s.toDecide[0];
    expect([toilet.low, toilet.high]).toEqual([890, 2100]);
    expect(toilet.options.map((o) => o.amountIncl)).toEqual([890, 1450, 2100]);
    expect(toilet.setAside?.name).toBe('Bathroom hardware');
    expect(s.toDecide[2].options).toEqual([]);
  });

  it('puts the money where it is going, and the rows add up to the total', () => {
    const byName = Object.fromEntries(s.rooms.map((r) => [r.name, r]));
    expect(byName['Whole job'].total).toBe(186920);
    expect(byName.Laundry.total).toBe(9400);
    expect(byName.Bathroom.undecided).toBe(12000);
    expect(s.rooms.reduce((a, r) => a + r.total, 0)).toBe(s.expected);
  });

  it('says a settled set-aside in figures, and an open one by what is left', () => {
    const byName = Object.fromEntries(s.rooms.map((r) => [r.name, r]));
    expect(describeRoom(byName.Laundry, money)).toBe('$1,400 over the $8,000 set aside');
    expect(describeRoom(byName.Bathroom, money)).toBe('$12,000 set aside · 3 to decide');
    expect(describeRoom(byName['Whole job'], money)).toBe('5 suppliers');
  });

  it('carries the bills still owing, soonest first', () => {
    expect(s.paid).toBe(16020);
    expect(s.toPay).toBe(46000);
    expect(s.bills.map((b) => b.id)).toEqual(['b1']);
  });
});

describe('projectSummary — choosing against a set-aside', () => {
  it('keeps the rest of the set-aside undecided while other things on it are open', () => {
    // The toilet is chosen at $890, bought direct: the view drops the $12,000
    // allowance from the contract and adds the toilet in the bathroom.
    const base = downstairs();
    const s = projectSummary({
      ...base,
      project: { ...base.project, committedTotal: 196320 + 890, allowanceOpen: 0 },
      elements: base.elements.map((e: any) => (e.id === 'eB' ? { ...e, committedTotal: 890 } : e)),
      items: base.items.map((i: any) => (i.id === 'iT' ? { ...i, committed: 890 } : i)),
      quotes: base.quotes.map((q: any) =>
        q.id === 't1' ? { ...q, status: 'accepted', supersedesLineId: 'lB' } : q),
    });
    expect(s.agreed).toBe(197210);
    expect(s.undecided).toBe(11110);
    // Choosing inside the set-aside moves money from one row to the other and
    // leaves the expected total where it was.
    expect(s.expected).toBe(208320);
    expect(s.toDecide.map((d) => d.item.name)).toEqual(['Vanity', 'Shower mixer']);
  });

  it('lets the saving show once everything on a set-aside is chosen', () => {
    const base = downstairs();
    const decided = base.items.map((i: any) =>
      i.elementId === 'eB' ? { ...i, committed: i.id === 'iT' ? 890 : i.id === 'iV' ? 1290 : 600 } : i);
    const s = projectSummary({
      ...base,
      project: { ...base.project, committedTotal: 196320 + 2780, allowanceOpen: 0 },
      elements: base.elements.map((e: any) => (e.id === 'eB' ? { ...e, committedTotal: 2780 } : e)),
      items: decided,
      quotes: [
        ...base.quotes.map((q: any) =>
          q.id === 't1' || q.id === 'v1' ? { ...q, status: 'accepted', supersedesLineId: 'lB' } : q),
        quote({ id: 'm1', itemId: 'iM', supplier: 'Reece', amount: 600, status: 'accepted', supersedesLineId: 'lB' }),
      ],
    });
    expect(s.undecided).toBe(0);
    expect(s.expected).toBe(199100);
    const bathroom = s.rooms.find((r) => r.name === 'Bathroom')!;
    expect(describeRoom(bathroom, money)).toBe('$9,220 under the $12,000 set aside');
  });
});

describe('projectSummary — without a builder', () => {
  it('counts an undecided thing at its dearest option, so nothing surprises upwards', () => {
    const s = projectSummary(page({
      elements: [element()],
      items: [item({ id: 'iT', quoteCount: 2 })],
      quotes: [
        quote({ id: 'a', itemId: 'iT', amount: 890 }),
        quote({ id: 'b', itemId: 'iT', amount: 1450 }),
        quote({ id: 'c', itemId: 'iT', amount: 3000, status: 'declined' }),
      ],
    }));
    expect(s.undecided).toBe(1450);
    expect(s.expected).toBe(1450);
  });

  it('leaves out a thing somebody decided against', () => {
    const s = projectSummary(page({
      items: [item({ excluded: true })],
      quotes: [quote({ itemId: 'i1', amount: 4900 })],
    }));
    expect(s.toDecide).toEqual([]);
    expect(s.undecided).toBe(0);
  });

  it('counts a cost somebody warned about, and grosses up an ex-GST budget', () => {
    const s = projectSummary(page({
      project: project({ expectedOpen: 4500, budget: 10000, budgetInclGst: false }),
    }));
    expect(s.undecided).toBe(4500);
    expect(s.budget).toBe(11500);
    expect(s.left).toBe(7000);
  });

  it('has no budget line at all when nobody typed one', () => {
    const s = projectSummary(page());
    expect(s.budget).toBeNull();
    expect(s.left).toBeNull();
  });

  it('drops a bill that has been paid in full', () => {
    const s = projectSummary(page({
      bills: [bill({ id: 'paid', unpaid: 0 }), bill({ id: 'later', dueOn: '2026-11-01' }), bill({ id: 'soon', dueOn: '2026-10-01' })],
    }));
    expect(s.bills.map((b) => b.id)).toEqual(['soon', 'later']);
  });
});
