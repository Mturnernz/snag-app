// Looking a model up — the network half of `lookup.ts`.
//
// Shared by `lookup-product` (the *Look it up* button on a thing's page) and
// `read-label` (which starts one in the background once a plate has given a
// make and a model), so the two cannot drift about what a lookup is. Every
// rule about what is believed is in `lookup.ts` and `pdf.ts`, pure and under
// jest; this only makes the requests and keeps the answer.
//
// Four steps, in order, all inside one budget:
//
// 1. **Find** — the model, with Google Search, names the pages: the maker's
//    first, then any copy of its manual or list of its parts.
// 2. **Open** — this function opens them itself, following redirects, whoever
//    they land with; then, from the maker's web pages it opened, the PDFs they
//    link to that read as a manual or a parts list (a product page is usually
//    how a manual is found).
// 3. **Read** — the model is shown the text of the pages about this model and
//    says what they state, naming each value's page by number.
// 4. **Check** — `decideLookup` holds every value to the page it names, as
//    this function read it, and to the standard its page's source sets (the
//    maker's alone is enough; anybody else's must be backed), and the row in
//    `home.product_lookups` is written.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { askModels, readStage, searchStage, type AskDeps, type Attempt } from './ask.ts';
import {
  candidateUrls, decideLookup, documentLinks, htmlText, pageLinks, pagesToRead, sourceOf, verifyLookup,
  type Page, type ProductFacts,
} from './lookup.ts';
import { latin1Of, pdfStreams, pdfText as readPdf, type PdfStream } from './pdf.ts';

export type LookupResult =
  | { status: 'found'; facts: ProductFacts }
  | { status: 'nothing' }
  | { status: 'failed'; reason: 'busy' | 'error' | 'quota' | 'limit' };

