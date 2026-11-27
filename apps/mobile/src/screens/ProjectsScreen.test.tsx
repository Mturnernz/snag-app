import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, flattenStyle } from '../test/render';
import ProjectsScreen from './ProjectsScreen';
import { Colors } from '../constants/theme';

/**
 * The Projects tab, as Alyssa's wireframe has it (November 2026): total spend
 * on the property, then In progress, Completed and Planned, each card in its
 * own shape, from one read of every price.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mock_navigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  // A fresh object per call spins any screen whose loader depends on it — the
  // same trap `start` has in AddThingSheet. One object, made once.
  useNavigation: () => (global as any).__nav,
  // Focus is the mount, and `leave()` / `comeBack()` below are the screen being
  // covered by a project and uncovered again.
  useFocusEffect: (cb: () => (() => void) | void) =>
    require('react').useEffect(() => {
      (global as any).__focus = cb;
      const off = cb();
      (global as any).__blur = off;
      return off;
    }, [cb]),
}));

/** Another screen covers the list: its focus cleanup runs. */
async function leave() {
  await TestRenderer.act(async () => {
    (global as any).__blur?.();
  });
}

/** The list is shown again: its focus effect runs afresh. */
async function comeBack() {
  await TestRenderer.act(async () => {
    (global as any).__blur = (global as any).__focus();
  });
}
jest.mock('../components/AddProjectSheet', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'add sheet') };
});

const mock_getProjects = jest.fn();
const mock_createProject = jest.fn();
const mock_getProjectPrices = jest.fn();
jest.mock('../lib/supabase', () => {
  const real = jest.requireActual('@snag/supabase-queries');
  return {
    getProjects: (...a: unknown[]) => mock_getProjects(...a),
    getProjectPrices: (...a: unknown[]) => mock_getProjectPrices(...a),
    createProject: (...a: unknown[]) => mock_createProject(...a),
    // The pure helpers are the real ones: mocking `describeTotals` would mock
    // away the exact rule these specs exist to hold.
    createLocation: jest.fn(),
    formatMoney: real.formatMoney,
    inclGst: real.inclGst,
  };
});
jest.mock('../lib/exportFile', () => ({
  writeExport: jest.fn().mockResolvedValue({ fileName: 'projects.csv', path: null }),
  loadExportImages: async () => [],
}));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => (global as any).__household }));

const project = (over: Partial<any> = {}): any => ({
  id: 'p1', householdId: 'h', propertyId: 'prop', name: 'Downstairs laundry',
  summary: null, status: 'underway',
  startedOn: null, targetOn: null, finishedOn: null,
  budget: null, budgetInclGst: true, photoPaths: [], documentPaths: [],
  createdBy: 'me', createdAt: '2026-08-04T00:00:00Z', updatedAt: '2026-08-04T00:00:00Z',
  propertyName: 'Home', createdByName: 'Kate',
  elementCount: 1, shownElementCount: 0, fileCount: 0,
  snagCount: 0, openSnagCount: 0, thingCount: 0, installedCount: 0,
  partsBudgetTotal: null, partsBudgetedCount: 0,
  forecastTotal: null, forecastGuess: 0, expectedOpen: 0, expectedCount: 0, budgetGap: 0,
  stillToBill: null, dueToPay: 0, overdueTotal: 0, nextDueOn: null, dueCount: 0,
  additionalOpen: 0,
  itemCount: 0, pricedCount: 0, quotedCount: 0,
  committedTotal: null, invoicedTotal: null, paidTotal: null, allowanceOpen: 0,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mock_getProjectPrices.mockResolvedValue(new Map());
  (global as any).__nav = { navigate: mock_navigate, addListener: () => () => {} };
  (global as any).__household = {
    household: { id: 'h', name: 'Home', createdAt: '2026-01-01T00:00:00Z' },
    profile: { id: 'me', displayName: 'Me' },
    members: [],
    properties: [{ id: 'prop', householdId: 'h', name: 'Home' }],
    activeProperty: { id: 'prop', householdId: 'h', name: 'Home' },
    setActiveProperty: jest.fn(),
    locations: [{ id: 'l1', propertyId: 'prop', name: 'Bathroom', sortOrder: 1 }],
    reloadLocations: jest.fn(),
    refresh: jest.fn(),
    reloadAccount: jest.fn(),
  };
});

const price = (over: any): any => ({
  id: over.id ?? Math.random().toString(36), itemId: null, elementId: null, projectId: 'p1', supplier: 'ReliaBuilder',
  detail: null, amount: over.amountIncl, amountInclGst: true, kind: 'invoice', status: 'tbc', basis: 'fixed',
  dated: null, notes: null, supersedesLineId: null, dueOn: null, billedThroughId: null, settlesMilestoneId: null,
  againstQuoteId: null, invoiceNumber: null, photoPaths: [], documentPaths: [], createdAt: '2026-04-01T00:00:00Z',
  createdBy: null, amountIncl: null, lineCount: 0, linesTotal: null, buildUp: null, allowanceOpen: 0,
  additionalOpen: 0, effectiveAmount: null, paidTotal: null, unpaid: over.unpaid ?? (over.kind === 'quote' ? null : over.amountIncl),
  claimedTotal: null, ...over,
});

/** The card's own pressable, found by the label rather than by walking parents. */
function cardFor(r: ReturnType<typeof render>, name: string) {
  const found = r.root.findAll(
    (n) => typeof n.type === 'string' && n.props.accessibilityLabel === name,
    { deep: true }
  );
  if (found.length !== 1) throw new Error(`Expected one card for "${name}", found ${found.length}`);
  return found[0];
}

const texts = (node: any): string[] =>
  node.findAll((n: any) => n.type === 'Text', { deep: true }).map((n: any) => n.children.join(''));

