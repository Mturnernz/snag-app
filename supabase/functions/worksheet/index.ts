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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { snag_id, kind } = (await req.json()) as { snag_id: string; kind: "rca" | "debrief" };
  if (!snag_id || (kind !== "rca" && kind !== "debrief")) {
    return new Response("snag_id and kind ('rca' or 'debrief') are required", { status: 400 });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: profile } = await userClient.from("profiles").select("*").maybeSingle();
  if (!profile) {
    return new Response("Unauthorized", { status: 401 });
  }

  // RLS scopes this read; null means no access.
  const { data: snag } = await userClient.from("snags").select("*").eq("id", snag_id).maybeSingle();
  if (!snag) {
    return new Response("Snag not found", { status: 404 });
  }
  if (snag.lane !== "serious") {
    return new Response("Only hazard/incident snags have worksheets", { status: 400 });
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
      return new Response("Only the RCA assignee, a supervisor or an admin can get this worksheet", { status: 403 });
    }
  } else if (!supervisorish) {
    return new Response("Only a supervisor or admin can get a debrief worksheet", { status: 403 });
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
    page.drawText(t, { x: left, y, size, font: isBold ? bold : font, color: rgb(0, 0, 0) });
    y -= size + 6;
  }

  function labelledField(name: string, label: string, height: number, multiline: boolean) {
    if (y - height - 24 < 50) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
    page.drawText(label, { x: left, y, size: 9, font: bold, color: rgb(0.25, 0.25, 0.25) });
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
  idField.setText(snag.id);
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
    "Return this worksheet: open the snag in Snag → Upload completed worksheet.",
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

  const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return new Response(
    JSON.stringify({ filename: `${snag.reference}-${kind}-worksheet.pdf`, pdfBase64: base64 }),
    { headers: { "Content-Type": "application/json" } }
  );
});
