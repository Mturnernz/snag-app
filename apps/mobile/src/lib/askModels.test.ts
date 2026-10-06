import {
  askModels, BUSY_PAUSE_MS, EARLY_ATTEMPT_MS, MIN_ATTEMPT_MS, type AskDeps,
} from '../../../../supabase/functions/lookup-product/ask';

// The loop that asks Gemini, driven by a fake `fetch`. These pin what the live
// log could not say on 6 October 2026: that a 200 is not an answer, that a
// body which will not read is not "no candidates", that each way a reply can
// be unusable moves on to the next model, and that the time is shared so the
// third model is reachable.

const MODELS = ['m1', 'm2', 'm3'];
const GOOD = { outcome: 'found', manualUrl: 'https://www.mitsubishi-electric.co.nz/m.pdf', parts: [], service: null };
const ok = (json: unknown) => ({ kind: 'reply' as const, status: 200, text: () => Promise.resolve(JSON.stringify(json)) });
const reply = (text: string, over: Record<string, unknown> = {}) =>
  ok({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...over }] });
const good = () => reply(JSON.stringify(GOOD));
const http = (status: number, body = '') => ({ kind: 'reply' as const, status, text: () => Promise.resolve(body) });
const bodyFails = () => ({ kind: 'reply' as const, status: 200, text: () => Promise.reject(new Error('stream reset')) });
const throws = (name: string) => ({ kind: 'throw' as const, error: Object.assign(new Error(name), { name }) });

type Step = ReturnType<typeof ok> | ReturnType<typeof throws> | ReturnType<typeof http>;

function harness(steps: Step[], clock = { t: 0 }, spend: number | number[] = 0) {
  const calls: { model: string; ms: number; body: any }[] = [];
  const slept: number[] = [];
  const lines: string[] = [];
  let allowed = 0;
  const deps: AskDeps = {
    fetch: async (url, init) => {
      const step = steps[calls.length];
      calls.push({ model: decodeURIComponent(url.split('/models/')[1].split(':')[0]), ms: allowed, body: JSON.parse(init.body) });
      clock.t += Array.isArray(spend) ? (spend[calls.length - 1] ?? 0) : spend;
      if (!step) throw new Error('unexpected extra call');
      if (step.kind === 'throw') throw step.error;
      return { ok: step.status >= 200 && step.status < 300, status: step.status, text: step.text };
    },
    now: () => clock.t,
    sleep: async (ms) => { slept.push(ms); },
    timeout: (ms) => { allowed = ms; return new AbortController().signal; },
    log: (line) => lines.push(line),
    warn: (line) => lines.push(line),
  };
  const run = (over: Partial<Parameters<typeof askModels>[1]> = {}) =>
    askModels(deps, {
      apiKey: 'k', models: MODELS, make: 'Mitsubishi Electric', model: 'MSZ-GS60VFD', name: null,
      deadline: clock.t + 85_000, tag: 'test', ...over,
    });
  return { run, calls, slept, lines };
}

