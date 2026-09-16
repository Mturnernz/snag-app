import React from 'react';
import TestRenderer from 'react-test-renderer';
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
const mock_setQuoteChosen = jest.fn();
const mock_updateItem = jest.fn();
const mock_createElement = jest.fn();
const mock_deleteElement = jest.fn().mockResolvedValue([]);
jest.mock('../lib/supabase', () => {
  const real = jest.requireActual('@snag/supabase-queries');
  return {
    getProject: (...a: unknown[]) => mock_getProject(...a),
    getProjectContents: (...a: unknown[]) => mock_getProjectContents(...a),
    getProjectFiles: (...a: unknown[]) => mock_getProjectFiles(...a),
    getSnags: (...a: unknown[]) => mock_getSnags(...a),
    setQuoteChosen: (...a: unknown[]) => mock_setQuoteChosen(...a),
    updateItem: (...a: unknown[]) => mock_updateItem(...a),
    createElement: (...a: unknown[]) => mock_createElement(...a),
    createItem: jest.fn(), createQuote: jest.fn(), createThing: jest.fn(),
    createLocation: jest.fn(),
    deleteElement: (...a: unknown[]) => mock_deleteElement(...a),
    deleteItem: jest.fn(), deleteProject: jest.fn(), deleteQuote: jest.fn(),
    deleteStoredFiles: jest.fn(), updateElement: jest.fn(), updateProject: jest.fn(),
    updateQuote: jest.fn(), getFileUrls: jest.fn().mockResolvedValue({}),
    // The pure ones are real: mocking `describeTotals` would mock away the rule.
    describeTotals: real.describeTotals,
    formatMoney: real.formatMoney,
    rangeLabel: real.rangeLabel,
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
  chosenTotal: null, rangeLow: null, rangeHigh: null, spentTotal: null, ...over,
});
const project = (over: any = {}): any => ({
  id: 'p1', householdId: 'h', propertyId: 'prop', name: 'Downstairs laundry',
  summary: null, status: 'underway', startedOn: null, targetOn: null, finishedOn: null,
  budget: null, budgetInclGst: true, photoPaths: [], documentPaths: [],
  createdBy: 'me', createdAt: '2026-08-04T00:00:00Z', updatedAt: '2026-08-04T00:00:00Z',
  propertyName: 'Home', createdByName: 'Kate',
  elementCount: 1, shownElementCount: 0, fileCount: 0,
  snagCount: 0, openSnagCount: 0, thingCount: 0, ...totals(), ...over,
});
const element = (over: any = {}): any => ({
  id: 'e1', projectId: 'p1', name: 'Downstairs laundry', room: null, implicit: true,
  sortOrder: 0, notes: null, photoPaths: [], documentPaths: [],
  createdAt: '2026-08-04T00:00:00Z', ...totals(), ...over,
});
const item = (over: any = {}): any => ({
  id: 'i1', elementId: 'e1', name: 'Toilet suite', status: 'considering', sortOrder: 0,
  notes: null, photoPaths: [], documentPaths: [], createdAt: '2026-08-04T00:00:00Z',
  quoteCount: 0, chosenAmount: null, quotedLow: null, quotedHigh: null, spent: null, ...over,
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
  project?: any; elements?: any[]; items?: any[]; quotes?: any[]; files?: any[]; snags?: any[];
} = {}) {
  mock_getProject.mockResolvedValue(opts.project ?? project());
  mock_getProjectContents.mockResolvedValue({
    elements: opts.elements ?? [element()],
    items: opts.items ?? [],
    quotes: opts.quotes ?? [],
  });
  mock_getProjectFiles.mockResolvedValue(opts.files ?? []);
  mock_getSnags.mockResolvedValue(opts.snags ?? []);
  const r = render(<ProjectDetailScreen route={{ params: { projectId: 'p1' } } as any} navigation={{} as any} />);
  await TestRenderer.act(async () => {});
  return r;
}

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
  it('shows three figures rather than one total', async () => {
    const r = await arrange({
      project: project({ chosenTotal: 8990, spentTotal: 3990, rangeLow: 9380, rangeHigh: 9380,
        itemCount: 9, pricedCount: 5 }),
    });
    r.getByText('Quoted');
    r.getByText('Chosen');
    r.getByText('Spent');
    r.getByText('$8,990');
    r.getByText('$3,990');
  });

  it('carries the denominator under them, always', async () => {
    const r = await arrange({
      project: project({ chosenTotal: 8990, itemCount: 9, pricedCount: 5, quotedCount: 1 }),
    });
    r.getByText('5 of 9 items priced · 1 quoted, not chosen · 3 not priced');
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
    r.getByText('Quoted');
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

  it('shows no × while the layer is still implicit', async () => {
    // One implicit element is a project with no parts drawn at all, so there is
    // nothing to remove and a × would be a control for a concept not on screen.
    const r = await arrange({ elements: [element({ implicit: true })] });
    expect(byLabel(r, 'Remove Downstairs laundry from this job')).toBeUndefined();
  });
});
