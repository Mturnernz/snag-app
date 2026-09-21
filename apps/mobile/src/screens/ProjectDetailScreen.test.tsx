import React from 'react';
import { StyleSheet } from 'react-native';
import TestRenderer from 'react-test-renderer';
import { Colors } from '../constants/theme';
import { render } from '../test/render';
import ProjectDetailScreen from './ProjectDetailScreen';

/**
 * One project's page.
 *
 * The three rules that would erode first, in the order they would go: the
 * middle layer showing itself before anybody made it; a total appearing without
 * its denominator; and files rolling *down* as well as up, which would put the
 * council consent inside the bathroom.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => (global as any).__nav,
  useRoute: () => ({ params: { projectId: 'p1' } }),
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));
jest.mock('../components/AddThingSheet', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'add thing sheet') };
});
jest.mock('../components/ItemSheet', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'item sheet') };
});
jest.mock('../components/ProjectRoomsSheet', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) =>
      props.visible ? React.createElement(Text, null, 'rooms sheet open') : null,
  };
});
jest.mock('../components/Attachments', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'attachments') };
});

const mock_getProject = jest.fn();
const mock_getProjectContents = jest.fn();
const mock_getProjectFiles = jest.fn();
const mock_getSnags = jest.fn();
const mock_setQuoteStatus = jest.fn();
const mock_getSupplierTotals = jest.fn();
const mock_getProjectThings = jest.fn();
const mock_updateItem = jest.fn();
const mock_createElement = jest.fn();
const mock_deleteElement = jest.fn().mockResolvedValue([]);
const mock_setItemExcluded = jest.fn().mockResolvedValue(undefined);
jest.mock('../lib/supabase', () => {
  const real = jest.requireActual('@snag/supabase-queries');
  return {
    getProject: (...a: unknown[]) => mock_getProject(...a),
    getProjectContents: (...a: unknown[]) => mock_getProjectContents(...a),
    getProjectFiles: (...a: unknown[]) => mock_getProjectFiles(...a),
    getSnags: (...a: unknown[]) => mock_getSnags(...a),
    setQuoteStatus: (...a: unknown[]) => mock_setQuoteStatus(...a),
    updateItem: (...a: unknown[]) => mock_updateItem(...a),
    createElement: (...a: unknown[]) => mock_createElement(...a),
    createItem: jest.fn(), createQuote: jest.fn(), createThing: jest.fn(),
    createLocation: jest.fn(),
    deleteElement: (...a: unknown[]) => mock_deleteElement(...a),
    setItemExcluded: (...a: unknown[]) => mock_setItemExcluded(...a),
    updateExpectedCost: jest.fn(), addExpectedCostLine: jest.fn(),
    updateExpectedCostLine: jest.fn(), deleteExpectedCostLine: jest.fn(),
    deleteItem: jest.fn(), deleteProject: jest.fn(), deleteQuote: jest.fn(),
    deleteStoredFiles: jest.fn(), updateElement: jest.fn(), updateProject: jest.fn(),
    updateQuote: jest.fn(), getFileUrls: jest.fn().mockResolvedValue({}),
    addPayment: jest.fn(), deletePayment: jest.fn(),
    addQuoteLine: jest.fn(), deleteQuoteLine: jest.fn(),
    addMilestone: jest.fn(), deleteMilestone: jest.fn(),
    createExpectedCost: jest.fn(), deleteExpectedCost: jest.fn(),
    getSupplierTotals: (...a: unknown[]) => mock_getSupplierTotals(...a),
    getProjectThings: (...a: unknown[]) => mock_getProjectThings(...a),
    // The pure ones are real: mocking `describeTotals` would mock away the rule.
    describeTotals: real.describeTotals,
    describeBudget: real.describeBudget,
    describePartsBudget: real.describePartsBudget,
    describeForecast: real.describeForecast,
    describeForecastVariance: real.describeForecastVariance,
    describeStillToBill: real.describeStillToBill,
    describeToPay: real.describeToPay,
    describeAllowance: real.describeAllowance,
    describeOverride: real.describeOverride,
    describeOverrides: real.describeOverrides,
    setFigure: jest.fn(), clearFigure: jest.fn(),
    describeBuildUp: real.describeBuildUp,
    describeLineMovement: real.describeLineMovement,
    milestoneAmount: real.milestoneAmount,
    inclGst: real.inclGst,
    outstanding: real.outstanding,
    formatMoney: real.formatMoney,
    showsElements: real.showsElements,
  };
});
jest.mock('../lib/exportFile', () => ({
  writeExport: jest.fn().mockResolvedValue({ fileName: 'x.csv', path: null }),
  loadExportImages: async () => [],
}));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => (global as any).__household }));

const totals = (over: any = {}) => ({
  itemCount: 0, pricedCount: 0, quotedCount: 0,
  committedTotal: null, invoicedTotal: null, paidTotal: null, allowanceOpen: 0,
  additionalOpen: 0, ...over,
});
const project = (over: any = {}): any => ({
  id: 'p1', householdId: 'h', propertyId: 'prop', name: 'Downstairs laundry',
  summary: null, status: 'underway', startedOn: null, targetOn: null, finishedOn: null,
  budget: null, budgetInclGst: true, photoPaths: [], documentPaths: [],
  createdBy: 'me', createdAt: '2026-08-04T00:00:00Z', updatedAt: '2026-08-04T00:00:00Z',
  propertyName: 'Home', createdByName: 'Kate',
  elementCount: 1, shownElementCount: 0, fileCount: 0,
  snagCount: 0, openSnagCount: 0, thingCount: 0,
  partsBudgetTotal: null, partsBudgetedCount: 0,
  forecastTotal: null, forecastGuess: 0, expectedOpen: 0, expectedCount: 0, budgetGap: 0,
  stillToBill: null, dueToPay: 0, overdueTotal: 0, nextDueOn: null, dueCount: 0,
  forecastDerived: null, committedDerived: null, invoicedDerived: null, paidDerived: null,
  forecastOverride: null, committedOverride: null, invoicedOverride: null, paidOverride: null,
  forecastNote: null, committedNote: null, invoicedNote: null, paidNote: null,
  partsEditedCount: 0,
  ...totals(), ...over,
});
const element = (over: any = {}): any => ({
  id: 'e1', projectId: 'p1', name: 'Downstairs laundry', room: null, implicit: true,
  sortOrder: 0, notes: null, budget: null, budgetInclGst: true,
  expectedOpen: 0, expectedCount: 0, budgetGap: 0,
  committedDerived: null, invoicedDerived: null, paidDerived: null,
  committedOverride: null, invoicedOverride: null, paidOverride: null,
  committedNote: null, invoicedNote: null, paidNote: null,
  photoPaths: [], documentPaths: [],
  createdAt: '2026-08-04T00:00:00Z', ...totals(), ...over,
});
const item = (over: any = {}): any => ({
  id: 'i1', elementId: 'e1', name: 'Toilet suite', status: 'considering', excluded: false,
  sortOrder: 0,
  notes: null, photoPaths: [], documentPaths: [], createdAt: '2026-08-04T00:00:00Z',
  quoteCount: 0, tbcCount: 0, committed: null, invoiced: null, paid: null,
  allowanceOpen: 0, additionalOpen: 0, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).__nav = { navigate: jest.fn(), goBack: jest.fn(), addListener: () => () => {} };
  (global as any).__household = {
    household: { id: 'h', name: 'Home', createdAt: '2026-01-01T00:00:00Z' },
    profile: { id: 'me', displayName: 'Me' },
    members: [], properties: [{ id: 'prop', householdId: 'h', name: 'Home' }],
    activeProperty: { id: 'prop', householdId: 'h', name: 'Home' },
    setActiveProperty: jest.fn(),
    locations: [{ id: 'l1', propertyId: 'prop', name: 'Bathroom', sortOrder: 1 }],
    reloadLocations: jest.fn(), refresh: jest.fn(), reloadAccount: jest.fn(),
  };
});

async function arrange(opts: {
  project?: any; elements?: any[]; items?: any[]; quotes?: any[]; lines?: any[];
  payments?: any[]; files?: any[]; snags?: any[]; suppliers?: any[]; things?: any[];
  milestones?: any[]; expected?: any[]; expectedCostLines?: any[]; bills?: any[];
} = {}) {
  mock_getProject.mockResolvedValue(opts.project ?? project());
  mock_getProjectContents.mockResolvedValue({
    elements: opts.elements ?? [element()],
    items: opts.items ?? [],
    quotes: opts.quotes ?? [],
    lines: opts.lines ?? [],
    payments: opts.payments ?? [],
    milestones: opts.milestones ?? [],
    expected: opts.expected ?? [],
    expectedCostLines: opts.expectedCostLines ?? [],
    bills: opts.bills ?? [],
  });
  mock_getProjectFiles.mockResolvedValue(opts.files ?? []);
  mock_getSnags.mockResolvedValue(opts.snags ?? []);
  mock_getSupplierTotals.mockResolvedValue(opts.suppliers ?? []);
  mock_getProjectThings.mockResolvedValue(opts.things ?? []);
  const r = render(<ProjectDetailScreen route={{ params: { projectId: 'p1' } } as any} navigation={{} as any} />);
  await TestRenderer.act(async () => {});
  return r;
}

/** Any pressable carrying this label — used by the specs that reach for one. */
const byLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label,
    { deep: true }
  )[0];

