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
const mock_getProjectsQuoted = jest.fn();
jest.mock('../lib/supabase', () => {
  const real = jest.requireActual('@snag/supabase-queries');
  return {
    getProjects: (...a: unknown[]) => mock_getProjects(...a),
    getProjectsQuoted: (...a: unknown[]) => mock_getProjectsQuoted(...a),
    createProject: (...a: unknown[]) => mock_createProject(...a),
    // The pure helpers are the real ones: mocking `describeTotals` would mock
    // away the exact rule these specs exist to hold.
    createLocation: jest.fn(),
    formatMoney: real.formatMoney,
    inclGst: real.inclGst,
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
  forecastTotal: null, forecastGuess: 0, expectedOpen: 0, expectedCount: 0, budgetGap: 0,
  stillToBill: null, dueToPay: 0, overdueTotal: 0, nextDueOn: null, dueCount: 0,
  additionalOpen: 0,
  itemCount: 0, pricedCount: 0, quotedCount: 0,
  committedTotal: null, invoicedTotal: null, paidTotal: null, allowanceOpen: 0,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mock_getProjectsQuoted.mockResolvedValue(new Map());
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

/** Every line on screen reading "… quoted". */
function quotedLines(r: ReturnType<typeof render>) {
  return r
    .getAllByType('Text')
    .map((n) => n.children.join(''))
    .filter((t) => t.endsWith(' quoted'));
}

async function arrange(projects: any[], quoted: Record<string, number> = {}) {
  mock_getProjects.mockResolvedValue(projects);
  mock_getProjectsQuoted.mockResolvedValue(new Map(Object.entries(quoted)));
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

  it('leads with what has been agreed, against the budget', async () => {
    // Agreed is committed with the builder's open set-aside amounts taken out —
    // the same figure the project page puts beside Undecided, so the list and
    // the page cannot disagree.
    const r = await arrange([
      project({ committedTotal: 208320, allowanceOpen: 12000, budget: 230000 }),
    ]);
    r.getByText('$196,320');
    r.getByText('agreed of $230,000');
  });

  it('says what has been quoted when it differs from what is agreed', async () => {
    // The Tree trimming case: one unagreed quote, nothing signed. Agreed is
    // honestly $0, and the card said nothing else — as though no price had
    // arrived.
    const r = await arrange(
      [project({ id: 'trees', name: 'Tree trimming', status: 'planned', budget: 1000 })],
      { trees: 1092.5 }
    );
    r.getByText('$0');
    r.getByText('$1,092.50 quoted');
    expect(mock_getProjectsQuoted).toHaveBeenCalledWith(['trees']);
  });

  it('does not repeat Agreed as Quoted, and says nothing where nobody has quoted', async () => {
    const r = await arrange(
      [
        project({ id: 'signed', name: 'Signed job', committedTotal: 5000 }),
        project({ id: 'none', name: 'Unquoted job' }),
      ],
      { signed: 5000 }
    );
    expect(quotedLines(r)).toEqual([]);
  });

  it('still draws the cards when the quoted read fails', async () => {
    mock_getProjects.mockResolvedValue([project({ name: 'Downstairs laundry' })]);
    mock_getProjectsQuoted.mockRejectedValue(new Error('offline'));
    const r = render(<ProjectsScreen />);
    await TestRenderer.act(async () => {});
    cardFor(r, 'Downstairs laundry');
    expect(quotedLines(r)).toEqual([]);
  });

  it('never shows a figure without saying what is still undecided', async () => {
    // The denominator rule, in V2 words: $8,990 agreed on a job with four
    // things nobody has chosen is not the cost of the job, and the card says so
    // in the same breath.
    const r = await arrange([
      project({ committedTotal: 8990, itemCount: 9, pricedCount: 5, dueToPay: 5000 }),
    ]);
    r.getByText('$8,990');
    r.getByText('4 to decide   ·   $5,000 to pay');
  });

  it('says nothing about money it has not got', async () => {
    const r = await arrange([project({ itemCount: 2 })]);
    r.getByText('2 to decide');
    const text = r.getAllByType('Text').map((n) => n.children.join('')).join(' ');
    expect(text).not.toContain('to pay');
    expect(text).not.toContain('agreed of $');
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
