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

describe('projectSummary — a bill shared between rooms', () => {
  // Tile Space's $3,000 bill is on the whole job: tiles for the bathroom floor
  // and the laundry splashback. The views count it once, on the whole job; a
  // share only says how the room breakdown reads it.
  const tiles = quote({ id: 'tl', projectId: 'p1', supplier: 'Tile Space', amount: 3000, kind: 'invoice', status: 'accepted' });
  const shared = (quoteRooms: any[], extra: any[] = [tiles]) => {
    const base = downstairs();
    return projectSummary({
      ...base,
      project: { ...base.project, committedTotal: base.project.committedTotal + 3000 },
      quotes: [...base.quotes, ...extra],
      quoteRooms,
    });
  };
  const byName = (s: ReturnType<typeof projectSummary>) => Object.fromEntries(s.rooms.map((r) => [r.name, r]));
  const unshared = byName(shared([]));

  it('moves each share out of Whole job onto its room, and the total does not move', () => {
    const s = shared([
      { quoteId: 'tl', elementId: 'eB', amount: 2000, sortOrder: 0 },
      { quoteId: 'tl', elementId: 'eL', amount: 1000, sortOrder: 1 },
    ]);
    const rooms = byName(s);
    expect(rooms.Bathroom.agreed).toBe(unshared.Bathroom.agreed + 2000);
    expect(rooms.Laundry.agreed).toBe(unshared.Laundry.agreed + 1000);
    expect(rooms['Whole job'].agreed).toBe(unshared['Whole job'].agreed - 3000);
    expect(s.expected).toBe(208320 + 3000);
    expect(s.rooms.reduce((a, r) => a + r.total, 0)).toBe(s.expected);
    expect(describeRoom(rooms.Bathroom, money)).toBe('$12,000 set aside · 3 to decide · $2,000 of shared bills');
  });

  it('leaves what a split does not cover on Whole job', () => {
    const rooms = byName(shared([{ quoteId: 'tl', elementId: 'eB', amount: 1800, sortOrder: 0 }]));
    expect(rooms.Bathroom.shared).toBe(1800);
    expect(rooms['Whole job'].agreed).toBe(unshared['Whole job'].agreed - 1800);
  });

  it('records the rooms without moving money when nobody said how it splits', () => {
    const rooms = byName(shared([
      { quoteId: 'tl', elementId: 'eB', amount: null, sortOrder: 0 },
      { quoteId: 'tl', elementId: 'eL', amount: null, sortOrder: 1 },
    ]));
    expect(rooms.Bathroom.agreed).toBe(unshared.Bathroom.agreed);
    expect(rooms['Whole job'].agreed).toBe(unshared['Whole job'].agreed);
    expect(rooms.Laundry.sharedCount).toBe(1);
    expect(describeRoom(rooms.Laundry, money)).toBe('$1,400 over the $8,000 set aside');
    expect(describeRoom({ ...rooms.Laundry, setAside: null }, money)).toBe('On 1 shared bill');
  });

  it('shares an ex-GST bill in GST-inclusive dollars, adding up to the cent', () => {
    const exGst = quote({
      id: 'tl', projectId: 'p1', supplier: 'Tile Space', amount: 1000, amountInclGst: false,
      amountIncl: 1150, effectiveAmount: 1150, kind: 'invoice', status: 'accepted',
    });
    const s = shared([
      { quoteId: 'tl', elementId: 'eB', amount: 333.34, sortOrder: 0 },
      { quoteId: 'tl', elementId: 'eL', amount: 333.33, sortOrder: 1 },
      { quoteId: 'tl', elementId: 'eX', amount: 333.33, sortOrder: 2 },
    ], [exGst]);
    const rooms = byName(s);
    // eX is not a part of this job, so it holds nothing and its third stays on the job.
    expect(rooms.Bathroom.shared + rooms.Laundry.shared).toBe(766.67);
  });

  it('moves nothing for a bill that is a draw on a signed contract, a claim, or declined', () => {
    const draw = quote({ id: 'rb', projectId: 'p1', supplier: 'ReliaBuilder', amount: 5000, kind: 'invoice' });
    const claim = quote({ id: 'cl', projectId: 'p1', supplier: 'ReliaBuilder', amount: 5000, kind: 'invoice', againstQuoteId: 'c1' });
    const declined = quote({ id: 'dq', projectId: 'p1', supplier: 'Tile Depot', amount: 5000, status: 'declined' });
    const rows = ['rb', 'cl', 'dq'].map((quoteId) => ({ quoteId, elementId: 'eB', amount: 5000, sortOrder: 0 }));
    const rooms = byName(shared(rows, [tiles, draw, claim, declined]));
    expect(rooms.Bathroom.shared).toBe(0);
  });

  it('scales shares that somehow add up to more than the bill back to it', () => {
    const rooms = byName(shared([
      { quoteId: 'tl', elementId: 'eB', amount: 3000, sortOrder: 0 },
      { quoteId: 'tl', elementId: 'eL', amount: 3000, sortOrder: 1 },
    ]));
    expect(rooms.Bathroom.shared + rooms.Laundry.shared).toBe(3000);
  });
});
