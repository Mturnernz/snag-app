import Link from 'next/link';
import { describeCycle, snagHeadline } from '@snag/supabase-queries';
import { adviceDraftFrom, describeWait, getStaffRequestPage } from '@snag/supabase-queries/staff';
import { ADVICE_VERDICT_LABELS, type StaffLogEntry, type StaffRequestPage } from '@snag/shared-types';
import { createStaffClient, signPhotos } from '@/lib/supabase';
import { day, dayTime } from '@/lib/when';
import { AssignControl, CloseControl, NoteForm, ReplyComposer, ResendEmail } from './Controls';
import styles from '../../../staff.module.css';

const LOG_WORDS: Record<StaffLogEntry['action'], string> = {
  opened: 'opened it',
  claimed: 'took it',
  assigned: 'assigned it',
  released: 'put it back',
  noted: 'added a note',
  replied: 'replied',
  emailed: 'emailed the reply',
  closed: 'closed it',
};

/**
 * One question, and the one job it is about.
 *
 * Everything on the left is read-only and is exactly what the household
 * shared by asking: this job's photographs, words, room, notes and linked
 * items, and the place's suburb and town. Nothing else in their house is
 * reachable from here, and once the question closes this page cannot be
 * opened at all — `staff_request_page` refuses, and the photographs stop
 * signing.
 */
