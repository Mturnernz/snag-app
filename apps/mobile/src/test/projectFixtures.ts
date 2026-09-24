/**
 * Row builders for project tests. Each returns a complete row with the fields
 * a test does not care about set to their resting values, so a spec only names
 * what it is about.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const totals = (over: any = {}) => ({
  itemCount: 0, pricedCount: 0, quotedCount: 0,
  committedTotal: null, invoicedTotal: null, paidTotal: null, allowanceOpen: 0,
  additionalOpen: 0, ...over,
});

export const project = (over: any = {}): any => ({
  id: 'p1', householdId: 'h', propertyId: 'prop', name: 'Downstairs conversion',
  summary: null, status: 'underway', startedOn: '2026-04-06', targetOn: null, finishedOn: null,
  budget: null, budgetInclGst: true, photoPaths: [], documentPaths: [],
  createdBy: 'me', createdAt: '2026-04-06T00:00:00Z', updatedAt: '2026-04-06T00:00:00Z',
  propertyName: 'Home', createdByName: 'Kate',
  elementCount: 1, shownElementCount: 0, fileCount: 0,
  snagCount: 0, openSnagCount: 0, thingCount: 0, installedCount: 0,
  partsBudgetTotal: null, partsBudgetedCount: 0,
  forecastTotal: null, forecastGuess: 0, expectedOpen: 0, expectedCount: 0,
  expectedConfirmed: null, budgetGap: 0,
  stillToBill: null, dueToPay: 0, overdueTotal: 0, nextDueOn: null, dueCount: 0,
  forecastDerived: null, committedDerived: null, invoicedDerived: null, paidDerived: null,
  forecastOverride: null, committedOverride: null, invoicedOverride: null, paidOverride: null,
  forecastNote: null, committedNote: null, invoicedNote: null, paidNote: null,
  partsEditedCount: 0,
  ...totals(), ...over,
});

export const element = (over: any = {}): any => ({
  id: 'e1', projectId: 'p1', name: 'Bathroom', room: 'Bathroom', implicit: false,
  sortOrder: 0, notes: null, budget: null, budgetInclGst: true,
  expectedOpen: 0, expectedCount: 0, expectedConfirmed: null, budgetGap: 0,
  committedDerived: null, invoicedDerived: null, paidDerived: null,
  committedOverride: null, invoicedOverride: null, paidOverride: null,
  committedNote: null, invoicedNote: null, paidNote: null,
  photoPaths: [], documentPaths: [],
  createdAt: '2026-04-06T00:00:00Z', ...totals(), ...over,
});

export const item = (over: any = {}): any => ({
  id: 'i1', elementId: 'e1', name: 'Toilet', status: 'considering', excluded: false,
  sortOrder: 0, notes: null, photoPaths: [], documentPaths: [], createdAt: '2026-04-06T00:00:00Z',
  quoteCount: 0, tbcCount: 0, committed: null, invoiced: null, paid: null,
  allowanceOpen: 0, additionalOpen: 0, setAsideLineId: null, ...over,
});

export const quote = (over: any = {}): any => ({
  id: 'q1', itemId: null, elementId: null, projectId: null, supplier: 'Reece', detail: null,
  amount: null, amountInclGst: true, kind: 'quote', status: 'tbc', basis: 'fixed',
  dated: null, notes: null, supersedesLineId: null, dueOn: null, billedThroughId: null,
  settlesMilestoneId: null, againstQuoteId: null, photoPaths: [], documentPaths: [],
  createdAt: '2026-04-06T00:00:00Z',
  amountIncl: over.amount ?? null, lineCount: 0, linesTotal: null, buildUp: null,
  allowanceOpen: 0, additionalOpen: 0, effectiveAmount: over.amount ?? null,
  paidTotal: null, unpaid: null, claimedTotal: null, ...over,
});

export const line = (over: any = {}): any => ({
  id: 'l1', quoteId: 'c1', name: 'Bathroom hardware', detail: null, amount: 12000,
  amountInclGst: true, isAllowance: true, allowanceKind: 'pc_sum', additional: false,
  attendancePct: null, sortOrder: 0, ...over,
});

export const bill = (over: any = {}): any => ({
  id: 'b1', projectId: 'p1', supplier: 'ReliaBuilder', detail: 'Progress bill 1',
  dated: '2026-09-22', dueOn: '2026-10-05', billedThroughId: null, settlesMilestoneId: null,
  amountIncl: 46000, paidTotal: null, unpaid: 46000, overdue: false, ...over,
});

export const page = (over: any = {}): any => ({
  project: project(), elements: [element()], items: [], quotes: [], lines: [],
  payments: [], milestones: [], expected: [], expectedCostLines: [], bills: [],
  suppliers: [], files: [], things: [], snags: [], invoiceReviews: [], quoteRooms: [], ...over,
});

/**
 * The downstairs conversion from the V2 design, as the views return it.
 *
 * ReliaBuilder's $185,000 contract sets aside $8,000 for laundry fittings and
 * $12,000 for bathroom hardware. The laundry has been chosen (Kitchen Mania,
 * $9,400, bought direct), so that allowance has left the contract; the bathroom
 * hardware is still open, with a toilet, a vanity and a shower mixer to decide.
 */
