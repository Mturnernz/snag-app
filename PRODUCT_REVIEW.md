# SNAG — Product & Engineering Review

**Date:** 24 July 2026
**Scope:** `apps/mobile` (Expo), `apps/web` (Next.js portal + marketing), `packages/*`, `supabase/` (schema, RPCs, edge functions, storage, RLS)
**Live backend reviewed:** Snagv1 (`wpkdpukpllxuyqqlxkxf`) — schema, function bodies, RLS policies, storage policies and production data were read directly, not inferred from the migration files.

---

## 1. Executive summary

SNAG is in better shape than most products at this stage. The security model is genuinely well built: every RLS policy in `public` is scoped by `current_org_id()` / `auth.uid()` — there is not a single over-permissive policy — all writes funnel through `SECURITY DEFINER` RPCs that re-check role and org, and the notification edge function correctly enforces a shared-secret header. The serious-lane investigation gate (`update_snag_status`) is a real, server-enforced compliance control, not UI theatre.

The problems are concentrated in one place: **the workflow model has a post-resolution phase (RCA, corrective actions, debriefs) that the management dashboard does not measure.** The "Outstanding Work" gap you spotted is not a display bug — it is a structural mismatch between how work is defined and how it is counted. That single mismatch is currently hiding **10 resolved serious snags with no completed root-cause analysis, four of them severity `critical`**, from the only screen a manager would use to find them.

Alongside that, there is a confirmed data-integrity bug in `update_snag_status` (resolved snags are not stamped with who resolved them or when), a scattering of dead code from retired features, and a handful of defence-in-depth hardening items.

**Headline counts**

| Category | Critical | High | Medium | Low |
|---|---|---|---|---|
| Functional / contract gaps | 1 | 3 | 4 | 3 |
| Security | 0 | 0 | 4 | 3 |
| Dead code / removal | 0 | 0 | 3 | 4 |
| UI / UX | 0 | 2 | 4 | 3 |

---

## 2. How this was verified

Findings below are marked **[verified]** where I confirmed them against the live database or by reading the deployed function body, and **[reasoned]** where the conclusion follows from reading code but I could not execute the path.

What I did *not* do: run either app, execute a test suite (there is none), or perform authenticated penetration testing against the API. Section 4 is a code-and-configuration security review, not a pentest.

---

## 3. Functional gaps

### 3.1 🔴 CRITICAL — Outstanding RCA work is invisible to the manager dashboard

This is the issue you identified, and the root cause is deeper than a missing number.

**The workflow.** `assign_rca` requires the snag to already be `resolved`:

```sql
-- live definition of public.assign_rca
if v_snag.status <> 'resolved' then
  raise exception 'An RCA can only be assigned on a resolved snag';
end if;
```

So a root-cause analysis is, by design, **post-resolution work**. The snag moves `resolved → rca_pending` while the RCA is live, and returns to `resolved` when it is accepted (`accept_rca`) *or cancelled* (`cancel_rca`).

**The measurement.** `get_site_breakdown` — the sole source for the Admin tab's "Outstanding Work" card and the web dashboard's "By site" table — counts work purely by snag status:

```sql
-- open_investigations
where org_id = p_org_id and lane = 'serious'
  and status in ('flagged', 'in_progress', 'rca_pending')
```

**The gap.** A serious snag that is `resolved` but has **never had an accepted RCA** is counted in exactly zero columns. It is only visible during the narrow `rca_pending` window. The moment an RCA is cancelled — or was never assigned in the first place — the outstanding analysis work vanishes from every management view.

**This is not theoretical.** In the Docunation org right now:

| Reference | Severity | RCA state |
|---|---|---|
| SNAG-00003 | **critical** | never assigned |
| SNAG-00004 | **critical** | never assigned |
| SNAG-00006 | **critical** | never assigned |
| SNAG-00022 | **critical** | never assigned |
| SNAG-00014 | moderate | never assigned |
| SNAG-00018 | moderate | never assigned |
| SNAG-00021 | minor | never assigned |
| SNAG-00008 | moderate | never assigned |
| SNAG-00024 | moderate | never assigned |
| SNAG-00028 | moderate | **cancelled** 19 Jul |

Ten serious snags awaiting root-cause analysis. "Outstanding Work" for the Hendo site reports `2 / 1 / 1` — none of which is any of the above. **[verified — queried live]**

