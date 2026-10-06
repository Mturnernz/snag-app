// Asking the models in turn — one loop for both of a lookup's questions.
//
// Pulled out so it can be driven by a fake `fetch`: this is the half of the
// feature that decides what a reply means, and it was three bugs at once. A
// 200 was taken for an answer and ended the loop; a body that failed to read
// was turned into `null` and read as "no candidates"; and the time was
// divided so that the second model got what the first left over and the third
// got none. No Deno and no network of its own: `AskDeps` is everything it
// touches, and `run.ts` hands it the real ones.
//
// **Two different things can go wrong, and the loop keeps them apart.** The
// *request* can fail (a status that is not 2xx) and the *reply* can be
// unusable (a 200 holding no candidate, no text, a cut-off or blocked answer,
// something that is not JSON, or an answer with nothing in it). The first is
// classified by the helpers read-label already has. The second is the stage's
// own `parse`, and every way of it is retried on the next model: each model
// samples its own answer, and a cheap second try is better than a permanent
// record that one reply was empty.
//
// A lookup asks two questions (`lookup.ts`): find the maker's pages, then read
// the ones this function downloaded. Each is a `Stage`, and each goes through
// this loop with its own time.

import { GEMINI_ENDPOINT, isBusy, isOutOfCredit, quotaRefusal } from '../read-label/gemini.ts';
import {
  describeReply, readFromGemini, readRequest, searchFromGemini, searchRequest,
  type FoundPages, type LookupClaims, type PageToRead, type ReplyFailure,
} from './lookup.ts';

/** Below this an attempt cannot finish, so none is started. */
export const MIN_ATTEMPT_MS = 10_000;
export const BUSY_PAUSE_MS = 1_000;

/** What one attempt came to. Not all of these become a database reason. */
export type AttemptKind =
  | 'success'
  | ReplyFailure // the reply, a 200: empty, unparseable, truncated, blocked
  | 'no_claims' // valid, and holds nothing to go on
  | 'body' // a 200 whose body could not be read, or was not JSON
  | 'timeout' // no answer in the time given: nobody refused, so never "busy"
  | 'unreachable' // the request itself did not get there
  | 'busy' | 'quota' | 'limit' // 429 / 500 / 503, and 402
  | 'config' // 400 on the full request; asked again without its options
  | 'error'; // anything else

export interface Attempt {
  model: string;
  kind: AttemptKind;
  status: number | null;
  ms: number;
}

export type AskOutcome<T> =
  | { ok: true; value: T; model: string; attempts: Attempt[] }
  | { ok: false; reason: 'busy' | 'limit' | 'error'; attempts: Attempt[] };

export interface AskDeps {
  fetch(url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** A signal that aborts after `ms`. */
  timeout(ms: number): AbortSignal;
  log(line: string): void;
  warn(line: string): void;
}

/** One question: the request two ways, and how its reply is read. */
export interface Stage<T> {
  /** For the log lines: `search` or `read`. */
  name: string;
  /** The request as asked first. */
  full: string;
  /** The same question without its options (a schema, a thinking level), for a model that refused them. */
  lean: string;
  parse(json: unknown): { ok: true; value: T } | { ok: false; reason: ReplyFailure };
  /** A usable reply that still holds nothing to go on, so the next model is asked. */
  isEmpty(value: T): boolean;
  /** The most one model is given while another is still to try. */
  attemptMs: number;
}

export interface AskArgs {
  apiKey: string;
  models: string[];
  /** The instant by which every attempt must have ended. */
  deadline: number;
  /** For the log lines: the lookup's own tag. */
  tag: string;
}

/**
 * The search: Google Search on, and an answer worth having only when it names
 * an address — listed by the model or returned by the search. 40s a model: a
 * search with a short think answers in seconds, and one cut off at 30s with
 * every option on (6 October 2026) is why this is not lower.
 */
export function searchStage(make: string, model: string, name: string | null): Stage<FoundPages> {
  return {
    name: 'search',
    full: JSON.stringify(searchRequest(make, model, name)),
    lean: JSON.stringify(searchRequest(make, model, name, { lean: true })),
    parse: (json) => {
      const outcome = searchFromGemini(json);
      return outcome.ok ? { ok: true, value: outcome.found } : outcome;
    },
    isEmpty: (found) => !found.listed.length && !found.grounded.length,
    attemptMs: 40_000,
  };
}

/**
 * The read: the downloaded pages, a schema, no tools. An answer with nothing
 * in it is an answer here — the pages may not say — so it is not asked again.
 */
export function readStage(make: string, model: string, name: string | null, pages: PageToRead[]): Stage<LookupClaims> {
  return {
    name: 'read',
    full: JSON.stringify(readRequest(make, model, name, pages)),
    lean: JSON.stringify(readRequest(make, model, name, pages, { lean: true })),
    parse: (json) => {
      const outcome = readFromGemini(json, pages);
      return outcome.ok ? { ok: true, value: outcome.claims } : outcome;
    },
    isEmpty: () => false,
    attemptMs: 35_000,
  };
}

const isTimeout = (err: unknown) => {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
};

export async function askModels<T>(deps: AskDeps, args: AskArgs, stage: Stage<T>): Promise<AskOutcome<T>> {
  const attempts: Attempt[] = [];
  // Once a model has refused the full request, the rest of this question is
  // asked without its options: no model is likelier to take what one refused.
  let full = true;

  const fail = (): AskOutcome<T> => {
    const kinds = new Set(attempts.map((a) => a.kind));
    // Busy is Google saying so (429, 500, 503). Running out of time, or not
    // reaching it, is not that, and wording it so invites a Try again that
    // would only meet the same clock: those are "couldn't finish".
    const reason = kinds.has('busy') ? 'busy' : kinds.has('limit') ? 'limit' : 'error';
    return { ok: false, reason, attempts };
  };

  for (const [index, modelName] of args.models.entries()) {
    const last = index === args.models.length - 1;
    // The same model is asked again at most once, and only without the options.
    for (let round = 0; round < 2; round += 1) {
      const left = args.deadline - deps.now();
      if (left < MIN_ATTEMPT_MS) {
        deps.warn(`lookup-product: ${args.tag} ${stage.name} model=${modelName} not asked — ${Math.max(0, Math.round(left))}ms left, ${MIN_ATTEMPT_MS}ms needed`);
        return fail();
      }
      const allowed = last ? left : Math.min(left, stage.attemptMs);
      const started = deps.now();
      const record = (kind: AttemptKind, status: number | null): Attempt => {
        const one = { model: modelName, kind, status, ms: deps.now() - started };
        attempts.push(one);
        return one;
      };
      const head = () => `lookup-product: ${args.tag} ${stage.name} model=${modelName} full=${full} allowedMs=${Math.round(allowed)}`;

      let response: Awaited<ReturnType<AskDeps['fetch']>>;
      try {
        response = await deps.fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(modelName)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.apiKey },
          body: full ? stage.full : stage.lean,
          signal: deps.timeout(allowed),
        });
      } catch (err) {
        const kind = isTimeout(err) ? 'timeout' : 'unreachable';
        const one = record(kind, null);
        deps.warn(`${head()} request ${kind === 'timeout' ? 'timed out' : 'failed'} after ${one.ms}ms: ${String(err)}`);
        break;
      }

