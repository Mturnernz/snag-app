import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, flattenStyle, type RenderResult } from '../test/render';
import { Colors } from '../constants/theme';
import ScheduleScreen from './ScheduleScreen';

// The tab is a read of the list, and two rules keep it honest on screen.
//
// **A projected occasion is drawn hollow.** A repeating job has one `due_at`;
// everything after it is arithmetic off `repeat_days` and no row exists for any
// of it. Drawn the same as a real date, the tab would be claiming the household
// has committed to dates nothing has written — the calendar's version of the
// House tab's ghosts, and the same answer: if the distinction blurs, the
// projection goes rather than the distinction.
//
// **Paging a month does not leave a day from another one selected.** A heading
// reading "Saturday 5 September" over a grid of November is the screen
// contradicting itself, and it is also the wrong answer to the question paging
// forward asks.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), addListener: () => () => {} }),
}));

const mock_getSnags = jest.fn();
jest.mock('../lib/supabase', () => ({ getSnags: (...a: unknown[]) => mock_getSnags(...a) }));
jest.mock('../hooks/useHousehold', () => ({
  useHousehold: () => (global as any).__household,
}));

/** One place by default; `places(2)` puts a bach beside the house. */
function places(count: number) {
  const all = [
    { id: 'p', householdId: 'h', name: 'Home' },
    { id: 'b', householdId: 'h', name: 'The bach' },
  ].slice(0, count);
  (global as any).__household = {
    household: { id: 'h', name: 'Home', createdAt: '' },
    properties: all,
    activeProperty: all[0],
    setActiveProperty: jest.fn(),
  };
}

/** Fixed, so "this month" is a month whose contents these tests decide. */
const NOW = new Date(2026, 8, 14, 9, 0);

const snag = (over: Partial<any> = {}): any => ({
  id: 's1', reference: 'S-100', householdId: 'h', propertyId: 'p',
  room: 'Roof', photoPaths: [], description: 'Gutters', priority: null,
  status: 'open', parts: [], needsParts: false,
  dueAt: null, repeatDays: null, assigneeId: null, thingId: null,
  reporterId: 'me', createdAt: '2026-09-02T03:00:00Z', updatedAt: '2026-09-02T03:00:00Z',
  lastDoneAt: null, doneAt: null,
  propertyName: 'Home', reporterName: 'Matt', assigneeName: null, commentCount: 0,
  thingName: null, thingMake: null, thingModel: null,
  projectId: null, projectName: null,
  ...over,
});

const textOf = (node: any): string =>
  (node.children ?? []).map((c: any) => (typeof c === 'string' ? c : textOf(c))).join('');

const texts = (r: RenderResult) => r.getAllByType('Text').map(textOf);

const byLabel = (r: RenderResult, label: string) =>
  r.root.findAll(
    (n) => typeof n.type !== 'string' && !!n.props?.onPress && n.props?.accessibilityLabel === label,
    { deep: true }
  )[0];

/** Every dot drawn inside the month grid, as flattened styles. */
const dots = (r: RenderResult) =>
  r.getAllByType('View')
    .map((n) => flattenStyle(n.props.style))
    .filter((s) => s.width === 5 && s.height === 5);

