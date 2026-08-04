import {
  GUIDE_SECTIONS,
  GUIDE_PDF_PATH_BY_ROLE,
  sectionsForRole,
  guideSection,
  type GuideBlock,
} from '@snag/onboarding-guide';
import {
  CHECKLIST_STEPS,
  INVESTIGATION_MODE_OPTIONS,
  SEVERITY_LABELS,
  type UserRole,
} from '@snag/shared-types';
import { seriousResolveGate, type InvestigationState } from '@snag/supabase-queries';

// Guards on the onboarding guide, which is content rather than logic — so the
// things worth testing are the ones that make it silently wrong rather than
// broken: a role losing its guide, an anchor that no longer resolves, and the
// tables drifting away from the constants the app enforces.
//
// Lives here rather than in the package because jest runs from apps/mobile;
// snagGateSummary.test.ts covers packages/supabase-queries the same way.

const ROLES: UserRole[] = ['worker', 'supervisor', 'officer_admin'];

describe('guide structure', () => {
  it('has unique section ids', () => {
    const ids = GUIDE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every section a title, a summary and at least one block', () => {
    for (const s of GUIDE_SECTIONS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.summary.length).toBeGreaterThan(0);
      expect(s.blocks.length).toBeGreaterThan(0);
    }
  });

  it('tags every section with at least one role', () => {
    // A section with no roles is invisible everywhere but still ships in the
    // markdown and the full PDF — the worst kind of dead content, because it
    // reads as maintained.
    for (const s of GUIDE_SECTIONS) {
      expect(s.roles.length).toBeGreaterThan(0);
      for (const role of s.roles) expect(ROLES).toContain(role);
    }
  });

  it('keeps table rows the same width as their header', () => {
    for (const s of GUIDE_SECTIONS) {
      for (const block of s.blocks) {
        if (block.type !== 'table') continue;
        for (const row of block.rows) {
          expect(row).toHaveLength(block.head.length);
        }
      }
    }
  });

  it('resolves a section by id, and nothing by a made-up one', () => {
    expect(guideSection(GUIDE_SECTIONS[0].id)).toBe(GUIDE_SECTIONS[0]);
    expect(guideSection('no-such-section')).toBeUndefined();
  });
});

describe('sectionsForRole', () => {
  it('gives every role a non-empty guide', () => {
    for (const role of ROLES) {
      expect(sectionsForRole(role).length).toBeGreaterThan(0);
    }
  });

  it('keeps the source order', () => {
    const manager = sectionsForRole('officer_admin').map((s) => s.id);
    const expected = GUIDE_SECTIONS.filter((s) => s.roles.includes('officer_admin')).map((s) => s.id);
    expect(manager).toEqual(expected);
  });

  it('shows Crew the reporting sections and not the org setup', () => {
    const crew = sectionsForRole('worker').map((s) => s.id);
    // The two things every reporter has to be able to find.
    expect(crew).toContain('report-a-snag');
    expect(crew).toContain('report-serious');
    // Manager-only: settings a worker has no screen for.
    expect(crew).not.toContain('setup');
    expect(crew).not.toContain('triage');
  });

  it('shows a Manager everything', () => {
    expect(sectionsForRole('officer_admin')).toHaveLength(GUIDE_SECTIONS.length);
  });

  it('has a PDF for each role', () => {
    for (const role of ROLES) {
      expect(GUIDE_PDF_PATH_BY_ROLE[role]).toMatch(/^\/[\w-]+\.pdf$/);
    }
  });
});

// The guide's job is to describe rules the server actually enforces. These
// tie the prose to the constants, so adding a gate condition or an
// investigation mode without documenting it fails here rather than being
// discovered by a customer following an out-of-date handout.
describe('guide agrees with the app', () => {
  function tableIn(sectionId: string, firstHeading: string) {
    const section = guideSection(sectionId);
    if (!section) throw new Error(`No guide section "${sectionId}"`);
    const table = section.blocks.find(
      (b): b is Extract<GuideBlock, { type: 'table' }> =>
        b.type === 'table' && b.head[0] === firstHeading,
    );
    if (!table) throw new Error(`No "${firstHeading}" table in "${sectionId}"`);
    return table;
  }

  it('documents every investigation mode', () => {
    const table = tableIn('triage', 'Mode');
    expect(table.rows).toHaveLength(INVESTIGATION_MODE_OPTIONS.length);
    for (const option of INVESTIGATION_MODE_OPTIONS) {
      expect(table.rows.some((r) => r[0] === option.title)).toBe(true);
    }
  });

  it('documents every severity', () => {
    const table = tableIn('report-serious', 'Severity');
    expect(table.rows.map((r) => r[0]).sort()).toEqual(
      Object.values(SEVERITY_LABELS).sort(),
    );
  });

  it('documents every shared resolve-gate condition', () => {
    // The four conditions both modes require. `seriousResolveGate` is the
    // clients' copy of the rule, so counting against it is what catches a
    // fifth being added.
    const empty: InvestigationState = {
      completedSteps: [],
      witnesses: [],
      evidence: [],
      rootCause: null,
      openCorrectiveActions: 0,
      correctiveActionCount: 0,
      mode: 'snag',
      leadInvestigatorId: null,
      documentId: null,
      documentTitle: null,
      documentPath: null,
      documentAttachedBy: null,
      documentAcceptedBy: null,
      documentAccepted: false,
    };
    const shared = seriousResolveGate(empty, false).filter(
      (c) => !['rootCause', 'correctiveActions'].includes(c.key),
    );

    const table = tableIn('closing-serious', 'Condition');
    expect(table.rows).toHaveLength(shared.length);
  });

  it('names all five checklist steps', () => {
    const section = guideSection('investigation')!;
    const text = JSON.stringify(section.blocks).toLowerCase();
    for (const step of CHECKLIST_STEPS) {
      // The guide words them as a sentence rather than as the enum's labels,
      // so match on the distinguishing noun of each step.
      const keyword = step.split('_').pop()!;
      expect(text).toContain(keyword);
    }
  });
});
