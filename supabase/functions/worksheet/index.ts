// worksheet: generates a fillable (AcroForm) PDF worksheet for completing
// an RCA or a formal debrief on paper / in a PDF reader. Stores nothing on
// generation except an audit_log row. The companion worksheet-import
// function reads the typed fields back in.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const KIND_LABELS: Record<string, string> = {
  hazard: "Hazard",
  incident: "Incident",
};

// pdf-lib's standard fonts are WinAnsi (CP1252) only. One character outside it
// throws mid-render and the whole export fails with no partial output — which
// is how a single "→" in our own footer broke every worksheet.
//
// It is reachable from ordinary use, not just from our strings: descriptions,
// witness names and site names are user text. On a New Zealand site that
// includes macrons, which are Latin Extended-A and NOT in CP1252 — so a snag
// mentioning Manukau with its macron would have failed the same way.
//
// Transliterate what has an obvious ASCII equivalent, drop the rest to "?".
// Lossy, deliberately: a slightly wrong character beats no document at all for
// something a regulator may ask to see. Embedding a Unicode font via fontkit
// would fix it properly and is the real answer if this ever matters more.
const PDF_TEXT_REPLACEMENTS: Record<string, string> = {
  "\u2192": "->", "\u2190": "<-", "\u2022": "-", "\u2265": ">=", "\u2264": "<=",
  "\u0101": "a", "\u0113": "e", "\u012b": "i", "\u014d": "o", "\u016b": "u",
  "\u0100": "A", "\u0112": "E", "\u012a": "I", "\u014c": "O", "\u016a": "U",
};

function pdfSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    const mapped = PDF_TEXT_REPLACEMENTS[ch];
    if (mapped !== undefined) { out += mapped; continue; }
    const code = ch.codePointAt(0)!;
    // Latin-1 plus the typographic characters CP1252 puts in 0x80-0x9F.
    out += code <= 0xff || "\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u20ac\u2122\u0160\u0161\u017d\u017e\u0152\u0153".includes(ch) ? ch : "?";
  }
  return out;
}

