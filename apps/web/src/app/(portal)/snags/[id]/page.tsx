import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getSnagRca, getSnagDebriefs, getInvestigationState, getCorrectiveActions,
  getSnagAuditLog, describeAuditAction, getSiteAssignees, getOrgMembers, getEvidencePhotoUrl,
  isImageEvidence,
  seriousResolveGate, investigationModeLocked,
  getOrgDocuments, getOrgDocumentUrl,
  type SiteAssignee, type ResolveGateKey, type SnagRca, type OrgDocument,
} from '@snag/supabase-queries';
import {
  STATUS_LABELS, KIND_LABELS, SEVERITY_LABELS, CHECKLIST_STEP_LABELS, CHECKLIST_STEPS,
  INVESTIGATION_MODE_OPTIONS,
  type SnagStatus, type SnagKind, type SnagSeverity, type Profile,
} from '@snag/shared-types';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, EmptyState } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge, StatusBadge, KindBadge, SeverityBadge, NotifiableBadge } from '@/components/Badge';
import Icon from '@/components/Icon';
import StepSection from '@/components/StepSection';
import NextStep, { ReadyToResolve } from '@/components/NextStep';
import TriageDialog from '@/components/TriageDialog';
import {
  changeStatusAction, resolveNiggleAction, assignOwnerAction, recategoriseAction,
  addCommentAction, setNotifiableDecisionAction, unmergeAction, triageAction,
} from './actions';
import {
  completeChecklistStepAction, addWitnessStatementAction, addEvidenceAction, setRootCauseAction,
  updateEvidenceCaptionAction, deleteEvidenceAction,
} from './investigation-actions';
import {
  assignRcaAction, saveRcaWhyAction, submitRcaAction, acceptRcaAction, rejectRcaAction,
  reassignRcaAction, cancelRcaAction,
} from './rca-actions';
import {
  startDebriefAction, addDebriefFindingAction, addDebriefLessonAction, addDebriefAttendeeAction,
  completeDebriefAction,
} from './debrief-actions';
import {
  createCorrectiveActionAction, completeCorrectiveActionAction, verifyCorrectiveActionAction,
} from './capa-actions';
import {
  attachInvestigationDocumentAction, uploadInvestigationDocumentAction,
  acceptInvestigationDocumentAction,
} from './document-actions';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Snag',
};

const KIND_OPTIONS: SnagKind[] = ['fixit', 'improvement', 'hazard', 'incident'];
const SEVERITY_OPTIONS: SnagSeverity[] = ['minor', 'moderate', 'injury', 'critical'];
const WHY_INDICES = [1, 2, 3, 4, 5];

/**
 * How each shared gate condition is presented, and which section its CTA
 * opens. The conditions themselves — and the order they're checked in — come
 * from seriousResolveGate, shared with apps/mobile so the two clients can't
 * tell people to do things in different orders.
 */
const GATE_COPY: Record<ResolveGateKey, { title: string; detail: string; cta: string; section: string }> = {
  notifiable: {
    title: 'Decide if this is notifiable',
    detail: "Does it meet WorkSafe's threshold? A notifiable event has to be reported as soon as possible, and the site preserved.",
    cta: 'Make the call',
    section: 'notifiable',
  },
  checklist: {
    title: 'Finish the first-response checklist',
    detail: 'Make safe, preserve the scene, capture evidence, identify witnesses, find the cause.',
    cta: 'Open the checklist',
    section: 'checklist',
  },
  witnesses: {
    title: 'Add a witness statement',
    detail: 'Record what someone who was there saw, in their words.',
    cta: 'Add a witness',
    section: 'witnesses',
  },
  evidence: {
    title: 'Capture evidence',
    detail: 'Photos of the scene, the equipment, and anything that explains how this happened.',
    cta: 'Add evidence',
    section: 'evidence',
  },
  rootCause: {
    title: 'Record the root cause',
    detail: 'What actually caused this — not what went wrong, but why it could.',
    cta: 'Record root cause',
    section: 'rootCause',
  },
  correctiveActions: {
    title: 'Close the corrective actions',
    detail: 'Each one needs completing and verifying before this can close.',
    cta: 'Open corrective actions',
    section: 'correctiveActions',
  },
  // Document mode: the org runs its own investigation process and evidences
  // it with a file. These replace root cause and corrective actions above.
  investigationDocument: {
    title: 'Attach the investigation document',
    detail: "This snag is using your organisation's own investigation process, so the completed document is what closes it.",
    cta: 'Attach the document',
    section: 'investigationDocument',
  },
  documentAccepted: {
    title: 'Accept the investigation document',
    detail: 'A supervisor has to read it and sign it off — attaching a file is not the same as accepting the investigation.',
    cta: 'Review the document',
    section: 'investigationDocument',
  },
};

