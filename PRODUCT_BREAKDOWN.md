# Snag — Product Breakdown

A full reference map of the Snag mobile app **as it exists today**, for use in later
product / design / simplification assessments. Snag is a workplace health & safety
incident-management app for NZ small multi-site businesses (HSWA 2015), built with
Expo / React Native + TypeScript on Supabase (RPC-only writes behind RLS).

**Scope of this document:** the mobile app in this repo. Where a capability lives only in
the database/server (RPCs, triggers, edge functions) with no mobile UI, it is documented in
a clearly-marked *"Intended / server-only"* form so the gap between what's shipped and what
the backend supports is visible. The separate `apps/web` Vite app and the PDF/AcroForm edge
functions are referenced only where they affect mobile behaviour.

> **Two headline facts to read first**
> 1. **The serious-incident investigation workflow (RCA / 5-Whys, witness statements,
>    evidence, corrective actions, first-response checklist, debriefs) has a complete
>    server model but *no mobile UI whatsoever*.** `src/lib/supabase.ts` wraps none of those
>    RPCs. A serious snag can be *created* and *triaged* on mobile but **cannot be resolved**
>    from the app (the server blocks `resolved` until the investigation is complete, and
>    there is no screen to complete it).
> 2. **Niggle status changes are also effectively unavailable in-app.** The only status
>    control (`ManageIssuePanel`) calls `update_snag_status`, which the server **rejects for
>    the niggle lane** ("Niggles use `resolve_snag` instead") — and `resolve_snag` is not
>    wrapped in the client. So the panel's Status dropdown only does anything for serious
>    snags, and even then only for the `flagged ↔ in_progress` transitions.

---

## 1. Overview & Role Model

### Roles
Three roles, defined by the live `user_role` enum and surfaced in `ROLE_LABELS`:

| Role | Label | Capability posture |
|---|---|---|
| `worker` | Worker | Report snags, view/list, comment & vote on own-org snags, earn points. |
| `supervisor` | Supervisor | Everything a worker can do **+** the Admin tab, triage panel (status/type/severity/owner) on IssueDetail, view Reports. |
| `officer_admin` | Officer Admin | Everything a supervisor can do **+** Manage Organisation (rename, invite, members/roles, sites, QR, public mode). |

Roles come from **`org_memberships`** (multi-org). The **active** org's role is mirrored onto
`profiles.org_id` / `profiles.role`; `current_org_id()` / `current_role()` read the active
membership server-side. A user can belong to several orgs and switch the active one.

### The fourth, implicit actor: the public reporter
A signed-in user with **no organisation** (`profiles.org_id` is null) who submits to
*public* organisations and sees only their own reports. Represented in the app by:
- `publicReporter` state in `App.tsx` (persisted as AsyncStorage `snag.publicReporterMode`),
  which lets a no-org session into the main navigator.
- A cross-org **report target** (`ReportTargetContext`) when any user submits to an org they
  don't belong to.

### App-level gating (`App.tsx`)
The root component chooses what to render before the navigator ever mounts:

```
loading spinner
  └─ no session ........................ AuthScreen
  └─ session, no org, not publicReporter  OrgSetupScreen (choose/create/join/scan/public)
  └─ session, isNewAdmin flag .......... AdminSetupScreen (set your name)
  └─ otherwise ......................... RootNavigator (tabs + stack)
```

`RootNavigator` receives `userRole` (defaults to `'worker'` for public reporters, which
role-gates the Admin tab away).

---

## 2. Route Map

Navigation splits into **onboarding screens rendered directly by `App.tsx`/`OrgSetupScreen`
(outside React Navigation)** and the **React Navigation tree** (`src/navigation/index.tsx`).

### 2a. Onboarding / auth (outside the navigator)

