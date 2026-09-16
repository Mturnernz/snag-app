import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import SnagDetailScreen from './SnagDetailScreen';

// Finishing something is the one moment this app says well done, and the whole
// risk is saying it about a job that is still on the list: a repeating snag
// never reaches 'done' — `set_snag_status` rolls `due_at` forward and leaves it
// open — so the two outcomes have to stay told apart at the one place that can
// tell them apart, which is the row that came back from the write.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mock_goBack = jest.fn();
// One stable object, because React Navigation's own is stable and `load`
// depends on it: a fresh literal per render changes the callback's identity,
// re-fires the effect, and spins the screen forever. It looks like a hang
// rather than a failure, which is why this is spelled out.
const mock_navigation = { goBack: mock_goBack, navigate: jest.fn(), push: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mock_navigation,
  useRoute: () => ({ params: { snagId: 's1' } }),
}));
jest.mock('../hooks/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));
jest.mock('../components/PhotoViewer', () => ({ __esModule: true, default: () => null }));

const mock_getSnag = jest.fn();
const mock_setSnagStatus = jest.fn();
const mock_updateSnag = jest.fn();
const mock_setPartBought = jest.fn().mockResolvedValue(undefined);
const mock_getThings = jest.fn().mockResolvedValue([]);
const mock_getThingNotes = jest.fn().mockResolvedValue([]);
jest.mock('../lib/supabase', () => ({
  getSnag: (...a: unknown[]) => mock_getSnag(...a),
  getComments: jest.fn().mockResolvedValue([]),
  addComment: jest.fn(),
  updateSnag: (...a: unknown[]) => mock_updateSnag(...a),
  setSnagStatus: (...a: unknown[]) => mock_setSnagStatus(...a),
  setPartBought: (...a: unknown[]) => mock_setPartBought(...a),
  deleteSnag: jest.fn(),
  getFileUrls: jest.fn().mockResolvedValue({}),
  deleteStoredFiles: jest.fn(),
  getSnagAdvice: jest.fn().mockResolvedValue(null),
  deleteSnagAdvice: jest.fn(),
  getThingNotes: (...a: unknown[]) => mock_getThingNotes(...a),
  getThings: (...a: unknown[]) => mock_getThings(...a),
  createThing: jest.fn(),
  createLocation: jest.fn(),
}));
const mock_showToast = jest.fn();
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: mock_showToast }) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
// Prefixed `mock_` so jest's module factory may reference it, and stable so a
// fresh literal per render cannot spin the screen's effects.
const mock_household = {
  members: [{ profileId: 'me', displayName: 'Me' }],
  profile: { id: 'me', displayName: 'Me' },
  locations: [
    { id: 'l1', propertyId: 'p', name: 'Bathroom', sortOrder: 0 },
    { id: 'l2', propertyId: 'p', name: 'Kitchen', sortOrder: 1 },
  ],
  refresh: jest.fn().mockResolvedValue(undefined),
  reloadLocations: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => mock_household }));

const DAY = 86_400_000;
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const snag = (over: Partial<any> = {}): any => ({
  id: 's1', reference: 'SNAG-0041', householdId: 'h', propertyId: 'p',
  room: 'Bathroom', photoPaths: [], description: 'Toilet cistern keeps running',
  status: 'open', priority: null, parts: [], bought: [], needsParts: false,
  dueAt: null, repeatDays: null, assigneeId: null, thingId: null,
  thingName: null, thingMake: null, thingModel: null,
  projectId: null, projectName: null,
  reporterId: 'me', reporterName: 'Me', assigneeName: null, propertyName: 'Home',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  lastDoneAt: null, doneAt: null, commentCount: 0,
  ...over,
});

const settle = () => TestRenderer.act(async () => {});

async function arrange(row = snag()) {
  mock_getSnag.mockResolvedValue(row);
  const r = render(<SnagDetailScreen />);
  await settle();
  return r;
}

const button = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll((n: any) => typeof n.type !== 'string' && n.props?.label === label)[0];

const press = async (node: any) => {
  await TestRenderer.act(async () => { await node.props.onPress(); });
};

beforeEach(() => jest.clearAllMocks());

describe('finishing a snag', () => {
  it('says congratulations, and offers the list back', async () => {
    const r = await arrange();
    mock_setSnagStatus.mockResolvedValue(snag({ status: 'done', doneAt: new Date().toISOString() }));

    await press(button(r, 'Mark done'));

    expect(r.queryByText('Congratulations')).not.toBeNull();
    expect(r.queryByText('Toilet cistern keeps running is done. One less thing.')).not.toBeNull();

    await press(button(r, 'Return to list'));
    expect(mock_goBack).toHaveBeenCalled();
  });

  // The load-bearing case. A repeating job is back on the list before the phone
  // is down, so a dialog saying well done would be the app claiming something
  // the list flatly contradicts.
  it('does not congratulate a repeating job that only rolled forward', async () => {
    const r = await arrange(snag({ repeatDays: 180, dueAt: ahead(1) }));
    mock_setSnagStatus.mockResolvedValue(snag({
      repeatDays: 180, status: 'open', dueAt: ahead(180), lastDoneAt: new Date().toISOString(),
    }));

    await press(button(r, 'Mark done'));

    expect(r.queryByText('Congratulations')).toBeNull();
    // It keeps the toast that says what actually happened.
    expect(mock_showToast).toHaveBeenCalledWith(expect.stringContaining('back on the list'));
    expect(mock_goBack).not.toHaveBeenCalled();
  });

  it('says nothing when a done snag is reopened', async () => {
    const r = await arrange(snag({ status: 'done', doneAt: '2026-09-10T00:00:00Z' }));
    mock_setSnagStatus.mockResolvedValue(snag({ status: 'open' }));

    await press(button(r, 'Reopen'));

    expect(r.queryByText('Congratulations')).toBeNull();
    expect(mock_showToast).not.toHaveBeenCalled();
  });
});

