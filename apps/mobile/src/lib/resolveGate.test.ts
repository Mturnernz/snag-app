import {
  seriousResolveGate, resolveBlockReason, type InvestigationState,
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
    const fresh: InvestigationState = {
      completedSteps: [], witnesses: [], evidence: [], rootCause: null, openCorrectiveActions: 0,
    };
    expect(resolveBlockReason(fresh, false)).toBe('Decide if this is a notifiable event');
  });

  it('names the first unmet condition and not merely any of them', () => {
    // Notifiable answered, checklist part-done, everything after it missing:
    // the checklist is what to do next, not the witness statement.
    const partial: InvestigationState = {
      completedSteps: ['make_safe', 'preserve_scene'], witnesses: [], evidence: [],
      rootCause: null, openCorrectiveActions: 0,
    };
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

  it('counts every outstanding condition, not just the first', () => {
    // What the locked "Resolve — blocked, N steps remaining" row reads from.
    const nothingDone: InvestigationState = {
      completedSteps: [], witnesses: [], evidence: [], rootCause: null, openCorrectiveActions: 2,
    };
    expect(seriousResolveGate(nothingDone, false).filter((c) => c.unmet)).toHaveLength(6);
  });
});
