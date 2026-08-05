import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { View } from 'react-native';
import {
  TOUR_FINISH_ANCHOR,
  TourAnchorId,
  TourGateId,
  TourStep,
  tourStep,
  tourStepsForRole,
} from '@snag/onboarding-guide';

import { Profile, TourStatus } from '../types';
import { setTourProgress } from '../lib/supabase';
import { readTourState, resolveTourState, writeTourState } from '../lib/tourState';
import { currentTabName, navigateToTab } from '../lib/navigationRef';
import TourOverlay from '../components/TourOverlay';
import TourResumeBar from '../components/TourResumeBar';

/**
 * The guided walkthrough.
 *
 * Mounted wrapping `RootNavigator` rather than inside a screen, for two
 * reasons that both come back to the tab bar: the first steps point at it, and
 * an overlay rendered inside a screen cannot draw over it. It is deliberately
 * not a `Modal` either — a Modal stacks above the whole navigator and takes
 * every touch with it, so the control the walkthrough is telling somebody to
 * press would be the one thing they couldn't press.
 *
 * Content, order and role filtering all come from `@snag/onboarding-guide`.
 * Nothing about what the walkthrough *says* lives in this file.
 */

interface TourContextValue {
  /** The step on screen, or null when the walkthrough isn't running. */
  step: TourStep | null;
  stepNumber: number;
  stepCount: number;
  status: TourStatus;
  /** True while the finish card is up. */
  finished: boolean;
  /** Whether the current step's gate (if it has one) has been satisfied. */
  canAdvance: boolean;
  next: () => void;
  back: () => void;
  pause: () => void;
  finish: () => void;
  /** `restart` ignores a saved resume point and goes back to step one. */
  start: (options?: { restart?: boolean }) => void;
  /** Called by the app when the user does the thing a gated step asked for. */
  completeGate: (gate: TourGateId) => void;
  registerAnchor: (id: TourAnchorId, ref: React.RefObject<View | null>) => () => void;
  /** The anchor the overlay should currently spotlight — the step's, or the
   *  Profile row the finish card points at. */
  activeAnchor: TourAnchorId | null;
}

const TourContext = createContext<TourContextValue | null>(null);

/** The walkthrough is inert without a profile — a public reporter has no role
 *  to filter by and no row to record progress against. */
const INERT: TourContextValue = {
  step: null,
  stepNumber: 0,
  stepCount: 0,
  status: 'done',
  finished: false,
  canAdvance: true,
  next: () => {},
  back: () => {},
  pause: () => {},
  finish: () => {},
  start: () => {},
  completeGate: () => {},
  registerAnchor: () => () => {},
  activeAnchor: null,
};

interface Props {
  profile: Profile | null;
  /** Lets App.tsx keep its copy of the profile in step without a refetch. */
  onStatusChange?: (status: TourStatus, stepId: string | null) => void;
  children: React.ReactNode;
}

