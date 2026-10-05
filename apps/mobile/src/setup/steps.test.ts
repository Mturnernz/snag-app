import { readFileSync } from 'fs';
import { join } from 'path';

import {
  SETUP_BASELINE, SETUP_STEPS, expectedStepCount, flowMode, isPending, nextStep, pendingSteps,
  seenThisRun, type SetupContext, type SetupStep,
} from './steps';
import type { Household, Profile } from '../types';

// The registry is the whole of first-run setup, and these are the rules that
// keep it in step with what the database remembers and with whatever gets
// added to it next. Properties rather than screenshots: the next step somebody
// adds should fail here, not in a household.

const profile = (seen: string[] = [], name = 'Alyssa'): Profile => ({
  id: 'me', displayName: name, createdAt: '2026-09-01T00:00:00Z', projectsEnabled: true, setupSeen: seen,
});
const HOUSE = { id: 'h', name: '32 Le Roy' } as Household;

const ctx = (over: Partial<SetupContext> = {}): SetupContext => ({
  profile: null, household: null, memberCount: 0, ...over,
});
const ids = (steps: SetupStep[]) => steps.map((s) => s.id);
const none = new Set<string>();

// Every id that has ever shipped. An id is stored in profiles.setup_seen, so
// renaming one asks everybody the question again and reusing one makes a new
// question look answered. Add to this list; never edit what is already on it.
const EVER_SHIPPED = ['name', 'household', 'rooms', 'invite'];

describe('the ids', () => {
  it('are unique', () => {
    expect(new Set(ids(SETUP_STEPS)).size).toBe(SETUP_STEPS.length);
  });

  it('are all ones that have shipped, and every shipped one is still here', () => {
    expect(ids(SETUP_STEPS).sort()).toEqual([...EVER_SHIPPED].sort());
  });
});

describe('what keeps a new step in sync', () => {
  // The baseline was written into the migration that backfilled existing
  // accounts, so it is what "already set up" means. A step added later must
  // not join it — being absent from the backfill is how existing people get
  // asked the new question.
  it('the migration marked existing accounts with exactly the baseline steps', () => {
    const sql = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations',
        '20260929060443_setup_is_a_list_of_steps.sql'),
      'utf8'
    );
    const backfill = sql.match(/set setup_seen = array\[([^\]]*)\]/);
    expect(backfill).not.toBeNull();
    const marked = backfill![1].split(',').map((s) => s.trim().replace(/'/g, ''));
    const baseline = SETUP_STEPS.filter((s) => s.since === SETUP_BASELINE).map((s) => s.id);
    expect(marked.sort()).toEqual(baseline.sort());
  });

  it('a later step says what is new, for the catch-up run to open with', () => {
    for (const step of SETUP_STEPS.filter((s) => s.since > SETUP_BASELINE)) {
      expect(step.whatsNew?.trim()).toBeTruthy();
    }
  });

  it('a step that can be put off says where it can be done later', () => {
    for (const step of SETUP_STEPS.filter((s) => s.skippable)) {
      expect(step.changeLater?.trim()).toBeTruthy();
    }
  });

  it('`since` never goes backwards down the list', () => {
    const since = SETUP_STEPS.map((s) => s.since);
    expect(since).toEqual([...since].sort((a, b) => a - b));
  });
});

describe('who is asked what', () => {
  it('a brand-new account is asked its name and its house first', () => {
    expect(ids(pendingSteps(ctx(), none))).toEqual(['name', 'household']);
  });

  it('with a house of its own and nobody else in it, the rooms and the invite follow', () => {
    const c = ctx({ profile: profile(['name', 'household']), household: HOUSE, memberCount: 1 });
    expect(ids(pendingSteps(c, new Set(['name', 'household'])))).toEqual(['rooms', 'invite']);
  });

  // The second person arrived by invitation. They may know about the room the
  // first one forgot, but asking them to invite the first is the flow not
  // knowing who it is talking to.
  it('a joiner sees the rooms and is never asked to bring somebody in', () => {
    const c = ctx({ profile: profile(), household: HOUSE, memberCount: 2 });
    expect(ids(pendingSteps(c, none))).toEqual(['rooms']);
  });

  it('somebody already set up is asked nothing', () => {
    const c = ctx({ profile: profile(EVER_SHIPPED), household: HOUSE, memberCount: 1 });
    expect(pendingSteps(c, new Set(EVER_SHIPPED))).toEqual([]);
  });

  it('a step put off with Set up later is not asked again', () => {
    const c = ctx({ profile: profile(), household: HOUSE, memberCount: 1 });
    const rooms = SETUP_STEPS.find((s) => s.id === 'rooms')!;
    expect(isPending(rooms, c, new Set(['rooms']))).toBe(false);
  });

  // A flag must not wave anybody through a question the data says is
  // unanswered: somebody who saved a name and was then removed from their
  // household is asked about a house again, whatever setup_seen holds.
  it('a required step is asked until the data answers it, whatever was seen', () => {
    const c = ctx({ profile: profile(EVER_SHIPPED) });
    expect(ids(pendingSteps(c, new Set(EVER_SHIPPED)))).toEqual(['household']);
  });

  it('a name of only spaces is not a name', () => {
    expect(ids(pendingSteps(ctx({ profile: profile([], '   ') }), none))).toContain('name');
  });
});

