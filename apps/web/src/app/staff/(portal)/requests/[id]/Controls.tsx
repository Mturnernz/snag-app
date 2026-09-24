'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { adviceDraftProblems } from '@snag/supabase-queries';
import {
  ADVICE_VERDICT_LABELS,
  SUPPORT_CLOSE_REASONS,
  SUPPORT_CLOSE_REASON_LABELS,
  type AdviceDraft,
  type AdvicePart,
  type AdviceTradie,
  type AdviceVerdict,
  type StaffMember,
  type SupportCloseReason,
} from '@snag/shared-types';
import { Button } from '@/components/Button';
import { addNote, assign, close, reply, resendEmail } from './actions';
import styles from '../../../staff.module.css';

// ------------------------------------------------------------------ assign

export function AssignControl({
  requestId,
  assignedTo,
  me,
  staff,
}: {
  requestId: string;
  assignedTo: string | null;
  me: string;
  staff: StaffMember[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (staffId: string | null) =>
    start(async () => {
      setError(null);
      const result = await assign(requestId, staffId);
      if (!result.ok) setError(result.error);
      router.refresh();
    });

  return (
    <div className={styles.row2}>
      <label className={styles.field} style={{ flex: 1 }}>
        Who has it
        <select
          className={styles.select}
          value={assignedTo ?? ''}
          disabled={pending}
          onChange={(e) => run(e.target.value || null)}
        >
          <option value="">Nobody yet</option>
          {staff.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.userId === me ? `${s.displayName} (you)` : s.displayName}
            </option>
          ))}
        </select>
      </label>
      {assignedTo !== me ? (
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => run(me)}>
          Take it
        </Button>
      ) : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
    </div>
  );
}

// ------------------------------------------------------------------ note

export function NoteForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className={styles.stack}
      style={{ gap: 'var(--space-sm)' }}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const result = await addNote(requestId, body);
          if (result.ok) {
            setBody('');
            router.refresh();
          } else setError(result.error);
        });
      }}
    >
      <label className={styles.field}>
        Note for SnagHQ only — the household never sees these
        <textarea
          className={styles.textarea}
          style={{ minHeight: 72 }}
          value={body}
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <div className={styles.row2}>
        <Button type="submit" variant="secondary" size="sm" disabled={pending || !body.trim()}>
          Add note
        </Button>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ reply

const VERDICTS: AdviceVerdict[] = ['diy', 'trade', 'unclear'];
const emptyPart = (): AdvicePart => ({ item: '', where: '', approxNzd: '' });
const emptyTradie = (): AdviceTradie => ({
  name: '', phone: '', url: '', source: '', calloutNzd: '', totalNzd: '',
});

/**
 * A reply to the household, with an assessment if there is one to give.
 *
 * The assessment is the same thing the paste path writes — it lands on the
 * job's advice card and replaces whatever was there, which is why the form
 * opens on the current one rather than on blanks. Its refusals are
 * `adviceDraftProblems`, the same list `staff_reply` enforces, shown before the
 * round trip; the one that matters is a tradesman with no source.
 */