export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createStaffClient();

  let page: StaffRequestPage;
  try {
    page = await getStaffRequestPage(supabase, id);
  } catch (err) {
    return (
      <main className={styles.page}>
        <p>
          <Link href="/">← Questions</Link>
        </p>
        <h1 className={styles.h1}>This question isn&rsquo;t open</h1>
        <p className={styles.muted}>{(err as Error).message}</p>
      </main>
    );
  }

  const { request, job, place, notes, advice, messages, log, staff, me } = page;
  const photos = await signPhotos(supabase, job.photoPaths);
  const headline = snagHeadline({ description: job.description, room: job.room });
  const where = [place.suburb, place.town].filter(Boolean).join(', ');

  return (
    <main className={styles.page}>
      <p>
        <Link href="/">← Questions</Link>
      </p>
      <div>
        <h1 className={styles.h1}>{headline}</h1>
        <p className={styles.meta}>
          <span className={styles.mono}>{job.reference}</span>
          {' · '}asked by {request.askedByName ?? 'somebody'} {dayTime(request.createdAt)}
          {request.status === 'waiting'
            ? ` · waiting ${describeWait(request.waitingSince)}`
            : ' · with them'}
        </p>
      </div>

      <div className={styles.columns}>
        {/* ── The job, read-only ── */}
        <div className={styles.stack}>
          <section className={styles.card} aria-labelledby="job">
            <h2 id="job" className={styles.h2}>The job</h2>
            {job.photoPaths.length > 0 ? (
              <div className={styles.photos}>
                {job.photoPaths.map((path, i) =>
                  photos[path] ? (
                    <a key={path} href={photos[path]} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photos[path]} alt={`Photo ${i + 1} of ${job.photoPaths.length}`} />
                    </a>
                  ) : null
                )}
              </div>
            ) : (
              <p className={styles.muted}>No photos.</p>
            )}
            <dl className={styles.facts}>
              <dt>Words</dt>
              <dd>{job.description ?? '—'}</dd>
              <dt>Room</dt>
              <dd>{job.room ?? '—'}</dd>
              <dt>Place</dt>
              <dd>{[place.name, where].filter(Boolean).join(' · ') || '—'}</dd>
              <dt>Status</dt>
              <dd>
                {job.status === 'done' ? 'Done' : job.status === 'doing' ? 'Being worked on' : 'Open'}
              </dd>
              {job.dueAt ? (
                <>
                  <dt>Due</dt>
                  <dd>
                    {day(job.dueAt)}
                    {job.repeatDays ? ` · ${describeCycle(job.repeatDays)}` : ''}
                  </dd>
                </>
              ) : null}
              {job.lastDoneAt ? (
                <>
                  <dt>Last done</dt>
                  <dd>{day(job.lastDoneAt)}</dd>
                </>
              ) : null}
              <dt>Filed</dt>
              <dd>
                {day(job.createdAt)}
                {job.reporterName ? ` by ${job.reporterName}` : ''}
              </dd>
            </dl>
          </section>

          {job.linkedThings.length > 0 ? (
            <section className={styles.card} aria-labelledby="things">
              <h2 id="things" className={styles.h2}>What it&rsquo;s about</h2>
              <ul className={styles.plain}>
                {job.linkedThings.map((t) => (
                  <li key={t.id}>
                    <strong>{t.name}</strong>
                    {t.room ? <span className={styles.meta}> · {t.room}</span> : null}
                    {t.make || t.model ? (
                      <div className={styles.mono}>{[t.make, t.model].filter(Boolean).join(' ')}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {job.parts.length > 0 ? (
            <section className={styles.card} aria-labelledby="parts">
              <h2 id="parts" className={styles.h2}>On their shopping list</h2>
              <ul className={styles.plain}>
                {job.parts.map((p) => (
                  <li key={p}>
                    {p}
                    {job.bought.includes(p) ? <span className={styles.meta}> · got it</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className={styles.card} aria-labelledby="notes">
            <h2 id="notes" className={styles.h2}>Their notes on the job</h2>
            {notes.length === 0 ? (
              <p className={styles.muted}>None.</p>
            ) : (
              <ul className={styles.plain}>
                {notes.map((n) => (
                  <li key={n.id} className={styles.message}>
                    <span className={styles.who}>
                      {n.authorName ?? 'Someone'}
                      <span className={styles.when}>{dayTime(n.createdAt)}</span>
                    </span>
                    <p>{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {advice ? (
            <section className={styles.card} aria-labelledby="advice">
              <h2 id="advice" className={styles.h2}>The assessment on the job now</h2>
              <p className={styles.meta}>{advice.source}</p>
              <p style={{ margin: 0 }}>{advice.diagnosis}</p>
              <p className={styles.meta}>
                {ADVICE_VERDICT_LABELS[advice.verdict]}
                {advice.trade ? ` — ${advice.trade}` : ''}
              </p>
            </section>
          ) : null}
        </div>

        {/* ── The conversation, and what to do about it ── */}
        <div className={styles.stack}>
          <section className={styles.card} aria-labelledby="thread">
            <h2 id="thread" className={styles.h2}>The question</h2>
            <AssignControl
              requestId={request.id}
              assignedTo={request.assignedTo}
              me={me}
              staff={staff}
            />
            <ul className={styles.plain}>
              <li className={styles.message}>
                <span className={styles.who}>
                  {request.askedByName ?? 'They'} asked
                  <span className={styles.when}>{dayTime(request.createdAt)}</span>
                </span>
                <p>{request.question}</p>
              </li>
              {messages.map((m) => (
                <li key={m.id} className={`${styles.message} ${m.internal ? styles.internal : ''}`}>
                  <span className={styles.who}>
                    {m.internal ? `Note — ${m.authorName}, staff only` : m.fromStaff ? `${m.authorName} (SnagHQ)` : m.authorName}
                    <span className={styles.when}>{dayTime(m.createdAt)}</span>
                  </span>
                  {m.body ? <p>{m.body}</p> : null}
                  {m.withAdvice ? <span className={styles.meta}>Sent an assessment.</span> : null}
                  {m.fromStaff && !m.internal ? (
                    m.emailedAt ? (
                      <span className={styles.meta}>Emailed {dayTime(m.emailedAt)}</span>
                    ) : (
                      <ResendEmail requestId={request.id} messageId={m.id} />
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.card} aria-labelledby="reply">
            <h2 id="reply" className={styles.h2}>Reply</h2>
            <ReplyComposer
              requestId={request.id}
              askedByName={request.askedByName}
              initialAdvice={adviceDraftFrom(advice)}
              hasAdvice={advice !== null}
            />
          </section>

          <section className={styles.card} aria-labelledby="note">
            <h2 id="note" className={styles.h2}>Note</h2>
            <NoteForm requestId={request.id} />
          </section>

          <section className={styles.card} aria-labelledby="close">
            <h2 id="close" className={styles.h2}>Close</h2>
            <CloseControl requestId={request.id} />
          </section>

          <section className={styles.card} aria-labelledby="log">
            <h2 id="log" className={styles.h2}>Who has looked</h2>
            <ul className={styles.plain}>
              {log.map((l, i) => (
                <li key={`${l.at}-${i}`} className={styles.meta}>
                  {l.staffName} {LOG_WORDS[l.action]} · {dayTime(l.at)}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
