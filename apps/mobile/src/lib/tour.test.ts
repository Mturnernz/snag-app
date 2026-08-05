import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import {
  GUIDE_SECTIONS,
  TOUR_ANCHORS,
  TOUR_EXEMPT_SECTIONS,
  TOUR_FINISH_ANCHOR,
  TOUR_GATE_IDS,
  TOUR_STEPS,
  TourAnchorId,
  guideSection,
  tourStep,
  tourStepsForRole,
} from '@snag/onboarding-guide';
import { UserRole } from '../types';

// What stops the walkthrough and the manual describing different apps.
//
// They are one source (`packages/onboarding-guide`) precisely so they can't
// drift, but "one source" only holds if something checks the joins. The joins
// are: every step is drawn from a section, every section is either covered by a
// step or exempted on purpose, and every anchor a step names is a control that
// is actually rendered somewhere in this app.
//
// The last one is the reason this test reads source files. A renamed or deleted
// control is not a type error — `TourAnchor` would simply never register, the
// spotlight would fall back to a centred card, and the walkthrough would go on
// confidently pointing at nothing. That is a failure you only see by running
// the app as a new user, which is the one thing nobody does.

const ROLES: UserRole[] = ['worker', 'supervisor', 'officer_admin'];

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** Every `<TourAnchor id="…">` literal rendered anywhere in the app, plus the
 *  tab bar's lookup table, which names its anchors as values rather than as
 *  JSX props. */
const renderedAnchors = (() => {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    // The component's own definition and the map that feeds it are declarations,
    // not usages — counting them would make every anchor look rendered.
    if (/components[\\/]TourAnchor\.tsx$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const [, id] of text.matchAll(/<TourAnchor\s[^>]*?id="([\w-]+)"/g)) found.add(id);
    // navigation/index.tsx maps tab name -> anchor id, so the ids reach
    // TourAnchor through a variable rather than as literals in the JSX.
    const tabMap = text.match(/const TAB_ANCHORS[^=]*=\s*\{([\s\S]*?)\};/);
    if (tabMap) for (const [, id] of tabMap[1].matchAll(/'([\w-]+)'/g)) found.add(id);
  }
  return found;
})();

describe('the walkthrough is drawn from the guide', () => {
  it('every step names a section that exists', () => {
    for (const step of TOUR_STEPS) {
      expect(guideSection(step.sectionId)).toBeDefined();
    }
  });

  it("no step teaches a role its section doesn't include", () => {
    // Otherwise a Crew member gets a spotlight explaining something the manual
    // then refuses to show them.
    for (const step of TOUR_STEPS) {
      const section = guideSection(step.sectionId)!;
      for (const role of step.roles) {
        expect(section.roles).toContain(role);
      }
    }
  });

  it('every section is either covered by a step or exempted with a reason', () => {
    // The join that makes changes automatic: add a section to the guide and
    // this fails until somebody decides whether the walkthrough should teach it.
    const covered = new Set(TOUR_STEPS.map((s) => s.sectionId));
    for (const section of GUIDE_SECTIONS) {
      const exemption = TOUR_EXEMPT_SECTIONS[section.id];
      const isCovered = covered.has(section.id);
      expect(isCovered || typeof exemption === 'string').toBe(true);
      if (exemption) expect(exemption.length).toBeGreaterThan(30);
    }
  });

  it('nothing is both covered and exempted', () => {
    const covered = new Set(TOUR_STEPS.map((s) => s.sectionId));
    for (const id of Object.keys(TOUR_EXEMPT_SECTIONS)) {
      expect(covered.has(id)).toBe(false);
      expect(guideSection(id)).toBeDefined();
    }
  });

  it('orders steps by where their section sits in the guide', () => {
    // Order is derived rather than declared, so moving a section in the guide
    // moves its steps. Asserted per role because the filtering happens first.
    const sectionIndex = new Map(GUIDE_SECTIONS.map((s, i) => [s.id, i]));
    for (const role of ROLES) {
      const positions = tourStepsForRole(role).map((s) => sectionIndex.get(s.sectionId)!);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it('keeps declaration order within a section', () => {
    // Array.prototype.sort is stable, and the report flow depends on it: photo,
    // description, type, submit is a sequence, not a set.
    const reportSteps = tourStepsForRole('worker')
      .filter((s) => s.sectionId === 'report-a-snag')
      .map((s) => s.id);
    expect(reportSteps).toEqual([
      'report-tab',
      'report-site',
      'report-photo',
      'report-description',
      'report-kind',
      'report-submit',
    ]);
  });
});

describe('step data', () => {
  it('has unique, resolvable ids', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(tourStep(id)?.id).toBe(id);
  });

  it('gives every step at least one role, a title and a body', () => {
    for (const step of TOUR_STEPS) {
      expect(step.roles.length).toBeGreaterThan(0);
      for (const role of step.roles) expect(ROLES).toContain(role);
      expect(step.title.trim().length).toBeGreaterThan(0);
      // Long enough to say what to do and why. A one-liner here is the failure
      // mode where the walkthrough becomes a set of captions.
      expect(step.body.trim().length).toBeGreaterThan(40);
    }
  });

  it('only gates on actions the app reports', () => {
    for (const step of TOUR_STEPS) {
      if (step.gate) expect(TOUR_GATE_IDS).toContain(step.gate);
    }
  });

  it('gives every role a walkthrough, and gives Crew the report flow', () => {
    for (const role of ROLES) {
      expect(tourStepsForRole(role).length).toBeGreaterThan(0);
    }
    const crew = tourStepsForRole('worker').map((s) => s.id);
    expect(crew).toContain('report-photo');
    expect(crew).toContain('report-submit');
    // Day-one org setup is a Manager's job and Crew never see the section.
    expect(crew).not.toContain('setup-organisation');
    expect(crew).not.toContain('public-reporting');

    const manager = tourStepsForRole('officer_admin').map((s) => s.id);
    expect(manager).toContain('setup-organisation');
    expect(manager).toContain('setup-sites');
  });

  it('starts every role on the same welcome step', () => {
    // It has no anchor, so it is the one step that works before any screen has
    // laid out — which is exactly when the walkthrough auto-starts.
    for (const role of ROLES) {
      const first = tourStepsForRole(role)[0];
      expect(first.id).toBe('welcome');
      expect(first.anchor).toBeNull();
    }
  });
});

describe('anchors point at controls that exist', () => {
  it('every step anchor is a declared anchor', () => {
    for (const step of TOUR_STEPS) {
      if (step.anchor) expect(Object.keys(TOUR_ANCHORS)).toContain(step.anchor);
    }
    expect(Object.keys(TOUR_ANCHORS)).toContain(TOUR_FINISH_ANCHOR);
  });

  it('every declared anchor is rendered somewhere in the app', () => {
    const missing = (Object.keys(TOUR_ANCHORS) as TourAnchorId[]).filter(
      (id) => !renderedAnchors.has(id),
    );
    expect(missing).toEqual([]);
  });

  it('every rendered anchor is declared', () => {
    const undeclared = [...renderedAnchors].filter((id) => !(id in TOUR_ANCHORS));
    expect(undeclared).toEqual([]);
  });

  it('describes each anchor, so a failure above names the control', () => {
    for (const [id, description] of Object.entries(TOUR_ANCHORS)) {
      expect(description.trim().length).toBeGreaterThan(0);
      expect(id).toMatch(/^[a-z][\w-]*$/);
    }
  });
});
