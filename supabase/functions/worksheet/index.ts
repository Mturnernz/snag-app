// worksheet: a fillable (AcroForm) PDF for completing an RCA or a formal
// debrief on paper or in a PDF reader. Stores nothing on generation except an
// audit_log row; worksheet-import reads the typed fields back in, so the field
// NAMES here are a contract with that function — do not rename them.
// Layout follows the same brief as export-investigation; see its render.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Mirrors get_my_memberships() — the caller's org and role as org_memberships
// records them. See packages/supabase-queries' Membership.
interface Membership {
  org_id: string;
  org_name: string;
  role: string;
  is_active: boolean;
  org_active: boolean;
}

const KIND_LABELS: Record<string, string> = { hazard: "Hazard", incident: "Incident" };
const SEVERITY_LABELS: Record<string, string> = {
  minor: "Minor", moderate: "Moderate", injury: "Injury", critical: "Critical",
};

const BRAND = rgb(0.145, 0.388, 0.922);
const INK = rgb(0.067, 0.094, 0.153);
const MUTED = rgb(0.42, 0.447, 0.502);
const RULE = rgb(0.898, 0.906, 0.922);
const FIELD_RULE = rgb(0.78, 0.80, 0.84);
const SERIOUS = rgb(0.863, 0.149, 0.149);
const SERIOUS_BG = rgb(0.996, 0.886, 0.886);
const WHITE = rgb(1, 1, 1);
const BRAND_TINT = rgb(0.85, 0.9, 1);

const PAGE_W = 595, PAGE_H = 842;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const MASTHEAD_H = 92;
const FOOTER_Y = 38;
const BOTTOM_LIMIT = 66;

const PDF_TEXT_REPLACEMENTS: Record<string, string> = {
  "→": "->", "←": "<-", "•": "-", "≥": ">=", "≤": "<=",
  "ā": "a", "ē": "e", "ī": "i", "ō": "o", "ū": "u",
  "Ā": "A", "Ē": "E", "Ī": "I", "Ō": "O", "Ū": "U",
};
function pdfSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    const mapped = PDF_TEXT_REPLACEMENTS[ch];
    if (mapped !== undefined) { out += mapped; continue; }
    const code = ch.codePointAt(0)!;
    out += code <= 0xff || "‘’“”–—…€™".includes(ch) ? ch : "?";
  }
  return out;
}
function wrapToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of pdfSafe(text).split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) { lines.push(line); line = word; }
      else line = candidate;
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

