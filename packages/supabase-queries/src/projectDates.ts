/**
 * A project's start and finish, which must not cross.
 *
 * Nothing kept them in order. The status sheet filled an empty *Started* box
 * with today the moment *Complete* was chosen, and never looked at *Finished* —
 * so a roof finished in June 2024 and recorded in September 2026 came out
 * starting two years after it finished. `home.update_project` now refuses that
 * in words; these helpers are what keep a person from ever meeting the refusal.
 *
 * **The box somebody just changed is the one they meant, and the other follows
 * it.** Pull the finish back before the start and the start moves to it; push
 * the start past the finish and the finish moves to it. Refusing instead would
 * be a sheet arguing with somebody about a date they have just told it, and
 * guessing which one is wrong would be worse.
 *
 * Pure, and importing nothing from `index` (which re-exports this file). Both
 * work on ISO days, which compare correctly as strings.
 */

export type ProjectDateBox = 'started' | 'finished';

export interface OrderedProjectDates {
  startedOn: string | null;
  finishedOn: string | null;
  /** Which of the two was moved to meet the other, or null when neither had to. */
  moved: ProjectDateBox | null;
}

/**
 * The pair in order, moving whichever box was not just edited.
 *
 * A missing date on either side leaves both alone: a project that started and
 * has not been given a finish, or finished with nobody saying when it started,
 * is not out of order.
 */
export function orderProjectDates(
  startedOn: string | null,
  finishedOn: string | null,
  edited: ProjectDateBox,
): OrderedProjectDates {
  if (!startedOn || !finishedOn || finishedOn >= startedOn) {
    return { startedOn, finishedOn, moved: null };
  }
  return edited === 'finished'
    ? { startedOn: finishedOn, finishedOn, moved: 'started' }
    : { startedOn, finishedOn: startedOn, moved: 'finished' };
}

/**
 * What an empty *Started* box is filled with when a project is marked going or
 * done: today, unless it has already finished on an earlier day — then that
 * day, because a project cannot have started after it finished.
 */
export function defaultStartDate(finishedOn: string | null, today: string): string {
  return finishedOn && finishedOn < today ? finishedOn : today;
}
