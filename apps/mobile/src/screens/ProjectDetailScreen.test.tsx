import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, flattenStyle } from '../test/render';
import { Colors } from '../constants/theme';
import ProjectDetailScreen, { describeWhatGoes, elementHoldsSomething } from './ProjectDetailScreen';
import { bill, downstairs, element, item, page, project, quote } from '../test/projectFixtures';
import { dayKey } from '@snag/supabase-queries';

/**
 * One project's page, V2.
 *
 * What would erode first, in order: the summary showing a figure that is not
 * agreed plus undecided; a bill that cannot be paid from where it is listed;
 * the page putting two reads on the wire at once; and a thing left to decide
 * that the page forgets to mention. The sheets have their own specs.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => (global as any).__nav,
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));

// Each sheet stands in as a line saying whether it is open and on what.
jest.mock('../components/MoneySheet', () => require('../test/sheetStub').sheetStub('money sheet', (p: any) => JSON.stringify(p.start ?? {})));
jest.mock('../components/ThingSheet', () => require('../test/sheetStub').sheetStub('thing sheet', (p: any) => p.item?.name ?? null));
jest.mock('../components/PriceSheet', () => require('../test/sheetStub').sheetStub('price sheet', (p: any) => p.quote?.supplier ?? null));
jest.mock('../components/RoomSheet', () => require('../test/sheetStub').sheetStub('room sheet', (p: any) => p.room?.name ?? null));
jest.mock('../components/AddThingSheet', () => require('../test/sheetStub').sheetStub('add thing sheet', (p: any) => p.start?.name ?? null));
jest.mock('../components/ProjectRoomsSheet', () => require('../test/sheetStub').sheetStub('rooms sheet'));
jest.mock('../components/EditBudgetSheet', () => require('../test/sheetStub').sheetStub('budget sheet'));
jest.mock('../components/Attachments', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'attachments') };
});

const mock_getProjectPage = jest.fn();
const mock_payBill = jest.fn().mockResolvedValue(undefined);
const mock_getSupplierNames = jest.fn().mockResolvedValue(['Reece']);
const mock_approveInvoiceReview = jest.fn().mockResolvedValue({});
const mock_clearFigure = jest.fn().mockResolvedValue(undefined);
const mock_filePaperwork = jest.fn().mockResolvedValue({});
const mock_rereadInvoiceReview = jest.fn().mockResolvedValue({ cards: 4 });
const mock_renameSupplier = jest.fn().mockResolvedValue(1);
const mock_updateProject = jest.fn().mockResolvedValue({});
const mock_updateExpectedCost = jest.fn().mockResolvedValue(undefined);
jest.mock('../lib/supabase', () => {
  const real = jest.requireActual('@snag/supabase-queries');
  return {
    getProjectPage: (...a: unknown[]) => mock_getProjectPage(...a),
    payBill: (...a: unknown[]) => mock_payBill(...a),
    getSupplierNames: (...a: unknown[]) => mock_getSupplierNames(...a),
    approveInvoiceReview: (...a: unknown[]) => mock_approveInvoiceReview(...a),
    clearFigure: (...a: unknown[]) => mock_clearFigure(...a),
    filePaperwork: (...a: unknown[]) => mock_filePaperwork(...a),
    rereadInvoiceReview: (...a: unknown[]) => mock_rereadInvoiceReview(...a),
    renameSupplier: (...a: unknown[]) => mock_renameSupplier(...a),
    declineInvoiceReview: jest.fn(), restoreInvoiceReview: jest.fn(), deleteInvoiceReview: jest.fn(),
    addExpectedCostLine: jest.fn(), addMilestone: jest.fn(), addQuoteLine: jest.fn(),
    createElement: jest.fn(), createExpectedCost: jest.fn(), createLocation: jest.fn(),
    createThing: jest.fn(), deleteElement: jest.fn(), deleteExpectedCost: jest.fn(),
    deleteExpectedCostLine: jest.fn(), deleteMilestone: jest.fn(), deleteProject: jest.fn(),
    deleteQuoteLine: jest.fn(), deleteStoredFiles: jest.fn(), setExpectedCostConfirmed: jest.fn(),
    updateExpectedCost: (...a: unknown[]) => mock_updateExpectedCost(...a), updateExpectedCostLine: jest.fn(),
    updateProject: (...a: unknown[]) => mock_updateProject(...a),
    getFileUrls: jest.fn().mockResolvedValue({}),
    // The pure ones are real: mocking the summary would mock away the rule.
    projectSummary: real.projectSummary,
    describeRoom: real.describeRoom,
    liveSetAsides: real.liveSetAsides,
    formatMoney: real.formatMoney,
    inclGst: real.inclGst,
  };
});
jest.mock('../lib/exportFile', () => ({
  writeExport: jest.fn().mockResolvedValue({ fileName: 'x.csv', path: null }),
  loadExportImages: async () => [],
}));
const mock_showToast = jest.fn();
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: mock_showToast }) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => (global as any).__household }));

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

async function arrange(data: any = downstairs()) {
  mock_getProjectPage.mockResolvedValue(data);
  const r = render(<ProjectDetailScreen route={{ params: { projectId: 'p1' } } as any} navigation={{} as any} />);
  await TestRenderer.act(async () => {});
  return r;
}

const byLabel = (r: ReturnType<typeof render>, label: string) => {
  const found = r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label && n.props?.onPress,
    { deep: true }
  );
  if (!found.length) throw new Error(`Nothing pressable labelled "${label}"`);
  return found[0];
};
const press = async (r: ReturnType<typeof render>, label: string) => {
  await TestRenderer.act(async () => { byLabel(r, label).props.onPress(); });
};

describe('are we on budget', () => {
  it('shows the expected total as agreed plus undecided, and what is left', async () => {
    const r = await arrange();
    r.getByText('Expected total');
    r.getByText('$208,320');
    r.getByText('Agreed');
    r.getByText('$196,320');
    r.getByText('Undecided');
    // Once in the summary, once against the bathroom it is set aside for.
    expect(r.getAllByText('$12,000')).toHaveLength(2);
    // The list card's name for the same figure, and its colours: 9% left is brass.
    r.getByText('Budget remaining');
    expect(flattenStyle(r.getByText('$21,680').props.style).color).toBe(Colors.status.doing);
    r.getByText('$230,000');
  });

  it('says over budget in words, not only in colour', async () => {
    const r = await arrange(downstairs({ project: { budget: 200000 } }));
    r.getByText('Over budget');
    r.getByText('$8,320');
  });

  it('offers to set a budget rather than inventing one', async () => {
    const r = await arrange(downstairs({ project: { budget: null } }));
    r.getByText('Set a budget');
    expect(r.queryByText('Budget remaining')).toBeNull();
    await press(r, 'Set a budget');
    r.getByText('budget sheet open');
  });

  it('keeps paid apart from what is still owed', async () => {
    const r = await arrange();
    // The tile, and the pill on the one bill still owed.
    expect(r.getAllByText('Paid')).toHaveLength(2);
    r.getByText('$16,020');
    expect(r.getAllByText('To pay').length).toBeGreaterThan(0);
  });

  it('never uses the accounting words', async () => {
    const r = await arrange();
    const text = r.getAllByType('Text').map((n) => n.children.join('')).join(' ');
    for (const word of ['Committed', 'Invoiced', 'Forecast', 'Quoted', 'PC sum', 'allowance']) {
      expect(text).not.toContain(word);
    }
  });
});

describe('what is left to decide', () => {
  it('lists each undecided thing with its options and range', async () => {
    const r = await arrange();
    r.getByText('To decide');
    r.getByText('Toilet');
    r.getByText('Bathroom · 3 options');
    r.getByText('$890–$2,100');
    r.getByText('Shower mixer');
    r.getByText('Bathroom · No prices yet');
  });

  it('opens the thing when its row is pressed', async () => {
    const r = await arrange();
    await press(r, 'Toilet');
    r.getByText('thing sheet open: Toilet');
  });

  it('is absent when nothing is left to decide', async () => {
    const r = await arrange(page({ project: project({ committedTotal: 500 }) }));
    expect(r.queryByText('To decide')).toBeNull();
  });
});

describe('what do we have to pay', () => {
  it('lists what is owed with its due date', async () => {
    const r = await arrange();
    // Named twice: once owed under To pay, once under Suppliers.
    expect(r.getAllByText('ReliaBuilder')).toHaveLength(2);
    r.getByText('Progress bill 1 · Due 5 Oct 2026');
  });

  it('pays the whole of what is owing from the row, then re-reads', async () => {
    const r = await arrange();
    await press(r, 'Mark ReliaBuilder $46,000 as paid');
    expect(mock_payBill).toHaveBeenCalledWith('b1', 46000, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(mock_getProjectPage).toHaveBeenCalledTimes(2);
    expect(mock_showToast).toHaveBeenCalledWith('Paid');
  });

  it('opens the bill itself, so it can be corrected or deleted', async () => {
    const r = await arrange(downstairs({ quotes: [quote({ id: 'b1', kind: 'invoice', supplier: 'ReliaBuilder', amount: 46000 })] }));
    await press(r, 'ReliaBuilder');
    r.getByText('price sheet open: ReliaBuilder');
  });

  it('puts several bills from one supplier under one heading, owed adding up', async () => {
    const r = await arrange(downstairs({
      bills: [
        bill({ id: 'm1', supplier: 'MSC Consulting', detail: 'June', dated: '2026-08-31', unpaid: 3565, dueOn: '2026-07-20', overdue: true }),
        bill(),
        bill({ id: 'm2', supplier: 'msc consulting ', detail: 'August', dated: '2026-06-30', unpaid: 437, dueOn: '2026-09-30' }),
      ],
    }));
    r.getByText('MSC Consulting');
    r.getByText('2 bills · 1 overdue');
    r.getByText('$4,002');
    r.getByText('Overdue since 20 Jul 2026');
    r.getByText('Due 30 Sep 2026');
    // Each bill under it is still paid on its own.
    await press(r, 'Mark MSC Consulting June $3,565 as paid');
    expect(mock_payBill).toHaveBeenCalledWith('m1', 3565, expect.any(String));
  });

  it('folds a supplier’s bills under the heading', async () => {
    const r = await arrange(downstairs({
      bills: [
        bill({ id: 'm1', supplier: 'MSC', detail: 'June', unpaid: 100 }),
        bill({ id: 'm2', supplier: 'MSC', detail: 'August', unpaid: 50 }),
      ],
    }));
    await press(r, 'MSC, 2 bills, $150 to pay');
    r.getByText('$150');
    expect(r.queryByText('June')).toBeNull();
  });

  it('names an overdue bill as overdue', async () => {
    const r = await arrange(downstairs({ bills: [bill({ overdue: true, dueOn: '2026-09-01' })] }));
    r.getByText('Progress bill 1 · Overdue since 1 Sep 2026');
  });
});

describe('where the money is going', () => {
  it('puts every room and the whole job on the page, adding up to the total', async () => {
    const r = await arrange();
    r.getByText('Where it’s going');
    r.getByText('Whole job');
    r.getByText('$186,920');
    r.getByText('$1,400 over the $8,000 set aside');
    r.getByText('$12,000 set aside · 3 to decide');
  });

  it('opens a room', async () => {
    const r = await arrange();
    await press(r, 'Laundry');
    r.getByText('room sheet open: Laundry');
  });
});

describe('one way in for money', () => {
  it('asks what you have got, and reads the supplier names only then', async () => {
    const r = await arrange();
    expect(mock_getSupplierNames).not.toHaveBeenCalled();
    await press(r, 'Add a quote, bill or receipt');
    r.getByText('money sheet open: {}');
    expect(mock_getSupplierNames).toHaveBeenCalledTimes(1);
  });
});

describe('what a press costs', () => {
  it('never has two reads on the wire, however many presses land', async () => {
    const r = await arrange();
    let release!: () => void;
    mock_getProjectPage.mockImplementation(() => new Promise((resolve) => { release = () => resolve(downstairs()); }));
    // A press while a read is pending is queued rather than started.
    await press(r, 'Mark ReliaBuilder $46,000 as paid');
    await press(r, 'Mark ReliaBuilder $46,000 as paid');
    expect(mock_payBill).toHaveBeenCalledTimes(1);
    expect(mock_getProjectPage).toHaveBeenCalledTimes(2);
    await TestRenderer.act(async () => { release(); });
  });
});

describe('the rest of the page', () => {
  it('lists the punch list and opens a job from it', async () => {
    const r = await arrange(downstairs({
      snags: [{ id: 's1', reference: 'S-1', description: 'Grout cracking', status: 'open' }],
    }));
    r.getByText('To sort out');
    await press(r, 'Grout cracking');
    expect((global as any).__nav.navigate).toHaveBeenCalledWith('SnagDetail', { snagId: 's1' });
  });

  it('offers only what is installed to the house record, and stops once it is there', async () => {
    const base = downstairs();
    const r = await arrange({
      ...base,
      items: [
        ...base.items,
        item({ id: 'w', elementId: 'eL', name: 'Washing machine', status: 'installed', committed: 1499 }),
        item({ id: 'd', elementId: 'eL', name: 'Dryer', status: 'installed', committed: 999 }),
      ],
      things: [{ id: 't', projectItemId: 'd' }],
    });
    r.getByText('Add to the house record');
    await press(r, 'Record Washing machine in the house record');
    r.getByText('add thing sheet open: Washing machine');
    r.getByText('In the house record');
  });

  it('shows an invoice waiting to be understood, and approving it re-reads', async () => {
    const r = await arrange(downstairs({
      invoiceReviews: [{
        id: 'rv1', projectId: 'p1', state: 'pending', supplier: 'Tile Space', amount: 1240,
        amountInclGst: true, paid: false, read: {}, createdAt: '2026-09-20T00:00:00Z',
        inferred: [], photoPaths: [], documentPaths: [], roomIds: [], roomAmounts: null,
      }],
    }));
    const approve = r.root.findAll((n: any) => n.props?.onApprove, { deep: true })[0];
    await TestRenderer.act(async () => { approve.props.onApprove(); });
    expect(mock_approveInvoiceReview).toHaveBeenCalledWith('rv1');
    expect(mock_getProjectPage).toHaveBeenCalledTimes(2);
  });
});

describe('a bill that looks like one already on the job', () => {
  const waiting = (over: any = {}) => ({
    id: 'rv1', projectId: 'p1', state: 'pending', supplier: 'MSC Consulting', amount: 437,
    amountInclGst: true, invoiceNumber: 'INV87022', dated: '2026-08-31', paid: false,
    createdAt: '2026-09-20T00:00:00Z', inferred: [], photoPaths: [], documentPaths: [],
    roomIds: [], roomAmounts: null, ...over,
  });
  const onJob = quote({
    id: 'm1', projectId: 'p1', kind: 'invoice', status: 'accepted', supplier: 'MSC Consulting',
    invoiceNumber: 'INV87022', amount: 437, dated: '2026-08-31',
  });

  it('warns on the card, opens the bill it matches, and still allocates', async () => {
    const r = await arrange(downstairs({ quotes: [...downstairs().quotes, onJob], invoiceReviews: [waiting()] }));
    r.getByText('Looks like INV87022 from MSC Consulting ($437, 31 Aug 2026), already on the job');
    await press(r, 'Open the bill it looks like');
    r.getByText('price sheet open: MSC Consulting');
    const approve = r.root.findAll((n: any) => n.props?.onApprove, { deep: true })[0];
    await TestRenderer.act(async () => { approve.props.onApprove(); });
    expect(mock_approveInvoiceReview).toHaveBeenCalledWith('rv1');
  });

  it('warns on the second of two cards for the same bill', async () => {
    const r = await arrange(downstairs({
      invoiceReviews: [waiting(), waiting({ id: 'rv2', createdAt: '2026-09-21T00:00:00Z' })],
    }));
    expect(r.getAllByText('Looks like INV87022 from MSC Consulting ($437, 31 Aug 2026), also waiting')).toHaveLength(1);
  });

  it('says nothing about a different invoice from the same supplier', async () => {
    const r = await arrange(downstairs({
      quotes: [...downstairs().quotes, onJob], invoiceReviews: [waiting({ invoiceNumber: 'INV87100' })],
    }));
    const text = r.getAllByType('Text').map((n) => n.children.join('')).join(' ');
    expect(text).not.toContain('Looks like');
  });
});

describe('one email, several papers', () => {
  /** A `Button`, found by the word on it. */
  const pressButton = async (r: ReturnType<typeof render>, label: string) => {
    const node = r.root.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.label === label && n.props?.onPress, { deep: true },
    )[0];
    await TestRenderer.act(async () => { node.props.onPress(); });
  };
  const card = (over: any = {}) => ({
    id: 'rv1', projectId: 'p1', state: 'pending', kind: 'invoice', addressedTo: null,
    sourceRef: 'em_var', sourcePart: 0, sourceSubject: 'Fwd: Variations',
    supplier: 'ReliaBuilder', amount: 6325, amountInclGst: true, invoiceNumber: 'INV-0184', paid: false,
    createdAt: '2026-09-24T00:00:00Z', inferred: [], photoPaths: [], documentPaths: [],
    roomIds: [], roomAmounts: null, ...over,
  });
  const variations = [
    card(),
    card({ id: 'rv2', sourcePart: 1, kind: 'paperwork', supplier: 'Force Plumbing', addressedTo: 'ReliaBuilder', invoiceNumber: null, amount: 1200 }),
    card({ id: 'rv3', sourcePart: 2, kind: 'paperwork', supplier: 'Good Connection', detail: 'Certificate of compliance', invoiceNumber: null, amount: null }),
  ];

  it('keeps an email’s cards together under what it held', async () => {
    const r = await arrange(downstairs({ invoiceReviews: variations }));
    r.getByText('Fwd: Variations — 1 bill · 2 to file');
    r.getByText('Good Connection · Certificate of compliance');
  });

  it('files paperwork through its own sheet, and never allocates it', async () => {
    const r = await arrange(downstairs({ invoiceReviews: variations }));
    const cert = r.root.findAll((n: any) => n.props?.onApprove && n.props?.review?.id === 'rv3', { deep: true })[0];
    await TestRenderer.act(async () => { cert.props.onApprove(); });
    expect(mock_approveInvoiceReview).not.toHaveBeenCalled();
    r.getByText('Where does it go?');
    await press(r, 'File it');
    expect(mock_filePaperwork).toHaveBeenCalledWith('rv3', { quoteId: null, elementId: null });
    expect(mock_showToast).toHaveBeenCalledWith('Filed with the job’s paperwork');
  });

  it('adds a quote as a quote, and says nothing is agreed', async () => {
    const r = await arrange(downstairs({ invoiceReviews: [card({ kind: 'quote', invoiceNumber: 'QU-0111' })] }));
    const approve = r.root.findAll((n: any) => n.props?.onApprove, { deep: true })[0];
    await TestRenderer.act(async () => { approve.props.onApprove(); });
    expect(mock_approveInvoiceReview).toHaveBeenCalledWith('rv1');
    expect(mock_showToast).toHaveBeenCalledWith('Added as a quote — nothing’s agreed yet');
  });

  it('reads a blank card again, and says how many papers came back', async () => {
    const r = await arrange(downstairs({
      invoiceReviews: [card({ supplier: null, amount: null, invoiceNumber: null, documentPaths: ['h/docs/1-0-a.pdf', 'h/docs/1-1-b.pdf'] })],
    }));
    const calls = mock_getProjectPage.mock.calls.length;
    await pressButton(r, 'Read again');
    expect(mock_rereadInvoiceReview).toHaveBeenCalledWith('rv1');
    expect(mock_showToast).toHaveBeenCalledWith('Read — that email held 4 papers');
    expect(mock_getProjectPage.mock.calls.length).toBe(calls + 1);
  });

  it('says why when nothing could be read, and leaves the card', async () => {
    mock_rereadInvoiceReview.mockRejectedValueOnce(new Error('The reader is busy right now — try again in a minute.'));
    const r = await arrange(downstairs({
      invoiceReviews: [card({ supplier: null, amount: null, invoiceNumber: null })],
    }));
    await pressButton(r, 'Read again');
    expect(mock_showToast).toHaveBeenCalledWith('The reader is busy right now — try again in a minute.');
    r.getByText('Nothing was read off this yet.');
  });
});