// String.fromCharCode(...bytes) spreads every byte as an argument and blows the
// engine's limit on a PDF of any size — chunked so size stops being a cliff.
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (err) {
    console.error("worksheet failed:", err);
    return new Response("Worksheet generation failed: " + (err instanceof Error ? err.message : String(err)),
      { status: 500, headers: CORS_HEADERS });
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });

  const { snag_id, kind } = (await req.json()) as { snag_id: string; kind: "rca" | "debrief" };
  if (!snag_id || (kind !== "rca" && kind !== "debrief")) {
    return new Response("snag_id and kind ('rca' or 'debrief') are required", { status: 400, headers: CORS_HEADERS });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  // Role comes from the membership RPC, never from `profiles`. That table is
  // self-writable by design (a user renames themselves), so its `role` column
  // is not an authorisation input — org_memberships is, and get_my_memberships
  // is what reads it. Gating on profiles.role here meant a worker could PATCH
  // their own row and be treated as `supervisorish` below.
  const { data: memberships } = await userClient.rpc("get_my_memberships");
  const active = ((memberships ?? []) as Membership[])
    .find((m) => m.is_active && m.org_active);
  if (!active) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });

  const { data: snag } = await userClient.from("snags").select("*").eq("id", snag_id).maybeSingle();
  if (!snag) return new Response("Snag not found", { status: 404, headers: CORS_HEADERS });
  if (snag.lane !== "serious") {
    return new Response("Only hazard/incident snags have worksheets", { status: 400, headers: CORS_HEADERS });
  }

  const supervisorish = active.role === "supervisor" || active.role === "officer_admin";
  const { data: rca } = await userClient.from("snag_rca").select("*")
    .eq("snag_id", snag_id).order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (kind === "rca") {
    if (rca?.assigned_to !== user.id && !supervisorish) {
      return new Response("Only the RCA assignee, a supervisor or an admin can get this worksheet", { status: 403, headers: CORS_HEADERS });
    }
  } else if (!supervisorish) {
    return new Response("Only a supervisor or admin can get a debrief worksheet", { status: 403, headers: CORS_HEADERS });
  }

  const [siteRes, orgRes, assigneeRes] = await Promise.all([
    userClient.from("sites").select("name").eq("id", snag.site_id).maybeSingle(),
    userClient.from("organisations").select("name").eq("id", snag.org_id).maybeSingle(),
    rca?.assigned_to
      ? userClient.from("profiles").select("name").eq("id", rca.assigned_to).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const siteName = siteRes.data?.name ?? "";
  const orgName = orgRes.data?.name ?? "";
  const assigneeName = assigneeRes.data?.name ?? "";

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = pdf.getForm();
  const docType = kind === "rca" ? "Root cause analysis worksheet" : "Formal debrief worksheet";

  let page: PDFPage;
  let y = 0;
  let pageIndex = 0;

  function startPage() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pageIndex += 1;
    if (pageIndex === 1) {
      // The organisation owns this document; SNAG produced it.
      page.drawRectangle({ x: 0, y: PAGE_H - MASTHEAD_H, width: PAGE_W, height: MASTHEAD_H, color: BRAND });
      const ident = pdfSafe(snag.reference);
      const identW = bold.widthOfTextAtSize(ident, 18);
      const orgText = pdfSafe(orgName || "Investigation worksheet");
      let orgSize = 22;
      while (orgSize > 12 && bold.widthOfTextAtSize(orgText, orgSize) > CONTENT_W - identW - 30) orgSize -= 1;
      page.drawText(orgText, { x: MARGIN, y: PAGE_H - 48, size: orgSize, font: bold, color: WHITE });
      page.drawText(docType, { x: MARGIN, y: PAGE_H - 68, size: 10, font, color: BRAND_TINT });
      page.drawText(ident, { x: PAGE_W - MARGIN - identW, y: PAGE_H - 56, size: 18, font: bold, color: WHITE });
      y = PAGE_H - MASTHEAD_H - 30;
    } else {
      const run = pdfSafe((orgName ? orgName + "  ·  " : "") + docType + "  ·  " + snag.reference);
      page.drawText(run, { x: MARGIN, y: PAGE_H - 40, size: 8, font, color: MUTED });
      page.drawLine({ start: { x: MARGIN, y: PAGE_H - 50 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - 50 }, thickness: 0.75, color: RULE });
      y = PAGE_H - 74;
    }
  }
  function need(space: number) { if (y - space < BOTTOM_LIMIT) startPage(); }

  function sectionHeading(text: string) {
    need(48);
    y -= 12;
    page.drawText(pdfSafe(text.toUpperCase()), { x: MARGIN, y, size: 9.5, font: bold, color: BRAND });
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.75, color: RULE });
    y -= 16;
  }
  function body(text: string, size = 10, color = INK) {
    for (const line of wrapToWidth(text, font, size, CONTENT_W)) {
      need(size + 5);
      page.drawText(line, { x: MARGIN, y, size, font, color });
      y -= size + 4;
    }
  }
  function labelledField(name: string, label: string, height: number, multiline: boolean) {
    need(height + 30);
    page.drawText(pdfSafe(label), { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
    y -= 13;
    const field = form.createTextField(name);
    if (multiline) field.enableMultiline();
    field.addToPage(page, {
      x: MARGIN, y: y - height, width: CONTENT_W, height,
      borderColor: FIELD_RULE, borderWidth: 0.75,
    });
    // setFontSize needs the /DA appearance entry the widget creates — calling
    // it before addToPage throws MissingDAEntryError.
    field.setFontSize(10);
    y -= height + 14;
  }

  startPage();

  // Context strip: what this worksheet is about, before anyone writes on it.
  const meta = pdfSafe(
    (KIND_LABELS[snag.kind] ?? snag.kind) +
    (snag.severity ? "  ·  " + (SEVERITY_LABELS[snag.severity] ?? snag.severity) : "") +
    (siteName ? "  ·  " + siteName : "") +
    "  ·  Generated " + new Date().toLocaleDateString() +
    (kind === "rca" && assigneeName ? "  ·  Assigned to " + assigneeName : ""));
  page.drawText(meta, { x: MARGIN, y, size: 9, font, color: MUTED });
  y -= 16;

  if (snag.description) {
    const desc = snag.description.length > 220 ? snag.description.slice(0, 220) + "…" : snag.description;
    body(desc, 10, INK);
    y -= 2;
  }

  if (snag.is_notifiable) {
    need(34);
    page.drawRectangle({ x: MARGIN, y: y - 20, width: CONTENT_W, height: 24, color: SERIOUS_BG });
    page.drawRectangle({ x: MARGIN, y: y - 20, width: 3.5, height: 24, color: SERIOUS });
    page.drawText("NOTIFIABLE EVENT", { x: MARGIN + 12, y: y - 12, size: 9, font: bold, color: SERIOUS });
    y -= 34;
  }

  // Machine-readable identity, read-only and small: re-upload parsing is then
  // deterministic and a worksheet returned against the wrong snag is refused.
  const idField = form.createTextField("snag_id");
  idField.setText(pdfSafe(snag.id));
  idField.enableReadOnly();
  idField.addToPage(page, { x: MARGIN, y: y - 9, width: 250, height: 9, borderWidth: 0 });
  idField.setFontSize(6);
  const kindField = form.createTextField("worksheet_kind");
  kindField.setText(kind);
  kindField.enableReadOnly();
  kindField.addToPage(page, { x: MARGIN + 260, y: y - 9, width: 80, height: 9, borderWidth: 0 });
  kindField.setFontSize(6);
  y -= 20;

  if (kind === "rca") {
    sectionHeading("Five whys");
    for (let i = 1; i <= 5; i++) {
      labelledField("why_" + i, "WHY " + i, 22, false);
      labelledField("answer_" + i, "BECAUSE", 52, true);
    }
    sectionHeading("Completed by");
    labelledField("completed_by", "NAME", 22, false);
    labelledField("completed_date", "DATE", 22, false);
  } else {
    sectionHeading("Findings");
    for (let i = 1; i <= 6; i++) labelledField("finding_" + i, "FINDING " + i, 38, true);
    sectionHeading("Lessons learned");
    for (let i = 1; i <= 6; i++) labelledField("lesson_" + i, "LESSON " + i, 30, true);
    sectionHeading("Attendees");
    for (let i = 1; i <= 8; i++) labelledField("attendee_" + i, "ATTENDEE " + i, 18, false);
    sectionHeading("Facilitator");
    labelledField("facilitator", "NAME", 22, false);
    labelledField("date", "DATE", 22, false);
  }

  // Signature box, drawn rather than a field — this one is for a pen.
  need(96);
  page.drawText("SIGNATURE", { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  y -= 14;
  page.drawRectangle({ x: MARGIN, y: y - 58, width: 260, height: 58, borderColor: FIELD_RULE, borderWidth: 0.75 });
  y -= 72;
  body("Return this worksheet: open the snag in Snag, then Upload completed worksheet.", 9, MUTED);

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: FOOTER_Y + 14 }, end: { x: PAGE_W - MARGIN, y: FOOTER_Y + 14 }, thickness: 0.75, color: RULE });
    p.drawText(pdfSafe((orgName ? orgName + "  ·  " : "") + snag.reference), { x: MARGIN, y: FOOTER_Y, size: 8, font, color: MUTED });
    const mid = pdfSafe(docType);
    p.drawText(mid, { x: (PAGE_W - font.widthOfTextAtSize(mid, 8)) / 2, y: FOOTER_Y, size: 8, font, color: MUTED });
    const num = "Page " + (i + 1) + " of " + pages.length;
    p.drawText(num, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(num, 8), y: FOOTER_Y, size: 8, font, color: MUTED });
  });

  const bytes = await pdf.save();

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  await serviceClient.from("audit_log").insert({
    org_id: snag.org_id, entity: "snag", entity_id: snag.id,
    action: "worksheet_generated_" + kind, actor_id: user.id,
  });

  return new Response(
    JSON.stringify({ filename: snag.reference + "-" + kind + "-worksheet.pdf", pdfBase64: toBase64(bytes) }),
    { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
}
