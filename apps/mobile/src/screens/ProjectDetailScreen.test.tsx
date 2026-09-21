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
// Stood in for, but not blanked: adding an item now opens *this* sheet rather
// than a smaller one in front of it, so the screen's side of that — which part
// it is creating on, and that naming it writes — has to be assertable here.
// `ItemSheet.test.tsx` pins everything inside it.
jest.mock('../components/ItemSheet', () => {
  const React = require('react');
  const { Text, Pressable } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Text, null, props.visible ? 'item sheet open' : 'item sheet'),
        props.creatingIn
          ? React.createElement(
            Pressable,
            {
              accessibilityLabel: `naming a new item on ${props.creatingIn.name}`,
              onPress: () => props.onCreate(props.creatingIn.id, 'Shower mixer'),
            },
            React.createElement(Text, null, 'name it')
          )
          : null
      ),
  };
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

// One read, where there were fourteen. `home.project_page` returns the whole
// page in a single round trip, so the screen has one mock to satisfy rather
// than six — which is also what lets the burst test below simply count it.
const mock_getProjectPage = jest.fn();
const mock_setQuoteStatus = jest.fn();
const mock_updateItem = jest.fn();
const mock_createElement = jest.fn();
const mock_deleteElement = jest.fn().mockResolvedValue([]);
const mock_setItemExcluded = jest.fn().mockResolvedValue(undefined);
const mock_createItem = jest.fn().mockResolvedValue({
  id: 'new1', elementId: 'e1', name: 'Shower mixer', status: 'considering', excluded: false,
  sortOrder: 0, notes: null, photoPaths: [], documentPaths: [], createdAt: '',
  quoteCount: 0, committed: null, invoiced: null, paid: null, tbcCount: 0,
});
jest.mock('../lib/supabase', () => {
  const real = jest.requireActual('@snag/supabase-queries');
  return {
    getProjectPage: (...a: unknown[]) => mock_getProjectPage(...a),
    setQuoteStatus: (...a: unknown[]) => mock_setQuoteStatus(...a),
    updateItem: (...a: unknown[]) => mock_updateItem(...a),
    createElement: (...a: unknown[]) => mock_createElement(...a),
    createItem: (...a: unknown[]) => mock_createItem(...a),
    createQuote: jest.fn(), createThing: jest.fn(),
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
  mock_getProjectPage.mockResolvedValue({
    project: opts.project ?? project(),
    elements: opts.elements ?? [element()],
    items: opts.items ?? [],
    quotes: opts.quotes ?? [],
    lines: opts.lines ?? [],
    payments: opts.payments ?? [],
    milestones: opts.milestones ?? [],
    expected: opts.expected ?? [],
    expectedCostLines: opts.expectedCostLines ?? [],
    bills: opts.bills ?? [],
    suppliers: opts.suppliers ?? [],
    files: opts.files ?? [],
    things: opts.things ?? [],
    snags: opts.snags ?? [],
  });
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

  it('is five figures and nothing under them', async () => {
    // The strip carried a paragraph: the denominator, the guess, the variance
    // warning, the discrepancy block, the budget line, the parts line, the two
    // gaps and the GST basis — eight sentences of prose above a page whose
    // first question is "a bill arrived, where does it go". Every rule they
    // stated is still pinned in `projects.test.ts`, where the helpers live and
    // the extracts still print them; what went is the recital at the top of
    // this page.
    const r = await arrange({
      project: project({
        budget: 180000, budgetInclGst: true,
        committedTotal: 8990, invoicedTotal: 4200, paidTotal: 3990,
        stillToBill: 4790, dueToPay: 210, dueCount: 1,
        forecastTotal: 12000, forecastGuess: 3010,
        itemCount: 9, pricedCount: 5,
      }),
    });
    r.getByText('Budget');
    r.getByText('Forecast');
    expect(r.queryByText('5 of 9 items priced')).toBeNull();
    expect(r.queryByText('$4,790 still to be billed')).toBeNull();
    expect(r.queryByText('$210 to pay · 1 bill')).toBeNull();
    expect(r.queryByText('Every figure here is GST-inclusive.')).toBeNull();
    expect(r.queryByText('committed is $8,990 under it')).toBeNull();
  });

  it('states the budget as a figure of its own, and takes an edit', async () => {
    const r = await arrange({
      project: project({
        budget: 180000, budgetInclGst: true, committedTotal: 192354.22,
        itemCount: 18, pricedCount: 13,
      }),
    });
    r.getByText('Budget');
    r.getByText('$180,000');
  });

  it('leaves a figure nobody has priced blank rather than showing zero', async () => {
    // `sum` over nothing is null, never 0, and an unpriced job is not a free
    // one. The em dash says the app has not been told, which is the truth.
    const r = await arrange({ project: project({ itemCount: 0 }) });
    expect(r.queryByText('$0')).toBeNull();
  });

  it('says nothing about a project’s status, because nothing here sets one', async () => {
    // Planned / Underway / Done were three chips under the figures. The list
    // groups on the same column and is where a project is read as finished;
    // a second writer on the page whose first question is about a bill was
    // three taps of vertical rent on every visit.
    const r = await arrange({ project: project({ status: 'underway' }) });
    expect(r.queryByText('Planned')).toBeNull();
    expect(r.queryByText('Underway')).toBeNull();
    expect(r.queryByText('Done')).toBeNull();
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

});

describe('a figure you can type over', () => {
  it('shows the typed figure, and keeps the derived one one tap away', async () => {
    // The discrepancy paragraph is off the page, but the override is still
    // honest: the row goes clay, and `EditFigureSheet` — which the row opens —
    // carries THE PRICES SAY the whole time somebody is typing. What a reader
    // can get back to is unchanged; what went is the recital.
    const r = await arrange({
      project: project({
        committedDerived: 103574.22, committedOverride: 200000,
        committedTotal: 200000, invoicedTotal: 97753.22,
        committedNote: 'variation confirmed by email',
        itemCount: 18, pricedCount: 13,
      }),
    });
    r.getByText('$200,000');
    expect(r.queryByText('the prices say $103,574.22')).toBeNull();
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

  it('says it could not load rather than drawing half a page', async () => {
    // This replaces a rule that no longer has anything to be true about.
    // Three of the fourteen reads used to be `allSettled`, so the suppliers
    // rollup, the handover offer and the punch list could each fail while the
    // money strip still drew. That protected against *one endpoint* failing —
    // and there is one endpoint now, which either answers or does not. The
    // page it would have half-drawn is worse than the one that says so: a
    // renovation showing Committed with the suppliers silently missing is a
    // total without the rows that prove it.
    mock_getProjectPage.mockRejectedValueOnce(new Error('offline'));
    const r = await arrange();
    expect(r.queryByText('Downstairs laundry')).toBeNull();
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

  it('asks for one project and gets its punch list with it', async () => {
    // The filter moved into `home.project_page`, which reads
    // `snags_with_details` by `project_id` exactly as `getSnags({ projectId })`
    // did — so what is assertable here is that the screen still keeps no list
    // of its own and asks for this project by id.
    await arrange();
    expect(mock_getProjectPage).toHaveBeenCalledWith('p1');
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

/**
 * What a press costs.
 *
 * This is the shape of the failure the whole read was rebuilt for, so it is
 * pinned as behaviour rather than described in a comment. The page used to fire
 * fourteen parallel reads on open and eleven on every write, into a PostgREST
 * pool of ten. Past ten they queue; a queued page looks like a page that
 * ignored the press; the press comes again with eleven more. The live logs for
 * 21 September have exactly that — a toggle pressed three times inside one
 * second, and `projects_with_totals` answering in 17.4 seconds — on views that
 * each run in milliseconds by themselves.
 */
describe('a press costs one read, however many presses land', () => {
  it('re-reads the page once after a write', async () => {
    mock_setItemExcluded.mockResolvedValueOnce(undefined);
    const r = await arrange({ elements: [element()], items: [item({ name: 'Toilet suite' })] });
    const before = mock_getProjectPage.mock.calls.length;

    await TestRenderer.act(async () => {
      await byLabel(r, 'Exclude Toilet suite from the price build').props.onPress();
    });

    // One, not eleven — and the money, the punch list, the handover offer and
    // the files all come back in it.
    expect(mock_getProjectPage.mock.calls.length).toBe(before + 1);
  });

  it('never has two reads on the wire at once, and queues at most one more', async () => {
    const r = await arrange({ elements: [element()], items: [item({ name: 'Toilet suite' })] });

    // A read that does not settle until told to, so several refreshes are
    // genuinely in flight at the same moment rather than merely sequential.
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    mock_getProjectPage.mockImplementation(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve({
            project: project(), elements: [element()], items: [], quotes: [], lines: [],
            payments: [], milestones: [], expected: [], expectedCostLines: [], bills: [],
            suppliers: [], files: [], things: [], snags: [],
          });
        });
      });
    });

    const toggle = byLabel(r, 'Exclude Toilet suite from the price build');
    await TestRenderer.act(async () => {
      toggle.props.onPress();
      toggle.props.onPress();
      toggle.props.onPress();
      await Promise.resolve();
    });

    // Three presses. The guard on the toggle itself means one write, and the
    // single-flight refresh means one read — never three racing to say
    // different things about one row, which is also how the older of two
    // reloads used to land last and quietly revert the newer.
    expect(mock_setItemExcluded).toHaveBeenCalledTimes(1);
    expect(peak).toBe(1);

    await TestRenderer.act(async () => {
      release.forEach((go) => go());
      await Promise.resolve();
    });
    expect(peak).toBe(1);
  });
});

/**
 * Adding an item.
 *
 * It was a text box and a `+` under the list — the compose bar's gesture on a
 * page nobody fills in standing in a doorway, and it could only ever take the
 * name, so the notes `create_item` accepts had nowhere to go.
 */
describe('adding an item to a part of the job', () => {
  const boxByLabel = (r: ReturnType<typeof render>, label: string) =>
    r.root.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
        && !!n.props?.onChangeText,
      { deep: true }
    )[0];

  it('offers a pill rather than an inline box', async () => {
    const r = await arrange();

    expect(byLabel(r, 'Add an item to Downstairs laundry')).toBeDefined();
    // The box that used to sit there is gone, not merely relabelled.
    expect(boxByLabel(r, 'Add an item to Downstairs laundry')).toBeUndefined();
  });

  it('opens the item sheet itself, not a smaller one in front of it', async () => {
    // The second modal asked for a name and a note and then shut, leaving
    // somebody to open the item they had just made to put a price on it —
    // two screens for one act, on the page whose redesign was about how many
    // presses a bill costs. `ItemSheet.test.tsx` pins what is inside it;
    // this pins that it is what opens, already pointed at the right part.
    const r = await arrange();
    expect(r.queryByText('item sheet open')).toBeNull();

    await TestRenderer.act(async () => {
      byLabel(r, 'Add an item to Downstairs laundry').props.onPress();
    });

    r.getByText('item sheet open');
    expect(byLabel(r, 'naming a new item on Downstairs laundry')).toBeDefined();
  });

  it('creates the row against the part the pill was pressed inside', async () => {
    const r = await arrange();
    await TestRenderer.act(async () => {
      byLabel(r, 'Add an item to Downstairs laundry').props.onPress();
    });
    await TestRenderer.act(async () => {
      await byLabel(r, 'naming a new item on Downstairs laundry').props.onPress();
    });
    // No notes argument: the sheet that opens has a box for them and writes
    // them itself, so there is nothing for the create call to carry.
    expect(mock_createItem).toHaveBeenCalledWith('e1', 'Shower mixer');
  });

  it('is not creating anything until the pill is pressed', async () => {
    const r = await arrange();
    expect(byLabel(r, 'naming a new item on Downstairs laundry')).toBeUndefined();
    expect(mock_createItem).not.toHaveBeenCalled();
  });

  it('is offered under Also expecting too, as the same pill', async () => {
    const r = await arrange();
    expect(byLabel(r, "Add something you're expecting")).toBeDefined();
  });
});
