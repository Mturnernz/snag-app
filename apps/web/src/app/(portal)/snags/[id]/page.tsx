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
import { Card, EmptyState } from '@/components/Card';
import { Button } from '@/components/Button';
import { StatusBadge, KindBadge, SeverityBadge, NotifiableBadge } from '@/components/Badge';
import Icon, { type IconName } from '@/components/Icon';
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
import styles from './page.module.css';

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
      <div className={styles.header}>
        <p className={styles.site}>{snag.site_name}</p>
        <h1 className={styles.reference}>{snag.reference}</h1>
        <div className={styles.badgeRow}>
          <StatusBadge status={snag.status as SnagStatus} />
          <KindBadge kind={snag.kind as SnagKind} />
          {snag.severity && <SeverityBadge severity={snag.severity as SnagSeverity} />}
          {snag.is_notifiable && <NotifiableBadge />}
        </div>
        <p className={styles.description}>{snag.description ?? '(no description)'}</p>
        <p className={styles.meta}>
          Reported by {snag.reporter_name} · {snag.owner_name ? `assigned to ${snag.owner_name}` : 'unassigned'}
          {snag.parent_snag_id ? ' · merged into another snag' : ''}
          {snag.child_count ? ` · ${snag.child_count} snag(s) merged into this one` : ''}
        </p>
        {error && <p className="error-text">{error}</p>}
      </div>

      <Section icon="SquareCheckBig" title="Actions">
        <div className={styles.actionRow}>
          {snag.status !== 'flagged' && <StatusButton snagId={snag.id} status="flagged" label="Re-flag" />}
          {snag.status !== 'in_progress' && snag.status !== 'resolved' && (
            <StatusButton snagId={snag.id} status="in_progress" label="Mark In Progress" />
          )}
          {snag.parent_snag_id && (
            <form action={unmergeAction}>
              <input type="hidden" name="snagId" value={snag.id} />
              <Button type="submit" variant="secondary">Unmerge</Button>
            </form>
          )}
          {isSerious && (
            <form action={toggleNotifiableAction}>
              <input type="hidden" name="snagId" value={snag.id} />
              <input type="hidden" name="value" value={(!snag.is_notifiable).toString()} />
              <Button type="submit" variant="secondary">
                {snag.is_notifiable ? 'Unmark notifiable' : 'Mark notifiable'}
              </Button>
            </form>
          )}
        </div>

        {snag.status !== 'resolved' && isNiggle && (
          <Card as="form" action={resolveNiggleAction} style={{ marginBottom: 'var(--space-lg)' }}>
            <input type="hidden" name="snagId" value={snag.id} />
            <div className="field">
              <label htmlFor="note">Resolution note</label>
              <input id="note" name="note" type="text" required placeholder="What was done to fix this?" />
            </div>
            <Button type="submit" variant="primary">Resolve</Button>
          </Card>
        )}
        {snag.status !== 'resolved' && isSerious && (
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <StatusButton snagId={snag.id} status="resolved" label="Resolve (requires completed investigation)" />
          </div>
        )}

        <div className={styles.formGrid}>
          <Card as="form" action={assignOwnerAction}>
            <input type="hidden" name="snagId" value={snag.id} />
            <div className="field">
              <label htmlFor="ownerId">Owner</label>
              <select id="ownerId" name="ownerId" defaultValue={snag.owner_id ?? ''}>
                <option value="">Unassigned</option>
                {siteAssignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <Button type="submit" variant="secondary" size="sm">Save</Button>
          </Card>

          <Card as="form" action={recategoriseAction}>
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
            <Button type="submit" variant="secondary" size="sm">Save</Button>
          </Card>
        </div>
      </Section>

      {isSerious && investigation && (
        <Section icon="Microscope" title="Investigation">
          <ul className={styles.checklist}>
            {CHECKLIST_STEPS.map((step) => {
              const done = investigation.completedSteps.includes(step);
              return (
                <li key={step} className={styles.checklistItem} data-done={done}>
                  <Icon name={done ? 'CircleCheckBig' : 'Circle'} size="sm" color={done ? 'var(--color-success)' : 'var(--color-border-strong)'} />
                  {CHECKLIST_STEP_LABELS[step]}
                </li>
              );
            })}
          </ul>

          {remainingChecklist.length > 0 && (
            <div className={styles.actionRow}>
              {remainingChecklist.map((step) => (
                <form key={step} action={completeChecklistStepAction}>
                  <input type="hidden" name="snagId" value={snag.id} />
                  <input type="hidden" name="step" value={step} />
                  <Button type="submit" variant="secondary" size="sm">Mark &quot;{CHECKLIST_STEP_LABELS[step]}&quot; done</Button>
                </form>
              ))}
            </div>
          )}

          <p className={styles.subheading}>Witness statements ({investigation.witnesses.length})</p>
          <div className={styles.itemList}>
            {investigation.witnesses.map((w) => (
              <p key={w.id} style={{ margin: 0, fontSize: 'var(--text-sm)' }}><strong>{w.witness_name}:</strong> {w.statement_text}</p>
            ))}
          </div>
          <Card as="form" action={addWitnessStatementAction} padding="sm" style={{ marginBottom: 'var(--space-xl)' }}>
            <div className="field">
              <input type="hidden" name="snagId" value={snag.id} />
              <label htmlFor="witnessName">Witness name</label>
              <input id="witnessName" name="witnessName" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="statementText">Statement</label>
              <input id="statementText" name="statementText" type="text" required />
            </div>
            <Button type="submit" variant="secondary" size="sm">Add witness statement</Button>
          </Card>

          <p className={styles.subheading}>Evidence ({investigation.evidence.length})</p>
          <div className={styles.evidenceGrid}>
            {investigation.evidence.map((e, i) => (
              evidenceUrls[i] && (
                <a key={e.id} href={evidenceUrls[i]!} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={evidenceUrls[i]!} alt={e.caption ?? 'Evidence'} className={styles.evidenceThumb} />
                </a>
              )
            ))}
          </div>
          <Card as="form" action={addEvidenceAction} encType="multipart/form-data" padding="sm" style={{ marginBottom: 'var(--space-xl)' }}>
            <input type="hidden" name="snagId" value={snag.id} />
            <div className="field">
              <label htmlFor="evidenceFile">File</label>
              <input id="evidenceFile" name="file" type="file" required />
            </div>
            <div className="field">
              <label htmlFor="caption">Caption (optional)</label>
              <input id="caption" name="caption" type="text" />
            </div>
            <Button type="submit" variant="secondary" size="sm">Add evidence</Button>
          </Card>

          <p className={styles.subheading}>Root cause</p>
          {investigation.rootCause ? (
            <p style={{ fontSize: 'var(--text-sm)' }}>{investigation.rootCause}</p>
          ) : (
            <Card as="form" action={setRootCauseAction} padding="sm">
              <input type="hidden" name="snagId" value={snag.id} />
              <div className="field">
                <label htmlFor="rootCauseText">What caused this?</label>
                <input id="rootCauseText" name="rootCauseText" type="text" required />
              </div>
              <Button type="submit" variant="secondary" size="sm">Save root cause</Button>
            </Card>
          )}
        </Section>
      )}

      {isSerious && (
        <Section icon="GitBranch" title="Root cause analysis">
          {!rca && snag.status === 'resolved' && (
            <Card as="form" action={assignRcaAction} padding="sm">
              <input type="hidden" name="snagId" value={snag.id} />
              <div className="field">
                <label htmlFor="assigneeId">Assign RCA to</label>
                <select id="assigneeId" name="assigneeId" required defaultValue="">
                  <option value="" disabled>Choose someone</option>
                  {siteAssignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <Button type="submit" variant="secondary" size="sm">Assign RCA</Button>
            </Card>
          )}
          {!rca && snag.status !== 'resolved' && (
            <EmptyState>An RCA can be assigned once this snag is resolved.</EmptyState>
          )}

          {rca && (
            <>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-md)' }}>Status: {rca.status}</p>
              {rca.rejectionNote && <p className="error-text" style={{ marginBottom: 'var(--space-md)' }}>Rejected: {rca.rejectionNote}</p>}

              {(rca.status === 'assigned' || rca.status === 'in_progress' || rca.status === 'rejected') && (
                <Card as="form" action={saveRcaWhysAction} padding="sm" style={{ marginBottom: 'var(--space-lg)' }}>
                  <input type="hidden" name="snagId" value={snag.id} />
                  <input type="hidden" name="rcaId" value={rca.id} />
                  {[1, 2, 3, 4, 5].map((i) => {
                    const existing = rca.whys.find((w) => w.whyIndex === i);
                    return (
                      <div key={i} style={{ marginBottom: 'var(--space-md)' }}>
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
                  <Button type="submit" variant="secondary" size="sm">Save whys</Button>
                </Card>
              )}

              {(rca.status === 'assigned' || rca.status === 'in_progress' || rca.status === 'rejected') && (
                <form action={submitRcaAction} style={{ marginBottom: 'var(--space-lg)' }}>
                  <input type="hidden" name="snagId" value={snag.id} />
                  <input type="hidden" name="rcaId" value={rca.id} />
                  <Button type="submit" variant="primary">Submit RCA</Button>
                </form>
              )}

              {rca.status === 'submitted' && (
                <>
                  <ol className={styles.rcaWhys}>
                    {rca.whys.map((w) => (
                      <li key={w.whyIndex}>
                        <span className={styles.rcaWhyQuestion}>{w.whyText}</span><br />
                        <span className={styles.rcaWhyAnswer}>{w.answerText}</span>
                      </li>
                    ))}
                  </ol>
                  <div className={styles.actionRow}>
                    <form action={acceptRcaAction}>
                      <input type="hidden" name="snagId" value={snag.id} />
                      <input type="hidden" name="rcaId" value={rca.id} />
                      <Button type="submit" variant="primary">Accept</Button>
                    </form>
                    <details className={styles.disclosure}>
                      <summary><Button as="span" variant="secondary">Reject</Button></summary>
                      <form action={rejectRcaAction} style={{ marginTop: 'var(--space-sm)' }}>
                        <input type="hidden" name="snagId" value={snag.id} />
                        <input type="hidden" name="rcaId" value={rca.id} />
                        <div className="field">
                          <label htmlFor="rejectionNote">Rejection note</label>
                          <input id="rejectionNote" name="rejectionNote" type="text" required />
                        </div>
                        <Button type="submit" variant="secondary" size="sm">Confirm reject</Button>
                      </form>
                    </details>
                  </div>
                </>
              )}

              {rca.status === 'accepted' && (
                <ol className={styles.rcaWhys}>
                  {rca.whys.map((w) => (
                    <li key={w.whyIndex}>
                      <span className={styles.rcaWhyQuestion}>{w.whyText}</span><br />
                      <span className={styles.rcaWhyAnswer}>{w.answerText}</span>
                    </li>
                  ))}
                </ol>
              )}

              {(rca.status === 'assigned' || rca.status === 'in_progress') && (
                <div className={styles.actionRow}>
                  <details className={styles.disclosure}>
                    <summary><Button as="span" variant="secondary">Reassign</Button></summary>
                    <form action={reassignRcaAction} style={{ marginTop: 'var(--space-sm)' }}>
                      <input type="hidden" name="snagId" value={snag.id} />
                      <input type="hidden" name="rcaId" value={rca.id} />
                      <div className="field">
                        <label htmlFor="newAssigneeId">New assignee</label>
                        <select id="newAssigneeId" name="newAssigneeId" required defaultValue="">
                          <option value="" disabled>Choose someone</option>
                          {siteAssignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>
                      <Button type="submit" variant="secondary" size="sm">Confirm reassign</Button>
                    </form>
                  </details>
                  <form action={cancelRcaAction}>
                    <input type="hidden" name="snagId" value={snag.id} />
                    <input type="hidden" name="rcaId" value={rca.id} />
                    <Button type="submit" variant="secondary">Cancel RCA</Button>
                  </form>
                </div>
              )}
            </>
          )}
        </Section>
      )}

      {isSerious && (
        <Section icon="Users" title="Debrief">
          {activeDebrief ? (
            <Card style={{ marginBottom: 'var(--space-lg)' }}>
              <p style={{ margin: '0 0 var(--space-md)', fontWeight: 600 }}>
                {activeDebrief.format === 'hot' ? 'Hot debrief' : 'Formal debrief'} — in progress
              </p>

              <div className={styles.itemList}>
                {activeDebrief.findings.map((f) => <p key={f.id} style={{ margin: 0, fontSize: 'var(--text-sm)' }}>• {f.finding_text}</p>)}
              </div>
              <form action={addDebriefFindingAction} className={styles.inlineForm}>
                <input type="hidden" name="snagId" value={snag.id} />
                <input type="hidden" name="debriefId" value={activeDebrief.id} />
                <input name="findingText" type="text" placeholder="Add a finding" required />
                <Button type="submit" variant="secondary" size="sm">Add</Button>
              </form>

              <div className={styles.itemList}>
                {activeDebrief.lessons.map((l) => <p key={l.id} style={{ margin: 0, fontSize: 'var(--text-sm)' }}>• {l.lesson_text}</p>)}
              </div>
              <form action={addDebriefLessonAction} className={styles.inlineForm}>
                <input type="hidden" name="snagId" value={snag.id} />
                <input type="hidden" name="debriefId" value={activeDebrief.id} />
                <input name="lessonText" type="text" placeholder="Add a lesson learned" required />
                <Button type="submit" variant="secondary" size="sm">Add</Button>
              </form>

              <form action={addDebriefAttendeeAction} className={styles.inlineForm}>
                <input type="hidden" name="snagId" value={snag.id} />
                <input type="hidden" name="debriefId" value={activeDebrief.id} />
                <select name="profileId" required defaultValue="">
                  <option value="" disabled>Add attendee</option>
                  {members.filter((m) => !activeDebrief.attendeeIds.includes(m.id)).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <Button type="submit" variant="secondary" size="sm">Add</Button>
              </form>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-lg)' }}>
                {activeDebrief.attendeeIds.length} attendee(s)
              </p>

              <form action={completeDebriefAction}>
                <input type="hidden" name="snagId" value={snag.id} />
                <input type="hidden" name="debriefId" value={activeDebrief.id} />
                <Button type="submit" variant="primary">Complete debrief</Button>
              </form>
            </Card>
          ) : (
            <Card as="form" action={startDebriefAction} padding="sm" style={{ marginBottom: 'var(--space-lg)' }}>
              <input type="hidden" name="snagId" value={snag.id} />
              <div className="field">
                <label htmlFor="format">Format</label>
                <select id="format" name="format" defaultValue="hot">
                  <option value="hot">Hot debrief</option>
                  <option value="formal">Formal debrief</option>
                </select>
              </div>
              <Button type="submit" variant="secondary" size="sm">Start debrief</Button>
            </Card>
          )}

          {completedDebriefs.length > 0 && (
            <div className={styles.itemList}>
              {completedDebriefs.map((d) => (
                <Card key={d.id} padding="sm">
                  <p style={{ margin: '0 0 var(--space-sm)', fontWeight: 600 }}>
                    {d.format === 'hot' ? 'Hot debrief' : 'Formal debrief'} · completed
                  </p>
                  {d.findings.map((f) => <p key={f.id} style={{ margin: '0 0 4px', fontSize: 'var(--text-sm)' }}>• {f.finding_text}</p>)}
                </Card>
              ))}
            </div>
          )}
        </Section>
      )}

      {isSerious && (
        <Section icon="ClipboardCheck" title="Corrective actions">
          <div className={styles.itemList}>
            {actions.map((action) => (
              <Card key={action.id} padding="sm">
                <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{action.description}</p>
                <p style={{ margin: '0 0 var(--space-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {action.owner_name ?? 'unassigned'} · due {action.due_date} · {action.verified_at ? 'verified' : action.status}
                </p>
                <div className={styles.actionRow} style={{ marginBottom: 0 }}>
                  {action.status !== 'done' && (
                    <form action={completeCorrectiveActionAction}>
                      <input type="hidden" name="snagId" value={snag.id} />
                      <input type="hidden" name="actionId" value={action.id} />
                      <Button type="submit" variant="secondary" size="sm">Mark complete</Button>
                    </form>
                  )}
                  {action.status === 'done' && !action.verified_at && (
                    <form action={verifyCorrectiveActionAction}>
                      <input type="hidden" name="snagId" value={snag.id} />
                      <input type="hidden" name="actionId" value={action.id} />
                      <Button type="submit" variant="secondary" size="sm">Verify</Button>
                    </form>
                  )}
                </div>
              </Card>
            ))}
          </div>

          <Card as="form" action={createCorrectiveActionAction} padding="sm">
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
            <Button type="submit" variant="secondary" size="sm">Create corrective action</Button>
          </Card>
        </Section>
      )}

      <Section icon="MessageSquare" title="Comments">
        {(!comments.data || comments.data.length === 0) && <EmptyState>No comments yet.</EmptyState>}
        <div className={styles.itemList}>
          {(comments.data ?? []).map((c: any) => (
            <div key={c.id} className={styles.commentItem}>
              <p className={styles.commentAuthor}>{c.author?.name ?? 'Unknown'}</p>
              <p className={styles.commentBody}>{c.body}</p>
            </div>
          ))}
        </div>
        <form action={addCommentAction} className={styles.inlineForm}>
          <input type="hidden" name="snagId" value={snag.id} />
          <input name="body" type="text" placeholder="Add a comment" required />
          <Button type="submit" variant="secondary" size="sm">Post</Button>
        </form>
      </Section>

      <Section icon="History" title="Activity">
        <div className={styles.timeline}>
          {auditLog.map((entry) => (
            <p key={entry.id} className={styles.timelineEntry}>
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
      <Button type="submit" variant="secondary">{label}</Button>
    </form>
  );
}

function Section({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionIcon}><Icon name={icon} size="sm" /></span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