describe('a reply that is not an answer moves on to the next model', () => {
  it.each([
    ['no candidates', ok({ candidates: [] }), 'empty'],
    ['no reply object at all', ok({}), 'empty'],
    ['a candidate with no content', ok({ candidates: [{ finishReason: 'STOP' }] }), 'empty'],
    [
      'only thought and tool parts',
      ok({ candidates: [{ content: { parts: [{ thought: true, text: 'thinking' }, { toolCall: {} }] }, finishReason: 'STOP' }] }),
      'empty',
    ],
    ['prose with no object', reply('I could not find anything.'), 'unparseable'],
    ['malformed JSON', reply('{"manualUrl": '), 'unparseable'],
    ['an answer cut off', reply('{"manualUrl":', { finishReason: 'MAX_TOKENS' }), 'truncated'],
    ['a blocked prompt', ok({ promptFeedback: { blockReason: 'SAFETY' } }), 'blocked'],
    ['a recitation stop', reply('', { finishReason: 'RECITATION' }), 'blocked'],
    ['a body that is not JSON', { kind: 'reply' as const, status: 200, text: () => Promise.resolve('<html>') }, 'body'],
    ['a body that will not read', bodyFails(), 'body'],
    ['an object claiming nothing', reply(JSON.stringify({ outcome: 'could_not_find', manualUrl: null, parts: [], service: null })), 'no_claims'],
  ])('%s', async (_, first, kind) => {
    const h = harness([first, good()]);
    const outcome = await h.run();
    expect(h.calls.map((c) => c.model)).toEqual(['m1', 'm2']);
    expect(outcome).toMatchObject({ ok: true, model: 'm2' });
    expect(outcome.attempts[0]).toMatchObject({ model: 'm1', kind, status: 200 });
  });

  it('says why a 200 was empty, in structure and not in words', async () => {
    const h = harness([
      ok({ candidates: [{ content: { parts: [{ thought: true, text: 'secret thought' }, { toolCall: {} }] }, finishReason: 'STOP', groundingMetadata: { groundingChunks: [{}, {}] } }] }),
      good(),
    ]);
    await h.run();
    const line = h.lines.find((l) => l.includes('result=empty'))!;
    expect(line).toMatch(/model=m1/);
    expect(line).toMatch(/http=200/);
    expect(line).toMatch(/candidates=1 finishReason=STOP parts=2 textParts=0 thoughtParts=1 otherParts=toolCall/);
    expect(line).toMatch(/grounding=true groundingChunks=2/);
    expect(line).not.toMatch(/secret thought/);
  });

  it('keeps asking until one model gives something, and says what each did', async () => {
    const h = harness([ok({ candidates: [] }), reply('no object'), good()]);
    const outcome = await h.run();
    expect(h.calls).toHaveLength(3);
    expect(outcome.attempts.map((a) => a.kind)).toEqual(['empty', 'unparseable', 'success']);
  });

  it('fails as an error when every model gives an unusable reply, never as busy', async () => {
    const h = harness([ok({ candidates: [] }), reply('nope'), bodyFails()]);
    const outcome = await h.run();
    expect(outcome).toMatchObject({ ok: false, reason: 'error' });
    expect(h.calls).toHaveLength(3);
  });
});

describe('the first usable answer ends the loop', () => {
  it('does not ask the second model when the first is good', async () => {
    const h = harness([good()]);
    const outcome = await h.run();
    expect(h.calls).toHaveLength(1);
    expect(outcome).toMatchObject({ ok: true, model: 'm1' });
  });

  it('accepts a model saying the maker publishes none, with the pages it checked', async () => {
    const said = { outcome: 'none_published', manualUrl: null, parts: [], service: null, checkedUrls: ['https://www.mitsubishi-electric.co.nz/x'] };
    const h = harness([reply(JSON.stringify(said))]);
    const outcome = await h.run();
    expect(outcome).toMatchObject({ ok: true, claims: { outcome: 'none_published' } });
    expect(h.calls).toHaveLength(1);
  });
});

