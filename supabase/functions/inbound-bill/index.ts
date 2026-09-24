// inbound-bill — a bill forwarded to a project's address becomes a card on it.
//
// Every project has an address, `<token>@bills.snaghq.co.nz`
// (`home.project_inbox_token`). Resend receives the mail and posts
// `email.received` here; this finds the project, checks the sender is somebody
// on that place, stores the PDFs and photographs, asks Gemini what **each
// paper** is, and files a **pending** card per paper (`home.file_emailed_bill`):
// the builder's invoice, the plumber's variation made out to the builder, the
// certificate of compliance and the photos of the deck each get their own, so
// each can be allocated or filed where it belongs. The person opening the
// project answers them. Nothing here reaches a figure: allocating still goes
// through `create_quote`, the one door every price comes through, and filing
// paperwork moves none.
//
// Five rules, each a way this could put something untrue in front of somebody:
//
// - **Only Resend, and only from us.** JWT verification is off because Resend
//   has no Supabase token, so the Svix signature (`verifyWebhook`) is the lock.
//   Past it, only a sender whose sign-in address is on that place is accepted:
//   forwarding is the gesture, and a leaked address must not become a way to
//   put convincing cards in front of somebody.
// - **It answers Resend at once and works afterwards** (`EdgeRuntime.waitUntil`).
//   Reading a PDF takes longer than a webhook waits, and a retried webhook is a
//   second set of cards — which `file_emailed_bill` refuses anyway, by email
//   and part.
// - **One paper, one reading.** A figure or a name on one paper can never be
//   read off another, because the model is only ever shown one (`read.ts`).
// - **What was read is marked, and a guess says so.** The card shows `inferred`
//   fields as guesses, and a paid flag with no sentence behind it is dropped.
// - **A reading that fails still files the card.** The bill arrived; the card
//   holds the PDF and the subject, and the person presses *Read again*
//   (`reread-bill`) or types the rest. A card that silently never appeared
//   would be the worst answer.
//
// Secrets: RESEND_INBOUND_API_KEY (a full-access Resend key — reading received
// mail needs one),
// RESEND_WEBHOOK_SECRET (the webhook's `whsec_…`), GEMINI_API_KEY (shared with
// read-label; optional — without it cards arrive unread). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are the platform's own.
// Deploy: `supabase functions deploy inbound-bill --no-verify-jwt`.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  billAttachments, bytesToBase64, cardFromEmail, cardsFromReadings, emailAddress, inboxToken,
  storedPath, stripHtml, verifyWebhook, type AttachmentMeta, type PaperCard, type StoredPaper,
} from './bill.ts';
import { readPapers, type PaperFile } from './read.ts';

const BUCKET = 'home-photos';
const RESEND_API = 'https://api.resend.com';
// The papers are read together, so this is about one paper's worth of waiting
// with room for the busy-model fallback — inside the platform's limit on
// background work after the webhook has been answered.
const MODEL_BUDGET_MS = 90_000;

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

// deno-lint-ignore no-explicit-any
type Json = any;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Only POST', { status: 405 });

  const body = await req.text();
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
  const genuine = await verifyWebhook(secret, {
    id: req.headers.get('svix-id'),
    timestamp: req.headers.get('svix-timestamp'),
    signature: req.headers.get('svix-signature'),
  }, body);
  if (!genuine) return new Response('Bad signature', { status: 401 });

  let event: Json;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('Not JSON', { status: 400 });
  }
  if (event?.type !== 'email.received' || !event?.data?.email_id) {
    return new Response('Ignored', { status: 200 });
  }

  EdgeRuntime.waitUntil(file(event.data).catch((err) => console.error('inbound-bill: failed —', err)));
  return new Response('Accepted', { status: 202 });
});

