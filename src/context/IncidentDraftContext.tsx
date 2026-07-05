import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { IssuePriority } from '../types';

export interface IncidentDraft {
  title: string;
  description: string;
  priority: IssuePriority;
  hasPhoto: boolean;
}

const INITIAL_DRAFT: IncidentDraft = {
  title: '',
  description: '',
  priority: 'high',
  hasPhoto: false,
};

type SubmitFn = () => Promise<{ error?: string; issueId?: string }>;

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