async function arrange(projects: any[], prices: Record<string, any[]> = {}) {
  mock_getProjects.mockResolvedValue(projects);
  mock_getProjectPrices.mockResolvedValue(new Map(projects.map((p) => [p.id, prices[p.id] ?? []])));
  const r = render(<ProjectsScreen />);
  await TestRenderer.act(async () => {});
  return r;
}

describe('the tab', () => {
  it('groups In progress, then Completed, then Planned', async () => {
    const r = await arrange([
      project({ id: 'a', name: 'Curtains', status: 'done' }),
      project({ id: 'b', name: 'Tree trimming', status: 'planned' }),
      project({ id: 'c', name: 'Downstairs', status: 'underway' }),
    ]);
    const seen = r.getAllByType('Text').map((n) => n.children.join(''))
      .filter((t) => ['In progress', 'Completed', 'Planned'].includes(t));
    expect(seen).toEqual(['In progress', 'Completed', 'Planned']);
  });

  it('reads every price in one request', async () => {
    await arrange([project({ id: 'a' }), project({ id: 'b', name: 'Roof' })]);
    expect(mock_getProjectPrices).toHaveBeenCalledTimes(1);
    expect(mock_getProjectPrices).toHaveBeenCalledWith(['a', 'b']);
  });

  it('heads the list with what has been spent across the property', async () => {
    const r = await arrange(
      [project({ id: 'a', name: 'Curtains', status: 'done' }), project({ id: 'b', name: 'Downstairs' })],
      {
        a: [price({ supplier: 'Curtain Co', amountIncl: 2000, unpaid: 0 })],
        b: [price({ amountIncl: 1000, unpaid: 400 })],
      },
    );
    r.getByText('Total spent on the property');
    r.getByText('$2,600');
  });

  it('an in-progress card: budget, paid, outstanding and the difference', async () => {
    const r = await arrange([project({ id: 'p1', name: 'Downstairs', budget: 200000 })], {
      p1: [
        price({ kind: 'quote', status: 'accepted', amountIncl: 155480 }),
        price({ amountIncl: 43987.5, unpaid: 0 }),
        price({ amountIncl: 22913.75, unpaid: 22913.75 }),
        price({ supplier: 'Gibson Architects', amountIncl: 2650.75, unpaid: 0 }),
      ],
    });
    const card = texts(cardFor(r, 'Downstairs'));
    expect(card).toEqual(expect.arrayContaining(['Budget', '$200,000', 'Paid', '$46,638.25', 'Outstanding', '$22,913.75', 'Difference']));
    // 200,000 − (155,480 accepted + 2,650.75 architect)
    expect(card).toContain('$41,869.25 under');
    expect(card).not.toContain('Expected total');
  });

  it('hides Outstanding when nothing is owed, and says over budget in clay', async () => {
    const r = await arrange([project({ id: 'p1', name: 'Bathroom', budget: 1000 })], {
      p1: [price({ amountIncl: 1200, unpaid: 0 })],
    });
    const card = texts(cardFor(r, 'Bathroom'));
    expect(card).not.toContain('Outstanding');
    const over = r.getByText('$200 over');
    expect(flattenStyle(over.props.style).color).toBe(Colors.danger);
  });

  it('a completed card says what it cost and nothing else', async () => {
    const r = await arrange([project({ id: 'p1', name: 'Curtains', status: 'done', budget: 5000 })], {
      p1: [price({ amountIncl: 3200, unpaid: 0 })],
    });
    expect(texts(cardFor(r, 'Curtains'))).toEqual(['Curtains', 'Cost', '$3,200']);
  });

  it('a planned card: budget and the quotes as a range', async () => {
    const r = await arrange([project({ id: 'p1', name: 'Tree trimming', status: 'planned', budget: 1000 })], {
      p1: [
        price({ kind: 'quote', amountIncl: 850 }),
        price({ kind: 'quote', amountIncl: 1400, supplier: 'Arborist' }),
        price({ kind: 'quote', amountIncl: 1100, supplier: 'Tree Co' }),
      ],
    });
    expect(texts(cardFor(r, 'Tree trimming'))).toEqual(
      ['Tree trimming', 'Budget', '$1,000', 'Quoted', '3 quotes · $850–$1,400'],
    );
  });

  it('says No quotes yet on a planned card with none, and — while prices cannot be read', async () => {
    let r = await arrange([project({ id: 'p1', name: 'Fence', status: 'planned' })]);
    expect(texts(cardFor(r, 'Fence'))).toContain('No quotes yet');
    r.unmount?.();
    mock_getProjects.mockResolvedValue([project({ id: 'p1', name: 'Fence', status: 'planned' })]);
    mock_getProjectPrices.mockRejectedValue(new Error('offline'));
    r = render(<ProjectsScreen />);
    await TestRenderer.act(async () => {});
    expect(texts(cardFor(r, 'Fence'))).toContain('—');
  });

  it('opens a project on a press', async () => {
    const r = await arrange([project({ id: 'p1', name: 'Downstairs' })]);
    await TestRenderer.act(async () => cardFor(r, 'Downstairs').props.onClick?.() ?? cardFor(r, 'Downstairs').props.onPress?.());
    expect(mock_navigate).toHaveBeenCalledWith('ProjectDetail', { projectId: 'p1' });
  });

  it('reads again when it comes back into view', async () => {
    await arrange([project({ id: 'p1' })]);
    await leave();
    await comeBack();
    expect(mock_getProjectPrices).toHaveBeenCalledTimes(2);
  });

  it('invents nothing on day one', async () => {
    const r = await arrange([]);
    r.getByText('Nothing on the go');
    expect(r.queryByText('Total spent on the property')).toBeNull();
    expect(mock_getProjectPrices).toHaveBeenCalledWith([]);
  });
});
