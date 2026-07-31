import {
  seriousResolveGate, resolveBlockReason, investigationModeLocked,
  type InvestigationState,
} from '@snag/supabase-queries';

// The serious-lane resolve gate, which both clients read and neither enforces.
//
// The server is the enforcement point — update_snag_status raises on the first
// condition it finds unmet. What this shared function decides is what the app
// *tells someone to do next*, and getting that order wrong is worse than having
// no guidance at all: it sends a supervisor off to record a witness statement
// when what's actually blocking closure is a notifiable event with a statutory
// clock on it.
//
// So these specs pin the ordering against the SQL, not just the arithmetic.
// If update_snag_status's checks are ever reordered, this file is the thing
// that should fail.

/** Everything satisfied — the baseline each spec breaks one condition of. */
function complete(): InvestigationState {
  return {
    completedSteps: ['make_safe', 'preserve_scene', 'capture_evidence', 'identify_witnesses', 'find_root_cause'],
    witnesses: [{ id: 'w1' } as any],
    evidence: [{ id: 'e1' } as any],
    rootCause: 'Racking was never re-rated for the heavier stock line.',
    openCorrectiveActions: 0,
    correctiveActionCount: 2,
    mode: 'snag',
    leadInvestigatorId: null,
    documentId: null,
    documentTitle: null,
    documentPath: null,
    documentAttachedBy: null,
    documentAccepted: false,
    documentAcceptedBy: null,
  };
}

/** The same, but run through the organisation's own process. */
function completeViaDocument(): InvestigationState {
  return {
    ...complete(),
    rootCause: null,
    mode: 'document',
    documentId: 'doc-1',
    documentTitle: 'Incident investigation report — bay 4',
    documentAttachedBy: 'lead-1',
    documentAccepted: true,
    documentAcceptedBy: 'supervisor-1',
  };
}

/** Only the four shared conditions — nothing mode-specific done yet. */
function bare(mode: 'snag' | 'document' = 'snag'): InvestigationState {
  return {
    completedSteps: [], witnesses: [], evidence: [], rootCause: null,
    openCorrectiveActions: 0, correctiveActionCount: 0, mode, leadInvestigatorId: null,
    documentId: null, documentTitle: null, documentPath: null,
    documentAttachedBy: null, documentAccepted: false, documentAcceptedBy: null,
  };
}

describe('seriousResolveGate', () => {
  it('checks conditions in update_snag_status\'s order', () => {
    // Transcribed from the function body, in the order the `raise exception`
    // statements appear inside `if p_status = 'resolved'`.
    expect(seriousResolveGate(complete(), true).map((c) => c.key)).toEqual([
      'notifiable',
      'checklist',
      'witnesses',
      'evidence',
      'rootCause',
      'correctiveActions',
    ]);
  });

  it('blocks on nothing once every condition is satisfied', () => {
    const gate = seriousResolveGate(complete(), true);
    expect(gate.filter((c) => c.unmet)).toEqual([]);
    expect(resolveBlockReason(complete(), true)).toBeNull();
  });

  it('reports the notifiable decision ahead of anything else outstanding', () => {
    // A brand-new snag has every condition unmet. The one named must be the
    // notifiable decision — it is first in the server function and the only
    // one that can carry a duty to preserve the site.
    const fresh: InvestigationState = bare();
    expect(resolveBlockReason(fresh, false)).toBe('Decide if this is a notifiable event');
  });

  it('names the first unmet condition and not merely any of them', () => {
    // Notifiable answered, checklist part-done, everything after it missing:
    // the checklist is what to do next, not the witness statement.
    const partial: InvestigationState = { ...bare(), completedSteps: ['make_safe', 'preserve_scene'] };
    expect(resolveBlockReason(partial, true)).toBe('Finish the checklist (2/5)');
  });

  describe('each condition blocks on its own', () => {
    const cases: [string, InvestigationState, boolean, string][] = [
      ['an undecided notifiable event', complete(), false, 'Decide if this is a notifiable event'],
      ['an unfinished checklist', { ...complete(), completedSteps: ['make_safe'] }, true, 'Finish the checklist (1/5)'],
      ['no witness statement', { ...complete(), witnesses: [] }, true, 'Add a witness statement'],
      ['no evidence', { ...complete(), evidence: [] }, true, 'Add evidence'],
      ['no root cause', { ...complete(), rootCause: null }, true, 'Record a root cause'],
      // Whitespace is not a root cause. The server checks for a row in
      // `investigations` rather than its contents, so this is the client
      // being stricter than the database on purpose.
      ['a blank root cause', { ...complete(), rootCause: '   ' }, true, 'Record a root cause'],
      // "Open" here means not (done AND verified) — getInvestigationState
      // counts done-but-unverified actions, mirroring the SQL.
      ['an unverified corrective action', { ...complete(), openCorrectiveActions: 1 }, true, 'Close corrective actions'],
    ];

    it.each(cases)('%s blocks resolve', (_label, inv, decided, reason) => {
      expect(resolveBlockReason(inv, decided)).toBe(reason);
    });
  });

  describe("document mode — the organisation's own investigation process", () => {
    it('substitutes two conditions rather than removing them', () => {
      // The point of the fork: it is a swap, not a shortcut. Everything up to
      // and including evidence still applies.
      expect(seriousResolveGate(completeViaDocument(), true).map((c) => c.key)).toEqual([
        'notifiable', 'checklist', 'witnesses', 'evidence',
        'investigationDocument', 'documentAccepted',
      ]);
    });

    it('still demands the checklist, a witness and evidence', () => {
      const gate = seriousResolveGate({ ...bare('document'), documentId: 'd', documentAccepted: true }, true);
      expect(gate.filter((c) => c.unmet).map((c) => c.key)).toEqual(['checklist', 'witnesses', 'evidence']);
    });

    it('blocks until a document is attached', () => {
      expect(resolveBlockReason({ ...completeViaDocument(), documentId: null, documentAccepted: false }, true))
        .toBe('Attach the investigation document');
    });

    it('blocks until a supervisor accepts it — attaching is not accepting', () => {
      expect(resolveBlockReason({ ...completeViaDocument(), documentAccepted: false }, true))
        .toBe('A supervisor must accept the investigation document');
    });

    it('opens once the document is attached and accepted', () => {
      expect(resolveBlockReason(completeViaDocument(), true)).toBeNull();
    });

    it('never asks for a root cause, which is what the document replaces', () => {
      const keys = seriousResolveGate(completeViaDocument(), true).map((c) => c.key);
      expect(keys).not.toContain('rootCause');
      expect(keys).not.toContain('correctiveActions');
    });
  });

  it('counts every outstanding condition, not just the first', () => {
    // What the locked "Resolve — blocked, N steps remaining" row reads from.
    const nothingDone: InvestigationState = { ...bare(), openCorrectiveActions: 2 };
    expect(seriousResolveGate(nothingDone, false).filter((c) => c.unmet)).toHaveLength(6);
  });
});