| Screen (file) | Rendered when | Roles | Entry points |
|---|---|---|---|
| `AuthScreen` | No session | anyone (unauthenticated) | App launch when signed out |
| `CreateOrgAccountScreen` | sub-view of AuthScreen | prospective admin | AuthScreen → "Create an organisation" |
| `ScanJoinCodeScreen` (pre-auth) | sub-view of AuthScreen | prospective worker | AuthScreen → "Scan your company's QR code" |
| `OrgSetupScreen` | Session, no org, not public reporter | signed-in, org-less | App.tsx fallback for a no-org session |
| `OrgChoiceScreen` | mode of OrgSetup | " | OrgSetup default view |
| `OrgCreateScreen` | mode of OrgSetup | " | OrgChoice → "Create organisation" |
| `OrgJoinScreen` | mode of OrgSetup | " | OrgChoice → "Join with invite code" |
| `AdminSetupScreen` | `isNewAdmin` after org creation | new officer_admin | Set automatically after creating an org |

### 2b. Bottom tab navigator (`MainTabNavigator`)

Initial route = **Report**.

| Tab (route) | Screen | Roles | Notes |
|---|---|---|---|
| Report | `ReportIssueScreen` | all (incl. public reporter) | First screen after login |
| Issues | `IssueListScreen` | all | Title becomes "My Reports" for no-org users |
| Profile | `ProfileScreen` | all | Org switcher, points, sign out |
| Admin | `AdminDashboardScreen` | **supervisor + officer_admin only** | Tab hidden for workers/public reporters |

### 2c. Root stack (pushed screens)

| Route | Screen | Roles | Entry points |
|---|---|---|---|
| `IssueDetail` | `IssueDetailScreen` | all (view); triage = sup/admin | Tap any card in Issues |
| `Reports` | `ReportsScreen` | sup/admin (via Admin tab) | AdminDashboard → "View Reports" |
| `Leaderboard` | `LeaderboardScreen` | all (org members) | Profile → "View Leaderboard" |
| `ReportIncidentDetails` | `ReportIncidentDetailsScreen` | all org members | Report → "Report a Serious Incident" |
| `ReportIncidentReview` | `ReportIncidentReviewScreen` | all org members | ReportIncidentDetails → "Next: Review" |
| `ScanOrgCode` | `ScanJoinCodeScreen` (post-auth) | all | Profile → "Scan QR to join or switch" |
| `ChooseReportOrg` | `ChooseReportOrgScreen` | all | Report → "Submit to another organisation…" / org pill / no-org CTA |
| `ManageOrganisation` | `ManageOrganisationScreen` | **officer_admin** (screen self-gates) | AdminDashboard → "Manage Organisation" |

---

## 3. Screen Inventory

Legend for **completeness**: ✅ fully built · 🟡 partial · ⛔ server-supported but no UI.

### Report (`ReportIssueScreen`) — ✅
- **Purpose:** the primary, first-seen action — log a niggle (fixit/improvement) fast; jump-off to the serious lane or a cross-org public report.
- **Primary action:** Submit Report → `createSnag` (kind, description, severity `null`, photoPaths, siteId from `getDefaultSiteId`).
- **Secondary:** active-org pill → switch org (`setActiveOrg`) when >1 membership; "Report a Serious Incident" → serious lane; "Submit to another organisation…" → `ChooseReportOrg`; public path submits via `createPublicSnag`.
- **Reads:** `getProfile` (org_id, org name, has-name), `getMemberships`, `ReportTargetContext`.
- **RPCs/mutations:** `create_snag`, `create_public_snag`, `set_active_org`; photo upload to `snag-photos`.
- **States:** empty = no-org "Who is this report for?" → Choose an Organisation; success = "Snag reported!" with reference; error = Alert; loading = submit spinner + photo-upload disable.

### Report — Serious lane, step 1 (`ReportIncidentDetailsScreen`) — ✅
- **Purpose:** capture a formal H&S incident/hazard (type, what happened, evidence photos, severity).
- **Primary action:** "Next: Review" → stashes an `IncidentDraft` and a submit handler in `IncidentDraftContext`, navigates to review.
- **Reads:** `getProfile` (org_id for photo prefix).
- **RPCs:** none here (submit deferred); photo upload on submit.
- **States:** discard confirm dialog on back with unsaved text; description required (Alert).

