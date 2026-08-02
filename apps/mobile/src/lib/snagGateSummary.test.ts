import { snagGateSummary, type SnagGateInputs } from '@snag/supabase-queries';

// The gate, seen from a list row.
//
// `snagGateSummary` exists so a list can say what a serious snag is waiting on
// without assembling the full InvestigationState the detail screen builds. It
// deliberately routes through `seriousResolveGate` rather than reimplementing
// the rule — so what these specs pin is the *translation*: that a view row maps
// onto the same conditions, in the same order, with the same mode fork.
//
// The failure this guards against is a list that disagrees with the detail
// screen about whether a snag can close. That is worse than a list that says
// nothing, because it is believed.

/** A serious snag with every condition satisfied, in snag mode. */
function complete(): SnagGateInputs {
  return {
    snag_id: 's1',
    status: 'in_progress',
    is_notifiable: false,
    checklist_completed_count: 5,
    witness_count: 1,
    evidence_count: 1,
    open_corrective_action_count: 0,
    investigation_mode: 'snag',
    has_root_cause: true,
    has_document: false,
    document_accepted: false,
  };
}

describe('snagGateSummary', () => {
  it('reports nothing outstanding when every condition is met', () => {
    expect(snagGateSummary(complete())).toEqual({ outstanding: 0, firstBlocker: null });
  });

  it('treats an undecided notifiable flag as unmet, and false as decided', () => {
    expect(snagGateSummary({ ...complete(), is_notifiable: null }).firstBlocker)
      .toBe('Decide if this is a notifiable event');
    // Answering "no" is an answer. This is the distinction the view keeps the
    // column nullable for.
    expect(snagGateSummary({ ...complete(), is_notifiable: false }).outstanding).toBe(0);
    expect(snagGateSummary({ ...complete(), is_notifiable: true }).outstanding).toBe(0);
  });

  it('counts a partially completed checklist as one outstanding condition', () => {
    const s = snagGateSummary({ ...complete(), checklist_completed_count: 3 });
    expect(s).toEqual({ outstanding: 1, firstBlocker: 'Finish the checklist (3/5)' });
  });

  it('reports the first blocker in the gate order, not the worst one', () => {
    // Notifiable undecided AND no evidence: the notifiable question wins,
    // because that is the order update_snag_status applies.
    const s = snagGateSummary({ ...complete(), is_notifiable: null, evidence_count: 0 });
    expect(s.outstanding).toBe(2);
    expect(s.firstBlocker).toBe('Decide if this is a notifiable event');
  });

  it('asks document mode for a document instead of a root cause', () => {
    const s = snagGateSummary({
      ...complete(), investigation_mode: 'document', has_root_cause: false,
    });
    expect(s).toEqual({ outstanding: 2, firstBlocker: 'Attach the investigation document' });
  });

  it('still requires acceptance once a document is attached', () => {
    const s = snagGateSummary({
      ...complete(), investigation_mode: 'document', has_root_cause: false, has_document: true,
    });
    expect(s).toEqual({
      outstanding: 1,
      firstBlocker: 'A supervisor must accept the investigation document',
    });
  });

  it('does not let document mode skip the shared conditions', () => {
    // The substitution replaces the last two conditions only — a document-mode
    // investigation still owes a checklist, a witness and evidence.
    const s = snagGateSummary({
      ...complete(),
      investigation_mode: 'document',
      has_document: true,
      document_accepted: true,
      checklist_completed_count: 0,
      witness_count: 0,
      evidence_count: 0,
    });
    expect(s.outstanding).toBe(3);
    expect(s.firstBlocker).toBe('Finish the checklist (0/5)');
  });

  it('treats a snag with no investigation row as snag mode', () => {
    // assign_investigation defaults to 'snag', and so does the server's own
    // fallback — a null mode must not read as document mode and quietly drop
    // the root-cause requirement.
    const s = snagGateSummary({
      ...complete(), investigation_mode: null, has_root_cause: false,
    });
    expect(s).toEqual({ outstanding: 1, firstBlocker: 'Record a root cause' });
  });

  it('counts open corrective actions as blocking in snag mode', () => {
    const s = snagGateSummary({ ...complete(), open_corrective_action_count: 2 });
    expect(s).toEqual({ outstanding: 1, firstBlocker: 'Close corrective actions' });
  });

  it('reproduces the live Docunation snags that could not be resolved', () => {
    // SNAG-00037, the open injury the attention strip exists to surface:
    // document mode, checklist done, a witness, no evidence, no document.
    const injury = snagGateSummary({
      ...complete(),
      investigation_mode: 'document',
      has_root_cause: false,
      evidence_count: 0,
    });
    expect(injury.outstanding).toBe(3);
    expect(injury.firstBlocker).toBe('Add evidence');

    // SNAG-00055: snag mode, checklist done, no witness, no evidence, no root
    // cause — three steps out, and indistinguishable from the above in a list
    // that only shows status.
    const stalled = snagGateSummary({
      ...complete(), witness_count: 0, evidence_count: 0, has_root_cause: false,
    });
    expect(stalled.outstanding).toBe(3);
    expect(stalled.firstBlocker).toBe('Add a witness statement');
  });
});
