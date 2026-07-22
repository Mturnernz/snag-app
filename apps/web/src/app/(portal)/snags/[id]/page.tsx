import { notFound } from 'next/navigation';
import {
  getSnagRca, getSnagDebriefs, getInvestigationState, getCorrectiveActions,
  getSnagAuditLog, describeAuditAction, getSiteAssignees, getOrgMembers, getEvidencePhotoUrl,
  type SiteAssignee,
} from '@snag/supabase-queries';
import {
  STATUS_LABELS, KIND_LABELS, SEVERITY_LABELS, CHECKLIST_STEP_LABELS, CHECKLIST_STEPS,
  type SnagStatus, type SnagKind, type SnagSeverity, type Profile,
} from '@snag/shared-types';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import {
  changeStatusAction, resolveNiggleAction, assignOwnerAction, recategoriseAction,
  addCommentAction, toggleNotifiableAction, unmergeAction,
} from './actions';
import {
  completeChecklistStepAction, addWitnessStatementAction, addEvidenceAction, setRootCauseAction,
} from './investigation-actions';
import {
  assignRcaAction, saveRcaWhysAction, submitRcaAction, acceptRcaAction, rejectRcaAction,
  reassignRcaAction, cancelRcaAction,
} from './rca-actions';
import {
  startDebriefAction, addDebriefFindingAction, addDebriefLessonAction, addDebriefAttendeeAction,
  completeDebriefAction,
} from './debrief-actions';
import {
  createCorrectiveActionAction, completeCorrectiveActionAction, verifyCorrectiveActionAction,
} from './capa-actions';

const KIND_OPTIONS: SnagKind[] = ['fixit', 'improvement', 'hazard', 'incident'];
const SEVERITY_OPTIONS: SnagSeverity[] = ['minor', 'moderate', 'injury', 'critical'];

