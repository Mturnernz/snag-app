// read-label — what a photograph of a rating plate or a paint tin says.
//
// The walkthrough's step three already asks for a photo of the label, because
// the plate carries the make, model and serial at once. Until now somebody
// then typed all three off the photo they had just taken. This reads them, and
// the walkthrough lays the answer into the boxes that are still empty
// (`applyLabelReading`), where the person checks it before anything is saved.
//
// Four rules, and each is a way this could make the house record worse:
//
// - **It writes nothing to the record.** It returns text; the walkthrough
//   still writes only on its last step, through `create_thing`, so a reading
//   nobody confirmed can never reach the record. (It does count the read —
//   see `home.claim_label_read` — which is a cost ceiling, not a record.)
// - **It finishes whatever the phone does.** The work runs under
//   `EdgeRuntime.waitUntil` and what it found is kept in `home.label_readings`,
//   a waiting room rather than the record. So somebody can press *Add it*, or
//   lock the phone, while the model is still looking, and the reading turns up
//   as a card on the thing's own page to be checked there. An open sheet still
//   gets the answer in the reply, as before. A busy model gets one more go in
//   the background, after the caller has been told.
// - **It reads the photo as the caller.** The client sends a storage path, not
//   bytes, and the download uses the caller's own token — so the four storage
//   policies on `home-photos` decide what can be read, exactly as they do
//   everywhere else. A path into somebody else's household is refused.
// - **It transcribes; it does not know things — except where it says so.**
//   Every field that lands in a box is what is printed on the label, or null.
//   `hex` is the maker's published value for the named colour, or null —
//   never judged from the photo, because lighting makes a white look grey.
// - **What it takes is looked up, never remembered.** A plate rarely prints
//   its filter code, and this used to ask the model to supply one from memory:
//   four reads of one heat pump gave three different answers. Once a plate has
//   given a make and a model, `lookup-product`'s search runs here in the
//   background instead — the maker's own website, every value checked against
//   the page it came from — and its answer waits on the thing's page.
//
// The model is Gemini, called over REST (`gemini.ts` holds the request and the
// reading of the reply, and is what the tests exercise). The app never knows
// which model answered: it calls this function and gets the same shape back.
//
// Secrets: GEMINI_API_KEY (required — use a paid-tier key: on the free tier
// Google may use submitted content, and these are photographs of the inside of
// people's houses). GEMINI_MODEL and GEMINI_FALLBACK_MODEL (optional, defaults
// in gemini.ts).
// Deploy: `supabase functions deploy read-label` — JWT verification stays on,
// so a signed-out caller never reaches the model.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding/base64';
import {
  GEMINI_ENDPOINT, geminiRequest, isBusy, isOutOfCredit, modelsToTry, quotaRefusal, readingFromGemini,
} from './gemini.ts';
import { lookUpAndKeep } from '../lookup-product/run.ts';

const BUCKET = 'home-photos';
const MAX_BYTES = 5 * 1024 * 1024;
// Under the app's own 45s leash (`LABEL_TIMEOUT_MS`), so the function answers
// in words before the client gives up and says "no connection".
const MODEL_TIMEOUT_MS = 40_000;

// The web build calls this from app.snaghq.co.nz, so the browser asks first.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const NOT_SET_UP = "Label reading isn't set up yet — type what the label says.";
const BUSY = 'The label reader is busy right now — try again in a minute, or type what it says.';
// A next model is only worth asking with enough of the budget left to answer,
// so every attempt but the last is cut off early enough to leave some: a model
// that hangs must not spend the whole 40s on its own. A busy answer comes back
// in a few seconds, so three attempts fit comfortably.
const MIN_ATTEMPT_MS = 8_000;
const EARLY_ATTEMPT_MS = 15_000;
// A breath between a busy answer and the next ask — Google's own advice for 503.
const BUSY_PAUSE_MS = 1_000;
const COULD_NOT_READ = "Couldn't read that one — type what the label says.";
const NOT_NOW = "Couldn't read the label just now — type what it says.";
// Said to a sheet still open when the first round came back busy: the second
// round runs in the background, and its answer lands on the thing's page.
const BUSY_STILL_TRYING =
  "The label reader is busy — it'll keep trying. Carry on, and check what it read on the item's page.";
