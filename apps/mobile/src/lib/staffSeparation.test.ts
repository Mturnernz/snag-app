import fs from 'fs';
import path from 'path';
import * as queries from '@snag/supabase-queries';

// The staff portal is its own site (`apps/staff`), and its reads and writes are
// their own entry point (`@snag/supabase-queries/staff`). None of it belongs in
// the app households install. Nothing there is a secret — every `staff_*`
// function refuses a caller who is not on the staff list — but a household's
// phone has no business downloading the portal, and the one way it would start
// to is quietly: a staff function added back to the main export, or an import
// of the staff entry point from a screen. Both fail here instead.

const SRC = path.resolve(__dirname, '..');
const shipped = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const full = path.join(dir, d.name);
  if (d.isDirectory()) return shipped(full);
  // Tests never reach the bundle, so they may import the staff half to pin it.
  return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [full] : [];
});

describe('the staff portal stays out of the app', () => {
  it('exports nothing staff-only from the main entry point', () => {
    expect(Object.keys(queries).filter((name) => /staff/i.test(name))).toEqual([]);
  });

  it('keeps the portal-only helpers out of the main entry point too', () => {
    const portalOnly = ['adviceDraftFrom', 'adviceDraftProblems', 'cleanAdviceDraft', 'describeWait', 'supportReplyEmail'];
    expect(portalOnly.filter((name) => name in queries)).toEqual([]);
  });

  it('never imports the staff entry point from anything that ships', () => {
    const offenders = shipped(SRC)
      .filter((f) => /@snag\/supabase-queries\/staff/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
