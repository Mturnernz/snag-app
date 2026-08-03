// export-investigation: the defensible record for a serious snag as a PDF.
// Source of truth is this file — redeploy via Supabase MCP.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const KIND_LABELS: Record<string, string> = {
  fixit: "Fix-it",
  improvement: "Improvement",
  hazard: "Hazard",
  incident: "Incident",
};

const STEP_LABELS: Record<string, string> = {
  make_safe: "Made the area safe",
  preserve_scene: "Preserved the scene",
  capture_evidence: "Captured evidence",
  identify_witnesses: "Identified witnesses",
  find_root_cause: "Found the root cause",
};

const RCA_STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  in_progress: "In progress",
  submitted: "Submitted, awaiting review",
  accepted: "Accepted",
  rejected: "Sent back for another look",
  cancelled: "Cancelled",
};

const DEBRIEF_FORMAT_LABELS: Record<string, string> = {
  hot: "Hot debrief",
  formal: "Formal debrief",
};

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
    out += code <= 0xff || "\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u20ac\u2122".includes(ch) ? ch : "?";
  }
  return out;
}

function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > maxChars) {
      if (line) lines.push(line.trim());
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

// CORS. The browser sends a preflight OPTIONS before any invoke that carries an
// Authorization header, and this function used to answer it with the same 405
// it gives any non-POST — so the preflight failed and the browser never sent
// the POST at all. Nothing reached the handler, so there was nothing in the
// logs but a run of `OPTIONS | 405`, and the client saw a bare network error.
//
// Invisible on native: React Native issues no preflight, so this worked on a
// phone and failed in the browser, which is where the export is actually used.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// An unhandled throw returns the platform's own 500, which carries no CORS
// headers — so in a browser it surfaces as a CORS failure and the real error is
// never seen. That is how a single unencodable character looked like a network
// problem rather than a font problem.
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

  // Scoped to the caller. Without the filter this is "every profile RLS lets me
  // see", and an org member can see all of them — line below does exactly that
  // on purpose, to resolve names. maybeSingle() then gets more than one row,
  // returns null, and the role guard rejects a caller whose role was never
  // read at all.
  //
  // So the export 403'd for everyone in any organisation with more than one
  // member, and passed in a one-person org, which is where it was tested.
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }
  const { data: profile } = await userClient
    .from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile || (profile.role !== "officer_admin" && profile.role !== "supervisor")) {
    return new Response("Only a supervisor or admin can export the investigation file", { status: 403, headers: CORS_HEADERS });
  }

  const [
    snagRes, checklistRes, statementsRes, evidenceRes, investigationRes, actionsRes, profilesRes,
    rcaRes, debriefsRes,
  ] = await Promise.all([
    userClient.from("snags").select("*").eq("id", snag_id).maybeSingle(),
    userClient.from("checklist_completions").select("*").eq("snag_id", snag_id),
    userClient.from("witness_statements").select("*").eq("snag_id", snag_id).order("taken_at"),
    userClient.from("evidence_items").select("*").eq("snag_id", snag_id).order("sort_index"),
    userClient.from("investigations").select("*").eq("snag_id", snag_id).maybeSingle(),
    userClient.from("corrective_actions").select("*").eq("snag_id", snag_id).order("created_at"),
    userClient.from("profiles").select("*"),
    userClient.from("snag_rca").select("*, rca_why_steps(*)").eq("snag_id", snag_id).order("created_at"),
    userClient
      .from("snag_debriefs")
      .select("*, debrief_findings(*), debrief_attendees(*), debrief_lessons(*)")
      .eq("snag_id", snag_id)
      .order("started_at"),
  ]);

  const snag = snagRes.data;
  if (!snag) {
    return new Response("Snag not found", { status: 404, headers: CORS_HEADERS });
  }
  if (snag.lane !== "serious") {
    return new Response("Only serious snags have an investigation file", { status: 400, headers: CORS_HEADERS });
  }

  const members = profilesRes.data ?? [];
  function memberName(id: string | null) {
    if (!id) return "Nobody";
    return members.find((m) => m.id === id)?.name || "Someone";
  }

  // Needed early — evidence images are embedded while the PDF is being
  // built, not just at upload time at the end.
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595, 842]);
  let y = 800;
  const left = 50;
  const lineHeight = 16;

  function ensureSpace(lines = 1) {
    if (y - lines * lineHeight < 50) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
  }

  function heading(text: string) {
    ensureSpace(2);
    y -= 8;
    page.drawText(pdfSafe(text), { x: left, y, size: 14, font: bold, color: rgb(0, 0, 0) });
    y -= lineHeight;
  }

  function paragraph(text: string, size = 11) {
    for (const line of wrapLines(text, 90)) {
      ensureSpace();
      page.drawText(pdfSafe(line), { x: left, y, size, font, color: rgb(0, 0, 0) });
      y -= lineHeight;
    }
  }

  // Evidence photos are always uploaded as JPEG (the app re-encodes on
  // capture — see uploadSnagPhoto), so embedJpg covers the real cases; a
  // photo that still fails to embed just falls back to caption-only text
  // above it rather than losing the record.
  const EVIDENCE_MAX_WIDTH = 200;
  async function drawEvidenceImage(mediaPath: string) {
    try {
      const { data: blob, error: downloadError } = await serviceClient.storage
        .from("snag-evidence")
        .download(mediaPath);
      if (downloadError || !blob) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const image = await pdf.embedJpg(bytes);
      const scale = Math.min(1, EVIDENCE_MAX_WIDTH / image.width);
      const w = image.width * scale;
      const h = image.height * scale;
      if (y - h < 50) {
        page = pdf.addPage([595, 842]);
        y = 800;
      }
      page.drawImage(image, { x: left, y: y - h, width: w, height: h });
      y -= h + 8;
    } catch {
      // Not embeddable — leave the caption text as the record.
    }
  }

  heading(`Investigation file — ${snag.reference}`);
  paragraph(`Kind: ${KIND_LABELS[snag.kind] ?? snag.kind}${snag.severity ? ` (${snag.severity})` : ""}`);
  paragraph(`Status: ${snag.status}`);
  paragraph(`Reported: ${new Date(snag.created_at).toLocaleString()}`);
  paragraph(`Occurred: ${new Date(snag.occurred_at).toLocaleString()}`);
  if (snag.is_notifiable) {
    paragraph("Flagged as a potentially notifiable event.");
  }
  paragraph(`Retained until: ${snag.retained_until}`);
  if (snag.description) {
    heading("Description");
    paragraph(snag.description);
  }

  heading("First-response checklist");
  const checklist = checklistRes.data ?? [];
  if (checklist.length === 0) {
    paragraph("None recorded.");
  } else {
    for (const step of checklist) {
      paragraph(`- ${STEP_LABELS[step.step] ?? step.step} — ${memberName(step.completed_by)}, ${new Date(step.completed_at).toLocaleString()}`);
    }
  }

  heading("Witness statements");
  const statements = statementsRes.data ?? [];
  if (statements.length === 0) {
    paragraph("None recorded.");
  } else {
    for (const s of statements) {
      paragraph(`${s.witness_name} (taken ${new Date(s.taken_at).toLocaleString()}):`, 11);
      paragraph(s.statement_text);
    }
  }

  heading("Evidence");
  const evidence = evidenceRes.data ?? [];
  if (evidence.length === 0) {
    paragraph("None recorded.");
  } else {
    for (const e of evidence) {
      paragraph(`- ${e.caption || e.media_path}`);
      if (e.media_path) await drawEvidenceImage(e.media_path);
    }
  }

  heading("Root cause");
  const investigation = investigationRes.data;
  paragraph(investigation?.root_cause_text || "Not yet recorded.");

  heading("Root Cause Analysis (5 Whys)");
  const rcas = rcaRes.data ?? [];
  if (rcas.length === 0) {
    paragraph("No delegated RCA.");
  } else {
    for (const rca of rcas) {
      paragraph(
        `${RCA_STATUS_LABELS[rca.status] ?? rca.status} — assigned to ${memberName(rca.assigned_to)} by ${memberName(rca.assigned_by)} on ${new Date(rca.created_at).toLocaleDateString()}` +
          (rca.accepted_at
            ? `; accepted by ${memberName(rca.accepted_by)} ${new Date(rca.accepted_at).toLocaleString()}`
            : "")
      );
      if (rca.rejection_note) {
        paragraph(`Reviewer note: ${rca.rejection_note}`);
      }
      const steps = (rca.rca_why_steps ?? []).sort(
        (a: { why_index: number }, b: { why_index: number }) => a.why_index - b.why_index
      );
      for (const step of steps) {
        paragraph(`Why ${step.why_index}: ${step.why_text}`);
        paragraph(`  ${step.answer_text}`);
      }
    }
  }

  heading("Debriefs");
  const debriefs = debriefsRes.data ?? [];
  if (debriefs.length === 0) {
    paragraph("None recorded.");
  } else {
    for (const d of debriefs) {
      paragraph(
        `${DEBRIEF_FORMAT_LABELS[d.format] ?? d.format} — started by ${memberName(d.started_by)} ${new Date(d.started_at).toLocaleString()}` +
          (d.completed_at ? `; completed ${new Date(d.completed_at).toLocaleString()}` : " (in progress)")
      );
      const attendees = (d.debrief_attendees ?? [])
        .map((a: { profile_id: string }) => memberName(a.profile_id))
        .join(", ");
      paragraph(`Attendees: ${attendees || "none recorded"}`);
      const findings = d.debrief_findings ?? [];
      if (findings.length > 0) {
        paragraph("Findings:");
        for (const f of findings) paragraph(`- ${f.finding_text}`);
      }
      const lessons = d.debrief_lessons ?? [];
      if (lessons.length > 0) {
        paragraph("Lessons learned:");
        for (const l of lessons) paragraph(`- ${l.lesson_text}`);
      }
    }
  }

  heading("Corrective actions");
  const actions = actionsRes.data ?? [];
  if (actions.length === 0) {
    paragraph("None recorded.");
  } else {
    for (const a of actions) {
      // Matches the resolve-gate/dashboard definition: "done" alone isn't
      // closed, it also needs independent verification.
      const statusLabel =
        a.status === "done" && a.verified_by
          ? `Done — verified by ${memberName(a.verified_by)} ${new Date(a.verified_at).toLocaleDateString()}`
          : a.status === "done"
          ? "Done — awaiting verification"
          : "Open";
      paragraph(`- ${a.description} — ${memberName(a.owner_id)} — due ${a.due_date} — ${statusLabel}`);
    }
  }

  if (snag.resolution_note) {
    heading("Closing note");
    paragraph(snag.resolution_note);
  }

  const bytes = await pdf.save();

  const filePath = `${profile.org_id}/${snag_id}/${Date.now()}.pdf`;
  const { error: uploadError } = await serviceClient.storage
    .from("investigation-files")
    .upload(filePath, bytes, { contentType: "application/pdf" });
  if (uploadError) {
    return new Response(`Upload failed: ${uploadError.message}`, { status: 500, headers: CORS_HEADERS });
  }

  const { error: recordError } = await userClient.rpc("record_investigation_export", {
    p_snag_id: snag_id,
    p_file_path: filePath,
  });
  if (recordError) {
    return new Response(`Could not record export: ${recordError.message}`, { status: 500, headers: CORS_HEADERS });
  }

  const { data: signed } = await serviceClient.storage
    .from("investigation-files")
    .createSignedUrl(filePath, 3600);

  return new Response(JSON.stringify({ path: filePath, signedUrl: signed?.signedUrl }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
