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
// - **It reads the photo as the caller.** The client sends a storage path, not
//   bytes, and the download uses the caller's own token — so the four storage
//   policies on `home-photos` decide what can be read, exactly as they do
//   everywhere else. A path into somebody else's household is refused.
// - **It transcribes; it does not know things.** Every field is what is printed
//   on the label, or null. The single exception is `hex`, an on-screen
//   estimate of a colour, only ever drawn as a swatch beside the real code.
// - **What it takes comes off the label or not at all.** A bulb spec "likely"
//   for this oven is the same unverifiable claim an unsourced tradesman is.
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
  // phone as their photo having been unreadable.
  if (!apiKey) return answer(503, { error: NOT_SET_UP });

  const authorization = req.headers.get('Authorization');
  if (!authorization) return answer(401, { error: 'Sign in again to read a label.' });

  let path: string;
  let kind: string;
  try {
    const body = await req.json();
    path = typeof body?.path === 'string' ? body.path : '';
    kind = typeof body?.kind === 'string' ? body.kind : 'appliance';
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
  if (allowed !== true) {
    return answer(429, { error: "That's today's label reads used up — type what this one says." });
  }

  // One read claimed above covers every model asked: falling back is our
  // retry, not the household's second read.
  const models = modelsToTry(Deno.env.get('GEMINI_MODEL'), Deno.env.get('GEMINI_FALLBACK_MODEL'));
  const body = JSON.stringify(geminiRequest(kind, mimeType, encodeBase64(bytes)));
  const deadline = Date.now() + MODEL_TIMEOUT_MS;
  let reply: Response | null = null;
  let busy = false;

  for (const [index, model] of models.entries()) {
    const left = deadline - Date.now();
    if (reply !== null || left < MIN_ATTEMPT_MS) break;
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
    if (attempt.ok) {
      reply = attempt;
      break;
    }
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
      return answer(503, { error: NOT_SET_UP });
    }
    return answer(502, { error: "Couldn't read the label just now — type what it says." });
  }

  if (!reply) {
    return answer(busy ? 503 : 504, { error: busy ? BUSY : "Couldn't read the label just now — type what it says." });
  }

  const outcome = readingFromGemini(await reply.json().catch(() => null));
  if (!outcome.ok) {
    console.error('read-label: no reading —', outcome.reason);
    return answer(422, { error: COULD_NOT_READ });
  }
  return answer(200, outcome.reading);
});
