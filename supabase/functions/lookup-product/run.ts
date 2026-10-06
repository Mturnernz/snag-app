// Looking a model up — the network half of `lookup.ts`.
//
// Shared by `lookup-product` (the *Look it up* button on a thing's page) and
// `read-label` (which starts one in the background once a plate has given a
// make and a model), so the two cannot drift about what a lookup is. Every
// rule about what is believed is in `lookup.ts`, pure and under jest; this
// only makes the requests and keeps the answer.
//
// Three kinds of request, in order: the model, with Google Search and page
// reading on; then **every page the model cites, opened by this function
// itself** — the check does not take the model's word for what a page says;
// then the row in `home.product_lookups`.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { askModels, type Attempt } from './ask.ts';
import {
  decideLookup, htmlText, pdfStreams, pdfStrings, urlsToOpen, verifyLookup, type LookupClaims, type Page, type ProductFacts,
} from './lookup.ts';

export type LookupResult =
  | { status: 'found'; facts: ProductFacts }
  | { status: 'nothing' }
  | { status: 'failed'; reason: 'busy' | 'error' | 'quota' | 'limit' };

// What opening the cited pages may take. Nothing is kept back for it while the
// models are being asked — whether there is a page to open is not known until
// one has answered — beyond the floor below, so a model that answers at the
// very end still leaves its pages a chance.
const PAGES_MS = 12_000;
const PAGES_FLOOR_MS = 5_000;
// A manual is a few megabytes; a page that is fifty is not one to wait for.
const MAX_PAGE_BYTES = 15 * 1024 * 1024;
const MAX_INFLATED_BYTES = 30 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (compatible; SnagHQ-lookup/1.0; +https://www.snaghq.co.nz)';

const attemptLine = (a: Attempt) => `${a.model}:${a.kind}${a.status ? `/${a.status}` : ''}/${a.ms}ms`;

/**
 * Asks the models in turn, and holds what they claim against the pages they
 * cite. `budgetMs` is the whole allowance, pages included.
 *
 * Every model is one attempt at the **same** lookup: a fallback is our retry,
 * not a second read of the household's day (`lookUpAndKeep` claims once).
 */
export async function lookUp(
  apiKey: string,
  models: string[],
  make: string,
  model: string,
  name: string | null,
  budgetMs: number,
  tag = `${make} ${model}`,
): Promise<LookupResult> {
  const started = Date.now();
  const end = started + budgetMs;
  const asked = await askModels(
    {
      fetch: (url, init) => fetch(url, init),
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      timeout: (ms) => AbortSignal.timeout(ms),
      log: (line) => console.log(line),
      warn: (line) => console.error(line),
    },
    { apiKey, models, make, model, name, deadline: end - PAGES_FLOOR_MS, tag },
  );
  const tried = asked.attempts.map(attemptLine).join(' ');
  if (!asked.ok) {
    console.error(`lookup-product: ${tag} — no usable answer (${asked.reason}) after ${Date.now() - started}ms; attempts ${tried}`);
    return { status: 'failed', reason: asked.reason };
  }
  const claims: LookupClaims = asked.claims;

  // Time for pages is whatever is left, never less than the floor.
  const pagesMs = Math.min(PAGES_MS, Math.max(PAGES_FLOOR_MS, end - Date.now()));
  const urls = urlsToOpen(make, claims);
  const openedAt = Date.now();
  const opened = await Promise.all(urls.map((url) => openPage(url, pagesMs - 1_000)));
  const pages: Record<string, Page | undefined> = {};
  urls.forEach((url, i) => (pages[url] = opened[i] ?? undefined));

  const decision = decideLookup(make, model, claims, pages);
  // What was claimed and what was kept, so a lookup that came to nothing can
  // be told apart from one that found the wrong things.
  const facts = decision.status === 'found' ? decision.facts : verifyLookup(make, model, claims, pages);
  const claimed = [claims.manualUrl, claims.service?.url, ...claims.parts.map((p) => p.url), ...(claims.checkedUrls ?? [])]
    .filter(Boolean).length;
  console.log(
    `lookup-product: ${tag} — model=${asked.model} outcome=${claims.outcome ?? 'unsaid'} ` +
      `claimed manual=${claims.manualUrl ? 'yes' : 'no'} parts=${claims.parts.length} ` +
      `service=${claims.service ? `${claims.service.months}mo` : 'no'} checked=${claims.checkedUrls?.length ?? 0}; ` +
      `urls claimed=${claimed} accepted-as-maker=${urls.length} opened=${opened.filter(Boolean).length} ` +
      `failedToOpen=${opened.filter((one) => !one).length} (${Date.now() - openedAt}ms); ` +
      `verified manual=${facts.manual ? 'yes' : 'no'} parts=${facts.parts.length}/${claims.parts.length} ` +
      `service=${facts.service ? 'yes' : 'no'}; ` +
      `decision=${decision.status}${decision.status === 'failed' ? `/${decision.why}` : ''}; ` +
      `total=${Date.now() - started}ms attempts ${tried}`,
  );
  if (decision.status === 'found') return { status: 'found', facts: decision.facts };
  if (decision.status === 'nothing') return { status: 'nothing' };
  // Not an answer: nothing was confirmed, and nothing says the maker has
  // none. The row is failed, so it can be asked again.
  return { status: 'failed', reason: decision.reason };
}

/**
 * Begins, claims, looks up and keeps — the whole of one lookup, as the caller.
 *
 * Returns without doing anything when `begin_product_lookup` says an answer is
 * already kept or one is under way. A read is claimed only when a search is
 * actually going to run, so a second scan of the same model costs nothing —
 * and **once**: the models `lookUp` falls back through are the same lookup.
 */
export async function lookUpAndKeep(
  // Any schema: both callers make their client on `home`.
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  apiKey: string,
  models: string[],
  ask: { householdId: string; make: string; model: string; name: string | null; again?: boolean },
  budgetMs: number,
): Promise<'kept' | 'already' | 'refused'> {
  const t0 = Date.now();
  const lap = () => `+${Date.now() - t0}ms`;
  const { data: id, error } = await supabase.rpc('begin_product_lookup', {
    p_household_id: ask.householdId,
    p_make: ask.make,
    p_model: ask.model,
    p_again: !!ask.again,
  });
  if (error) {
    console.error('lookup-product: could not begin —', error.message);
    return 'refused';
  }
  if (typeof id !== 'string') return 'already';
  const tag = `${id.slice(0, 8)} ${ask.make} ${ask.model}`;
  console.log(`lookup-product: ${tag} — begun ${lap()} again=${!!ask.again} budget=${budgetMs}ms`);

  const finish = async (result: LookupResult) => {
    const { error: finishError } = await supabase.rpc('finish_product_lookup', {
      p_id: id,
      p_status: result.status,
      p_result: result.status === 'found' ? result.facts : null,
      p_reason: result.status === 'failed' ? result.reason : null,
    });
    if (finishError) console.error(`lookup-product: ${tag} — could not keep the answer —`, finishError.message);
    console.log(
      `lookup-product: ${tag} — finished ${lap()} status=${result.status}` +
        `${result.status === 'failed' ? ` reason=${result.reason}` : ''}`,
    );
  };

  // The same daily allowance a label read spends: a search is a model call
  // on the operator's key like any other.
  const { data: allowed, error: claimError } = await supabase.rpc('claim_label_read', {
    p_household_id: ask.householdId,
  });
  console.log(`lookup-product: ${tag} — read claimed ${lap()} allowed=${allowed === true}${claimError ? ` error=${claimError.message}` : ''}`);
  if (claimError || allowed !== true) {
    await finish({ status: 'failed', reason: claimError ? 'error' : 'quota' });
    return 'kept';
  }

  let result: LookupResult;
  try {
    // What is left of the budget, now that the two calls above have spent some.
    result = await lookUp(apiKey, models, ask.make, ask.model, ask.name, budgetMs - (Date.now() - t0), tag);
  } catch (err) {
    console.error(`lookup-product: ${tag} — failed —`, err);
    result = { status: 'failed', reason: 'error' };
  }
  await finish(result);
  return 'kept';
}

/**
 * One page, opened by this function: its words, or null if it would not open.
 * Exported so a real page can be checked by hand against `verifyLookup`.
 */
export async function openPage(url: string, ms: number): Promise<Page | null> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(ms),
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.5' },
    });
    if (!response.ok || !response.body) return null;
    const bytes = await readCapped(response.body, MAX_PAGE_BYTES);
    const type = response.headers.get('content-type') ?? '';
    const finalUrl = response.url || url;
    const isPdf = /pdf/i.test(type) ||
      (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
    if (isPdf) return { finalUrl, kind: 'pdf', text: await pdfText(bytes) };
    if (!type || /html|text\/plain/i.test(type)) {
      return { finalUrl, kind: 'html', text: htmlText(new TextDecoder().decode(bytes)) };
    }
    return null;
  } catch (err) {
    console.error(`lookup-product: could not open ${url} —`, err);
    return null;
  }
}