export default async function SnagDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; step?: string; triaged?: string }>;
}) {
  const { id } = await params;
  const { error, step, triaged } = await searchParams;
  const { activeMembership } = await requireSupervisorOrAdmin();
  const supabase = await createClient();

  const { data: snag } = await supabase
    .from('snags_with_details')
    .select('id, reference, description, status, kind, lane, severity, site_id, site_name, owner_id, owner_name, reporter_name, created_at, is_notifiable, notifiable_marked_at, parent_snag_id, child_count')
    .eq('id', id)
    .maybeSingle();

  if (!snag) notFound();

  const isSerious = snag.lane === 'serious';
  const isNiggle = !isSerious;
  const isResolved = snag.status === 'resolved';

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

  // Document mode only. Fetching the library on every serious snag would be a
  // round trip nobody reads on the guided path.
  const isDocumentMode = investigation?.mode === 'document';
  // Whether Manage may still offer the mode choice. Mirrors
  // assign_investigation's guard, so the form doesn't present a control the
  // server would refuse. Officer admins keep it, with a warning.
  const modeLocked = investigation ? investigationModeLocked(investigation) : false;
  const canOverrideMode = activeMembership.role === 'officer_admin';
  const [libraryDocuments, documentUrl]: [OrgDocument[], string | null] = isDocumentMode
    ? await Promise.all([
        getOrgDocuments(supabase, activeMembership.org_id),
        investigation!.documentPath ? getOrgDocumentUrl(supabase, investigation!.documentPath) : Promise.resolve(null),
      ])
    : [[], null];

  // Any supervisor or admin, including whoever attached it — the whole
  // (portal) group is already role-gated, so reaching this page is the check.
  // Self-acceptance is recorded rather than prevented; see the meta line below.
  const canAcceptDocument = Boolean(investigation?.documentId);

  const siteAssignees: SiteAssignee[] = assignees.data ?? [];
  const nameOf = (profileId: string | null) =>
    profileId ? members.find((m) => m.id === profileId)?.name ?? null : null;
  const activeDebrief = debriefs.find((d) => d.status === 'in_progress');
  const completedDebriefs = debriefs.filter((d) => d.status !== 'in_progress');
  const remainingChecklist = CHECKLIST_STEPS.filter((s) => !investigation?.completedSteps.includes(s));
  const commentList = comments.data ?? [];

  // Decided is not the same as notifiable: `notifiable_marked_at` is stamped by
  // either answer, and only an answered snag can be resolved.
  const notifiableDecided = snag.is_notifiable === true || snag.notifiable_marked_at !== null;

  // Untriaged means unallocated: nobody has been given the investigation.
  //
  // leadInvestigatorId rather than owner_id, because apply_default_owner fills
  // owner_id on the way in (the first serious incident owner) without creating
  // an investigations row — a snag arrives owned but unallocated, which is the
  // state triage exists to end.
  //
  // Deliberately *not* also "notifiable is undecided", even though triage asks
  // that too. Deferring the notifiable call is a legitimate answer, and
  // re-prompting on every page load would turn "I'm not sure yet" into a wall.
  // Once allocated, the decision lives on the resolve gate and the Notifiable
  // section, which already refuse to let the snag close without it.
  const needsTriage = Boolean(
    isSerious && investigation && triaged !== '1' &&
    (snag.status === 'flagged' || snag.status === 'in_progress') &&
    investigation.leadInvestigatorId === null
  );

  const gate = investigation ? seriousResolveGate(investigation, notifiableDecided) : [];
  const firstUnmet = gate.find((c) => c.unmet);
  const remaining = gate.filter((c) => c.unmet).length;

  // update_snag_status refuses `resolved` outright while an RCA is open —
  // "This snag has an RCA in progress — accept or reject it first" — and that
  // check sits above the resolved block, so it isn't one of the gate's
  // conditions. Without it here the page offered Resolve on an rca_pending
  // snag and the server threw.
  const rcaOpen = snag.status === 'rca_pending';
  const rcaBlock = rcaOpen ? rcaNextStep(rca, siteAssignees) : null;

  // The Next-step card's CTA links back here with ?step=…, which is what opens
  // the section it points at. Everything else starts closed: the whole point of
  // the restructure is that the collapsed headers are the progress list.
  // A failed action lands on ?error=… — open Manage so the message has context.
  const openSection = step ?? (error ? 'manage' : undefined);
  const isOpen = (name: string) => openSection === name;

  const checklistDone = investigation?.completedSteps.length ?? 0;
  const evidenceCount = investigation?.evidence.length ?? 0;
  const witnessCount = investigation?.witnesses.length ?? 0;
  const hasRootCause = Boolean(investigation?.rootCause?.trim());
  const openActions = investigation?.openCorrectiveActions ?? 0;

  return (
    <div className={styles.page}>
      {/* Triage — the first thing a supervisor meets on an unallocated serious
          snag, and deliberately not dismissible. Everything below it on the
          page assumes somebody is running this investigation. */}
      {needsTriage && investigation && (
        <TriageDialog
          snagId={snag.id}
          reference={snag.reference}
          description={snag.description ?? null}
          assignees={siteAssignees}
          currentOwnerId={snag.owner_id ?? null}
          currentMode={investigation.mode}
          action={triageAction}
        />
      )}

      <header className={styles.header}>
        <p className={styles.site}>{snag.site_name}</p>
        <h1 className={styles.reference}>{snag.reference}</h1>
        <div className={styles.badgeRow}>
          <StatusBadge status={snag.status as SnagStatus} />
          <KindBadge kind={snag.kind as SnagKind} />
          {snag.severity && <SeverityBadge severity={snag.severity as SnagSeverity} />}
          {snag.is_notifiable
            ? <NotifiableBadge />
            : snag.notifiable_marked_at
            ? <Badge>Not notifiable</Badge>
            : isSerious && <Badge tone="primary">Notifiable: undecided</Badge>}
        </div>
        <p className={styles.description}>{snag.description ?? '(no description)'}</p>
        <p className={styles.meta}>
          Reported by {snag.reporter_name} · {snag.owner_name ? `assigned to ${snag.owner_name}` : 'unassigned'}
          {snag.parent_snag_id ? ' · merged into another snag' : ''}
          {snag.child_count ? ` · ${snag.child_count} snag(s) merged into this one` : ''}
        </p>
        {error && <p className="error-text">{error}</p>}
      </header>

      {/* One answer to "what do I do now", above everything else. */}
      {isSerious && !isResolved && investigation && (
        rcaBlock ? (
          <NextStep
            title={rcaBlock.title}
            detail={rcaBlock.detail}
            cta="Open the analysis"
            href={`/snags/${snag.id}?step=rca#rca`}
            remaining={1}
          />
        ) : firstUnmet ? (
          <NextStep
            title={GATE_COPY[firstUnmet.key].title}
            detail={
              firstUnmet.key === 'checklist'
                ? `${checklistDone} of 5 steps done — ${GATE_COPY.checklist.detail.toLowerCase()}`
                : firstUnmet.key === 'correctiveActions'
                ? `${openActions} still open — each needs completing and verifying.`
                : GATE_COPY[firstUnmet.key].detail
            }
            cta={GATE_COPY[firstUnmet.key].cta}
            href={`/snags/${snag.id}?step=${GATE_COPY[firstUnmet.key].section}#${GATE_COPY[firstUnmet.key].section}`}
            remaining={remaining}
          />
        ) : (
          <ReadyToResolve>
            <StatusButton snagId={snag.id} status="resolved" label="Resolve this snag" variant="primary" />
          </ReadyToResolve>
        )
      )}

      {/* ── The serious lane's investigation: one section per gate condition,
             in the order the server checks them. ── */}
      {isSerious && investigation && (
        <>
          <StepSection
            id="notifiable"
            icon="ShieldAlert"
            title="Notifiable Event"
            state={notifiableDecided ? 'done' : 'pending'}
            summary={snag.is_notifiable ? 'Flagged as notifiable' : snag.notifiable_marked_at ? 'Not notifiable' : 'Needs a decision'}
            defaultOpen={isOpen('notifiable')}
          >
            {/* A question with two answers, not a one-way toggle. As a toggle
                the only control on an undecided snag read "Mark notifiable",
                so recording "no" — which update_snag_status requires before
                this can be resolved — meant claiming a notifiable event and
                retracting it, leaving a marked_notifiable entry in the audit
                log for something that never happened. */}
            <p className={styles.question}>Does this need reporting to WorkSafe?</p>
            {notifiableDecided ? (
              <>
                <p className={styles.decision}>
                  {snag.is_notifiable
                    ? 'Flagged as notifiable — it has to be reported as soon as possible, and the site preserved.'
                    : 'Reviewed and recorded as not notifiable.'}
                </p>
                <NotifiableButton
                  snagId={snag.id}
                  value={!snag.is_notifiable}
                  label={snag.is_notifiable ? "This isn't notifiable after all" : 'Actually, this is notifiable'}
                />
              </>
            ) : (
              <>
                <p className={styles.decision}>
                  Undecided. This has to be answered either way before the snag can be resolved.
                </p>
                <div className={styles.actionRow}>
                  <NotifiableButton snagId={snag.id} value label="Yes — notifiable" variant="danger" />
                  <NotifiableButton snagId={snag.id} value={false} label="No" />
                </div>
              </>
            )}
          </StepSection>

          <StepSection
            id="checklist"
            icon="ListChecks"
            title="Make safe & preserve scene"
            state={checklistDone === 5 ? 'done' : checklistDone > 0 ? 'in_progress' : 'pending'}
            summary={`${checklistDone} of 5 done`}
            defaultOpen={isOpen('checklist')}
          >
            <ul className={styles.checklist}>
              {CHECKLIST_STEPS.map((s) => {
                const done = investigation.completedSteps.includes(s);
                return (
                  <li key={s} className={styles.checklistItem} data-done={done}>
                    <Icon name={done ? 'CircleCheckBig' : 'Circle'} size="sm" color={done ? 'var(--color-success)' : 'var(--color-border-strong)'} />
                    {CHECKLIST_STEP_LABELS[s]}
                  </li>
                );
              })}
            </ul>

            {remainingChecklist.length > 0 && (
              <div className={styles.actionRow}>
                {remainingChecklist.map((s) => (
                  <form key={s} action={completeChecklistStepAction}>
                    <input type="hidden" name="snagId" value={snag.id} />
                    <input type="hidden" name="step" value={s} />
                    <Button type="submit" variant="secondary" size="sm">Mark &quot;{CHECKLIST_STEP_LABELS[s]}&quot; done</Button>
                  </form>
                ))}
              </div>
            )}
          </StepSection>

          <StepSection
            id="witnesses"
            icon="Users"
            title="Witnesses"
            state={witnessCount > 0 ? 'done' : 'pending'}
            summary={
              witnessCount === 0 ? 'None recorded'
              : witnessCount === 1 ? `1 statement · ${investigation.witnesses[0].witness_name}`
              : `${witnessCount} statements`
            }
            defaultOpen={isOpen('witnesses')}
          >
            <div className={styles.itemList}>
              {investigation.witnesses.map((w) => (
                <div key={w.id} className={styles.record}>
                  <p className={styles.recordName}>{w.witness_name}</p>
                  <p className={styles.recordBody}>{w.statement_text}</p>
                </div>
              ))}
            </div>
            <Card as="form" action={addWitnessStatementAction} padding="sm">
              <input type="hidden" name="snagId" value={snag.id} />
              <div className="field">
                <label htmlFor="witnessName">Who saw it?</label>
                <input id="witnessName" name="witnessName" type="text" required placeholder="Their name" />
              </div>
              <div className="field">
                <label htmlFor="statementText">What did they see?</label>
                <input
                  id="statementText"
                  name="statementText"
                  type="text"
                  required
                  placeholder="In their own words — not your summary of it"
                />
              </div>
              <Button type="submit" variant="secondary" size="sm">Add witness statement</Button>
            </Card>
          </StepSection>

          <StepSection
            id="evidence"
            icon="Camera"
            title="Evidence"
            state={evidenceCount > 0 ? 'done' : 'pending'}
            summary={evidenceCount === 0 ? 'None captured' : `${evidenceCount} item${evidenceCount === 1 ? '' : 's'}`}
            defaultOpen={isOpen('evidence')}
          >
            <div className={styles.evidenceGrid}>
              {investigation.evidence.map((e, i) => (
                <div key={e.id} data-evidence-item className={styles.evidenceItem}>
                  {evidenceUrls[i] && isImageEvidence(e.media_path) ? (
                    <a href={evidenceUrls[i]!} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={evidenceUrls[i]!} alt={e.caption ?? 'Evidence'} className={styles.evidenceThumb} />
                    </a>
                  ) : evidenceUrls[i] ? (
                    // A document, not a picture. Rendering it as an <img> gave a
                    // broken-image icon and no way to open what was attached.
                    <a
                      className={styles.evidenceFile}
                      href={evidenceUrls[i]!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon name="FileText" size="sm" />
                      {e.caption || e.media_path.split('/').pop()}
                    </a>
                  ) : (
                    // Caption-only evidence is a first-class record — the mobile
                    // sheet accepts one, and add_evidence_item stores an empty
                    // media path for it. Rendering only thumbnails dropped those
                    // items silently, so the count said 1 and the grid was empty.
                    <p className={styles.evidenceNote}>
                      {e.caption || 'Evidence (no caption)'}
                    </p>
                  )}

                  {/* Correcting a caption and removing the item are separate
                      submissions, so they are separate forms — nesting them
                      isn't valid HTML and one submit button can't mean two
                      things. */}
                  <form action={updateEvidenceCaptionAction} className={styles.evidenceCaptionForm}>
                    <input type="hidden" name="snagId" value={snag.id} />
                    <input type="hidden" name="evidenceId" value={e.id} />
                    <input
                      name="caption"
                      defaultValue={e.caption ?? ''}
                      placeholder="What does this show?"
                      aria-label="Evidence caption"
                    />
                    <Button type="submit" variant="ghost" size="sm">Save</Button>
                  </form>
                  <form action={deleteEvidenceAction}>
                    <input type="hidden" name="snagId" value={snag.id} />
                    <input type="hidden" name="evidenceId" value={e.id} />
                    <Button type="submit" variant="danger" size="sm">Remove</Button>
                  </form>
                </div>
              ))}
            </div>
            <Card as="form" action={addEvidenceAction} padding="sm">
              <input type="hidden" name="snagId" value={snag.id} />
              <div className="field">
                <label htmlFor="evidenceFile">Photo or document</label>
                <input id="evidenceFile" name="file" type="file" required />
              </div>
              <div className="field">
                <label htmlFor="caption">What does this show?</label>
                <input id="caption" name="caption" type="text" placeholder="e.g. Walkway markings worn away at the dock corner" />
              </div>
              <Button type="submit" variant="secondary" size="sm">Add evidence</Button>
            </Card>
          </StepSection>

          {/* ── The fork. From here on the two investigation modes diverge:
                 the guided process asks for a root cause and corrective
                 actions; an organisation running its own process attaches the
                 document it produced and has a second supervisor sign it off.
                 Everything above this line is required either way. ── */}
          {isDocumentMode ? (
            <StepSection
              id="investigationDocument"
              icon="FileText"
              title="Investigation document"
              state={investigation.documentAccepted ? 'done' : investigation.documentId ? 'in_progress' : 'pending'}
              summary={
                investigation.documentAccepted ? 'Accepted'
                : investigation.documentId ? 'Attached — awaiting sign-off'
                : 'Not attached'
              }
              defaultOpen={isOpen('investigationDocument')}
            >
              <p className={styles.decision}>
                This snag is being investigated under your organisation&rsquo;s own process. The
                completed document takes the place of the root cause and corrective actions —
                everything before this point still applies.
              </p>

              {investigation.documentId ? (
                <Card padding="sm">
                  <p className={styles.recordName}>
                    {documentUrl ? (
                      <a href={documentUrl} target="_blank" rel="noreferrer" data-investigation-document>
                        <Icon name="FileText" size="sm" /> {investigation.documentTitle ?? 'Investigation document'}
                      </a>
                    ) : (
                      investigation.documentTitle ?? 'Investigation document'
                    )}
                  </p>
                  <p className={styles.recordMeta}>
                    Attached by {nameOf(investigation.documentAttachedBy) ?? 'someone in your organisation'}
                    {investigation.documentAccepted
                      ? ` · accepted by ${nameOf(investigation.documentAcceptedBy) ?? 'a supervisor'}`
                      : ' · not yet accepted'}
                  </p>

                  {/* Attaching is still not accepting — the gate wants a
                      supervisor to have read it and said so. But it need not be
                      a *different* supervisor: a site lead allocates the
                      investigation to a crew, so the two are usually different
                      people anyway, and forcing it deadlocked the case where
                      the supervisor did the work themselves. The record names
                      both, which is the half worth keeping. */}
                  {!investigation.documentAccepted && canAcceptDocument && (
                    <form action={acceptInvestigationDocumentAction}>
                      <input type="hidden" name="snagId" value={snag.id} />
                      <Button type="submit" variant="primary" size="sm">Accept this document</Button>
                    </form>
                  )}
                </Card>
              ) : (
                <EmptyState>No investigation document attached yet.</EmptyState>
              )}

              <Card as="form" action={uploadInvestigationDocumentAction} padding="sm">
                <p className={styles.recordName}>Upload the completed investigation</p>
                <div className="field">
                  <label htmlFor="documentFile">File</label>
                  <input id="documentFile" name="file" type="file" required />
                </div>
                <div className="field">
                  <label htmlFor="documentTitle">Title</label>
                  <input
                    id="documentTitle"
                    name="title"
                    type="text"
                    required
                    placeholder={`Investigation report — ${snag.reference}`}
                  />
                </div>
                <input type="hidden" name="snagId" value={snag.id} />
                <Button type="submit" variant="secondary" size="sm">
                  {investigation.documentId ? 'Replace with a new upload' : 'Upload and attach'}
                </Button>
                <p className={styles.recordMeta}>
                  It&rsquo;s filed in the document library too, so it can be found later by
                  someone who wasn&rsquo;t involved.
                </p>
              </Card>

              {libraryDocuments.length > 0 && (
                <Card as="form" action={attachInvestigationDocumentAction} padding="sm">
                  <p className={styles.recordName}>Or attach one already in the library</p>
                  <input type="hidden" name="snagId" value={snag.id} />
                  <div className="field">
                    <label htmlFor="documentId">Document</label>
                    <select id="documentId" name="documentId" required defaultValue="">
                      <option value="" disabled>Choose a document</option>
                      {libraryDocuments.map((d) => (
                        <option key={d.id} value={d.id}>{d.title}</option>
                      ))}
                    </select>
                  </div>
                  <Button type="submit" variant="secondary" size="sm">Attach</Button>
                </Card>
              )}

              {investigation.documentAccepted && (
                <p className={styles.recordMeta}>
                  Replacing the document clears this acceptance — a different document is a
                  different investigation.
                </p>
              )}
            </StepSection>
          ) : (
          <>
          <StepSection
            id="rootCause"
            icon="Search"
            title="Root cause"
            state={hasRootCause ? 'done' : 'pending'}
            summary={hasRootCause ? 'Recorded' : 'Not recorded'}
            defaultOpen={isOpen('rootCause')}
          >
            {/* Editable after the first save. set_root_cause upserts, and an
                investigation's understanding of the cause is exactly the thing
                that changes as evidence comes in. */}
            <Card as="form" action={setRootCauseAction} padding="sm">
              <input type="hidden" name="snagId" value={snag.id} />
              <div className="field">
                <label htmlFor="rootCauseText">What actually caused this?</label>
                <input
                  id="rootCauseText"
                  name="rootCauseText"
                  type="text"
                  required
                  defaultValue={investigation.rootCause ?? ''}
                  placeholder="e.g. No physical separation between forklift routes and the pedestrian walkway"
                />
              </div>
              <Button type="submit" variant="secondary" size="sm">
                {hasRootCause ? 'Update root cause' : 'Save root cause'}
              </Button>
            </Card>
          </StepSection>

          <StepSection
            id="correctiveActions"
            icon="ClipboardCheck"
            title="Corrective actions"
            state={actions.length === 0 ? 'pending' : openActions > 0 ? 'in_progress' : 'done'}
            summary={openActions > 0 ? `${openActions} open` : actions.length > 0 ? 'All closed' : 'None yet'}
            defaultOpen={isOpen('correctiveActions')}
          >
            <div className={styles.itemList}>
              {actions.map((action) => (
                <Card key={action.id} padding="sm">
                  <p className={styles.recordName}>{action.description}</p>
                  <p className={styles.recordMeta}>
                    {action.owner_name ?? 'unassigned'} · due {formatDate(action.due_date)} ·{' '}
                    {action.verified_at ? 'verified' : action.status}
                  </p>
                  <div className={styles.actionRow}>
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
                <label htmlFor="description">What needs doing?</label>
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
          </StepSection>
          </>
          )}

          <StepSection
            id="rca"
            icon="GitBranch"
            title="5 Whys analysis"
            state={rca?.status === 'accepted' ? 'done' : rca ? 'in_progress' : 'optional'}
            summary={rcaSummary(rca, isResolved, siteAssignees)}
            defaultOpen={isOpen('rca')}
          >
            <RcaBody
              rca={rca}
              snagId={snag.id}
              problem={snag.description ?? 'the incident'}
              isResolved={isResolved}
              assignees={siteAssignees}
            />
          </StepSection>

          <StepSection
            id="debrief"
            icon="Users"
            title="Debrief"
            state={activeDebrief ? 'in_progress' : completedDebriefs.length > 0 ? 'done' : 'optional'}
            summary={
              activeDebrief ? 'In progress'
              : completedDebriefs.length > 0 ? `${completedDebriefs.length} completed`
              : 'None yet — optional'
            }
            defaultOpen={isOpen('debrief')}
          >
            {activeDebrief ? (
              <Card>
                <p className={styles.recordName}>
                  Debrief — in progress
                </p>

                <p className={styles.subheading}>Findings</p>
                <div className={styles.itemList}>
                  {activeDebrief.findings.map((f) => <p key={f.id} className={styles.bullet}>{f.finding_text}</p>)}
                </div>
                <form action={addDebriefFindingAction} className={styles.inlineForm}>
                  <input type="hidden" name="snagId" value={snag.id} />
                  <input type="hidden" name="debriefId" value={activeDebrief.id} />
                  <input name="findingText" type="text" placeholder="Add a finding" required />
                  <Button type="submit" variant="secondary" size="sm">Add</Button>
                </form>

                <p className={styles.subheading}>Lessons learned</p>
                <div className={styles.itemList}>
                  {activeDebrief.lessons.map((l) => <p key={l.id} className={styles.bullet}>{l.lesson_text}</p>)}
                </div>
                <form action={addDebriefLessonAction} className={styles.inlineForm}>
                  <input type="hidden" name="snagId" value={snag.id} />
                  <input type="hidden" name="debriefId" value={activeDebrief.id} />
                  <input name="lessonText" type="text" placeholder="Add a lesson learned" required />
                  <Button type="submit" variant="secondary" size="sm">Add</Button>
                </form>

                <p className={styles.subheading}>Who was there ({activeDebrief.attendeeIds.length})</p>
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

                <form action={completeDebriefAction}>
                  <input type="hidden" name="snagId" value={snag.id} />
                  <input type="hidden" name="debriefId" value={activeDebrief.id} />
                  <Button type="submit" variant="primary">Complete debrief</Button>
                </form>
              </Card>
            ) : (
              <form action={startDebriefAction}>
                <input type="hidden" name="snagId" value={snag.id} />
                <Button type="submit" variant="secondary" size="sm">Start debrief</Button>
              </form>
            )}

            {completedDebriefs.length > 0 && (
              <div className={styles.itemList}>
                {completedDebriefs.map((d) => (
                  <Card key={d.id} padding="sm">
                    <p className={styles.recordName}>
                      Debrief · completed
                    </p>
                    {d.findings.map((f) => <p key={f.id} className={styles.bullet}>{f.finding_text}</p>)}
                    {/* Lessons were collected and then never shown back. They
                        are the part of a debrief with a life beyond the snag. */}
                    {d.lessons.map((l) => <p key={l.id} className={styles.bulletLesson}>{l.lesson_text}</p>)}
                  </Card>
                ))}
              </div>
            )}
          </StepSection>
        </>
      )}

      {/* ── Settings and the terminal action. Behind a disclosure on both
             lanes: these are settings, and settings shouldn't sit between the
             reader and the work. ── */}
      <StepSection
        id="manage"
        icon="Settings2"
        title="Manage"
        summary={`${STATUS_LABELS[snag.status as SnagStatus]} · ${snag.owner_name ?? 'unassigned'}`}
        defaultOpen={isOpen('manage')}
      >
        <div className={styles.actionRow}>
          {snag.status !== 'flagged' && <StatusButton snagId={snag.id} status="flagged" label="Re-flag" />}
          {snag.status !== 'in_progress' && !isResolved && (
            <StatusButton snagId={snag.id} status="in_progress" label="Mark In Progress" />
          )}
          {snag.parent_snag_id && (
            <form action={unmergeAction}>
              <input type="hidden" name="snagId" value={snag.id} />
              <Button type="submit" variant="secondary">Unmerge</Button>
            </form>
          )}
        </div>

        {!isResolved && isNiggle && (
          <Card as="form" action={resolveNiggleAction}>
            <input type="hidden" name="snagId" value={snag.id} />
            <div className="field">
              <label htmlFor="note">Resolution note</label>
              <input id="note" name="note" type="text" required placeholder="What was done to fix this?" />
            </div>
            <Button type="submit" variant="primary">Resolve</Button>
          </Card>
        )}
        {!isResolved && isSerious && (rcaBlock || firstUnmet) && (
          // Named, not annotated. This used to be a live button labelled
          // "Resolve (requires completed investigation)", so the only way to
          // find out what was missing was to press it and read the raw
          // Postgres exception the server raised.
          <p className={styles.blocked}>
            <Icon name="Lock" size="sm" />
            Resolve is blocked — {rcaBlock ? rcaBlock.reason : firstUnmet!.reason.toLowerCase()}
          </p>
        )}
        {!isResolved && isSerious && !rcaBlock && !firstUnmet && investigation && (
          <StatusButton snagId={snag.id} status="resolved" label="Resolve" variant="primary" />
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
            {/* The re-allocate path. Triage asks this first, on the way in;
                this is where the *investigator* gets changed afterwards.
                Same wording either way — the copy is shared, because a
                supervisor comparing the two screens should not have to work out
                whether they mean the same thing. The owner is the lead
                investigator.

                How it is investigated is a different matter: once work has been
                recorded under the chosen mode, switching would strand it and
                assign_investigation refuses. With no `mode` field on the form,
                assignOwnerAction skips the RPC and re-assigning the
                investigator keeps working. */}
            {isSerious && !isResolved && (
              modeLocked && !canOverrideMode ? (
                <p className={styles.modeLocked}>
                  <Icon name="Lock" size="sm" />
                  <span>
                    Investigated using{' '}
                    <strong>{isDocumentMode ? "your organisation's own process" : 'the SNAG investigation'}</strong>.
                    Work has been recorded against it, so this can no longer be changed.
                  </span>
                </p>
              ) : (
                <fieldset className={styles.modeChoice}>
                  <legend>How will this be investigated?</legend>
                  {modeLocked && (
                    <p className={styles.modeWarning}>
                      This investigation is already under way. Changing it now leaves the work
                      already recorded counting for nothing, and is recorded against your name.
                    </p>
                  )}
                  {INVESTIGATION_MODE_OPTIONS.map((option) => (
                    <label key={option.value} className={styles.modeOption}>
                      <input
                        type="radio"
                        name="mode"
                        value={option.value}
                        defaultChecked={option.value === (isDocumentMode ? 'document' : 'snag')}
                      />
                      <span>
                        <strong>{option.title}</strong>
                        {option.detail}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )
            )}
            <Button type="submit" variant="secondary" size="sm">
              {isSerious ? 'Save allocation' : 'Save'}
            </Button>
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
      </StepSection>

      <StepSection
        id="comments"
        icon="MessageSquare"
        title="Comments"
        summary={commentList.length === 0 ? 'None yet' : `${commentList.length}`}
        defaultOpen={isOpen('comments')}
      >
        {commentList.length === 0 && <EmptyState>No comments yet.</EmptyState>}
        <div className={styles.itemList}>
          {commentList.map((c: any) => (
            <div key={c.id} className={styles.record}>
              <p className={styles.recordName}>{c.author?.name ?? 'Unknown'}</p>
              <p className={styles.recordBody}>{c.body}</p>
            </div>
          ))}
        </div>
        <form action={addCommentAction} className={styles.inlineForm}>
          <input type="hidden" name="snagId" value={snag.id} />
          <input name="body" type="text" placeholder="Add a comment" required />
          <Button type="submit" variant="secondary" size="sm">Post</Button>
        </form>
      </StepSection>

      <StepSection
        id="activity"
        icon="History"
        title="Activity"
        summary={`${auditLog.length} event${auditLog.length === 1 ? '' : 's'}`}
        defaultOpen={isOpen('activity')}
      >
        <div className={styles.timeline}>
          {auditLog.map((entry) => (
            <p key={entry.id} className={styles.timelineEntry}>
              <strong>{entry.actor_name ?? 'System'}</strong> {describeAuditAction(entry.action)}
            </p>
          ))}
        </div>
      </StepSection>
    </div>
  );
}

/**
 * What an open RCA blocks on, phrased for where it actually is. "Submitted and
 * waiting on you" and "out with someone else" call for different things from
 * the reader, and only one of them is an action they can take now.
 */
function rcaNextStep(rca: SnagRca | null, assignees: SiteAssignee[]) {
  if (rca?.status === 'submitted') {
    return {
      title: 'Review the 5 Whys',
      detail: 'The analysis has been submitted and is waiting on you to accept it or send it back.',
      reason: 'the analysis is waiting on your review',
    };
  }
  const name = rca ? assignees.find((a) => a.id === rca.assignedTo)?.name : null;
  return {
    title: 'Waiting on the 5 Whys analysis',
    detail: name
      ? `It's with ${name}. This can't close until the analysis is submitted and accepted.`
      : "This can't close until the analysis is submitted and accepted.",
    reason: 'an analysis is in progress — accept or reject it first',
  };
}

/** Keeps the collapsed RCA header honest without anyone having to open it. */
function rcaSummary(rca: SnagRca | null, isResolved: boolean, assignees: SiteAssignee[]): string {
  if (!rca) return isResolved ? 'Not assigned' : 'Available once resolved';
  switch (rca.status) {
    case 'submitted': return 'Submitted — awaiting review';
    case 'rejected': return 'Sent back — needs another look';
    case 'accepted': return 'Accepted';
    case 'cancelled': return 'Cancelled';
    default: {
      // Who owes it is the useful part while it's out for analysis; "in
      // progress" tells a supervisor nothing they can act on.
      const name = assignees.find((a) => a.id === rca.assignedTo)?.name;
      return name ? `With ${name}` : 'In progress';
    }
  }
}

function RcaBody({
  rca, snagId, problem, isResolved, assignees,
}: {
  rca: SnagRca | null;
  snagId: string;
  problem: string;
  isResolved: boolean;
  assignees: SiteAssignee[];
}) {
  if (!rca) {
    return isResolved ? (
      <Card as="form" action={assignRcaAction} padding="sm">
        <input type="hidden" name="snagId" value={snagId} />
        <div className="field">
          <label htmlFor="assigneeId">Assign the analysis to</label>
          <select id="assigneeId" name="assigneeId" required defaultValue="">
            <option value="" disabled>Choose someone</option>
            {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <Button type="submit" variant="secondary" size="sm">Assign analysis</Button>
      </Card>
    ) : (
      <EmptyState>A 5 Whys analysis can be assigned once this snag is resolved.</EmptyState>
    );
  }

  const byIndex = new Map(rca.whys.map((w) => [w.whyIndex, w]));
  const isComplete = (i: number) => Boolean(byIndex.get(i)?.whyText.trim() && byIndex.get(i)?.answerText.trim());
  const nextIndex = WHY_INDICES.find((i) => !isComplete(i)) ?? null;
  const editable = rca.status === 'assigned' || rca.status === 'in_progress' || rca.status === 'rejected';

  /** What this why is asked of: the problem for #1, the previous answer after. */
  const premiseFor = (i: number) => (i === 1 ? problem : byIndex.get(i - 1)?.answerText ?? '');

  return (
    <>
      {rca.rejectionNote && <p className="error-text">Sent back: {rca.rejectionNote}</p>}

      {/* The chain so far. Asking all five at once — which is what ten stacked
          inputs did — invites five parallel guesses at the same question
          rather than one line of reasoning, because why #2 is asked *of the
          answer to* #1. */}
      <ol className={styles.whyChain}>
        {WHY_INDICES.filter(isComplete).map((i) => {
          const w = byIndex.get(i)!;
          return (
            <li key={i} className={styles.whyStep}>
              <p className={styles.whyQuestion}>{w.whyText}</p>
              <p className={styles.whyAnswer}>{w.answerText}</p>
            </li>
          );
        })}
      </ol>

      {editable && nextIndex !== null && (
        <Card as="form" action={saveRcaWhyAction} padding="sm">
          <input type="hidden" name="snagId" value={snagId} />
          <input type="hidden" name="rcaId" value={rca.id} />
          <input type="hidden" name="whyIndex" value={nextIndex} />
          <p className={styles.whyPremise}>
            Why {nextIndex} of 5 · asked of: {premiseFor(nextIndex) || 'the incident'}
          </p>
          <div className="field">
            <label htmlFor="whyText">{nextIndex === 1 ? 'Why did this happen?' : 'Why did that happen?'}</label>
            <input
              id="whyText"
              name="whyText"
              type="text"
              required
              placeholder={nextIndex === 1 ? 'e.g. Why did the forklift enter the walkway?' : 'Why did that happen?'}
            />
          </div>
          <div className="field">
            <label htmlFor="answerText">The answer</label>
            <input id="answerText" name="answerText" type="text" required placeholder="Because…" />
          </div>
          <p className={styles.hint}>
            The next why is asked of this answer, so keep it to the one cause that mattered.
          </p>
          <Button type="submit" variant="secondary" size="sm">Save why {nextIndex}</Button>
        </Card>
      )}

      {editable && nextIndex === null && (
        <form action={submitRcaAction}>
          <input type="hidden" name="snagId" value={snagId} />
          <input type="hidden" name="rcaId" value={rca.id} />
          <Button type="submit" variant="primary">Submit for review</Button>
        </form>
      )}

      {rca.status === 'submitted' && (
        <div className={styles.actionRow}>
          <form action={acceptRcaAction}>
            <input type="hidden" name="snagId" value={snagId} />
            <input type="hidden" name="rcaId" value={rca.id} />
            <Button type="submit" variant="primary">Accept</Button>
          </form>
          <details className={styles.disclosure}>
            <summary><Button as="span" variant="secondary">Send back</Button></summary>
            <form action={rejectRcaAction} className={styles.disclosureBody}>
              <input type="hidden" name="snagId" value={snagId} />
              <input type="hidden" name="rcaId" value={rca.id} />
              <div className="field">
                <label htmlFor="rejectionNote">What needs another look?</label>
                <input id="rejectionNote" name="rejectionNote" type="text" required />
              </div>
              <Button type="submit" variant="secondary" size="sm">Send it back</Button>
            </form>
          </details>
        </div>
      )}

      {(rca.status === 'assigned' || rca.status === 'in_progress') && (
        <div className={styles.actionRow}>
          <details className={styles.disclosure}>
            <summary><Button as="span" variant="secondary">Reassign</Button></summary>
            <form action={reassignRcaAction} className={styles.disclosureBody}>
              <input type="hidden" name="snagId" value={snagId} />
              <input type="hidden" name="rcaId" value={rca.id} />
              <div className="field">
                <label htmlFor="newAssigneeId">New assignee</label>
                <select id="newAssigneeId" name="newAssigneeId" required defaultValue="">
                  <option value="" disabled>Choose someone</option>
                  {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <Button type="submit" variant="secondary" size="sm">Confirm reassign</Button>
            </form>
          </details>
          <form action={cancelRcaAction}>
            <input type="hidden" name="snagId" value={snagId} />
            <input type="hidden" name="rcaId" value={rca.id} />
            <Button type="submit" variant="secondary">Cancel analysis</Button>
          </form>
        </div>
      )}
    </>
  );
}

function StatusButton({
  snagId, status, label, variant = 'secondary',
}: {
  snagId: string; status: SnagStatus; label: string; variant?: 'primary' | 'secondary';
}) {
  return (
    <form action={changeStatusAction}>
      <input type="hidden" name="snagId" value={snagId} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant}>{label}</Button>
    </form>
  );
}

function NotifiableButton({
  snagId, value, label, variant = 'secondary',
}: {
  snagId: string; value: boolean; label: string; variant?: 'secondary' | 'danger';
}) {
  return (
    <form action={setNotifiableDecisionAction}>
      <input type="hidden" name="snagId" value={snagId} />
      <input type="hidden" name="value" value={value.toString()} />
      <Button type="submit" variant={variant}>{label}</Button>
    </form>
  );
}

/** Due dates arrive as ISO dates; rendering one raw leaks the schema. */
function formatDate(value: string | null): string {
  if (!value) return 'no date';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
}
