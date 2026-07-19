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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    period_start?: string;
    period_end?: string;
  };

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: profile } = await userClient.from("profiles").select("*").maybeSingle();
  if (!profile || profile.role !== "officer_admin") {
    return new Response("Only an admin can export the governance report", { status: 403 });
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
    return new Response("Could not load organisation stats", { status: 500 });
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
    page.drawText(text, { x: left, y, size: 14, font: bold, color: rgb(0, 0, 0) });
    y -= lineHeight;
  }

  function paragraph(text: string, size = 11) {
    for (const line of wrapLines(text, 90)) {
      ensureSpace();
      page.drawText(line, { x: left, y, size, font, color: rgb(0, 0, 0) });
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
    return new Response(`Upload failed: ${uploadError.message}`, { status: 500 });
  }

  const { error: recordError } = await userClient.rpc("record_governance_export", {
    p_file_path: filePath,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });
  if (recordError) {
    return new Response(`Could not record export: ${recordError.message}`, { status: 500 });
  }

  const { data: signed } = await serviceClient.storage
    .from("governance-reports")
    .createSignedUrl(filePath, 3600);

  return new Response(JSON.stringify({ path: filePath, signedUrl: signed?.signedUrl }), {
    headers: { "Content-Type": "application/json" },
  });
});