**Why the app *looks* like it is tracking them.** `RcaPanel` reports its step status up to the detail screen's `ProgressStrip`:

```ts
// RcaPanel.tsx:84-89
if (status === 'resolved') {
  if (data?.status === 'accepted') { onStatusChange?.('done', ...) }
  else { onStatusChange?.('pending', 'Not started') }
}
```

and `IssueDetailScreen.tsx:662` renders a "Root Cause" chip for every `resolved` serious snag. So each of those ten snags displays a **pending "Root Cause — Not started"** step, indefinitely. The app tells the user on the detail screen that the work is outstanding, then tells them on the dashboard that nothing is outstanding. That contradiction is exactly what you noticed. **[verified — read both code paths]**

**Recommended fix.** Add a fourth measure to `get_site_breakdown` and both dashboards:

```sql
-- rca_outstanding: serious snags resolved without a completed RCA
left join (
  select sn.site_id, count(*) as cnt
  from public.snags sn
  where sn.org_id = p_org_id
    and sn.lane = 'serious'
    and sn.status in ('resolved', 'rca_pending')
    and not exists (
      select 1 from public.snag_rca r
      where r.snag_id = sn.id and r.status = 'accepted'
    )
  group by sn.site_id
) rca on rca.site_id = s.id
```

Make the count tappable, reusing the existing `UnassignedQuickAssign` expand pattern to list the snags with an inline "Assign RCA" picker.

**Product decision required.** Not every resolved serious snag needs a formal 5-Whys — a minor hazard probably does not. Right now the app has no way to say "no RCA required here", which is why all ten sit in limbo. Recommend adding an explicit **"RCA not required"** disposition (a nullable `rca_waived_by` / `rca_waived_reason` on `snags`, set by a supervisor) so the count reflects genuine outstanding work rather than every serious snag ever closed. Without this, the new column will read `10` on day one and be ignored by day three.

---

### 3.2 🟠 HIGH — `update_snag_status` never stamps `resolved_by` / `resolved_at` on the snag it resolves

Reading the deployed function body, the primary update omits both columns — while the *child cascade* immediately below it sets them correctly:

```sql
-- the snag actually being resolved:
update public.snags
  set status = p_status, resolution_note = coalesce(p_note, resolution_note)
  where id = p_snag_id;                          -- ← no resolved_by, no resolved_at

-- its merge children:
update public.snags
  set status = p_status,
      resolution_note = coalesce(p_note, resolution_note),
      resolved_by = case when p_status = 'resolved' then auth.uid() else resolved_by end,
      resolved_at = case when p_status = 'resolved' then now() else resolved_at end
  where parent_snag_id = p_snag_id;              -- ← correct
```

A merged child gets a full resolution record; the parent does not. `resolve_snag` (the niggle path) sets both correctly, so this affects the **serious lane only** — the lane where the audit trail matters most.

**Live impact:** 3 of 11 resolved serious snags have null `resolved_at` and null `resolved_by`. **[verified]**

Consequences:
- The governance CSV export ships a `resolved_at` column that is silently blank for affected rows (`export-csv/route.ts:9`).
- Any time-to-resolve metric is uncomputable for those snags.
- There is no row-level record of *who* signed off a serious incident. `audit_log` has it, but the snag itself does not — and the export reads the snag.

**Fix:** add the two columns to the primary `UPDATE`, and backfill historical rows from `audit_log` where a `status_resolved` entry exists.

---

### 3.3 🟠 HIGH — `RcaStatus` type is missing the `cancelled` state

The Postgres enum has six values; the TypeScript type has five:

```ts
// packages/supabase-queries/src/index.ts:150
export type RcaStatus = 'assigned' | 'in_progress' | 'submitted' | 'accepted' | 'rejected';
```
```
rca_status enum (live): assigned, in_progress, submitted, accepted, rejected, cancelled
```
**[verified — read enum from live DB]**

`cancelled` was added by `20260703000100_rca_cancelled_enum.sql` and the type was never updated. TypeScript therefore believes a state that occurs in production cannot occur, and `RcaPanel` has no branch for it — a cancelled RCA renders as "Not started" with no indication that an analysis was assigned and abandoned. On SNAG-00028 the entire cancelled round (assigned 16 Jul, cancelled 19 Jul) is invisible in the UI. **[verified]**