const USED_UP = "That's today's label reads used up — type what this one says.";
// Google would not run the read at all — no credit on the key, or an allowance
// that will not come back within the minute. Not "busy": nothing the person
// can wait out, and a Try again here only spends another of the day's reads.
const UNAVAILABLE = "Label reading isn't available right now — type what the label says.";
// How long to leave a busy model before the background round. A 503 for
// "high demand" clears in tens of seconds, not in one.
const BACKGROUND_RETRY_PAUSE_MS = 20_000;
// The lookup that follows a read runs in the same background work, which the
// platform ends 150 seconds after the request arrived. A lookup is given what
// is left of that, up to its own budget, and is not started with too little to
// finish — the thing's page offers *Look it up* instead.
const WALL_CLOCK_MS = 140_000;
const LOOKUP_BUDGET_MS = 90_000;
const LOOKUP_MIN_MS = 30_000;

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

type Asked =
  | { kind: 'reply'; json: unknown }
  | { kind: 'busy' }
  | { kind: 'limit' }
  | { kind: 'notSetUp' }
  | { kind: 'error' };

/**
 * One round through the models: the default, then the fallbacks, each capped
 * so a hang cannot spend the whole budget. Busy means every model said so (or
 * was too slow); anything else that is not an answer would fail the same way
 * on every model, so it stops there.
 */
async function askModels(models: string[], body: string, apiKey: string): Promise<Asked> {
  const deadline = Date.now() + MODEL_TIMEOUT_MS;
  let busy = false;
  let limited = false;

  for (const [index, model] of models.entries()) {
    const left = deadline - Date.now();
    if (left < MIN_ATTEMPT_MS) break;
    const last = index === models.length - 1;
    let attempt: Response;
    try {
      attempt = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: AbortSignal.timeout(last ? left : Math.min(left, EARLY_ATTEMPT_MS)),
      });
    } catch (err) {
      // Too slow or unreachable is a kind of busy: the next model may answer.
      console.error(`read-label: ${model} unreachable or too slow:`, err);
      busy = true;
      continue;
    }
    if (attempt.ok) return { kind: 'reply', json: await attempt.json().catch(() => null) };

    const detail = await attempt.text().catch(() => '');
    const quota = quotaRefusal(attempt.status, detail);
    console.error(`read-label: ${model} ${attempt.status}:`, quota ? `quota — ${quota.detail}` : detail.slice(0, 500));
    // Billing is per project: no other model will answer either.
    if (isOutOfCredit(attempt.status)) return { kind: 'limit' };
    if (isBusy(attempt.status)) {
      // A per-minute limit is busy by another name; a used-up day is not, but
      // another model is still asked, since Google keeps most allowances per
      // model — `lookup-product`'s rule.
      if (quota && !quota.perMinute) limited = true;
      else busy = true;
      if (!last) await new Promise((resolve) => setTimeout(resolve, BUSY_PAUSE_MS));
      continue;
    }
    // A bad or revoked key comes back 400 ("API key not valid") or 401/403,
    // and would on every model.
    if (attempt.status === 401 || attempt.status === 403 || /API key/i.test(detail)) {
      return { kind: 'notSetUp' };
    }
    return { kind: 'error' };
  }
  return busy ? { kind: 'busy' } : limited ? { kind: 'limit' } : { kind: 'error' };
}

