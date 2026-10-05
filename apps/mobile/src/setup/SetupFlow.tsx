import React, { useEffect, useMemo, useRef, useState } from 'react';

import { markSetupSeen } from '../lib/supabase';
import { Household, Profile } from '../types';
import {
  expectedStepCount, flowMode, nextStep, pendingSteps, seenThisRun,
  type SetupContext, type SetupStepId,
} from './steps';
import type { StepProps } from './types';
import AllSet from './AllSet';
import CatchUpIntro from './CatchUpIntro';
import NameStep from './steps/NameStep';
import HouseholdStep from './steps/HouseholdStep';
import RoomsStep from './steps/RoomsStep';
import InviteStep from './steps/InviteStep';

/**
 * Every step's screen, by id. A `Record`, so a step added to `SETUP_STEPS`
 * without a screen is a compile error rather than a blank page.
 */
const SCREENS: Record<SetupStepId, React.ComponentType<StepProps>> = {
  name: NameStep,
  household: HouseholdStep,
  rooms: RoomsStep,
  invite: InviteStep,
};

interface Props {
  profile: Profile | null;
  household: Household | null;
  memberCount: number;
  /**
   * `household` was made a moment ago with *Add another home*, so the run is
   * for it: its rooms and the invite are asked whatever was seen for another
   * house. A run that begins with no house is for a new one anyway.
   */
  newHouse?: boolean;
  /** A first name the sign-in already knows. */
  suggestedName?: string | null;
  /** Re-reads the account in App.tsx. */
  onReady: () => Promise<void>;
  /**
   * The run is on screen. App.tsx keeps it there until `onFinish`, even once
   * nothing is pending: making a house answers the last required step, and the
   * gate letting the app in at that moment is what cut the run off at the name.
   */
  onStart?: () => void;
  onJoinToken?: (token: string) => void;
  /** The run is over. Carries the photograph from *Snap your first job*, if one was taken. */
  onFinish: (firstPhoto: string | null) => void;
}

type Screen = SetupStepId | 'intro' | 'all-set' | null;

/**
 * First-run setup, one question at a time — and, when a later change adds a
 * question, just that question for everybody who set up before it.
 *
 * What to ask is never decided here. `steps.ts` says which steps exist and
 * which still want an answer, judged against the data as it stands; this only
 * walks them in order, keeps a back stack, and records each one as seen as it
 * is left. It stays mounted while App.tsx re-reads the account after a write —
 * the gate keeps it on screen from `onStart` until `onFinish`, whatever is
 * pending in between — so making the house half way through does not throw
 * away where the run had got to.
 *
 * A step is recorded as seen when it is left, not when the run ends: somebody
 * who closes the app after the rooms is not asked about the rooms again. The
 * write is not awaited and never fatal — a step that failed to record is asked
 * once more next time, which is a smaller cost than a setup that stalls on it.
 */
export default function SetupFlow({
  profile, household, memberCount, newHouse, suggestedName, onReady, onStart, onJoinToken,
  onFinish,
}: Props) {
  const ctx: SetupContext = useMemo(
    () => ({ profile, household, memberCount }),
    [profile, household, memberCount]
  );
  // Decided once, like the mode below: the household step making a house half
  // way through is exactly the case this is for. See seenThisRun.
  const [forNewHouse] = useState(() => !household || !!newHouse);
  const seen = useMemo(
    () => seenThisRun(new Set(profile?.setupSeen ?? []), forNewHouse),
    [profile?.setupSeen, forNewHouse]
  );

  useEffect(() => {
    // Once, on mount: a run starts once however often the account is re-read.
    onStart?.();
  }, []);

  // Decided once, from what was waiting when the run began: a household made
  // half way through must not turn a first run into a catch-up.
  const [mode] = useState(() => flowMode(pendingSteps(ctx, seen)));
  const [intro] = useState(() => pendingSteps(ctx, seen));
  const [history, setHistory] = useState<SetupStepId[]>([]);
  const [screen, setScreen] = useState<Screen>(mode === 'catch-up' ? 'intro' : null);
  const finished = useRef(false);

  const done = useMemo(() => new Set<string>(history), [history]);

  // Where to go next, worked out from the data as it now stands. Runs whenever
  // a step has been left (screen is null), after the account has been re-read.
  useEffect(() => {
    if (screen !== null) return;
    const next = nextStep(ctx, seen, done);
    if (next) {
      setScreen(next.id);
    } else if (mode === 'first-run') {
      setScreen('all-set');
    } else if (!finished.current) {
      finished.current = true;
      onFinish(null);
    }
  }, [screen, ctx, seen, done, mode, onFinish]);

  function leave(id: SetupStepId) {
    markSetupSeen([id]).catch((err) => console.error('Failed to record a setup step:', err));
    setHistory((current) => [...current, id]);
    setScreen(null);
  }

  // Back to the step before. The household step is passed over once there is
  // a household: it has been answered in a way that cannot be taken back here,
  // and showing "Start a new house" to somebody who has one is a second house.
  const backTarget = useMemo(() => {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const id = history[i];
      if (id === 'household' && household) continue;
      return { id, index: i };
    }
    return null;
  }, [history, household]);

  function goBack() {
    if (!backTarget) return;
    setHistory((current) => current.slice(0, backTarget.index));
    setScreen(backTarget.id);
  }

  if (screen === 'intro') {
    return <CatchUpIntro steps={intro} onContinue={() => setScreen(null)} />;
  }

  if (screen === 'all-set') {
    return (
      <AllSet
        name={profile?.displayName}
        onFinish={(photo) => {
          if (finished.current) return;
          finished.current = true;
          onFinish(photo);
        }}
      />
    );
  }

  if (screen === null) return null;

  const Step = SCREENS[screen];
  const total = expectedStepCount(ctx, seen, done);
  return (
    <Step
      key={screen}
      ctx={ctx}
      progress={{ index: history.length, total: Math.max(total, history.length + 1) }}
      onBack={backTarget ? goBack : undefined}
      onNext={() => leave(screen)}
      onReady={onReady}
      suggestedName={suggestedName}
      onJoinToken={onJoinToken}
    />
  );
}

