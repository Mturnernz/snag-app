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
const mock_setSnagThings = jest.fn().mockResolvedValue(undefined);
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
  setSnagThings: (...a: unknown[]) => mock_setSnagThings(...a),
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
    await press(topButton(r, 'Save'));

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

    expect(topButton(r, 'Save').props.disabled).toBe(true);
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

  it('offers to link, and reads nothing, when the job is about nothing', async () => {
    mock_getThings.mockClear();
    const r = await arrange(snag({ linkedThings: [] }));

    expect(byLabel(r, 'Link an appliance or fixture')).toBeDefined();
    // A once-in-a-job's-life decision must not cost a request on every visit to
    // a page people open constantly.
    expect(mock_getThings).not.toHaveBeenCalled();
  });

  it('shows what is linked, counted, with the number somebody came for', async () => {
    const r = await arrange(snag({
      linkedThings: [linked(), linked({ id: 't2', name: 'Extractor fan', model: 'XF12' })],
    }));

    expect(r.queryByText('Linked assets (2)')).not.toBeNull();
    expect(r.queryByText('Mitsubishi MSZ-AP50VGK')).not.toBeNull();
    expect(byLabel(r, 'Open Heat pump')).toBeDefined();
    // Never the whole inventory: only what the job says it is about.
    expect(byLabel(r, 'Link an appliance or fixture')).toBeUndefined();
  });

  it('opens the record only when the picker is asked for', async () => {
    mock_getThings.mockClear();
    mock_getThings.mockResolvedValue([]);
    const r = await arrange(snag({ linkedThings: [] }));

    await press(byLabel(r, 'Link an appliance or fixture'));
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

  // The due-date field sits directly above this card, so stating the day here
  // too put it on screen twice a card apart — which read as two date controls
  // stacked. This says only the part that field cannot: what happens next.
  it('says what happens next without repeating the date', async () => {
    const r = await arrange(snag({ repeatDays: 180, dueAt: '2026-11-08T00:00:00.000Z' }));
    const said = r.getAllByType('Text').map((n: any) => String(n.props.children ?? ''));

    expect(said.some((t: string) => t.includes('every 6 months'))).toBe(true);
    expect(said.some((t: string) => t.includes('8/11/2026') || t.includes('11/8/2026'))).toBe(false);
  });

  it('clears the repeat on No rather than opening anything', async () => {
    mock_updateSnag.mockResolvedValue(snag({ repeatDays: null }));
    const r = await arrange(snag({ repeatDays: 180 }));

    await press(button(r, 'No'));
    expect(mock_updateSnag).toHaveBeenCalledWith('s1', { repeatDays: null });
  });
});

// ------------------------------------------------------------------ saving
//
// It closes; it does not collect. Every control on this page still writes when
// it is pressed — triage is a series of small independent decisions, and a
// Save that held them would turn sorting twelve jobs into forty taps and put
// the tick you make in a shop aisle behind a second press.
//
// What it adds is a way out that reads as finished, and the page finally
// saying that the taps landed.