describe('a step added after people have set up', () => {
  const later: SetupStep = {
    // Not a real id — the union only holds shipped ones — because the rules
    // are what is under test, not any particular question.
    id: 'later-step' as never,
    since: SETUP_BASELINE + 1,
    applies: () => true,
    answered: () => false,
    skippable: true,
    needsHousehold: false,
    whatsNew: 'Something new',
    changeLater: 'somewhere',
  };
  const withLater = [...SETUP_STEPS, later];
  const setUp = ctx({ profile: profile(EVER_SHIPPED), household: HOUSE, memberCount: 2 });

  it('reaches somebody who set up before it — and only it', () => {
    expect(ids(pendingSteps(setUp, new Set(EVER_SHIPPED), withLater))).toEqual(['later-step']);
  });

  it('is a catch-up run, not a first run', () => {
    expect(flowMode(pendingSteps(setUp, new Set(EVER_SHIPPED), withLater))).toBe('catch-up');
  });

  it('is part of an ordinary first run for somebody new', () => {
    expect(flowMode(pendingSteps(ctx(), none, withLater))).toBe('first-run');
  });

  it('stops being asked once seen', () => {
    const seen = new Set([...EVER_SHIPPED, 'later-step']);
    expect(pendingSteps(setUp, seen, withLater)).toEqual([]);
  });
});

describe('walking the run', () => {
  // Somebody who closed the app after making the house is still on first run:
  // what waits for them is baseline, and a "new things" screen would be a lie.
  it('half way through first run is still first run', () => {
    const c = ctx({ profile: profile(['name', 'household']), household: HOUSE, memberCount: 1 });
    expect(flowMode(pendingSteps(c, new Set(['name', 'household'])))).toBe('first-run');
  });

  it('judges the next step against the data as it now is', () => {
    const before = ctx({ profile: profile() });
    expect(nextStep(before, none, new Set(['name']))?.id).toBe('household');
    // The house exists now; the rooms can be judged.
    const after = ctx({ profile: profile(), household: HOUSE, memberCount: 1 });
    expect(nextStep(after, none, new Set(['name', 'household']))?.id).toBe('rooms');
  });

  it('never shows a step twice in one run', () => {
    const c = ctx({ profile: profile(), household: HOUSE, memberCount: 1 });
    expect(nextStep(c, none, new Set(['name', 'household', 'rooms', 'invite']))).toBeNull();
  });

  // The dots: a person with no house yet will be asked about its rooms and
  // about bringing somebody in, so both are counted before they can be judged.
  it('counts the steps still to come before there is a house to judge them by', () => {
    expect(expectedStepCount(ctx(), none, none)).toBe(4);
    expect(expectedStepCount(ctx({ profile: profile() }), none, new Set(['name']))).toBe(4);
  });

  it('drops the invite from the count once it turns out not to apply', () => {
    const joiner = ctx({ profile: profile(), household: HOUSE, memberCount: 2 });
    expect(expectedStepCount(joiner, none, new Set(['name', 'household']))).toBe(3);
  });
});

// The house steps are about a house, not a person. miketsturner had seen the
// rooms and the invite for a house since deleted, so a new one was named and
// nothing was left to ask: no rooms, no invite, no *You're all set*. The same
// holds for a home added in the app, which is a new house just the same.
describe('a run for a new house', () => {
  const before = new Set(EVER_SHIPPED);

  it('asks the rooms and the invite for the new house, whatever was seen for an old one', () => {
    const seen = seenThisRun(before, true);
    const made = ctx({ profile: profile(EVER_SHIPPED), household: HOUSE, memberCount: 1 });
    expect(nextStep(made, seen, new Set(['household']))?.id).toBe('rooms');
    expect(nextStep(made, seen, new Set(['household', 'rooms']))?.id).toBe('invite');
  });

  // *Add another home* starts the run with the house already made: nothing is
  // done yet, and the first thing asked is its rooms.
  it('opens on the rooms when the house was added before the run began', () => {
    const added = ctx({ profile: profile(EVER_SHIPPED), household: HOUSE, memberCount: 1 });
    expect(ids(pendingSteps(added, seenThisRun(before, true)))).toEqual(['rooms', 'invite']);
    expect(flowMode(pendingSteps(added, seenThisRun(before, true)))).toBe('first-run');
  });

  it('still never asks the name again, which is about the person', () => {
    const seen = seenThisRun(before, true);
    expect(seen.has('name')).toBe(true);
    expect(seen.has('household')).toBe(true);
  });

  it('forgets exactly the steps that need a house, so a later one is covered too', () => {
    const houseSteps = SETUP_STEPS.filter((s) => s.needsHousehold).map((s) => s.id);
    const seen = seenThisRun(before, true);
    for (const id of EVER_SHIPPED) expect(seen.has(id)).toBe(!houseSteps.includes(id as never));
  });

  it('counts the house steps in the dots before the house exists', () => {
    const c = ctx({ profile: profile(EVER_SHIPPED) });
    expect(expectedStepCount(c, seenThisRun(before, true), none)).toBe(3);
  });

  // A catch-up, or a first run picked up after the house was made, is about
  // the house already there: what was seen of it stays seen.
  it('keeps what was seen when the run is for the house already there', () => {
    expect([...seenThisRun(before, false)].sort()).toEqual([...EVER_SHIPPED].sort());
    const c = ctx({ profile: profile(EVER_SHIPPED), household: HOUSE, memberCount: 1 });
    expect(pendingSteps(c, seenThisRun(before, false))).toEqual([]);
  });
});
