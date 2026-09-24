import {
  describeAllowance, describeBudget, describeBuildUp, describeForecast, describeForecastVariance,
  describeLineMovement, describeLineVariance, describePartsBudget, describeStillToBill,
  describeOverride, describeOverrides,
  describeToPay, describeTotals, forecastVariance, formatMoney, groupProjectsByStatus, inclGst,
  itemPriceLabel, milestoneAmount, outstanding,
  describeClaimed, matchSuppliers,
  projectDossierTable, projectExportPhotos, projectExportTable, projectQuoted,
  showsElements, stillToClaim, supplierBreakdown, supplierSuggestions,
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
  additionalOpen: 0,
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
  forecastTotal: null, forecastGuess: 0, expectedOpen: 0, expectedCount: 0, budgetGap: 0,
  expectedConfirmed: null,
  forecastDerived: null, committedDerived: null, invoicedDerived: null, paidDerived: null,
  forecastOverride: null, committedOverride: null, invoicedOverride: null, paidOverride: null,
  forecastNote: null, committedNote: null, invoicedNote: null, paidNote: null,
  partsEditedCount: 0,
  stillToBill: null, dueToPay: 0, overdueTotal: 0, nextDueOn: null, dueCount: 0,
  ...totals(), ...over,
});

const element = (over: Partial<ProjectElement> = {}): ProjectElement => ({
  id: 'e1', projectId: 'p1', name: 'Downstairs laundry', room: null,
  implicit: true, sortOrder: 0, notes: null, budget: null, budgetInclGst: true,
  committedDerived: null, invoicedDerived: null, paidDerived: null,
  committedOverride: null, invoicedOverride: null, paidOverride: null,
  committedNote: null, invoicedNote: null, paidNote: null,
  expectedOpen: 0, expectedCount: 0, expectedConfirmed: null, budgetGap: 0,
  photoPaths: [], documentPaths: [],
  createdAt: '2026-08-04T00:00:00Z',
  ...totals(), ...over,
});

const item = (over: Partial<ProjectItem> = {}): ProjectItem => ({
  id: 'i1', elementId: 'e1', name: 'Toilet suite', status: 'considering', excluded: false,
  setAsideLineId: null,
  sortOrder: 0, notes: null, photoPaths: [], documentPaths: [],
  createdAt: '2026-08-04T00:00:00Z',
  quoteCount: 0, tbcCount: 0, committed: null, invoiced: null, paid: null, allowanceOpen: 0,
  additionalOpen: 0,
  ...over,
});

