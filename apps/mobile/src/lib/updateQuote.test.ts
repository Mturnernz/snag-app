import { updateQuote } from '@snag/supabase-queries';

/**
 * What `updateQuote` actually sends.
 *
 * It builds the RPC's arguments from a fixed list, and a field missing from
 * that list is written nowhere with no error: *Part of another bill?* sent a
 * bill's `billedThroughId` for a day and the row never changed, and a bill's
 * due date had never saved from its sheet at all. Every screen test mocks
 * `updateQuote`, so none of them could see it — this is the one place the
 * request itself is checked.
 */

function capture() {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
  } as any;
  return { client, calls };
}

it('sends a bill pointed at the bill it is inside', async () => {
  const { client, calls } = capture();
  await updateQuote(client, 'fp', { billedThroughId: 'rb' });
  expect(calls[0].fn).toBe('update_quote');
  expect(calls[0].args).toMatchObject({ p_quote_id: 'fp', p_billed_through_id: 'rb', p_clear: [] });
});

it('clears the link with p_clear rather than sending nothing', async () => {
  const { client, calls } = capture();
  await updateQuote(client, 'fp', { billedThroughId: null });
  expect(calls[0].args.p_billed_through_id).toBeNull();
  expect(calls[0].args.p_clear).toEqual(['billed_through_id']);
});

it('sends a due date and a milestone', async () => {
  const { client, calls } = capture();
  await updateQuote(client, 'b1', { dueOn: '2026-10-20', settlesMilestoneId: 'm2' });
  expect(calls[0].args).toMatchObject({ p_due_on: '2026-10-20', p_settles_milestone_id: 'm2' });
});

// The property that would have caught all three: every field the type
// carries reaches the request under some p_ name.
it('names every field an update can carry', async () => {
  const { client, calls } = capture();
  await updateQuote(client, 'q', {
    supplier: 's', detail: 'd', amount: 1, amountInclGst: false, kind: 'invoice', basis: 'fixed',
    dated: '2026-01-01', notes: 'n', supersedesLineId: 'l', photoPaths: ['p'], documentPaths: ['doc'],
    dueOn: '2026-02-02', billedThroughId: 'b', settlesMilestoneId: 'm', invoiceNumber: 'i',
  });
  const sent = Object.values(calls[0].args);
  for (const value of ['s', 'd', 1, false, 'invoice', 'fixed', '2026-01-01', 'n', 'l', 'p', 'doc',
    '2026-02-02', 'b', 'm', 'i']) {
    expect(sent.flat()).toContain(value);
  }
});