**Fix:** add `'cancelled'` to the union, then let the compiler find the unhandled branches. Show cancelled rounds in the panel's history — abandoning an incident analysis is exactly the kind of event an H&S audit asks about.

---

### 3.4 🟠 HIGH — `getSiteBreakdown` swallows its error and renders it as "No sites yet"

```ts
// packages/supabase-queries/src/index.ts:99-103
const { data, error } = await client.rpc('get_site_breakdown', { p_org_id: orgId });
if (error || !data) {
  if (error) console.error('getSiteBreakdown error:', error);
  return [];                       // ← indistinguishable from "org has no sites"
}
```

The RPC throws hard when `p_org_id` does not match `current_org_id()`. `AdminDashboardScreen` passes `profile.org_id` (line 72) — the *mirror* column — while the RPC compares against `user_active_org`. These are kept in sync by the membership RPCs, and they agree for all four users today **[verified]**, but any drift produces a thrown RPC, a swallowed error, an empty array, and a card reading "No sites yet." on an org that has three sites.

The same swallow-to-empty pattern is in `getOrgStats`, `getOrgSnagTrend`, `getCorrectiveActions`, `getOrgDocuments` and `getSnagAuditLog`. On mobile `console.error` goes nowhere a user or operator will see.

**Fix:** return `{ data, error }` from these query wrappers and let screens distinguish "empty" from "failed", with a retry affordance. At minimum, pass `current_org_id()`-derived org rather than `profiles.org_id` — better still, drop the redundant parameter and have the RPC use `current_org_id()` directly.

---

### 3.5 🟡 MEDIUM — `deleteDocumentAction` ignores the RPC result and trusts a client-supplied path

```ts
// apps/web/src/app/(portal)/documents/actions.ts
const filePath = String(formData.get('filePath') ?? '');   // hidden form field
await deleteOrgDocument(supabase, documentId);             // ← result discarded
await supabase.storage.from(BUCKET).remove([filePath]);    // runs regardless
```

Two problems. First, if `delete_org_document` fails the storage object is deleted anyway, leaving a metadata row pointing at nothing. Second, `filePath` arrives from a hidden field rather than being read from the document row, so it is not cross-checked against `documentId`.

The blast radius is contained — the bucket's DELETE policy requires `foldername(name)[1] = current_org_id()` and a supervisor/admin role **[verified — read storage policy]** — so this is same-org, same-privilege, not a privilege escalation. It is still a real integrity bug.

**Fix:** check the RPC's error before touching storage, and derive `file_path` server-side from the document row.

---

### 3.6 🟡 MEDIUM — Null `p_org_id` slips past the org guard in `get_org_stats` and `get_site_breakdown`

```sql
if p_org_id is distinct from public.current_org_id() then raise exception ...
```

`null is distinct from null` evaluates to **false**, so a caller with no active org passing `p_org_id => null` passes the guard. Both functions then return harmless empty/zero results (`where org_id = null` matches nothing), so there is no data exposure today — but it is a guard that does not fail closed, repeated in two places. **[reasoned — SQL semantics]**

**Fix:** `if p_org_id is null or p_org_id is distinct from public.current_org_id() then ...`

---

### 3.7 🟡 MEDIUM — `create_snag` exists as two overloads

Both are live:

```
create_snag(p_kind, p_description, p_severity, p_photo_paths text[], p_latitude, p_longitude, p_site_id, p_work_group_id)
create_snag(p_kind, p_description, p_severity, p_photo_path  text,   p_latitude, p_longitude, p_site_id)
```

The 7-arg single-photo form is a compatibility shim (`20260708120000_create_snag_compat.sql`) that no current client calls — `apps/mobile` uses the 8-arg form exclusively (`lib/supabase.ts:530`). PostgREST resolves overloads by argument names, so this works, but it is a live footgun: a future caller omitting `p_work_group_id` silently binds to the legacy single-photo function and loses every photo after the first. **[verified — both present in `pg_proc`]**

**Fix:** drop the compat overload once no old app builds remain in the field.

---

### 3.8 🟡 MEDIUM — Two RPCs are fully implemented but unreachable