describe('the middle layer', () => {
  it('is not drawn while the only part of the job is implicit', async () => {
    const r = await arrange({ elements: [element({ implicit: true })], items: [item()] });
    // The heading is what it takes, not what its parts are — and the element's
    // own name never appears, because nobody chose it.
    r.getByText('What it takes');
    expect(r.queryByText('Parts of the job')).toBeNull();
    r.getByText('Toilet suite');
  });

  it('is drawn the moment somebody has made a real one', async () => {
    const r = await arrange({
      elements: [
        element({ id: 'e1', name: 'Bathroom renovation', implicit: false, room: 'Bathroom' }),
        element({ id: 'e2', name: 'Laundry renovation', implicit: false, room: 'Laundry' }),
      ],
    });
    r.getByText('Parts of the job');
    r.getByText('Bathroom renovation');
    r.getByText('Laundry renovation');
  });
});

describe('the money', () => {
  it('keeps what has been charged apart from what has been paid', async () => {
    // The old strip had one "Spent" that summed invoices and receipts together,
    // so a bill and the payment settling it both counted. Seven invoices with
    // nothing yet recorded as paid is the ordinary middle of a job.
    const r = await arrange({
      project: project({
        committedTotal: 8990, invoicedTotal: 4200, paidTotal: 3990,
        itemCount: 9, pricedCount: 5,
      }),
    });
    r.getByText('Committed');
    r.getByText('Invoiced');
    r.getByText('Paid');
    expect(r.queryByText('Spent')).toBeNull();
    r.getByText('$8,990');
    r.getByText('$4,200');
    r.getByText('$3,990');
  });

  it('splits the one Outstanding figure into the two gaps it was conflating', async () => {
    // "Outstanding quote vs actual costs" and "what is outstanding to pay" are
    // different subtractions, and a single figure called Outstanding answered
    // neither. Still to be billed is committed less invoiced — how much of what
    // was agreed is still coming. To pay is invoiced less paid, and it is the
    // only figure on this page that is about today.
    const r = await arrange({
      project: project({
        committedTotal: 8990, invoicedTotal: 4200, paidTotal: 3990,
        stillToBill: 4790, dueToPay: 210, dueCount: 1,
        itemCount: 9, pricedCount: 5,
      }),
    });
    r.getByText('$4,790 still to be billed');
    r.getByText('$210 to pay · 1 bill');
    expect(r.queryByText('Outstanding')).toBeNull();
  });

  it('reports an over-claim rather than flooring it away', async () => {
    // Negative still-to-bill means somebody has billed more than was ever
    // committed, which is the single most useful thing this subtraction can
    // say. Tidying it to zero would throw exactly that away.
    const r = await arrange({
      project: project({
        committedTotal: 4000, invoicedTotal: 5200, stillToBill: -1200,
        itemCount: 2, pricedCount: 2,
      }),
    });
    r.getByText('$1,200 billed beyond what was committed');
  });

  it('carries the denominator under the forecast, always', async () => {
    const r = await arrange({
      project: project({
        committedTotal: 8990, forecastTotal: 8990,
        itemCount: 9, pricedCount: 5, quotedCount: 1,
      }),
    });
    r.getByText('5 of 9 items priced');
  });

  it('never renders a forecast without saying how much of it is a guess', async () => {
    const r = await arrange({
      project: project({
        committedTotal: 103574.22, forecastTotal: 119774.22, forecastGuess: 16200,
        itemCount: 18, pricedCount: 13,
      }),
    });
    r.getByText('$119,774.22');
    r.getByText('13 of 18 items priced · $16,200 of it still a guess');
  });

  it('warns past 5% over, in words and with its cause', async () => {
    // A percentage with no cause is a number people learn to ignore, so the
    // line names what is driving it. `projects.test.ts` pins the silence below
    // the threshold and when under, which are properties rather than pixels.
    const r = await arrange({
      project: project({
        budget: 187000, budgetInclGst: true,
        committedTotal: 192354.22, forecastTotal: 210000, forecastGuess: 17645.78,
        itemCount: 18, pricedCount: 13,
      }),
    });
    r.getByText('$23,000 over budget — 5 items aren’t priced and $17,645.78 is still a guess');
  });

  it('puts the budget under the figures and says which side of it we are', async () => {
    const r = await arrange({
      project: project({
        budget: 180000, budgetInclGst: true, committedTotal: 192354.22,
        itemCount: 18, pricedCount: 13,
      }),
    });
    r.getByText('Budget');
    r.getByText('$180,000');
    r.getByText('committed is $12,354.22 over it');
  });

  it('says so in words when nothing has been priced, rather than showing zero', async () => {
    const r = await arrange({ project: project({ itemCount: 0 }) });
    r.getByText('Nothing priced yet');
    expect(r.queryByText('$0')).toBeNull();
  });

  it('states the GST basis, because the figures are normalised and the rows are not', async () => {
    const r = await arrange();
    r.getByText('Every figure here is GST-inclusive.');
  });

  it('keeps a six-figure total on one line rather than wrapping mid-number', async () => {
    // A third of 390pt cannot hold "$192,354.22". Figures across is what made
    // the strip go ragged the moment a job got past five figures, so they stack
    // and each is pinned to a single line — half a number read off a wrapped
    // row is worse than no number at all.
    const r = await arrange({
      project: project({
        committedTotal: 192354.22, invoicedTotal: 97753.22, paidTotal: 1952.47,
        itemCount: 18, pricedCount: 13,
      }),
    });
    expect(r.getByText('$192,354.22').props.numberOfLines).toBe(1);
    expect(r.getByText('$97,753.22').props.numberOfLines).toBe(1);
    expect(r.getByText('$1,952.47').props.numberOfLines).toBe(1);
  });

  it('keeps “still a guess” and “not priced” as different sentences', async () => {
    // An allowance is somebody's written number inside a contract and it counts;
    // an unpriced item contributes nothing. Collapsing the wording collapses the
    // distinction, which is worth 15% of a renovation when it goes.
    const r = await arrange({
      project: project({
        committedTotal: 167240, forecastTotal: 167240, forecastGuess: 22300,
        allowanceOpen: 22300, itemCount: 9, pricedCount: 9,
      }),
    });
    r.getByText('9 of 9 items priced · $22,300 of it still a guess');
  });
});

