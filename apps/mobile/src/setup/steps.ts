/**
 * First-run setup, as a list of steps rather than a screen.
 *
 * It was one screen — a name, a house name, *Create it* and *Someone else set
 * ours up*, all at once — and that shape had no room to grow: every new thing a
 * new person ought to be asked had to be crammed onto it or never asked at all,
 * and somebody who set up before a question existed never saw it. A phone does
 * this better. One question to a screen, the optional ones with *Set up later*,
 * and after an update, only the screens that are new.
 *
 * So this file is the whole vocabulary, and three rules keep it honest:
 *
 * - **An id is stored, so it is for ever.** `profiles.setup_seen` holds these
 *   strings. Renaming one makes every person who saw it see it again; reusing
 *   one makes a new question look answered. `steps.test.ts` freezes the list.
 * - **Only "has this person been shown it" is stored.** Whether the house has a
 *   name or anybody else is in it is read from the data, never recorded as done
 *   — a flag beside the fact it describes is two writers of one fact.
 * - **A new step says `since` and `whatsNew`.** `since` above the baseline is
 *   what makes a step appear for people who set up before it existed, and
 *   `whatsNew` is the one line the catch-up run opens with. The baseline list in
 *   `20260929090000` is the steps with `since: 1` and must never grow.
 *
 * The screens live in `SetupFlow.tsx`, keyed by these ids in a `Record`, so a
 * step with no screen is a compile error rather than a blank page.
 */
import type { Household, Profile } from '../types';

export type SetupStepId = 'name' | 'household' | 'rooms' | 'invite';

/** The steps that shipped with the flow. Existing accounts were marked as having seen these. */
export const SETUP_BASELINE = 1;

export interface SetupContext {
  profile: Profile | null;
  household: Household | null;
  /** People in the household, this person included. 0 while there is no household. */
  memberCount: number;
}

export interface SetupStep {
  id: SetupStepId;
  /** SETUP_BASELINE for the steps that shipped first; a later step takes the next number. */
  since: number;
  /**
   * Whether the step makes sense for this person at all. Evaluated as the flow
   * goes, so a step that needs a household is judged once there is one.
   */
  applies(ctx: SetupContext): boolean;
  /**
   * Whether the data already holds the answer. A required step is asked until
   * this is true, whatever `setup_seen` says — a person with no name cannot be
   * waved through because a flag says they were asked.
   */
  answered(ctx: SetupContext): boolean;
  /** Offers *Set up later*. A skippable step is pending until it has been seen. */
  skippable: boolean;
  /** Needs a household to be meaningful, so it is judged only once one exists. */
  needsHousehold: boolean;
  /** The one line a catch-up run shows before this step. Required when `since` > baseline. */
  whatsNew?: string;
  /** Where the same answer can be changed afterwards. Required on a skippable step. */
  changeLater?: string;
}

export const SETUP_STEPS: SetupStep[] = [
  {
    id: 'name',
    since: 1,
    applies: () => true,
    answered: (ctx) => !!ctx.profile && ctx.profile.displayName.trim().length > 0,
    skippable: false,
    needsHousehold: false,
  },
  {
    id: 'household',
    since: 1,
    applies: () => true,
    answered: (ctx) => !!ctx.household,
    skippable: false,
    needsHousehold: false,
  },
  {
    id: 'rooms',
    since: 1,
    applies: (ctx) => !!ctx.household,
    answered: () => false,
    skippable: true,
    needsHousehold: true,
    changeLater: 'the You tab, under Location tags',
  },
  {
    id: 'invite',
    since: 1,
    // Only somebody alone in the house is asked to bring somebody in. The
    // second person arrived by invitation; asking them to invite the first is
    // the flow not knowing who it is talking to.
    applies: (ctx) => !!ctx.household && ctx.memberCount <= 1,
    answered: () => false,
    skippable: true,
    needsHousehold: true,
    changeLater: 'the You tab, under your house',
  },
];

/** Whether one step still wants asking. */
export function isPending(step: SetupStep, ctx: SetupContext, seen: ReadonlySet<string>): boolean {
  if (!step.applies(ctx)) return false;
  if (step.answered(ctx)) return false;
  // A required step is asked until the data answers it. A skippable one is
  // asked once: skipping is an answer, and asking again every open would nag.
  if (step.skippable && seen.has(step.id)) return false;
  return true;
}

/** Every step still wanting an answer, in order. What the gate in App.tsx asks. */
export function pendingSteps(
  ctx: SetupContext,
  seen: ReadonlySet<string>,
  steps: SetupStep[] = SETUP_STEPS
): SetupStep[] {
  return steps.filter((step) => isPending(step, ctx, seen));
}

/**
 * The next step to show, judged against the data as it is now.
 *
 * Judged as the flow goes rather than once at the start, because the rooms and
 * the invite cannot be judged until the household step has made a household.
 * `done` is the steps already passed in this run, so a step whose answer the
 * data cannot see (a skippable one) is not shown twice.
 */
export function nextStep(
  ctx: SetupContext,
  seen: ReadonlySet<string>,
  done: ReadonlySet<string>,
  steps: SetupStep[] = SETUP_STEPS
): SetupStep | null {
  return steps.find((step) => !done.has(step.id) && isPending(step, ctx, seen)) ?? null;
}

/**
 * How many steps this run is likely to hold, for the dots at the top.
 *
 * A step that needs a household cannot be judged before there is one, so while
 * there is none it is counted if it has not been seen — a person creating a
 * house will be asked about its rooms. A joiner's count shrinks by one when the
 * invite step turns out not to apply, which is the dots being honest late
 * rather than wrong early.
 */
export function expectedStepCount(
  ctx: SetupContext,
  seen: ReadonlySet<string>,
  done: ReadonlySet<string>,
  steps: SetupStep[] = SETUP_STEPS
): number {
  return steps.filter((step) => {
    if (done.has(step.id)) return true;
    if (step.needsHousehold && !ctx.household) return !seen.has(step.id);
    return isPending(step, ctx, seen);
  }).length;
}

/**
 * First run, or catching up on something new.
 *
 * A catch-up is a run in which nothing from the original set is waiting: every
 * pending step arrived later. It opens on what is new and ends straight back in
 * the app, with no *You're all set* — somebody who has been using Snag for a
 * year is not being welcomed. Somebody who closed the app half way through
 * first run is still on first run, because what is waiting for them is baseline.
 */
export function flowMode(pending: SetupStep[]): 'first-run' | 'catch-up' {
  return pending.length > 0 && pending.every((step) => step.since > SETUP_BASELINE)
    ? 'catch-up'
    : 'first-run';
}