`escalate_snag(p_snag_id)` and `delegate_snag_approver(p_snag_id, p_approver_id)` exist, are granted to `authenticated`, and have **no caller anywhere** in `apps/mobile`, `apps/web`, `packages/`, or `supabase/functions`. **[verified — grepped all TS/TSX]**

The supporting columns are on `snags` and typed in `shared-types` (`escalated_by`, `escalated_at`, `approver_id`). Niggle escalation in particular is a designed feature (`20260621220415_niggle_escalate.sql`) — a worker flagging that a fixit is actually a hazard — that users currently cannot invoke.

**Decision needed:** wire escalation into `ManageIssuePanel` (it is a natural companion to the existing recategorise action), or drop the RPC and columns. Leaving it half-built is the worst of the three.

---

### 3.9 🔵 LOW — `snags` page has no pagination

`apps/web/.../snags/page.tsx:31` caps at `.limit(100)` with no paging control and no indication that results were truncated. Fine at 33 snags; wrong at 500.

### 3.10 🔵 LOW — Unvalidated date params in the CSV export

`export-csv/route.ts` passes `searchParams.get('start' | 'end')` straight into PostgREST filters. Not injectable (PostgREST parameterises), but a malformed date returns a raw Postgres error string to the user via the redirect. Validate and fall back to the 90-day default.

### 3.11 🔵 LOW — `get_invite_preview` returns the invitee's email with no status or expiry filter

The RPC is intentionally anon-executable (it powers the pre-signup invite preview), and the token is an unguessable UUID. But it returns `i.email` and applies no `status`/`expires_at` predicate, so a revoked or long-expired invite still previews the address it was sent to. Filter to `status = 'pending' and expires_at > now()`.

---

## 4. Security review

**Overall: strong.** The core model is sound and I found no exploitable vulnerability. Specifically verified as correct:

- **No over-permissive RLS.** Every policy in `public` references `current_org_id()`, `auth.uid()`, `current_role()`, `org_id` or `user_id`. A query for policies lacking all of these returned zero rows. **[verified]**
- **Writes are RPC-only.** The investigation/RCA/debrief tables have SELECT policies only; all mutation goes through `SECURITY DEFINER` functions that re-check role and org.
- **`notify-snag` is correctly locked down** despite `verify_jwt: false` — it rejects any request without the vault-stored shared secret before doing anything (`index.ts:100-101`). The `verify_jwt: false` is necessary because it is called from `pg_net` inside the database. **[verified]**
- **Both export edge functions re-check role server-side** against the caller's own JWT before switching to the service-role client (`export-investigation` → supervisor/admin; `export-governance-report` → officer_admin). **[verified]**
- **Storage buckets are all private** and org-folder scoped.
- **The serious-lane resolve gate is server-enforced** — checklist, witness, evidence, root cause and verified corrective actions are all checked in `update_snag_status`, not just hidden in the UI.

### Hardening items

**4.1 🟡 Eleven `SECURITY DEFINER` functions are executable by the `anon` role.**

`add_comment`, `create_work_group`, `update_work_group`, `delete_work_group`, `get_my_mentions`, `get_unseen_mention_count`, `mark_all_mentions_seen`, `mark_onboarding_seen`, `get_org_stats`, plus the two intentional ones (`get_invite_preview`, `get_site_by_public_token`).

I checked the bodies: **none is exploitable.** Each depends on `current_org_id()` or `current_role()`, which return null for an anon caller, and each raises before doing work. But this is the security model's last line doing a job the grant should have done first — and it is inconsistent, since `get_site_breakdown` explicitly did `revoke execute ... from public, anon` up front. **[verified]**

**Fix:** `revoke execute on function ... from public, anon` for the nine unintentional ones. Add it to the migration template so new RPCs default closed.

**4.2 🟡 Anonymous sign-ins are enabled project-wide.**

This is *deliberate* — the QR public-reporting flow needs it (`lib/supabase.ts:294-296`), and it is a dashboard-only toggle. It is worth stating the consequence plainly: anyone can mint an `authenticated` JWT without an email, so **every one of the ~98 functions granted to `authenticated` is reachable by an unauthenticated stranger.** The entire security boundary rests on those functions failing closed when `current_org_id()` is null.

The ones I sampled do. But this makes item 4.1 and the null-guard in 3.6 more than hygiene — they are the actual perimeter. Recommend an explicit test that every `authenticated`-granted RPC rejects a session with no org membership.