describe('a figure somebody typed over', () => {
  it('is named, with what the prices say, and can be undone', async () => {
    const base = downstairs();
    const r = await arrange({
      ...base,
      project: { ...base.project, committedOverride: 250000, committedDerived: 208320 },
      elements: base.elements.map((e: any) => (e.id === 'eB' ? { ...e, paidOverride: 500 } : e)),
    });
    r.getByText('Some figures were typed in by hand');
    r.getByText('The prices come to $196,320 agreed');
    await press(r, 'Use the prices');
    expect(mock_clearFigure).toHaveBeenCalledWith('p1', 'committed', null);
    expect(mock_clearFigure).toHaveBeenCalledWith('p1', 'paid', 'eB');
    expect(mock_getProjectPage).toHaveBeenCalledTimes(2);
  });

  it('says nothing when every figure is the prices', async () => {
    const r = await arrange();
    expect(r.queryByText('Some figures were typed in by hand')).toBeNull();
  });
});

describe('taking a part off the job', () => {
  it('counts files as holding something, not only things', () => {
    expect(elementHoldsSomething(element())).toBe(false);
    expect(elementHoldsSomething(element({ documentPaths: ['h/docs/letter.pdf'] }))).toBe(true);
    expect(elementHoldsSomething(element({ itemCount: 2 }))).toBe(true);
  });

  it('says what goes in counts', () => {
    expect(describeWhatGoes(element({ itemCount: 2, photoPaths: ['a.jpg'] })))
      .toBe('2 things and their prices and 1 file go with it.');
  });
});

