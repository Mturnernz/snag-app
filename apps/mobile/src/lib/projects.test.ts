import {
  describeAllowance, describeBudget, describeBuildUp, describeLineVariance, describePartsBudget,
  describeTotals, formatMoney, groupProjectsByStatus, inclGst, itemPriceLabel, outstanding,
  projectDossierTable, projectExportPhotos, projectExportTable, showsElements,
} from '@snag/supabase-queries';
import { GST_RATE } from '../types';
import type {
  Project, ProjectElement, ProjectItem, ProjectQuote, ProjectTotals,
} from '../types';

/**
 * The money rules, which are the only part of this feature that can actually
 * hurt somebody.
 *
 * A wrong renovation total is not a cosmetic bug: it is a number people budget
 * against, and it goes wrong in the direction that costs them. So the three
 * rules are asserted as properties rather than as examples — a total always
 * ships its denominator, an unpriced item is never zero, and GST is a fact
 * about each amount rather than a household setting.
 */

const totals = (over: Partial<ProjectTotals> = {}): ProjectTotals => ({
  itemCount: 0, pricedCount: 0, quotedCount: 0,
  committedTotal: null, invoicedTotal: null, paidTotal: null, allowanceOpen: 0,
  ...over,
});

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', householdId: 'h', propertyId: 'prop', name: 'Downstairs laundry',
  summary: null, status: 'underway',
  startedOn: '2026-08-04', targetOn: null, finishedOn: null,
  budget: null, budgetInclGst: true,
  photoPaths: [], documentPaths: [],
  createdBy: 'me', createdAt: '2026-08-04T00:00:00Z', updatedAt: '2026-08-04T00:00:00Z',
  propertyName: 'Home', createdByName: 'Kate',
  elementCount: 1, shownElementCount: 0, fileCount: 0,
  snagCount: 0, openSnagCount: 0, thingCount: 0, installedCount: 0,
  partsBudgetTotal: null, partsBudgetedCount: 0,
  ...totals(), ...over,
});

const element = (over: Partial<ProjectElement> = {}): ProjectElement => ({
  id: 'e1', projectId: 'p1', name: 'Downstairs laundry', room: null,
  implicit: true, sortOrder: 0, notes: null, budget: null, budgetInclGst: true,
  photoPaths: [], documentPaths: [],
  createdAt: '2026-08-04T00:00:00Z',
  ...totals(), ...over,
});

const item = (over: Partial<ProjectItem> = {}): ProjectItem => ({
  id: 'i1', elementId: 'e1', name: 'Toilet suite', status: 'considering',
  sortOrder: 0, notes: null, photoPaths: [], documentPaths: [],
  createdAt: '2026-08-04T00:00:00Z',
  quoteCount: 0, tbcCount: 0, committed: null, invoiced: null, paid: null, allowanceOpen: 0,
  ...over,
});

const quote = (over: Partial<ProjectQuote> = {}): ProjectQuote => ({
  id: 'q1', itemId: 'i1', elementId: null, projectId: null, supplier: 'Mico', detail: null,
  amount: 1000, amountInclGst: true, kind: 'quote', status: 'tbc', basis: 'fixed',
  dated: null, notes: null, supersedesLineId: null, photoPaths: [], documentPaths: [],
  createdAt: '2026-08-04T00:00:00Z',
  amountIncl: 1000, lineCount: 0, linesTotal: null, buildUp: null, allowanceOpen: 0,
  effectiveAmount: 1000, paidTotal: null,
  ...over,
});

describe('GST is a fact about each amount', () => {
  it('leaves an inclusive figure alone and grosses up an exclusive one', () => {
    expect(inclGst(1000, true)).toBe(1000);
    expect(inclGst(1000, false)).toBe(1000 * (1 + GST_RATE));
  });

  it('keeps null as null, because an unpriced item is not a free one', () => {
    expect(inclGst(null, true)).toBeNull();
    expect(inclGst(null, false)).toBeNull();
  });

  it('rounds to the cent, so a third of a quote does not become a recurring decimal', () => {
    expect(inclGst(33.33, false)).toBe(38.33);
  });

  it('agrees with the server, which is the whole point of there being one rate', () => {
    // home.incl_gst does `round(amount * 1.15, 2)`. If these two ever disagree,
    // the figure on screen and the figure in the rollup disagree — and the one
    // people would trust is the wrong one.
    expect(GST_RATE).toBe(0.15);
  });
});

