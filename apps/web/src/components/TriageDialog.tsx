'use client';

import { useEffect, useRef, useState } from 'react';
import { INVESTIGATION_MODE_OPTIONS } from '@snag/shared-types';
import type { SiteAssignee } from '@snag/supabase-queries';
import { Button } from './Button';
import Icon from './Icon';
import styles from './TriageDialog.module.css';

const NOTIFIABLE_OPTIONS: { value: 'yes' | 'no' | 'later'; label: string; detail: string }[] = [
  {
    value: 'yes',
    label: 'Yes — notifiable',
    detail: 'It has to be reported to WorkSafe as soon as possible, and the site preserved.',
  },
  {
    value: 'no',
    label: 'No',
    detail: 'Recorded as reviewed and below the threshold — not as a question nobody asked.',
  },
  {
    value: 'later',
    label: "I'm not sure yet",
    detail: 'Nothing is recorded, and this asks again next time. The snag cannot be resolved until it is answered.',
  },
];

/**
 * Triage, as one moment — the portal half of apps/mobile's TriageSheet.
 *
 * The three decisions that make up triaging a serious snag (how it is
 * investigated, who runs it, whether it is notifiable) were in three different
 * collapsed sections, and the allocation controls sat in Manage, *below* the
 * entire investigation they configure. A supervisor could read the whole snag
 * without ever reaching the part that assigns it.
 *
 * A client component for three reasons a `<details>` can't cover: `showModal()`
 * (real backdrop, real focus trap), a cancel handler that refuses Escape, and
 * the name filter. Everything it submits still goes through a server action.
 */
export default function TriageDialog({
  snagId,
  reference,
  description,
  assignees,
  currentOwnerId,
  currentMode,
  action,
}: {
  snagId: string;
  reference: string;
  description: string | null;
  assignees: SiteAssignee[];
  currentOwnerId: string | null;
  currentMode: 'snag' | 'document';
  action: (formData: FormData) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'snag' | 'document'>(currentMode);
  const [investigatorId, setInvestigatorId] = useState<string>(currentOwnerId ?? '');
  const [notifiable, setNotifiable] = useState<'yes' | 'no' | 'later' | ''>('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
  }, []);

  const shown = query.trim()
    ? assignees.filter((a) => (a.name ?? '').toLowerCase().includes(query.trim().toLowerCase()))
    : assignees;

  const investigatorName = assignees.find((a) => a.id === investigatorId)?.name ?? null;

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="triage-title"
      // Escape and the backdrop are both dismissals, and this one has to be
      // answered — skipping is how a hazard ends up with nobody running the
      // investigation.
      onCancel={(e) => e.preventDefault()}
    >
      <form action={action} className={styles.form}>
        <input type="hidden" name="snagId" value={snagId} />
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="investigatorId" value={investigatorId} />
        <input type="hidden" name="notifiable" value={notifiable} />

        <header className={styles.header}>
          <h2 id="triage-title" className={styles.title}>Triage this incident</h2>
          <p className={styles.subtitle}>
            {reference} — three decisions before anyone can work on it.
          </p>
          {description && <p className={styles.description}>{description}</p>}
        </header>

        <fieldset className={styles.group}>
          <legend className={styles.question}>How will this be investigated?</legend>
          {INVESTIGATION_MODE_OPTIONS.map((option) => (
            <label key={option.value} className={styles.option} data-active={mode === option.value}>
              <input
                type="radio"
                name="modeChoice"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
              />
              <span>
                <strong>{option.title}</strong>
                {option.detail}
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.question}>Who is running it?</legend>
          <p className={styles.hint}>
            They get the checklist, the witness statements, the evidence and
            {mode === 'document' ? ' the investigation document' : ' the root cause'} — whatever their role.
          </p>
          <div className={styles.search}>
            <Icon name="Search" size="sm" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people at this site"
              aria-label="Search people at this site"
            />
          </div>
          <div className={styles.people}>
            {shown.length === 0 ? (
              <p className={styles.hint}>Nobody at this site matches “{query.trim()}”.</p>
            ) : (
              shown.map((a) => (
                <label key={a.id} className={styles.option} data-active={investigatorId === a.id}>
                  <input
                    type="radio"
                    name="investigatorChoice"
                    value={a.id}
                    checked={investigatorId === a.id}
                    onChange={() => setInvestigatorId(a.id)}
                  />
                  <span><strong>{a.name}</strong></span>
                </label>
              ))
            )}
          </div>
          <p className={styles.hint}>
            {investigatorName
              ? `Assigning to ${investigatorName}.`
              : 'Pick someone — the investigation needs a lead.'}
          </p>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.question}>Is this a notifiable event?</legend>
          {NOTIFIABLE_OPTIONS.map((option) => (
            <label key={option.value} className={styles.option} data-active={notifiable === option.value}>
              <input
                type="radio"
                name="notifiableChoice"
                value={option.value}
                checked={notifiable === option.value}
                onChange={() => setNotifiable(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                {option.detail}
              </span>
            </label>
          ))}
        </fieldset>

        <Button type="submit" variant="primary" disabled={!investigatorId || !notifiable}>
          Start the investigation
        </Button>
      </form>
    </dialog>
  );
}
