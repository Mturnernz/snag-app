# www.snaghq.co.nz — site content inventory

Every piece of user-visible text on `apps/web` (the Next.js app that serves both the marketing
site and the supervisor portal), by page and by heading, with the file and line to edit.

**Scope note.** This covers `www.snaghq.co.nz` only. `app.snaghq.co.nz` is a *separate* Netlify
site serving `apps/mobile`'s Expo web build, and its copy lives under `apps/mobile/src/` — not
covered here.

**Three things to know before editing:**

1. **Shared vocabulary.** The badge labels, checklist steps, role names, and investigation-mode
   wording live in `packages/shared-types` and `packages/supabase-queries`, and are rendered by
   **both** the portal and the mobile app. Changing them changes both clients. They're collected
   in §C at the bottom.
2. **The `/help` page isn't written in the page file.** It renders
   `packages/onboarding-guide/src/index.ts`, which also generates `SNAG_ONBOARDING_GUIDE.md` and
   the four customer PDFs. Edit that file, then run `npm run guide` and commit the regenerated
   output. See §B7.
3. **Escaped entities.** JSX requires `&apos;` `&rsquo;` `&ldquo;` `&amp;` in place of the literal
   characters. Text below is shown as it renders; keep the escapes when editing the source.

---

## Contents

- **§A — Marketing site** (public, indexed)
  - A1 [`/` Landing page](#a1--landing-page)
  - A2 [`/pricing`](#a2-pricing)
  - A3 [`/sign-up`](#a3-sign-up)
  - A4 [`/sign-up/check-email`](#a4-sign-upcheck-email)
  - A5 [`/privacy`](#a5-privacy)
  - A6 [`/terms`](#a6-terms)
  - A7 [Marketing header & footer](#a7-marketing-header--footer-every-marketing-page)
  - A8 [Site-wide metadata](#a8-site-wide-metadata)
- **§B — Auth, handoff, and portal** (not indexed)
  - B1 [`/login`](#b1-login)
  - B2 [`/forgot-password`](#b2-forgot-password)
  - B3 [`/reset-password`](#b3-reset-password)
  - B4 [`/join/[token]`](#b4-jointoken--invite-acceptance)
  - B5 [`/join/[token]/welcome`](#b5-jointokenwelcome)
  - B6 [`/go/snag/[id]`](#b6-gosnagid--notification-handoff)
  - B7 [`/unauthorized`](#b7-unauthorized)
  - B8 [Portal navigation](#b8-portal-navigation-sidebar--top-bar)
  - B9 [`/dashboard`](#b9-dashboard)
  - B10 [`/snags`](#b10-snags-list)
  - B11 [`/snags/[id]`](#b11-snagsid--snag-detail)
  - B12 [`/reports`](#b12-reports)
  - B13 [`/documents`](#b13-documents)
  - B14 [`/help`](#b14-help)
- **§C — [Shared labels](#c--shared-labels-both-clients)**

---

# §A — Marketing site

## A1 — Landing page

**URL:** `/` · **File:** `apps/web/src/app/(marketing)/page.tsx`

### Page metadata (browser tab + Google result)

| Field | Text | Line |
|---|---|---|
| Title | Workplace health and safety software, New Zealand | 16 |
| — renders as | *Workplace health and safety software, New Zealand \| SnagHQ* | — |
| Description | Workers report hazards from their phone in seconds. Supervisors triage, investigate, and close the loop — with a guided root-cause process for anything serious. | 17–18 |

### Hero (lines 25–50)

| Element | Text |
|---|---|
| Eyebrow | Workplace H&S reporting |
| **H1** | Every workplace hazard,<br>tracked from photo to fix. *(line break is deliberate)* |
| Subhead | Workers report niggles and hazards from their phone in seconds. Supervisors triage, investigate, and close the loop — with a guided root-cause process for anything serious enough to need one. |
| Primary button | Start reporting → `/sign-up` |
| Secondary button | Log in to your org → `/login` |
| Footnote | Built for construction, trades, manufacturing, logistics, and other field-based teams. |

### Hero mockup — the illustrated snag card (lines 108–151)

Decorative (`aria-hidden`), but readable on screen.

| Element | Text |
|---|---|
| Reference line | SN-0187 · Loading Dock B |
| Tag | Serious incident |
| Snag title | Forklift near-miss |
| Snag description | Reversed into pedestrian walkway |
| Checklist item 1 | Area made safe *(ticked)* |
| Checklist item 2 | Evidence captured *(ticked)* |
| Checklist item 3 | Witness statement *(unticked)* |
| Checklist item 4 | Root cause recorded *(unticked)* |
| Gate banner | "Resolved" — blocked. 2 steps remaining. *(count is computed)* |

### "How it works" — 4 numbered steps (lines 153–178)

Eyebrow: **How it works**

| # | Heading | Body |
|---|---|---|
| 1 | Report | Photo, description, 30 seconds. No login needed for one-off reporters — scan the site QR code. |
| 2 | Triage | Auto-routed to the right person or work group. |
| 3 | Niggle → resolved. Serious → gated. | A niggle closes with a note. A serious incident needs checklist, witness, evidence, and root cause first. |
| 4 | Closed, with a record that holds up | Full audit trail, exportable file. |

### Feature cards — 3 across (lines 56–75)

| Heading | Body |
|---|---|
| Two lanes, one system | Everyday niggles (broken gear, small fixes) move fast through triage and resolution. Hazards and incidents route into a guided investigation — make safe, preserve the scene, capture evidence, find the root cause — before they can be closed out. |
| Root cause, not just a ticket | Serious snags carry a structured 5-whys root-cause analysis and corrective actions through to independent verification — closure isn't a single tap. |
| Reporting your officers can stand behind | Every action is logged. Records can't be deleted. Five-year retention, enforced at the database level — not by policy someone has to remember. |

### "Why it matters" — the legal callout (lines 180–200)

| Element | Text |
|---|---|
| Statement | Under the Health and Safety at Work Act 2015, a notifiable event must be reported to WorkSafe — and failing to notify is itself an offence, with fines of up to $50,000 for a business and $10,000 for an individual. |
| Disclaimer | General guidance, not legal advice — confirm with your own adviser. **Source: WorkSafe NZ**. |
| CTA link | This is exactly the kind of record Snag builds automatically → `/sign-up` |

Outbound link (line 8): `https://www.worksafe.govt.nz/notifications/what-events-need-to-be-notified/`

### "Trust & record-keeping" (lines 202–223)

Eyebrow: **Trust & record-keeping**
**H2:** Built to survive scrutiny, not just look tidy.

Three ticked points:
- Row-level security scopes every query to the org and site.
- Every write runs through a permission-checked server function — never a raw edit.
- Every meaningful action writes to an append-only audit log. Once created, a record can't be deleted.

### Pricing teaser — bottom of page (lines 225–238)

| Element | Text |
|---|---|
| **H2** | Free for single-site teams. |
| Body | Straightforward per-organisation pricing as you grow — invite your whole team at no extra cost. Full pricing on the **Pricing page**. |
| Button | See pricing → `/pricing` |

---

## A2 — Pricing

**URL:** `/pricing` · **File:** `apps/web/src/app/(marketing)/pricing/page.tsx`

| Field | Text | Line |
|---|---|---|
| Title | Pricing → *Pricing \| SnagHQ* | 11 |
| Description | Free for single-site teams — unlimited reports, investigations, and the full supervisor portal. Priced per organisation as you grow, never per seat. | 12–13 |

**H1:** Pricing

**Lead:** SNAG is in early access. Two things are settled already, even while the rest is still being worked out with early customers directly.

### Two points

| Heading | Body |
|---|---|
| Free for single-site teams | Unlimited reports, investigations, and the full supervisor portal — no cost while you're on one site. |
| Priced per organisation, not per seat | Invite your whole team — workers, supervisors, admins — without worrying about license count. |

### Closing card

| Element | Text |
|---|---|
| **H3** | Growing past one site? |
| Body | We'll work out straightforward per-organisation pricing with you directly before anything changes — no surprise bill, no per-seat math. |
| Button | Create your organisation → `/sign-up` |

---

## A3 — Sign up

**URL:** `/sign-up` · **File:** `apps/web/src/app/(marketing)/sign-up/page.tsx`

| Field | Text | Line |
|---|---|---|
| Title | Create your organisation | 9 |
| Description | Set up your organisation in a minute. You'll be the first officer admin, and you can invite supervisors and workers once you're in. | 10–11 |

**H1:** Create your organisation
**Lead:** You'll be the first officer admin — you can invite supervisors and workers once you're in.

**Form labels:** Organisation name · Your name · Email · Password
**Submit button:** Create organisation

**Error messages** (`sign-up/actions.ts`):
- `All fields are required.` (line 22)
- `Account created, but the organisation could not be created: <server message>` (line 40)

---

## A4 — Sign up / check email

**URL:** `/sign-up/check-email` · **File:** `apps/web/src/app/(marketing)/sign-up/check-email/page.tsx`
*Not indexed.*

**H1:** Check your email
**Body:** We've sent you a confirmation link. Once you confirm and log in, your organisation will be set up automatically — no extra steps.

---

## A5 — Privacy

**URL:** `/privacy` · **File:** `apps/web/src/app/(marketing)/privacy/page.tsx`

| Field | Text |
|---|---|
| Title | Privacy Policy |
| Description | How SnagHQ handles your organisation's data. Full policy in progress — get in touch and we'll answer directly in the meantime. |

**H1:** Privacy Policy
**Body:** Our full privacy policy is in progress. In the meantime, if you have questions about how SNAG handles your data, get in touch and we'll answer directly.

> ⚠️ Placeholder. This page is indexed and is one of the first things procurement looks for.

---

## A6 — Terms

**URL:** `/terms` · **File:** `apps/web/src/app/(marketing)/terms/page.tsx`

| Field | Text |
|---|---|
| Title | Terms of Service |
| Description | The terms covering use of SnagHQ. Full terms in progress — get in touch before signing up and we'll answer directly. |

**H1:** Terms of Service
**Body:** Our full terms of service are in progress. In the meantime, if you have questions before signing up, get in touch and we'll answer directly.

> ⚠️ Placeholder, same as Privacy.

---

## A7 — Marketing header & footer (every marketing page)

**File:** `apps/web/src/app/(marketing)/layout.tsx`

### Header
Wordmark **SNAG** (links to `/`) · **Pricing** · **Log in** · button **Get started** → `/sign-up`

### Footer

| Element | Text |
|---|---|
| Wordmark | SNAG |
| Tagline | Workplace hazard reporting, from photo to fix. |
| Badge | Built for New Zealand HSWA 2015 |
| Links | Privacy · Terms · Contact (`mailto:hello@snaghq.co.nz`, line 8) |
| Copyright | © *(current year)* SNAG |
| Legal line | Compliance-related content on this site is general guidance, not legal advice. |

---

## A8 — Site-wide metadata

**File:** `apps/web/src/app/layout.tsx`

| Field | Text |
|---|---|
| Default title | SnagHQ — workplace health & safety reporting |
| Title template | `%s \| SnagHQ` |
| Default description | Report hazards from your phone. Investigate, verify, and close them with a record that holds up. Built for New Zealand HSWA 2015. |
| Application name | SnagHQ |
| Locale | en_NZ |

**Naming convention** (layout comment, lines 6–8): *SnagHQ* is this web app — the marketing site
and portal. *Snag*/*SNAG* is the mobile app, used wherever the copy means the phone. The
distinction exists in metadata only; the rendered wordmark is always **SNAG**.

Canonical origin: `https://www.snaghq.co.nz` — `apps/web/src/lib/seo.ts` line 13.

---

# §B — Auth, handoff, and portal

Everything below is `noindex`. Still customer-facing — most of it is what someone sees straight
after clicking an email.

## B1 — Log in

**URL:** `/login` · **File:** `apps/web/src/app/login/page.tsx`

**H1:** Log in
**Lead:** Same account as the SNAG mobile app.
**Labels:** Email · Password
**Link:** Forgot your password?
**Button:** Log in
**Footer:** No account yet? **Create an organisation**

**Errors** (`login/actions.ts`): `Enter your email and password.` · `Incorrect email or password.`

---

## B2 — Forgot password

**URL:** `/forgot-password` · **File:** `apps/web/src/app/forgot-password/page.tsx`

### Before submitting
**H1:** Reset your password
**Lead:** The same account covers the portal and the SNAG app — resetting here changes both.
**Label:** Email · **Button:** Send the link
**Footer:** Remembered it? **Log in**

### After submitting
**H1:** Check your email
**Body:** If that address has a SNAG account, a link to set a new password is on its way. It works in any browser, so opening it on your phone is fine.
**Link:** Back to log in

**Error:** `Enter your email address.`

---

## B3 — Reset password

**URL:** `/reset-password` · **File:** `apps/web/src/app/reset-password/ResetPasswordForm.tsx`
Four states:

| State | Text |
|---|---|
| Checking | Checking your link… |
| **Link expired — H1** | This link has expired |
| Body | Reset links can only be used once, and they don't last long. Ask for a new one and it will work the same way. |
| Link | Send another link |
| **Form — H1** | Set a new password |
| Lead | This changes the password for the portal and the SNAG app together. |
| Labels | New password · Type it again |
| Button | Save the new password / Saving… |
| **Done — H1** | Password updated |
| Body | Use it wherever you work: the supervisor portal, or the SNAG app. |
| Buttons | Open the portal · Open the app |

**Validation errors:** `Use at least 8 characters.` · `Those two don't match.` · `That link is no longer active. Ask for a new one.`

---

## B4 — `/join/[token]` — invite acceptance

**File:** `apps/web/src/app/join/[token]/page.tsx` · Title: **Join your team on SNAG**

The page every invite email links to. Six states:

### Valid invite — new person
**H1:** Join *{Organisation}*
**Lead:** You've been invited to *{Organisation}* at *{Site}* as **{Role}**.
*(Role renders via `ROLE_LABELS` — Crew / Site Lead / Manager. See §C.)*
**Labels:** Your name · Choose a password
**Button:** Create account and join
**Note:** Already have a SNAG account? **Log in** and this invite will be waiting.

### Valid invite — already signed in
**Label:** Your name · **Button:** Accept invite

### Signed in as someone else
**H1:** This invite is for someone else
**Body:** It was sent to **{invited email}**, but you're signed in as **{your email}**.
**Action:** Log in as {invited email}
**Note:** If {invited email} is also you, ask for the invite to be re-sent to the address you actually use.

### Dead ends
Each shows a heading, a message, and the shared note: *Ask whoever invited you to send a new one — they can do that from Manage → Organisation.*

| Heading | Message |
|---|---|
| This invite isn't valid | The link may have been mistyped, or the invite was cancelled. |
| This invite has already been used | Someone has already joined *{Organisation}* with this link. If that was you, just log in. |
| This invite was cancelled | It's no longer valid for *{Organisation}*. |
| This invite has expired | Invites to *{Organisation}* are valid for two weeks, and this one has run out. |

**Errors** (`join/[token]/actions.ts`): `Enter your name so your team knows who you are.` · `Enter your name and a password.`

---

## B5 — `/join/[token]/welcome`

**File:** `apps/web/src/app/join/[token]/welcome/page.tsx` · Title: **You're in**

Where a worker lands the moment their invite is accepted.

**H1:** You're in, at *{Organisation}*
**Lead:** Your account is set up. SNAG lives on your phone — that's where you report problems and see what's happening on your site.
**Button:** Open the SNAG app
**Secondary:** Already have the app installed? Open it directly
**Note:** Add it to your home screen when it opens — SNAG installs from the browser rather than an app store.

---

## B6 — `/go/snag/[id]` — notification handoff

**File:** `apps/web/src/app/go/snag/[id]/page.tsx` · Title: **Open this snag**

The URL every per-snag notification email points at. Supervisors are redirected straight into
the portal and never see this page; everyone else sees:

**H1:** Open this snag
**Lead (signed in):** Your account reports and works on snags in the SNAG app.
**Lead (signed out):** Pick where you want to open it.
**Button:** Open in the SNAG app
**Secondary:** Already have the app installed? Open it directly
**Note (signed in):** The supervisor portal is for supervisors and officer admins. Your account doesn't have that access in this organisation.
**Note (signed out):** Supervisor? **Log in to the portal** to manage it on a desktop.

---

## B7 — `/unauthorized`

**File:** `apps/web/src/app/unauthorized/page.tsx` · Title: **Access restricted**

**H1:** This portal is for supervisors and admins
**Body:** Your account is signed in, but doesn't have supervisor or officer admin access in this organisation. Report and track issues from the SNAG mobile app instead.
**Button:** Back to SnagHQ

---

## B8 — Portal navigation (sidebar + top bar)

**File:** `apps/web/src/components/PortalNav.tsx`

Brand **SNAG** · nav items **Dashboard · Snags · Reports · Documents · Help**
Footer: organisation name (or an org switcher), then `{email} · Officer admin` / `· Supervisor`,
then button **Sign out**. Mobile menu button label: *Open menu*.

---

## B9 — Dashboard

**URL:** `/dashboard` · **File:** `apps/web/src/app/(portal)/dashboard/page.tsx` · Title: **Dashboard**

**H1:** *{Organisation name}* · **Subtitle:** `{n} snags · {n} members`

**Stat tiles:** one per status — Flagged / In Progress / Resolved / RCA Pending (§C).

### Email-health alert (only when mail is failing)
**Heading:** Notification email needs checking
**Body, assembled from parts:**
- `{n} invite(s) in the last {n} hours had no email even attempted.`
- `{n} of {n} notification(s) were refused by the mail provider.`
- Always ends: `Check Resend's dashboard — the app cannot tell you why.`

### Site breakdown
**H2:** By site
**Table headers:** Site · Open investigations · Unassigned · RCA outstanding · Overdue actions
**Empty:** No sites yet.
**Errors:** `Couldn't load organisation figures: {message}` · `Couldn't load the site breakdown: {message}`

---

## B10 — Snags list

**URL:** `/snags` · **File:** `apps/web/src/app/(portal)/snags/page.tsx` · Title: **Snags**

**H1:** Snags · **Subtitle:** *{Organisation name}*
**Filter chips:** All · Flagged · In Progress · RCA Pending · Resolved · **Assigned**
**Row fallback:** `(no description)`
**Gate badges:** `Ready to resolve`, or the first blocking step, or `{n} steps left` (text from §C).
**Button:** Merge selected
**Empty:** No snags match this filter.
**Error:** `Couldn't load snags: {message}`
**Checkbox aria-label:** `Select {reference} to merge`

---

## B11 — `/snags/[id]` — snag detail

**File:** `apps/web/src/app/(portal)/snags/[id]/page.tsx` · Title: **Snag**
The largest body of copy in the portal.

### Header (lines 267–287)
Site name, reference (H1), badges, description, then the meta line:
`Reported by {name} · assigned to {name}` / `· unassigned`, plus optionally
`· merged into another snag` and `· {n} snag(s) merged into this one`.
Undecided badge text: **Notifiable: undecided** · decided-no badge: **Not notifiable**.

### Triage dialog (`apps/web/src/components/TriageDialog.tsx`)
Blocking modal on an unallocated serious snag.

| Element | Text |
|---|---|
| **H2** | Triage this incident |
| Subtitle | *{reference}* — three decisions before anyone can work on it. |
| Question 1 | How will this be investigated? *(options from §C)* |
| Question 2 | Who is running it? |
| Hint | They get the checklist, the witness statements, the evidence and **the root cause** / **the investigation document** — whatever their role. |
| Search placeholder | Search people at this site |
| No matches | Nobody at this site matches "{query}". |
| Selection hint | Assigning to {name}. / Pick someone — the investigation needs a lead. |
| Question 3 | Is this a notifiable event? |
| Option — yes | **Yes — notifiable** · It has to be reported to WorkSafe as soon as possible, and the site preserved. |
| Option — no | **No** · Recorded as reviewed and below the threshold — not as a question nobody asked. |
| Option — defer | **I'm not sure yet** · Nothing is recorded, and this asks again next time. The snag cannot be resolved until it is answered. |
| Submit | Start the investigation |

### "Next step" card (`apps/web/src/components/NextStep.tsx` + `GATE_COPY`, page lines 66–117)

Label **Next step**, then whichever condition is outstanding:

| Heading | Detail | Button |
|---|---|---|
| Decide if this is notifiable | Does it meet WorkSafe's threshold? A notifiable event has to be reported as soon as possible, and the site preserved. | Make the call |
| Finish the first-response checklist | Make safe, preserve the scene, capture evidence, identify witnesses, find the cause. *(prefixed at runtime with "{n} of 5 steps done — ")* | Open the checklist |
| Add a witness statement | Record what someone who was there saw, in their words. | Add a witness |
| Capture evidence | Photos of the scene, the equipment, and anything that explains how this happened. | Add evidence |
| Record the root cause | What actually caused this — not what went wrong, but why it could. | Record root cause |
| Close the corrective actions | Each one needs completing and verifying before this can close. *(replaced at runtime with "{n} still open — each needs completing and verifying.")* | Open corrective actions |
| Attach the investigation document | This snag is using your organisation's own investigation process, so the completed document is what closes it. | Attach the document |
| Accept the investigation document | A supervisor has to read it and sign it off — attaching a file is not the same as accepting the investigation. | Review the document |
| Review the 5 Whys | The analysis has been submitted and is waiting on you to accept it or send it back. | Open the analysis |
| Waiting on the 5 Whys analysis | It's with {name}. This can't close until the analysis is submitted and accepted. | Open the analysis |

Footer of the card: `Resolve — blocked, {n} step(s) remaining`

**Ready state:** label **Ready to resolve** · **H2** Everything's recorded · body *The checklist,
witness, evidence, root cause, and corrective actions are all complete.* · button **Resolve this snag**

### Closed-early banner (lines 291–336)
**Heading:** Closed with the investigation incomplete
**Detail:** `Outstanding when it was closed: {conditions}.` then the recorded reason and author.
**If no reason was recorded:** `Still outstanding: {conditions}. No reason was recorded — this snag was closed before the app asked for one.`
**Label:** Why was this closed? · **Placeholder:** Why was this closed here? · **Button:** Record why

### Section: Notifiable Event
Summary: *Flagged as notifiable* / *Not notifiable* / *Needs a decision*
**Question:** Does this need reporting to WorkSafe?
Decided-yes: *Flagged as notifiable — it has to be reported as soon as possible, and the site preserved.*
Decided-no: *Reviewed and recorded as not notifiable.*
Undecided: *Undecided. This has to be answered either way before the snag can be resolved.*
Buttons: **Yes — notifiable** · **No** · (once decided) **This isn't notifiable after all** / **Actually, this is notifiable**

### Section: Make safe & preserve scene
Summary: `{n} of 5 done` · items from `CHECKLIST_STEP_LABELS` (§C) · button `Mark "{step}" done`

### Section: Witnesses
Summary: *None recorded* / `1 statement · {name}` / `{n} statements`
**Labels:** Who saw it? · What did they see? · Signed statement or scan (optional) · …or one already in the document library
**Placeholders:** Their name · In their own words — not your summary of it
**Dropdown default:** None · **Button:** Add witness statement

### Section: Evidence
Summary: *None captured* / `{n} item(s)`
**Labels:** Photo or document · …or one already in the document library · What does this show?
**Placeholder:** e.g. Walkway markings worn away at the dock corner
**Caption field placeholder:** What does this show? · aria-label *Evidence caption*
**Buttons:** Add evidence · Save · Remove · fallback text *Evidence (no caption)*

### Section: Investigation document *(document mode only)*
Summary: *Accepted* / *Attached — awaiting sign-off* / *Not attached*
**Lead:** This snag is being investigated under your organisation's own process. The completed document takes the place of the root cause and corrective actions — everything before this point still applies.
**Meta:** `Attached by {name} · accepted by {name}` / `· not yet accepted`
**Button:** Accept this document
**Empty:** No investigation document attached yet.
**Upload card:** heading *Upload the completed investigation* · labels File, Title · placeholder `Investigation report — {reference}` · button **Upload and attach** / **Replace with a new upload**
**Upload footnote:** It's filed in the document library too, so it can be found later by someone who wasn't involved.
**Library card:** heading *Or attach one already in the library* · label Document · placeholder *Choose a document* · button **Attach**
**Acceptance footnote:** Replacing the document clears this acceptance — a different document is a different investigation.

### Section: Root cause *(snag mode only)*
Summary: *Recorded* / *Not recorded*
**Label:** What actually caused this?
**Placeholder:** e.g. No physical separation between forklift routes and the pedestrian walkway
**Button:** Save root cause / Update root cause

### Section: Corrective actions *(snag mode only)*
Summary: `{n} open` / *All closed* / *None yet*
**Row meta:** `{owner} · due {date} · verified/{status}` · unassigned fallback *unassigned* · no date fallback *no date*
**Buttons:** Mark complete · Verify · Create corrective action
**Labels:** What needs doing? · Owner (*Choose someone*) · Due date

### Section: 5 Whys analysis
Summary: *Not assigned* / *Available once resolved* / *Submitted — awaiting review* / *Sent back — needs another look* / *Accepted* / *Cancelled* / `With {name}` / *In progress*
**Empty:** A 5 Whys analysis can be assigned once this snag is resolved.
**Assign:** label *Assign the analysis to* · *Choose someone* · button **Assign analysis**
**Rejection banner:** `Sent back: {note}`
**Premise line:** `Why {n} of 5 · asked of: {previous answer}` (falls back to *the incident*)
**Labels:** Why did this happen? *(first)* / Why did that happen? *(subsequent)* · The answer
**Placeholders:** e.g. Why did the forklift enter the walkway? · Because…
**Hint:** The next why is asked of this answer, so keep it to the one cause that mattered.
**Buttons:** Save why {n} · Submit for review · Accept · Send back → *What needs another look?* → **Send it back** · Reassign → *New assignee* → **Confirm reassign** · Cancel analysis

### Section: Debrief
Summary: *In progress* / `{n} completed` / *None yet — optional*
**Card heading:** Debrief — in progress · completed card: *Debrief · completed*
**Subheadings:** Findings · Lessons learned · Who was there ({n})
**Placeholders:** Add a finding · Add a lesson learned · dropdown *Add attendee*
**Buttons:** Add · Start debrief · Complete debrief

### Section: Manage
Summary: `{status} · {owner or "unassigned"}`
**Buttons:** Re-flag · Mark In Progress · Unmerge · Resolve · Save · Save allocation
**Niggle resolve:** label *Resolution note* · placeholder *What was done to fix this?* · button **Resolve**
**Blocked line:** `Resolve is blocked — {reason}` (reasons in §C)
**Close-without-finishing card:**
- Heading: Close without finishing
- Detail: `Still outstanding: {conditions}.` Your reason is recorded against this snag with your name and today's date, and stays on it.
- Label: Why is this being closed now?
- Placeholder: e.g. Contractor left the site and cannot be reached for a statement; hazard removed and area barricaded.
- Button: Record and close

**Mode locked notice:** Investigated using **the SNAG investigation** / **your organisation's own process**. Work has been recorded against it, so this can no longer be changed.
**Mode override warning (officer admin):** This investigation is already under way. Changing it now leaves the work already recorded counting for nothing, and is recorded against your name.
**Fieldset legend:** How will this be investigated?
**Other fields:** Owner (*Unassigned*) · Kind · Severity (*None*)

### Section: Comments
Summary: *None yet* / `{n}` · empty *No comments yet.* · placeholder *Add a comment* · button **Post** · unknown author fallback *Unknown*

### Section: Activity
Summary: `{n} event(s)` · entries render as `{actor name or "System"} {action}`.
Action wording comes from `describeAuditAction` in `packages/supabase-queries/src/index.ts`.

---

## B12 — Reports

**URL:** `/reports` · **File:** `apps/web/src/app/(portal)/reports/page.tsx` · Title: **Reports**

**H1:** Reports · **Subtitle:** *{Organisation name}*

| Section | Text |
|---|---|
| Card 1 heading | Trend — last 90 days |
| Card 1 subtitle | Snags reported per week |
| Card 1 empty | No snags in this period. |
| Card 2 | By status |
| Card 3 | By kind |
| Card 4 | By severity |
| Export buttons | Governance report (PDF) · Raw data (CSV) |
| Non-admin note | Governance report export is available to officer admins. |
| Error | `Couldn't load report figures: {message}` |

Bar labels come from the shared status/kind/severity labels in §C.

---

## B13 — Documents

**URL:** `/documents` · **File:** `apps/web/src/app/(portal)/documents/page.tsx` · Title: **Documents**

**H1:** Documents
**Subtitle:** Policies, certificates, and other org-wide files — visible to everyone in *{Organisation}*.

**Upload form:** labels Title · Category (optional) · File
**Placeholders:** e.g. Site induction handbook · e.g. Policy, Certificate, Induction
**Button:** Upload
**Row meta:** `{category} · Uploaded by {name} on {date}` · unknown uploader fallback *unknown*
**Delete aria-label:** `Delete {title}`
**Empty:** No documents yet.

---

## B14 — Help

**URL:** `/help` · **File:** `apps/web/src/app/(portal)/help/page.tsx` · Title: **Help**

### Written in the page file
**H1:** Help & guide
**Subtitle:** How SNAG works, written for your role — you're a *{Crew/Site Lead/Manager}* in *{Organisation}*.
**Download card:** heading *Print it for your crew* · hint *The full guide, plus a handout per role — leave them in the crib room or hand them out at an induction.*
**Buttons:** Full guide · Crew · Site Lead · Manager
**Nav heading:** Contents · **Footer:** `Guide version {n}`

### Written elsewhere — the guide body

> **Edit `packages/onboarding-guide/src/index.ts`, then run `npm run guide` and commit the
> regenerated `SNAG_ONBOARDING_GUIDE.md` and the four PDFs in `apps/web/public/`.** The same
> source feeds the mobile Help screen and the printed handouts, so all three stay in step.
> `apps/mobile/src/lib/onboardingGuide.test.ts` will fail if a gate condition is added without
> being documented.

Sections, in order (only those tagged for the reader's role are shown):

| # | Section | Summary | Shown to |
|---|---|---|---|
| 1 | What SNAG is | Two lanes — everyday niggles and serious incidents — kept deliberately apart. | All |
| 2 | Getting in — accounts, joining, and roles | Create an account, join your workplace, and understand what your role can do. | All |
| 3 | The app and the portal | Which of the two you use, and why crew work happens in the app. | All |
| 4 | Reporting a snag | The everyday lane — broken gear and better ideas. Under a minute. | All |
| 5 | Reporting a serious incident | Injuries, near-misses and hazards — and what happens once you press submit. | All |
| 6 | Your snag list, comments and mentions | Finding what needs you, and talking to people on a snag. | All |
| 7 | Public and QR reporting | Letting visitors, contractors and subbies report without an account. | Staff |
| 8 | Triage — allocating a serious snag | The three questions you answer the first time you open a serious snag. | Staff |
| 9 | Running an investigation | The steps on a serious snag, in the order they are worked — and who can do each. | All |
| 10 | Closing a serious snag | The resolve gate — the conditions, and the one way to close without meeting them. | Staff |
| 11 | 5 Whys and the debrief | The formal analysis, who it goes to, and what you do with the answer. | All |
| 12 | Working the niggle lane | Assigning, resolving and merging everyday snags. | Staff |
| 13 | The document library | Your organisation-wide register of policies, procedures and completed investigations. | All |
| 14 | The portal | Dashboard, snags, reports and documents at a desk. | Staff |
| 15 | Day one — setting up your organisation | The checklist for the Manager standing SNAG up for the first time. | Manager |
| 16 | Notifications — what lands in whose inbox | The emails SNAG sends, and who gets each one. | — |
| 17 | Records and retention | What SNAG keeps, for how long, and why. | — |
| 18 | Training your crew | A 15-minute toolbox talk that gets people reporting. | — |

Callout headings inside those sections (the boxed asides), for orientation:
*One organisation, two ways in* · *Manager is the owner role* · *Being a Site Lead means belonging
to the site* · *Crew cannot sign in to the portal* · *Good descriptions get fixed faster* · *What
happens after you submit* · *Reporting is not the emergency response* · *Regenerating a code
invalidates the printed one* · *"Our own process" is a substitution, not a shortcut* · *You may
defer the notifiable question — but only that one* · *The mode locks once work starts* · *Take the
evidence first* · *Crew investigators use the app* · *Attaching is not accepting* · *A resolved
serious snag can still owe you an analysis* · *If you have been asked to do one* · *Merging never
closes a serious snag for you* · *Investigation documents go here too* · *Serious incident owners
are not optional* · *Free for single-site teams* · *A site with reports on it cannot be deleted* ·
*Check your spam folder on day one* · *The message that makes it work*

---

# §C — Shared labels (both clients)

Changing anything in this section changes **the portal, the mobile app, and the printed guide**
together. That's usually what you want — but it is never a portal-only edit.

### Status labels — `packages/shared-types/src/index.ts` line 287
`Flagged` · `In Progress` · `Resolved` · `RCA Pending`

### Severity labels — line 294
`Minor` · `Moderate` · `Injury` · `Critical`

### Kind labels — line 301
`Fixit` · `Improvement` · `Hazard` · `Incident`

### Role labels — line 308
| Internal role | Customer-facing label |
|---|---|
| `worker` | **Crew** |
| `supervisor` | **Site Lead** |
| `officer_admin` | **Manager** |

> Note the mismatch: the portal sidebar and `/unauthorized` say "Supervisor" and "Officer admin"
> (the internal names), while invites, `/help` and the PDFs say "Site Lead" and "Manager". Worth
> deciding on one vocabulary.

### Relevance reasons — line 314
`RCA Pending` · `Assigned` · `Tagged` · `Reported`

### Checklist steps — line 323
1. Make the area safe
2. Preserve the scene
3. Capture evidence
4. Identify witnesses
5. Find the root cause

### Investigation mode options — line 355
| Title | Detail |
|---|---|
| SNAG's guided investigation | Root cause, then corrective actions, tracked in the app. |
| Our own process | Attach the completed investigation document. A supervisor has to accept it before this snag can be resolved. |

### Resolve gate — blocking reasons — `packages/supabase-queries/src/index.ts` line 481
Shown as `Resolve is blocked — {reason}` and as the badge on the snags list.

- Decide if this is a notifiable event
- Finish the checklist ({n}/5)
- Add a witness statement
- Add evidence
- Record a root cause
- Close corrective actions
- Attach the investigation document *(document mode)*
- A supervisor must accept the investigation document *(document mode)*

### Resolve gate — record labels — same file, line 417
Used in the past tense on a closed snag (`Outstanding when it was closed: …`), deliberately worded
differently from the instructions above.

`notifiable decision` · `first-response checklist` · `witness statement` · `evidence` ·
`root cause` · `corrective actions` · `investigation document` · `document acceptance`

### Badge — `apps/web/src/components/Badge.tsx`
`Notifiable`

---

## Quick reference — where to edit what

| I want to change… | Edit |
|---|---|
| Landing page copy | `apps/web/src/app/(marketing)/page.tsx` |
| Pricing | `apps/web/src/app/(marketing)/pricing/page.tsx` |
| Privacy / Terms | `apps/web/src/app/(marketing)/{privacy,terms}/page.tsx` |
| Header, footer, contact email | `apps/web/src/app/(marketing)/layout.tsx` |
| Browser titles, meta descriptions | each page's `export const metadata`, plus `apps/web/src/app/layout.tsx` |
| Canonical domain | `apps/web/src/lib/seo.ts` line 13 |
| Login / password copy | `apps/web/src/app/{login,forgot-password,reset-password}/` |
| Invite emails' landing page | `apps/web/src/app/join/[token]/` |
| Portal nav labels | `apps/web/src/components/PortalNav.tsx` |
| Snag detail copy | `apps/web/src/app/(portal)/snags/[id]/page.tsx` (+ `GATE_COPY` at line 66) |
| Triage dialog | `apps/web/src/components/TriageDialog.tsx` |
| The help guide, and the PDFs | `packages/onboarding-guide/src/index.ts`, then `npm run guide` |
| Badge / status / role / checklist words | `packages/shared-types/src/index.ts` — **affects mobile too** |
| Resolve-gate wording | `packages/supabase-queries/src/index.ts` — **affects mobile too** |