/** A reply, as what the waiting room keeps and what the caller is told. */
function settle(asked: Asked):
  | { status: 'read'; reading: unknown }
  | { status: 'failed'; reason: 'illegible' | 'busy' | 'limit' | 'error'; http: number; words: string } {
  if (asked.kind === 'busy') return { status: 'failed', reason: 'busy', http: 503, words: BUSY };
  if (asked.kind === 'limit') return { status: 'failed', reason: 'limit', http: 503, words: UNAVAILABLE };
  if (asked.kind === 'notSetUp') return { status: 'failed', reason: 'error', http: 503, words: NOT_SET_UP };
  if (asked.kind === 'error') return { status: 'failed', reason: 'error', http: 502, words: NOT_NOW };
  const outcome = readingFromGemini(asked.json);
  if (!outcome.ok) {
    console.error('read-label: no reading —', outcome.reason);
    return { status: 'failed', reason: 'illegible', http: 422, words: COULD_NOT_READ };
  }
  return { status: 'read', reading: outcome.reading };
}

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** JPEG, PNG and WebP by their first bytes; the upload path only ever makes JPEG. */
function sniff(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  return null;
}

/**
 * The make and model a reading gives, when it is worth looking the model up:
 * an appliance (or something nobody has named yet that is not paint or tile)
 * whose plate gave both.
 */
function lookupFor(reading: unknown, kind: string): { make: string; model: string; name: string | null } | null {
  // deno-lint-ignore no-explicit-any
  const r = reading as any;
  if (!r || r.legible !== true) return null;
  const said = kind || (typeof r.kindGuess === 'string' ? r.kindGuess : '');
  // A paint, a tile or a pack has no manual or service interval to look up.
  if (said === 'finish' || said === 'tile' || said === 'consumable') return null;
  const make = typeof r.make === 'string' ? r.make.trim() : '';
  const model = typeof r.model === 'string' ? r.model.trim() : '';
  if (!make || !model) return null;
  const name = typeof r.whatItIs === 'string' && r.whatItIs.trim() ? r.whatItIs.trim().slice(0, 60) : null;
  return { make: make.slice(0, 80), model: model.slice(0, 80), name };
}

