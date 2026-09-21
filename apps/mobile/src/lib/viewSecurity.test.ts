import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Every view in `home` must ask RLS on the caller's behalf, and nothing else
 * can check it.
 *
 * A view without `security_invoker` evaluates its base tables' policies as the
 * **view's owner**. These are owned by `postgres`, which is exempt from RLS, so
 * such a view hands every row in the table to anybody holding a valid token. It
 * type-checks, it renders, the app works — and nothing anywhere has an error to
 * report, because from the client's side more rows are indistinguishable from
 * rows it was entitled to.
 *
 * It happened, and the way it happened is the reason this file exists.
 * `home.snags_with_details` and `home.things_with_details` were both created
 * correctly in `20260911*`. `20260917090000` and `20260920100000` then rewrote
 * them with `create or replace view ... as` and no `with` clause — and **a
 * replace with no clause resets the options rather than keeping them**. Both
 * migrations are about a new column, say nothing about security, and read as
 * obviously safe. Measured before `20260921100000` closed it: an account in no
 * household at all read 0 rows from `home.snags` and 36 from
 * `home.snags_with_details`.
 *
 * So what is pinned is the **effective** state — what the migrations, applied
 * in order, actually leave the view in — rather than the text of any one
 * statement. That is what Postgres does, it is what the two regressions did,
 * and it means a bare `create or replace view` added tomorrow fails here rather
 * than a day later in somebody else's household.
 *
 * This is the `csp.test.ts` shape: the migrations are what we deploy, a test
 * cannot reach the database, so it pins what the files say instead.
 */

const MIGRATIONS = join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations');

/** `create [or replace] view home.<name> [with (...)] as` */
const CREATE = /create\s+(?:or\s+replace\s+)?view\s+home\.(\w+)([\s\S]{0,200}?)\bas\b/gi;
/** `alter view home.<name> set (security_invoker = true)` */
const ALTER =
  /alter\s+view\s+home\.(\w+)\s+set\s*\(\s*security_invoker\s*=\s*(\w+)\s*\)/gi;
const INVOKER = /with\s*\(\s*security_invoker\s*=\s*true\s*\)/i;

/**
 * Replays every migration in order and reports where each view ends up.
 *
 * Keyed by view rather than by statement: a view is only as safe as the last
 * thing said about it, which is precisely what both regressions exploited.
 */
function effectiveInvoker(): Map<string, { invoker: boolean; setBy: string }> {
  const state = new Map<string, { invoker: boolean; setBy: string }>();

  for (const file of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');

    // Both forms are replayed in the order they appear in the file, so a
    // migration that creates a view and then alters it lands on the alter.
    const events = [
      ...[...sql.matchAll(CREATE)].map((m) => ({
        at: m.index ?? 0,
        view: m[1],
        // No clause on a create — or a replace — means the default, which is off.
        invoker: INVOKER.test(m[2]),
      })),
      ...[...sql.matchAll(ALTER)].map((m) => ({
        at: m.index ?? 0,
        view: m[1],
        invoker: m[2].toLowerCase() === 'true',
      })),
    ].sort((a, b) => a.at - b.at);

    for (const event of events) state.set(event.view, { invoker: event.invoker, setBy: file });
  }

  return state;
}

describe('every home view asks RLS as the caller', () => {
  const state = effectiveInvoker();
  const views = [...state.entries()];

  it('finds the views to check at all', () => {
    // A regex that quietly matched nothing would make every assertion below
    // pass while checking nothing, which is the one way this test could fail
    // at its job without failing.
    expect(views.length).toBeGreaterThan(8);
    expect(state.has('snags_with_details')).toBe(true);
    expect(state.has('things_with_details')).toBe(true);
    expect(state.has('projects_with_totals')).toBe(true);
  });

  it.each(views.map(([view, s]) => [view, s.setBy, s.invoker] as const))(
    'home.%s, as %s leaves it, has security_invoker',
    (_view, _setBy, invoker) => {
      expect(invoker).toBe(true);
    }
  );
});
