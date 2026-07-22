import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { SnagKind, SnagSeverity } from '../types';

export interface IncidentDraft {
  description: string;
  kind: SnagKind; // constrained to 'hazard' | 'incident' within this flow
  severity: SnagSeverity;
  photoCount: number;
  /** Local file URIs carried over from the niggle form's photo picker when
   *  the reporter switches to "Report a Serious Incident" mid-report. */
  photoUris: string[];
}

const INITIAL_DRAFT: IncidentDraft = {
  description: '',
  kind: 'incident',
  severity: 'moderate',
  photoCount: 0,
  photoUris: [],
};

type SubmitFn = () => Promise<{ error?: string; snagId?: string; reference?: string }>;

interface IncidentDraftContextValue {
  draft: IncidentDraft;
  setDraft: (patch: Partial<IncidentDraft>) => void;
  reset: () => void;
  /** Registered by the Details screen (which holds the photo picker ref); invoked by the Review screen. */
  setSubmitHandler: (fn: SubmitFn) => void;
  submit: SubmitFn;
}

const IncidentDraftContext = createContext<IncidentDraftContextValue | null>(null);

export function IncidentDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraftState] = useState<IncidentDraft>(INITIAL_DRAFT);
  const submitRef = useRef<SubmitFn>(async () => ({ error: 'Nothing to submit' }));

  const setDraft = useCallback((patch: Partial<IncidentDraft>) => {
    setDraftState((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setDraftState(INITIAL_DRAFT);
  }, []);

  const setSubmitHandler = useCallback((fn: SubmitFn) => {
    submitRef.current = fn;
  }, []);

  const submit = useCallback(() => submitRef.current(), []);

  return (
    <IncidentDraftContext.Provider value={{ draft, setDraft, reset, setSubmitHandler, submit }}>
      {children}
    </IncidentDraftContext.Provider>
  );
}

export function useIncidentDraft(): IncidentDraftContextValue {
  const ctx = useContext(IncidentDraftContext);
  if (!ctx) {
    throw new Error('useIncidentDraft must be used within an IncidentDraftProvider');
  }
  return ctx;
}