Deno.serve(async (req) => {
  const arrived = Date.now();
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return answer(405, { error: 'Only POST' });

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  // Said in words, because the alternative reads to the person holding the
  // phone as their photo having been unreadable. No reading row either: the
  // feature is off, and a card saying so on every thing would be noise.
  if (!apiKey) return answer(503, { error: NOT_SET_UP });

  const authorization = req.headers.get('Authorization');
  if (!authorization) return answer(401, { error: 'Sign in again to read a label.' });

  let path: string;
  let kind: string;
  let rooms: string[] = [];
  try {
    const body = await req.json();
    path = typeof body?.path === 'string' ? body.path : '';
    // Empty is "nobody has said yet": the walkthrough takes the photo before
    // it asks what the thing is, so the reader is asked to say.
    kind = typeof body?.kind === 'string' ? body.kind : '';
    // The place's room names, for the room guess. Trimmed and capped: they are
    // somebody's typing, and only ever offered back as a choice among them.
    rooms = Array.isArray(body?.rooms)
      ? (body.rooms as unknown[])
        .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        .map((r) => r.trim().slice(0, 40))
        .slice(0, 40)
      : [];
  } catch {
    return answer(400, { error: "Couldn't read the label" });
  }
  // Photos only: `<household_id>/<file>`, never the `docs/` folder beside them.
  const segments = path.split('/');
  if (!path || path.includes('..') || segments.length !== 2 || !segments[0] || !segments[1]) {
    return answer(400, { error: "Couldn't read the label" });
  }

  // As the caller, so the storage policies and `require_member` are what decide.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    db: { schema: 'home' },
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: file, error: downloadError } = await supabase.storage.from(BUCKET).download(path);
  if (downloadError || !file) return answer(404, { error: "Couldn't find that photo to read." });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = sniff(bytes);
  if (!mimeType || bytes.byteLength > MAX_BYTES) {
    return answer(400, { error: "That photo can't be read — try another." });
  }

  // Claimed before the model is called and never refunded: an attempt that
  // failed at the model still cost a request.
  const { data: allowed, error: claimError } = await supabase.rpc('claim_label_read', {
    p_household_id: segments[0],
  });
  if (claimError) return answer(403, { error: "Couldn't read the label" });

  // The waiting room. If opening it fails the read still goes ahead and the
  // caller still gets the answer — it just cannot outlive the sheet.
  const { data: opened, error: openError } = await supabase.rpc('begin_label_reading', { p_path: path });
  if (openError) console.error('read-label: could not open a reading —', openError.message);
  const readingId: string | null = typeof opened === 'string' ? opened : null;

  const keep = async (
    status: 'read' | 'failed',
    reading: unknown,
    reason: string | null,
  ): Promise<void> => {
    if (!readingId) return;
    const { error } = await supabase.rpc('finish_label_reading', {
      p_id: readingId,
      p_status: status,
      p_reading: status === 'read' ? reading : null,
      p_reason: reason,
    });
    if (error) console.error('read-label: could not keep the reading —', error.message);
  };

  // One read claimed above covers every model asked, and the background
  // round too: falling back is our retry, not the household's second read.
  // (A lookup that follows claims its own — it is a second request.)
  const models = modelsToTry(Deno.env.get('GEMINI_MODEL'), Deno.env.get('GEMINI_FALLBACK_MODEL'));

  // Once the plate has given a make and a model, the maker's website is
  // searched for the rest — in the background, after the reading is kept, so
  // it never holds up the sheet. Kept per model, so a second scan of the same
  // heat pump finds the answer already there and searches nothing.
  const lookUpAfter = async (reading: unknown): Promise<void> => {
    const ask = lookupFor(reading, kind);
    if (!ask) return;
    const left = Math.min(LOOKUP_BUDGET_MS, arrived + WALL_CLOCK_MS - Date.now());
    if (left < LOOKUP_MIN_MS) return;
    await lookUpAndKeep(supabase, apiKey, models, { householdId: segments[0], ...ask }, left);
  };

  // A photo the model could not read a label in is a failure to the waiting
  // room — the card has to ask for typing — even though the open sheet is
  // answered with the reading itself and words it there.
  const keepRead = async (reading: unknown): Promise<void> => {
    // deno-lint-ignore no-explicit-any
    if ((reading as any)?.legible === false) return keep('failed', null, 'illegible');
    await keep('read', reading, null);
    // Its own background work, never part of `whole`: the open sheet is
    // answered once the reading is kept, and must not wait on a search.
    EdgeRuntime.waitUntil(
      lookUpAfter(reading).catch((err) => console.error('read-label: lookup failed —', err)),
    );
  };

  if (allowed !== true) {
    await keep('failed', null, 'quota');
    return answer(429, { error: USED_UP, readingId });
  }

  const body = JSON.stringify(geminiRequest(kind, mimeType, encodeBase64(bytes), rooms));

  // Everything from here runs under waitUntil, so a caller who pressed *Add
  // it*, closed the sheet or locked the phone does not cut it short. The
  // reply below waits on the first round only.
  const first = askModels(models, body, apiKey).then(settle);
  const whole = first.then(async (outcome) => {
    if (outcome.status === 'failed' && outcome.reason === 'busy') {
      await new Promise((resolve) => setTimeout(resolve, BACKGROUND_RETRY_PAUSE_MS));
      const again = settle(await askModels(models, body, apiKey));
      if (again.status === 'read') return keepRead(again.reading);
      return keep('failed', null, again.reason);
    }
    if (outcome.status === 'read') return keepRead(outcome.reading);
    return keep('failed', null, outcome.reason);
  }).catch((err) => console.error('read-label: background work failed —', err));
  EdgeRuntime.waitUntil(whole);

  const outcome = await first;
  if (outcome.status === 'failed' && outcome.reason === 'busy') {
    // Answered now rather than after the second round, which would outlast
    // the app's own deadline. The reading id lets the sheet say where the
    // answer will turn up.
    return answer(503, { error: readingId ? BUSY_STILL_TRYING : BUSY, readingId });
  }
  // Kept before answering, so a caller who uses the reading straight away is
  // resolving a row that already says what it said.
  await whole;
  if (outcome.status === 'failed') return answer(outcome.http, { error: outcome.words, readingId });
  const reading = outcome.reading && typeof outcome.reading === 'object' ? outcome.reading : {};
  return answer(200, { ...reading, readingId });
});
