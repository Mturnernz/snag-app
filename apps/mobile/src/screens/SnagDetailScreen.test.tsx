import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import SnagDetailScreen from './SnagDetailScreen';

// Ask SnagHQ is off for v1 (lib/askSnagHQ.ts). The page is pinned with it on,
// and the off state has its own block at the end.
const ASK_FLAG = process.env.EXPO_PUBLIC_ASK_SNAGHQ;
beforeAll(() => { process.env.EXPO_PUBLIC_ASK_SNAGHQ = 'on'; });
afterAll(() => {
  if (ASK_FLAG === undefined) delete process.env.EXPO_PUBLIC_ASK_SNAGHQ;
  else process.env.EXPO_PUBLIC_ASK_SNAGHQ = ASK_FLAG;
});

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
const mock_addComment = jest.fn().mockResolvedValue(undefined);
const mock_getThings = jest.fn().mockResolvedValue([]);
const mock_setSnagThings = jest.fn().mockResolvedValue(undefined);
const mock_getThingNotes = jest.fn().mockResolvedValue([]);
const mock_getSupport = jest.fn().mockResolvedValue(null);
const mock_createSupport = jest.fn().mockResolvedValue(undefined);
jest.mock('../lib/supabase', () => ({
  getSnag: (...a: unknown[]) => mock_getSnag(...a),
  getComments: jest.fn().mockResolvedValue([]),
  addComment: (...a: unknown[]) => mock_addComment(...a),
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

  it('says who services a linked item, and nothing when nobody said', async () => {
    const said = (r: ReturnType<typeof render>) => r.getAllByType('Text')
      .map((n: any) => [].concat(n.props.children ?? []).join(''));
    const r = await arrange(snag({ linkedThings: [linked({ servicedBy: 'Aircon Experts' })] }));
    expect(said(r)).toContain('Serviced by Aircon Experts');

    const none = await arrange(snag({ linkedThings: [linked({ servicedBy: null })] }));
    expect(said(none).some((t) => t.startsWith('Serviced by'))).toBe(false);
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

  it('keeps the shopping list, as its own half of the items card', async () => {
    const r = await arrange(snag({ parts: ['Hinge'], bought: [] }));
    expect(r.queryByText('Add to shopping list')).not.toBeNull();
    expect(r.queryByText('Hinge')).not.toBeNull();
  });
});

// ─── one card for items and shopping ──────────────────────────────────────────
//
// Two facts that behave differently — linking never starts the job, adding
// something to pick up does — in one card with a heading each, rather than
// two cards with a bulky add control each.

describe('items and shopping', () => {
  const field = (r: ReturnType<typeof render>, label: string) =>
    r.root.findAll(
      (n: any) => typeof n.type !== 'string' && !!n.props?.onChangeText
        && n.props?.accessibilityLabel === label,
      { deep: true },
    )[0];

  // The shopping first and the linked items last, by the owner's decision.
  it('is one card with a heading for each half, the shopping list first', async () => {
    const r = await arrange();
    const order = r.getAllByType('Text').map((n: any) => String(n.props.children ?? ''));
    expect(order.indexOf('Items and shopping')).toBeGreaterThan(-1);
    expect(order.indexOf('Add to shopping list')).toBeGreaterThan(order.indexOf('Items and shopping'));
    expect(order.indexOf('Linked items')).toBeGreaterThan(order.indexOf('Add to shopping list'));
    expect(order).not.toContain('Anything to pick up?');
  });

  // The room's things sit on a line of their own under the words that say
  // where they came from — inline, they wrapped half under the label.
  it('puts the room’s pills on their own line, under the label', async () => {
    mock_getThings.mockResolvedValue([thing({ id: 't2', name: 'Extractor fan', room: 'Bathroom' })]);
    const r = await arrange(snag({ room: 'Bathroom' }));

    const label = r.root.findAll((n: any) => n.type === 'Text'
      && n.props.children === 'In the bathroom:', { deep: true })[0];
    const pill = byLabel(r, 'Link Extractor fan');
    const row = (node: any): any => {
      let at = node.parent;
      while (at && !(at.type === 'View' && at.props?.style?.flexDirection === 'row')) at = at.parent;
      return at;
    };
    expect(label).toBeDefined();
    expect(pill).toBeDefined();
    expect(row(pill)).not.toBe(row(label));
    mock_getThings.mockResolvedValue([]);
  });

  // No box and Add button: the list's last row is the box, and it adds on
  // Return and when it is left — once, even though both land in one gesture.
  it('adds on Return and on leaving the box, once, with no Add button', async () => {
    mock_updateSnag.mockClear();
    mock_updateSnag.mockResolvedValue(snag({ parts: ['Hinge'] }));
    const r = await arrange(snag({ parts: [] }));
    expect(byLabel(r, 'Add to the shopping list')).toBeUndefined();

    const box = field(r, 'Something to pick up');
    expect(box.props.placeholder).toBe('Add something to pick up');
    await TestRenderer.act(async () => { box.props.onChangeText('Hinge'); });
    await TestRenderer.act(async () => {
      await field(r, 'Something to pick up').props.onSubmitEditing();
      await field(r, 'Something to pick up').props.onBlur();
    });

    expect(mock_updateSnag).toHaveBeenCalledTimes(1);
    expect(mock_updateSnag).toHaveBeenCalledWith('s1', { parts: ['Hinge'] });
  });

  it('adds when the box is left with a word in it', async () => {
    mock_updateSnag.mockClear();
    mock_updateSnag.mockResolvedValue(snag({ parts: ['Seal'] }));
    const r = await arrange(snag({ parts: [] }));

    await TestRenderer.act(async () => { field(r, 'Something to pick up').props.onChangeText('Seal'); });
    await TestRenderer.act(async () => { await field(r, 'Something to pick up').props.onBlur(); });
    expect(mock_updateSnag).toHaveBeenCalledWith('s1', { parts: ['Seal'] });
  });
});

// ─── the photos, and the top of the page ─────────────────────────────────────

describe('the top of the page', () => {
  const pressables = (r: ReturnType<typeof render>, label: string) => r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
      && !!n.props?.onPress,
    { deep: true },
  );

  // Both ways in sit under the headline as pills, never on the photo.
  it('offers the camera and the library as pills, never over the photo', async () => {
    const r = await arrange(snag({ photoPaths: ['h/a.jpg', 'h/b.jpg'] }));
    expect(r.queryByText('Take photo')).not.toBeNull();
    expect(r.queryByText('Choose photos')).not.toBeNull();
    const doors = pressables(r, 'Open this photo');
    expect(doors.length).toBeGreaterThan(0);
    for (const door of doors) {
      expect(door.findAll((n: any) => n.props?.accessibilityLabel === 'Take a photo', { deep: true }))
        .toEqual([]);
    }
  });

  it('offers both as pills when there is no photo', async () => {
    const r = await arrange(snag({ photoPaths: [] }));
    expect(r.queryByText('Take photo')).not.toBeNull();
    expect(r.queryByText('Choose photos')).not.toBeNull();
  });

  // Your own job filed by you tells you nothing; somebody else filing it is
  // the only way you would know, with no notifications.
  it('says who filed it only when it was somebody else', async () => {
    const mine = await arrange(snag({ reporterId: 'me', reporterName: 'Me' }));
    expect(mine.queryByText('Added by you')).toBeNull();

    const theirs = await arrange(snag({ reporterId: 'sam', reporterName: 'Sam' }));
    expect(theirs.queryByText('Added by Sam')).not.toBeNull();
  });

  it('keeps when a repeat was last done', async () => {
    const r = await arrange(snag({ repeatDays: 30, dueAt: ahead(20), lastDoneAt: '2026-09-01T00:00:00Z' }));
    const said = r.getAllByType('Text').map((n: any) => String(n.props.children ?? '')).join(' ');
    expect(said).toContain('Last done');
  });

  it('shows the room as a pill that says it opens', async () => {
    const r = await arrange(snag({ room: 'Kitchen' }));
    const door = byLabel(r, 'In the Kitchen — change it');
    expect(door.findAll((n: any) => n.props?.name === 'chevron-down', { deep: true }).length)
      .toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- repeats
//
// A one-off job has no due date any more: the date box and its two quick dates
// came off the page by the owner's decision (September 2026). What still has a
// date is a job that comes round, and the Repeats row — the page's last thing —
// is what sets it: one row stating the answer, opening a sheet that is *Never*
// or *Every [n] [days · weeks · months · years]*. Taps write when pressed, the
// number when it is left, and there is no line of prose under it.

describe('repeats, and no due date', () => {
  const texts = (r: ReturnType<typeof render>) =>
    r.getAllByType('Text').map((n: any) => String(n.props.children ?? ''));

  /** The Repeats row on the page — its label carries the answer. */
  const repeatsRow = (r: ReturnType<typeof render>) => r.root.findAll(
    (n: any) => typeof n.type !== 'string' && !!n.props?.onPress
      && typeof n.props?.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Repeats:'),
    { deep: true },
  )[0];

  /** A radio in the sheet — Never, Every, or a unit — by its words. Absent while the sheet is shut. */
  const radio = (r: ReturnType<typeof render>, label: string) => r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityRole === 'radio'
      && n.props?.accessibilityLabel === label && !!n.props?.onPress,
    { deep: true },
  )[0];
  const lit = (node: any) => node.props.accessibilityState.selected;

  /** The number box, looked up fresh each time because every keystroke re-renders it. */
  const box = (r: ReturnType<typeof render>) => r.root.findAll(
    (n: any) => typeof n.type !== 'string' && !!n.props?.onChangeText
      && n.props?.accessibilityLabel === 'How many',
    { deep: true },
  )[0];

  const openRepeats = async (r: ReturnType<typeof render>) => { await press(repeatsRow(r)); };
  const typeIn = async (r: ReturnType<typeof render>, text: string) => {
    await TestRenderer.act(async () => { box(r).props.onChangeText(text); });
  };
  const leave = async (r: ReturnType<typeof render>) => {
    await TestRenderer.act(async () => { await box(r).props.onBlur(); });
  };
  const done = async (r: ReturnType<typeof render>) => {
    const all = r.root.findAll((n: any) => typeof n.type !== 'string'
      && n.props?.accessibilityLabel === 'Done' && !!n.props?.onPress, { deep: true });
    await press(all[all.length - 1]);
  };

  it('has no date box and no quick dates, repeating or not', async () => {
    for (const row of [snag({ repeatDays: null, dueAt: null }), snag({ repeatDays: 180, dueAt: ahead(30) })]) {
      const r = await arrange(row);
      expect(r.queryByText("When's it due?")).toBeNull();
      expect(button(r, 'This weekend')).toBeUndefined();
      expect(button(r, 'Next week')).toBeUndefined();
      const dateBoxes = r.root.findAll((n: any) => typeof n.type !== 'string'
        && n.props?.accessibilityLabel === 'Date' && !!n.props?.onChangeText, { deep: true });
      expect(dateBoxes).toEqual([]);
    }
  });

  // One row saying the answer, and nothing behind a Yes: the sheet is Never,
  // or every so many of a unit — never a list of presets.
  it('is one row stating the answer, with Never or every so many behind it', async () => {
    const r = await arrange(snag({ repeatDays: null }));

    expect(repeatsRow(r).props.accessibilityLabel).toBe('Repeats: Never');
    expect(box(r)).toBeUndefined();
    expect(button(r, 'Yes')).toBeUndefined();

    await openRepeats(r);
    expect(lit(radio(r, 'Never'))).toBe(true);
    expect(lit(radio(r, 'Every'))).toBe(false);
    expect(box(r).props.value).toBe('1');
    expect(lit(radio(r, 'month'))).toBe(true);
    expect(radio(r, 'Every 6 months')).toBeUndefined();
    expect(r.queryByText("When's the next one due?")).toBeNull();
  });

  it('sets a repeat when the box is left, not per keystroke, dating it a cycle out', async () => {
    mock_updateSnag.mockClear();
    mock_updateSnag.mockResolvedValue(snag({ repeatDays: 180, dueAt: ahead(180) }));
    const r = await arrange(snag({ repeatDays: null, dueAt: null }));

    await openRepeats(r);
    await typeIn(r, '6');
    expect(mock_updateSnag).not.toHaveBeenCalled();
    expect(lit(radio(r, 'Every'))).toBe(true);

    await leave(r);
    expect(mock_updateSnag).toHaveBeenCalledTimes(1);
    const [, update] = mock_updateSnag.mock.calls[0];
    expect(update.repeatDays).toBe(180);
    expect(Math.round((new Date(update.dueAt).getTime() - Date.now()) / DAY)).toBe(180);
    // The sheet stays open, because the unit may be next.
    expect(box(r)).toBeDefined();
    expect(repeatsRow(r).props.accessibilityLabel).toBe('Repeats: Every 6 months');
  });

  // Return and the blur after it land in one gesture.
  it('writes once when Return and the blur land together', async () => {
    mock_updateSnag.mockClear();
    mock_updateSnag.mockResolvedValue(snag({ repeatDays: 60, dueAt: ahead(60) }));
    const r = await arrange(snag({ repeatDays: null, dueAt: null }));

    await openRepeats(r);
    await typeIn(r, '2');
    await TestRenderer.act(async () => {
      await box(r).props.onSubmitEditing();
      await box(r).props.onBlur();
    });
    expect(mock_updateSnag).toHaveBeenCalledTimes(1);
    expect(mock_updateSnag.mock.calls[0][1].repeatDays).toBe(60);
  });

  it('writes the unit as soon as it is picked, and leaves a set date alone', async () => {
    const due = ahead(30);
    mock_updateSnag.mockClear();
    mock_updateSnag.mockResolvedValue(snag({ repeatDays: 42, dueAt: due }));
    const r = await arrange(snag({ repeatDays: 180, dueAt: due }));

    await openRepeats(r);
    expect(box(r).props.value).toBe('6');
    expect(lit(radio(r, 'months'))).toBe(true);
    await press(radio(r, 'weeks'));
    expect(mock_updateSnag).toHaveBeenCalledWith('s1', { repeatDays: 42, dueAt: due });
  });

  it('leaves a date already set alone when a repeat is chosen', async () => {
    const due = ahead(10);
    mock_updateSnag.mockResolvedValue(snag({ repeatDays: 30, dueAt: due }));
    const r = await arrange(snag({ repeatDays: null, dueAt: due }));

    await openRepeats(r);
    await press(radio(r, 'Every'));
    expect(mock_updateSnag).toHaveBeenCalledWith('s1', { repeatDays: 30, dueAt: due });
  });

  // Tabbing through the box must not start a repeat, and a number that says
  // what is already there is not a change.
  it('writes nothing when the box is left saying what it said', async () => {
    mock_updateSnag.mockClear();
    const r = await arrange(snag({ repeatDays: 180, dueAt: ahead(30) }));

    await openRepeats(r);
    await leave(r);
    await typeIn(r, '6');
    await leave(r);
    await done(r);
    expect(mock_updateSnag).not.toHaveBeenCalled();
    expect(box(r)).toBeUndefined();
  });

  it('writes nothing when a sheet opened on Never is closed untouched', async () => {
    mock_updateSnag.mockClear();
    const r = await arrange(snag({ repeatDays: null, dueAt: null }));

    await openRepeats(r);
    await leave(r);
    await done(r);
    expect(mock_updateSnag).not.toHaveBeenCalled();
  });

  // A repeat with no date never comes round, and with no date box pressing
  // Every is the only way such a row can be given one.
  it('dates a repeat that has no date when Every is pressed', async () => {
    mock_updateSnag.mockResolvedValue(snag({ repeatDays: 180, dueAt: ahead(180) }));
    const r = await arrange(snag({ repeatDays: 180, dueAt: null }));
    expect(texts(r)).toContain('No date yet');

    await openRepeats(r);
    await press(radio(r, 'Every'));
    const [, update] = mock_updateSnag.mock.calls[0];
    expect(update.repeatDays).toBe(180);
    expect(Math.round((new Date(update.dueAt).getTime() - Date.now()) / DAY)).toBe(180);
  });

  // With no box to clear it from, a date a stopped repeat left behind would
  // sit under Due soon and go overdue for ever.
  it('clears the date as well as the repeat on Never, and closes', async () => {
    mock_updateSnag.mockResolvedValue(snag({ repeatDays: null, dueAt: null }));
    const r = await arrange(snag({ repeatDays: 180, dueAt: ahead(30) }));

    await openRepeats(r);
    await press(radio(r, 'Never'));
    expect(mock_updateSnag).toHaveBeenCalledWith('s1', { repeatDays: null, dueAt: null });
    expect(box(r)).toBeUndefined();
  });

  it('writes nothing on Never when there is neither a repeat nor a date', async () => {
    mock_updateSnag.mockClear();
    const r = await arrange(snag({ repeatDays: null, dueAt: null }));

    await openRepeats(r);
    await press(radio(r, 'Never'));
    expect(mock_updateSnag).not.toHaveBeenCalled();
  });

  // A heat pump serviced every two years arrives from the thing page with 730
  // days; the sheet says it the way the row does.
  it('opens on the cycle the job carries, said the way the row says it', async () => {
    const r = await arrange(snag({ repeatDays: 730, dueAt: ahead(30) }));
    expect(repeatsRow(r).props.accessibilityLabel).toBe('Repeats: Every 2 years');

    await openRepeats(r);
    expect(lit(radio(r, 'Every'))).toBe(true);
    expect(lit(radio(r, 'Never'))).toBe(false);
    expect(box(r).props.value).toBe('2');
    expect(lit(radio(r, 'years'))).toBe(true);
  });

  it('keeps weeks as weeks', async () => {
    const r = await arrange(snag({ repeatDays: 56, dueAt: ahead(30) }));
    expect(repeatsRow(r).props.accessibilityLabel).toBe('Repeats: Every 8 weeks');

    await openRepeats(r);
    expect(box(r).props.value).toBe('8');
    expect(lit(radio(r, 'weeks'))).toBe(true);
  });

  // Nothing else on the page shows the day any more, so the row does — the
  // local day, day first, never just the month. And the sheet carries no line
  // of prose, by the owner's decision.
  it('states the day it is next due on the row, and nothing under the choices', async () => {
    const r = await arrange(snag({ repeatDays: 180, dueAt: '2026-11-08T00:00:00.000' }));
    expect(texts(r)).toContain('Next due 08/11/2026');

    await openRepeats(r);
    const said = texts(r).join(' ');
    expect(said).not.toContain('Due soon');
    expect(said).not.toContain('reminders');
  });

  // Leaving writes what is still in a box — the sheet's Done included, since a
  // press does not reliably blur a box on native.
  it('writes a number still in the box when the sheet is closed', async () => {
    mock_updateSnag.mockClear();
    mock_updateSnag.mockResolvedValue(snag({ repeatDays: 90, dueAt: ahead(90) }));
    const r = await arrange(snag({ repeatDays: null, dueAt: null }));

    await openRepeats(r);
    await typeIn(r, '3');
    await done(r);
    expect(mock_updateSnag).toHaveBeenCalledTimes(1);
    expect(mock_updateSnag.mock.calls[0][1].repeatDays).toBe(90);
    expect(box(r)).toBeUndefined();
  });

  it('refuses a number that cannot be a repeat, in words, and stays open', async () => {
    mock_updateSnag.mockClear();
    const r = await arrange(snag({ repeatDays: null, dueAt: null }));

    await openRepeats(r);
    await typeIn(r, '');
    await leave(r);
    expect(texts(r)).toContain('Type how many');
    await done(r);
    expect(box(r)).toBeDefined();

    await typeIn(r, '11');
    await press(radio(r, 'years'));
    expect(texts(r)).toContain('Ten years is the longest');
    expect(mock_updateSnag).not.toHaveBeenCalled();
  });

  // A refusal is a fact about the press, so it is said where the press was,
  // with the sheet still open.
  it('keeps the sheet open and says why when the write is refused', async () => {
    mock_updateSnag.mockRejectedValueOnce(new Error('Could not save that'));
    const r = await arrange(snag({ repeatDays: null, dueAt: null }));

    await openRepeats(r);
    await press(radio(r, 'Every'));
    expect(box(r)).toBeDefined();
    expect(texts(r)).toContain('Could not save that');
  });
});

// ------------------------------------------------------------------ leaving
//
// Leaving saves. The page had a Save that mostly read Close, beside a back
// arrow that already did the same; every control here writes when pressed, so
// the only thing it could be waiting on is the shopping box — and the page now
// commits that itself on the way out, and before Mark done.

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

  it('says a typed item will be kept on the way out', async () => {
    const r = await arrange(snag({ parts: [] }));
    await TestRenderer.act(async () => {
      field(r, 'Something to pick up').props.onChangeText('Hinge');
    });
    expect(texts(r)).toContain('1 unsaved change — kept when you leave');
  });

  it('writes a pending item in one call, then goes', async () => {
    mock_updateSnag.mockClear();
    mock_updateSnag.mockResolvedValue(snag());
    const r = await arrange(snag({ parts: [] }));

    await TestRenderer.act(async () => {
      field(r, 'Something to pick up').props.onChangeText('Hinge');
    });
    const { prevented, action } = await leave();

    expect(prevented).toBe(true);
    expect(mock_updateSnag).toHaveBeenCalledTimes(1);
    expect(mock_updateSnag).toHaveBeenCalledWith('s1', { parts: ['Hinge'] });
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
});

// ------------------------------------------------------------- what reads first
//
// The conversation first — the notes, and asking SnagHQ directly under them —
// then what to get and what it is about, then whether it comes round, then the
// one state change a person makes by hand. The owner's order, from the preview.
describe('the order down the page', () => {
  it('reads the talk, then what to get, then what it is about, then the repeat', async () => {
    const r = await arrange(snag({ room: 'Bathroom', repeatDays: null }));

    // Flattened, in case a heading renders as an array of children and
    // `String(children)` would come back with a comma in it.
    const flat = (node: any): string =>
      (node.children ?? []).map((c: any) => (typeof c === 'string' ? c : flat(c))).join('');

    const wanted = ['Notes', 'Ask SnagHQ about this', 'Items and shopping', 'Add to shopping list',
      'Linked items', 'Repeats'];
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
  // The room is named, and says so when it is missing. The date is stated only
  // when there is one — a repeat's — and never asked for: nothing on the page
  // gives a one-off job a date, so a *No date* chip would be a door to nowhere.
  it('names the room, and the date only when there is one', async () => {
    const dated = await arrange(snag({ dueAt: ahead(3), repeatDays: 30, room: 'Bathroom' }));
    expect(dated.queryByText('Bathroom')).not.toBeNull();
    expect(dated.queryByText('Due in 3 days')).not.toBeNull();

    const bare = await arrange(snag({ dueAt: null, room: null }));
    expect(bare.queryByText('No date')).toBeNull();
    expect(bare.queryByText('No room')).not.toBeNull();
  });

  // Stated, never offered: the badge is not a control, and nothing up here
  // asks for a date.
  it('offers no way to date the job from the top', async () => {
    const r = await arrange(snag({ dueAt: ahead(3), repeatDays: 30 }));
    expect(byLabel(r, 'Give it a date')).toBeUndefined();
    expect(byLabel(r, "Change when it's due")).toBeUndefined();
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
    // `Mark done` at the foot is the one control that changes the status, and
    // it is found here because a Button now names itself to a screen reader.
    // Compared as labels: a failure printing whole instances runs out of heap.
    const labels = [...new Set(pressables.map((n: any) => n.props.accessibilityLabel))];
    expect(labels).toEqual(['Mark done']);
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

  const noteBox = (r: ReturnType<typeof render>) => r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === 'Add a note'
      && !!n.props?.onChangeText,
    { deep: true },
  )[0];

  // One line at rest, four the moment it is used — the card was mostly empty
  // box on a page that is mostly read.
  it('rests as one line and opens to four when tapped', async () => {
    const r = await arrange();
    expect(r.queryByText('Add note')).toBeNull();
    expect(noteBox(r).props.numberOfLines).toBe(1);

    await TestRenderer.act(async () => { noteBox(r).props.onFocus(); });
    expect(noteBox(r).props.numberOfLines).toBe(4);
    expect(r.queryByText('Add note')).not.toBeNull();
  });

  it('stays open while it holds words, and never sends on leaving the box', async () => {
    const r = await arrange();
    await TestRenderer.act(async () => { noteBox(r).props.onFocus(); });
    await TestRenderer.act(async () => { noteBox(r).props.onChangeText('Ordered the seal'); });
    await TestRenderer.act(async () => { noteBox(r).props.onBlur(); });

    expect(r.queryByText('Add note')).not.toBeNull();
    expect(mock_addComment).not.toHaveBeenCalled();
  });

  // A word, not a glyph. A 48px square centred against a four-line box is a
  // chat affordance, and this is not a chat.
  it('commits with a labelled control under the box, not a send arrow', async () => {
    const r = await arrange();
    await TestRenderer.act(async () => { noteBox(r).props.onFocus(); });

    const send = byLabel(r, 'Add note');
    const arrows = send.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.name === 'arrow-up',
      { deep: true },
    );
    expect(arrows).toEqual([]);
  });

  // The question the job page review left open: a half-typed note used to be
  // dropped on leaving. It is kept on this device instead — never sent, since a
  // note is a message and `add_comment` starts the job.
  describe('a note not yet added', () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    beforeEach(async () => { await AsyncStorage.clear(); });

    const type = async (r: ReturnType<typeof render>, text: string) => {
      await TestRenderer.act(async () => { noteBox(r).props.onFocus(); });
      await TestRenderer.act(async () => { noteBox(r).props.onChangeText(text); });
      await TestRenderer.act(async () => { noteBox(r).props.onBlur(); });
    };

    it('is kept on the device and put back when the job is opened again', async () => {
      const first = await arrange();
      await type(first, 'Ordered the seal from');
      first.unmount();

      const again = await arrange();
      expect(noteBox(again).props.value).toBe('Ordered the seal from');
      expect(mock_addComment).not.toHaveBeenCalled();
    });

    it('is forgotten once it is added', async () => {
      const first = await arrange();
      await type(first, 'Ordered the seal');
      await TestRenderer.act(async () => { await byLabel(first, 'Add note').props.onPress(); });
      expect(mock_addComment).toHaveBeenCalledWith(snag().id, 'Ordered the seal');
      first.unmount();

      const again = await arrange();
      expect(noteBox(again).props.value).toBe('');
    });

    it('is named in the footer rather than claimed as saved', async () => {
      const r = await arrange();
      await type(r, 'Ordered the seal');
      expect(r.queryByText('Note not added yet — kept on this device')).not.toBeNull();
      expect(r.queryByText('All changes saved')).toBeNull();
    });
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

  // One outlined button, never a card of suggested questions — and outlined
  // because Mark done is the one filled button on the page.
  it('offers one outlined button, under the notes, when nobody has asked', async () => {
    const r = await arrange();
    const ask = button(r, 'Ask SnagHQ about this');
    expect(ask).toBeDefined();
    expect(ask.props.variant).toBe('outline');
    expect(r.queryByText('Asked SnagHQ')).toBeNull();

    const order = r.getAllByType('Text').map((n: any) => String(n.props.children ?? ''));
    expect(order.indexOf('Notes')).toBeGreaterThan(-1);
    expect(order.indexOf('Ask SnagHQ about this')).toBeGreaterThan(order.indexOf('Notes'));
    expect(order.indexOf('Ask SnagHQ about this')).toBeLessThan(order.indexOf('Items and shopping'));
    expect(order.indexOf('Ask SnagHQ about this')).toBeLessThan(order.indexOf('Repeats'));
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
    await press(button(r, 'Ask SnagHQ about this'));
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

describe('asking SnagHQ, switched off', () => {
  beforeEach(() => { process.env.EXPO_PUBLIC_ASK_SNAGHQ = 'off'; });
  afterEach(() => { process.env.EXPO_PUBLIC_ASK_SNAGHQ = 'on'; });

  it('offers no button, shows no question and never reads one', async () => {
    mock_getSupport.mockClear();
    mock_getSupport.mockResolvedValue({
      id: 'r1', snagId: 's1', status: 'waiting', question: 'Why does it run?',
      createdAt: new Date().toISOString(), waitingSince: new Date().toISOString(),
      firstSeenAt: null, lastStaffReplyAt: null, closedAt: null, closedBy: null, messages: [],
    });
    const r = await arrange();
    expect(r.queryByText('Ask SnagHQ about this')).toBeNull();
    expect(r.queryByText('Asked SnagHQ')).toBeNull();
    expect(mock_getSupport).not.toHaveBeenCalled();
    expect(r.queryByText('Notes')).not.toBeNull();
  });
});
