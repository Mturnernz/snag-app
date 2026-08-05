// notify-snag: email notifications via Resend, called from DB triggers/RPCs
// (dispatch_snag_notification / dispatch_rca_notification) with an internal
// secret header. Source of truth is this file — redeploy via Supabase MCP.
//
// DEPLOY ORDER MATTERS. Every link below points at the portal — /go/snag/<id>
// for the per-snag mails, /join/<token> for invites. Deploying this function
// before a portal build containing those routes is live sends every
// notification to a 404 — and because these links are only ever followed from
// someone's inbox, nothing in the app or CI will tell you.
// Check the routes answer on the target host first:
//   curl -o /dev/null -w '%{http_code}\n' "$SNAG_PORTAL_URL/go/snag/<any-uuid>"
//   curl -o /dev/null -w '%{http_code}\n' "$SNAG_PORTAL_URL/join/<any-uuid>"
// Expect 200 (the handoff) or 307 (a signed-in supervisor being passed
// through). A 404 means the portal hasn't caught up — deploy that first.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("SNAG_INTERNAL_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// The default has to be a sender on a *verified* domain, because an unset
// secret is the case that actually happens. It was `onboarding@resend.dev` —
// Resend's sandbox sender, which delivers only to the Resend account's own
// address. Every notification to anybody else was rejected 403, and since
// sendEmail() only logs that and this function returns 200 regardless, nothing
// anywhere said so: not the app, not the DB, not CI. Mail stopped leaving the
// system on 13 July 2026 and was found three weeks later by reading Resend's
// own dashboard.
const FROM_ADDRESS = Deno.env.get("SNAG_FROM_ADDRESS") ?? "SNAG <noreply@snaghq.co.nz>";
// The portal (apps/web — it hosts the marketing site and the supervisor
// portal in one Next.js app). Every link this function sends points at its
// /go/snag/<id> handoff rather than at a client directly — see `go()` below.
// The app's own URL moved with that decision: /go is what knows where to send
// someone, so NEXT_PUBLIC_SNAG_APP_URL lives in apps/web now.
//
// www.snaghq.co.nz is the chosen production domain. Until its DNS points at
// the Netlify site, /go/snag/<id> will not answer there — so this default is
// aspirational, and deploying against it before the domain is live sends every
// notification to a dead host. SNAG_PORTAL_URL is a function secret, so it can
// be pointed anywhere without a redeploy; check the route first:
//   curl -o /dev/null -w '%{http_code}\n' "$SNAG_PORTAL_URL/go/snag/<any-uuid>"
const PORTAL_URL = Deno.env.get("SNAG_PORTAL_URL") ?? "https://www.snaghq.co.nz";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type Event =
  | "serious_created"
  | "niggle_assigned"
  | "snag_resolved"
  | "niggle_escalated"
  | "rca_assigned"
  | "rca_submitted"
  | "rca_rejected"
  | "overdue_actions_digest"
  | "invite_created";

// Mirrors ROLE_LABELS in packages/shared-types. Re-typed rather than imported
// because this function runs on Deno with no bundler and no access to the npm
// workspace — the same reason every other shared string here is duplicated.
// Keep in step with that map; it is what the invitee is told they're joining as.
const ROLE_LABELS: Record<string, string> = {
  worker: "Crew",
  supervisor: "Site Lead",
  officer_admin: "Manager",
};

async function sendEmail(to: string[], subject: string, text: string) {
  if (!RESEND_API_KEY || to.length === 0) {
    console.log("notify-snag: skipping send (no RESEND_API_KEY or no recipients)", {
      to,
      subject,
    });
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, text }),
  });
  if (!res.ok) {
    console.error("notify-snag: Resend rejected the email", {
      status: res.status,
      body: await res.text(),
      to,
    });
  }
}

async function emailOf(profileId: string | null): Promise<string | null> {
  if (!profileId) return null;
  const { data } = await supabase.from("profiles").select("email").eq("id", profileId).maybeSingle();
  return data?.email ?? null;
}

