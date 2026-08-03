// export-governance-report: a periodic due-diligence PDF an officer can
// keep on file — built on the existing get_org_stats/get_site_breakdown
// RPCs, restricted to officer_admin (an org-wide governance artefact, not
// a single incident's record). Source of truth is this file — redeploy
// via Supabase MCP.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STATUS_LABELS: Record<string, string> = {
  flagged: "Flagged",
  in_progress: "In progress",
  resolved: "Resolved",
  rca_pending: "RCA pending",
};

const KIND_LABELS: Record<string, string> = {
  fixit: "Fix-it",
  improvement: "Improvement",
  hazard: "Hazard",
  incident: "Incident",
};

const SEVERITY_LABELS: Record<string, string> = {
  minor: "Minor",
  moderate: "Moderate",
  injury: "Injury",
  critical: "Critical",
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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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
    console.error("export-governance-report failed:", err);
    return new Response(`Report generation failed: ${err instanceof Error ? err.message : String(err)}`,
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

  const body = (await req.json().catch(() => ({}))) as {
    period_start?: string;
    period_end?: string;
  };

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
  if (!profile || profile.role !== "officer_admin") {
    return new Response("Only an admin can export the governance report", { status: 403, headers: CORS_HEADERS });
  }

  // Default to the trailing quarter — matches the "quarterly" cadence the
  // compliance proposal recommends, without forcing the caller to compute it.
  const periodEnd = body.period_end ?? isoDate(new Date());
  const periodStart =
    body.period_start ?? isoDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));

  const [orgRes, statsRes, breakdownRes, notifiableRes] = await Promise.all([
    userClient.from("organisations").select("name").eq("id", profile.org_id).maybeSingle(),
    userClient.rpc("get_org_stats", { p_org_id: profile.org_id }),
    userClient.rpc("get_site_breakdown", { p_org_id: profile.org_id }),
    userClient
      .from("snags")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id)
      .eq("is_notifiable", true)
      .gte("notifiable_marked_at", periodStart)
      .lte("notifiable_marked_at", periodEnd),
  ]);

  const orgName = orgRes.data?.name ?? "Your organisation";
  const stats = statsRes.data as {
    total_snags: number;
    total_members: number;
    by_status: Record<string, number>;
    by_kind: Record<string, number>;
    by_severity: Record<string, number>;
  } | null;
  const breakdown = (breakdownRes.data ?? []) as Array<{
    site_id: string;
    site_name: string;
    open_investigations: number;
    unassigned: number;
    overdue_actions: number;
  }>;
  const notifiableInPeriod = notifiableRes.count ?? 0;

  if (!stats) {
    return new Response("Could not load organisation stats", { status: 500, headers: CORS_HEADERS });
  }

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

  heading(`Governance report — ${orgName}`);
  paragraph(`Period: ${periodStart} to ${periodEnd}`);
  paragraph(`Generated: ${new Date().toLocaleString()}`);
  paragraph(
    "This is a due-diligence artefact summarising open risk and resourcing for the period above — " +
      "not a substitute for legal advice on officer due-diligence obligations under HSWA."
  );

  heading("Organisation summary");
  paragraph(`Total snags on record: ${stats.total_snags}`);
  paragraph(`Members: ${stats.total_members}`);
  paragraph(`Notifiable events flagged in this period: ${notifiableInPeriod}`);

  heading("By status");
  for (const [key, label] of Object.entries(STATUS_LABELS)) {
    paragraph(`${label}: ${stats.by_status[key] ?? 0}`);
  }

  heading("By type");
  for (const [key, label] of Object.entries(KIND_LABELS)) {
    paragraph(`${label}: ${stats.by_kind[key] ?? 0}`);
  }

  heading("By severity");
  for (const [key, label] of Object.entries(SEVERITY_LABELS)) {
    paragraph(`${label}: ${stats.by_severity[key] ?? 0}`);
  }

  heading("Site breakdown");
  if (breakdown.length === 0) {
    paragraph("No sites recorded.");
  } else {
    for (const s of breakdown) {
      paragraph(
        `${s.site_name} — open investigations: ${s.open_investigations}, unassigned: ${s.unassigned}, overdue corrective actions: ${s.overdue_actions}`
      );
    }
  }

  const bytes = await pdf.save();

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const filePath = `${profile.org_id}/${Date.now()}.pdf`;
  const { error: uploadError } = await serviceClient.storage
    .from("governance-reports")
    .upload(filePath, bytes, { contentType: "application/pdf" });
  if (uploadError) {
    return new Response(`Upload failed: ${uploadError.message}`, { status: 500, headers: CORS_HEADERS });
  }

  const { error: recordError } = await userClient.rpc("record_governance_export", {
    p_file_path: filePath,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });
  if (recordError) {
    return new Response(`Could not record export: ${recordError.message}`, { status: 500, headers: CORS_HEADERS });
  }

  const { data: signed } = await serviceClient.storage
    .from("governance-reports")
    .createSignedUrl(filePath, 3600);

  return new Response(JSON.stringify({ path: filePath, signedUrl: signed?.signedUrl }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