**4.3 🟡 Legacy second INSERT policy on `snag-photos`.**

Two INSERT policies coexist: one requiring the first folder segment to be `current_org_id()`, and a legacy one requiring it to be `auth.uid()`. The second lets any member write objects outside the org-folder convention. Those objects are then unreadable via the org-folder SELECT policy but *are* readable via the "photos attached to visible snags" policy — so it is inconsistent rather than leaky. Drop the `auth.uid()` policy. **[verified]**

**4.4 🟡 `public_report_blocks` has RLS enabled and no policies.**

Effectively invisible to all client roles. The abuse-control path still works because `create_public_snag*` and `block_public_reporter` are `SECURITY DEFINER` **[verified — `blockPublicReporter` *is* wired into `ManageIssuePanel.tsx:108`]**, but a table with RLS and zero policies should carry an explicit comment saying so deliberately, or it will be "fixed" by someone later.

**4.5 🔵 `pg_net` is installed in the `public` schema.** Standard Supabase advisory; move to `extensions`.

**4.6 🔵 Leaked-password protection is disabled.** One dashboard toggle; enables HaveIBeenPwned checks on signup.

**4.7 🔵 Two deployed edge functions have no caller.** `worksheet` and `worksheet-import` are ACTIVE on the project with `verify_jwt: true`, and are referenced by zero lines of app code. **[verified]** Undeploy them — live endpoints nobody owns are how attack surface accumulates.

---

## 5. Dead code and removal candidates

| Item | Evidence | Action |
|---|---|---|
| **`award-points` edge function** | Calls `increment_user_points`, which **does not exist** in the database. Not deployed. The `user_points` table was dropped by `20260712050000_drop_orphaned_leaderboard_objects.sql`. **[verified]** | Delete the directory |
| **`UserPoints` interface** | `shared-types/src/index.ts:149-155` — types a dropped table | Delete |
| **`work-group-images` bucket** | Exists with **zero policies and zero objects**; the feature was removed by `20260712070000_remove_work_group_image_upload.sql` **[verified]** | Drop the bucket |
| **`supabase/schema.sql` + 9 root `migration_*.sql` files** | Prototype scaffold for the dead `hduecjwnrucbinopnzwb` project. `CLAUDE.md` already warns "do not run against Snagv1" | Move to `supabase/_legacy/` or delete — a warning comment is weaker than not shipping the file |
| **`status_sorted` audit label** | `supabase-queries/src/index.ts:330` — status retired Jul 7 | Keep. Historical `audit_log` rows still carry it (5 exist **[verified]**) and would render as raw text without it. The comment already explains this |
| **`Profile.removed_at`** | Marked deprecated in `lib/supabase.ts:56-59` but still in the type and still optional | Remove from the type |
| **`create_snag` 7-arg overload** | See 3.7 | Drop after old builds expire |
| **4 empty migration files** | `scratch_connectivity_test` + its drop, and the two `temp_notify_debug_log` pairs — create-then-drop pairs that net to nothing | Harmless; leave (migration history should be immutable) |

---

## 6. UI / UX

### 6.1 🟠 The dashboard measures inputs, not obligations

"Outstanding Work" currently answers *"what has been reported?"* (open investigations, unassigned, overdue actions). A safety manager's actual question is *"what do I owe, and what is late?"* Those diverge badly — §3.1 is the proof, and it is not a one-off: **debriefs and corrective actions have the same shape of gap.** There are 11 debriefs and 41 checklist completions in the database, and the dashboard measures neither completion rate.

**Recommended redesign** of the card into four obligation-shaped counts:

| Column | Definition |
|---|---|
| Unassigned | as today |
| Open investigations | as today |
| **RCA outstanding** | resolved/rca_pending serious snags with no accepted RCA and no waiver (§3.1) |
| Overdue actions | as today |

with each count tappable to the underlying list. The existing tap-to-expand quick-assign pattern on "Unassigned" is genuinely good — extend it rather than inventing a new interaction.

### 6.2 🟠 A permanently pending step nobody can clear

Every resolved serious snag shows a `pending` "Root Cause" chip forever unless an RCA is accepted (§3.1). Ten snags currently display this. A progress indicator that can never reach done trains users to ignore progress indicators. Fixed by the "RCA not required" waiver in §3.1 — the UI change and the data change are the same change.

