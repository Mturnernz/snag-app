import { getProjectsQuoted } from '@snag/supabase-queries';

/**
 * What the list card says has been quoted.
 *
 * It must be the page's own Quoted figure — the sum of the supplier rows — or
 * the card and the page would disagree about the same job.
 */

function client(rows: { project_id: string; quoted: unknown }[]) {
  const seen: { table?: string; ids?: string[] } = {};
  const c = {
    from: (table: string) => {
      seen.table = table;
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => {
            seen.ids = ids;
            return Promise.resolve({ data: rows, error: null });
          },
        }),
      };
    },
  } as any;
  return { c, seen };
}

it('sums the supplier rows per project, in one read', async () => {
  const { c, seen } = client([
    { project_id: 'a', quoted: '1092.50' },
    { project_id: 'b', quoted: 100 },
    { project_id: 'b', quoted: 250.25 },
  ]);
  const quoted = await getProjectsQuoted(c, ['a', 'b']);
  expect(seen.table).toBe('project_supplier_totals');
  expect(seen.ids).toEqual(['a', 'b']);
  expect(quoted.get('a')).toBe(1092.5);
  expect(quoted.get('b')).toBe(350.25);
});

it('leaves out a project nobody has quoted on, rather than calling it zero', async () => {
  const { c } = client([{ project_id: 'a', quoted: null }]);
  const quoted = await getProjectsQuoted(c, ['a']);
  expect(quoted.has('a')).toBe(false);
});

it('asks nothing when there are no projects', async () => {
  const { c, seen } = client([]);
  expect((await getProjectsQuoted(c, [])).size).toBe(0);
  expect(seen.table).toBeUndefined();
});