describe('a figure you can type over', () => {
  it('shows the typed figure, and names what the prices say instead', async () => {
    const r = await arrange({
      project: project({
        committedDerived: 103574.22, committedOverride: 200000,
        committedTotal: 200000, invoicedTotal: 97753.22,
        committedNote: 'variation confirmed by email',
        itemCount: 18, pricedCount: 13,
      }),
    });
    r.getByText('$200,000');
    r.getByText(
      'Committed is edited: $200,000 typed · the prices say $103,574.22 — $96,425.78 more — variation confirmed by email'
    );
  });

  it('renders an edited figure in clay', async () => {
    // The third thing in this app to earn red, after overdue and
    // priority-high, and on the same terms: a fact about a number rather than a
    // judgement — this figure is not what the paperwork says.
    const r = await arrange({
      project: project({
        committedDerived: 103574.22, committedOverride: 200000, committedTotal: 200000,
        itemCount: 18, pricedCount: 13,
      }),
    });
    const flat = StyleSheet.flatten(r.getByText('$200,000').props.style);
    expect(flat.color).toBe(Colors.danger);
  });

  it('leaves an untouched figure alone', async () => {
    const r = await arrange({
      project: project({ committedDerived: 8990, committedTotal: 8990, itemCount: 9, pricedCount: 9 }),
    });
    const flat = StyleSheet.flatten(r.getByText('$8,990').props.style);
    expect(flat.color).not.toBe(Colors.danger);
  });

  it('says nothing at all when nothing has been edited', async () => {
    const r = await arrange({
      project: project({ committedDerived: 8990, committedTotal: 8990, itemCount: 9, pricedCount: 9 }),
    });
    expect(r.queryByText('A figure has been edited')).toBeNull();
    expect(r.queryByText('Figures have been edited')).toBeNull();
  });
});