// Whether an allocated investigation can still be re-triaged into the other
// mode. Mirrors assign_investigation's guard, so that the clients hide a
// control the server would refuse rather than offering one that can only fail.
//
// The rule is about *stranding*: only work belonging to the mode you'd be
// leaving counts. The checklist, witnesses and evidence are required either
// way, survive the switch, and must never lock it.
describe('investigationModeLocked', () => {
  const allocated = (s: InvestigationState): InvestigationState => ({ ...s, leadInvestigatorId: 'lead-1' });

  it('is open before the snag has been allocated', () => {
    // Triage itself, not re-triage — leadInvestigatorId is what distinguishes
    // them, because apply_default_owner fills owner_id on the way in.
    expect(investigationModeLocked({ ...complete(), leadInvestigatorId: null })).toBe(false);
  });

  it('is open once allocated but before any mode-specific work', () => {
    expect(investigationModeLocked(allocated(bare('snag')))).toBe(false);
    expect(investigationModeLocked(allocated(bare('document')))).toBe(false);
  });

  it('locks snag mode on a root cause', () => {
    expect(investigationModeLocked(allocated({ ...bare(), rootCause: 'Racking never re-rated.' }))).toBe(true);
  });

  it('locks snag mode on a corrective action, even once every one is verified', () => {
    // The trap: openCorrectiveActions is 0 when they're all done and verified,
    // so a lock keyed off that number would quietly unlock the most complete
    // investigations of all.
    expect(investigationModeLocked(allocated({
      ...bare(), openCorrectiveActions: 0, correctiveActionCount: 3,
    }))).toBe(true);
  });

  it('locks document mode as soon as a document is attached, accepted or not', () => {
    expect(investigationModeLocked(allocated({
      ...bare('document'), documentId: 'doc-1', documentAccepted: false,
    }))).toBe(true);
    expect(investigationModeLocked(allocated(completeViaDocument()))).toBe(true);
  });

  it('ignores work both modes share, which a switch would not strand', () => {
    const shared = allocated({
      ...bare(),
      completedSteps: ['make_safe', 'preserve_scene', 'capture_evidence', 'identify_witnesses', 'find_root_cause'],
      witnesses: [{ id: 'w1' } as any],
      evidence: [{ id: 'e1' } as any],
    });
    expect(investigationModeLocked(shared)).toBe(false);
  });

  it("does not let the other mode's leftovers lock the current one", () => {
    // A snag-mode investigation still carrying a document from before the mode
    // was frozen: nothing snag-mode has been done, so it can still be moved —
    // which is what repairs it.
    expect(investigationModeLocked(allocated({
      ...bare('snag'), documentId: 'doc-1', documentAccepted: true,
    }))).toBe(false);
  });
});
