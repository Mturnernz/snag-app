import { LinkButton } from './Button';
import Icon from './Icon';
import styles from './NextStep.module.css';

// The single answer to "what do I do now" on a serious snag — the portal
// counterpart to apps/mobile's NextStepCard, and the same argument for it.
//
// Resolve is stated here as a locked row while the gate is closed rather than
// offered as a button. The portal used to render a live "Resolve (requires
// completed investigation)" button, so the only way to find out what was
// missing was to press it and read the exception the database raised.
export default function NextStep({
  title, detail, cta, href, remaining,
}: {
  title: string;
  detail: string;
  cta: string;
  /** Opens the section this step lives in. */
  href: string;
  /** Gate conditions still unmet, including this one. */
  remaining: number;
}) {
  return (
    <div className={styles.card}>
      <p className={styles.label}>Next step</p>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.detail}>{detail}</p>
      <LinkButton href={href} variant="primary">{cta}</LinkButton>
      <p className={styles.locked}>
        <Icon name="Lock" size="sm" />
        Resolve — blocked, {remaining} {remaining === 1 ? 'step' : 'steps'} remaining
      </p>
    </div>
  );
}

export function ReadyToResolve({ children }: { children: React.ReactNode }) {
  return (
    <div className={[styles.card, styles.ready].join(' ')}>
      <p className={[styles.label, styles.labelReady].join(' ')}>
        <Icon name="CircleCheckBig" size="sm" />
        Ready to resolve
      </p>
      <h2 className={styles.title}>Everything&rsquo;s recorded</h2>
      <p className={styles.detail}>
        The checklist, witness, evidence, root cause, and corrective actions are all complete.
      </p>
      {children}
    </div>
  );
}
