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
// `beforeRemove` is where leaving the page saves what is still in a box, so the
// listener is kept where a test can fire it the way React Navigation would.
const mock_listeners: Record<string, (e: any) => void> = {};
const mock_dispatch = jest.fn();
const mock_navigation = {
  goBack: mock_goBack,
  navigate: jest.fn(),
  push: jest.fn(),
  dispatch: mock_dispatch,
  addListener: (event: string, fn: (e: any) => void) => {
    mock_listeners[event] = fn;
    return () => { delete mock_listeners[event]; };
  },
};
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
const mock_setSnagThings = jest.fn().mockResolvedValue(undefined);
const mock_getThingNotes = jest.fn().mockResolvedValue([]);
const mock_getSupport = jest.fn().mockResolvedValue(null);
const mock_createSupport = jest.fn().mockResolvedValue(undefined);
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
  setSnagThings: (...a: unknown[]) => mock_setSnagThings(...a),
  createThing: jest.fn(),
  createLocation: jest.fn(),
  getSupportRequestForSnag: (...a: unknown[]) => mock_getSupport(...a),
  createSupportRequest: (...a: unknown[]) => mock_createSupport(...a),
  addSupportMessage: jest.fn().mockResolvedValue(undefined),
  closeSupportRequest: jest.fn().mockResolvedValue(undefined),
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
  linkedThings: [],
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

/**
 * The last button with this label, which is the one in the sheet on top.
 *
 * The page itself now carries a pinned **Save**, and the edit sheet carries its
 * own — two controls with the same word on two surfaces, one of which is a
 * modal covering the other. Only one is ever visible to a person, but both are
 * in the tree, and the sheet renders after the page it sits over.
 */
const topButton = (r: ReturnType<typeof render>, label: string) => {
  const all = r.root.findAll((n: any) => typeof n.type !== 'string' && n.props?.label === label);
  return all[all.length - 1];
};

const press = async (node: any) => {
  await TestRenderer.act(async () => { await node.props.onPress(); });
};

beforeEach(() => {
  jest.clearAllMocks();
  mock_getSupport.mockResolvedValue(null);
});

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
    await press(topButton(r, 'Done'));

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

    expect(topButton(r, 'Done').props.disabled).toBe(true);
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

// ---------------------------------------------------------------- linked assets
//
// The card printed the whole room's record inline — nine appliances, a screen
// of vertical rent — which read as nine things already attached to this snag
// when it was really the inventory answering a question nobody asked. A list of
// what is *selected* belongs on the page; a list of what *could be* belongs
// behind a control.