/** The body, up to `max` bytes. A manual cut short still has its early pages. */
async function readCapped(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, out.length - at);
    out.set(chunk.subarray(0, take), at);
    at += take;
    if (at >= out.length) break;
  }
  return out;
}

/** A PDF's readable words: every text stream, inflated where it is compressed. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  // latin1 is one character per byte, so the offsets `pdfStreams` finds are
  // offsets into `bytes` as well.
  const latin1 = new TextDecoder('latin1').decode(bytes);
  const words: string[] = [];
  let inflated = 0;
  for (const span of pdfStreams(latin1)) {
    if (inflated > MAX_INFLATED_BYTES) break;
    let content: string;
    if (span.flate) {
      const data = await inflate(bytes.subarray(span.start, span.end));
      if (!data.length) continue;
      inflated += data.length;
      content = new TextDecoder('latin1').decode(data);
    } else {
      content = latin1.slice(span.start, span.end);
    }
    const said = pdfStrings(content);
    if (said) words.push(said);
  }
  return words.join(' ');
}

/** Whatever inflates before the stream ends or goes wrong — partial is still words. */
async function inflate(raw: Uint8Array): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const reader = new Blob([new Uint8Array(raw)]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
    }
  } catch {
    // Trailing bytes after the compressed data are common and harmless.
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