describe('who is owed what', () => {
  it('is absent entirely when nobody is owed anything', async () => {
    const r = await arrange();
    expect(r.queryByText('Who’s owed what')).toBeNull();
    expect(r.queryByText('Who we’re paying')).toBeNull();
  });

  it('names each supplier, and what is still to go to them', async () => {
    const r = await arrange({
      suppliers: [
        { projectId: 'p1', supplierKey: 'reliabuilder', supplier: 'ReliaBuilder',
          committed: 177594.5, invoiced: 88814.5, paid: 84000, unpaid: 4814.5,
          nextDueOn: null, tbcCount: 0 },
      ],
    });
    r.getByText('Who we’re paying');
    r.getByText('ReliaBuilder');
    r.getByText('$93,594.50');
  });

  it('says settled rather than showing a zero', async () => {
    const r = await arrange({
      suppliers: [
        { projectId: 'p1', supplierKey: 'tile space', supplier: 'Tile Space',
          committed: 1952.47, invoiced: 1952.47, paid: 1952.47, tbcCount: 0 },
      ],
    });
    r.getByText('Settled');
    expect(r.queryByText('$0')).toBeNull();
  });

  it('still renders the page when the rollup will not load', async () => {
    // The money strip above it is the answer to this page's main question. A
    // rollup that fails must not take the page down with it.
    mock_getSupplierTotals.mockRejectedValueOnce(new Error('no'));
    const r = await arrange();
    r.getByText('Downstairs laundry');
  });
});

