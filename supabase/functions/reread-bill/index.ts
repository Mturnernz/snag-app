// reread-bill — *Read again*, on a card that came in blank.
//
// A forwarded email always files its card, read or not — and on the day the
// first real bills were emailed in, every model answered 503 for three minutes
// and three of four cards arrived with nothing on them and no way to try
// again. This is the way. It reads the card's files exactly as `inbound-bill`
// would have (`read.ts`, `cardsFromReadings`), and hands the result to
// `home.refile_review`, which replaces the blank card with one card per paper:
// an email of four PDFs and a photo read again is four or five cards, the same
// as if the model had answered the first time.
//
// Four rules:
//
// - **Only a blank card.** `refile_review` refuses one anybody has typed on or
//   that was read, because a reading must not throw away somebody's answers.
//   The button only shows on a blank card for the same reason.
// - **As the caller.** The card is read through RLS, the files are downloaded
//   with the caller's token so the `home-photos` policies decide, and the
//   refile runs as them — so this can reach nothing the person could not open
//   by hand, and it can only move files the card already held.
// - **Counted.** A household gets fifty model reads a day, the ceiling label
//   reading already keeps (`home.claim_label_read`): one per paper, claimed
//   before the model is asked and never refunded.
// - **Nothing changes unless something was read.** If no paper could be read
//   the card is left as it was and the answer says why in words — busy, not
//   set up, or unreadable — so pressing again later is still possible.
//
// Secrets: GEMINI_API_KEY (and optionally GEMINI_MODEL, GEMINI_FALLBACK_MODEL),
// shared with read-label and inbound-bill; RESEND_INBOUND_API_KEY, optional,
// to give the reading the email's own words again.
// Deploy: `supabase functions deploy reread-bill` — JWT verification stays on.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  bytesToBase64, cardFromEmail, cardsFromReadings, paperName, sniffPaper, stripHtml,
  type PaperCard, type StoredPaper,
} from '../inbound-bill/bill.ts';
import { readPapers, type PaperFile } from '../inbound-bill/read.ts';

const BUCKET = 'home-photos';
const RESEND_API = 'https://api.resend.com';
const MAX_BYTES = 10 * 1024 * 1024;
// Under the app's own leash for this call (`READ_AGAIN_TIMEOUT_MS`, 60s), so the
// function answers in words before the client gives up and says "no connection".
const MODEL_BUDGET_MS = 45_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const NOT_SET_UP = "Reading bills isn't set up yet — fill this one in by hand.";
const BUSY = 'The reader is busy right now — try again in a minute.';
const COULD_NOT_READ = "Couldn't read anything off this one — fill it in by hand.";

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return answer(405, { error: 'Only POST' });

  if (!Deno.env.get('GEMINI_API_KEY')) return answer(503, { error: NOT_SET_UP });

  const authorization = req.headers.get('Authorization');
  if (!authorization) return answer(401, { error: 'Sign in again to read this.' });

  let reviewId = '';
  try {
    const body = await req.json();
    reviewId = typeof body?.reviewId === 'string' ? body.reviewId : '';
  } catch {
    // Answered below.
  }
  if (!/^[0-9a-f-]{36}$/i.test(reviewId)) return answer(400, { error: "Couldn't find that card." });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    db: { schema: 'home' },
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: card, error: cardError } = await supabase
    .from('invoice_reviews')
    .select('id, project_id, state, supplier, detail, amount, invoice_number, dated, due_on, photo_paths, document_paths, source_ref, source_subject, source_from')
    .eq('id', reviewId)
    .maybeSingle();
  if (cardError || !card) return answer(404, { error: "Couldn't find that card." });
  if (card.state !== 'pending') return answer(409, { error: 'That one has already been ruled on.' });
  const blank = [card.supplier, card.detail, card.amount, card.invoice_number, card.dated, card.due_on]
    .every((value) => value === null);
  if (!blank) return answer(409, { error: 'Somebody has already filled this one in.' });

  const paths: string[] = [...(card.document_paths ?? []), ...(card.photo_paths ?? [])];
  const household = paths[0]?.split('/')[0]
    ?? (await supabase.from('projects').select('household_id').eq('id', card.project_id).maybeSingle()).data?.household_id;
  if (!household) return answer(404, { error: "Couldn't find that card." });

  // One read per paper, or one for the email's words. Claimed before asking.
  for (let i = 0; i < Math.max(paths.length, 1); i++) {
    const { data: allowed, error: claimError } = await supabase.rpc('claim_label_read', { p_household_id: household });
    if (claimError) return answer(403, { error: "Couldn't read this one." });
    if (allowed !== true) return answer(429, { error: "That's today's reads used up — fill this one in by hand." });
  }

  const stored: StoredPaper[] = [];
  const files: PaperFile[] = [];
  const unfetched: StoredPaper[] = [];
  for (const path of paths) {
    const isPdf = path.includes('/docs/');
    const { data: blob } = await supabase.storage.from(BUCKET).download(path);
    const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    const mimeType = bytes ? sniffPaper(bytes) : null;
    if (!bytes || !mimeType || bytes.byteLength > MAX_BYTES) {
      // Kept on a card all the same: a reading may move files, never drop one.
      unfetched.push({ path, isPdf });
      continue;
    }
    stored.push({ path, isPdf: mimeType === 'application/pdf' });
    files.push({ mimeType, base64: bytesToBase64(bytes), name: paperName(path) });
  }

  const [people, text] = await Promise.all([
    supabase.rpc('project_people', { p_project_id: card.project_id }).then(({ data }) => (Array.isArray(data) ? data : [])),
    emailText(card.source_ref),
  ]);

  const read = await readPapers(
    files,
    { from: card.source_from, subject: card.source_subject, text },
    people,
    MODEL_BUDGET_MS,
    `reread-bill: ${reviewId}`,
  );

  const anything = read.readings.some((r) => r !== null) || read.fromEmail !== null;
  if (!anything) {
    if (read.notSetUp) return answer(503, { error: NOT_SET_UP });
    return answer(read.busy ? 503 : 422, { error: read.busy ? BUSY : COULD_NOT_READ });
  }

  const cards: PaperCard[] = stored.length > 0 || unfetched.length > 0
    ? cardsFromReadings([...stored, ...unfetched], [...read.readings, ...unfetched.map(() => null)])
    : [cardFromEmail(read.fromEmail)];

  const { data: refiled, error: refileError } = await supabase.rpc('refile_review', {
    p_review_id: reviewId,
    p_cards: cards,
  });
  if (refileError) return answer(409, { error: refileError.message });

  const count = Array.isArray(refiled) ? refiled.length : cards.length;
  return answer(200, { cards: count, busy: read.busy });
});

/**
 * The email's own words, when the key to fetch them is there. Never fatal: the
 * papers are what is read, and the words only help tell a bill from a receipt.
 */
async function emailText(ref: string | null): Promise<string | null> {
  const key = Deno.env.get('RESEND_INBOUND_API_KEY');
  if (!key || !ref || !/^[0-9a-f-]{36}$/i.test(ref)) return null;
  try {
    const got = await fetch(`${RESEND_API}/emails/receiving/${ref}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!got.ok) return null;
    const email = await got.json();
    return email?.text ?? stripHtml(email?.html);
  } catch {
    return null;
  }
}