describe('linked assets', () => {
  const linked = (over: Partial<any> = {}): any => ({
    id: 't1', name: 'Heat pump', room: 'Bathroom',
    make: 'Mitsubishi', model: 'MSZ-AP50VGK', kind: 'appliance', ...over,
  });

  it('offers to link, and reads nothing, when the job has no room', async () => {
    mock_getThings.mockClear();
    const r = await arrange(snag({ linkedThings: [], room: null }));

    expect(byLabel(r, 'Link an item from the house')).toBeDefined();
    // With no room there is no shortlist to offer, so nothing to read.
    expect(mock_getThings).not.toHaveBeenCalled();
  });

  // The room is already on the job, so the things recorded in it are the
  // shortlist a person would pick from — one tap each rather than a sheet.
  it('suggests what is in the room, and one tap links it', async () => {
    mock_getThings.mockClear();
    mock_getThings.mockResolvedValue([
      thing({ id: 't1', name: 'Heat pump', room: 'Bathroom' }),
      thing({ id: 't2', name: 'Extractor fan', room: 'Bathroom' }),
      thing({ id: 't3', name: 'Dishwasher', room: 'Kitchen' }),
    ]);
    mock_setSnagThings.mockClear();
    const r = await arrange(snag({ linkedThings: [linked({ id: 't1' })], room: 'Bathroom' }));

    expect(mock_getThings).toHaveBeenCalledTimes(1);
    // Already linked, and in another room: neither is offered.
    expect(byLabel(r, 'Link Heat pump')).toBeUndefined();
    expect(byLabel(r, 'Link Dishwasher')).toBeUndefined();

    await press(byLabel(r, 'Link Extractor fan'));
    expect(mock_setSnagThings).toHaveBeenCalledWith('s1', ['t1', 't2']);
    expect(mock_updateSnag).not.toHaveBeenCalled();
    mock_getThings.mockResolvedValue([]);
  });

  it('keeps the page when the room cannot be read', async () => {
    mock_getThings.mockRejectedValueOnce(new Error('Network'));
    const r = await arrange(snag({ room: 'Bathroom' }));
    expect(r.queryByText('Toilet cistern keeps running')).not.toBeNull();
  });

  it('shows what is linked, counted, with the number somebody came for', async () => {
    const r = await arrange(snag({
      linkedThings: [linked(), linked({ id: 't2', name: 'Extractor fan', model: 'XF12' })],
    }));

    expect(r.queryByText('Linked items (2)')).not.toBeNull();
    expect(r.queryByText('Mitsubishi MSZ-AP50VGK')).not.toBeNull();
    expect(byLabel(r, 'Open Heat pump')).toBeDefined();
    // Never the whole inventory: only what the job says it is about.
    expect(byLabel(r, 'Link an item from the house')).toBeUndefined();
  });

  it('opens the record only when the picker is asked for', async () => {
    mock_getThings.mockClear();
    mock_getThings.mockResolvedValue([]);
    const r = await arrange(snag({ linkedThings: [] }));

    await press(byLabel(r, 'Link an item from the house'));
    expect(mock_getThings).toHaveBeenCalledWith('p');
  });

  it('opens the asset rather than writing to the job', async () => {
    mock_updateSnag.mockClear();
    const r = await arrange(snag({ linkedThings: [linked({ id: 't9' })] }));

    await press(byLabel(r, 'Open Heat pump'));
    expect(mock_navigation.navigate).toHaveBeenCalledWith('ThingDetail', { thingId: 't9' });
    expect(mock_updateSnag).not.toHaveBeenCalled();
  });

  // The × is the same call one short, never a second RPC: the server replaces
  // the whole set, so a half-finished answer can never reach the row.
  it('unlinks through the one call that replaces the set', async () => {
    mock_setSnagThings.mockClear();
    const r = await arrange(snag({
      linkedThings: [linked(), linked({ id: 't2', name: 'Extractor fan' })],
    }));

    await press(byLabel(r, 'Unlink Heat pump'));
    expect(mock_setSnagThings).toHaveBeenCalledWith('s1', ['t2']);
    // Saying what a job is about is the tail of capture, not deciding to do it.
    expect(mock_updateSnag).not.toHaveBeenCalled();
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

// ------------------------------------------------------------------ when
//
// One card for one fact. The date and the repeat were two cards and a modal,
// and the modal carried a second set of date controls writing the same
// `due_at` — which one was real was a fair question. Setting up a repeat is
// one tap now.

describe('the When card', () => {
  const texts = (r: ReturnType<typeof render>) =>
    r.getAllByType('Text').map((n: any) => String(n.props.children ?? ''));

  it('offers how often it repeats beside the date, with nothing behind a Yes', async () => {
    const r = await arrange(snag({ repeatDays: null }));

    expect(r.queryByText('Repeats')).not.toBeNull();
    expect(button(r, 'Never')).toBeDefined();
    expect(button(r, 'Every 6 months')).toBeDefined();
    expect(button(r, 'Yes')).toBeUndefined();
    expect(r.queryByText('How often does it come round?')).toBeNull();
    expect(r.queryByText("When's the next one due?")).toBeNull();
  });

  it('sets a repeat in one tap, dating it a cycle out when it had no date', async () => {
    mock_updateSnag.mockResolvedValue(snag({ repeatDays: 180, dueAt: ahead(180) }));
    const r = await arrange(snag({ repeatDays: null, dueAt: null }));

    await press(button(r, 'Every 6 months'));
    const [, update] = mock_updateSnag.mock.calls[0];
    expect(update.repeatDays).toBe(180);
    const days = (new Date(update.dueAt).getTime() - Date.now()) / DAY;
    expect(Math.round(days)).toBe(180);
  });

  it('leaves a date already set alone when a repeat is chosen', async () => {
    const due = ahead(10);
    mock_updateSnag.mockResolvedValue(snag({ repeatDays: 30, dueAt: due }));
    const r = await arrange(snag({ repeatDays: null, dueAt: due }));

    await press(button(r, 'Monthly'));
    expect(mock_updateSnag).toHaveBeenCalledWith('s1', { repeatDays: 30, dueAt: due });
  });

  it('clears the repeat on Never', async () => {
    mock_updateSnag.mockResolvedValue(snag({ repeatDays: null }));
    const r = await arrange(snag({ repeatDays: 180 }));

    await press(button(r, 'Never'));
    expect(mock_updateSnag).toHaveBeenCalledWith('s1', { repeatDays: null });
  });

  // A heat pump serviced every two years arrives from the thing page with 730
  // days; a row that could not show it would read as Never.
  it('shows a cycle the presets do not carry', async () => {
    const r = await arrange(snag({ repeatDays: 730, dueAt: ahead(30) }));
    expect(button(r, 'Every 2 years').props.active).toBe(true);
    expect(button(r, 'Never').props.active).toBe(false);
  });

  it('dates the job in one tap', async () => {
    mock_updateSnag.mockResolvedValue(snag({ dueAt: ahead(7) }));
    const r = await arrange(snag({ dueAt: null }));

    await press(button(r, 'Next week'));
    const [, update] = mock_updateSnag.mock.calls[0];
    const due = new Date(update.dueAt);
    expect(due.getHours()).toBe(0);
    expect(Math.round((due.getTime() - Date.now()) / DAY)).toBeGreaterThanOrEqual(6);
  });

  // The date is stated once, in the box, where it can be changed; the sentence
  // says only what happens next, and where it will turn up.
  it('says what happens next without repeating the date', async () => {
    const r = await arrange(snag({ repeatDays: 180, dueAt: '2026-11-08T00:00:00.000Z' }));
    const said = texts(r).join(' ');

    expect(said).toContain('every 6 months');
    expect(said).toContain('Due soon');
    expect(said).not.toContain('8/11/2026 ');
  });

  it('shows the day it is due, never just the month', async () => {
    const r = await arrange(snag({ dueAt: '2026-11-08T00:00:00.000' }));
    const box = r.root.findAll((n: any) => typeof n.type !== 'string' && !!n.props?.onChangeText
      && n.props?.accessibilityLabel === "When's it due?", { deep: true })[0];
    expect(box.props.value).toBe('08/11/2026');
  });
});

// ------------------------------------------------------------------ leaving
//
// Leaving saves. The page had a Save that mostly read Close, beside a back
// arrow that already did the same; every control here writes when pressed, so
// the only things it could be waiting on were two boxes — and the page now
// commits those itself on the way out, and before Mark done.

describe('leaving the page', () => {
  const texts = (r: ReturnType<typeof render>) =>
    r.getAllByType('Text').map((n: any) => String(n.props.children ?? ''));

  const field = (r: ReturnType<typeof render>, label: string) =>
    r.root.findAll(
      (n: any) => typeof n.type !== 'string' && !!n.props?.onChangeText
        && n.props?.accessibilityLabel === label,
      { deep: true },
    )[0];

  /** What React Navigation does on a back press: ask first, then go. */
  async function leave() {
    const action = { type: 'GO_BACK' };
    const e = { preventDefault: jest.fn(), data: { action } };
    await TestRenderer.act(async () => { mock_listeners.beforeRemove?.(e); });
    await settle();
    return { prevented: e.preventDefault.mock.calls.length > 0, action };
  }

  it('has no Save or Close — the footer holds Mark done', async () => {
    const r = await arrange();
    expect(button(r, 'Save')).toBeUndefined();
    expect(button(r, 'Close')).toBeUndefined();
    expect(button(r, 'Mark done')).toBeDefined();
    expect(texts(r)).toContain('All changes saved');
  });

  it('lets the page go without a write when nothing is in a box', async () => {
    mock_updateSnag.mockClear();
    await arrange();
    const { prevented } = await leave();
    expect(prevented).toBe(false);
    expect(mock_updateSnag).not.toHaveBeenCalled();
  });

  it('says a typed date will be kept on the way out', async () => {
    const r = await arrange(snag({ dueAt: null }));
    await TestRenderer.act(async () => {
      field(r, "When's it due?").props.onChangeText('8/11/2026');
    });
    expect(texts(r)).toContain('1 unsaved change — kept when you leave');
  });

  it('counts both boxes', async () => {
    const r = await arrange(snag({ dueAt: null }));
    await TestRenderer.act(async () => {
      field(r, "When's it due?").props.onChangeText('8/11/2026');
    });
    await TestRenderer.act(async () => {
      field(r, 'Something to pick up').props.onChangeText('Hinge');
    });
    expect(texts(r)).toContain('2 unsaved changes — kept when you leave');
  });

  it('writes a pending date and a pending item in one call, then goes', async () => {
    mock_updateSnag.mockClear();
    mock_updateSnag.mockResolvedValue(snag());
    const r = await arrange(snag({ dueAt: null, parts: [] }));

    await TestRenderer.act(async () => {
      field(r, "When's it due?").props.onChangeText('8/11/2026');
    });
    await TestRenderer.act(async () => {
      field(r, 'Something to pick up').props.onChangeText('Hinge');
    });
    const { prevented, action } = await leave();

    expect(prevented).toBe(true);
    expect(mock_updateSnag).toHaveBeenCalledTimes(1);
    const [, update] = mock_updateSnag.mock.calls[0];
    expect(update.parts).toEqual(['Hinge']);
    expect(new Date(update.dueAt).getDate()).toBe(8);
    expect(mock_dispatch).toHaveBeenCalledWith(action);
  });

  it('stays put when the write fails', async () => {
    mock_updateSnag.mockClear();
    mock_updateSnag.mockRejectedValue(new Error('Network'));
    const r = await arrange(snag({ parts: [] }));

    await TestRenderer.act(async () => {
      field(r, 'Something to pick up').props.onChangeText('Hinge');
    });
    await leave();
    expect(mock_dispatch).not.toHaveBeenCalled();
  });

  it('stays put on a date no calendar has, keeping the words in the box', async () => {
    mock_updateSnag.mockClear();
    const r = await arrange(snag({ dueAt: null }));

    await TestRenderer.act(async () => {
      field(r, "When's it due?").props.onChangeText('31/02/2026');
    });
    await leave();

    expect(mock_updateSnag).not.toHaveBeenCalled();
    expect(mock_dispatch).not.toHaveBeenCalled();
    expect(field(r, "When's it due?").props.value).toBe('31/02/2026');
  });

  // Finishing a job with a part still typed in the box is finishing the job
  // that includes it.
  it('commits what is in a box before Mark done', async () => {
    mock_updateSnag.mockClear();
    mock_updateSnag.mockResolvedValue(snag({ parts: ['Hinge'] }));
    mock_setSnagStatus.mockResolvedValue(snag({ status: 'done', doneAt: new Date().toISOString() }));
    const r = await arrange(snag({ parts: [] }));

    await TestRenderer.act(async () => {
      field(r, 'Something to pick up').props.onChangeText('Hinge');
    });
    await press(button(r, 'Mark done'));

    expect(mock_updateSnag.mock.calls[0][1].parts).toEqual(['Hinge']);
    expect(mock_setSnagStatus).toHaveBeenCalledWith('s1', 'done');
  });

  // A calendar tap writes the box and commits in one gesture, before React has
  // re-rendered — the commit has to see the new value, not the old one.
  it('commits a day picked from the calendar straight away', async () => {
    mock_updateSnag.mockClear();
    mock_updateSnag.mockResolvedValue(snag({ dueAt: '2026-11-08T00:00:00.000' }));
    const r = await arrange(snag({ dueAt: null }));
    const box = field(r, "When's it due?");
    await TestRenderer.act(async () => {
      box.props.onChangeText('8/11/2026');
      await box.props.onBlur();
    });
    expect(new Date(mock_updateSnag.mock.calls[0][1].dueAt).getDate()).toBe(8);
  });
});

// ------------------------------------------------------------- what reads first
//
// The shopping list is the part of this page that moves work — the trip to the
// shop is the single most common reason a small job sits for weeks — where the
// asset list is reference. So it comes first, and the assessment card stays
// directly above it, because the parts it suggests land in the list underneath.

// The natural order of inspecting and fixing something: what it is about, then
// what to do about it, then when, then the one state change a person makes.
describe('the order down the page', () => {
  it('reads core detail, then action items, then scheduling, then the state change', async () => {
    const r = await arrange(snag({ room: 'Bathroom', repeatDays: null }));

    // Flattened, because a heading like `Notes {count}` renders as an array of
    // children and `String(children)` would come back with a comma in it.
    const flat = (node: any): string =>
      (node.children ?? []).map((c: any) => (typeof c === 'string' ? c : flat(c))).join('');

    const wanted = ['Linked items', 'Anything to pick up?', 'Notes', "When's it due?",
      'Repeats'];
    const seen = r.getAllByType('Text')
      .map((n: any) => flat(n).trim())
      .filter((t: string) => wanted.includes(t));

    expect(seen).toEqual(wanted);
  });

  // Finishing is the most common thing done to a job that exists, so it is in
  // the footer where a thumb finds it without scrolling past every card.
  it('puts Mark done in the footer, after all the content', async () => {
    const r = await arrange(snag({ repeatDays: null }));
    const order = r.getAllByType('Text')
      .map((n: any) => String(n.props.children ?? ''));

    expect(order.indexOf('Mark done')).toBeGreaterThan(order.indexOf('Repeats'));
    expect(button(r, 'Mark done').props.variant).toBeUndefined();
  });
});


// ─── the three facts at the top, and the way in to each ───────────────────────

describe('the meta row', () => {
  // Two of the three had their one control most of a screen down. The row now
  // reaches both — without becoming a second place either is written, which is
  // the failure this page has already been through once with the date.
  it('names the room and when it is due, and says so when neither is set', async () => {
    const dated = await arrange(snag({ dueAt: ahead(3), room: 'Bathroom' }));
    expect(dated.queryByText('Bathroom')).not.toBeNull();
    expect(dated.queryByText('No date')).toBeNull();

    const bare = await arrange(snag({ dueAt: null, room: null }));
    expect(bare.queryByText('No date')).not.toBeNull();
    expect(bare.queryByText('No room')).not.toBeNull();
  });

  // The chip is a way in, not a control. Pressing it must not write anything —
  // a chip that set the date itself is the duplicate date control again.
  it('scrolls to the date field rather than setting a date', async () => {
    const r = await arrange(snag({ dueAt: null }));
    await press(byLabel(r, 'Give it a date'));

    expect(mock_updateSnag).not.toHaveBeenCalled();
    // Still exactly one control that writes the date.
    expect(r.getAllByText("When's it due?").length).toBe(1);
  });

  // The room's one writer is the edit sheet, which is what the pencil opens.
  // The chip is a second door to it, never a second sheet.
  it('opens the edit sheet for the room, writing nothing on the way', async () => {
    const r = await arrange(snag({ room: 'Kitchen' }));
    await press(byLabel(r, 'In the Kitchen — change it'));

    expect(mock_updateSnag).not.toHaveBeenCalled();
    expect(r.queryByText('Edit this job')).not.toBeNull();
  });

  // Status is derived, and the one state change made by hand is at the foot
  // deliberately. A tappable status chip would be Mark done arriving at the
  // top by another door.
  it('leaves status alone — it is stated, not offered', async () => {
    const r = await arrange(snag({ status: 'open' }));
    const pressables = r.root.findAll(
      (n: any) => typeof n.type !== 'string'
        && !!n.props?.onPress
        && typeof n.props?.accessibilityLabel === 'string'
        && /status|mark.*(done|open)|start/i.test(n.props.accessibilityLabel),
      { deep: true },
    );
    // `Mark done` is a Button with a label, not an accessibilityLabel, and it
    // lives at the foot; nothing up here offers to change the status.
    expect(pressables).toEqual([]);
    expect(mock_setSnagStatus).not.toHaveBeenCalled();
  });
});

// ─── the notes box ────────────────────────────────────────────────────────────

describe('the notes box', () => {
  // With no notifications anywhere in this product a note is the only way one
  // person tells the other anything, so the placeholder says what the box is
  // for. An example message would read as something already sent — the same
  // rule that keeps `7A204871` out of the SERIAL box, on the one box where
  // being believed matters most.
  it('names what the box is for rather than showing a message', async () => {
    const r = await arrange();
    const box = r.root.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === 'Add a note',
      { deep: true },
    )[0];

    expect(box.props.placeholder).toBe('Add a note, or what you did');
    expect(box.props.multiline).toBe(true);
  });

  // A word, not a glyph — the same correction the shopping list's `+` took.
  // A 48px square centred against a four-line box is a chat affordance, and
  // this is not a chat.
  it('commits with a labelled control under the box, not a send arrow', async () => {
    const r = await arrange();
    expect(r.queryByText('Add note')).not.toBeNull();

    const send = byLabel(r, 'Add note');
    const arrows = send.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.name === 'arrow-up',
      { deep: true },
    );
    expect(arrows).toEqual([]);
  });
});

describe('asking SnagHQ', () => {
  const asked = (over: Partial<any> = {}): any => ({
    id: 'r1', snagId: 's1', status: 'waiting', question: 'Why does it run?',
    createdAt: new Date().toISOString(), waitingSince: new Date().toISOString(),
    firstSeenAt: null, lastStaffReplyAt: null, closedAt: null, closedBy: null,
    messages: [],
    ...over,
  });

  it('offers one quiet row when nobody has asked', async () => {
    const r = await arrange();
    expect(r.queryByText('Ask SnagHQ about this')).not.toBeNull();
    expect(r.queryByText('Asked SnagHQ')).toBeNull();
  });

  it('shows the question and its state once asked, instead of the row', async () => {
    mock_getSupport.mockResolvedValue(asked());
    const r = await arrange();
    expect(r.queryByText('Asked SnagHQ')).not.toBeNull();
    expect(r.queryByText('Why does it run?')).not.toBeNull();
    expect(r.queryByText('Ask SnagHQ about this')).toBeNull();
  });

  it('survives a question it cannot read', async () => {
    mock_getSupport.mockRejectedValue(new Error('offline'));
    const r = await arrange();
    expect(r.queryByText('Toilet cistern keeps running')).not.toBeNull();
    expect(r.queryByText('Ask SnagHQ about this')).not.toBeNull();
  });

  it('sends the question without touching the job', async () => {
    const r = await arrange();
    const row = r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Ask SnagHQ about this'
      && typeof n.props?.onPress === 'function')[0];
    await press(row);
    const box = r.root.findAll((n: any) => n.props?.accessibilityLabel === 'What do you want to know?'
      && typeof n.props?.onChangeText === 'function')[0];
    await TestRenderer.act(async () => { box.props.onChangeText('  Can I fix it?  '); });
    mock_getSupport.mockResolvedValue(asked({ question: 'Can I fix it?' }));
    await press(topButton(r, 'Send to SnagHQ'));

    expect(mock_createSupport).toHaveBeenCalledWith('s1', 'Can I fix it?');
    expect(mock_updateSnag).not.toHaveBeenCalled();
    expect(mock_setSnagStatus).not.toHaveBeenCalled();
    expect(mock_showToast).toHaveBeenCalledWith('Sent to SnagHQ');
    expect(r.queryByText('Can I fix it?')).not.toBeNull();
  });
});