describe('handing it over to the house record', () => {
  const fitted = (over: any = {}) => item({ status: 'installed', ...over });

  it('lists what has been installed, and says how many are recorded', async () => {
    const r = await arrange({
      items: [fitted({ id: 'i1', name: 'Toilet suite' }), fitted({ id: 'i2', name: 'Vanity' })],
      things: [{ id: 't1', projectItemId: 'i1' }],
    });
    r.getByText('Hand it over');
    r.getByText('1 of 2 installed are in the house record.');
  });

  it('stops offering an item once it is in the record', async () => {
    // What `project_item_id` exists for. Without it the list offers the
    // dishwasher again every time.
    const r = await arrange({
      items: [fitted({ id: 'i1', name: 'Toilet suite' })],
      things: [{ id: 't1', projectItemId: 'i1' }],
    });
    expect(byLabel(r, 'Record Toilet suite in the house record')).toBeUndefined();
    expect(byLabel(r, 'Toilet suite is in the house record')).toBeDefined();
  });

  it('offers only what is installed, never the whole job twice', async () => {
    // The items are already listed above under what it takes. An item nobody
    // has fitted has nothing to record: the model number is on the box.
    const r = await arrange({
      items: [fitted({ id: 'i1', name: 'Toilet suite' }), item({ id: 'i2', name: 'Vanity' })],
    });
    expect(byLabel(r, 'Record Toilet suite in the house record')).toBeDefined();
    expect(byLabel(r, 'Record Vanity in the house record')).toBeUndefined();
  });

  it('is absent while nothing has been installed', async () => {
    const r = await arrange({ items: [item()] });
    expect(r.queryByText('Hand it over')).toBeNull();
  });
});

