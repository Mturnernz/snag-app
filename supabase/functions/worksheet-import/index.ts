// worksheet-import: takes back a completed worksheet PDF. The uploaded
// document is ALWAYS stored as evidence first — a scanned, signed sheet is
// itself the defensible artefact — then any typed AcroForm fields are
// parsed and returned for review. Nothing is written to RCA/debrief tables
// here; the client pre-fills the in-app forms and saves go through the
// existing RPCs so locking rules and audit logging stay intact.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { snag_id, kind, pdf_base64 } = (await req.json()) as {
    snag_id: string;
    kind: "rca" | "debrief";
    pdf_base64: string;
  };
  if (!snag_id || !pdf_base64 || (kind !== "rca" && kind !== "debrief")) {
    return new Response("snag_id, kind and pdf_base64 are required", { status: 400 });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: profile } = await userClient.from("profiles").select("*").maybeSingle();
  if (!profile) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: snag } = await userClient.from("snags").select("*").eq("id", snag_id).maybeSingle();
  if (!snag) {
    return new Response("Snag not found", { status: 404 });
  }

  const supervisorish = profile.role === "supervisor" || profile.role === "officer_admin";
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
      return new Response("Only the RCA assignee, a supervisor or an admin can upload this worksheet", { status: 403 });
    }
  } else if (!supervisorish) {
    return new Response("Only a supervisor or admin can upload a debrief worksheet", { status: 403 });
  }

  const bytes = Uint8Array.from(atob(pdf_base64), (c) => c.charCodeAt(0));

  // Parse what we can. Handwritten scans have no form fields — that's fine.
  const parsed: Record<string, string> = {};
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    for (const field of pdf.getForm().getFields()) {
      const name = field.getName();
      // deno-lint-ignore no-explicit-any
      const getText = (field as any).getText;
      if (typeof getText === "function") {
        const value = getText.call(field);
        if (value) parsed[name] = String(value);
      }
    }
  } catch (_err) {
    // Not a parseable PDF form — store it anyway.
  }

  // If the worksheet identifies its snag, it must be THIS snag.
  if (parsed.snag_id && parsed.snag_id !== snag_id) {
    return new Response(
      "This worksheet belongs to a different snag. Open that snag and upload it there.",
      { status: 400 }
    );
  }

  // Always store the original document as evidence first.
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const mediaPath = `${snag.org_id}/${snag_id}/worksheet-${kind}-${Date.now()}.pdf`;
  const { error: uploadError } = await serviceClient.storage
    .from("snag-evidence")
    .upload(mediaPath, bytes, { contentType: "application/pdf" });
  if (uploadError) {
    return new Response(`Upload failed: ${uploadError.message}`, { status: 500 });
  }

  // Evidence row + audit trail via the service client: the add_evidence_item
  // RPC is supervisor-scoped, but an RCA-assignee worker must also be able
  // to return their worksheet, so the (already-verified) permission check
  // above stands in for it. Same rows the RPC would write.
  const caption = `Completed ${kind === "rca" ? "RCA" : "debrief"} worksheet, uploaded by ${profile.name || profile.email}`;
  const { data: nextIndexRows } = await serviceClient
    .from("evidence_items")
    .select("sort_index")
    .eq("snag_id", snag_id)
    .order("sort_index", { ascending: false })
    .limit(1);
  const nextIndex = (nextIndexRows?.[0]?.sort_index ?? -1) + 1;

  const { data: evidence, error: evidenceError } = await serviceClient
    .from("evidence_items")
    .insert({
      snag_id,
      uploaded_by: profile.id,
      media_path: mediaPath,
      caption,
      sort_index: nextIndex,
    })
    .select("id")
    .single();
  if (evidenceError || !evidence) {
    return new Response(`Could not record the worksheet as evidence: ${evidenceError?.message}`, { status: 500 });
  }

  await serviceClient.from("audit_log").insert([
    {
      org_id: snag.org_id,
      entity: "snag",
      entity_id: snag.id,
      action: "evidence_added",
      actor_id: profile.id,
    },
    {
      org_id: snag.org_id,
      entity: "snag",
      entity_id: snag.id,
      action: `worksheet_imported_${kind}:${evidence.id}`,
      actor_id: profile.id,
    },
  ]);

  // Strip the identity fields from what the client pre-fills.
  delete parsed.snag_id;
  delete parsed.worksheet_kind;

  return new Response(JSON.stringify({ evidence_id: evidence.id, parsed }), {
    headers: { "Content-Type": "application/json" },
  });
});