describe('the Save button', () => {
  const texts = (r: ReturnType<typeof render>) =>
    r.getAllByType('Text').map((n: any) => String(n.props.children ?? ''));

  const field = (r: ReturnType<typeof render>, label: string) =>
    r.root.findAll(
      (n: any) => typeof n.type !== 'string' && !!n.props?.onChangeText
        && n.props?.accessibilityLabel === label,
      { deep: true },
    )[0];

  it('sits on the page and returns to the list', async () => {
    const r = await arrange();
    await press(button(r, 'Close'));
    expect(mock_goBack).toHaveBeenCalled();
  });

  it('writes nothing of its own when nothing was typed', async () => {
    mock_updateSnag.mockClear();
    const r = await arrange();
    await press(button(r, 'Close'));
    expect(mock_updateSnag).not.toHaveBeenCalled();
  });

  // A button reading Save over a line reading "All changes saved" is the page
  // contradicting itself — and one that looks like an outstanding obligation
  // gets reached for on autopilot, which is what puts a thumb next to Mark
  // done. The word comes off the same count the hint does, so the two cannot
  // say different things about one fact.
  it('says Close while nothing is pending, and Save once something is', async () => {
    const r = await arrange(snag({ dueAt: null }));
    expect(button(r, 'Close')).toBeDefined();
    expect(texts(r)).toContain('All changes saved');

    await TestRenderer.act(async () => {
      field(r, "When's it due?").props.onChangeText('8/11/2026');
    });

    expect(button(r, 'Save')).toBeDefined();
    expect(r.root.findAll(
      (n: any) => typeof n.type !== 'string' && n.props?.label === 'Close',
    )).toEqual([]);
  });

  // The whole point of the pair. Two full-width solid fern buttons stacked at
  // the foot were told apart by nothing but their words; only one of them has
  // a consequence, and only that one keeps the brand's colour.
  it('leaves the solid fern to Mark done and goes tonal itself', async () => {
    const r = await arrange();

    expect(button(r, 'Close').props.variant).toBe('secondary');
    // Mark done takes the default, which is the filled primary.
    expect(button(r, 'Mark done').props.variant).toBeUndefined();
  });

  it('says the taps already landed', async () => {
    const r = await arrange();
    expect(texts(r)).toContain('All changes saved');
  });

  // Two boxes hold typed text — the date, and the item being added to the
  // shopping list — so those are the only branches in which "All changes
  // saved" would be a lie. The wording is the thing page's, so two screens do
  // not invent two for the same fact.
  it('admits when a typed date is still behind the row', async () => {
    const r = await arrange(snag({ dueAt: null }));
    await TestRenderer.act(async () => {
      field(r, "When's it due?").props.onChangeText('8/11/2026');
    });

    expect(texts(r)).toContain('1 unsaved change');
    expect(texts(r)).not.toContain('All changes saved');
  });

  it('counts both boxes', async () => {
    const r = await arrange(snag({ dueAt: null }));
    await TestRenderer.act(async () => {
      field(r, "When's it due?").props.onChangeText('8/11/2026');
    });
    await TestRenderer.act(async () => {
      field(r, 'Something to pick up').props.onChangeText('Hinge');
    });

    expect(texts(r)).toContain('2 unsaved changes');
  });

  // The item half-typed into the shopping box has no blur commit at all — it
  // waits on the + beside it — so without this, Save is the one button on the
  // page that silently discards what somebody typed.
  it('adds an item left sitting in the shopping box', async () => {
    mock_updateSnag.mockClear();
    mock_updateSnag.mockResolvedValue(snag({ parts: ['Hinge'] }));
    const r = await arrange(snag({ parts: [] }));

    await TestRenderer.act(async () => {
      field(r, 'Something to pick up').props.onChangeText('Hinge');
    });
    await press(button(r, 'Save'));

    const [, update] = mock_updateSnag.mock.calls[0];
    expect(update.parts).toEqual(['Hinge']);
    expect(mock_goBack).toHaveBeenCalled();
  });

  // Two round trips and two re-reads for one press is the thing `addPhotos`
  // and `create_snag`'s own date already refuse.
  it('writes a pending date and a pending item in one call', async () => {
    mock_updateSnag.mockClear();
    mock_updateSnag.mockResolvedValue(snag());
    const r = await arrange(snag({ dueAt: null, parts: [] }));

    await TestRenderer.act(async () => {
      field(r, "When's it due?").props.onChangeText('8/11/2026');
    });
    await TestRenderer.act(async () => {
      field(r, 'Something to pick up').props.onChangeText('Hinge');
    });
    await press(button(r, 'Save'));

    expect(mock_updateSnag).toHaveBeenCalledTimes(1);
    const [, update] = mock_updateSnag.mock.calls[0];
    expect(update.parts).toEqual(['Hinge']);
    expect(new Date(update.dueAt).getDate()).toBe(8);
  });

  // Closing over a failed write would read as having saved.
  it('stays put when the write fails', async () => {
    mock_updateSnag.mockClear();
    mock_updateSnag.mockRejectedValue(new Error('Network'));
    const r = await arrange(snag({ parts: [] }));

    await TestRenderer.act(async () => {
      field(r, 'Something to pick up').props.onChangeText('Hinge');
    });
    await press(button(r, 'Save'));

    expect(mock_goBack).not.toHaveBeenCalled();
  });

  it('stays put on a date no calendar has, keeping the words in the box', async () => {
    mock_updateSnag.mockClear();
    const r = await arrange(snag({ dueAt: null }));

    await TestRenderer.act(async () => {
      field(r, "When's it due?").props.onChangeText('31/02/2026');
    });
    await press(button(r, 'Save'));

    expect(mock_updateSnag).not.toHaveBeenCalled();
    expect(mock_goBack).not.toHaveBeenCalled();
    expect(field(r, "When's it due?").props.value).toBe('31/02/2026');
  });

  // `onBlur` is not guaranteed to have fired — on native, pressing a Pressable
  // does not reliably blur a TextInput — so Save must not be the one button
  // here that discards what somebody typed.
  it('commits a typed date that was never blurred', async () => {
    mock_updateSnag.mockClear();
    mock_updateSnag.mockResolvedValue(snag({ dueAt: '2026-11-08T00:00:00.000Z' }));
    const r = await arrange(snag({ dueAt: null }));

    await TestRenderer.act(async () => {
      field(r, "When's it due?").props.onChangeText('8/11/2026');
    });
    await press(button(r, 'Save'));

    const [, update] = mock_updateSnag.mock.calls[0];
    expect(new Date(update.dueAt).getDate()).toBe(8);
    expect(mock_goBack).toHaveBeenCalled();
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

    const wanted = ['Linked assets', 'Anything to pick up?', 'Notes', "When's it due?",
      'Schedule a recurring job'];
    const seen = r.getAllByType('Text')
      .map((n: any) => flat(n).trim())
      .filter((t: string) => wanted.includes(t));

    expect(seen).toEqual(wanted);
  });

  // Finishing is the one state change a person still makes by hand, so it sits
  // at the foot of the content rather than competing with Save in the footer.
  it('puts Mark done below everything it depends on', async () => {
    const r = await arrange(snag({ repeatDays: null }));
    const order = r.getAllByType('Text')
      .map((n: any) => String(n.props.children ?? ''));

    expect(order.indexOf('Mark done')).toBeGreaterThan(order.indexOf('Schedule a recurring job'));
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