describe('files roll up, never down', () => {
  it('lists what is attached lower down, saying which level owns it', async () => {
    const r = await arrange({
      project: project({ fileCount: 1 }),
      files: [{
        projectId: 'p1', level: 'quote', ownerId: 'q1', ownerName: 'Mico',
        kind: 'document', path: 'h/docs/1700000000-1-Mico-quote.pdf',
      }],
    });
    r.getByText('Everything filed under this job');
    r.getByText('Mico-quote.pdf');
    r.getByText('A quote · Mico');
  });

  it('does not push the project’s own paperwork down into the parts of the job', async () => {
    const r = await arrange({
      project: project({ documentPaths: ['h/docs/1700000000-1-consent.pdf'], fileCount: 1 }),
      files: [{
        projectId: 'p1', level: 'project', ownerId: 'p1', ownerName: 'Downstairs laundry',
        kind: 'document', path: 'h/docs/1700000000-1-consent.pdf',
      }],
    });
    // The project's own file is in the project's own section (mocked away as
    // "attachments") and must not appear in the roll-up list underneath, which
    // is for what is attached *below* it.
    expect(r.queryByText('Everything filed under this job')).toBeNull();
  });
});

describe('the punch list', () => {
  it('is ordinary snags, and says filing one here does not start it', async () => {
    const r = await arrange({
      snags: [{
        id: 's1', reference: 'SNG-0142', description: 'Cistern drips after flush',
        status: 'open', room: 'Bathroom', photoPaths: [], parts: [], bought: [],
        needsParts: false, priority: null, dueAt: null, repeatDays: null, assigneeId: null,
        thingId: null, projectId: 'p1', householdId: 'h', propertyId: 'prop',
        reporterId: 'me', createdAt: '', updatedAt: '', lastDoneAt: null, doneAt: null,
        propertyName: 'Home', reporterName: 'Kate', assigneeName: null, commentCount: 0,
        thingName: null, thingMake: null, thingModel: null, projectName: 'Downstairs laundry',
      }],
    });
    r.getByText('To sort out');
    r.getByText('Cistern drips after flush');
    r.getByText('These are ordinary jobs on the list — filing one here doesn’t start it.');
  });

  it('reads the list filtered by this project rather than keeping its own', async () => {
    await arrange();
    expect(mock_getSnags).toHaveBeenCalledWith({ projectId: 'p1' });
  });

  it('still renders the page when that read fails', async () => {
    mock_getSnags.mockRejectedValue(new Error('offline'));
    const r = await arrange();
    // A punch list nobody can fetch must not take the page down — the same rule
    // the thing-history card follows on the snag page.
    r.getByText('Committed');
  });
});