export function downstairs(over: any = {}): any {
  const { project: projectOver, ...rest } = over;
  return page({
    project: project({
      budget: 230000,
      // 177,000 contract after the laundry left it + 14,000 architect
      // + 4,820 council + 2,300 engineer + 800 site investigation
      // + 9,400 laundry.
      committedTotal: 208320,
      allowanceOpen: 12000,
      paidTotal: 16020,
      dueToPay: 46000,
      ...projectOver,
    }),
    elements: [
      element({ id: 'eL', name: 'Laundry', room: 'Laundry', sortOrder: 0, committedTotal: 9400 }),
      element({ id: 'eB', name: 'Bathroom', room: 'Bathroom', sortOrder: 1 }),
    ],
    items: [
      item({ id: 'iL', elementId: 'eL', name: 'Laundry fixtures and fittings', committed: 9400, setAsideLineId: 'lL' }),
      item({ id: 'iT', elementId: 'eB', name: 'Toilet', setAsideLineId: 'lB', quoteCount: 3, tbcCount: 3 }),
      item({ id: 'iV', elementId: 'eB', name: 'Vanity', setAsideLineId: 'lB', quoteCount: 2, tbcCount: 2 }),
      item({ id: 'iM', elementId: 'eB', name: 'Shower mixer', setAsideLineId: 'lB' }),
    ],
    quotes: [
      quote({ id: 'c1', projectId: 'p1', supplier: 'ReliaBuilder', detail: 'Building contract', amount: 185000, status: 'accepted', effectiveAmount: 177000 }),
      quote({ id: 'a1', projectId: 'p1', supplier: 'Studio North', amount: 14000, status: 'accepted' }),
      quote({ id: 'n1', projectId: 'p1', supplier: 'Auckland Council', amount: 4820, kind: 'invoice', status: 'accepted' }),
      quote({ id: 'h1', projectId: 'p1', supplier: 'Hutton Engineering', amount: 2300, kind: 'invoice', status: 'accepted' }),
      quote({ id: 'g1', projectId: 'p1', supplier: 'Geotech NZ', amount: 800, kind: 'invoice', status: 'accepted' }),
      quote({ id: 'k1', itemId: 'iL', supplier: 'Kitchen Mania', amount: 9400, status: 'accepted', supersedesLineId: 'lL' }),
      quote({ id: 't1', itemId: 'iT', supplier: 'Plumbing World', detail: 'Caroma Luna', amount: 890 }),
      quote({ id: 't2', itemId: 'iT', supplier: 'Reece', detail: 'Villeroy & Boch Subway', amount: 1450 }),
      quote({ id: 't3', itemId: 'iT', supplier: 'Reece', detail: 'Duravit ME', amount: 2100 }),
      quote({ id: 'v1', itemId: 'iV', supplier: 'Bunnings', amount: 1290 }),
      quote({ id: 'v2', itemId: 'iV', supplier: 'Elite Bathroomware', amount: 2450 }),
    ],
    lines: [
      line({ id: 'lB0', name: 'Building work', amount: 165000, isAllowance: false, allowanceKind: null }),
      line({ id: 'lL', name: 'Laundry fixtures and fittings', amount: 8000, sortOrder: 1 }),
      line({ id: 'lB', name: 'Bathroom hardware', amount: 12000, sortOrder: 2 }),
    ],
    bills: [bill()],
    ...rest,
  });
}