describe('where it is up to', () => {
  it('says the status beside the date, and changes it in one write from a sheet', async () => {
    const r = await arrange(downstairs({ project: { status: 'underway', startedOn: '2026-03-03' } }));
    r.getByText('Underway');
    await press(r, 'Underway. Change where it’s up to');
    r.getByText('Where’s it up to?');
    await press(r, 'Complete');
    await press(r, 'Done');
    expect(mock_updateProject).toHaveBeenCalledTimes(1);
    expect(mock_updateProject).toHaveBeenCalledWith('p1', {
      status: 'done', startedOn: '2026-03-03', finishedOn: dayKey(new Date()),
    });
    expect(mock_showToast).toHaveBeenCalledWith('Marked complete');
    expect(mock_getProjectPage).toHaveBeenCalledTimes(2);
  });
});

describe('suppliers', () => {
  // The dialog's buttons are the shared Button, found by the word on them.
  const dialogButton = async (r: ReturnType<typeof render>, label: string) => {
    const [button] = r.root.findAll((n: any) => n.props?.label === label && n.props?.onPress && 'variant' in n.props, { deep: true });
    if (!button) throw new Error(`No dialog button "${label}"`);
    await TestRenderer.act(async () => { button.props.onPress(); });
  };

  const twoSpellings = () => downstairs({
    quotes: [
      ...downstairs().quotes,
      quote({ id: 'rl', projectId: 'p1', supplier: 'RELIABUILDER LIMITED', kind: 'invoice', amount: 2140, status: 'accepted' }),
    ],
  });

  it('lists everybody the job names, and says which two look like one business', async () => {
    const r = await arrange(twoSpellings());
    r.getByText('Suppliers');
    r.getByText('Looks like ReliaBuilder · hold and drop onto it to merge');
  });

  it('confirms a merge before writing it, then renames across the job once', async () => {
    const r = await arrange(twoSpellings());
    await press(r, 'Merge RELIABUILDER LIMITED into ReliaBuilder');
    r.getByText('Merge “RELIABUILDER LIMITED” into “ReliaBuilder”?');
    expect(mock_renameSupplier).not.toHaveBeenCalled();
    await dialogButton(r, 'Merge');
    expect(mock_renameSupplier).toHaveBeenCalledTimes(1);
    expect(mock_renameSupplier).toHaveBeenCalledWith('p1', 'RELIABUILDER LIMITED', 'ReliaBuilder');
    expect(mock_showToast).toHaveBeenCalledWith('Merged into ReliaBuilder');
    expect(mock_getProjectPage).toHaveBeenCalledTimes(2);
  });

  it('writes nothing when the merge is cancelled', async () => {
    const r = await arrange(twoSpellings());
    await press(r, 'Merge RELIABUILDER LIMITED into ReliaBuilder');
    await dialogButton(r, 'Cancel');
    expect(mock_renameSupplier).not.toHaveBeenCalled();
  });

  it('stops the page scrolling while a supplier is held', async () => {
    const r = await arrange(twoSpellings());
    const scroll = () => r.root.findAll((n: any) => typeof n.type !== 'string' && 'scrollEnabled' in (n.props ?? {}), { deep: true })[0];
    expect(scroll().props.scrollEnabled).toBe(true);
    const row = r.root.findAll((n: any) => n.props?.onLongPress && String(n.props.accessibilityLabel).startsWith('RELIABUILDER LIMITED'), { deep: true })[0];
    await TestRenderer.act(async () => { row.props.onLongPress(); });
    expect(scroll().props.scrollEnabled).toBe(false);
  });
});

