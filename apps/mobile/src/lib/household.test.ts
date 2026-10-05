import { countMyHouseholds, getMyHouseholds, joinUrl, placeTitle } from '@snag/supabase-queries';

// `getMyHouseholds` answers the gate the whole app hangs off — App.tsx renders
// Setup or the navigator on it — and it has answered it wrong twice in ways
// nothing on screen could explain.
//
// The first read took the OLDEST household created. So somebody who tapped
// "Create it" on the Setup screen instead of "Someone else set ours up" made an
// empty household, was then added to the real one, and stayed pinned to the
// empty one. Ordering the membership rows by when you joined is that fix.
//
// The second: RLS lets a member read every member's row, so "newest join
// first" meant whoever joined last. Harmless with one household; with the
// house and the bach, somebody else joining the bach reordered your list.

type Row = Record<string, any>;

/**
 * The thinnest possible stand-in for a PostgREST builder: every filter returns
 * itself, and the terminal call answers with whatever the test handed it.
 *
 * `select` has to be both chainable AND awaitable, because a head+count read
 * awaits it directly while an ordered read keeps building on it.
 */
function fakeClient(answer: { rows?: Row[] | null; count?: number; error?: any; me?: string | null }) {
  const calls: {
    table?: string;
    order?: [string, any];
    select?: [string, any];
    eq?: [string, any][];
  } = { eq: [] };

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
    eq: (column: string, value: any) => {
      calls.eq!.push([column, value]);
      return builder;
    },
    // Awaiting the builder itself is what a list read and a head+count read do.
    then: (resolve: (value: any) => unknown) =>
      resolve({ data: answer.rows ?? null, count: answer.count ?? 0, error: answer.error ?? null }),
  };

  const me = answer.me === undefined ? 'me' : answer.me;
  return {
    calls,
    client: {
      auth: {
        getSession: async () => ({ data: { session: me ? { user: { id: me } } : null } }),
      },
      from: (table: string) => {
        calls.table = table;
        return builder;
      },
    } as any,
  };
}

describe('getMyHouseholds', () => {
  it('reads my own membership rows, newest join first', async () => {
    const { client, calls } = fakeClient({
      rows: [
        {
          created_at: '2026-10-05T00:00:00Z',
          household: { id: 'bach', name: 'Martins Bay', created_at: '2026-09-30T00:00:00Z' },
        },
        {
          created_at: '2026-09-12T00:00:00Z',
          household: { id: 'house', name: '32 Le Roy', created_at: '2026-09-12T00:00:00Z' },
        },
      ],
    });

    const found = await getMyHouseholds(client);

    // The join, not the households table: ordering by households.created_at is
    // exactly the first bug — it asks when the house was made, not when you got in.
    expect(calls.table).toBe('household_members');
    expect(calls.order).toEqual(['created_at', { ascending: false }]);
    // Mine only — the second bug.
    expect(calls.eq).toContainEqual(['profile_id', 'me']);
    expect(found).toEqual([
      { id: 'bach', name: 'Martins Bay', createdAt: '2026-09-30T00:00:00Z' },
      { id: 'house', name: '32 Le Roy', createdAt: '2026-09-12T00:00:00Z' },
    ]);
  });

  it('is empty for somebody who has signed up and not been added to anything', async () => {
    const { client } = fakeClient({ rows: [] });
    expect(await getMyHouseholds(client)).toEqual([]);
  });

  it('is empty, asking nothing, with nobody signed in', async () => {
    const { client, calls } = fakeClient({ me: null });
    expect(await getMyHouseholds(client)).toEqual([]);
    expect(calls.table).toBeUndefined();
  });

  it('drops a membership row with no household rather than half-building one', async () => {
    // The inner join can hand back the membership row with no embedded
    // household if it is ever loosened. Returning `{ id: undefined }` from here
    // would put App.tsx past its gate and into a navigator with no data.
    const { client } = fakeClient({ rows: [{ created_at: '2026-09-10T00:00:00Z' }] });
    expect(await getMyHouseholds(client)).toEqual([]);
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

describe('joinUrl', () => {
  const TOKEN = '8f1d3c2e-0000-4000-8000-000000000000';

  // This string is what a QR encodes and what somebody may end up reading off a
  // screen and typing. A double slash is not fatal but it is the kind of thing
  // that makes a link look wrong to the person being asked to trust it.
  it('builds the link a QR encodes', () => {
    expect(joinUrl('https://app.snaghq.co.nz', TOKEN))
      .toBe(`https://app.snaghq.co.nz/join/${TOKEN}`);
  });

  it('does not double the slash when the host carries one', () => {
    expect(joinUrl('https://app.snaghq.co.nz/', TOKEN))
      .toBe(`https://app.snaghq.co.nz/join/${TOKEN}`);
  });
});

describe('placeTitle', () => {
  const bay = { name: 'Martins Bay' };
  const house = { name: '32 Le Roy' };

  it('names the place being shown', () => {
    expect(placeTitle(bay, [house, bay])).toBe('Martins Bay');
  });

  // The places are back before the server has said which one to start on.
  it('names the first place while the active one is still being chosen', () => {
    expect(placeTitle(null, [bay])).toBe('Martins Bay');
  });

  // Not the household's name: for somebody let into one place of two, that is
  // a house they cannot see, and showing it for a moment is the bug briefly.
  it('names nothing before the places have loaded', () => {
    expect(placeTitle(null, [])).toBe('');
  });
});