### 6.3 🟡 GET route handlers that write, behind prefetching links

`/reports/export-csv` is a `GET` that uploads a file to storage and inserts a `governance_reports` row. It is linked from the Reports page via `LinkButton`, which wraps `next/link` — and App Router prefetches links on viewport entry in production.

I could **not confirm this fires** — both the `governance-reports` bucket and the `governance_reports` table are empty, meaning the export has never been run at all **[verified]**. So treat this as an untested path with a plausible failure mode rather than a demonstrated bug. **[reasoned]**

**Fix regardless:** make exports `POST` form submissions. A button that writes should not be a link. Set `prefetch={false}` as an interim measure.

### 6.4 🟡 `/reports/export` has no server-side role gate

`export-csv/route.ts` calls `requireSupervisorOrAdmin()`; `export/route.ts` only checks that a user exists and relies on the edge function's own `officer_admin` check. Route handlers do **not** inherit `(portal)/layout.tsx`, so the layout gate does not cover either file. The edge function does enforce it, so this is not a hole — but the inconsistency between two sibling files is how holes get introduced later. Add the gate to both.

### 6.5 🟡 `CLAUDE.md` describes a stub that is fully built

> `documents/` is a deliberate stub pending decision D2

The documents page has upload, signed-URL download, category, delete, and an RLS-backed bucket. Documentation drift on the file that onboards every future contributor. Update it.

### 6.6 🟡 Mobile "Outstanding Work" has no empty-vs-error distinction

Covered mechanically in §3.4; the UX symptom is that a failure and a genuinely new org look identical. Add a distinct error state with retry.

### 6.7 🔵 Smaller items

- **`IssueListScreen.tsx` is 1,392 lines** and `IssueDetailScreen.tsx` 1,077. Both are past the point where the filter/scope logic should be extracted into hooks. No user-visible bug; a velocity tax.
- **`SiteStat` / `SiteCountCell` touch targets.** Tappable counts wrap only the number, which is likely under the 48 px `MIN_TOUCH_TARGET` the design system mandates. Give them padding to reach it.
- **Underline-only tap affordance.** Tappable counts are conveyed by colour + underline alone; a chevron or count-pill would read better at a glance on a phone in a hi-vis glove.
- **No test suite anywhere in the repo.** For a product whose value proposition is a legally-defensible H&S audit trail, the resolve gate in `update_snag_status` and the RCA state machine are the two things most deserving of tests.

---

## 7. Recommended sequence

**Now — correctness and integrity**
1. Fix `update_snag_status` to stamp `resolved_by` / `resolved_at`; backfill from `audit_log` (§3.2)
2. Add `'cancelled'` to `RcaStatus` and handle it in `RcaPanel` (§3.3)
3. Fix `deleteDocumentAction` to check the RPC result and derive the path server-side (§3.5)
4. Null-guard the two org checks (§3.6)

**Next — close the measurement gap**
5. Decide the "RCA not required" waiver model (§3.1) — *this is a product decision and blocks 6*
6. Add `rca_outstanding` to `get_site_breakdown` and both dashboards (§3.1, §6.1)
7. Surface errors instead of empty states in the query wrappers (§3.4, §6.6)

**Then — hardening and hygiene**
8. `revoke execute ... from public, anon` on the nine RPCs; add to the migration template (§4.1)
9. Undeploy `worksheet` / `worksheet-import`; drop the `work-group-images` bucket; delete `award-points` and `UserPoints` (§4.7, §5)
10. Convert exports to POST (§6.3); gate `/reports/export` (§6.4)
11. Drop the legacy `snag-photos` INSERT policy (§4.3)

**Backlog**
12. Decide escalation: wire it up or remove it (§3.8)
13. Paginate the snags list (§3.9)
14. Tests for the resolve gate and the RCA state machine (§6.7)
15. Extract hooks from the two large screens (§6.7)

---

## Appendix — one-line summary of the reported bug

`get_site_breakdown` counts outstanding work by snag *status*, but root-cause analysis is *post-resolution* work by design (`assign_rca` requires `status = 'resolved'`). A resolved serious snag awaiting an RCA therefore matches no column, so the Admin tab reports nothing while the snag's own detail screen shows a pending "Root Cause — Not started" step. Ten snags — four of them `critical` — are in this state today.
