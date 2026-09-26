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
// - **What it takes is suggested, never entered.** A plate rarely prints its
//   filter code, so `suggestedConsumables` and `suggestedServiceMonths` come
//   from what the model knows about the make and model — and the walkthrough
//   offers them under a heading calling them suggestions, one tap each, and
//   never lays one into a box.
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
import { GEMINI_ENDPOINT, geminiRequest, isBusy, modelsToTry, readingFromGemini } from './gemini.ts';

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
// How long to leave a busy model before the background round. A 503 for
// "high demand" clears in tens of seconds, not in one.
const BACKGROUND_RETRY_PAUSE_MS = 20_000;

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

type Asked =
  | { kind: 'reply'; json: unknown }
  | { kind: 'busy' }
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
    console.error(`read-label: ${model} ${attempt.status}:`, detail.slice(0, 500));
    if (isBusy(attempt.status)) {
      busy = true;
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
  return busy ? { kind: 'busy' } : { kind: 'error' };
}

/** A reply, as what the waiting room keeps and what the caller is told. */
function settle(asked: Asked):
  | { status: 'read'; reading: unknown }
  | { status: 'failed'; reason: 'illegible' | 'busy' | 'error'; http: number; words: string } {
  if (asked.kind === 'busy') return { status: 'failed', reason: 'busy', http: 503, words: BUSY };
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

Deno.serve(async (req) => {
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
  try {
    const body = await req.json();
    path = typeof body?.path === 'string' ? body.path : '';
    // Empty is "nobody has said yet": the walkthrough takes the photo before
    // it asks what the thing is, so the reader is asked to say.
    kind = typeof body?.kind === 'string' ? body.kind : '';
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

  // A photo the model could not read a label in is a failure to the waiting
  // room — the card has to ask for typing — even though the open sheet is
  // answered with the reading itself and words it there.
  const keepRead = (reading: unknown): Promise<void> =>
    // deno-lint-ignore no-explicit-any
    (reading as any)?.legible === false ? keep('failed', null, 'illegible') : keep('read', reading, null);

  if (allowed !== true) {
    await keep('failed', null, 'quota');
    return answer(429, { error: USED_UP, readingId });
  }

  // One read claimed above covers every model asked, and the background
  // round too: falling back is our retry, not the household's second read.
  const models = modelsToTry(Deno.env.get('GEMINI_MODEL'), Deno.env.get('GEMINI_FALLBACK_MODEL'));
  const body = JSON.stringify(geminiRequest(kind, mimeType, encodeBase64(bytes)));

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