const quote = (over: Partial<ProjectQuote> = {}): ProjectQuote => ({
  id: 'q1', itemId: 'i1', elementId: null, projectId: null, supplier: 'Mico', detail: null,
  amount: 1000, amountInclGst: true, kind: 'quote', status: 'tbc', basis: 'fixed',
  dated: null, notes: null, supersedesLineId: null, photoPaths: [], documentPaths: [],
  dueOn: null, billedThroughId: null, settlesMilestoneId: null, againstQuoteId: null, invoiceNumber: null,
  createdAt: '2026-08-04T00:00:00Z',
  amountIncl: 1000, lineCount: 0, linesTotal: null, buildUp: null, allowanceOpen: 0,
  additionalOpen: 0,
  effectiveAmount: 1000, paidTotal: null, unpaid: null, claimedTotal: null,
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

  it('shows the figure of the one quote nobody has decided on', () => {
    // An item carries a single active price, so "1 price in" was the row
    // refusing to say the one thing it knew. Still *undecided* — that is what
    // the colour carries — but the number is on screen.
    const label = itemPriceLabel(
      item({ quoteCount: 1, tbcCount: 1 }),
      [quote({ status: 'tbc', amountIncl: 400 })]
    );
    expect(label.state).toBe('undecided');
    expect(label.text).toBe('$400');
  });

  it('counts them instead once there is more than one to decide between', () => {
    // A band across quotes nobody has picked reads as a figure, and what is
    // outstanding there is the decision rather than the money.
    const label = itemPriceLabel(
      item({ quoteCount: 3, tbcCount: 3 }),
      [
        quote({ id: 'q1', status: 'tbc', amountIncl: 400 }),
        quote({ id: 'q2', status: 'tbc', amountIncl: 900 }),
        quote({ id: 'q3', status: 'tbc', amountIncl: 1200 }),
      ]
    );
    expect(label.state).toBe('undecided');
    expect(label.text).toBe('3 prices in');
  });

  it('still counts them when the quotes were not handed over', () => {
    const label = itemPriceLabel(item({ quoteCount: 3, tbcCount: 3 }));
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

/**
 * The forecast, and the discipline that keeps it from being a lie.
 *
 * Committed answers *what have we agreed to*. Three months into a job with five
 * items unpriced it is not the answer to *are we over*, and it fails in the
 * direction that costs money — everything nobody has priced counts as nought,
 * so the budget looks comfortable until the week it does not.
 *
 * A forecast is by construction partly invented, which is why every one of these
 * is about what it refuses to claim rather than what it adds up to.
 */
describe('the forecast says how much of itself is a guess', () => {
  it('never describes a forecast without its denominator', () => {
    const line = describeForecast(
      project({ forecastTotal: 198400, forecastGuess: 11200, itemCount: 18, pricedCount: 13 })
    );
    expect(line).toBe('13 of 18 items priced · $11,200 of it still a guess');
  });

  it('is silent when there is no forecast, rather than describing nothing', () => {
    expect(describeForecast(project({ forecastTotal: null }))).toBeNull();
  });

  it('keeps “still a guess” and “still an allowance” as different sentences', () => {
    // An allowance is somebody's written number inside a contract they signed,
    // so it counts as committed and is merely soft. A ballpark outside one and a
    // cost nobody has quoted are not committed at all. Collapsing the wording
    // would claim all three are somebody's written number, which two are not.
    const forecastLine = describeForecast(
      project({ forecastTotal: 198400, forecastGuess: 11200, itemCount: 9, pricedCount: 9 })
    );
    const allowanceLine = describeAllowance({ allowanceOpen: 11200 });
    expect(forecastLine).toContain('still a guess');
    expect(forecastLine).not.toContain('still an allowance');
    expect(allowanceLine).toBe('$11,200 still an allowance');
  });
});

describe('the variance warning', () => {
  const over = {
    budget: 187000, budgetInclGst: true, forecastTotal: 210000, forecastGuess: 17645.78,
    itemCount: 18, pricedCount: 13,
  };

  it('names the cause rather than printing a percentage', () => {
    expect(describeForecastVariance(over)).toBe(
      '$23,000 over budget — 5 items aren’t priced and $17,645.78 is still a guess'
    );
  });

  it('is silent under budget — it is a warning, not a running commentary', () => {
    expect(
      describeForecastVariance({ ...over, forecastTotal: 120000, forecastGuess: 0 })
    ).toBeNull();
  });

  it('is silent inside the 5% threshold, and speaks past it', () => {
    // 5% of $187,000 is $9,350 — about the smallest overrun worth interrupting
    // somebody for, and well above the noise of a rounded quote.
    expect(describeForecastVariance({ ...over, forecastTotal: 195000 })).toBeNull();
    expect(describeForecastVariance({ ...over, forecastTotal: 197000 })).not.toBeNull();
    expect(forecastVariance({ budget: 187000, budgetInclGst: true, forecastTotal: 196350 }))
      .toBeCloseTo(0.05, 10);
  });

  it('has no variance against a budget nobody typed, rather than reassuring with 0%', () => {
    expect(forecastVariance({ budget: null, budgetInclGst: true, forecastTotal: 210000 }))
      .toBeNull();
    expect(describeForecastVariance({ ...over, budget: null })).toBeNull();
  });

  it('grosses an ex-GST budget up before comparing, because the forecast is inclusive', () => {
    // $180,000 ex-GST is $207,000 inclusive, so a $210,000 forecast is 1.4% over
    // rather than 17% over. Comparing the two bases is a 15% error in the
    // direction that tells somebody to stop spending.
    expect(
      describeForecastVariance({ ...over, budget: 180000, budgetInclGst: false })
    ).toBeNull();
  });
});

describe('the two gaps are not the same gap', () => {
  it('reads committed less invoiced as what is still to come', () => {
    expect(describeStillToBill({ stillToBill: 88780 })).toBe('$88,780 still to be billed');
  });

  it('reports an over-claim rather than flooring it into a tidy zero', () => {
    // Negative means somebody has billed more than was ever committed, which is
    // the single most useful thing this subtraction can say.
    expect(describeStillToBill({ stillToBill: -1200 }))
      .toBe('$1,200 billed beyond what was committed');
  });

  it('says so plainly when everything committed has been billed', () => {
    expect(describeStillToBill({ stillToBill: 0 })).toBe('everything committed has been billed');
  });

  it('is silent when nothing has been committed at all', () => {
    expect(describeStillToBill({ stillToBill: null })).toBeNull();
  });

  it('leads with the overdue share when there is one', () => {
    expect(
      describeToPay({ dueToPay: 43987.5, overdueTotal: 12000, nextDueOn: '2026-10-20', dueCount: 2 })
    ).toBe('$12,000 overdue of $43,987.50');
  });

  it('names the date when nothing is late, because that is the actionable part', () => {
    expect(
      describeToPay({ dueToPay: 43987.5, overdueTotal: 0, nextDueOn: '2026-10-20', dueCount: 1 })
    ).toBe('$43,987.50 to pay · next due 20 Oct 2026');
  });

  it('counts the bills when none of them carries a date', () => {
    expect(describeToPay({ dueToPay: 4200, overdueTotal: 0, nextDueOn: null, dueCount: 3 }))
      .toBe('$4,200 to pay · 3 bills');
  });

  it('is absent at zero — a line that can only say “nothing owed” is not a line', () => {
    expect(describeToPay({ dueToPay: 0, overdueTotal: 0, nextDueOn: null, dueCount: 0 }))
      .toBeNull();
  });
});

describe('an allowance moves in both directions', () => {
  const line = { name: 'Laundry cabinetry', amount: 10000, amountInclGst: true, additional: false };

  it('says how far over a real quote has come, and that it is conditional', () => {
    expect(describeLineMovement(line, 12000, false))
      .toBe('allowed $10,000; quoted $12,000 — $2,000 over, if you accept it');
  });

  it('says how far under, because getting money back is as real an event', () => {
    // A design that only warns on overruns never tells anybody the fittings
    // supplier was worth ringing.
    expect(describeLineMovement(line, 7800, true))
      .toBe('allowed $10,000; quoted $7,800 — $2,200 under');
  });

  it('drops the conditional once the quote has been accepted', () => {
    expect(describeLineMovement(line, 12000, true)).not.toContain('if you accept it');
  });

  it('says nothing at all while nobody has priced it', () => {
    expect(describeLineMovement(line, null, false)).toBeNull();
  });

  it('says nothing when the allowance itself carries no figure', () => {
    expect(describeLineMovement({ ...line, amount: null }, 12000, false)).toBeNull();
  });
});

describe('a milestone resolves against the commitment it hangs off', () => {
  it('takes a percentage of the contract', () => {
    expect(milestoneAmount({ percent: 25, amount: null, amountInclGst: true }, 176755))
      .toBe(44188.75);
  });

  it('prefers a flat amount where one was given', () => {
    expect(milestoneAmount({ percent: null, amount: 5000, amountInclGst: true }, 176755))
      .toBe(5000);
  });

  it('grosses an ex-GST flat amount, because the rollups are inclusive', () => {
    expect(milestoneAmount({ percent: null, amount: 1000, amountInclGst: false }, null))
      .toBe(1150);
  });

  it('cannot invent a figure from a percentage of nothing', () => {
    expect(milestoneAmount({ percent: 25, amount: null, amountInclGst: true }, null)).toBeNull();
  });
});

/**
 * A number you can type over, and the app saying so.
 *
 * Every figure here is derived precisely so a stored total cannot disagree with
 * the quotes beneath it. An override is allowed to break that — but only on the
 * condition that **both numbers survive** and the gap is stated. These pin the
 * condition rather than the feature.
 */
describe('an edited figure names what it is standing in for', () => {
  it('always states the derived figure, never merely that something was edited', () => {
    expect(describeOverride('Committed', 200000, 103574.22)).toBe(
      'Committed is edited: $200,000 typed · the prices say $103,574.22 — $96,425.78 more'
    );
  });

  it('reads the other direction too', () => {
    expect(describeOverride('Paid', 4000, 9000)).toBe(
      'Paid is edited: $4,000 typed · the prices say $9,000 — $5,000 less'
    );
  });

  it('carries the note, because in eight months it is the only provenance there is', () => {
    expect(describeOverride('Committed', 200000, 190000, 'variation confirmed by email')).toContain(
      '— variation confirmed by email'
    );
  });

  it('says nothing where nothing was typed', () => {
    expect(describeOverride('Committed', null, 103574.22)).toBeNull();
  });

  it('does not manufacture a discrepancy when the typed figure matches', () => {
    // An edit that changes nothing is not a discrepancy, and reddening it would
    // be the screen inventing an alarm.
    expect(describeOverride('Committed', 8990, 8990)).toBe(
      'Committed is edited: $8,990 typed · the same as the prices'
    );
  });

  it('is honest when there is no derived figure to compare against', () => {
    expect(describeOverride('Committed', 5000, null)).toBe(
      'Committed is edited: $5,000 typed · nothing priced yet to compare it with'
    );
  });
});

describe('the discrepancy block', () => {
  const clean = project({
    forecastDerived: 103574.22, committedDerived: 103574.22,
    invoicedDerived: 97753.22, paidDerived: 1952.47,
  });

  it('is empty when nothing has been edited', () => {
    expect(describeOverrides(clean)).toEqual([]);
  });

  it('lists the figures in the order the page reads them', () => {
    const lines = describeOverrides(
      project({
        ...clean,
        forecastOverride: 210000, forecastDerived: 103574.22,
        committedOverride: 200000, committedDerived: 103574.22,
      })
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Forecast is edited');
    expect(lines[1]).toContain('Committed is edited');
  });

  it('counts edited parts rather than naming them', () => {
    // Naming four rooms here would put the parts list on the page twice; the
    // count is enough to send somebody looking.
    expect(describeOverrides(project({ ...clean, partsEditedCount: 2 }))).toEqual([
      '2 parts also have edited figures.',
    ]);
    expect(describeOverrides(project({ ...clean, partsEditedCount: 1 }))).toEqual([
      '1 part also has an edited figure.',
    ]);
  });
});

describe('quoted, and who each figure is made of', () => {
  const sup = (over: Partial<Record<string, unknown>> = {}) => ({
    supplierKey: 'x', supplier: 'X',
    quoted: null as number | null, committed: null as number | null,
    invoiced: null as number | null, paid: null as number | null,
    ...over,
  });

  it('is the sum of the supplier rows, so the line and the rows cannot disagree', () => {
    // The whole reason it is computed here rather than in a second view
    // expression: there is nothing to keep in step.
    const rows = [sup({ quoted: 176755 }), sup({ quoted: 1952.47 }), sup({ quoted: null })];
    expect(projectQuoted(rows)).toBe(178707.47);
  });

  it('is null where nobody has quoted anything, never zero', () => {
    // A job where three prices are in and a job where nobody has been asked
    // are different states, and telling them apart is the whole reason this
    // line sits above Committed.
    expect(projectQuoted([sup(), sup()])).toBeNull();
    expect(projectQuoted([])).toBeNull();
  });

  it('orders a breakdown largest first', () => {
    const rows = [
      sup({ supplierKey: 'a', committed: 1952.47 }),
      sup({ supplierKey: 'b', committed: 88814.5 }),
      sup({ supplierKey: 'c', committed: 4335.5 }),
    ];
    expect(supplierBreakdown(rows, 'committed').map((r) => r.row.supplierKey))
      .toEqual(['b', 'c', 'a']);
  });

  it('leaves out a supplier with nothing against that figure', () => {
    // "Tile Space, nothing invoiced" is not part of what Invoiced is made of,
    // and a list of noughts is how a breakdown stops being read.
    const rows = [sup({ supplierKey: 'a', invoiced: 4335.5 }), sup({ supplierKey: 'b' })];
    expect(supplierBreakdown(rows, 'invoiced')).toHaveLength(1);
    expect(supplierBreakdown(rows, 'invoiced')[0].amount).toBe(4335.5);
  });

  it('adds up to what it is a breakdown of', () => {
    const rows = [
      sup({ supplierKey: 'a', quoted: 176755, committed: 88814.5 }),
      sup({ supplierKey: 'b', quoted: null, committed: 4335.5 }),
      sup({ supplierKey: 'c', quoted: 1952.47, committed: 1952.47 }),
    ];
    const summed = supplierBreakdown(rows, 'quoted').reduce((t, r) => t + r.amount, 0);
    expect(summed).toBe(projectQuoted(rows));
  });
});

describe('a contract and the claims against it', () => {
  const contract = (over: Partial<ProjectQuote> = {}) =>
    quote({ id: 'c1', kind: 'quote', status: 'accepted', amount: 176755,
      amountIncl: 176755, effectiveAmount: 176755, itemId: null, projectId: 'p1', ...over });

  it('says what is left to claim, never below nothing', () => {
    expect(stillToClaim(contract({ claimedTotal: 131962.5 }))).toBe(44792.5);
    // An over-claim is reported with its sign by `stillToBill` at the project
    // level. Here the question is how much is left, and the answer is none.
    expect(stillToClaim(contract({ claimedTotal: 200000 }))).toBe(0);
  });

  it('is not a question you can ask of a bill, or of a price nobody stated', () => {
    expect(stillToClaim(quote({ kind: 'invoice', claimedTotal: null }))).toBeNull();
    expect(stillToClaim(contract({ effectiveAmount: null }))).toBeNull();
  });

  it('always ships the contract it is claimed against', () => {
    // The denominator rule, one figure further in: a claimed-so-far number on
    // its own is the same misleading half-answer as a total with no item count.
    const line = describeClaimed(contract({ claimedTotal: 131962.5 }));
    expect(line).toContain('$131,962.50');
    expect(line).toContain('$176,755');
    expect(line).toContain('$44,792.50 still to claim');
  });

  it('says so plainly when nothing has been claimed yet', () => {
    expect(describeClaimed(contract({ claimedTotal: null })))
      .toBe('nothing claimed yet of $176,755');
  });
});

describe('who to offer when money is being recorded', () => {
  const from = (over: Partial<ProjectQuote>) => quote({ itemId: null, projectId: 'p1', ...over });

  it('names a signed contract, which is what lets the next step offer a claim', () => {
    const [one] = supplierSuggestions(
      [from({ id: 'c1', supplier: 'ReliaBuilder', kind: 'quote', status: 'accepted' })], []
    );
    expect(one.name).toBe('ReliaBuilder');
    expect(one.note).toBe('signed contract');
    expect(one.contract?.id).toBe('c1');
  });

  it('offers no shortcut when there are two contracts to choose between', () => {
    // With two, a claim has to say which — so the shortcut would be guessing.
    const [one] = supplierSuggestions([
      from({ id: 'c1', supplier: 'ReliaBuilder', kind: 'quote', status: 'accepted' }),
      from({ id: 'c2', supplier: 'ReliaBuilder', kind: 'quote', status: 'accepted' }),
    ], []);
    expect(one.contract).toBeNull();
  });

  it('carries names from other jobs, which is how one household stops holding two spellings', () => {
    const rows = supplierSuggestions(
      [from({ supplier: 'ReliaBuilder', kind: 'quote', status: 'accepted' })],
      ['Tile Space', 'reliabuilder']
    );
    expect(rows.map((r) => r.name)).toEqual(['ReliaBuilder', 'Tile Space']);
    expect(rows[1].elsewhere).toBe(true);
  });

  it('matches on a substring, so "relia" finds them', () => {
    const rows = supplierSuggestions([from({ supplier: 'ReliaBuilder' })], []);
    expect(matchSuppliers(rows, 'relia')).toHaveLength(1);
    expect(matchSuppliers(rows, 'build')).toHaveLength(1);
    expect(matchSuppliers(rows, 'mico')).toHaveLength(0);
  });
});
