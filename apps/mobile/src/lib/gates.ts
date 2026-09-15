/**
 * Which of App.tsx's branches the app is on, as a value rather than a ladder of
 * `if`s nothing can assert about.
 *
 * It exists because the ladder got one rung wrong and shipped. The join branch
 * read `joinToken && profile`, which looks right and isn't: somebody who has
 * just scanned a QR has an account and *no profile*, so the branch was skipped
 * and they fell through to `setup` — a screen whose first offer is "Create it"
 * and which says nothing about a code. Alyssa scanned 32 Le Roy's code and made
 * a second household of the same name, alone in it.
 *
 * Nothing could catch that: the branches lived inside a component that mounts a
 * navigator, a provider tree and a Supabase client, so the only way to assert on
 * the order was to render the whole app. Pulled out here it is four arguments
 * and a table.
 */
export type Gate = 'loading' | 'fatal' | 'auth' | 'join' | 'setup' | 'app';

export interface GateState {
  loading: boolean;
  /** A configuration failure — the `home` schema not being exposed. */
  fatal: boolean;
  signedIn: boolean;
  /** A `/join/<token>` code in the address bar. */
  hasJoinToken: boolean;
  hasProfile: boolean;
  hasHousehold: boolean;
}

export function chooseGate(state: GateState): Gate {
  if (state.loading) return 'loading';
  // Before auth: a schema that isn't exposed makes every later question
  // unanswerable, and rendering an empty app is how that reads as "no data".
  if (state.fatal) return 'fatal';
  if (!state.signedIn) return 'auth';
  // **Before setup, and on signedIn rather than hasProfile.** Both halves of
  // that are the fix. A scanner is not setting up a house, so they must never
  // be shown a screen that says they are — JoinScreen asks for their name
  // itself when there isn't one.
  if (state.hasJoinToken) return 'join';
  if (!state.hasProfile || !state.hasHousehold) return 'setup';
  return 'app';
}
