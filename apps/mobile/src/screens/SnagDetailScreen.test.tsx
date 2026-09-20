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
  status: 'open', parts: [], bought: [], needsParts: false,
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

    // The room rail became a searchable picker, which is closed until asked
    // for: the field says the answer, and opening it is what turns it into a
    // question. The snag is in the Bathroom, so that is what the field reads.
    await press(byLabel(r, 'Room: Bathroom. Change it'));
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

// ---------------------------------------------------------------- linked assets
//
// It replaced two controls that both *wrote* — *Part of a bigger job*, which
// set `project_id`, and *Say what it's about*, which set `thing_id` through a
// picker over the whole house record. Neither question is one somebody standing
// on this page arrives wanting to answer.
//
// The payoff was never the tag, it was the model number. The room is already on
// the job, so the things in that room are the shortlist a human would have
// picked from — offered as a list to read, writing nothing.

const thing = (over: Partial<any> = {}): any => ({
  id: 't1', householdId: 'h', propertyId: 'p', kind: 'appliance',
  name: 'Heat pump', room: 'Bathroom', photoPaths: [], make: 'Mitsubishi',
  model: 'MSZ-AP50VGK', serial: null, consumables: [], documentPaths: [],
  installedAt: null, warrantyUntil: null, serviceDays: null, spec: {}, notes: null,
  createdBy: 'me', createdAt: '', updatedAt: '',
  propertyName: 'Home', snagCount: 0, openSnagCount: 0,
  ...over,
});

