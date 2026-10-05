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
import { GEMINI_ENDPOINT, isBusy, isOutOfCredit, quotaRefusal } from '../read-label/gemini.ts';
import {
  hasFacts, htmlText, lookupFromGemini, lookupRequest, pdfStreams, pdfStrings, urlsToOpen,
  verifyLookup, type Page, type ProductFacts,
} from './lookup.ts';

export type LookupResult =
  | { status: 'found'; facts: ProductFacts }
  | { status: 'nothing' }
  | { status: 'failed'; reason: 'busy' | 'error' | 'quota' | 'limit' };

// A search and a few page reads take far longer than reading one plate, so the
// early attempts get more room than read-label gives them — but still leave a
// next model enough to answer.
const EARLY_ATTEMPT_MS = 30_000;
const MIN_ATTEMPT_MS = 12_000;
const BUSY_PAUSE_MS = 1_000;
// What opening the cited pages may take, kept back from the model's budget.
const PAGES_MS = 12_000;
// A manual is a few megabytes; a page that is fifty is not one to wait for.
const MAX_PAGE_BYTES = 15 * 1024 * 1024;
const MAX_INFLATED_BYTES = 30 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (compatible; SnagHQ-lookup/1.0; +https://www.snaghq.co.nz)';

/**
 * Asks the models in turn, and holds what they claim against the pages they
 * cite. `budgetMs` is the whole allowance, pages included.
 */
export async function lookUp(
  apiKey: string,
  models: string[],
  make: string,
  model: string,
  name: string | null,
  budgetMs: number,
): Promise<LookupResult> {
  const deadline = Date.now() + budgetMs - PAGES_MS;
  const body = JSON.stringify(lookupRequest(make, model, name));
  let busy = false;
  let limited = false;
  let json: unknown = null;
  let answered = false;

  for (const [index, modelName] of models.entries()) {
    const left = deadline - Date.now();
    if (left < MIN_ATTEMPT_MS) break;
    const last = index === models.length - 1;
    let attempt: Response;
    try {
      attempt = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(modelName)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: AbortSignal.timeout(last ? left : Math.min(left, EARLY_ATTEMPT_MS)),
      });
    } catch (err) {
      console.error(`lookup-product: ${modelName} unreachable or too slow:`, err);
      busy = true;
      continue;
    }
    if (attempt.ok) {
      json = await attempt.json().catch(() => null);
      answered = true;
      break;
    }
    const detail = await attempt.text().catch(() => '');
    const quota = quotaRefusal(attempt.status, detail);
    console.error(
      `lookup-product: ${modelName} ${attempt.status}:`,
      quota ? `quota — ${quota.detail}` : detail.slice(0, 500),
    );
    // No credit on the key: billing is per project, so no model will answer.
    if (isOutOfCredit(attempt.status)) return { status: 'failed', reason: 'limit' };
    if (isBusy(attempt.status)) {
      // A per-minute limit is busy by another name; a used-up day, or an
      // allowance the plan does not include, is not — and saying "busy" there
      // invites a Try again that cannot work. Another model is still asked,
      // since Google keeps most allowances per model.
      if (quota && !quota.perMinute) limited = true;
      else busy = true;
      if (!last) await new Promise((resolve) => setTimeout(resolve, BUSY_PAUSE_MS));
      continue;
    }
    return { status: 'failed', reason: 'error' };
  }
  if (!answered) return { status: 'failed', reason: busy ? 'busy' : limited ? 'limit' : 'error' };

  const outcome = lookupFromGemini(json);
  if (!outcome.ok) {
    console.error(`lookup-product: ${make} ${model} — no answer:`, outcome.reason);
    return { status: 'failed', reason: 'error' };
  }

  const urls = urlsToOpen(make, outcome.claims);
  const opened = await Promise.all(urls.map((url) => openPage(url, PAGES_MS - 1_000)));
  const pages: Record<string, Page | undefined> = {};
  urls.forEach((url, i) => (pages[url] = opened[i] ?? undefined));

  const facts = verifyLookup(make, model, outcome.claims, pages);
  // What was claimed and what was kept, so a lookup that came to nothing can
  // be told apart from one that found the wrong things.
  console.log(
    `lookup-product: ${make} ${model} — claimed manual ${outcome.claims.manualUrl ?? 'none'}, ` +
      `${outcome.claims.parts.length} part(s) [${outcome.claims.parts.map((p) => `${p.code} @ ${p.url}`).join('; ')}], ` +
      `service ${outcome.claims.service ? `${outcome.claims.service.months}mo @ ${outcome.claims.service.url}` : 'none'}; ` +
      `opened ${opened.filter(Boolean).length} of ${urls.length}; ` +
      `kept manual ${facts.manual ? 'yes' : 'no'}, ${facts.parts.length} part(s), service ${facts.service ? 'yes' : 'no'}`,
  );
  return hasFacts(facts) ? { status: 'found', facts } : { status: 'nothing' };
}

/**
 * Begins, claims, looks up and keeps — the whole of one lookup, as the caller.
 *
 * Returns without doing anything when `begin_product_lookup` says an answer is
 * already kept or one is under way. A read is claimed only when a search is
 * actually going to run, so a second scan of the same model costs nothing.
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

  const finish = async (result: LookupResult) => {
    const { error: finishError } = await supabase.rpc('finish_product_lookup', {
      p_id: id,
      p_status: result.status,
      p_result: result.status === 'found' ? result.facts : null,
      p_reason: result.status === 'failed' ? result.reason : null,
    });
    if (finishError) console.error('lookup-product: could not keep the answer —', finishError.message);
  };

  // The same daily allowance a label read spends: a search is a model call
  // on the operator's key like any other.
  const { data: allowed, error: claimError } = await supabase.rpc('claim_label_read', {
    p_household_id: ask.householdId,
  });
  if (claimError || allowed !== true) {
    await finish({ status: 'failed', reason: claimError ? 'error' : 'quota' });
    return 'kept';
  }

  let result: LookupResult;
  try {
    result = await lookUp(apiKey, models, ask.make, ask.model, ask.name, budgetMs);
  } catch (err) {
    console.error('lookup-product: failed —', err);
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