// `String.fromCharCode(...bytes)` spreads every byte as an argument, and a
// worksheet PDF is tens of kilobytes of AcroForm — past the engine's argument
// limit, which throws RangeError and surfaces as a bare 500 *after* the PDF has
// been built. Chunked instead, so size stops being a cliff.
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// CORS. See export-investigation: the browser preflights any invoke carrying an
// Authorization header, and a function that answers OPTIONS with 405 never
// receives the POST at all.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// An unhandled throw returns the platform's own 500, which carries no CORS
// headers — so in a browser it surfaces as a CORS failure and the real error is
// never seen. Everything below runs inside this, so a fault comes back as a
// readable 500 instead.
Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (err) {
    console.error("worksheet failed:", err);
    return new Response(`Worksheet generation failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500, headers: CORS_HEADERS });
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }

  const { snag_id, kind } = (await req.json()) as { snag_id: string; kind: "rca" | "debrief" };
  if (!snag_id || (kind !== "rca" && kind !== "debrief")) {
    return new Response("snag_id and kind ('rca' or 'debrief') are required", { status: 400, headers: CORS_HEADERS });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // Scoped to the caller. Unfiltered, this is every profile RLS lets the caller
  // see; maybeSingle() then gets more than one row and returns null, so any
  // organisation with more than one member failed the guard below.
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }
  const { data: profile } = await userClient
    .from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }

  // RLS scopes this read; null means no access.
  const { data: snag } = await userClient.from("snags").select("*").eq("id", snag_id).maybeSingle();
  if (!snag) {
    return new Response("Snag not found", { status: 404, headers: CORS_HEADERS });
  }
  if (snag.lane !== "serious") {
    return new Response("Only hazard/incident snags have worksheets", { status: 400, headers: CORS_HEADERS });
  }

  const supervisorish = profile.role === "supervisor" || profile.role === "officer_admin";

  // Permission mirrors the RPCs: RCA worksheet for the assignee or a
  // supervisor/admin; debrief worksheet for supervisor/admin only.
  const { data: rca } = await userClient
    .from("snag_rca")
    .select("*")
    .eq("snag_id", snag_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (kind === "rca") {
    const isAssignee = rca?.assigned_to === profile.id;
    if (!isAssignee && !supervisorish) {
      return new Response("Only the RCA assignee, a supervisor or an admin can get this worksheet", { status: 403, headers: CORS_HEADERS });
    }
  } else if (!supervisorish) {
    return new Response("Only a supervisor or admin can get a debrief worksheet", { status: 403, headers: CORS_HEADERS });
  }

  const { data: site } = await userClient.from("sites").select("name").eq("id", snag.site_id).maybeSingle();
  const { data: assigneeProfile } = rca
    ? await userClient.from("profiles").select("name").eq("id", rca.assigned_to).maybeSingle()
    : { data: null };

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = pdf.getForm();

  let page = pdf.addPage([595, 842]);
  const left = 50;
  const width = 495;
  let y = 800;

  function text(t: string, size = 10, isBold = false) {
    page.drawText(pdfSafe(t), { x: left, y, size, font: isBold ? bold : font, color: rgb(0, 0, 0) });
    y -= size + 6;
  }

  function labelledField(name: string, label: string, height: number, multiline: boolean) {
    if (y - height - 24 < 50) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
    page.drawText(pdfSafe(label), { x: left, y, size: 9, font: bold, color: rgb(0.25, 0.25, 0.25) });
    y -= 14;
    const field = form.createTextField(name);
    if (multiline) field.enableMultiline();
    field.addToPage(page, {
      x: left, y: y - height, width, height,
      borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1,
    });
    // setFontSize needs the /DA appearance entry the widget creates —
    // calling it before addToPage throws MissingDAEntryError.
    field.setFontSize(10);
    y -= height + 12;
  }

  // Header (read-only text)
  const title = kind === "rca" ? "Root Cause Analysis worksheet (5 Whys)" : "Formal debrief worksheet";
  text(`Snag — ${title}`, 16, true);
  text(`${snag.reference} · ${KIND_LABELS[snag.kind] ?? snag.kind}${snag.severity ? ` (${snag.severity})` : ""}${snag.is_notifiable ? " · NOTIFIABLE" : ""}`, 11, true);
  if (snag.description) {
    const desc = snag.description.length > 180 ? snag.description.slice(0, 180) + "…" : snag.description;
    text(desc, 10);
  }
  text(`Site: ${site?.name ?? "—"} · Generated: ${new Date().toLocaleDateString()}${
    kind === "rca" && assigneeProfile ? ` · Assigned to: ${assigneeProfile.name}` : ""
  }`, 9);
  y -= 6;

  // Machine-readable identity fields (read-only, small): parsing on
  // re-upload is deterministic and mismatched uploads can be refused.
  const idField = form.createTextField("snag_id");
  idField.setText(pdfSafe(snag.id));
  idField.enableReadOnly();
  idField.addToPage(page, { x: left, y: y - 10, width: 260, height: 10, borderWidth: 0 });
  idField.setFontSize(6);
  const kindField = form.createTextField("worksheet_kind");
  kindField.setText(kind);
  kindField.enableReadOnly();
  kindField.addToPage(page, { x: left + 270, y: y - 10, width: 80, height: 10, borderWidth: 0 });
  kindField.setFontSize(6);
  y -= 26;

  if (kind === "rca") {
    for (let i = 1; i <= 5; i++) {
      labelledField(`why_${i}`, `Why ${i}`, 22, false);
      labelledField(`answer_${i}`, `Because…`, 54, true);
    }
    labelledField("completed_by", "Completed by (name)", 22, false);
    labelledField("completed_date", "Date", 22, false);
  } else {
    for (let i = 1; i <= 6; i++) {
      labelledField(`finding_${i}`, `Finding ${i}`, 40, true);
    }
    for (let i = 1; i <= 6; i++) {
      labelledField(`lesson_${i}`, `Lesson learned ${i}`, 30, true);
    }
    for (let i = 1; i <= 8; i++) {
      labelledField(`attendee_${i}`, `Attendee ${i} (name)`, 18, false);
    }
    labelledField("facilitator", "Facilitator (name)", 22, false);
    labelledField("date", "Date", 22, false);
  }

  // Signature box (drawn, for pen)
  if (y - 90 < 50) {
    page = pdf.addPage([595, 842]);
    y = 800;
  }
  page.drawText("Signature", { x: left, y, size: 9, font: bold, color: rgb(0.25, 0.25, 0.25) });
  y -= 14;
  page.drawRectangle({
    x: left, y: y - 60, width: 260, height: 60,
    borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1,
  });
  y -= 74;

  page.drawText(
    pdfSafe("Return this worksheet: open the snag in Snag -> Upload completed worksheet."),
    { x: left, y: Math.max(y, 30), size: 9, font, color: rgb(0.4, 0.4, 0.4) }
  );

  const bytes = await pdf.save();

  // Audit only — nothing else is stored on generation.
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  await serviceClient.from("audit_log").insert({
    org_id: snag.org_id,
    entity: "snag",
    entity_id: snag.id,
    action: `worksheet_generated_${kind}`,
    actor_id: profile.id,
  });

  const base64 = toBase64(bytes);
  return new Response(
    JSON.stringify({ filename: `${snag.reference}-${kind}-worksheet.pdf`, pdfBase64: base64 }),
    { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
}