describe('a total always ships its denominator', () => {
  it('says how many of the items are actually priced', () => {
    expect(describeTotals(totals({ itemCount: 9, pricedCount: 5 }))).toContain('5 of 9 items priced');
  });

  it('counts the quoted-but-undecided separately from the never-asked', () => {
    const line = describeTotals(totals({ itemCount: 9, pricedCount: 5, quotedCount: 1 }));
    expect(line).toContain('1 quoted, not decided');
    // 9 - 5 - 1: the three nobody has asked about, said out loud rather than
    // left as arithmetic for the reader.
    expect(line).toContain('3 not priced');
  });

  it('is silent only when there is nothing at all to count', () => {
    expect(describeTotals(totals({ itemCount: 0 }))).toBeNull();
  });

  it('says how much of the total is still an allowance, beside the item count', () => {
    const line = describeTotals(totals({ itemCount: 9, pricedCount: 9, allowanceOpen: 22300 }));
    expect(line).toContain('9 of 9 items priced');
    expect(line).toContain('$22,300 still an allowance');
  });

  it('says it even when there are no items at all, because a contract is not an item', () => {
    // A renovation can be one builder's contract and nothing else. The
    // denominator has nothing to count and the allowance still has to be said.
    expect(describeTotals(totals({ itemCount: 0, allowanceOpen: 8400 })))
      .toBe('$8,400 still an allowance');
  });

  it('never claims everything is priced when nothing is', () => {
    expect(describeTotals(totals({ itemCount: 4, pricedCount: 0 }))).toContain('0 of 4');
  });
});

describe('an unpriced item is not a free one', () => {
  it('reads as "Not priced" rather than as $0', () => {
    const label = itemPriceLabel(item());
    expect(label.state).toBe('none');
    expect(label.text).toBe('Not priced');
    expect(label.text).not.toContain('0');
  });

  it('counts the prices in while nobody has decided, rather than pricing it', () => {
    // A band across quotes nobody has picked reads as a figure. What is
    // outstanding here is the decision, not the money.
    const label = itemPriceLabel(item({ quoteCount: 3, tbcCount: 3 }));
    expect(label.state).toBe('undecided');
    expect(label.text).toBe('3 prices in');
  });

  it('collapses to one figure once something is accepted', () => {
    const label = itemPriceLabel(item({ committed: 1240, quoteCount: 3, tbcCount: 2 }));
    expect(label.state).toBe('committed');
    expect(label.text).toBe('$1,240');
  });

  it('is committed on an invoice nobody ever quoted for', () => {
    // A consultant billing by the month has no quote and never will. Reading
    // that as "not priced" while money goes out of the door is how
    // committed-less-paid comes out negative.
    const label = itemPriceLabel(item({ committed: 4335.5, invoiced: 4335.5, quoteCount: 3 }));
    expect(label.state).toBe('committed');
    expect(label.text).toBe('$4,335.50');
  });
});

describe('what is still to pay', () => {
  it('is committed less paid, not invoiced less paid', () => {
    expect(outstanding({ committedTotal: 192354.22, paidTotal: 1952.47 })).toBe(190401.75);
  });

  it('is the whole of it when nothing has been paid', () => {
    expect(outstanding({ committedTotal: 8990, paidTotal: null })).toBe(8990);
  });

  it('is null rather than zero when nothing has been committed', () => {
    expect(outstanding({ committedTotal: null, paidTotal: null })).toBeNull();
  });

  it('never goes negative, because an overpayment is a mistake and not a debt', () => {
    expect(outstanding({ committedTotal: 1000, paidTotal: 1500 })).toBe(0);
  });

  it('keeps charged and paid apart, so a bill and its payment cannot both count', () => {
    // The old `spent` summed invoices and receipts together: record an $84,000
    // invoice and the payment settling it and the project read $168,000. These
    // are separate figures now and a payment is not the sort of row that can be
    // summed alongside a bill.
    const t = totals({ committedTotal: 84000, invoicedTotal: 84000, paidTotal: 84000 });
    expect(outstanding(t)).toBe(0);
    expect(t.invoicedTotal! + t.paidTotal!).not.toBe(outstanding(t));
  });
});

describe('a quote says whether its number can move', () => {
  it('says nothing about a fixed price, whatever its lines come to', () => {
    // The variance on a fixed-price contract is the builder's. A real change
    // costs a variation, which is a new quote.
    expect(describeBuildUp({ amountIncl: 168000, buildUp: 167240, basis: 'fixed' })).toBeNull();
  });

  it('gives the recomputed figure for an estimate', () => {
    expect(describeBuildUp({ amountIncl: 168000, buildUp: 167240, basis: 'estimate' }))
      .toBe('$167,240');
  });

  it('is silent when the build-up agrees with the amount', () => {
    expect(describeBuildUp({ amountIncl: 168000, buildUp: 168000, basis: 'estimate' })).toBeNull();
  });

  it('is silent when there are no lines to build up from', () => {
    expect(describeBuildUp({ amountIncl: 168000, buildUp: null, basis: 'estimate' })).toBeNull();
  });
});

