import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, flattenStyle } from '../test/render';
import ProjectsScreen from './ProjectsScreen';

/**
 * The Projects tab.
 *
 * Four things here can silently go wrong and each of them matters more than it
 * looks: a total rendered without its denominator, a finished project behaving
 * like a finished snag and leaving, the empty state inventing a project the way
 * the House tab invents a rangehood, and a compose bar arriving on a tab that
 * must never have one.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mock_navigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  // A fresh object per call spins any screen whose loader depends on it — the
  // same trap `start` has in AddThingSheet. One object, made once.
  useNavigation: () => (global as any).__nav,
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
}));
jest.mock('../components/AddProjectSheet', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'add sheet') };
});

const mock_getProjects = jest.fn();
const mock_createProject = jest.fn();
jest.mock('../lib/supabase', () => {
  const real = jest.requireActual('@snag/supabase-queries');
  return {
    getProjects: (...a: unknown[]) => mock_getProjects(...a),
    createProject: (...a: unknown[]) => mock_createProject(...a),
    // The pure helpers are the real ones: mocking `describeTotals` would mock
    // away the exact rule these specs exist to hold.
    describeTotals: real.describeTotals,
    formatMoney: real.formatMoney,
    outstanding: real.outstanding,
    projectSubtitle: real.projectSubtitle,
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
  itemCount: 0, pricedCount: 0, quotedCount: 0,
  committedTotal: null, invoicedTotal: null, paidTotal: null, allowanceOpen: 0,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
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

/** The card's own pressable, found by the label rather than by walking parents. */
function cardFor(r: ReturnType<typeof render>, name: string) {
  const found = r.root.findAll(
    (n) => typeof n.type === 'string' && n.props.accessibilityLabel === name,
    { deep: true }
  );
  if (found.length !== 1) throw new Error(`Expected one card for "${name}", found ${found.length}`);
  return found[0];
}

async function arrange(projects: any[]) {
  mock_getProjects.mockResolvedValue(projects);
  const r = render(<ProjectsScreen />);
  await TestRenderer.act(async () => {});
  return r;
}

describe('the tab', () => {
  it('groups by state, underway first and done last', async () => {
    const r = await arrange([
      project({ id: 'a', name: 'Heat pump install', status: 'done' }),
      project({ id: 'b', name: 'Back deck', status: 'planned' }),
      project({ id: 'c', name: 'Downstairs laundry', status: 'underway' }),
    ]);
    // Each word appears twice — once as the section heading, once on the card's
    // own status badge — so this asserts the order they first appear in, which
    // is the order the sections are drawn in.
    const seen: string[] = [];
    for (const node of r.getAllByType('Text')) {
      const text = node.children.join('');
      if (['Underway', 'Planned', 'Done'].includes(text) && !seen.includes(text)) seen.push(text);
    }
    expect(seen).toEqual(['Underway', 'Planned', 'Done']);
  });

  it('never shows a total without the line that says what it is of', async () => {
    const r = await arrange([
      project({ committedTotal: 8990, paidTotal: 3990, itemCount: 9, pricedCount: 5 }),
    ]);
    // Outstanding leads rather than paid: on a list of renovations the question
    // is what is still to find, and "$3,990 paid" of an $8,990 job reads as
    // nearly done.
    r.getByText('$8,990 committed · $5,000 still to pay');
    // The denominator is not decoration and not optional. Without it, $8,990
    // reads as the cost of the renovation rather than as the cost of five
    // ninths of it.
    r.getByText('5 of 9 items priced · 4 not priced');
  });

  it('says nothing about money when nobody has priced anything', async () => {
    const r = await arrange([project({ itemCount: 2 })]);
    expect(r.queryByText('$0')).toBeNull();
    r.getByText('0 of 2 items priced · 2 not priced');
  });

  it('dims a finished project rather than letting it leave', async () => {
    const r = await arrange([project({ id: 'a', name: 'Heat pump install', status: 'done' })]);
    // "Done leaves" is the *list's* rule, and the reward there is a shorter
    // list. A renovation is the opposite: the finished one is the record you
    // open in four years in front of a valuer.
    expect(flattenStyle(cardFor(r, 'Heat pump install').props.style).opacity).toBe(0.62);
  });

  it('leaves an underway project at full strength', async () => {
    const r = await arrange([project({ name: 'Downstairs laundry', status: 'underway' })]);
    expect(flattenStyle(cardFor(r, 'Downstairs laundry').props.style).opacity).toBeUndefined();
  });
});

describe('day one', () => {
  it('is genuinely empty — nothing here invents a project', async () => {
    const r = await arrange([]);
    r.getByText('Nothing on the go');
    // The House tab arrives furnished because a catalogue can guess a kitchen
    // has a rangehood. Nothing can guess a renovation, and a suggested one
    // would be a fabrication rather than a prompt.
    expect(r.queryByText('Bathroom renovation')).toBeNull();
    expect(r.queryByText('Kitchen renovation')).toBeNull();
  });

  it('names the second use, so the empty screen still answers something', async () => {
    const r = await arrange([]);
    const text = r.getAllByType('Text').map((n) => n.children.join('')).join(' ');
    expect(text).toContain('already finished');
  });
});

describe('what is deliberately absent', () => {
  it('has no compose bar — a project is started at a desk, not in a doorway', async () => {
    const r = await arrange([project()]);
    const text = r.getAllByType('Text').map((n) => n.children.join('')).join(' ');
    expect(text).not.toContain('Add a note');
    expect(
      r.root.findAll((n: any) => typeof n.type === 'string' && n.type === 'TextInput', { deep: true })
    ).toHaveLength(0);
  });

  it('has no filter rail over three rows', async () => {
    const r = await arrange([project()]);
    expect(r.queryByText('Show me')).toBeNull();
  });

  it('puts the export at the foot of the scrolled content, not on a bar', async () => {
    const r = await arrange([project()]);
    r.getByText('Export what’s been done');
  });
});