describe('documents', () => {
  const withFiles = () => downstairs({
    project: { documentPaths: ['h/docs/1790000000000-1-Floor plan.pdf'] },
    files: [
      { projectId: 'p1', level: 'project', ownerId: 'p1', ownerName: 'Downstairs conversion', kind: 'document',
        path: 'h/docs/1790000000000-1-Floor plan.pdf', supplier: null, ownerDetail: null },
      { projectId: 'p1', level: 'quote', ownerId: 'n1', ownerName: 'Auckland Council', kind: 'document',
        path: 'h/docs/1790000000000-2-Consent fee.pdf', supplier: 'Auckland Council', ownerDetail: 'BC-2291' },
      { projectId: 'p1', level: 'payment', ownerId: 'pay1', ownerName: 'Deposit', kind: 'document',
        path: 'h/docs/1790000000000-3-Bank confirmation.pdf', supplier: 'ReliaBuilder', ownerDetail: 'INV-0184' },
    ],
  });

  it('groups every file by who it came from, a payment’s under the supplier it paid', async () => {
    const r = await arrange(withFiles());
    r.getByText('Consent fee.pdf');
    r.getByText('On BC-2291');
    r.getByText('Bank confirmation.pdf');
    r.getByText('Deposit · paying INV-0184');
    r.getByText('Floor plan.pdf');
    r.getByText('On the job');
  });

  it('puts what came from nobody last', async () => {
    const r = await arrange(withFiles());
    const headings = r.getAllByType('Text')
      .map((n) => n.children.join(''))
      .filter((t) => ['Auckland Council', 'ReliaBuilder', 'Not from a supplier'].includes(t));
    // The last heading on the page is the job's own.
    expect(headings[headings.length - 1]).toBe('Not from a supplier');
  });

  it('offers × only on a file on the job itself; the rest are removed where they hang', async () => {
    const r = await arrange(withFiles());
    byLabel(r, 'Remove Floor plan.pdf');
    expect(() => byLabel(r, 'Remove Consent fee.pdf')).toThrow();
    expect(() => byLabel(r, 'Remove Bank confirmation.pdf')).toThrow();
  });

  it('takes a file off the job in one write', async () => {
    const r = await arrange(withFiles());
    await press(r, 'Remove Floor plan.pdf');
    expect(mock_updateProject).toHaveBeenCalledWith('p1', { documentPaths: [] });
    expect(mock_showToast).toHaveBeenCalledWith('Document removed');
  });
});