### Report — Serious lane, step 2 (`ReportIncidentReviewScreen`) — ✅
- **Purpose:** final review + formal submission of the incident draft.
- **Primary action:** "Submit Incident Report" → `IncidentDraftContext.submit()` → `create_snag` (kind hazard/incident, real severity).
- **Secondary:** Back to Edit; Discard (confirm dialog).
- **States:** success = shield icon, "Incident report submitted" + reference; error = Alert.

### Issues (`IssueListScreen`) — ✅
- **Purpose:** browse/triage the snag queue for the active org (or "My Reports" for no-org users).
- **Primary action:** tap a card → `IssueDetail`.
- **Secondary:** status filter chips (All / Flagged / In Progress / Resolved, plus **Public** for members); sort sheet (Newest / Site / Most commented / Highest voted).
- **Reads:** `snags_with_details` (RLS-scoped), `profiles.org_id`.
- **States:** loading spinner; empty state with "Report a Snag" CTA (only on the "all" filter); pull-to-refresh; refetches on focus (follows active org).

### Issue Detail (`IssueDetailScreen`) — ✅ (view) / 🟡 (manage)
- **Purpose:** full snag view — photos gallery, badges, meta, comments, votes; inline triage for sup/admin.
- **Primary action (member):** vote (`cast_vote`/`remove_vote`), comment (`add_comment`, with `@`-mention picker).
- **Primary action (sup/admin):** `ManageIssuePanel` — stage Status/Type/Severity/Owner then "Update Snag".
- **Reads:** `snags_with_details`, `comments` (+author), `getUserVote`, `getProfile`, `getOrgMembers`, `user_points` (author titles), photo signed URLs.
- **RPCs:** `cast_vote`, `remove_vote`, `add_comment`, `update_snag_status`, `recategorise_snag`, `assign_snag_owner`, `block_public_reporter`.
- **Role branching:** vote bar + comments + comment input shown **only** to members of the snag's own org (`isOrgMember`); public / cross-org viewers get a "The team is on it" note. Manage panel only for supervisor/officer_admin of that org.
- **States:** loading; "Snag not found"; serious snags get a red-toned header + top border ("Health & Safety Report").
- ⚠️ **Manage panel caveat:** Status changes route through `update_snag_status`, which the server **rejects for niggles** and **gates for serious→resolved** (see §7). In practice only serious `flagged↔in_progress`, plus type/severity/owner edits, actually succeed.

### Admin Dashboard (`AdminDashboardScreen`) — ✅
- **Purpose:** at-a-glance org snapshot + jump-off to management and reports.
- **Primary action:** "Manage Organisation" (officer_admin only) → `ManageOrganisation`.
- **Secondary:** "View Reports" → `Reports`.
- **Reads:** `profiles` (+organisation), `getOrgStats`.
- **States:** loading spinner; non-admins see stats + a note that settings are admin-managed; pull-to-refresh; refetches on focus.

### Manage Organisation (`ManageOrganisationScreen`) — ✅
- **Purpose:** the single admin console — rename org, invite, members, sites, QR, public mode.
- **Primary actions / RPCs:**
  - Org name inline edit → `rename_organisation`.
  - Invite (email + role + optional site) → `invite_user`.
  - Members: role change `update_member_role`, remove `remove_org_member` (confirm dialog), pending-invite pills.
  - Sites: `getSitesWithDetail`; create `create_site`; **per-site assignment modal** toggling members (`add_site_member`/`remove_site_member`), supervisors (`assign_site_supervisor`/`remove_site_supervisor`), and a single default owner (`set_site_default_owner`).
  - QR join code + regenerate (`regenerate_org_join_code`, confirm dialog).
  - Public reports toggle + intake site (`set_org_public_mode`).
