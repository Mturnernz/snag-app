import type { SetupContext } from './steps';
import type { FirstAction } from '../hooks/useFirstCapture';

/** What every step screen is handed by `SetupFlow`. */
export interface StepProps {
  ctx: SetupContext;
  progress: { index: number; total: number };
  /** Absent on the first step of a run: there is nothing to go back to. */
  onBack?: () => void;
  /**
   * Done with this step — answered, or put off. Records it as seen and moves on;
   * the flow works out what comes next from the data as it now stands.
   */
  onNext: () => void;
  /** Re-reads the account in App.tsx, after a write the next step depends on. */
  onReady: () => Promise<void>;
  /** A first name the sign-in already knows (Google's), offered rather than asked. */
  suggestedName?: string | null;
  /** A pasted invite link, handed to the same join question a tapped one reaches. */
  onJoinToken?: (token: string) => void;
  /** The tour's *Try it*: this step is seen, setup ends, and the app opens on that. */
  onTry?: (action: FirstAction) => void;
}

/** The first word of a name: what the other person in the house calls you. */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