describe('expected to pay', () => {
  const x = (over: any = {}) => ({
    id: 'x1', projectId: 'p1', elementId: null, name: 'ReliaBuilder payment 3/4',
    amount: 43987.5, amountInclGst: true, likelySupplier: null, note: null,
    confirmed: false, settledBy: null, createdAt: '2026-09-24T09:33:57Z', ...over,
  });
  const earmarked = [
    x(),
    x({ id: 'x2', name: 'ReliaBuilder payment 4/4', createdAt: '2026-09-24T09:34:47Z' }),
    x({ id: 'x3', name: 'Council fees', amount: null, createdAt: '2026-09-25T00:00:00Z' }),
  ];
  const claim = quote({
    id: 'b9', projectId: 'p1', kind: 'invoice', status: 'accepted', supplier: 'RELIABUILDER LIMITED',
    invoiceNumber: 'INV-0231', amount: 43987.5, createdAt: '2026-09-26T00:00:00Z',
  });
  const text = (r: ReturnType<typeof render>) => r.getAllByType('Text').map((n) => n.children.join('')).join(' | ');

  it('totals what is earmarked in a tile of its own, and counts the unpriced in words', async () => {
    const r = await arrange(downstairs({ expected: earmarked }));
    // The tile and the section's heading.
    expect(r.getAllByText('Expected to pay')).toHaveLength(2);
    // The tile and the builder's group.
    expect(r.getAllByText('$87,975')).toHaveLength(2);
    r.getByText('+ 1 not priced');
  });

  it('lists them under the business their names spell, beside those with nobody named', async () => {
    const r = await arrange(downstairs({ expected: earmarked }));
    r.getByText('2 payments');
    r.getByText('ReliaBuilder payment 3/4');
    r.getByText('ReliaBuilder payment 4/4');
    r.getByText('Council fees');
    r.getByText('Not priced');
    expect(r.getAllByText('Whole job · undecided').length).toBeGreaterThanOrEqual(3);
  });

  it('is absent when nothing is earmarked, and when everything earmarked is paid off', async () => {
    const none = await arrange(downstairs());
    expect(text(none)).not.toContain('Expected to pay');
    none.unmount();
    const paid = await arrange(downstairs({ expected: [x({ settledBy: 'b9' })], quotes: [...downstairs().quotes, claim] }));
    expect(text(paid)).not.toContain('Expected to pay');
  });

  it('asks which bill paid it, offers the builder’s claim first, and links the one chosen', async () => {
    const r = await arrange(downstairs({ expected: earmarked, quotes: [...downstairs().quotes, claim] }));
    await press(r, 'Say which bill paid ReliaBuilder payment 3/4');
    r.getByText('Which bill paid this?');
    r.getByText('From ReliaBuilder');
    await press(r, 'Paid by RELIABUILDER LIMITED INV-0231, $43,987.50');
    expect(mock_updateExpectedCost).toHaveBeenCalledWith('x1', { settledBy: 'b9' });
    expect(mock_showToast).toHaveBeenCalledWith('Paid off by INV-0231');
    expect(mock_getProjectPage).toHaveBeenCalledTimes(2);
  });

  it('records the bill when it is not on the job yet, starting from the earmark', async () => {
    const r = await arrange(downstairs({ expected: earmarked }));
    await press(r, 'Say which bill paid ReliaBuilder payment 3/4');
    r.getByText('No bill from ReliaBuilder within 10% of it on the job yet.');
    await press(r, 'Record the bill');
    const sheet = r.getAllByType('Text').map((n) => n.children.join('')).find((t) => t.startsWith('money sheet open'));
    expect(sheet).toContain('"kind":"bill"');
    expect(sheet).toContain('"settle":{"id":"x1"');
    expect(text(r)).not.toContain('Which bill paid this?');
  });

  describe('an emailed claim that looks like one', () => {
    const card = (over: any = {}) => ({
      id: 'rv1', projectId: 'p1', state: 'pending', kind: 'invoice', addressedTo: null,
      supplier: 'RELIABUILDER LIMITED', amount: 43987.5, amountInclGst: true, invoiceNumber: 'INV-0231',
      paid: false, createdAt: '2026-09-26T00:00:00Z', sourceAt: '2026-09-26T00:00:00Z', inferred: [],
      photoPaths: [], documentPaths: [], roomIds: [], roomAmounts: null, ...over,
    });
    /** The card's own button, so the tick it carries is what is sent. */
    const allocate = async (r: ReturnType<typeof render>) => {
      const button = r.root.findAll(
        (n: any) => typeof n.type !== 'string' && n.props?.label === 'Allocate' && n.props?.onPress, { deep: true },
      )[0];
      await TestRenderer.act(async () => { button.props.onPress(); });
    };

    it('offers to pay it off, ticked, and allocating links it to the bill that lands', async () => {
      mock_approveInvoiceReview.mockResolvedValueOnce({ id: 'b9' });
      const r = await arrange(downstairs({ expected: earmarked, invoiceReviews: [card()] }));
      r.getByText('Pays off ReliaBuilder payment 3/4 · $43,987.50');
      r.getByText('Takes it off Expected to pay');
      await allocate(r);
      expect(mock_approveInvoiceReview).toHaveBeenCalledWith('rv1');
      expect(mock_updateExpectedCost).toHaveBeenCalledWith('x1', { settledBy: 'b9' });
      expect(mock_showToast).toHaveBeenCalledWith('Added to the job · pays off ReliaBuilder payment 3/4');
    });

    it('links nothing once it is unticked', async () => {
      mock_approveInvoiceReview.mockResolvedValueOnce({ id: 'b9' });
      const r = await arrange(downstairs({ expected: earmarked, invoiceReviews: [card()] }));
      await press(r, 'Pays off ReliaBuilder payment 3/4 · $43,987.50');
      r.getByText('Stays on Expected to pay');
      await allocate(r);
      expect(mock_approveInvoiceReview).toHaveBeenCalledWith('rv1');
      expect(mock_updateExpectedCost).not.toHaveBeenCalled();
      expect(mock_showToast).toHaveBeenCalledWith('Added to the job');
    });

    it('says so, and keeps the bill, when the link is refused', async () => {
      mock_approveInvoiceReview.mockResolvedValueOnce({ id: 'b9' });
      mock_updateExpectedCost.mockRejectedValueOnce(new Error('That price belongs to a different job'));
      const r = await arrange(downstairs({ expected: earmarked, invoiceReviews: [card()] }));
      await allocate(r);
      expect(mock_showToast).toHaveBeenCalledWith(
        'Added to the job, but not linked to ReliaBuilder payment 3/4 — use Billed on Expected to pay',
      );
    });

    it('offers two waiting claims the two payments, the older card the earlier one', async () => {
      const r = await arrange(downstairs({
        expected: earmarked,
        invoiceReviews: [
          card({ id: 'rv2', invoiceNumber: 'INV-0240', sourceAt: '2026-09-27T00:00:00Z' }),
          card(),
        ],
      }));
      const offered = (id: string) => r.root.findAll(
        (n: any) => n.props?.onApprove && n.props?.review?.id === id, { deep: true },
      )[0].props.paysOff.map((m: any) => m.expected.id);
      expect(offered('rv1')).toEqual(['x1', 'x2']);
      expect(offered('rv2')).toEqual(['x2']);
    });
  });
});