- **Reads:** `profiles`(+organisation), `getOrgMembers`, `getPendingInvites`, `getSitesWithDetail`.
- **States:** loading; **self-gates** to officer_admin ("Admins only" empty state otherwise); toasts for every mutation; pull-to-refresh.

### Reports (`ReportsScreen`) — ✅
- **Purpose:** read-only org analytics.
- **Reads:** `getOrgStats` (totals + by status/kind/severity), org name.
- **Content:** summary stat boxes, "% still flagged" callout, three bar-chart cards (By Status / Type / Severity).
- **States:** loading; empty ("No snags reported yet").

### Profile (`ProfileScreen`) — ✅
- **Purpose:** identity, personal stats, org switching, sign out.
- **Primary actions:** edit name (`profiles.update`); switch org (`set_active_org`); "Scan QR to join or switch" → `ScanOrgCode`; "View Leaderboard"; Sign Out (confirm).
- **Reads:** `profiles`(+organisation), `user_points`, per-status counts of own snags, `getMemberships`.
- **States:** loading; org list with active check + "Switch"; muted points/title row.

### Leaderboard (`LeaderboardScreen`) — ✅
- **Purpose:** gamified org ranking.
- **Reads:** `user_points` (all-time) or `get_leaderboard` RPC (week/month window).
- **Content:** ranked cards, rank badges, current-user pinned footer when outside top 5.
- **States:** loading; empty ("No scores yet"); pull-to-refresh.

### Choose Report Org (`ChooseReportOrgScreen`) — ✅
- **Purpose:** pick where a report goes — switch to an org you belong to, or target a public org.
- **Primary actions:** member row → `set_active_org` + toast; public org → set `ReportTargetContext` + back; "Recent" row (AsyncStorage).
- **Reads:** `getMemberships`, `searchPublicOrgs`.
- **States:** search filter; empty public-orgs message.

### Scan / Join (`ScanJoinCodeScreen`) — ✅
- **Purpose:** camera QR join/switch; also pre-auth scan and resume-after-signup.
- **Behaviour:** scan → `get_org_by_join_code`; already a member → `set_active_org` ("Now reporting to X"); else name prompt → `join_org_via_code`. Pre-auth mode reports the code back to AuthScreen; `initialCode` mode skips the camera.
- **States:** camera-permission gate; join preview; switch-success; spinner/error in resume mode.

### Auth (`AuthScreen`) — ✅
- **Purpose:** three entry points — Sign In, Scan QR, Create organisation.
- **Primary actions:** `signInWithEmail`; on failure offers "Create an account" (`signUpWithEmail`); scan sub-view; create-org sub-view.
- **States:** intent banner (join/create); inline error/success messages.

### Create-Org Account (`CreateOrgAccountScreen`) — ✅
- **Purpose:** one combined screen — org name + your name + email + password.
- **Primary action:** persist `PendingCreate` intent, `signUpWithEmail`; org auto-created on first authenticated load (App.tsx → `createOrganisationAndOwner`).
- **States:** field validation; "confirm your email, then sign in" message.

### Org Setup / Choice / Create / Join / Admin Setup — ✅ (legacy post-auth path)
- `OrgSetupScreen` is a mode switch (choose/create/join/scan/pendingJoin) for an already-signed-in no-org user. `OrgChoiceScreen` offers Create / Join-with-code / Scan / "Just report an issue" (public) / sign out. `OrgCreateScreen` → `createOrganisationAndOwner(name, '')`. `OrgJoinScreen` → `get_invite_preview` → `accept_invite`. `AdminSetupScreen` collects the admin's name post-create (`updateProfile`).

---

## 4. User Flows (end-to-end)

### 4.1 Auth / onboarding

**A. Create an organisation (pre-auth, the primary path)**
1. AuthScreen → "Create an organisation".
2. CreateOrgAccountScreen: org name + your name + email + password → Submit.
3. `setPendingCreate({orgName,name})` → `signUpWithEmail`.
4. On first authenticated load, `App.tsx` sees the pending-create intent + a no-org profile → `createOrganisationAndOwner` (also creates a **"Main site"** and wires the owner into it) → drops straight into the app. No OrgSetup/AdminSetup detour.