// One digest email per org, to every supervisor/officer_admin there, listing
// every corrective action that's overdue and not yet done-and-verified —
// same definition as the resolve gate and the dashboard's "Overdue actions"
// count, so the digest never disagrees with what the app itself shows.
async function sendOverdueActionsDigest(orgId: string) {
  const { data: actions } = await supabase
    .from("corrective_actions")
    .select("description, due_date, status, verified_by, snags!inner(reference, org_id)")
    .eq("snags.org_id", orgId)
    .lt("due_date", new Date().toISOString().slice(0, 10));

  const overdue = (actions ?? []).filter(
    (a: { status: string; verified_by: string | null }) => !(a.status === "done" && a.verified_by)
  );
  if (overdue.length === 0) return;

  const { data: recipients } = await supabase
    .from("profiles")
    .select("email")
    .eq("org_id", orgId)
    .in("role", ["supervisor", "officer_admin"]);
  const emails = (recipients ?? [])
    .map((p: { email: string | null }) => p.email)
    .filter((e): e is string => Boolean(e));
  if (emails.length === 0) return;

  const lines = overdue
    .map(
      (a: { description: string; due_date: string; snags: { reference: string } }) =>
        `- ${a.snags.reference}: ${a.description} (was due ${a.due_date})`
    )
    .join("\n");

  await sendEmail(
    emails,
    `${overdue.length} overdue corrective action${overdue.length === 1 ? "" : "s"}`,
    `The following corrective action${
      overdue.length === 1 ? " is" : "s are"
    } overdue:\n\n${lines}\n\nReview them here: ${PORTAL_URL}/dashboard`
  );
}

