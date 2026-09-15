import { countMyHouseholds, getMyHousehold } from '@snag/supabase-queries';

// `getMyHousehold` answers the gate the whole app hangs off — App.tsx renders
// Setup or the navigator on it — and it used to answer it wrong in a way
// nothing on screen could explain.
//
// RLS returns every household you are a member of. The old read took the
// OLDEST one created. So somebody who tapped "Create it" on the Setup screen
// instead of "Someone else set ours up" made an empty household, was then
// added to the real one, and stayed pinned to the empty one for ever: no
// switcher, no error, no way out. Reading the membership rows newest-first
// instead is the whole fix, and it is one `.order()` away from coming back.

type Row = Record<string, any>;

/**
 * The thinnest possible stand-in for a PostgREST builder: every filter returns
 * itself, and the terminal call answers with whatever the test handed it.
 *
 * `select` has to be both chainable AND awaitable, because a head+count read
 * awaits it directly while an ordered read keeps building on it.
 */
function fakeClient(answer: { data?: Row | null; count?: number; error?: any }) {
  const calls: { table?: string; order?: [string, any]; select?: [string, any] } = {};

  const builder: any = {
    select: (columns: string, options?: any) => {
      calls.select = [columns, options];
      return builder;
    },
    order: (column: string, options?: any) => {
      calls.order = [column, options];
      return builder;
    },
    limit: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: answer.data ?? null, error: answer.error ?? null }),
    // Awaiting the builder itself is what a head+count read does.
    then: (resolve: (value: any) => unknown) =>
      resolve({ data: null, count: answer.count ?? 0, error: answer.error ?? null }),
  };

  return {
    calls,
    client: {
      from: (table: string) => {
        calls.table = table;
        return builder;
      },
    } as any,
  };
}

describe('getMyHousehold', () => {
  it('reads the membership rows, newest join first', async () => {
    const { client, calls } = fakeClient({
      data: {
        created_at: '2026-09-10T00:00:00Z',
        household: { id: 'h2', name: 'The real one', created_at: '2026-09-02T00:00:00Z' },
      },
    });

    const found = await getMyHousehold(client);

    // The join, not the households table: ordering by households.created_at is
    // exactly the bug — it asks when the house was made, not when you got in.
    expect(calls.table).toBe('household_members');
    expect(calls.order).toEqual(['created_at', { ascending: false }]);
    expect(found).toEqual({
      id: 'h2',
      name: 'The real one',
      createdAt: '2026-09-02T00:00:00Z',
    });
  });

  it('is null for somebody who has signed up and not been added to anything', async () => {
    const { client } = fakeClient({ data: null });
    expect(await getMyHousehold(client)).toBeNull();
  });

  it('is null rather than a half-built household when the join comes back empty', async () => {
    // maybeSingle can hand back the membership row with no embedded household
    // if the inner join is ever loosened. Returning `{ id: undefined }` from
    // here would put App.tsx past its gate and into a navigator with no data.
    const { client } = fakeClient({ data: { created_at: '2026-09-10T00:00:00Z' } });
    expect(await getMyHousehold(client)).toBeNull();
  });
});

describe('countMyHouseholds', () => {
  it('counts without fetching the rows', async () => {
    const { client, calls } = fakeClient({ count: 2 });

    expect(await countMyHouseholds(client)).toBe(2);
    expect(calls.select?.[1]).toEqual({ count: 'exact', head: true });
  });

  it('is zero, not NaN, when PostgREST answers with no count at all', async () => {
    const { client } = fakeClient({});
    expect(await countMyHouseholds(client)).toBe(0);
  });
});