async function open(rows: any[]) {
  mock_getSnags.mockResolvedValue(rows);
  let result!: RenderResult;
  await TestRenderer.act(async () => { result = render(<ScheduleScreen />); });
  await TestRenderer.act(async () => {});
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  places(1);
  jest.useFakeTimers({ doNotFake: ['nextTick'] }).setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ScheduleScreen', () => {
  it('narrows by nothing at all — not the status, not the place', async () => {
    // A calendar of only the open ones is missing exactly the half somebody
    // came to check. And a date does not belong to a house: reading one
    // property would answer "is anything landing that weekend" for whichever
    // place the House tab happened to be showing, which is not the question.
    // An empty filter is every property `property_members` lets you read.
    places(2);
    await open([]);

    expect(mock_getSnags).toHaveBeenCalledWith({}, 'newest');
    expect(mock_getSnags.mock.calls[0][0].propertyId).toBeUndefined();
    expect(mock_getSnags.mock.calls[0][0].status).toBeUndefined();
  });

  it('says which house a row is at, but only when there is a choice', async () => {
    // Filed today, so it lists under Today without having to page anywhere.
    const bachRow = () => snag({
      id: 'b1', propertyName: 'The bach', room: 'Roof',
      createdAt: '2026-09-13T21:00:00Z',
    });

    places(2);
    const both = await open([bachRow()]);
    const meta = texts(both).filter((t) => t.includes(' · '));
    expect(meta.some((t) => t.includes('The bach') && t.includes('Roof'))).toBe(true);

    // One house, and naming it on every row is noise about a fact that cannot
    // vary — "Roof" is unambiguous when there is only one roof.
    places(1);
    const alone = await open([snag({ id: 'b1', propertyName: 'Home', room: 'Roof', createdAt: '2026-09-13T21:00:00Z' })]);
    const soloMeta = texts(alone).filter((t) => t.includes(' · '));
    expect(soloMeta.some((t) => t.includes('Roof'))).toBe(true);
    expect(soloMeta.some((t) => t.includes('Home'))).toBe(false);
  });

  it('draws a real due date filled and a projected one hollow', async () => {
    // Both land in September 2026: the due date on the 18th, and the next
    // occasion a fortnight later on the 2nd of October, which is inside the
    // six-week grid.
    const result = await open([
      snag({ id: 'r', dueAt: '2026-09-18T03:00:00Z', repeatDays: 14 }),
    ]);

    const drawn = dots(result);
    // Filled: the date somebody actually set.
    expect(drawn.some((d) => d.backgroundColor === Colors.due.soonFg)).toBe(true);
    // Hollow: the arithmetic. Same hue, no fill.
    expect(
      drawn.some((d) => d.borderColor === Colors.due.soonFg && d.backgroundColor === undefined)
    ).toBe(true);
  });

  it('calls a projected occasion something other than due', async () => {
    const result = await open([
      snag({ id: 'r', dueAt: '2026-09-18T03:00:00Z', repeatDays: 14 }),
    ]);
    // The whole month is listed until a day is tapped.
    await TestRenderer.act(async () => { byLabel(result, 'The month after').props.onPress(); });

    // The meta line on the row, not the legend — which of course names every
    // kind, including the one this snag hasn't got a real date for.
    const meta = texts(result).filter((t) => t.includes(' · '));
    expect(meta.some((t) => t.includes('· Comes round ·'))).toBe(true);
    expect(meta.some((t) => t.includes('· Due ·'))).toBe(false);
  });

  it('gives an overdue date the one colour a household list has earned', async () => {
    const result = await open([snag({ id: 'o', dueAt: '2026-09-03T03:00:00Z' })]);
    expect(dots(result).some((d) => d.backgroundColor === Colors.due.overdueFg)).toBe(true);
  });

  it('does not leave a day from another month selected when you page', async () => {
    const result = await open([snag({ id: 'a' })]);
    expect(texts(result)).toContain('Today');

    await TestRenderer.act(async () => { byLabel(result, 'The month after').props.onPress(); });
    const all = texts(result);
    expect(all).toContain('October 2026');
    // The heading follows the grid: the whole month, not a day in the one
    // before it. ("Today" still appears — it is the button back to it.)
    expect(all).toContain('All of October');
    expect(all.some((t) => t.includes('September'))).toBe(false);
  });

  it('opens on today, and the way back is offered only once you have left', async () => {
    const result = await open([snag({ id: 'a' })]);
    expect(byLabel(result, 'Back to this month')).toBeUndefined();

    await TestRenderer.act(async () => { byLabel(result, 'The month after').props.onPress(); });
    expect(byLabel(result, 'Back to this month')).toBeTruthy();

    await TestRenderer.act(async () => { byLabel(result, 'Back to this month').props.onPress(); });
    expect(texts(result)).toContain('September 2026');
    expect(texts(result)).toContain('Today');
  });
});
