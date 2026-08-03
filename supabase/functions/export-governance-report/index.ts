// export-governance-report: a periodic due-diligence PDF an officer can keep
// on file, restricted to officer_admin. Source of truth is this file — redeploy
// via Supabase MCP. Layout follows the same brief as export-investigation; see
// export-investigation/render.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STATUS_LABELS: Record<string, string> = {
  flagged: "Flagged", in_progress: "In progress", resolved: "Resolved", rca_pending: "RCA pending",
};
const KIND_LABELS: Record<string, string> = {
  fixit: "Fix-it", improvement: "Improvement", hazard: "Hazard", incident: "Incident",
};
const SEVERITY_LABELS: Record<string, string> = {
  minor: "Minor", moderate: "Moderate", injury: "Injury", critical: "Critical",
};

// Design tokens, mirroring apps/mobile/src/constants/theme.ts.
const BRAND = rgb(0.145, 0.388, 0.922);
const INK = rgb(0.067, 0.094, 0.153);
const SECONDARY = rgb(0.294, 0.333, 0.388);
const MUTED = rgb(0.42, 0.447, 0.502);
const RULE = rgb(0.898, 0.906, 0.922);
const SERIOUS = rgb(0.863, 0.149, 0.149);
const WHITE = rgb(1, 1, 1);
const BRAND_TINT = rgb(0.85, 0.9, 1);
const TINT = rgb(0.976, 0.98, 0.984);

const PAGE_W = 595, PAGE_H = 842;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const MASTHEAD_H = 92;
const FOOTER_Y = 38;
const BOTTOM_LIMIT = 62;