// Opening pages: the search's addresses together, then the documents the
// maker's pages link to. Kept back from the search, with the read's floor, so
// a search that runs long still leaves both a chance.
const FIRST_WAVE_MS = 8_000;
const SECOND_WAVE_MS = 6_000;
const READ_FLOOR_MS = 20_000;
const SECOND_WAVE_LINKS = 3;
// A manual is a few megabytes; a page that is fifty is not one to wait for.
const MAX_PAGE_BYTES = 12 * 1024 * 1024;
const MAX_INFLATED_BYTES = 24 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (compatible; SnagHQ-lookup/1.0; +https://www.snaghq.co.nz)';

const attemptLine = (a: Attempt) => `${a.model}:${a.kind}${a.status ? `/${a.status}` : ''}/${a.ms}ms`;

const realDeps = (): AskDeps => ({
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeout: (ms) => AbortSignal.timeout(ms),
  log: (line) => console.log(line),
  warn: (line) => console.error(line),
});

/**
 * Finds the maker's pages, opens them, has them read, and holds what the read
 * says against them. `budgetMs` is the whole allowance.
 *
 * Every model asked is one attempt at the **same** lookup: a fallback is our
 * retry, not a second read of the household's day (`lookUpAndKeep` claims once).
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
  const deps = realDeps();

  // ---- 1. find
  const search = await askModels(
    deps,
    { apiKey, models, deadline: end - FIRST_WAVE_MS - SECOND_WAVE_MS - READ_FLOOR_MS, tag },
    searchStage(make, model, name),
  );
  const searchTried = search.attempts.map(attemptLine).join(' ');
  if (!search.ok) {
    console.error(`lookup-product: ${tag} — search came to nothing usable (${search.reason}) after ${Date.now() - started}ms; attempts ${searchTried}`);
    return { status: 'failed', reason: search.reason };
  }
  const found = search.value;

  // ---- 2. open
  const openedAt = Date.now();
  const candidates = candidateUrls(make, found);
  const firstWave = await Promise.all(candidates.map((url) => openPage(url, FIRST_WAVE_MS)));
  const pages: Page[] = firstWave.filter((one): one is Page => !!one);
  const tried = new Set<string>([...candidates, ...pages.map((page) => page.finalUrl)]);
  const links = documentLinks(make, model, pages, tried, SECOND_WAVE_LINKS);
  const secondMs = Math.min(SECOND_WAVE_MS, end - Date.now() - READ_FLOOR_MS);
  if (links.length && secondMs >= 2_000) {
    const secondWave = await Promise.all(links.map((url) => openPage(url, secondMs)));
    for (const page of secondWave) if (page && !pages.some((one) => one.finalUrl === page.finalUrl)) pages.push(page);
  }
  const toRead = pagesToRead(make, model, pages);
  const opening =
    `listed=${found.listed.length} grounded=${found.grounded.length} searches=${found.queries} searched=${found.searched} ` +
    `candidates=${candidates.length} opened=${firstWave.filter(Boolean).length} linked=${links.length} ` +
    `pages=${pages.length} (${pages.map((one) => `${sourceOf(make, one)}/${one.kind}:${one.text.length}`).join(',')}) ` +
    `aboutModel=${toRead.length} (${Date.now() - openedAt}ms)`;
  if (!toRead.length) {
    console.error(
      `lookup-product: ${tag} — no page about this model could be opened; search model=${search.model} ` +
        `${opening}; total=${Date.now() - started}ms attempts ${searchTried}`,
    );
    return { status: 'failed', reason: 'error' };
  }

  // ---- 3. read
  const read = await askModels(
    deps,
    { apiKey, models, deadline: end - 500, tag },
    readStage(make, model, name, toRead.map((page) => ({ url: page.finalUrl, kind: page.kind, text: page.text, source: sourceOf(make, page) }))),
  );
  const readTried = read.attempts.map(attemptLine).join(' ');
  if (!read.ok) {
    console.error(
      `lookup-product: ${tag} — the pages were not read (${read.reason}); ${opening}; ` +
        `total=${Date.now() - started}ms attempts ${searchTried} | ${readTried}`,
    );
    return { status: 'failed', reason: read.reason };
  }

  // ---- 4. check
  const claims = read.value;
  const shown: Record<string, Page> = {};
  for (const page of toRead) shown[page.finalUrl] = page;
  const decision = decideLookup(make, model, claims, shown);
  const facts = decision.status === 'found' ? decision.facts : verifyLookup(make, model, claims, shown);
  console.log(
    `lookup-product: ${tag} — search model=${search.model} read model=${read.model}; ${opening}; ` +
      `claimed manual=${claims.manualUrl ? 'yes' : 'no'} parts=${claims.parts.length} ` +
      `service=${claims.service ? `${claims.service.months}mo` : 'no'}; ` +
      `verified manual=${facts.manual ? 'yes' : 'no'} parts=${facts.parts.length}/${claims.parts.length} ` +
      `service=${facts.service ? 'yes' : 'no'}; ` +
      `decision=${decision.status}${decision.status === 'failed' ? `/${decision.why}` : ''}; ` +
      `total=${Date.now() - started}ms attempts ${searchTried} | ${readTried}`,
  );
  if (decision.status === 'found') return { status: 'found', facts: decision.facts };
  if (decision.status === 'nothing') return { status: 'nothing' };
  // Not an answer: nothing was confirmed, and no page that could have said it
  // was read through. The row is failed, so it can be asked again.
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
 * Whose site it lands on is not asked here — a search result is often a
 * redirect, and a copy of the manual may sit on somebody else's site — so the
 * page is read whatever it is, and `verifyLookup` decides, from what it says
 * and who else says it, whether anything on it is believed. Exported so a real
 * page can be checked by hand against `verifyLookup`.
 */
export async function openPage(url: string, ms: number): Promise<Page | null> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(ms),
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.5' },
    });
    const finalUrl = response.url || url;
    if (!response.ok || !response.body) {
      response.body?.cancel().catch(() => {});
      if (!response.ok) console.error(`lookup-product: ${url} answered ${response.status}`);
      return null;
    }
    const bytes = await readCapped(response.body, MAX_PAGE_BYTES);
    const type = response.headers.get('content-type') ?? '';
    const isPdf = /pdf/i.test(type) ||
      (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
    if (isPdf) return { finalUrl, kind: 'pdf', text: await pdfWords(bytes) };
    if (!type || /html|text\/plain/i.test(type)) {
      const html = new TextDecoder().decode(bytes);
      return { finalUrl, kind: 'html', text: htmlText(html), links: pageLinks(html, finalUrl) };
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

/** A PDF's words: each stream inflated where it is compressed, then `pdf.ts` reads the document. */
async function pdfWords(bytes: Uint8Array): Promise<string> {
  // One character per byte, so the offsets `pdfStreams` finds are offsets
  // into `bytes` as well.
  const latin1 = latin1Of(bytes);
  const streams: PdfStream[] = [];
  let inflated = 0;
  for (const span of pdfStreams(latin1)) {
    if (inflated > MAX_INFLATED_BYTES) break;
    let data: string;
    if (span.flate) {
      const raw = await inflate(bytes.subarray(span.start, span.end));
      if (!raw.length) continue;
      inflated += raw.length;
      data = latin1Of(raw);
    } else {
      data = latin1.slice(span.start, span.end);
    }
    streams.push({ obj: span.obj, dict: span.dict, data });
  }
  return readPdf(latin1, streams);
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
    // What inflated before a fault is kept. Deno throws on anything after the
    // compressed data and keeps nothing, which is why `pdfStreams` cuts each
    // stream to its own length first.
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