export function TourProvider({ profile, onStatusChange, children }: Props) {
  const userId = profile?.id ?? null;
  const role = profile?.role ?? null;

  const steps = useMemo(() => (role ? tourStepsForRole(role) : []), [role]);

  const [status, setStatus] = useState<TourStatus>('done');
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [gates, setGates] = useState<Set<TourGateId>>(() => new Set());
  /** Dismissing the resume bar hides it for this session only. The walkthrough
   *  is still paused, and the bar comes back next launch — a paused setup that
   *  can be permanently silenced with one tap is a setup nobody finishes. */
  const [barDismissed, setBarDismissed] = useState(false);

  const anchors = useRef(new Map<TourAnchorId, React.RefObject<View | null>>());
  /** Guards the load effect against a second run for the same user, which
   *  would restart a walkthrough somebody has since advanced. */
  const loadedFor = useRef<string | null>(null);

  const step = status === 'running' && !finished ? steps[index] ?? null : null;

  // ─── Persistence ───────────────────────────────────────────────────────────

  /**
   * Progress writes are queued, not fired in parallel.
   *
   * They all target one row, and `record` runs on every step change — so
   * pressing Next a few times quickly used to put several updates in flight at
   * once, landing in whatever order the network chose. The e2e run caught the
   * harmless version (the account left a few steps back from where it ended),
   * but the one that matters is Next-Next-Pause: a straggling `running` write
   * landing after `paused` loses the pause, and the walkthrough silently
   * resumes on next launch instead of waiting.
   *
   * Still fire-and-forget to the caller — nothing awaits a tap — but serialised
   * so the last thing somebody did is the last thing written.
   */
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());

  const record = useCallback(
    (nextStatus: TourStatus, stepId: string | null) => {
      setStatus(nextStatus);
      onStatusChange?.(nextStatus, stepId);
      writeQueue.current = writeQueue.current
        .then(() => writeTourState(userId, nextStatus, stepId))
        .then(() => setTourProgress(nextStatus, stepId))
        // A failed write must not wedge the queue for the rest of the session;
        // setTourProgress already logs, and the next step overwrites this one.
        .catch(() => {});
    },
    [onStatusChange, userId],
  );

  // Decide where this person is up to, once per user. The server row is the
  // truth; the device mirror only wins when it is newer, which is the
  // paused-with-no-signal case (see tourState.ts).
  useEffect(() => {
    if (!userId || steps.length === 0) return;
    if (loadedFor.current === userId) return;
    loadedFor.current = userId;

    // Clear the previous account's walkthrough before the async read resolves.
    // Shared devices are normal on a site, and without this the next person to
    // sign in sees the last one's step for as long as the round trip takes.
    setStatus('done');
    setIndex(0);
    setFinished(false);
    setGates(new Set());
    setBarDismissed(false);

    let cancelled = false;
    void (async () => {
      const local = await readTourState(userId);
      if (cancelled) return;

      const resolved = resolveTourState(
        {
          status: profile?.tour_status ?? 'not_started',
          stepId: profile?.tour_step ?? null,
          updatedAt: profile?.tour_updated_at ?? null,
        },
        local,
      );

      const savedIndex = resolved.stepId ? steps.findIndex((s) => s.id === resolved.stepId) : -1;
      setIndex(savedIndex >= 0 ? savedIndex : 0);

      if (resolved.status === 'not_started') {
        // First session. Start it, rather than offering to — the whole point is
        // that somebody who wasn't going to read the manual gets shown the app.
        record('running', steps[0].id);
      } else if (resolved.status === 'running') {
        // The app was closed mid-walkthrough. Pick up where it stopped.
        setStatus('running');
      } else {
        setStatus(resolved.status);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, steps, profile?.tour_status, profile?.tour_step, profile?.tour_updated_at, record]);

  // ─── Navigation ────────────────────────────────────────────────────────────

  // Put the step's tab on screen. Skipped when it's already the focused tab, so
  // the web build doesn't rewrite the URL on every Next. The finish card points
  // at Profile → Walkthrough, so it needs the same treatment.
  useEffect(() => {
    const tab = step?.tab ?? (finished ? ('Profile' as const) : null);
    if (!tab) return;
    if (currentTabName() === tab) return;
    navigateToTab(tab);
  }, [step, finished]);

  // ─── Controls ──────────────────────────────────────────────────────────────
  //
  // Computed from `index` rather than inside a `setIndex` updater: an updater
  // that also writes progress and navigates is a side effect in a function
  // React is free to call twice, which under StrictMode means two RPCs per tap.

  const next = useCallback(() => {
    const target = index + 1;
    if (target >= steps.length) {
      setFinished(true);
      record('done', null);
      return;
    }
    setIndex(target);
    record('running', steps[target].id);
  }, [index, record, steps]);

  const back = useCallback(() => {
    const target = Math.max(0, index - 1);
    if (target === index) return;
    setIndex(target);
    record('running', steps[target].id);
  }, [index, record, steps]);

  const pause = useCallback(() => {
    setBarDismissed(false);
    record('paused', steps[index]?.id ?? null);
  }, [index, record, steps]);

  const finish = useCallback(() => {
    setFinished(false);
    record('done', null);
  }, [record]);

  const start = useCallback(
    (options?: { restart?: boolean }) => {
      if (steps.length === 0) return;
      setFinished(false);
      setBarDismissed(false);
      const target = options?.restart ? 0 : index;
      setIndex(target);
      record('running', steps[target]?.id ?? steps[0].id);
    },
    [index, record, steps],
  );

  const completeGate = useCallback((gate: TourGateId) => {
    // Cumulative rather than per-step: somebody who added a photo before the
    // walkthrough asked them to has still done the thing.
    setGates((prev) => (prev.has(gate) ? prev : new Set(prev).add(gate)));
  }, []);

  const registerAnchor = useCallback(
    (id: TourAnchorId, ref: React.RefObject<View | null>) => {
      anchors.current.set(id, ref);
      return () => {
        if (anchors.current.get(id) === ref) anchors.current.delete(id);
      };
    },
    [],
  );

  /**
   * Deliberately a getter over a ref rather than the ref itself.
   *
   * An anchor on another tab doesn't exist until the walkthrough has navigated
   * there and that screen has mounted — after the overlay first renders. Handing
   * the overlay a ref resolved once would leave it permanently null; a stable
   * getter it can re-read on each measure tick picks up a late registration
   * without re-rendering the whole app underneath, which is what a state-backed
   * registry would cost here.
   */
  const getAnchorRef = useCallback(
    (id: TourAnchorId) => anchors.current.get(id) ?? null,
    [],
  );

  const canAdvance = !step?.gate || gates.has(step.gate);
  const activeAnchor = finished ? TOUR_FINISH_ANCHOR : step?.anchor ?? null;

  const value = useMemo<TourContextValue>(
    () => ({
      step,
      stepNumber: index + 1,
      stepCount: steps.length,
      status,
      finished,
      canAdvance,
      next,
      back,
      pause,
      finish,
      start,
      completeGate,
      registerAnchor,
      activeAnchor,
    }),
    [
      step, index, steps.length, status, finished, canAdvance,
      next, back, pause, finish, start, completeGate, registerAnchor, activeAnchor,
    ],
  );

  const showBar = status === 'paused' && !barDismissed && steps.length > 0;
  const pausedStep = status === 'paused' ? steps[index] ?? null : null;

  return (
    <TourContext.Provider value={value}>
      {children}
      {(step || finished) && (
        <TourOverlay
          getAnchorRef={getAnchorRef}
          anchorId={activeAnchor}
          step={step}
          stepNumber={index + 1}
          stepCount={steps.length}
          finished={finished}
          canAdvance={canAdvance}
          onNext={next}
          onBack={back}
          onPause={pause}
          onFinish={finish}
        />
      )}
      {showBar && (
        <TourResumeBar
          stepNumber={index + 1}
          stepCount={steps.length}
          title={pausedStep?.title ?? ''}
          onResume={() => start()}
          onDismiss={() => setBarDismissed(true)}
        />
      )}
    </TourContext.Provider>
  );
}

/**
 * The walkthrough's controls.
 *
 * Returns an inert value outside a provider rather than throwing, unlike
 * `useToast`. Screens call `completeGate` from ordinary handlers, and they also
 * render under the eight pre-navigator gates in `App.tsx` where no provider
 * exists — a hook that throws would turn "the walkthrough isn't running" into a
 * crash on the sign-up path.
 */
export function useTour(): TourContextValue {
  return useContext(TourContext) ?? INERT;
}

/** Resolves a persisted step id, for callers that only have the id. */
export { tourStep };