describe('a request that fails is classified by status', () => {
  it.each([[429], [500], [503]])('moves on after a %s, with a pause', async (status) => {
    const h = harness([http(status), good()]);
    const outcome = await h.run();
    expect(h.calls.map((c) => c.model)).toEqual(['m1', 'm2']);
    expect(outcome.ok).toBe(true);
    expect(h.slept).toEqual([BUSY_PAUSE_MS]);
  });

  it('reports a run of busy models as busy', async () => {
    const outcome = await harness([http(503), http(503), http(503)]).run();
    expect(outcome).toMatchObject({ ok: false, reason: 'busy' });
  });

  it('reports a used-up day as a limit, after still asking the other models', async () => {
    const daily = JSON.stringify({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDay', quotaValue: '0' }] }] } });
    const h = harness([http(429, daily), http(429, daily), http(429, daily)]);
    const outcome = await h.run();
    expect(h.calls).toHaveLength(3);
    expect(outcome).toMatchObject({ ok: false, reason: 'limit' });
  });

  it('stops at once on a 402, since no other model will answer', async () => {
    const h = harness([http(402), good()]);
    const outcome = await h.run();
    expect(h.calls).toHaveLength(1);
    expect(outcome).toMatchObject({ ok: false, reason: 'limit' });
  });

  it.each([[400], [401], [403]])('does not retry a %s, which would fail the same on every model', async (status) => {
    const h = harness([http(status), good()]);
    // No schema to drop on a 400 either, once it has been dropped.
    const outcome = await h.run();
    expect(outcome.ok).toBe(status === 400 ? true : false);
    if (status !== 400) expect(h.calls).toHaveLength(1);
  });

  it('tries the next model when this one is not available to the key', async () => {
    const h = harness([http(404), good()]);
    const outcome = await h.run();
    expect(outcome).toMatchObject({ ok: true, model: 'm2' });
  });

  it('moves on after a timeout, and never calls running out of time busy', async () => {
    // The first live lookups were cut off by the clock and worded as busy when
    // nothing was busy: a Try again on that meets the same clock.
    const h = harness([throws('TimeoutError'), throws('TimeoutError'), throws('AbortError')]);
    const outcome = await h.run();
    expect(h.calls).toHaveLength(3);
    expect(outcome).toMatchObject({ ok: false, reason: 'error' });
    expect(outcome.attempts.map((a) => a.kind)).toEqual(['timeout', 'timeout', 'timeout']);
  });

  it('moves on when a request cannot get there, and does not call that busy either', async () => {
    const h = harness([throws('TypeError'), good()]);
    const outcome = await h.run();
    expect(outcome).toMatchObject({ ok: true, model: 'm2' });
    expect(outcome.attempts[0]).toMatchObject({ kind: 'unreachable', status: null });
    expect(await harness([throws('TypeError'), throws('TypeError'), throws('TypeError')]).run())
      .toMatchObject({ ok: false, reason: 'error' });
  });

  it('still calls a refusal busy when a model does say so, even beside a timeout', async () => {
    const outcome = await harness([throws('TimeoutError'), http(503), throws('TimeoutError')]).run();
    expect(outcome).toMatchObject({ ok: false, reason: 'busy' });
  });
});

describe('the schema next to the search tools', () => {
  it('is asked for first, and dropped for the rest of the lookup when a model refuses it', async () => {
    const h = harness([http(400, 'response schema with tools not supported'), good()]);
    const outcome = await h.run();
    expect(h.calls.map((c) => c.model)).toEqual(['m1', 'm1']);
    expect(h.calls[0].body.generationConfig.responseJsonSchema).toBeDefined();
    expect(h.calls[1].body.generationConfig).toBeUndefined();
    expect(h.calls[1].body.tools).toEqual([{ google_search: {} }, { url_context: {} }]);
    expect(outcome).toMatchObject({ ok: true, model: 'm1' });
    expect(outcome.attempts[0].kind).toBe('schema');
  });

  it('does not ask the next model for what a previous one refused', async () => {
    const h = harness([http(400), ok({ candidates: [] }), good()]);
    await h.run();
    expect(h.calls.map((c) => !!c.body.generationConfig)).toEqual([true, false, false]);
  });
});

describe('the time is shared out', () => {
  it('lets a search run past 30s, which is what the first live lookups were cut off at', () => {
    expect(EARLY_ATTEMPT_MS).toBeGreaterThan(30_000);
  });

  it('gives the first model its cap and the next what is left', async () => {
    const h = harness([throws('TimeoutError'), good()], { t: 0 }, EARLY_ATTEMPT_MS);
    const outcome = await h.run({ deadline: 85_000 });
    expect(h.calls.map((c) => c.ms)).toEqual([EARLY_ATTEMPT_MS, 35_000]);
    expect(outcome).toMatchObject({ ok: true, model: 'm2' });
  });

  it('still reaches the third model in the background budget, with what is left', async () => {
    // read-label's lookup: 120s, less the 5s kept for pages.
    const h = harness([throws('TimeoutError'), throws('TimeoutError'), good()], { t: 0 }, EARLY_ATTEMPT_MS);
    const outcome = await h.run({ deadline: 115_000 });
    expect(h.calls.map((c) => c.ms)).toEqual([EARLY_ATTEMPT_MS, EARLY_ATTEMPT_MS, 15_000]);
    expect(outcome).toMatchObject({ ok: true, model: 'm3' });
  });

  it('gives the last model everything that remains, not the early cap', async () => {
    const clock = { t: 0 };
    const h = harness([ok({ candidates: [] }), ok({ candidates: [] }), good()], clock, 5_000);
    await h.run({ deadline: 85_000 });
    expect(h.calls[2].ms).toBe(85_000 - 10_000);
  });

  it('asks nobody when less than a search needs is left', async () => {
    const h = harness([good()]);
    const outcome = await h.run({ deadline: MIN_ATTEMPT_MS - 1 });
    expect(h.calls).toHaveLength(0);
    expect(outcome).toMatchObject({ ok: false, reason: 'error' });
  });

  it('stops asking when what is left is too little for another search', async () => {
    const clock = { t: 0 };
    const h = harness([throws('TimeoutError'), good()], clock, EARLY_ATTEMPT_MS);
    const outcome = await h.run({ deadline: EARLY_ATTEMPT_MS + MIN_ATTEMPT_MS - 1 });
    expect(h.calls).toHaveLength(1);
    expect(outcome.ok).toBe(false);
  });
});