// ─── editing what a job says, and what it is about ────────────────────────────

const byLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
      && !!n.props?.onPress,
    { deep: true },
  )[0];

describe('editing a job after it was filed', () => {
  it('offers the words and the room back, and writes both in one go', async () => {
    // Both were answerable for ten seconds after the photo and never again.
    const r = await arrange();
    mock_getSnag.mockResolvedValue(snag({ description: 'The cistern drips', room: 'Kitchen' }));

    await press(byLabel(r, 'Edit this job'));
    await TestRenderer.act(async () => {
      byLabel(r, "What's wrong?") ?? null;
    });

    const input = r.root.findAll((n: any) => typeof n.type !== 'string'
      && n.props?.accessibilityLabel === "What's wrong?")[0];
    await TestRenderer.act(async () => { input.props.onChangeText('The cistern drips'); });
    await press(byLabel(r, 'Kitchen'));
    await press(button(r, 'Save'));

    expect(mock_updateSnag).toHaveBeenCalledWith('s1', {
      description: 'The cistern drips',
      room: 'Kitchen',
    });
  });

  it('will not let a photo-less job be left with no words at all', async () => {
    // `snags_has_something` would refuse it, and a constraint name surfacing
    // from Postgres is not an answer anybody can act on.
    const r = await arrange(snag({ description: 'Gutters', photoPaths: [] }));
    await press(byLabel(r, 'Edit this job'));

    const input = r.root.findAll((n: any) => typeof n.type !== 'string'
      && n.props?.accessibilityLabel === "What's wrong?")[0];
    await TestRenderer.act(async () => { input.props.onChangeText('   '); });

    expect(button(r, 'Save').props.disabled).toBe(true);
    expect(r.queryByText(
      'This one has no photo, so it needs a few words — otherwise there is nothing to go on.',
    )).not.toBeNull();
  });
});

describe('what the job is about', () => {
  it('offers to say so when nothing is linked', async () => {
    const r = await arrange(snag({ thingId: null, thingName: null }));
    expect(byLabel(r, "Say what it's about")).toBeDefined();
  });

  it('offers to change it or remove it once something is', async () => {
    const r = await arrange(snag({ thingId: 't1', thingName: 'Heat pump' }));

    expect(byLabel(r, 'Change what it is about')).toBeDefined();
    await press(byLabel(r, 'Not about that'));
    expect(mock_updateSnag).toHaveBeenCalledWith('s1', { thingId: null });
  });

  it('reads the house record only when the picker is opened', async () => {
    // A once-in-a-job's-life decision must not cost a request on every visit
    // to a page people open constantly.
    const r = await arrange(snag({ thingId: null, thingName: null }));
    expect(mock_getThings).not.toHaveBeenCalled();

    await press(byLabel(r, "Say what it's about"));
    expect(mock_getThings).toHaveBeenCalledWith('p');
  });
});

describe("the asset's own history", () => {
  const note = (over: Partial<any> = {}): any => ({
    id: 'n1',
    body: 'Filter was stiff, took a wiggle',
    createdAt: '2026-03-01T00:00:00Z',
    authorName: 'Sam',
    snagId: 's9',
    snagReference: 'SNAG-0009',
    ...over,
  });

  it('pulls through what was said on the asset\u2019s other jobs', async () => {
    // The payoff for linking, arriving where it is useful: what somebody wrote
    // the last time this appliance played up.
    mock_getThingNotes.mockResolvedValue([note()]);
    const r = await arrange(snag({ thingId: 't1', thingName: 'Heat pump' }));

    expect(mock_getThingNotes).toHaveBeenCalledWith('t1', 's1');
    expect(r.queryByText('Also said about Heat pump')).not.toBeNull();
    expect(r.queryByText('Filter was stiff, took a wiggle')).not.toBeNull();
    // Each row names the job it came from and is a door back to it.
    expect(byLabel(r, 'Open SNAG-0009')).toBeDefined();
  });

  it('asks for nothing when the job is about nothing', async () => {
    mock_getThingNotes.mockClear();
    await arrange(snag({ thingId: null, thingName: null }));
    expect(mock_getThingNotes).not.toHaveBeenCalled();
  });

  it('renders the page even when that history cannot be read', async () => {
    // History nobody can fetch must not take the page down with it.
    mock_getThingNotes.mockRejectedValue(new Error('Network'));
    const r = await arrange(snag({ thingId: 't1', thingName: 'Heat pump' }));

    expect(r.queryByText('Toilet cistern keeps running')).not.toBeNull();
    expect(r.queryByText('Also said about Heat pump')).toBeNull();
  });
});