// Someone has been invited into an organisation. Unlike every other mail here
// this one goes to a person with no account, so it can't route by role the way
// /go/snag/<id> does — their role is a fact about the invite, not yet about
// them. It points at /join/<token>, which makes that decision after they've
// accepted and it's actually knowable.
//
// The code is spelled out in the body as well as being in the link. The app's
// own join screen takes a pasted code, so a mail client that mangles the URL,
// or a phone that already has SNAG installed, still has a way through.
async function sendInviteEmail(inviteId: string) {
  const { data: invite } = await supabase
    .from("invites")
    .select("email, role, token, status, expires_at, org_id, site_id, invited_by")
    .eq("id", inviteId)
    .maybeSingle();

  // Cancelled between the write and this call, or already taken up. Both are
  // races rather than errors — say nothing and send nothing.
  if (!invite || invite.status !== "pending") return;

  const [{ data: org }, { data: site }, { data: inviter }] = await Promise.all([
    supabase.from("organisations").select("name").eq("id", invite.org_id).maybeSingle(),
    invite.site_id
      ? supabase.from("sites").select("name").eq("id", invite.site_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("profiles").select("name").eq("id", invite.invited_by).maybeSingle(),
  ]);

  const orgName = org?.name ?? "your organisation";
  const roleLabel = ROLE_LABELS[invite.role] ?? invite.role;
  const invitedBy = inviter?.name ? `${inviter.name} has invited you` : "You've been invited";
  const at = site?.name ? ` at ${site.name}` : "";
  const expires = new Date(invite.expires_at).toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  await sendEmail(
    [invite.email],
    `${invitedBy} to join ${orgName} on SNAG`,
    `${invitedBy} to join ${orgName}${at} on SNAG as ${roleLabel}.\n\n` +
      `SNAG is where your team reports and tracks workplace problems — broken kit, hazards, ` +
      `near misses — so they get to the right person instead of being mentioned once and forgotten.\n\n` +
      `Accept your invite: ${PORTAL_URL}/join/${invite.token}\n\n` +
      `If that link doesn't work, open the SNAG app, choose "Join with invite code" and paste this:\n\n` +
      `${invite.token}\n\n` +
      `This invite is for ${invite.email} and expires on ${expires}.`
  );
}

Deno.serve(async (req: Request) => {
  if (!INTERNAL_SECRET || req.headers.get("x-snag-internal-secret") !== INTERNAL_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  const { event, snag_id, rca_id, org_id, invite_id } = (await req.json()) as {
    event: Event;
    snag_id?: string;
    rca_id?: string;
    org_id?: string;
    invite_id?: string;
  };

  // Not about a snag at all — branches before the per-snag lookup below, the
  // same way the digest does.
  if (event === "invite_created") {
    if (!invite_id) return new Response("ok");
    await sendInviteEmail(invite_id);
    return new Response("ok");
  }

  // Org-scoped digest — no single snag_id, so this branches before the
  // generic per-snag lookup every other event relies on.
  if (event === "overdue_actions_digest") {
    if (!org_id) return new Response("ok");
    await sendOverdueActionsDigest(org_id);
    return new Response("ok");
  }

  if (!snag_id) return new Response("ok");
  const { data: snag } = await supabase.from("snags").select("*").eq("id", snag_id).maybeSingle();
  if (!snag) return new Response("ok");

  // Every per-snag mail points at the same handoff, which decides per visitor:
  // a supervisor is sent straight into the portal, everyone else is offered the
  // app. Choosing a client per *event* cannot work here — `serious_created` is
  // one email to a whole site's members, whose roles are mixed, and RCAs are
  // usually assigned to workers, who the portal refuses outright.
  //
  // These used to point straight at the app, and the RCA ones at
  // `/snags/<id>/rca` — a path no client has ever had a route for. It never
  // failed loudly: the app's web build is `output: "single"`, so it served the
  // app shell and dropped the reader on the Report tab.
  const go = (step?: string) =>
    `${PORTAL_URL}/go/snag/${snag_id}${step ? `?step=${step}` : ""}`;

  const link = go();
  // Lands on the analysis rather than the top of the snag it hangs off.
  const rcaLink = go("rca");
  // The notifiable decision is the first thing update_snag_status checks and
  // the one with a statutory clock on it, so a "serious incident reported"
  // mail opens there.
  const seriousLink = go("notifiable");

  if (event === "serious_created") {
    // The organisation's nominated serious-incident owners are the health &
    // safety team the app tells reporters about. This used to mail every member
    // of the snag's site instead, which meant the claim was true only by
    // accident: on a one-member site it reached that person, and on a site whose
    // members have no email it reached nobody.
    const { data: owners } = await supabase
      .from("serious_incident_owners")
      .select("profiles!serious_incident_owners_profile_id_fkey(email)")
      .eq("org_id", snag.org_id);
    let emails = (owners ?? [])
      .map((o: { profiles: { email: string } | null }) => o.profiles?.email)
      .filter((e): e is string => Boolean(e));

    // Every org has owners (the migration backfilled them and the RPC won't
    // remove the last), but a serious incident is the wrong thing to drop on
    // the floor if that ever stops being true.
    if (emails.length === 0) {
      const { data: members } = await supabase
        .from("site_members")
        .select("profiles(email)")
        .eq("site_id", snag.site_id);
      emails = (members ?? [])
        .map((m: { profiles: { email: string } | null }) => m.profiles?.email)
        .filter((e): e is string => Boolean(e));
      console.warn("notify-snag: no serious incident owners, fell back to site members", {
        snag_id,
        org_id: snag.org_id,
        recipients: emails.length,
      });
    }

    await sendEmail(
      emails,
      `Heads up — ${snag.kind} reported (${snag.reference})`,
      `A ${snag.kind} was just reported.\n\n${snag.description ?? ""}\n\nSee it here: ${seriousLink}`
    );
  } else if (event === "niggle_assigned" && snag.owner_id) {
    // The event name is a misnomer: notify_after_snag_update fires it on *any*
    // owner change, serious lane included. On the serious lane the owner is the
    // lead investigator (triage sets both in one act), and "you've been
    // assigned a snag" is a poor description of being handed an investigation —
    // so the same event says the right thing for each lane.
    const email = await emailOf(snag.owner_id);
    if (email && snag.lane === "serious") {
      // Read after assign_investigation, which triage calls first for exactly
      // this reason: the mail names how the investigation is being run.
      const { data: investigation } = await supabase
        .from("investigations")
        .select("mode")
        .eq("snag_id", snag_id)
        .maybeSingle();
      const documentMode = investigation?.mode === "document";
      const how = documentMode
        ? "Your organisation's own process: run the investigation and attach the completed document. A supervisor accepts it, and that's what closes this."
        : "SNAG's guided process: a root cause, then corrective actions completed and verified.";

      await sendEmail(
        [email],
        `You're leading the investigation — ${snag.reference}`,
        `You've been assigned the investigation into ${snag.reference}: ${
          snag.description ?? "(see photo)"
        }\n\n${how}\n\nStart with making the area safe and preserving the scene: ${go("checklist")}`
      );
    } else if (email) {
      await sendEmail(
        [email],
        `You've been assigned a snag (${snag.reference})`,
        `You're the owner of ${snag.reference}: ${snag.description ?? "(see photo)"}\n\nSort it here: ${link}`
      );
    }
  } else if (event === "niggle_escalated") {
    const { data: members } = await supabase
      .from("site_members")
      .select("profiles(email, role)")
      .eq("site_id", snag.site_id);
    const emails = (members ?? [])
      .map((m: { profiles: { email: string; role: string } | null }) => m.profiles)
      .filter(
        (p): p is { email: string; role: string } =>
          Boolean(p?.email) && (p.role === "supervisor" || p.role === "officer_admin")
      )
      .map((p) => p.email);
    await sendEmail(
      emails,
      `Flagged for attention — ${snag.reference}`,
      `${snag.reference} was reported as a niggle but the reporter thinks it needs more attention.\n\n${
        snag.description ?? ""
      }\n\nSee it here: ${link}`
    );
  } else if (event === "snag_resolved") {
    const email = await emailOf(snag.reporter_id);
    if (email) {
      await sendEmail(
        [email],
        `Resolved — ${snag.reference}`,
        `The thing you flagged (${snag.reference}) is resolved.${
          snag.resolution_note ? `\n\n${snag.resolution_note}` : ""
        }\n\nSee it here: ${link}`
      );
    }
  } else if (event === "rca_assigned" || event === "rca_submitted" || event === "rca_rejected") {
    if (!rca_id) return new Response("ok");
    const { data: rca } = await supabase.from("snag_rca").select("*").eq("id", rca_id).maybeSingle();
    if (!rca) return new Response("ok");

    if (event === "rca_assigned") {
      const email = await emailOf(rca.assigned_to);
      if (email) {
        await sendEmail(
          [email],
          `You've been asked to complete a Root Cause Analysis (${snag.reference})`,
          `A 5-Whys Root Cause Analysis on ${snag.reference} has been delegated to you.\n\n${
            snag.description ?? ""
          }\n\nComplete it here: ${rcaLink}`
        );
      }
    } else if (event === "rca_submitted") {
      const email = await emailOf(rca.assigned_by);
      if (email) {
        await sendEmail(
          [email],
          `RCA submitted for review (${snag.reference})`,
          `The Root Cause Analysis on ${snag.reference} has been submitted and is waiting for your review.\n\nReview it here: ${rcaLink}`
        );
      }
    } else {
      const email = await emailOf(rca.assigned_to);
      if (email) {
        await sendEmail(
          [email],
          `RCA sent back for another look (${snag.reference})`,
          `Your Root Cause Analysis on ${snag.reference} was sent back.${
            rca.rejection_note ? `\n\nNote from the reviewer: ${rca.rejection_note}` : ""
          }\n\nPick it up here: ${rcaLink}`
        );
      }
    }
  }

  return new Response("ok");
});
