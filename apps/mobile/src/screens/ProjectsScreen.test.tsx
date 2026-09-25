import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, flattenStyle } from '../test/render';
import ProjectsScreen from './ProjectsScreen';
import { Colors } from '../constants/theme';

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
const mock_getExpectedTotal = jest.fn();
jest.mock('../lib/supabase', () => {
  const real = jest.requireActual('@snag/supabase-queries');
  return {
    getProjects: (...a: unknown[]) => mock_getProjects(...a),
    getProjectsQuoted: (...a: unknown[]) => mock_getProjectsQuoted(...a),
    getExpectedTotal: (...a: unknown[]) => mock_getExpectedTotal(...a),
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
  mock_getExpectedTotal.mockRejectedValue(new Error('not asked for'));
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

async function arrange(
  projects: any[],
  quoted: Record<string, number> = {},
  expected: Record<string, number> = {},
) {
  mock_getProjects.mockResolvedValue(projects);
  mock_getProjectsQuoted.mockResolvedValue(new Map(Object.entries(quoted)));
  mock_getExpectedTotal.mockImplementation(async (id: string) => {
    if (!(id in expected)) throw new Error('offline');
    return expected[id];
  });
  const r = render(<ProjectsScreen />);
  await TestRenderer.act(async () => {});
  return r;
}

describe('the tab', () => {
  it('groups by state, underway first and complete last', async () => {
    const r = await arrange([
      project({ id: 'a', name: 'Heat pump install', status: 'done' }),
      project({ id: 'b', name: 'Back deck', status: 'planned' }),
      project({ id: 'c', name: 'Downstairs laundry', status: 'underway' }),
    ]);
    const seen: string[] = [];
    for (const node of r.getAllByType('Text')) {
      const text = node.children.join('');
      if (['Underway', 'Planned', 'Complete'].includes(text) && !seen.includes(text)) seen.push(text);
    }
    // The enum is still `done`; the word on the tab is Complete.
    expect(seen).toEqual(['Underway', 'Planned', 'Complete']);
    expect(r.queryByText('Done')).toBeNull();
    r.getByText('1 underway · 1 planned · 1 complete');
  });

  it('shows what was budgeted, what has been quoted and what has been paid', async () => {
    const r = await arrange(
      [project({ id: 'p1', budget: 230000, paidTotal: 50000 })],
      { p1: 210000 },
    );
    r.getByText('Budgeted');
    r.getByText('$230,000');
    r.getByText('Quoted');
    r.getByText('$210,000');
    r.getByText('Paid');
    r.getByText('$50,000');
    expect(mock_getProjectsQuoted).toHaveBeenCalledWith(['p1']);
  });

  it('grosses an ex-GST budget before showing it', async () => {
    const r = await arrange([project({ budget: 100000, budgetInclGst: false })]);
    r.getByText('$115,000');
  });

  it('says what nobody has in words, never as $0', async () => {
    const r = await arrange([project({ id: 'p1' })]);
    r.getByText('Not set');
    r.getByText('No quotes');
    r.getByText('Nothing yet');
    expect(r.queryByText('$0')).toBeNull();
  });

  it('never claims nobody has quoted when the quoted read has not answered', async () => {
    mock_getProjects.mockResolvedValue([project({ name: 'Downstairs laundry' })]);
    mock_getProjectsQuoted.mockRejectedValue(new Error('offline'));
    const r = render(<ProjectsScreen />);
    await TestRenderer.act(async () => {});
    cardFor(r, 'Downstairs laundry');
    expect(r.queryByText('No quotes')).toBeNull();
    r.getByText('—');
  });

  it('never shows a figure without saying what is still undecided', async () => {
    // The denominator rule: $8,990 paid on a job with four things nobody has
    // chosen is not the cost of the job, and the card says so in the same breath.
    const r = await arrange([
      project({ paidTotal: 8990, itemCount: 9, pricedCount: 5, dueToPay: 5000 }),
    ]);
    r.getByText('$8,990');
    r.getByText('4 to decide   ·   $5,000 to pay');
  });

  it('says nothing about money it has not got', async () => {
    const r = await arrange([project({ itemCount: 2 })]);
    r.getByText('2 to decide');
    const text = r.getAllByType('Text').map((n) => n.children.join('')).join(' ');
    expect(text).not.toContain('to pay');
    expect(text).not.toContain('Budget remaining');
  });
});

describe('budget remaining', () => {
  const textOf = (r: ReturnType<typeof render>) => r.getAllByType('Text').map((n) => n.children.join('')).join(' ');
  const colourOf = (r: ReturnType<typeof render>, text: string) => flattenStyle(r.getByText(text).props.style).color;

  it('is absent until something has been paid, and asks for nothing', async () => {
    const r = await arrange([project({ budget: 100000, paidTotal: null })]);
    expect(r.queryByText('Budget remaining')).toBeNull();
    expect(r.queryByText('Expected total')).toBeNull();
    expect(mock_getExpectedTotal).not.toHaveBeenCalled();
  });

  it('is absent without a budget, whatever has been paid', async () => {
    const r = await arrange([project({ budget: null, paidTotal: 40000 })]);
    expect(r.queryByText('Budget remaining')).toBeNull();
    expect(r.queryByText('Over budget')).toBeNull();
    expect(mock_getExpectedTotal).not.toHaveBeenCalled();
  });

  it('counts what is expected, not only what is paid — two claims earmarked put a job over', async () => {
    // The live job: paid alone left $68,101.19 of $180,000, and the card said
    // so while its own page said $54,230.18 over.
    const r = await arrange(
      [project({ budget: 180000, paidTotal: 111898.81, invoicedTotal: 146255.18 })],
      {},
      { p1: 234230.18 },
    );
    expect(mock_getExpectedTotal).toHaveBeenCalledWith('p1');
    r.getByText('Expected total');
    r.getByText('$234,230.18');
    r.getByText('Over budget');
    expect(r.queryByText('Budget remaining')).toBeNull();
    expect(colourOf(r, '$54,230.18')).toBe(Colors.danger);
    r.getByText('30% over · $87,975 not billed yet');
    expect(textOf(r)).not.toContain('68,101');
  });

  it('never cuts the figure short: it stands alone, the percentage beneath it', async () => {
    const r = await arrange([project({ budget: 180000, paidTotal: 111898.81, invoicedTotal: 180000 - 68101.19 })], {}, { p1: 180000 - 68101.19 });
    const figure = r.getByText('$68,101.19');
    expect(figure.props.numberOfLines).toBe(1);
    expect(flattenStyle(figure.props.style).flexShrink).toBe(0);
    r.getByText('38% left');
  });

  it('is in fern while more than 15% is left', async () => {
    const r = await arrange([project({ budget: 100000, paidTotal: 50000, invoicedTotal: 84000 })], {}, { p1: 84000 });
    r.getByText('Budget remaining');
    expect(colourOf(r, '$16,000')).toBe(Colors.primary);
    r.getByText('16% left');
  });

  it('turns brass at 15% left, and stays brass down to just over 5%', async () => {
    const at15 = await arrange([project({ budget: 100000, paidTotal: 50000, invoicedTotal: 85000 })], {}, { p1: 85000 });
    expect(colourOf(at15, '$15,000')).toBe(Colors.status.doing);
    at15.unmount();
    const at6 = await arrange([project({ budget: 100000, paidTotal: 50000, invoicedTotal: 94000 })], {}, { p1: 94000 });
    expect(colourOf(at6, '$6,000')).toBe(Colors.status.doing);
  });

  it('turns clay at 5% left', async () => {
    const r = await arrange([project({ budget: 100000, paidTotal: 50000, invoicedTotal: 95000 })], {}, { p1: 95000 });
    expect(colourOf(r, '$5,000')).toBe(Colors.danger);
  });

  it('measures against the budget grossed up when it was typed ex GST', async () => {
    // $100,000 + GST is $115,000; $100,000 expected leaves $15,000, 13% — brass.
    const r = await arrange(
      [project({ budget: 100000, budgetInclGst: false, paidTotal: 50000, invoicedTotal: 100000 })],
      {},
      { p1: 100000 },
    );
    expect(colourOf(r, '$15,000')).toBe(Colors.status.doing);
    r.getByText('14% left');
  });

  it('says — until the page’s figure arrives, never budget less paid in the meantime', async () => {
    mock_getProjects.mockResolvedValue([project({ budget: 180000, paidTotal: 111898.81 })]);
    mock_getExpectedTotal.mockReturnValue(new Promise(() => {}));
    const r = render(<ProjectsScreen />);
    await TestRenderer.act(async () => {});
    r.getByText('Budget remaining');
    expect(r.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(textOf(r)).not.toContain('68,101');
    expect(r.queryByText('Over budget')).toBeNull();
  });

  it('says — when the page could not be read, and the card still draws', async () => {
    const r = await arrange([project({ budget: 180000, paidTotal: 111898.81 })]);
    r.getByText('Downstairs laundry');
    r.getByText('$111,898.81');
    expect(textOf(r)).not.toContain('68,101');
    expect(r.queryByText('Over budget')).toBeNull();
  });

  it('reads one page at a time, never all at once', async () => {
    let answer!: (n: number) => void;
    mock_getProjects.mockResolvedValue([
      project({ id: 'a', name: 'Bathroom', budget: 30000, paidTotal: 1000 }),
      project({ id: 'b', name: 'Deck', budget: 20000, paidTotal: 1000 }),
      project({ id: 'c', name: 'Shed', budget: 5000, paidTotal: null }),
    ]);
    mock_getExpectedTotal.mockImplementation(() => new Promise<number>((resolve) => { answer = resolve; }));
    render(<ProjectsScreen />);
    await TestRenderer.act(async () => {});
    expect(mock_getExpectedTotal).toHaveBeenCalledTimes(1);
    await TestRenderer.act(async () => { answer(12000); });
    expect(mock_getExpectedTotal).toHaveBeenCalledTimes(2);
    await TestRenderer.act(async () => { answer(9000); });
    // Nothing paid on the shed: it never asks.
    expect(mock_getExpectedTotal.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
  });

  it('is on a complete project too, dimmed with the rest of the card', async () => {
    const r = await arrange(
      [project({ id: 'k', name: 'Kitchen', status: 'done', budget: 62000, paidTotal: 58300, invoicedTotal: 58300, finishedOn: '2024-11-20' })],
      {},
      { k: 58300 },
    );
    r.getByText('Budget remaining');
    expect(r.getAllByText('$58,300')).toHaveLength(2);
    expect(flattenStyle(cardFor(r, 'Kitchen').props.style).opacity).toBe(0.62);
  });
});

describe('the tab, still', () => {
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
