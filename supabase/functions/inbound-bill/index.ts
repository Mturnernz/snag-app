// inbound-bill — a bill forwarded to a project's address becomes a card on it.
//
// Every project has an address, `<token>@bills.snaghq.co.nz`
// (`home.project_inbox_token`). Resend receives the mail and posts
// `email.received` here; this finds the project, checks the sender is somebody
// on that place, stores the PDFs and photographs, asks Gemini what the bill says,
// and files a **pending** review (`home.file_emailed_bill`). The person opening
// the project answers it. Nothing here reaches a figure: approving still goes
// through `create_quote`, the one door every price comes through.
//
// Four rules, each a way this could put something untrue in front of somebody:
//
// - **Only Resend, and only from us.** JWT verification is off because Resend
//   has no Supabase token, so the Svix signature (`verifyWebhook`) is the lock.
//   Past it, only a sender whose sign-in address is on that place is accepted:
//   forwarding is the gesture, and a leaked address must not become a way to
//   put convincing cards in front of somebody.
// - **It answers Resend at once and works afterwards** (`EdgeRuntime.waitUntil`).
//   Reading a PDF takes longer than a webhook waits, and a retried webhook is a
//   second card — which `file_emailed_bill` refuses anyway, by email id.
// - **What was read is marked, and a guess says so.** The card shows `inferred`
//   fields as guesses, and a paid flag with no sentence behind it is dropped.
// - **A reading that fails still files the card.** The bill arrived; the card
//   holds the PDF and the subject, and the person types the rest. A card that
//   silently never appeared would be the worst answer.
//
// Secrets: RESEND_INBOUND_API_KEY (a full-access Resend key — reading received
// mail needs one),
// RESEND_WEBHOOK_SECRET (the webhook's `whsec_…`), GEMINI_API_KEY (shared with
// read-label; optional — without it cards arrive unread). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are the platform's own.
// Deploy: `supabase functions deploy inbound-bill --no-verify-jwt`.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  GEMINI_ENDPOINT, isBusy, modelsToTry, readingFromGemini,
} from '../read-label/gemini.ts';
import {
  NOTHING_READ, billAttachments, billRequest, bytesToBase64, emailAddress, inboxToken,
  reviewFromReading, storedPath, verifyWebhook, type AttachmentMeta, type BillFields,
} from './bill.ts';

const BUCKET = 'home-photos';
const RESEND_API = 'https://api.resend.com';
const MODEL_BUDGET_MS = 90_000;
const EARLY_ATTEMPT_MS = 40_000;

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

  const photoPaths: string[] = [];
  const documentPaths: string[] = [];
  const forModel: { mimeType: string; base64: string }[] = [];
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
    (meta.content_type === 'application/pdf' ? documentPaths : photoPaths).push(path);
    forModel.push({ mimeType: meta.content_type!, base64: bytesToBase64(bytes) });
  }

  const fields = await read(forModel, {
    from: email?.from ?? data.from ?? null,
    subject: email?.subject ?? data.subject ?? null,
    text: email?.text ?? stripHtml(email?.html),
  });

  const { error: fileError } = await db.rpc('file_emailed_bill', {
    p_project_id: inbox.project_id,
    p_sender_id: inbox.sender_id,
    p_source_ref: emailId,
    p_source_subject: email?.subject ?? data.subject ?? null,
    p_source_from: email?.from ?? data.from ?? null,
    p_source_at: email?.created_at ?? data.created_at ?? null,
    p_supplier: fields.supplier,
    p_detail: fields.detail,
    p_amount: fields.amount,
    p_amount_incl_gst: fields.amountInclGst,
    p_invoice_number: fields.invoiceNumber,
    p_dated: fields.dated,
    p_due_on: fields.dueOn,
    p_paid: fields.paid,
    p_paid_on: fields.paidOn,
    p_paid_evidence: fields.paidEvidence,
    p_inferred: fields.inferred,
    p_photo_paths: photoPaths,
    p_document_paths: documentPaths,
  });
  if (fileError) throw fileError;
  console.log(`inbound-bill: ${emailId} — filed on project ${inbox.project_id}`);
}

async function resend(apiKey: string, path: string): Promise<Json> {
  const answer = await fetch(`${RESEND_API}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!answer.ok) throw new Error(`Resend ${path} answered ${answer.status}: ${(await answer.text()).slice(0, 300)}`);
  return answer.json();
}

function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** The model's reading, or nothing read — never a reason not to file the card. */
async function read(
  files: { mimeType: string; base64: string }[],
  email: { from: string | null; subject: string | null; text: string | null }
): Promise<BillFields> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey || (files.length === 0 && !email.text)) return NOTHING_READ;

  const models = modelsToTry(Deno.env.get('GEMINI_MODEL'), Deno.env.get('GEMINI_FALLBACK_MODEL'));
  const body = JSON.stringify(billRequest(files, email));
  const deadline = Date.now() + MODEL_BUDGET_MS;

  for (const [index, model] of models.entries()) {
    const left = deadline - Date.now();
    if (left < 10_000) break;
    const last = index === models.length - 1;
    try {
      const answer = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: AbortSignal.timeout(last ? left : Math.min(left, EARLY_ATTEMPT_MS)),
      });
      if (!answer.ok) {
        console.error(`inbound-bill: ${model} ${answer.status}:`, (await answer.text()).slice(0, 300));
        if (isBusy(answer.status)) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
        return NOTHING_READ;
      }
      const outcome = readingFromGemini(await answer.json().catch(() => null));
      if (!outcome.ok) {
        console.error('inbound-bill: no reading —', outcome.reason);
        return NOTHING_READ;
      }
      return reviewFromReading(outcome.reading);
    } catch (err) {
      console.error(`inbound-bill: ${model} unreachable or too slow:`, err);
    }
  }
  return NOTHING_READ;
}