export default async function SnagDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  await requireSupervisorOrAdmin();
  const supabase = await createClient();

  const { data: snag } = await supabase
    .from('snags_with_details')
    .select('id, reference, description, status, kind, lane, severity, site_id, site_name, owner_id, owner_name, reporter_name, created_at, is_notifiable, parent_snag_id, child_count')
    .eq('id', id)
    .maybeSingle();

  if (!snag) notFound();

  const isSerious = snag.lane === 'serious';
  const isNiggle = !isSerious;

  const [comments, rca, debriefs, investigation, actions, auditLog, assignees, members] = await Promise.all([
    supabase.from('comments').select('id, body, created_at, author:profiles(id, name)').eq('snag_id', id).order('created_at', { ascending: true }),
    isSerious ? getSnagRca(supabase, id) : Promise.resolve(null),
    isSerious ? getSnagDebriefs(supabase, id) : Promise.resolve([]),
    isSerious ? getInvestigationState(supabase, id) : Promise.resolve(null),
    isSerious ? getCorrectiveActions(supabase, id) : Promise.resolve([]),
    getSnagAuditLog(supabase, id),
    getSiteAssignees(supabase, snag.site_id),
    getOrgMembers(supabase) as Promise<Profile[]>,
  ]);

  const evidenceUrls = investigation
    ? await Promise.all(investigation.evidence.map((e) => getEvidencePhotoUrl(supabase, e.media_path)))
    : [];

  const siteAssignees: SiteAssignee[] = assignees.data ?? [];
  const activeDebrief = debriefs.find((d) => d.status === 'in_progress');
  const completedDebriefs = debriefs.filter((d) => d.status !== 'in_progress');
  const remainingChecklist = CHECKLIST_STEPS.filter((s) => !investigation?.completedSteps.includes(s));

  return (
    <div style={{ maxWidth: 760 }}>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>{snag.site_name}</p>
      <h1 style={{ marginBottom: 8 }}>{snag.reference}</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, fontSize: 14, flexWrap: 'wrap' }}>
        <Pill>{STATUS_LABELS[snag.status as SnagStatus]}</Pill>
        <Pill>{KIND_LABELS[snag.kind as keyof typeof KIND_LABELS]}</Pill>
        {snag.severity && <Pill>{SEVERITY_LABELS[snag.severity as keyof typeof SEVERITY_LABELS]}</Pill>}
        {snag.is_notifiable && <Pill tone="danger">Notifiable</Pill>}
      </div>

      <p style={{ marginBottom: 8 }}>{snag.description ?? '(no description)'}</p>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 20 }}>
        Reported by {snag.reporter_name} · {snag.owner_name ? `assigned to ${snag.owner_name}` : 'unassigned'}
        {snag.parent_snag_id ? ' · merged into another snag' : ''}
        {snag.child_count ? ` · ${snag.child_count} snag(s) merged into this one` : ''}
      </p>

      {error && <p className="error-text" style={{ marginBottom: 20 }}>{error}</p>}

      <Section title="Actions">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {snag.status !== 'flagged' && (
            <StatusButton snagId={snag.id} status="flagged" label="Re-flag" />
          )}
          {snag.status !== 'in_progress' && snag.status !== 'resolved' && (
            <StatusButton snagId={snag.id} status="in_progress" label="Mark In Progress" />
          )}
          {snag.parent_snag_id && (
            <form action={unmergeAction}>
              <input type="hidden" name="snagId" value={snag.id} />
              <button type="submit" className="btn-secondary">Unmerge</button>
            </form>
          )}
          {isSerious && (
            <form action={toggleNotifiableAction}>
              <input type="hidden" name="snagId" value={snag.id} />
              <input type="hidden" name="value" value={(!snag.is_notifiable).toString()} />
              <button type="submit" className="btn-secondary">
                {snag.is_notifiable ? 'Unmark notifiable' : 'Mark notifiable'}
              </button>
            </form>
          )}
        </div>

        {snag.status !== 'resolved' && isNiggle && (
          <form action={resolveNiggleAction} className="card" style={{ marginBottom: 16 }}>
            <input type="hidden" name="snagId" value={snag.id} />
            <div className="field">
              <label htmlFor="note">Resolution note</label>
              <input id="note" name="note" type="text" required placeholder="What was done to fix this?" />
            </div>
            <button type="submit" className="btn-primary">Resolve</button>
          </form>
        )}
        {snag.status !== 'resolved' && isSerious && (
          <StatusButton snagId={snag.id} status="resolved" label="Resolve (requires completed investigation)" />
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          <form action={assignOwnerAction} className="card">
            <input type="hidden" name="snagId" value={snag.id} />
            <div className="field">
              <label htmlFor="ownerId">Owner</label>
              <select id="ownerId" name="ownerId" defaultValue={snag.owner_id ?? ''}>
                <option value="">Unassigned</option>
                {siteAssignees.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-secondary">Save</button>
          </form>

          <form action={recategoriseAction} className="card">
            <input type="hidden" name="snagId" value={snag.id} />
            <div className="field">
              <label htmlFor="kind">Kind</label>
              <select id="kind" name="kind" defaultValue={snag.kind}>
                {KIND_OPTIONS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="severity">Severity</label>
              <select id="severity" name="severity" defaultValue={snag.severity ?? ''}>
                <option value="">None</option>
                {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
              </select>
            </div>
            <button type="submit" className="btn-secondary">Save</button>
          </form>
        </div>
      </Section>

      {isSerious && investigation && (
        <Section title="Investigation">
          <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
            {CHECKLIST_STEPS.map((step) => (
              <li key={step} style={{ color: investigation.completedSteps.includes(step) ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                {CHECKLIST_STEP_LABELS[step]} {investigation.completedSteps.includes(step) ? '— done' : ''}
              </li>
            ))}
          </ul>

          {remainingChecklist.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {remainingChecklist.map((step) => (
                <form key={step} action={completeChecklistStepAction}>
                  <input type="hidden" name="snagId" value={snag.id} />
                  <input type="hidden" name="step" value={step} />
                  <button type="submit" className="btn-secondary" style={{ fontSize: 13 }}>
                    Mark "{CHECKLIST_STEP_LABELS[step]}" done
                  </button>
                </form>
              ))}
            </div>
          )}

          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Witness statements ({investigation.witnesses.length})</h3>
          {investigation.witnesses.map((w) => (
            <p key={w.id} style={{ fontSize: 14, marginBottom: 8 }}><strong>{w.witness_name}:</strong> {w.statement_text}</p>
          ))}
          <form action={addWitnessStatementAction} className="card" style={{ marginBottom: 20 }}>
            <input type="hidden" name="snagId" value={snag.id} />
            <div className="field">
              <label htmlFor="witnessName">Witness name</label>
              <input id="witnessName" name="witnessName" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="statementText">Statement</label>
              <input id="statementText" name="statementText" type="text" required />
            </div>
            <button type="submit" className="btn-secondary">Add witness statement</button>
          </form>

          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Evidence ({investigation.evidence.length})</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {investigation.evidence.map((e, i) => (
              evidenceUrls[i] && (
                <a key={e.id} href={evidenceUrls[i]!} target="_blank" rel="noreferrer">
                  <img src={evidenceUrls[i]!} alt={e.caption ?? 'Evidence'} style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--color-border)' }} />
                </a>
              )
            ))}
          </div>
          <form action={addEvidenceAction} encType="multipart/form-data" className="card" style={{ marginBottom: 20 }}>
            <input type="hidden" name="snagId" value={snag.id} />
            <div className="field">
              <label htmlFor="evidenceFile">File</label>
              <input id="evidenceFile" name="file" type="file" required />
            </div>
            <div className="field">
              <label htmlFor="caption">Caption (optional)</label>
              <input id="caption" name="caption" type="text" />
            </div>
            <button type="submit" className="btn-secondary">Add evidence</button>
          </form>

          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Root cause</h3>
          {investigation.rootCause ? (
            <p style={{ fontSize: 14 }}>{investigation.rootCause}</p>
          ) : (
            <form action={setRootCauseAction} className="card">
              <input type="hidden" name="snagId" value={snag.id} />
              <div className="field">
                <label htmlFor="rootCauseText">What caused this?</label>
                <input id="rootCauseText" name="rootCauseText" type="text" required />
              </div>
              <button type="submit" className="btn-secondary">Save root cause</button>
            </form>
          )}
        </Section>
      )}

      {isSerious && (
        <Section title="Root cause analysis">
          {!rca && snag.status === 'resolved' && (
            <form action={assignRcaAction} className="card">
              <input type="hidden" name="snagId" value={snag.id} />
              <div className="field">
                <label htmlFor="assigneeId">Assign RCA to</label>
                <select id="assigneeId" name="assigneeId" required defaultValue="">
                  <option value="" disabled>Choose someone</option>
                  {siteAssignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <button type="submit" className="btn-secondary">Assign RCA</button>
            </form>
          )}
          {!rca && snag.status !== 'resolved' && (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
              An RCA can be assigned once this snag is resolved.
            </p>
          )}

          {rca && (
            <>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 12 }}>Status: {rca.status}</p>
              {rca.rejectionNote && (
                <p className="error-text" style={{ marginBottom: 12 }}>Rejected: {rca.rejectionNote}</p>
              )}

              {(rca.status === 'assigned' || rca.status === 'in_progress' || rca.status === 'rejected') && (
                <form action={saveRcaWhysAction} className="card" style={{ marginBottom: 16 }}>
                  <input type="hidden" name="snagId" value={snag.id} />
                  <input type="hidden" name="rcaId" value={rca.id} />
                  {[1, 2, 3, 4, 5].map((i) => {
                    const existing = rca.whys.find((w) => w.whyIndex === i);
                    return (
                      <div key={i} style={{ marginBottom: 12 }}>
                        <div className="field">
                          <label htmlFor={`why${i}`}>Why {i}</label>
                          <input id={`why${i}`} name={`why${i}`} type="text" defaultValue={existing?.whyText} />
                        </div>
                        <div className="field">
                          <label htmlFor={`answer${i}`}>Answer</label>
                          <input id={`answer${i}`} name={`answer${i}`} type="text" defaultValue={existing?.answerText} />
                        </div>
                      </div>
                    );
                  })}
                  <button type="submit" className="btn-secondary">Save whys</button>
                </form>
              )}

              {(rca.status === 'assigned' || rca.status === 'in_progress' || rca.status === 'rejected') && (
                <form action={submitRcaAction} style={{ marginBottom: 16 }}>
                  <input type="hidden" name="snagId" value={snag.id} />
                  <input type="hidden" name="rcaId" value={rca.id} />
                  <button type="submit" className="btn-primary">Submit RCA</button>
                </form>
              )}

              {rca.status === 'submitted' && (
                <>
                  <ol style={{ margin: '0 0 16px', paddingLeft: 20 }}>
                    {rca.whys.map((w) => (
                      <li key={w.whyIndex} style={{ marginBottom: 8 }}>
                        <strong>{w.whyText}</strong><br />
                        <span style={{ color: 'var(--color-text-secondary)' }}>{w.answerText}</span>
                      </li>
                    ))}
                  </ol>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    <form action={acceptRcaAction}>
                      <input type="hidden" name="snagId" value={snag.id} />
                      <input type="hidden" name="rcaId" value={rca.id} />
                      <button type="submit" className="btn-primary">Accept</button>
                    </form>
                    <details>
                      <summary className="btn-secondary" style={{ display: 'inline-block', cursor: 'pointer' }}>Reject</summary>
                      <form action={rejectRcaAction} style={{ marginTop: 8 }}>
                        <input type="hidden" name="snagId" value={snag.id} />
                        <input type="hidden" name="rcaId" value={rca.id} />
                        <div className="field">
                          <label htmlFor="rejectionNote">Rejection note</label>
                          <input id="rejectionNote" name="rejectionNote" type="text" required />
                        </div>
                        <button type="submit" className="btn-secondary">Confirm reject</button>
                      </form>
                    </details>
                  </div>
                </>
              )}

              {rca.status === 'accepted' && (
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  {rca.whys.map((w) => (
                    <li key={w.whyIndex} style={{ marginBottom: 8 }}>
                      <strong>{w.whyText}</strong><br />
                      <span style={{ color: 'var(--color-text-secondary)' }}>{w.answerText}</span>
                    </li>
                  ))}
                </ol>
              )}

              {(rca.status === 'assigned' || rca.status === 'in_progress') && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <details>
                    <summary className="btn-secondary" style={{ display: 'inline-block', cursor: 'pointer' }}>Reassign</summary>
                    <form action={reassignRcaAction} style={{ marginTop: 8 }}>
                      <input type="hidden" name="snagId" value={snag.id} />
                      <input type="hidden" name="rcaId" value={rca.id} />
                      <div className="field">
                        <label htmlFor="newAssigneeId">New assignee</label>
                        <select id="newAssigneeId" name="newAssigneeId" required defaultValue="">
                          <option value="" disabled>Choose someone</option>
                          {siteAssignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>
                      <button type="submit" className="btn-secondary">Confirm reassign</button>
                    </form>
                  </details>
                  <form action={cancelRcaAction}>
                    <input type="hidden" name="snagId" value={snag.id} />
                    <input type="hidden" name="rcaId" value={rca.id} />
                    <button type="submit" className="btn-secondary">Cancel RCA</button>
                  </form>
                </div>
              )}
            </>
          )}
        </Section>
      )}

      {isSerious && (
        <Section title="Debrief">
          {activeDebrief ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <p style={{ margin: '0 0 12px', fontWeight: 500 }}>{activeDebrief.format === 'hot' ? 'Hot debrief' : 'Formal debrief'} — in progress</p>

              {activeDebrief.findings.map((f) => <p key={f.id} style={{ fontSize: 14, marginBottom: 4 }}>• {f.finding_text}</p>)}
              <form action={addDebriefFindingAction} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input type="hidden" name="snagId" value={snag.id} />
                <input type="hidden" name="debriefId" value={activeDebrief.id} />
                <input name="findingText" type="text" placeholder="Add a finding" required style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 8 }} />
                <button type="submit" className="btn-secondary">Add</button>
              </form>

              {activeDebrief.lessons.map((l) => <p key={l.id} style={{ fontSize: 14, marginBottom: 4 }}>• {l.lesson_text}</p>)}
              <form action={addDebriefLessonAction} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input type="hidden" name="snagId" value={snag.id} />
                <input type="hidden" name="debriefId" value={activeDebrief.id} />
                <input name="lessonText" type="text" placeholder="Add a lesson learned" required style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 8 }} />
                <button type="submit" className="btn-secondary">Add</button>
              </form>

              <form action={addDebriefAttendeeAction} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input type="hidden" name="snagId" value={snag.id} />
                <input type="hidden" name="debriefId" value={activeDebrief.id} />
                <select name="profileId" required defaultValue="" style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                  <option value="" disabled>Add attendee</option>
                  {members.filter((m) => !activeDebrief.attendeeIds.includes(m.id)).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <button type="submit" className="btn-secondary">Add</button>
              </form>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                {activeDebrief.attendeeIds.length} attendee(s)
              </p>

              <form action={completeDebriefAction}>
                <input type="hidden" name="snagId" value={snag.id} />
                <input type="hidden" name="debriefId" value={activeDebrief.id} />
                <button type="submit" className="btn-primary">Complete debrief</button>
              </form>
            </div>
          ) : (
            <form action={startDebriefAction} className="card" style={{ marginBottom: 16 }}>
              <input type="hidden" name="snagId" value={snag.id} />
              <div className="field">
                <label htmlFor="format">Format</label>
                <select id="format" name="format" defaultValue="hot">
                  <option value="hot">Hot debrief</option>
                  <option value="formal">Formal debrief</option>
                </select>
              </div>
              <button type="submit" className="btn-secondary">Start debrief</button>
            </form>
          )}

          {completedDebriefs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {completedDebriefs.map((d) => (
                <div key={d.id} className="card" style={{ padding: 12 }}>
                  <p style={{ margin: '0 0 8px', fontWeight: 500 }}>{d.format === 'hot' ? 'Hot debrief' : 'Formal debrief'} · completed</p>
                  {d.findings.map((f) => <p key={f.id} style={{ margin: '0 0 4px', fontSize: 14 }}>• {f.finding_text}</p>)}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {isSerious && (
        <Section title="Corrective actions">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {actions.map((action) => (
              <div key={action.id} className="card" style={{ padding: 12 }}>
                <p style={{ margin: '0 0 4px', fontWeight: 500 }}>{action.description}</p>
                <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {action.owner_name ?? 'unassigned'} · due {action.due_date} · {action.verified_at ? 'verified' : action.status}
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  {action.status !== 'done' && (
                    <form action={completeCorrectiveActionAction}>
                      <input type="hidden" name="snagId" value={snag.id} />
                      <input type="hidden" name="actionId" value={action.id} />
                      <button type="submit" className="btn-secondary" style={{ fontSize: 13, padding: '6px 12px' }}>Mark complete</button>
                    </form>
                  )}
                  {action.status === 'done' && !action.verified_at && (
                    <form action={verifyCorrectiveActionAction}>
                      <input type="hidden" name="snagId" value={snag.id} />
                      <input type="hidden" name="actionId" value={action.id} />
                      <button type="submit" className="btn-secondary" style={{ fontSize: 13, padding: '6px 12px' }}>Verify</button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>

          <form action={createCorrectiveActionAction} className="card">
            <input type="hidden" name="snagId" value={snag.id} />
            <div className="field">
              <label htmlFor="description">Description</label>
              <input id="description" name="description" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="capaOwnerId">Owner</label>
              <select id="capaOwnerId" name="ownerId" required defaultValue="">
                <option value="" disabled>Choose someone</option>
                {siteAssignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="dueDate">Due date</label>
              <input id="dueDate" name="dueDate" type="date" required />
            </div>
            <button type="submit" className="btn-secondary">Create corrective action</button>
          </form>
        </Section>
      )}

      <Section title="Comments">
        {(!comments.data || comments.data.length === 0) && <p style={{ color: 'var(--color-text-muted)' }}>No comments yet.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {(comments.data ?? []).map((c: any) => (
            <div key={c.id}>
              <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 600 }}>{c.author?.name ?? 'Unknown'}</p>
              <p style={{ margin: 0 }}>{c.body}</p>
            </div>
          ))}
        </div>
        <form action={addCommentAction} style={{ display: 'flex', gap: 8 }}>
          <input type="hidden" name="snagId" value={snag.id} />
          <input name="body" type="text" placeholder="Add a comment" required style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8 }} />
          <button type="submit" className="btn-secondary">Post</button>
        </form>
      </Section>

      <Section title="Activity">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {auditLog.map((entry) => (
            <p key={entry.id} style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              <strong>{entry.actor_name ?? 'System'}</strong> {describeAuditAction(entry.action)}
            </p>
          ))}
        </div>
      </Section>
    </div>
  );
}

function StatusButton({ snagId, status, label }: { snagId: string; status: SnagStatus; label: string }) {
  return (
    <form action={changeStatusAction}>
      <input type="hidden" name="snagId" value={snagId} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className="btn-secondary">{label}</button>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: 20,
        background: tone === 'danger' ? 'var(--color-status-rca-pending-bg)' : 'var(--color-primary-light)',
        color: tone === 'danger' ? 'var(--color-status-rca-pending)' : 'var(--color-primary)',
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}
