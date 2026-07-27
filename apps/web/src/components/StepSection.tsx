import Icon, { type IconName } from './Icon';
import styles from './StepSection.module.css';

export type StepState = 'done' | 'in_progress' | 'pending' | 'optional';

// A collapsible section that states where it stands while closed — the portal
// counterpart to apps/mobile's StepCard.
//
// The snag detail page used to render every section expanded, so a serious
// snag was one column of about a dozen forms with no way to tell, without
// reading all of them, which ones still needed anything. Collapsed-with-a-
// summary is what makes the page scannable: the closed headers are the
// progress list.
//
// Built on <details> deliberately. This page is a server component and the
// portal ships no client-side state for it, so a native disclosure gets open
// and close, keyboard support, and find-in-page for free — a React toggle
// would mean making the whole section a client component to gain nothing.
export default function StepSection({
  id, icon, title, summary, state = 'pending', defaultOpen = false, children,
}: {
  /** Anchor target, so the Next-step card's CTA can jump straight here. */
  id: string;
  icon: IconName;
  title: string;
  /** One line of state, shown whether open or closed. */
  summary?: string;
  state?: StepState;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details id={id} className={styles.section} data-state={state} open={defaultOpen}>
      <summary className={styles.head}>
        <span className={styles.icon}><Icon name={icon} size="sm" /></span>
        <span className={styles.headText}>
          <span className={styles.title}>{title}</span>
          {summary && <span className={styles.summary}>{summary}</span>}
        </span>
        {state === 'done' && (
          <Icon name="CircleCheckBig" size="sm" color="var(--color-success)" aria-label="complete" />
        )}
        <span className={styles.chevron}><Icon name="ChevronDown" size="sm" /></span>
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}