**B. Join via QR (pre-auth)**
1. AuthScreen → "Scan your company's QR code" → scan → org reported back, intent stored.
2. Create account → on first load, resume the scan (`ScanJoinCodeScreen initialCode`) → name → `join_org_via_code`.

**C. Legacy post-auth setup** (a signed-in user who still has no org and no pending intent)
1. `OrgSetupScreen` → OrgChoice → Create (`OrgCreateScreen` → `AdminSetupScreen`) / Join code (`OrgJoinScreen`) / Scan / "Just report an issue" (→ publicReporter mode).

**D. QR-scan-to-switch** (existing member): Profile → Scan → scanning an org you already belong to calls `set_active_org` instead of joining.

### 4.2 Niggle reporting (worker) — *shipped path, with a resolution gap*
1. **Report tab** → confirm active org via pill (switch if needed).
2. Add photo(s), description, pick Type (Fixit/Improvement).
3. Submit → `create_snag` (severity null, site = default). Success screen with reference.
4. Snag appears in **Issues** as `flagged`.
5. *(Triage)* A supervisor/admin opens **IssueDetail** and can reassign owner / recategorise. **Resolution:** the intended two-step *resolve → confirm* (`sorted`) has been **retired**; the terminal state is a single `resolved`. ⚠️ **But** the only status control (`ManageIssuePanel`) calls `update_snag_status`, which the server rejects for the niggle lane — so a niggle currently **cannot be moved to resolved from the mobile app** (would need a `resolve_snag` wrapper that doesn't exist).

### 4.3 Serious incident reporting → investigation (intended)
**Shipped (mobile):**
1. Report tab → "Report a Serious Incident".
2. `ReportIncidentDetails`: Type (Hazard/Incident), what happened, evidence photos, Severity → "Next: Review".
3. `ReportIncidentReview`: confirm → `create_snag` → formal record, `flagged`, notifications fire server-side.
4. In IssueDetail, a supervisor/admin can move it `flagged → in_progress` and set owner/severity.

**Intended / server-only (no mobile UI — all RPCs exist, none wrapped in `supabase.ts`):**
5. **First-response checklist** — `complete_checklist_step(step)` ×5 (`checklist_completions`).
6. **Witness statements** — `add_witness_statement` (lockable) ×≥1.
7. **Evidence** — `add_evidence_item` ×≥1 (`evidence_items`).
8. **RCA (5 Whys)** — `assign_rca` (sets status `rca_pending`) → `save_rca_why(index, why, answer)` ×5 → `submit_rca` → `accept_rca` / `reject_rca(note)`; plus `reassign_rca`, `cancel_rca` (`snag_rca`, `rca_why_steps`).
9. **Root cause** — an `investigations` row (`root_cause_text`, `lead_investigator_id`).
10. **Corrective actions** — `create_corrective_action(desc, owner, due)` → `complete_corrective_action`; all must be closed.
11. **Resolve** — `update_snag_status(..., 'resolved')` succeeds **only** once: ≥5 checklist steps, ≥1 witness, ≥1 evidence, a root cause recorded, 0 open corrective actions, and not currently `rca_pending`.
12. **Debrief** — `start_debrief(hot|formal)` → `add_debrief_attendee` / `add_debrief_finding` / `add_debrief_lesson` → `complete_debrief` (`snag_debriefs`).
13. **PDF export** — `record_investigation_export` + `export-investigation`/`worksheet` edge functions (AcroForm round-trip) — **web app only**.

### 4.4 Triage & delegation (supervisor / officer_admin)
1. Admin tab → AdminDashboard (stats) → or open a snag from Issues.
2. IssueDetail → `ManageIssuePanel`: set **Owner** (delegation, `assign_snag_owner`), **Type**/**Severity** (`recategorise_snag`), **Status** (serious lane only, see caveats).
3. Public submissions expose **Block Reporter** (`block_public_reporter`).
4. Reports screen for org-wide analytics.

### 4.5 Public report (no-org or cross-org)
1. Report tab (no-org user) → "Choose an Organisation" → `ChooseReportOrg`.
2. Search/pick a public org → target set.
3. Report form shows "Reporting to: X" pill, a hazard toggle, optional name → Submit → `create_public_snag` (rate-limited server-side, lazily creates a minimal profile).
4. Reporter sees only their own submissions (Issues → "My Reports"); IssueDetail shows status only, no votes/comments.

---

## 5. Jobs-to-be-Done

### Worker
| Job | Flow / screens | Status |
|---|---|---|
| Log a niggle in under a minute | Report tab quick form | ✅ |
| Report a serious H&S incident as a formal record | Report → Incident Details → Review | ✅ create; ⛔ investigate/resolve |
| See what I've reported & its status | Issues ("My Reports"), Profile stats | ✅ |
| Back a colleague's issue (signal priority) | IssueDetail vote/comment | ✅ (own-org) |
| Join / switch workplace on-site | Profile → Scan QR | ✅ |
| Earn recognition | Profile points, Leaderboard | ✅ |

### Supervisor
| Job | Flow / screens | Status |
|---|---|---|
| Triage the incoming queue | Issues filters/sort → IssueDetail | ✅ |
| Assign an owner (delegate) | ManageIssuePanel → Owner | ✅ |
| Re-classify a mis-filed snag | ManageIssuePanel → Type/Severity | ✅ |
| Move a snag through its lifecycle | ManageIssuePanel → Status | 🟡 serious flagged↔in_progress only; ⛔ resolve |
| Run the H&S investigation | — | ⛔ no mobile UI |
| See org health | Admin → Reports | ✅ |

### Officer Admin
| Job | Flow / screens | Status |
|---|---|---|
| Stand up the org | Create-org onboarding (auto default site) | ✅ |
| Invite the team (optionally to a site) | Manage Organisation → Invite | ✅ |
| Manage members & roles | Manage Organisation → Members | ✅ |
| Structure sites & assign people | Manage Organisation → Sites | ✅ |
| Distribute a join QR | Manage Organisation → Scan to Join | ✅ |
| Accept public reports | Manage Organisation → Public Reports | ✅ |
| Rename the org | Manage Organisation → name | ✅ |
| Close out serious incidents defensibly | — | ⛔ no mobile UI |

---

## 6. Functions & Features Catalog

| Feature | What it does | Screens | Roles | Completeness |
|---|---|---|---|---|
| Niggle reporting | Fast fixit/improvement capture | ReportIssue | all members | ✅ |
| Serious incident capture | Two-step formal H&S record | ReportIncidentDetails/Review | all members | ✅ |
| Multi-photo evidence | Up to 5 photos to `snag-photos` | PhotoPicker (report screens, detail gallery) | all | ✅ |
| Snag list + filter/sort | Status chips + sort sheet, public queue | IssueList | all | ✅ |
| Voting | Up/down `cast_vote`/`remove_vote`, optimistic | IssueDetail | own-org members | ✅ |
| Comments + @-mentions | Threaded comments, member mention picker | IssueDetail | own-org members | ✅ |
| Triage panel | Status/Type/Severity/Owner staged edits | ManageIssuePanel | sup/admin | 🟡 (status gated — see §7) |
| Delegation | Assign owner | ManageIssuePanel | sup/admin | ✅ |
| First-response checklist | 5 mandatory steps | — | sup/admin | ⛔ server-only |
| Witness statements | Lockable statements | — | sup/admin | ⛔ server-only |
| Evidence items | Investigation evidence set | — | sup/admin | ⛔ server-only |
| RCA / 5 Whys | Assign → answer → submit → accept/reject | — | sup/admin + assignee | ⛔ server-only |
| Root cause | `investigations` record | — | sup/admin | ⛔ server-only |
| Corrective actions | Owned, due-dated, must-close | — | sup/admin | ⛔ server-only |
| Debriefs (hot/formal) | Attendees, findings, lessons | — | sup/admin | ⛔ server-only |
| Serious-lane resolution gate | Blocks `resolved` until investigation complete | (server, enforced) | — | ✅ server / ⛔ no UI to satisfy it |
| Niggle resolution | `resolve_snag` terminal | — | owner/sup/admin | ⛔ RPC exists, not wrapped |
| Org analytics | Totals + status/kind/severity charts | Reports, AdminDashboard | sup/admin | ✅ |
| Multi-org membership | Belong to & switch between orgs | Profile, ChooseReportOrg, Scan | all | ✅ |
| Org creation + default site | Auto "Main site" on create | onboarding | admin | ✅ |
| Invites (email) | Role + optional site invite | ManageOrganisation, OrgJoin | admin | ✅ |
| QR join / switch | Scan to join or switch active org | Scan, ManageOrganisation, Profile | all/admin | ✅ |
| Sites management | Create + assign members/supervisors/owner | ManageOrganisation | admin | ✅ |
| Public organisations | Discoverable orgs accept outside reports | ChooseReportOrg, ReportIssue, ManageOrganisation | all/admin | ✅ |
| Block public reporter | Stop abuse from a reporter | ManageIssuePanel | sup/admin | ✅ |
| Points & titles | Gamified recognition | Profile, comments, Leaderboard | members | ✅ (accrues via server events) |
| Leaderboard | Weekly/monthly/all-time ranking | Leaderboard | members | ✅ |
| Notifications | `notify-snag` per-org emails | (server edge fn / triggers) | — | ✅ server-side |
| PDF / AcroForm export | Investigation worksheet round-trip | (web + edge fns) | — | ⛔ not in mobile |

---

## 7. Data & State Model Summary

### Core enums (`src/types/index.ts`, mirroring live Postgres)
- `snag_kind` = `fixit | improvement | hazard | incident`
- `snag_lane` = `niggle | serious` — a **generated, read-only** column (fixit/improvement → niggle; hazard/incident → serious). Recategorising a snag's kind flips its lane.
- `snag_severity` = `minor | moderate | injury | critical`
- `snag_status` = `flagged | in_progress | resolved | rca_pending` — `resolved` is the single terminal state for both lanes (the old `sorted` two-step was retired).
- `user_role` = `worker | supervisor | officer_admin`

### Key entities and how they drive behaviour
- **`organisations`** — `is_public`, `public_intake_site_id`, `join_code`. Drives public mode, QR join, and directory search.
- **`org_memberships`** + **`user_active_org`** — the real role/scope source; `profiles.org_id`/`role` mirror the *active* one. Every list/detail screen refetches on focus so content follows the active org.
- **`sites`** + `site_members` / `site_supervisors` / `site_default_owners` — reporting requires a `site_id`; `getDefaultSiteId` resolves it (member site → org's first site). New orgs always get a "Main site" so reporting works immediately.
- **`snags`** + view **`snags_with_details`** (security-invoker; RLS-scoped) — the read model for list/detail (joins reporter/owner/site names + comment/vote/evidence/checklist counts). `is_public_submission` splits the internal vs public queue.
- **`comments`**, **`votes`** (`cast_vote`/`remove_vote`), **`user_points`** (per-org) — engagement + gamification, own-org only.
- **Investigation cluster (server-complete, mobile-absent):** `checklist_completions`, `witness_statements`, `evidence_items`, `investigations` (root cause), `corrective_actions`, `snag_rca` + `rca_why_steps`, `snag_debriefs`. The `update_snag_status` gate reads these five conditions to allow serious→`resolved`.
- **Writes are RPC-only** behind RLS/SECURITY DEFINER. `current_org_id()`/`current_role()` scope every write to the active org. Client state is React hooks + two contexts (`IncidentDraftContext`, `ReportTargetContext`); no global store.

---

## 8. Friction & Complexity Observations

*Observational only — what's actually there and why it may merit a second look. No recommendations.*

**Resolution is unreachable in-app for both lanes.**
- Niggles: `ManageIssuePanel` → Status calls `update_snag_status`, which raises *"Niggles use `resolve_snag` instead"* for the niggle lane; `resolve_snag` is not wrapped in `supabase.ts`. So changing a niggle's status from the app surfaces a raw server error.
- Serious: `resolved` is gated behind a 5-part investigation that has **no** mobile UI, so the panel's "Resolved" option always fails server-side. The Status control therefore functions only for serious `flagged↔in_progress`. The dropdown nonetheless presents all four statuses for every snag, inviting failing taps.

**A whole product surface exists in the backend but not the app.** The RCA/witness/evidence/corrective-action/checklist/debrief workflow — arguably the core HSWA value proposition — is fully modelled server-side (18+ RPCs, 8 tables) and delivered only through the separate web app. On mobile it is invisible, so the serious lane is effectively "report and forget."

**Two parallel onboarding stacks.** Org creation exists twice: the newer pre-auth `CreateOrgAccountScreen` (from AuthScreen, one combined screen, auto-creates on first load) **and** the older post-auth `OrgChoiceScreen → OrgCreateScreen → AdminSetupScreen` (blank owner name, then a separate name step). Joining likewise exists as pre-auth scan, post-auth `OrgJoinScreen` (paste code), and `ScanJoinCodeScreen`. The paths overlap in purpose and diverge in UX copy and step count.

**Legacy onboarding screens are now largely unreachable.** With the new intent-first auth flow, a signed-in user usually lands in the app directly; `OrgSetupScreen`/`OrgChoiceScreen`/`OrgCreateScreen`/`OrgJoinScreen`/`AdminSetupScreen` are only hit by the residual "signed-in but org-less, no intent" case (e.g. an abandoned setup). They're not dead code, but they're near-orphaned relative to the main path.

**Org switching has three entry points with three mental models.** Active org changes via (a) the Report-screen pill picker, (b) the Profile "Organisations" card, and (c) a QR scan of an org you already belong to. Each re-implements the switch + refetch locally; ChooseReportOrg adds a fourth surface that mixes "switch my org" and "target a public org" in one list.

**Repeated fetch-profile-on-focus pattern.** Most tabs independently run "get user → query `profiles.org_id` → refetch" on focus (IssueList, AdminDashboard, Report, Profile, Reports, IssueDetail). It's the right behaviour for active-org changes but is duplicated ad hoc rather than shared, and each screen re-queries the profile separately.

**Two near-identical "org snapshot" surfaces.** `AdminDashboardScreen` (stat tiles + by-status breakdown) and `ReportsScreen` (stat boxes + by-status/kind/severity bars) both render `getOrgStats` with overlapping content and different chart styles, reachable one tap apart.

**Bottom-sheet org pickers are hand-rolled per screen.** ReportIssue, IssueList (sort), and ManageOrganisation each implement their own `Modal` + backdrop + sheet rather than a shared component, with slightly different styling.

**Role gating is layered and occasionally redundant.** The Admin **tab** shows for supervisor+admin; the "Manage Organisation" **button** shows for admin only; the `ManageOrganisationScreen` **also** self-gates to admin ("Admins only"). A supervisor thus sees an Admin tab whose primary management action is absent, and the screen defends a route they can't reach anyway.

**Severity semantics differ by lane.** Niggles submit with `severity: null`; the serious lane forces a severity. In the triage panel severity is a free-form field ("Not assessed" + 4 levels) independent of lane, so the same control means different things depending on how the snag was created.

**Public vs member behaviour forks inside shared screens.** IssueList (title, `is_public_submission` filter), IssueDetail (votes/comments/manage visibility keyed on `isOrgMember`), and ReportIssue (target pill, hazard toggle, hidden type chips) each carry meaningful `if (member) … else …` branches. The logic is correct but concentrates real complexity in three of the most-used screens.
