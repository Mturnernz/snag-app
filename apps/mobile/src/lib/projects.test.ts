import {
  describeTotals, formatMoney, groupProjectsByStatus, hasOpenRange, inclGst, itemPriceLabel,
  projectDossierTable, projectExportPhotos, projectExportTable, rangeLabel, showsElements,
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
  chosenTotal: null, rangeLow: null, rangeHigh: null, spentTotal: null,
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
  snagCount: 0, openSnagCount: 0, thingCount: 0,
  ...totals(), ...over,
});

const element = (over: Partial<ProjectElement> = {}): ProjectElement => ({
  id: 'e1', projectId: 'p1', name: 'Downstairs laundry', room: null,
  implicit: true, sortOrder: 0, notes: null, photoPaths: [], documentPaths: [],
  createdAt: '2026-08-04T00:00:00Z',
  ...totals(), ...over,
});

const item = (over: Partial<ProjectItem> = {}): ProjectItem => ({
  id: 'i1', elementId: 'e1', name: 'Toilet suite', status: 'considering',
  sortOrder: 0, notes: null, photoPaths: [], documentPaths: [],
  createdAt: '2026-08-04T00:00:00Z',
  quoteCount: 0, chosenAmount: null, quotedLow: null, quotedHigh: null, spent: null,
  ...over,
});

const quote = (over: Partial<ProjectQuote> = {}): ProjectQuote => ({
  id: 'q1', itemId: 'i1', supplier: 'Mico', detail: null,
  amount: 1000, amountInclGst: true, kind: 'quote', chosen: false,
  dated: null, notes: null, photoPaths: [], documentPaths: [],
  createdAt: '2026-08-04T00:00:00Z',
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
    expect(line).toContain('1 quoted, not chosen');
    // 9 - 5 - 1: the three nobody has asked about, said out loud rather than
    // left as arithmetic for the reader.
    expect(line).toContain('3 not priced');
  });

  it('is silent only when there is nothing at all to count', () => {
    expect(describeTotals(totals({ itemCount: 0 }))).toBeNull();
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

  it('shows a range while the decision is still open', () => {
    const label = itemPriceLabel(item({ quotedLow: 790, quotedHigh: 1150, quoteCount: 3 }));
    expect(label.state).toBe('range');
    expect(label.text).toBe('$790–1,150');
  });

  it('collapses to one figure once a quote is chosen', () => {
    const label = itemPriceLabel(
      item({ chosenAmount: 1240, quotedLow: 790, quotedHigh: 1240, quoteCount: 3 })
    );
    expect(label.state).toBe('chosen');
    expect(label.text).toBe('$1,240');
  });
});

describe('the range says what is still open', () => {
  it('is one figure when both ends agree', () => {
    expect(rangeLabel(totals({ rangeLow: 8990, rangeHigh: 8990 }))).toBe('$8,990');
    expect(hasOpenRange(totals({ rangeLow: 8990, rangeHigh: 8990 }))).toBe(false);
  });

  it('is a span while a decision is outstanding, with one dollar sign', () => {
    expect(rangeLabel(totals({ rangeLow: 11400, rangeHigh: 13900 }))).toBe('$11,400–13,900');
    expect(hasOpenRange(totals({ rangeLow: 11400, rangeHigh: 13900 }))).toBe(true);
  });

  it('is nothing at all when nobody has quoted', () => {
    expect(rangeLabel(totals())).toBeNull();
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
      [project({ itemCount: 9, pricedCount: 5, chosenTotal: 8990 })],
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
      project({ itemCount: 2, pricedCount: 1, chosenTotal: 1240 }),
      [element()],
      [item({ id: 'i1', chosenAmount: 1240 }), item({ id: 'i2', name: 'Waterproofing' })],
      [quote({ chosen: true, amount: 1240 })],
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
      project({ itemCount: 9, pricedCount: 5, chosenTotal: 8990, spentTotal: 3990 }),
      [element()], [item()], [],
      { household: 'Home', stamp: '2026-09-16' }
    );
    const last = table.rows[table.rows.length - 1];
    expect(last).toContain('TOTAL');
    expect(last.join('|')).toContain('5 of 9 priced');
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
