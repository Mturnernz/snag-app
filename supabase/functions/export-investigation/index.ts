// export-investigation: the defensible record for a serious snag as a PDF.
// Source of truth is this file — redeploy via Supabase MCP. Layout notes and
// the colour mapping back to the app's design tokens are in render.md.
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

const KIND_LABELS: Record<string, string> = {
  fixit: "Fix-it", improvement: "Improvement", hazard: "Hazard", incident: "Incident",
};
const SEVERITY_LABELS: Record<string, string> = {
  minor: "Minor", moderate: "Moderate", injury: "Injury", critical: "Critical",
};
const STATUS_LABELS: Record<string, string> = {
  flagged: "Flagged", in_progress: "In progress", resolved: "Resolved", rca_pending: "RCA pending",
};
const STEP_LABELS: Record<string, string> = {
  make_safe: "Made the area safe",
  preserve_scene: "Preserved the scene",
  capture_evidence: "Captured evidence",
  identify_witnesses: "Identified witnesses",
  find_root_cause: "Found the root cause",
};
const RCA_STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned", in_progress: "In progress", submitted: "Submitted, awaiting review",
  accepted: "Accepted", rejected: "Sent back for another look", cancelled: "Cancelled",
};
const DEBRIEF_FORMAT_LABELS: Record<string, string> = {
  hot: "Hot debrief", formal: "Formal debrief",
};

// Design tokens, mirroring apps/mobile/src/constants/theme.ts so the artefact
// and the app read as one product. See render.md.
const BRAND = rgb(0.145, 0.388, 0.922);      // #2563EB
const INK = rgb(0.067, 0.094, 0.153);        // #111827
const SECONDARY = rgb(0.294, 0.333, 0.388);  // #4B5563
const MUTED = rgb(0.42, 0.447, 0.502);       // #6B7280
const RULE = rgb(0.898, 0.906, 0.922);       // #E5E7EB
const SERIOUS = rgb(0.863, 0.149, 0.149);    // #DC2626
const SERIOUS_BG = rgb(0.996, 0.886, 0.886); // #FEE2E2
const WHITE = rgb(1, 1, 1);
const BRAND_TINT = rgb(0.85, 0.9, 1);

const PAGE_W = 595, PAGE_H = 842;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const MASTHEAD_H = 92;
const FOOTER_Y = 38;
const BOTTOM_LIMIT = 62;

// pdf-lib's standard fonts are WinAnsi (CP1252) only. One character outside it
// throws mid-render and the whole export fails with no partial output.
//
// Reachable from ordinary use: descriptions, witness statements and names are
// all user text. On a New Zealand site that includes macrons, which are Latin
// Extended-A and NOT in CP1252 — a statement mentioning a place name with a
// macron would have failed the export entirely.
//
// Transliterate what has an obvious ASCII equivalent, drop the rest to "?".
// Lossy, deliberately: a slightly wrong character beats no document at all for
// something a regulator may ask to see.
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

/** Greedy wrap by measured width, so text fits the column instead of a guess. */
function wrapToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of pdfSafe(text).split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
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