// pdf-lib's standard fonts are WinAnsi (CP1252) only; one character outside it
// throws mid-render and the whole export fails. Organisation and site names are
// user text, and on a New Zealand site that includes macrons, which are Latin
// Extended-A and not in CP1252.
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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (err) {
    console.error("export-governance-report failed:", err);
    return new Response("Report generation failed: " + (err instanceof Error ? err.message : String(err)),
      { status: 500, headers: CORS_HEADERS });
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });

  const body = (await req.json().catch(() => ({}))) as { period_start?: string; period_end?: string };
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // Scoped to the caller: unfiltered, this is every profile RLS lets them see,
  // and maybeSingle() then returns null for any org with more than one member.
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  const { data: profile } = await userClient
    .from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "officer_admin") {
    return new Response("Only an admin can export the governance report", { status: 403, headers: CORS_HEADERS });
  }

  const isoDate = (d: Date) => d.toISOString().slice(0, 10);
  const periodEnd = body.period_end ?? isoDate(new Date());
  const periodStart = body.period_start ?? isoDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));

  const [orgRes, statsRes, breakdownRes, notifiableRes] = await Promise.all([
    userClient.from("organisations").select("name").eq("id", profile.org_id).maybeSingle(),
    userClient.rpc("get_org_stats", { p_org_id: profile.org_id }),
    userClient.rpc("get_site_breakdown", { p_org_id: profile.org_id }),
    userClient.from("snags").select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id).eq("is_notifiable", true)
      .gte("notifiable_marked_at", periodStart).lte("notifiable_marked_at", periodEnd),
  ]);

  const orgName = orgRes.data?.name ?? "Your organisation";
  const stats = statsRes.data as {
    total_snags: number; total_members: number;
    by_status: Record<string, number>; by_kind: Record<string, number>; by_severity: Record<string, number>;
  } | null;
  const breakdown = (breakdownRes.data ?? []) as Array<{
    site_name: string; open_investigations: number; unassigned: number;
    overdue_actions: number; rca_outstanding: number;
  }>;
  const notifiableInPeriod = notifiableRes.count ?? 0;
  if (!stats) return new Response("Could not load organisation stats", { status: 500, headers: CORS_HEADERS });

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage;
  let y = 0;
  let pageIndex = 0;

  function startPage() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pageIndex += 1;
    if (pageIndex === 1) {
      // The organisation owns this document; SNAG produced it. Company name is
      // the wordmark.
      page.drawRectangle({ x: 0, y: PAGE_H - MASTHEAD_H, width: PAGE_W, height: MASTHEAD_H, color: BRAND });
      const ident = pdfSafe(periodEnd);
      const identW = bold.widthOfTextAtSize(ident, 16);
      const orgText = pdfSafe(orgName);
      let orgSize = 22;
      while (orgSize > 12 && bold.widthOfTextAtSize(orgText, orgSize) > CONTENT_W - identW - 30) orgSize -= 1;
      page.drawText(orgText, { x: MARGIN, y: PAGE_H - 48, size: orgSize, font: bold, color: WHITE });
      page.drawText("Governance report", { x: MARGIN, y: PAGE_H - 68, size: 10, font, color: BRAND_TINT });
      page.drawText("AS AT", {
        x: PAGE_W - MARGIN - bold.widthOfTextAtSize("AS AT", 8), y: PAGE_H - 40, size: 8, font: bold, color: BRAND_TINT,
      });
      page.drawText(ident, { x: PAGE_W - MARGIN - identW, y: PAGE_H - 60, size: 16, font: bold, color: WHITE });
      y = PAGE_H - MASTHEAD_H - 34;
    } else {
      const run = pdfSafe(orgName + "  ·  Governance report  ·  " + periodStart + " to " + periodEnd);
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
    y -= 17;
  }
  function body(text: string, opts: { size?: number; color?: ReturnType<typeof rgb>; indent?: number } = {}) {
    const size = opts.size ?? 10;
    const indent = opts.indent ?? 0;
    for (const line of wrapToWidth(text, font, size, CONTENT_W - indent)) {
      need(size + 5);
      page.drawText(line, { x: MARGIN + indent, y, size, font, color: opts.color ?? INK });
      y -= size + 4;
    }
  }
  /** Label left, figure right — a report reads as rows, not sentences. */
  function statRow(label: string, value: string | number, alert = false) {
    need(20);
    page.drawText(pdfSafe(label), { x: MARGIN + 4, y, size: 10, font, color: SECONDARY });
    const v = String(value);
    page.drawText(v, {
      x: PAGE_W - MARGIN - 4 - bold.widthOfTextAtSize(v, 10), y, size: 10, font: bold,
      color: alert && Number(value) > 0 ? SERIOUS : INK,
    });
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: RULE });
    y -= 12;
  }
  function metaCell(label: string, value: string, x: number, top: number, width: number) {
    page.drawText(pdfSafe(label.toUpperCase()), { x, y: top, size: 7.5, font: bold, color: MUTED });
    const lines = wrapToWidth(value || "—", font, 10, width).slice(0, 2);
    let ly = top - 14;
    for (const line of lines) { page.drawText(line, { x, y: ly, size: 10, font, color: INK }); ly -= 13; }
    return top - 14 - lines.length * 13;
  }

  startPage();

  const colW = (CONTENT_W - 24) / 2;
  const rightX = MARGIN + colW + 24;
  let leftY = y, rightY = y;
  leftY = metaCell("Period", periodStart + " to " + periodEnd, MARGIN, leftY, colW);
  rightY = metaCell("Generated", new Date().toLocaleString(), rightX, rightY, colW);
  leftY = metaCell("Snags on record", String(stats.total_snags), MARGIN, leftY - 8, colW);
  rightY = metaCell("Members", String(stats.total_members), rightX, rightY - 8, colW);
  y = Math.min(leftY, rightY) - 14;

  body("A due-diligence artefact summarising open risk and resourcing for the period above. Not a " +
    "substitute for legal advice on officer due-diligence obligations under HSWA.",
    { size: 9, color: MUTED });

  sectionHeading("Notifiable events");
  statRow("Flagged as notifiable in this period", notifiableInPeriod, true);

  sectionHeading("Snags by status");
  for (const [key, label] of Object.entries(STATUS_LABELS)) statRow(label, stats.by_status[key] ?? 0);

  sectionHeading("Snags by type");
  for (const [key, label] of Object.entries(KIND_LABELS)) statRow(label, stats.by_kind[key] ?? 0);

  sectionHeading("Snags by severity");
  for (const [key, label] of Object.entries(SEVERITY_LABELS)) {
    statRow(label, stats.by_severity[key] ?? 0, key === "injury" || key === "critical");
  }

  sectionHeading("Outstanding work by site");
  if (breakdown.length === 0) {
    body("No sites recorded.", { color: MUTED });
  } else {
    // A real table: the four numbers a manager is accountable for, per site.
    const cols = [CONTENT_W - 300, 78, 74, 74, 74];
    const xs: number[] = [];
    let cx = MARGIN;
    for (const w of cols) { xs.push(cx); cx += w; }
    const headers = ["Site", "Open inv.", "Unassigned", "RCA due", "Overdue"];
    need(30);
    page.drawRectangle({ x: MARGIN, y: y - 6, width: CONTENT_W, height: 20, color: TINT });
    headers.forEach((h, i) => {
      const size = 7.5;
      const x = i === 0 ? xs[i] + 4 : xs[i] + cols[i] - 4 - bold.widthOfTextAtSize(h.toUpperCase(), size);
      page.drawText(h.toUpperCase(), { x, y, size, font: bold, color: MUTED });
    });
    y -= 20;
    for (const s of breakdown) {
      need(20);
      const cells = [s.open_investigations, s.unassigned, s.rca_outstanding, s.overdue_actions];
      page.drawText(pdfSafe(s.site_name), { x: xs[0] + 4, y, size: 10, font, color: INK });
      cells.forEach((n, i) => {
        const v = String(n ?? 0);
        const alert = (i === 2 || i === 3) && Number(n) > 0;
        page.drawText(v, {
          x: xs[i + 1] + cols[i + 1] - 4 - bold.widthOfTextAtSize(v, 10), y, size: 10, font: bold,
          color: alert ? SERIOUS : INK,
        });
      });
      y -= 8;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: RULE });
      y -= 12;
    }
  }

  const pages = pdf.getPages();
  const generated = "Generated " + new Date().toLocaleString();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: FOOTER_Y + 14 }, end: { x: PAGE_W - MARGIN, y: FOOTER_Y + 14 }, thickness: 0.75, color: RULE });
    p.drawText(pdfSafe(orgName + "  ·  Governance report"), { x: MARGIN, y: FOOTER_Y, size: 8, font, color: MUTED });
    const mid = pdfSafe(generated);
    p.drawText(mid, { x: (PAGE_W - font.widthOfTextAtSize(mid, 8)) / 2, y: FOOTER_Y, size: 8, font, color: MUTED });
    const num = "Page " + (i + 1) + " of " + pages.length;
    p.drawText(num, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(num, 8), y: FOOTER_Y, size: 8, font, color: MUTED });
  });

  const bytes = await pdf.save();
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const filePath = profile.org_id + "/" + Date.now() + ".pdf";
  const { error: uploadError } = await serviceClient.storage
    .from("governance-reports").upload(filePath, bytes, { contentType: "application/pdf" });
  if (uploadError) return new Response("Upload failed: " + uploadError.message, { status: 500, headers: CORS_HEADERS });

  const { error: recordError } = await userClient.rpc("record_governance_export", {
    p_file_path: filePath, p_period_start: periodStart, p_period_end: periodEnd,
  });
  if (recordError) return new Response("Could not record export: " + recordError.message, { status: 500, headers: CORS_HEADERS });

  const { data: signed } = await serviceClient.storage
    .from("governance-reports").createSignedUrl(filePath, 3600);

  return new Response(JSON.stringify({ path: filePath, signedUrl: signed?.signedUrl }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