describe('an allowance against what was actually quoted', () => {
  const allowance = { amount: 12400, amountInclGst: true, isAllowance: true };

  it('is the earliest honest warning that a job is going over', () => {
    // A real number from a real quote, months before the invoice, and nothing
    // had to be estimated to produce it. This is why there is no forecast.
    expect(describeLineVariance(allowance, 15900, false)).toBe('$3,500 over, if you accept it');
  });

  it('changes tense once the price is accepted', () => {
    expect(describeLineVariance(allowance, 15900, true)).toBe('$3,500 over the allowance');
  });

  it('says so when the answer came in under', () => {
    expect(describeLineVariance({ ...allowance, amount: 9000 }, 8240, true))
      .toBe('$760 under the allowance');
  });

  it('says nothing about a line that was never an allowance', () => {
    expect(describeLineVariance({ ...allowance, isAllowance: false }, 15900, true)).toBeNull();
  });

  it('says nothing while nothing has been quoted against it', () => {
    expect(describeLineVariance(allowance, null, false)).toBeNull();
  });
});

describe('an allowance is not an unpriced item', () => {
  it('is worded so the two can never be read as the same thing', () => {
    // An unpriced item contributes nothing and is counted in the denominator.
    // An allowance is somebody's written number and it counts towards the
    // total. Collapsing the wording collapses the distinction.
    const line = describeTotals(totals({ itemCount: 4, pricedCount: 1, allowanceOpen: 8400 }));
    expect(line).toContain('3 not priced');
    expect(line).toContain('still an allowance');
    expect(describeAllowance(totals({ allowanceOpen: 0 }))).toBeNull();
  });
});

describe('the budget line', () => {
  it('says how far over committed has got', () => {
    expect(describeBudget({ budget: 180000, budgetInclGst: true, committedTotal: 192354.22 }))
      .toBe('committed is $12,354.22 over it');
  });

  it('says how far under, in the same shape', () => {
    expect(describeBudget({ budget: 187000, budgetInclGst: true, committedTotal: 180000 }))
      .toBe('committed is $7,000 under it');
  });

  it('compares like with like, grossing an ex-GST budget first', () => {
    // A $100,000 ex-GST budget is $115,000 of bank account. Comparing the typed
    // figure against a GST-inclusive total would report $15,000 of overrun that
    // does not exist.
    expect(describeBudget({ budget: 100000, budgetInclGst: false, committedTotal: 115000 }))
      .toBe('committed is exactly on it');
  });

  it('is silent when no budget was ever set', () => {
    expect(describeBudget({ budget: null, budgetInclGst: true, committedTotal: 8990 })).toBeNull();
  });
});

describe('the parts budget, and the gap that is never resolved', () => {
  const p = { budget: 180000, budgetInclGst: true };

  it('names what is unallocated rather than rewriting the budget', () => {
    expect(describePartsBudget({ ...p, partsBudgetTotal: 172000, partsBudgetedCount: 3 }))
      .toBe('parts budgeted $172,000 of $180,000 · $8,000 unallocated');
  });

  it('says so when the parts add up to more than the whole', () => {
    expect(describePartsBudget({ ...p, partsBudgetTotal: 186000, partsBudgetedCount: 3 }))
      .toBe('parts budgeted $186,000 — $6,000 more than the budget');
  });

  it('says so when they land exactly on it', () => {
    expect(describePartsBudget({ ...p, partsBudgetTotal: 180000, partsBudgetedCount: 3 }))
      .toContain('the whole of the budget');
  });

  it('is silent when no part carries a budget, because there is nothing to reconcile', () => {
    expect(describePartsBudget({ ...p, partsBudgetTotal: null, partsBudgetedCount: 0 })).toBeNull();
  });
});

describe('money reads the way a household argues about it', () => {
  it('drops the cents when there are none', () => {
    expect(formatMoney(8990)).toBe('$8,990');
  });

  it('keeps them when there are, because an invoice gets reconciled', () => {
    expect(formatMoney(1240.55)).toBe('$1,240.55');
  });

  it('is null rather than "$0" for nothing', () => {
    expect(formatMoney(null)).toBeNull();
  });
});

describe('the middle layer appears only when it earns its place', () => {
  it('is hidden while the only element is implicit', () => {
    expect(showsElements([element({ implicit: true })])).toBe(false);
  });

  it('appears the moment a real one exists', () => {
    expect(showsElements([element({ implicit: false })])).toBe(true);
  });

  it('is hidden for a project with no elements at all', () => {
    expect(showsElements([])).toBe(false);
  });
});