      // ---- the request failed
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const quota = quotaRefusal(response.status, detail);
        const note = quota ? `quota — ${quota.detail}` : detail.slice(0, 300);
        if (isOutOfCredit(response.status)) {
          const one = record('limit', response.status);
          deps.warn(`${head()} http=${response.status} ms=${one.ms} out of credit: ${note}`);
          // Billing is per project: no other model will answer either.
          return { ok: false, reason: 'limit', attempts };
        }
        if (full && response.status === 400) {
          const one = record('config', 400);
          deps.warn(`${head()} http=400 ms=${one.ms} refused the request's options, asking again without them: ${note}`);
          full = false;
          continue;
        }
        if (isBusy(response.status)) {
          // A per-minute limit is busy by another name; a used-up day, or an
          // allowance the plan does not include, is not. Another model is
          // still asked, since Google keeps most allowances per model.
          const kind = quota && !quota.perMinute ? 'limit' : 'busy';
          const one = record(kind, response.status);
          deps.warn(`${head()} http=${response.status} ms=${one.ms} ${kind}: ${note}`);
          if (!last) await deps.sleep(BUSY_PAUSE_MS);
          break;
        }
        if (response.status === 404) {
          // A model this key cannot use is this model's failing, not the next's.
          const one = record('error', 404);
          deps.warn(`${head()} http=404 ms=${one.ms} model not available: ${note}`);
          break;
        }
        // A bad key or a malformed request fails the same way on every model.
        const one = record('error', response.status);
        deps.warn(`${head()} http=${response.status} ms=${one.ms} not retried: ${note}`);
        return { ok: false, reason: 'error', attempts };
      }

      // ---- the request succeeded; is there a reply?
      let json: unknown;
      try {
        json = JSON.parse(await response.text());
      } catch (err) {
        const kind = isTimeout(err) ? 'timeout' : 'body';
        const one = record(kind, response.status);
        deps.warn(`${head()} http=${response.status} ms=${one.ms} reply body ${kind === 'timeout' ? 'timed out' : 'unreadable or not JSON'}: ${String(err)}`);
        break;
      }

      const outcome = stage.parse(json);
      const shape = describeReply(json);
      if (!outcome.ok) {
        const one = record(outcome.reason, response.status);
        deps.warn(`${head()} http=${response.status} ms=${one.ms} ${shape} result=${outcome.reason}`);
        break;
      }
      if (stage.isEmpty(outcome.value)) {
        const one = record('no_claims', response.status);
        deps.warn(`${head()} http=${response.status} ms=${one.ms} ${shape} result=no_claims`);
        break;
      }
      const one = record('success', response.status);
      deps.log(`${head()} http=${response.status} ms=${one.ms} ${shape} result=success`);
      return { ok: true, value: outcome.value, model: modelName, attempts };
    }
  }
  return fail();
}