export function ReplyComposer({
  requestId,
  askedByName,
  initialAdvice,
  hasAdvice,
}: {
  requestId: string;
  askedByName: string | null;
  initialAdvice: AdviceDraft;
  hasAdvice: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [withAdvice, setWithAdvice] = useState(false);
  const [draft, setDraft] = useState<AdviceDraft>(initialAdvice);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const problems = withAdvice ? adviceDraftProblems(draft) : [];
  const empty = !body.trim() && !withAdvice;
  const first = askedByName?.trim().split(/\s+/)[0];

  const set = <K extends keyof AdviceDraft>(key: K, value: AdviceDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  function send() {
    start(async () => {
      setError(null);
      setOutcome(null);
      const result = await reply(requestId, body.trim() || null, withAdvice ? draft : null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody('');
      setWithAdvice(false);
      setOutcome(
        result.email.emailed
          ? 'Sent, and emailed.'
          : `Sent — it's on the job, but the email didn't go. ${result.email.reason}`
      );
      router.refresh();
    });
  }

  return (
    <div className={styles.stack} style={{ gap: 'var(--space-sm)' }}>
      <label className={styles.field}>
        {first ? `Reply to ${first}` : 'Reply'}
        <textarea
          className={styles.textarea}
          value={body}
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>

      <label className={styles.row2}>
        <input type="checkbox" checked={withAdvice} onChange={(e) => setWithAdvice(e.target.checked)} />
        {hasAdvice
          ? 'Send an assessment (replaces the one on the job)'
          : 'Send an assessment'}
      </label>

      {withAdvice ? (
        <div className={styles.subrow}>
          <label className={styles.field}>
            What&rsquo;s wrong
            <textarea
              className={styles.textarea}
              style={{ minHeight: 72 }}
              maxLength={600}
              value={draft.diagnosis}
              onChange={(e) => set('diagnosis', e.target.value)}
            />
          </label>

          <fieldset className={styles.row2} style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend className={styles.field}>Who can do it</legend>
            {VERDICTS.map((v) => (
              <label key={v} className={styles.row2}>
                <input
                  type="radio"
                  name="verdict"
                  checked={draft.verdict === v}
                  onChange={() => set('verdict', v)}
                />
                {ADVICE_VERDICT_LABELS[v]}
              </label>
            ))}
          </fieldset>

          <div className={styles.grid2}>
            <label className={styles.field}>
              Trade
              <input className={styles.input} value={draft.trade} maxLength={40}
                placeholder="plumber, registered electrician"
                onChange={(e) => set('trade', e.target.value)} />
            </label>
            <label className={styles.field}>
              Why
              <input className={styles.input} value={draft.reason} maxLength={400}
                onChange={(e) => set('reason', e.target.value)} />
            </label>
          </div>
          <label className={styles.field}>
            What a better photo would need to show
            <input className={styles.input} value={draft.needToSee} maxLength={300}
              onChange={(e) => set('needToSee', e.target.value)} />
          </label>

          <label className={styles.field}>
            Steps, one per line
            <textarea
              className={styles.textarea}
              style={{ minHeight: 72 }}
              value={draft.steps.join('\n')}
              onChange={(e) => set('steps', e.target.value.split('\n'))}
            />
          </label>

          <p className={styles.who}>Parts</p>
          {draft.parts.map((p, i) => (
            <div key={i} className={styles.grid2}>
              <input className={styles.input} aria-label="Part" placeholder="Part" value={p.item}
                onChange={(e) => set('parts', draft.parts.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))} />
              <input className={styles.input} aria-label="Where to get it" placeholder="Where" value={p.where ?? ''}
                onChange={(e) => set('parts', draft.parts.map((x, j) => (j === i ? { ...x, where: e.target.value } : x)))} />
              <input className={styles.input} aria-label="About how much, NZD" placeholder="About $" value={p.approxNzd ?? ''}
                onChange={(e) => set('parts', draft.parts.map((x, j) => (j === i ? { ...x, approxNzd: e.target.value } : x)))} />
              <button type="button" className={styles.linkish}
                onClick={() => set('parts', draft.parts.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className={styles.linkish} onClick={() => set('parts', [...draft.parts, emptyPart()])}>
            Add a part
          </button>

          <p className={styles.who}>Who to ring — every one needs the page you found them on</p>
          {draft.tradies.map((t, i) => {
            const patch = (over: Partial<AdviceTradie>) =>
              set('tradies', draft.tradies.map((x, j) => (j === i ? { ...x, ...over } : x)));
            return (
              <div key={i} className={styles.subrow}>
                <div className={styles.grid2}>
                  <input className={styles.input} aria-label="Name" placeholder="Name" value={t.name}
                    onChange={(e) => patch({ name: e.target.value })} />
                  <input className={styles.input} aria-label="Phone" placeholder="Phone" value={t.phone ?? ''}
                    onChange={(e) => patch({ phone: e.target.value })} />
                  <input className={styles.input} aria-label="Website" placeholder="Website" value={t.url ?? ''}
                    onChange={(e) => patch({ url: e.target.value })} />
                  <input className={styles.input} aria-label="Found at (required)" placeholder="Found at (URL)" value={t.source}
                    onChange={(e) => patch({ source: e.target.value })} />
                  <input className={styles.input} aria-label="Callout, NZD" placeholder="Callout $" value={t.calloutNzd ?? ''}
                    onChange={(e) => patch({ calloutNzd: e.target.value })} />
                  <input className={styles.input} aria-label="Likely total, NZD" placeholder="Likely total $" value={t.totalNzd ?? ''}
                    onChange={(e) => patch({ totalNzd: e.target.value })} />
                </div>
                <button type="button" className={styles.linkish}
                  onClick={() => set('tradies', draft.tradies.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            );
          })}
          <button type="button" className={styles.linkish} onClick={() => set('tradies', [...draft.tradies, emptyTradie()])}>
            Add somebody to ring
          </button>

          {problems.length > 0 ? (
            <ul className={styles.problems}>
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className={styles.row2}>
        <Button type="button" disabled={pending || empty || problems.length > 0} onClick={send}>
          {pending ? 'Sending…' : 'Send reply'}
        </Button>
        <span className={styles.notice}>The household gets one email saying SnagHQ has replied.</span>
      </div>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {outcome ? <p className={styles.notice} role="status">{outcome}</p> : null}
    </div>
  );
}

// ------------------------------------------------------------------ resend

export function ResendEmail({ requestId, messageId }: { requestId: string; messageId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  return (
    <span className={styles.meta}>
      Not emailed.{' '}
      <button
        type="button"
        className={styles.linkish}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const outcome = await resendEmail(requestId, messageId);
            setResult(outcome.emailed ? 'Emailed.' : outcome.reason);
            router.refresh();
          })
        }
      >
        {pending ? 'Sending…' : 'Send email again'}
      </button>
      {result ? ` ${result}` : null}
    </span>
  );
}

// ------------------------------------------------------------------ close

export function CloseControl({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState<SupportCloseReason | ''>('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className={styles.row2}>
      <label className={styles.field} style={{ flex: 1 }}>
        Close it — SnagHQ stops being able to see the job
        <select
          className={styles.select}
          value={reason}
          onChange={(e) => setReason(e.target.value as SupportCloseReason | '')}
        >
          <option value="">Why?</option>
          {SUPPORT_CLOSE_REASONS.map((r) => (
            <option key={r} value={r}>{SUPPORT_CLOSE_REASON_LABELS[r]}</option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        variant="danger"
        size="sm"
        disabled={pending || !reason}
        onClick={() => {
          if (!reason) return;
          if (!window.confirm('Close this question? The job stops being shared with SnagHQ.')) return;
          start(async () => {
            setError(null);
            const result = await close(requestId, reason);
            if (result.ok) router.push('/staff');
            else setError(result.error);
          });
        }}
      >
        Close
      </Button>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
    </div>
  );
}