describe('what is in the room', () => {
  it('lists this room and nothing else, with the number somebody came for', async () => {
    mock_getThings.mockResolvedValue([
      thing({ id: 'a', name: 'Heat pump', room: 'Bathroom' }),
      thing({ id: 'b', name: 'Dryer', room: 'Laundry' }),
    ]);
    const r = await arrange(snag({ room: 'Bathroom' }));

    expect(r.queryByText('Linked assets')).not.toBeNull();
    expect(byLabel(r, 'Open Heat pump')).toBeDefined();
    expect(byLabel(r, 'Open Dryer')).toBeUndefined();
    expect(r.queryByText('Mitsubishi MSZ-AP50VGK')).not.toBeNull();
  });

  it('never offers to link, tag or unlink anything', async () => {
    mock_getThings.mockResolvedValue([thing({ room: 'Bathroom' })]);
    const r = await arrange(snag({ room: 'Bathroom' }));

    expect(byLabel(r, "Say what it's about")).toBeUndefined();
    expect(byLabel(r, 'Change what it is about')).toBeUndefined();
    expect(byLabel(r, 'Not about that')).toBeUndefined();
    expect(byLabel(r, 'Part of a bigger job?')).toBeUndefined();
  });

  it('opens the record rather than writing to the job', async () => {
    mock_updateSnag.mockClear();
    mock_getThings.mockResolvedValue([thing({ id: 't9', room: 'Bathroom' })]);
    const r = await arrange(snag({ room: 'Bathroom' }));

    await press(byLabel(r, 'Open Heat pump'));
    expect(mock_navigation.navigate).toHaveBeenCalledWith('ThingDetail', { thingId: 't9' });
    expect(mock_updateSnag).not.toHaveBeenCalled();
  });

  // A section with nothing in it is the app asking somebody to read a question
  // it cannot answer.
  it('is absent entirely when the room holds nothing', async () => {
    mock_getThings.mockResolvedValue([thing({ room: 'Laundry' })]);
    const r = await arrange(snag({ room: 'Bathroom' }));
    expect(r.queryByText('Linked assets')).toBeNull();
  });

  // The least important thing on the page must never be what stops the notes
  // appearing.
  it('renders the whole page when the record cannot be read', async () => {
    mock_getThings.mockRejectedValue(new Error('Network'));
    const r = await arrange(snag({ room: 'Bathroom' }));

    expect(r.queryByText('Toilet cistern keeps running')).not.toBeNull();
    expect(r.queryByText('Linked assets')).toBeNull();
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

// ------------------------------------------------------------ what came away
//
// *Sort it out* held three unrelated controls: how urgent, what to pick up, and
// who is doing it. Two of them have gone — priority because a household list is
// a dozen small jobs none of which is an emergency, an assignee because two
// people in one house tell each other out loud — and the one that remains is
// the one that actually moves work, so it is its own card under the notes.

describe('what the page no longer asks', () => {
  it('has no Sort it out card, no urgency and nobody to assign it to', async () => {
    const r = await arrange();
    expect(r.queryByText('Sort it out')).toBeNull();
    expect(r.queryByText('How urgent?')).toBeNull();
    expect(r.queryByText("Who's doing it?")).toBeNull();
    expect(r.queryByText('Me')).toBeNull();
  });

  it('keeps the shopping list, as a card of its own', async () => {
    const r = await arrange(snag({ parts: ['Hinge'], bought: [] }));
    expect(r.queryByText('Anything to pick up?')).not.toBeNull();
    expect(r.queryByText('Hinge')).not.toBeNull();
  });
});

// ------------------------------------------------------------------- the date
//
// It was reachable only through the repeat card, so a one-off job could never
// be given a date at all — which made the Schedule tab's Due marks and the
// overdue badge features only repeating jobs had. Precisely backwards: a filter
// that comes round every six months looks after itself.

describe("when it's due", () => {
  const field = (r: ReturnType<typeof render>, label: string) =>
    r.root.findAll(
      (n: any) => typeof n.type !== 'string' && !!n.props?.onChangeText
        && n.props?.accessibilityLabel === label,
      { deep: true },
    )[0];

  it('is a field on the page, whether or not the job repeats', async () => {
    const r = await arrange(snag({ repeatDays: null, dueAt: null }));
    expect(r.queryByText("When's it due?")).not.toBeNull();
  });

  it('writes a typed date day-first, on leaving the box', async () => {
    mock_updateSnag.mockResolvedValue(snag({ dueAt: '2026-11-08T00:00:00.000Z' }));
    const r = await arrange(snag({ dueAt: null }));

    const box = field(r, "When's it due?");
    await TestRenderer.act(async () => { box.props.onChangeText('8/11/2026'); });
    await TestRenderer.act(async () => { await box.props.onBlur(); });

    const [, update] = mock_updateSnag.mock.calls[0];
    // The eighth of November, never the eleventh of August.
    expect(new Date(update.dueAt).getMonth()).toBe(10);
    expect(new Date(update.dueAt).getDate()).toBe(8);
  });

  it('refuses a date no calendar has rather than raising a 22008 from the RPC', async () => {
    mock_updateSnag.mockClear();
    const r = await arrange(snag({ dueAt: null }));

    const box = field(r, "When's it due?");
    await TestRenderer.act(async () => { box.props.onChangeText('31/02/2026'); });
    await TestRenderer.act(async () => { await box.props.onBlur(); });

    expect(mock_updateSnag).not.toHaveBeenCalled();
  });

  it('writes nothing when the box is left exactly as it was found', async () => {
    mock_updateSnag.mockClear();
    const r = await arrange(snag({ dueAt: '2026-11-08T00:00:00.000Z' }));

    const box = field(r, "When's it due?");
    await TestRenderer.act(async () => { await box.props.onBlur(); });
    expect(mock_updateSnag).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ repeating
//
// The card carried a paragraph, a question and two rails of presets, permanently,
// on a page people open constantly — to serve the minority of jobs that come
// round. The common answer is no, so the card asks and the arrangement moves
// behind the Yes.

describe('scheduling a recurring job', () => {
  it('asks yes or no, and explains nothing until the answer is yes', async () => {
    const r = await arrange(snag({ repeatDays: null }));

    expect(r.queryByText('Schedule a recurring job')).not.toBeNull();
    expect(r.queryByText('How often does it come round?')).toBeNull();
    expect(r.queryByText('Does it come round again?')).toBeNull();
    expect(
      r.getAllByType('Text').some((n: any) => String(n.props.children ?? '')
        .includes('Filters, gutters, smoke alarms'))
    ).toBe(false);
  });

  it('opens the arrangement on Yes', async () => {
    const r = await arrange(snag({ repeatDays: null }));
    await press(button(r, 'Yes'));
    expect(r.queryByText('How often does it come round?')).not.toBeNull();
    expect(r.queryByText("When's the next one due?")).toBeNull();
  });

  it('asks when the next one lands once a cycle is set, never "the first"', async () => {
    const r = await arrange(snag({ repeatDays: 180, dueAt: null }));
    await press(button(r, 'Yes'));

    expect(r.queryByText("When's the next one due?")).not.toBeNull();
    expect(r.queryByText("When's the first one due?")).toBeNull();
    // One vocabulary for how often: six months is 180 days everywhere, and
    // `describeCycle` says it in months rather than coming back "26 weeks".
    expect(r.queryByText('A full 6 months away')).not.toBeNull();
  });

  it('says the arrangement on the card, without opening anything', async () => {
    const r = await arrange(snag({ repeatDays: 180, dueAt: '2026-11-08T00:00:00.000Z' }));
    expect(
      r.getAllByType('Text').some((n: any) => String(n.props.children ?? '')
        .includes('then every 6 months'))
    ).toBe(true);
  });

  it('clears the repeat on No rather than opening anything', async () => {
    mock_updateSnag.mockResolvedValue(snag({ repeatDays: null }));
    const r = await arrange(snag({ repeatDays: 180 }));

    await press(button(r, 'No'));
    expect(mock_updateSnag).toHaveBeenCalledWith('s1', { repeatDays: null });
  });
});
