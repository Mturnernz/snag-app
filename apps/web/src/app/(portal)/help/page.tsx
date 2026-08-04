import type { Metadata } from 'next';
import { ROLE_LABELS } from '@snag/shared-types';
import {
  GUIDE_PDF_PATH,
  GUIDE_PDF_PATH_BY_ROLE,
  GUIDE_VERSION,
  sectionsForRole,
  type GuideBlock,
  type GuideSection,
} from '@snag/onboarding-guide';

import { requireSupervisorOrAdmin } from '@/lib/auth';
import { Card, PageHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import Icon from '@/components/Icon';
import tableStyles from '@/components/Table.module.css';
import styles from './help.module.css';

export const metadata: Metadata = {
  title: 'Help',
};

// The onboarding guide, in the portal.
//
// Content comes from @snag/onboarding-guide — the same source the mobile Help
// screen and the printed PDFs render. Only sections tagged for the reader's
// role are shown, so a Site Lead isn't handed the Manager's org-setup
// checklist for settings they can't reach.
//
// Built on <details> like StepSection, and for the same reason: this is a
// server component, and a native disclosure gets open/close, keyboard support
// and find-in-page for free. StepSection itself isn't reused because its
// leading icon carries a done/pending state a guide section doesn't have.
export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { activeMembership } = await requireSupervisorOrAdmin();
  const { section: openSection } = await searchParams;

  const role = activeMembership.role;
  const sections = sectionsForRole(role);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Help & guide"
        subtitle={`How SNAG works, written for your role — you're a ${ROLE_LABELS[role]} in ${activeMembership.org_name}.`}
      />

      <Card>
        {/* The layout sits on an inner div rather than on Card itself: Card
            spreads its rest props after its own className, so passing one
            would replace the card styling instead of adding to it. */}
        <div className={styles.downloads}>
          <div>
            <p className={styles.downloadTitle}>Print it for your crew</p>
            <p className={styles.downloadHint}>
              The full guide, plus a handout per role — leave them in the crib room or hand them
              out at an induction.
            </p>
          </div>
          <div className={styles.downloadLinks}>
            <Button as="a" href={GUIDE_PDF_PATH} variant="primary" download>
              <Icon name="Download" size="sm" /> Full guide
            </Button>
            <Button as="a" href={GUIDE_PDF_PATH_BY_ROLE.worker} variant="secondary" download>
              <Icon name="Download" size="sm" /> {ROLE_LABELS.worker}
            </Button>
            <Button as="a" href={GUIDE_PDF_PATH_BY_ROLE.supervisor} variant="secondary" download>
              <Icon name="Download" size="sm" /> {ROLE_LABELS.supervisor}
            </Button>
            <Button as="a" href={GUIDE_PDF_PATH_BY_ROLE.officer_admin} variant="secondary" download>
              <Icon name="Download" size="sm" /> {ROLE_LABELS.officer_admin}
            </Button>
          </div>
        </div>
      </Card>

      <nav className={styles.tocNav} aria-label="Contents">
        <p className={styles.tocTitle}>Contents</p>
        <ol className={styles.tocList}>
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      {sections.map((section) => (
        <Section key={section.id} section={section} defaultOpen={openSection === section.id} />
      ))}

      <p className={styles.version}>Guide version {GUIDE_VERSION}</p>
    </div>
  );
}

function Section({ section, defaultOpen }: { section: GuideSection; defaultOpen: boolean }) {
  return (
    <details id={section.id} className={styles.section} open={defaultOpen}>
      <summary className={styles.head}>
        <span className={styles.headText}>
          <span className={styles.title}>{section.title}</span>
          <span className={styles.summary}>{section.summary}</span>
        </span>
        <span className={styles.chevron}>
          <Icon name="ChevronDown" size="sm" />
        </span>
      </summary>
      <div className={styles.body}>
        {section.blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    </details>
  );
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.type) {
    case 'para':
      return <p className={styles.para}>{block.text}</p>;

    case 'steps':
      return (
        <ol className={styles.steps}>
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      );

    case 'bullets':
      return (
        <ul className={styles.bullets}>
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );

    case 'callout':
      return (
        <aside className={styles.callout} data-tone={block.tone}>
          <Icon name={block.tone === 'warning' ? 'TriangleAlert' : 'Info'} size="sm" />
          <div>
            <p className={styles.calloutTitle}>{block.title}</p>
            <p className={styles.calloutBody}>{block.text}</p>
          </div>
        </aside>
      );

    case 'table':
      return (
        <div className={tableStyles.wrap}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                {block.head.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className={j === 0 ? styles.tableFirstCell : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}