async function file(data: Json): Promise<void> {
  const emailId: string = data.email_id;
  const recipients: string[] = [
    ...(Array.isArray(data.to) ? data.to : []),
    ...(Array.isArray(data.cc) ? data.cc : []),
    ...(Array.isArray(data.received_for) ? data.received_for : []),
  ];
  const token = inboxToken(recipients);
  const sender = emailAddress(data.from);
  if (!token || !sender) {
    console.warn(`inbound-bill: ${emailId} — no project address or no sender`);
    return;
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    db: { schema: 'home' },
    auth: { persistSession: false },
  });

  const { data: rows, error: inboxError } = await db.rpc('inbox_for', { p_token: token, p_from: sender });
  if (inboxError) throw inboxError;
  const inbox = Array.isArray(rows) ? rows[0] : null;
  if (!inbox) {
    console.warn(`inbound-bill: ${emailId} — no project has that address`);
    return;
  }
  if (!inbox.sender_id) {
    // Not somebody on this place. Logged, never filed.
    console.warn(`inbound-bill: ${emailId} — sender is not on project ${inbox.project_id}`);
    return;
  }

  // Its own name, so it cannot be confused with a sending-only key another
  // function holds: reading received mail needs a full-access key.
  const apiKey = Deno.env.get('RESEND_INBOUND_API_KEY');
  if (!apiKey) throw new Error('RESEND_INBOUND_API_KEY is not set');
  const email = await resend(apiKey, `/emails/receiving/${emailId}`);
  const listed = await resend(apiKey, `/emails/receiving/${emailId}/attachments`);
  const metas: (AttachmentMeta & { download_url?: string })[] = Array.isArray(listed?.data) ? listed.data : [];

  const stored: StoredPaper[] = [];
  const forModel: PaperFile[] = [];
  for (const [index, meta] of billAttachments(metas).entries()) {
    const url = (meta as { download_url?: string }).download_url;
    if (!url) continue;
    const got = await fetch(url);
    if (!got.ok) {
      console.warn(`inbound-bill: ${emailId} — attachment ${meta.id} answered ${got.status}`);
      continue;
    }
    const bytes = new Uint8Array(await got.arrayBuffer());
    // `<ms>-<n>-` is the prefix `documentName` strips, so the card shows the
    // file's own name.
    const path = storedPath(inbox.household_id, meta, `${Date.now()}-${index}${Math.round(Math.random() * 1e5)}`);
    const { error: uploadError } = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: meta.content_type ?? undefined,
      upsert: false,
    });
    if (uploadError) {
      console.warn(`inbound-bill: ${emailId} — could not store ${meta.id}:`, uploadError.message);
      continue;
    }
    stored.push({ path, isPdf: meta.content_type === 'application/pdf' });
    forModel.push({
      mimeType: meta.content_type!,
      base64: bytesToBase64(bytes),
      name: meta.filename ?? (meta.content_type === 'application/pdf' ? 'a PDF' : 'a photo'),
    });
  }

  // Who "you" are, so a subcontractor's bill made out to the builder is told
  // from one made out to the household. Never fatal: without it every paper is
  // simply taken as the household's, which is what it always was.
  const { data: people } = await db.rpc('project_people', { p_project_id: inbox.project_id });

  const words = {
    from: email?.from ?? data.from ?? null,
    subject: email?.subject ?? data.subject ?? null,
    text: email?.text ?? stripHtml(email?.html),
  };
  const read = await readPapers(
    forModel, words, Array.isArray(people) ? people : [], MODEL_BUDGET_MS, `inbound-bill: ${emailId}`,
  );
  const cards: PaperCard[] = stored.length > 0
    ? cardsFromReadings(stored, read.readings)
    : [cardFromEmail(read.fromEmail)];

  // One card per paper, each filed on its own: the daily ceiling or a bad row
  // stopping the fourth paper must not lose the first three.
  for (const [part, card] of cards.entries()) {
    const { error: fileError } = await db.rpc('file_emailed_bill', {
      p_project_id: inbox.project_id,
      p_sender_id: inbox.sender_id,
      p_source_ref: emailId,
      p_source_subject: words.subject,
      p_source_from: words.from,
      p_source_at: email?.created_at ?? data.created_at ?? null,
      p_supplier: card.supplier,
      p_detail: card.detail,
      p_amount: card.amount,
      p_amount_incl_gst: card.amountInclGst,
      p_invoice_number: card.invoiceNumber,
      p_dated: card.dated,
      p_due_on: card.dueOn,
      p_paid: card.paid,
      p_paid_on: card.paidOn,
      p_paid_evidence: card.paidEvidence,
      p_inferred: card.inferred,
      p_photo_paths: card.photoPaths,
      p_document_paths: card.documentPaths,
      p_source_part: part,
      p_kind: card.kind,
      p_addressed_to: card.addressedTo,
    });
    if (fileError) {
      console.error(`inbound-bill: ${emailId} part ${part} — not filed:`, fileError.message);
      continue;
    }
  }
  console.log(
    `inbound-bill: ${emailId} — ${cards.length} card${cards.length === 1 ? '' : 's'} on project ${inbox.project_id}`
      + (read.busy ? ' (some papers unread: models busy)' : '')
      + (read.notSetUp ? ' (unread: GEMINI_API_KEY missing or refused)' : ''),
  );
}

async function resend(apiKey: string, path: string): Promise<Json> {
  const answer = await fetch(`${RESEND_API}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!answer.ok) throw new Error(`Resend ${path} answered ${answer.status}: ${(await answer.text()).slice(0, 300)}`);
  return answer.json();
}
