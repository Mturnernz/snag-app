import React, { createContext, useCallback, useContext, useState } from 'react';

/** A public organisation the user has chosen to report into (they are not a
 *  member of it — member orgs are handled by switching the active org). */
export interface ReportTarget {
  orgId: string;
  orgName: string;
}

interface ReportTargetContextValue {
  target: ReportTarget | null;
  setTarget: (target: ReportTarget) => void;
  clearTarget: () => void;
}

const ReportTargetContext = createContext<ReportTargetContextValue | null>(null);

export function ReportTargetProvider({ children }: { children: React.ReactNode }) {
  const [target, setTargetState] = useState<ReportTarget | null>(null);

  const setTarget = useCallback((t: ReportTarget) => setTargetState(t), []);
  const clearTarget = useCallback(() => setTargetState(null), []);

  return (
    <ReportTargetContext.Provider value={{ target, setTarget, clearTarget }}>
      {children}
    </ReportTargetContext.Provider>
  );
}

export function useReportTarget(): ReportTargetContextValue {
  const ctx = useContext(ReportTargetContext);
  if (!ctx) {
    throw new Error('useReportTarget must be used within a ReportTargetProvider');
  }
  return ctx;
}