// An unhandled throw returns the platform's own 500, which carries no CORS
// headers — so in a browser it surfaces as a CORS failure and the real error is
// never seen.
Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (err) {
    console.error("export-investigation failed:", err);
    return new Response(`Export generation failed: ${err instanceof Error ? err.message : String(err)}`,
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
  const { snag_id } = (await req.json()) as { snag_id: string };
  if (!snag_id) {
    return new Response("snag_id is required", { status: 400, headers: CORS_HEADERS });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }
  // Role and org come from the membership RPC, never from `profiles`. That
  // table is self-writable by design (a user renames themselves), and its
  // `role`/`org_id` columns are the active-org mirror rather than the source
  // of truth — get_my_memberships reads org_memberships, which is what
  // current_role() and every RLS policy resolve through. Gating on
  // profiles.role here meant a worker could PATCH their own row and pass this
  // check; deriving the storage path from profiles.org_id meant they could
  // land the PDF in another org's folder, since the upload below runs on the
  // service-role client and RLS does not apply to it.
  const { data: memberships } = await userClient.rpc("get_my_memberships");
  const active = ((memberships ?? []) as Membership[])
    .find((m) => m.is_active && m.org_active);
  if (!active || (active.role !== "officer_admin" && active.role !== "supervisor")) {
    return new Response("Only a supervisor or admin can export the investigation file", { status: 403, headers: CORS_HEADERS });
  }

  const [
    snagRes, checklistRes, statementsRes, evidenceRes, investigationRes, actionsRes, profilesRes,
    rcaRes, debriefsRes, orgRes, siteRes,
  ] = await Promise.all([
    userClient.from("snags").select("*").eq("id", snag_id).maybeSingle(),
    userClient.from("checklist_completions").select("*").eq("snag_id", snag_id),
    userClient.from("witness_statements").select("*").eq("snag_id", snag_id).order("taken_at"),
    userClient.from("evidence_items").select("*").eq("snag_id", snag_id).order("sort_index"),
    userClient.from("investigations").select("*").eq("snag_id", snag_id).maybeSingle(),
    userClient.from("corrective_actions").select("*").eq("snag_id", snag_id).order("created_at"),
    userClient.from("profiles").select("*"),
    userClient.from("snag_rca").select("*, rca_why_steps(*)").eq("snag_id", snag_id).order("created_at"),
    userClient.from("snag_debriefs")
      .select("*, debrief_findings(*), debrief_attendees(*), debrief_lessons(*)")
      .eq("snag_id", snag_id).order("started_at"),
    userClient.from("organisations").select("name").eq("id", active.org_id).maybeSingle(),
    userClient.from("snags").select("sites(name)").eq("id", snag_id).maybeSingle(),
  ]);

  const snag = snagRes.data;
  if (!snag) return new Response("Snag not found", { status: 404, headers: CORS_HEADERS });
  if (snag.lane !== "serious") {
    return new Response("Only serious snags have an investigation file", { status: 400, headers: CORS_HEADERS });
  }

  const members = profilesRes.data ?? [];
  const memberName = (id: string | null) =>
    !id ? "Nobody" : (members.find((m) => m.id === id)?.name || "Someone");
  const orgName = orgRes.data?.name ?? "";
  // deno-lint-ignore no-explicit-any
  const siteName = (siteRes.data as any)?.sites?.name ?? "";

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
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
      // Masthead. The organisation owns this document — it is their record of
      // their incident, and SNAG is the tool that produced it, not the author.
      // So the company name is the wordmark and the product is not on it.
      page.drawRectangle({ x: 0, y: PAGE_H - MASTHEAD_H, width: PAGE_W, height: MASTHEAD_H, color: BRAND });
      const ident = pdfSafe(snag.reference);
      const identW = bold.widthOfTextAtSize(ident, 18);
      // Long company names shrink rather than collide with the reference.
      const orgText = pdfSafe(orgName || "Investigation record");
      let orgSize = 22;
      while (orgSize > 12 && bold.widthOfTextAtSize(orgText, orgSize) > CONTENT_W - identW - 30) orgSize -= 1;
      page.drawText(orgText, { x: MARGIN, y: PAGE_H - 48, size: orgSize, font: bold, color: WHITE });
      page.drawText("Investigation file", { x: MARGIN, y: PAGE_H - 68, size: 10, font, color: BRAND_TINT });
      page.drawText(ident, { x: PAGE_W - MARGIN - identW, y: PAGE_H - 56, size: 18, font: bold, color: WHITE });
      y = PAGE_H - MASTHEAD_H - 34;
    } else {
      // Running header: a loose page still names its snag. This document gets
      // printed, so page 4 on its own has to be identifiable.
      const run = pdfSafe((orgName ? orgName + "  ·  " : "") + "Investigation file  ·  " + snag.reference);
      page.drawText(run, { x: MARGIN, y: PAGE_H - 40, size: 8, font, color: MUTED });
      page.drawLine({
        start: { x: MARGIN, y: PAGE_H - 50 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - 50 },
        thickness: 0.75, color: RULE,
      });
      y = PAGE_H - 74;
    }
  }

  function need(space: number) {
    if (y - space < BOTTOM_LIMIT) startPage();
  }

  function sectionHeading(text: string) {
    need(48);
    y -= 12;
    page.drawText(pdfSafe(text.toUpperCase()), { x: MARGIN, y, size: 9.5, font: bold, color: BRAND });
    y -= 8;
    page.drawLine({
      start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.75, color: RULE,
    });
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

  /** Label above value — one cell of the summary grid. */
  function metaCell(label: string, value: string, x: number, top: number, width: number) {
    page.drawText(pdfSafe(label.toUpperCase()), { x, y: top, size: 7.5, font: bold, color: MUTED });
    const lines = wrapToWidth(value || "—", font, 10, width).slice(0, 2);
    let ly = top - 14;
    for (const line of lines) {
      page.drawText(line, { x, y: ly, size: 10, font, color: INK });
      ly -= 13;
    }
    return top - 14 - lines.length * 13;
  }

  /** Embeds an image from a private bucket. Returns false if it can't. */
  async function drawImage(bucket: string, path: string, maxW: number): Promise<boolean> {
    try {
      const { data: blob, error } = await serviceClient.storage.from(bucket).download(path);
      if (error || !blob) return false;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      // The app re-encodes captures to JPEG, but a file picked on the web build
      // can be a PNG — try both rather than silently dropping the picture.
      let image;
      try {
        image = await pdf.embedJpg(bytes);
      } catch {
        image = await pdf.embedPng(bytes);
      }
      const scale = Math.min(1, maxW / image.width);
      const w = image.width * scale;
      const h = image.height * scale;
      need(h + 14);
      page.drawImage(image, { x: MARGIN, y: y - h, width: w, height: h });
      page.drawRectangle({
        x: MARGIN, y: y - h, width: w, height: h, borderColor: RULE, borderWidth: 0.75,
      });
      y -= h + 14;
      return true;
    } catch {
      return false;
    }
  }

  startPage();

  // ── Summary grid ─────────────────────────────────────────────────────────
  const kindLabel = (KIND_LABELS[snag.kind] ?? snag.kind) +
    (snag.severity ? "  ·  " + (SEVERITY_LABELS[snag.severity] ?? snag.severity) : "");
  const colW = (CONTENT_W - 24) / 2;
  const rightX = MARGIN + colW + 24;

  let leftY = y, rightY = y;
  leftY = metaCell("Type", kindLabel, MARGIN, leftY, colW);
  rightY = metaCell("Status", STATUS_LABELS[snag.status] ?? snag.status, rightX, rightY, colW);
  leftY = metaCell("Site", siteName, MARGIN, leftY - 8, colW);
  rightY = metaCell("Occurred", new Date(snag.occurred_at).toLocaleString(), rightX, rightY - 8, colW);
  leftY = metaCell("Reported", new Date(snag.created_at).toLocaleString(), MARGIN, leftY - 8, colW);
  rightY = metaCell("Retained until", String(snag.retained_until ?? "—"), rightX, rightY - 8, colW);
  y = Math.min(leftY, rightY) - 12;

  // The one thing on the page that gets the serious-lane red.
  if (snag.is_notifiable) {
    need(46);
    page.drawRectangle({ x: MARGIN, y: y - 28, width: CONTENT_W, height: 32, color: SERIOUS_BG });
    page.drawRectangle({ x: MARGIN, y: y - 28, width: 3.5, height: 32, color: SERIOUS });
    page.drawText("NOTIFIABLE EVENT", { x: MARGIN + 14, y: y - 7, size: 9.5, font: bold, color: SERIOUS });
    page.drawText("Flagged as potentially notifiable to the regulator.", {
      x: MARGIN + 14, y: y - 21, size: 8.5, font, color: SECONDARY,
    });
    y -= 48;
  }

  if (snag.description) {
    sectionHeading("Description");
    body(snag.description);
  }

  // ── Photographs ──────────────────────────────────────────────────────────
  // The reported photos, which this file never used to include at all — the
  // record of a serious incident with no picture of it.
  const photoPaths: string[] = ((snag.photo_paths && snag.photo_paths.length)
    ? snag.photo_paths : [snag.photo_path]).filter(Boolean);
  if (photoPaths.length > 0) {
    sectionHeading("Photographs");
    let drawn = 0;
    for (const path of photoPaths) {
      if (await drawImage("snag-photos", path, 300)) drawn += 1;
    }
    if (drawn === 0) body("Photographs are on record but could not be embedded.", { color: MUTED, size: 9 });
  }

  // ── First-response checklist ─────────────────────────────────────────────
  sectionHeading("First-response checklist");
  const checklist = checklistRes.data ?? [];
  if (checklist.length === 0) {
    body("None recorded.", { color: MUTED });
  } else {
    for (const step of checklist) {
      body(STEP_LABELS[step.step] ?? step.step, { indent: 12 });
      y += 3;
      body(memberName(step.completed_by) + "  ·  " + new Date(step.completed_at).toLocaleString(),
        { size: 8.5, color: MUTED, indent: 12 });
    }
  }

  // ── Witness statements ───────────────────────────────────────────────────
  sectionHeading("Witness statements");
  const statements = statementsRes.data ?? [];
  if (statements.length === 0) {
    body("None recorded.", { color: MUTED });
  } else {
    for (const s of statements) {
      need(32);
      page.drawText(pdfSafe(s.witness_name), { x: MARGIN, y, size: 10, font: bold, color: INK });
      y -= 13;
      body("Taken " + new Date(s.taken_at).toLocaleString(), { size: 8.5, color: MUTED });
      body(s.statement_text, { color: SECONDARY });
      y -= 5;
    }
  }

  // ── Evidence ─────────────────────────────────────────────────────────────
  sectionHeading("Evidence");
  const evidence = evidenceRes.data ?? [];
  if (evidence.length === 0) {
    body("None recorded.", { color: MUTED });
  } else {
    for (const e of evidence) {
      // A caption with no file is legitimate: add_evidence_item accepts a note
      // on its own, and that is often how a scene gets described.
      body(e.caption || "(no caption)", { indent: 12 });
      if (e.media_path) await drawImage("snag-evidence", e.media_path, 240);
    }
  }

  // ── Root cause / RCA ─────────────────────────────────────────────────────
  sectionHeading("Root cause");
  const investigation = investigationRes.data;
  body(investigation?.root_cause_text || "Not yet recorded.",
    { color: investigation?.root_cause_text ? INK : MUTED });

  sectionHeading("Root cause analysis (5 whys)");
  const rcas = rcaRes.data ?? [];
  if (rcas.length === 0) {
    body("No delegated RCA.", { color: MUTED });
  } else {
    for (const rca of rcas) {
      body((RCA_STATUS_LABELS[rca.status] ?? rca.status) +
        " — assigned to " + memberName(rca.assigned_to) + " by " + memberName(rca.assigned_by) +
        " on " + new Date(rca.created_at).toLocaleDateString() +
        (rca.accepted_at ? "; accepted by " + memberName(rca.accepted_by) + " " + new Date(rca.accepted_at).toLocaleString() : ""),
        { size: 9, color: SECONDARY });
      if (rca.rejection_note) body("Reviewer note: " + rca.rejection_note, { size: 9, color: SECONDARY });
      const steps = (rca.rca_why_steps ?? []).sort(
        (a: { why_index: number }, b: { why_index: number }) => a.why_index - b.why_index);
      for (const step of steps) {
        need(28);
        page.drawText(pdfSafe("Why " + step.why_index + ": " + step.why_text),
          { x: MARGIN + 12, y, size: 9.5, font: bold, color: INK });
        y -= 14;
        body(step.answer_text, { indent: 24, color: SECONDARY, size: 9.5 });
      }
      y -= 5;
    }
  }

  // ── Debriefs ─────────────────────────────────────────────────────────────
  sectionHeading("Debriefs");
  const debriefs = debriefsRes.data ?? [];
  if (debriefs.length === 0) {
    body("None recorded.", { color: MUTED });
  } else {
    for (const d of debriefs) {
      need(28);
      page.drawText(pdfSafe(DEBRIEF_FORMAT_LABELS[d.format] ?? d.format),
        { x: MARGIN, y, size: 10, font: bold, color: INK });
      y -= 13;
      body("Started by " + memberName(d.started_by) + " " + new Date(d.started_at).toLocaleString() +
        (d.completed_at ? "; completed " + new Date(d.completed_at).toLocaleString() : " (in progress)"),
        { size: 8.5, color: MUTED });
      const attendees = (d.debrief_attendees ?? [])
        .map((a: { profile_id: string }) => memberName(a.profile_id)).join(", ");
      body("Attendees: " + (attendees || "none recorded"), { size: 9, color: SECONDARY });
      for (const f of d.debrief_findings ?? []) body("Finding: " + f.finding_text, { indent: 12, size: 9.5 });
      for (const l of d.debrief_lessons ?? []) body("Lesson: " + l.lesson_text, { indent: 12, size: 9.5 });
      y -= 5;
    }
  }

  // ── Corrective actions ───────────────────────────────────────────────────
  sectionHeading("Corrective actions");
  const actions = actionsRes.data ?? [];
  if (actions.length === 0) {
    body("None recorded.", { color: MUTED });
  } else {
    for (const a of actions) {
      // Matches the resolve-gate/dashboard definition: "done" alone isn't
      // closed, it also needs independent verification.
      const closed = a.status === "done" && a.verified_by;
      const statusLabel = closed
        ? "Done — verified by " + memberName(a.verified_by) + " " + new Date(a.verified_at).toLocaleDateString()
        : a.status === "done" ? "Done — awaiting verification" : "Open";
      body(a.description, { indent: 12 });
      y += 3;
      body(memberName(a.owner_id) + "  ·  due " + a.due_date + "  ·  " + statusLabel,
        { size: 8.5, color: closed ? MUTED : SERIOUS, indent: 12 });
    }
  }

  if (snag.resolution_note) {
    sectionHeading("Closing note");
    body(snag.resolution_note);
  }

  // ── Footers ──────────────────────────────────────────────────────────────
  // Drawn last, because "page N of M" cannot know M until the content stops.
  const pages = pdf.getPages();
  const generated = "Generated " + new Date().toLocaleString();
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: MARGIN, y: FOOTER_Y + 14 }, end: { x: PAGE_W - MARGIN, y: FOOTER_Y + 14 },
      thickness: 0.75, color: RULE,
    });
    p.drawText(pdfSafe((orgName ? orgName + "  ·  " : "") + snag.reference),
      { x: MARGIN, y: FOOTER_Y, size: 8, font, color: MUTED });
    const mid = pdfSafe(generated);
    p.drawText(mid, { x: (PAGE_W - font.widthOfTextAtSize(mid, 8)) / 2, y: FOOTER_Y, size: 8, font, color: MUTED });
    const num = "Page " + (i + 1) + " of " + pages.length;
    p.drawText(num, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(num, 8), y: FOOTER_Y, size: 8, font, color: MUTED,
    });
  });

  const bytes = await pdf.save();

  const filePath = active.org_id + "/" + snag_id + "/" + Date.now() + ".pdf";
  const { error: uploadError } = await serviceClient.storage
    .from("investigation-files")
    .upload(filePath, bytes, { contentType: "application/pdf" });
  if (uploadError) {
    return new Response("Upload failed: " + uploadError.message, { status: 500, headers: CORS_HEADERS });
  }

  const { error: recordError } = await userClient.rpc("record_investigation_export", {
    p_snag_id: snag_id, p_file_path: filePath,
  });
  if (recordError) {
    return new Response("Could not record export: " + recordError.message, { status: 500, headers: CORS_HEADERS });
  }

  const { data: signed } = await serviceClient.storage
    .from("investigation-files").createSignedUrl(filePath, 3600);

  return new Response(JSON.stringify({ path: filePath, signedUrl: signed?.signedUrl }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