describe('the tab groups by state, in the order people care', () => {
  it('puts underway first and done last', () => {
    const groups = groupProjectsByStatus([
      project({ id: 'a', status: 'done' }),
      project({ id: 'b', status: 'planned' }),
      project({ id: 'c', status: 'underway' }),
    ]);
    expect(groups.map((g) => g.status)).toEqual(['underway', 'planned', 'done']);
  });

  it('drops the empty groups rather than drawing three headings over one card', () => {
    const groups = groupProjectsByStatus([project({ status: 'planned' })]);
    expect(groups).toHaveLength(1);
  });
});

describe('the extract cannot say more than the record does', () => {
  const meta = { household: 'Home', place: 'Home', scope: 'Everything', stamp: '2026-09-16' };

  it('states the GST basis in the subtitle, because a forwarded file cannot be asked', () => {
    const table = projectExportTable([project()], meta);
    expect(table.subtitle).toContain('incl GST');
  });

  it('prints the denominator beside the count rather than a bare number', () => {
    const table = projectExportTable(
      [project({ itemCount: 9, pricedCount: 5, committedTotal: 8990 })],
      meta
    );
    expect(table.rows[0]).toContain('5 of 9');
  });

  it('marks a budget that was entered ex-GST rather than silently grossing it', () => {
    const table = projectExportTable([project({ budget: 14000, budgetInclGst: false })], meta);
    expect(table.rows[0].join('|')).toContain('excl GST');
  });

  it('gives an unpriced item its own row, saying so in words', () => {
    const table = projectDossierTable(
      project({ itemCount: 2, pricedCount: 1, committedTotal: 1240 }),
      [element()],
      [item({ id: 'i1', committed: 1240 }), item({ id: 'i2', name: 'Waterproofing' })],
      [quote({ status: 'accepted', amount: 1240 })],
      { household: 'Home', stamp: '2026-09-16' }
    );
    const waterproofing = table.rows.find((row) => row.includes('Waterproofing'));
    expect(waterproofing).toBeDefined();
    expect(waterproofing!).toContain('Not priced');
  });

  it('leaves the part-of-the-job column empty when the layer was never shown', () => {
    // An implicit element has a name nobody chose. Printing it would invent a
    // structure the reader never saw on screen.
    const table = projectDossierTable(
      project(), [element({ implicit: true })], [item()], [],
      { household: 'Home', stamp: '2026-09-16' }
    );
    expect(table.rows[0][0]).toBe('');
  });

  it('names the part of the job once the layer is real', () => {
    const table = projectDossierTable(
      project(),
      [element({ implicit: false, name: 'Bathroom renovation', room: 'Bathroom' })],
      [item()], [],
      { household: 'Home', stamp: '2026-09-16' }
    );
    expect(table.rows[0][0]).toBe('Bathroom renovation');
  });

  it('carries the totals as a final row, with the denominator on it', () => {
    const table = projectDossierTable(
      project({ itemCount: 9, pricedCount: 5, committedTotal: 8990, paidTotal: 3990 }),
      [element()], [item()], [],
      { household: 'Home', stamp: '2026-09-16' }
    );
    const last = table.rows[table.rows.length - 1];
    expect(last).toContain('TOTAL');
    expect(last.join('|')).toContain('5 of 9 priced');
  });

  it('carries charged and paid as separate columns, never one "spent"', () => {
    const table = projectExportTable(
      [project({ committedTotal: 192354.22, invoicedTotal: 97753.22, paidTotal: 1952.47 })],
      meta
    );
    expect(table.columns).toContain('Invoiced');
    expect(table.columns).toContain('Paid');
    expect(table.columns).not.toContain('Spent');
    // And the file states what is still to find, which is the question a
    // forwarded extract is actually opened to answer.
    expect(table.rows[0]).toContain('$190,401.75');
  });

  it('carries the allowance out of the app with the total it qualifies', () => {
    const table = projectExportTable(
      [project({ committedTotal: 167240, allowanceOpen: 22300 })],
      meta
    );
    expect(table.rows[0]).toContain('$22,300');
  });

  it('takes the project’s own photographs before any item’s second', () => {
    const photos = projectExportPhotos(
      project({ photoPaths: ['a.jpg', 'b.jpg'] }),
      [item({ photoPaths: ['i1.jpg', 'i2.jpg'] })],
      [element()]
    );
    // Round-robin: one from each source before any source's second, so a single
    // item photographed five times cannot spend the allowance.
    expect(photos.map((p) => p.path)).toEqual(['a.jpg', 'i1.jpg', 'b.jpg', 'i2.jpg']);
  });
});