/**
 * Adding and removing the rooms a job touches.
 *
 * Step two of the start sheet asks once and never again, which froze the answer
 * at the moment somebody knew least — a renovation grows a room more often than
 * it loses one.
 */
describe('the rooms a job touches', () => {
  const byLabel = (r: ReturnType<typeof render>, label: string) =>
    r.root.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
        && !!n.props?.onPress,
      { deep: true }
    )[0];

  it('opens a room picker rather than a naming box', async () => {
    const r = await arrange({
      elements: [element({ implicit: false, name: 'Bathroom', room: 'Bathroom' })],
    });
    await TestRenderer.act(async () => byLabel(r, 'Add a room to this job').props.onPress());
    // A picker is the only control that cannot misspell the vocabulary the rest
    // of the app files things under.
    r.getByText('rooms sheet open');
  });

  it('offers a way to take a room off the job', async () => {
    const r = await arrange({
      elements: [
        element({ id: 'e1', implicit: false, name: 'Bathroom', room: 'Bathroom' }),
        element({ id: 'e2', implicit: false, name: 'Laundry', room: 'Laundry' }),
      ],
    });
    expect(byLabel(r, 'Remove Bathroom from this job')).toBeDefined();
  });

  it('says what goes with it before it goes', async () => {
    const r = await arrange({
      elements: [
        element({ id: 'e1', implicit: false, name: 'Bathroom', room: 'Bathroom', itemCount: 3 }),
        element({ id: 'e2', implicit: false, name: 'Laundry', room: 'Laundry' }),
      ],
    });
    await TestRenderer.act(async () => byLabel(r, 'Remove Bathroom from this job').props.onPress());
    // Named in counts rather than warned about in general, and it says the room
    // itself survives — removing a part of a job is not removing a room.
    const dialog = r.root.findAll(
      (n: any) => typeof n.props?.message === 'string' && n.props?.visible === true
    )[0];
    expect(dialog.props.message).toContain('3 items');
    expect(dialog.props.message).toContain('The room itself stays.');
    expect(mock_deleteElement).not.toHaveBeenCalled();
  });

  it('makes a part that holds something ask for the word to be typed', async () => {
    // The one case on this page where a press destroys work that cannot be got
    // back. Two taps is the right price for a snag and the wrong price for
    // three items, their quotes and their files.
    const r = await arrange({
      elements: [
        element({ id: 'e1', implicit: false, name: 'Bathroom', room: 'Bathroom', itemCount: 3 }),
        element({ id: 'e2', implicit: false, name: 'Laundry', room: 'Laundry' }),
      ],
    });
    await TestRenderer.act(async () => byLabel(r, 'Remove Bathroom from this job').props.onPress());
    const dialog = r.root.findAll(
      (n: any) => typeof n.props?.message === 'string' && n.props?.visible === true
    )[0];
    expect(dialog.props.confirmText).toBe('Delete');
  });

  it('counts the files as something, not just the items', async () => {
    // A part with no items but a council letter on it is not empty, and
    // "Nothing is on it yet" would be the screen lying right before it acted.
    const r = await arrange({
      elements: [
        element({
          id: 'e1', implicit: false, name: 'Consent', room: null,
          documentPaths: ['h/docs/consent.pdf'],
        }),
        element({ id: 'e2', implicit: false, name: 'Laundry', room: 'Laundry' }),
      ],
    });
    await TestRenderer.act(async () => byLabel(r, 'Remove Consent from this job').props.onPress());
    const dialog = r.root.findAll(
      (n: any) => typeof n.props?.message === 'string' && n.props?.visible === true
    )[0];
    expect(dialog.props.confirmText).toBe('Delete');
    expect(dialog.props.message).toContain('1 file');
  });

  it('leaves an empty part as an ordinary two-button confirm', async () => {
    // The gate is worth its friction only where the damage is real. Asking for
    // a typed word to remove a heading teaches people to type it unread.
    const r = await arrange({
      elements: [
        element({ id: 'e1', implicit: false, name: 'Bathroom', room: 'Bathroom' }),
        element({ id: 'e2', implicit: false, name: 'Laundry', room: 'Laundry' }),
      ],
    });
    await TestRenderer.act(async () => byLabel(r, 'Remove Bathroom from this job').props.onPress());
    const dialog = r.root.findAll(
      (n: any) => typeof n.props?.message === 'string' && n.props?.visible === true
    )[0];
    expect(dialog.props.confirmText).toBeUndefined();
    expect(dialog.props.message).toContain('Nothing is on it yet');
  });

  it('shows no × while the layer is still implicit', async () => {
    // One implicit element is a project with no parts drawn at all, so there is
    // nothing to remove and a × would be a control for a concept not on screen.
    const r = await arrange({ elements: [element({ implicit: true })] });
    expect(byLabel(r, 'Remove Downstairs laundry from this job')).toBeUndefined();
  });
});

/**
 * What a press costs.
 *
 * The page used to answer a chip by writing, then re-reading the whole of
 * itself in nine sequential round trips, with nothing on screen changing
 * until all of them landed. On a phone that reads as a control that did not
 * register, and it gets pressed again.
 */
describe('a toggle answers before the network does', () => {
  it('flips the moment it is pressed, without waiting for the write', async () => {
    let release!: () => void;
    mock_setItemExcluded.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = () => resolve(); })
    );
    const r = await arrange({ elements: [element()], items: [item({ name: 'Toilet suite' })] });

    expect(byLabel(r, 'Exclude Toilet suite from the price build')).toBeDefined();
    await TestRenderer.act(async () => {
      byLabel(r, 'Exclude Toilet suite from the price build').props.onPress();
    });

    // The write has not resolved and the row already says what it will be.
    expect(byLabel(r, 'Include Toilet suite in the price build')).toBeDefined();
    await TestRenderer.act(async () => { release(); });
  });

  it('puts it back when the write is refused, rather than lying about it', async () => {
    mock_setItemExcluded.mockRejectedValueOnce(new Error('nope'));
    const r = await arrange({ elements: [element()], items: [item({ name: 'Toilet suite' })] });

    await TestRenderer.act(async () => {
      await byLabel(r, 'Exclude Toilet suite from the price build').props.onPress();
    });

    // Optimistic is not the same as dishonest: a refused write reverts.
    expect(byLabel(r, 'Exclude Toilet suite from the price build')).toBeDefined();
  });
});

describe('a price decision re-reads the money, and not the rest of the page', () => {
  it('leaves the punch list, the handover offer and the files alone', async () => {
    mock_setItemExcluded.mockResolvedValueOnce(undefined);
    const r = await arrange({ elements: [element()], items: [item({ name: 'Toilet suite' })] });

    const snags = mock_getSnags.mock.calls.length;
    const things = mock_getProjectThings.mock.calls.length;
    const files = mock_getProjectFiles.mock.calls.length;
    const contents = mock_getProjectContents.mock.calls.length;

    await TestRenderer.act(async () => {
      await byLabel(r, 'Exclude Toilet suite from the price build').props.onPress();
    });

    // None of these can move because somebody excluded an item, so none of
    // them is asked for again.
    expect(mock_getSnags.mock.calls.length).toBe(snags);
    expect(mock_getProjectThings.mock.calls.length).toBe(things);
    expect(mock_getProjectFiles.mock.calls.length).toBe(files);
    // The money is derived in a view, so it genuinely has to be re-read.
    expect(mock_getProjectContents.mock.calls.length).toBeGreaterThan(contents);
  });
});
