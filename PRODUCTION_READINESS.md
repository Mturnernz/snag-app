# SNAG — production readiness

Written 27 July 2026, against `main` @ `e9dc818` plus the branch described in §6.
Updated 29 July 2026 with the investigation-mode work (§4.4a, §4.4b, D8).

What this is: the decisions taken while getting SNAG ready to run for real, why each
one went the way it did, and — in §7 — the decisions that are **not mine to make**,
with options.

Where a claim here is measured, it says so. Where it's reasoning, it says that too.

---

## 1. Where the product stands

| | |
|---|---|
| Backend | Supabase `Snagv1` (`wpkdpukpllxuyqqlxkxf`), `ACTIVE_HEALTHY`, ap-southeast-2 |
| Live data | 3 active orgs · 6 users · 42 snags (22 serious) |
| Mobile | Expo SDK 54, RN 0.81.5, React 19.1.0 |
| Portal | Next.js 16, React 19.1.0 |
| Tests | 55 unit · 149 web E2E (34 of them accessibility) · 27 mobile E2E, plus two opt-in write-path suites |
| CI | 5 jobs on every PR and push to `main`, green |

The repo had **zero automated tests** three days ago. That is the single biggest
change in its production readiness, and everything below assumes it.

---

## 2. The compliance decision (the one that mattered most)

**A serious snag could be resolved, and then sent out for root-cause analysis, with
the WorkSafe notifiable question never answered.**

Under HSWA 2015 a notifiable event must be reported as soon as possible and the site
preserved. "Nobody decided" is the one state the record must not be able to end in —
it is exactly the state that looks fine in an audit until someone asks.

The live data showed what a soft prompt achieves: **10 of 11 resolved serious snags
had no decision recorded at all.**

**Decision:** `update_snag_status` now refuses `resolved` until the decision exists,
and checks it *first* — ahead of the checklist — because it is the condition with a
statutory clock on it. Both clients read the gate in the same order, from one shared
function, so neither can tell someone to do the wrong thing next.

**Deliberately not softened:** the app's "Unsure — flag for follow-up" path persists
nothing, so an unsure snag stays blocked. That is the intent. Unsure means go and
find out, not tick a box.

**Blast radius, measured:** already-resolved snags are untouched (the gate only runs
on the transition). Exactly **1** open serious snag org-wide now needs an answer
before it can close. That was worth the fix.

---

## 3. Bugs found and fixed

Ordered by what they would have cost in production.

| Bug | Why it mattered |
|---|---|
| **`get_site_breakdown` raised `column reference "site_id" is ambiguous`** | Broken for *every* organisation. The dashboard's "By site" panel failed silently in both clients — the page rendered a red line instead of throwing, so it degraded quietly. |
| **The portal could not record "not notifiable"** | The only control read "Mark notifiable". Recording the answer the resolve gate requires meant claiming a notifiable event and retracting it — leaving a `marked_notifiable` entry in the audit log for something that never happened. This was a blocker I created by adding the gate without updating the portal. |
| **Signing out logged you out everywhere** | `supabase.auth.signOut()` defaults to `scope: 'global'`, revoking every refresh token the user holds. Signing out of the portal on a desktop also signed the same person out of the app on their phone. Both are now `scope: 'local'`. |
| **RCA notification mails pointed at a route that never existed** | `/snags/<id>/rca`. It never 404'd loudly, because the app's web build is `output: "single"` — it served the app shell and dropped the reader on the Report tab. Three separate mails, silently useless. |
| **Resolve was offered on an `rca_pending` snag (portal)** | The server refuses it outright, but that check sits *above* the `resolved` block, so it isn't one of the shared gate's conditions. Pressing it produced a raw Postgres exception. |
| **Caption-only evidence was invisible in the portal** | Mobile's sheet accepts a caption with no photo; the portal rendered thumbnails only. The heading counted items the page didn't show. |
| **Disabled buttons rendered at full strength, app-wide** | Reanimated writes its animated style directly onto the view, overriding the later static `styles.disabled`. Measured: `opacity: 1`, full-strength background, `pointer-events: none`. Every disabled button in the app looked pressable. |
| **Collapsed cards couldn't show their summaries** | `StepCard` only mounts children while expanded, so panels that report their own state left every collapsed card blank — in exactly the state the progress list exists to describe. |
| **A stalled request wedged the client, silently and permanently** | supabase-js puts no timeout on its own `fetch`, and it resolves an access token before *every* request. One `/auth/v1/token` refresh that was issued and never answered — what a phone losing signal mid-request actually looks like — left `getSession()` pending forever, after which **no call was ever issued at all**. Invisible from every angle: nothing reached the server so there was nothing in the logs, nothing rejected so no error was shown, and the loaded screen kept rendering its existing data. The only symptom was a Save button spinning for good. Found from a screenshot of exactly that, reproduced against the deployed production bundle, and fixed with a per-request deadline plus try/finally around the saves. |
| **No photo could be attached from the browser build** | The app is shipped to the web as well as to phones, and there the file read never happened: `expo-file-system` has no web implementation — its `File` is a stub that warns and is missing the methods the JS wrapper calls, so `new File(uri)` throws on construction. Every pick came back "Couldn't upload a photo", which correctly disables Submit, so a worker with a photo could file nothing at all. Invisible server-side for the same reason as the stalled request above: it fails *before* the request, so Storage logged nothing. Reading the picked file is now platform-split (`src/lib/uploadBody.ts`), which is what it always was — one half was just missing. |
| **An assigned worker could not submit their own RCA** | `submit_rca` deliberately allows the assignee, then calls `set_root_cause`, which called `require_serious_snag` and demanded `can_edit_site`. A worker could answer all five whys and be refused with *"Only a supervisor of this site, or an admin, can run the investigation"*. CLAUDE.md says RCAs are usually assigned to workers, so this is the **normal** case — it had never fired only because a supervisor had always pressed submit on the assignee's behalf. Confirmed against the live project as the QA worker before and after the fix. |

---

## 4. Design decisions, and why

### 4.1 The serious-incident screen was rebuilt, not tweaked

**Measured before touching it**, on a real mid-flight incident with every card already
collapsed: 2,203 px against a 777 px viewport — 2.8 screens — with the first
actionable element at y=932. Nothing you could act on was visible without scrolling.

The accordion was never the problem. What sat on top of it was: a 200 px camera icon
rendered when a snag had *no* photo (58% of the first viewport advertising an
absence), and a one-sentence description set as a 28px/36 headline that ran five
lines.

**Decision:** a `NextStepCard` naming the single outstanding condition, one CTA, and
Resolve stated as a *locked row* while unreachable — rather than a button whose
blocking reason was the smallest text on screen. Below it, collapsed cards each
reporting their own state, which is the progress list.

### 4.2 The 5 Whys are asked one at a time

Ten text inputs in one card misrepresented the method. Why #2 is asked *of the answer
to* #1; a form showing all five invites five parallel guesses at the same question
instead of one line of reasoning. Each step now states what it is asked of.

### 4.3 The portal got the same treatment, with native `<details>`

The portal page is a server component with no client state, so a native disclosure
gives open/close, keyboard support and find-in-page for free. A React toggle would
have meant making the whole page a client component to gain nothing.

### 4.4 One shared resolve gate

`seriousResolveGate` lives in `packages/supabase-queries` and both clients read it.
Before, mobile disabled Resolve and named the blocking condition while the portal
offered a live button annotated "(requires completed investigation)". Unit tests pin
the *ordering* against the SQL — moving the notifiable condition off the front fails
two of them.

### 4.4a An organisation can run its own investigation, without a way out of one

Plenty of organisations already have an investigation process and a form they are
required to use. Forcing SNAG's five-step version on top of it means the real
investigation lives somewhere else and SNAG holds a hollow copy.

So `investigations.mode` forks the tail of the gate — and it is a **substitution, not
a shortcut**. Document mode replaces the last two conditions (root cause, corrective
actions) with two of its own (a document is attached; a supervisor accepts it). The
notifiable decision, the checklist, a witness statement and evidence are unchanged.
The fork exists once per layer: `update_snag_status` in SQL, `seriousResolveGate` in
the shared package, one conditional section in each client.

Three decisions inside that are worth stating:

- **Accepting is a separate act, but not necessarily a separate person.** The first
  cut required one, mirroring the rule corrective actions apply to their verifier.
  That was built on a wrong assumption about who does the work: a site lead allocates
  the investigation to a crew, so the crew that completes it and the supervisor who
  signs it off are already different people without a rule forcing it. The rule only
  ever bit the case where a supervisor did the work themselves, and there it
  deadlocked — a one-supervisor org had nobody left who could accept, and the snag
  could not be resolved at all. Blocking a legitimate closure is a worse failure than
  recording a self-signed one, so both clients now name the attacher and the acceptor
  instead of preventing them from matching. Corrective actions keep their rule: a task
  someone marked done themselves is a different thing from an organisation's completed
  investigation.
- **The mode is chosen while allocating**, not behind a separate "Assign investigation"
  button. Allocating is when someone is already deciding who deals with this; asking
  twice in two places is how a snag ends up with an owner and no investigator. The
  owner *is* the lead investigator — splitting the roles buys a second thing to keep
  in sync.
- **Investigation documents go into the org library**, not a per-snag hiding place.
  The person who needs one in two years wasn't on the snag and won't think to look
  at it.

### 4.4b Doing versus directing

Assigning an investigation has to actually give someone the investigation. Every
investigation write used to require `can_edit_site`, so `assign_investigation` could
name a lead who was then refused by every RPC the job consists of — and the same hole
was already live and load-bearing in the RCA flow (see §3).

`require_investigation_access` draws the line at **doing versus directing**: the
assigned lead investigator (any role) can work the checklist, take statements, add
evidence, record a cause and attach the document; assigning, accepting, rejecting,
waiving, creating corrective actions and starting a debrief stay with supervisors and
admins. Reads were never restricted, so this only opens the writes the assignee was
always expected to make.

### 4.5 Notifications hand off per visitor, not per event

SNAG has two clients for two jobs. A notification can't know which its reader needs.
**Checked against live data rather than assumed: only 3 of 8 events have a recipient
whose role is guaranteed.** `serious_created` is one email to a whole site's members,
whose roles are mixed; RCAs are usually assigned to workers, whom the portal refuses.

So every per-snag mail points at `/go/snag/<id>`, which decides per visitor. It sits
*outside* the `(portal)` route group deliberately — that layout's gate would bounce
the very people the page exists to help.

It never looks the snag up: it's a public URL, and a lookup would answer "does this
id exist" for anyone who asks.

### 4.6 Testing: four tiers, one of which can write

Tier 3 mutates, and `snags` rows cannot be deleted (5-year retention, enforced in the
database). So it is fenced three ways: opt-in via `E2E_WRITE_PATH=1`, an **org check
at runtime before the first write**, and a disposable `SNAG QA` org. It is
deliberately not in CI — a per-PR write path would accumulate permanent records.

### 4.7 One sign-in per test run

Logging in per test was ~40 sign-ins per run across three browser projects, which
Supabase Auth rate-limits. The failure is invisible: `loginAction` maps *every*
`signInWithPassword` error to "Incorrect email or password", so the symptom was a
spec finding itself back on `/login` for no reason the page could explain. Cut the
suite from 9.2 minutes to 3.8.

---

## 5. Security review

Run 27 July against the live project: 140 advisories, plus my own probing. **The
architecture holds.** Findings, with what I actually tested:

| Finding | Verdict |
|---|---|
| Anonymous sign-ins enabled (35 advisories) | **Required** by the QR public-report flow. Probed with a real anonymous session: every table returns `[]`, direct insert → 403, all three storage buckets list `[]`, arbitrary object fetch → 400. No exposure. |
| ~100 `SECURITY DEFINER` RPCs callable by `authenticated` | This *is* the architecture — every write goes through one. Audited for functions with no authorization check; the 8 candidates are token-based by design (`get_invite_preview`, `get_org_by_join_code`, `get_site_by_public_token`, `search_public_orgs`), trivial helpers, or delegate to a checked overload. `create_snag`'s legacy shim delegates to a version that validates `p_site_id` against `current_org_id()`. |
| 4 `SECURITY DEFINER` trigger functions granted to `authenticated` | **Not reachable.** PostgREST refuses to route to trigger-returning functions — verified, `PGRST202`. Grant hygiene, not exposure. |
| `public_report_blocks`: RLS on, no policies | **Correct.** Deny-all by design; only written by `SECURITY DEFINER` RPCs. Table is empty. |
| `pg_net` installed in `public` | Cosmetic. |
| **Leaked-password protection disabled** | **Real, and unfixed.** See §7. |

No secrets are committed — the matches in tracked files are environment-variable
*names*, not values.

**Deleted:** `supabase/schema.sql` and nine `migration_*.sql` files, leftovers from an
inactive prototype whose only property was being catastrophic if run against Snagv1.
A warning comment doesn't help someone who pipes a file into `psql`. Git still has them.

---

## 6. What is built but not live

The `/go/snag/<id>` handoff is committed, tested (116 web E2E) and pushed on
`claude/app-testing-setup-ery6tx`, but **not deployed**.

I deployed the matching edge function ahead of it, which pointed every notification at
a 404 for a few minutes. I caught it and rolled back to `main`'s version. That was my
error, and it is now written into both the function header and `CLAUDE.md`:

> **Deploy the portal before the function.** These links are only ever followed from
> someone's inbox. A broken one shows up in no test, no CI job, and no page — the
> first person to find out is a supervisor who has just been told there's been an
> injury.

**Live right now:** `notify-snag` v14 — app links with `?step=rca`, verified 200. The
dead `/rca` path is gone. Strictly better than before, just not the final design.

**Order to finish it:** merge the branch → let Netlify rebuild → confirm
`/go/snag/<uuid>` answers 200 or 307 on the target host → set `SNAG_PORTAL_URL` →
redeploy the function.

---

## 7. Decisions I need from you

### D1 — Production domain — ✅ decided: `www.snaghq.co.nz`

The in-code default for `SNAG_PORTAL_URL` now points there. **It is aspirational
until you do two things**, and deploying before them sends every notification to a
dead host:

1. Netlify → the `apps/web` site → Domain management → add `www.snaghq.co.nz`, then
   repoint DNS. It currently resolves to `27.124.125.171`, which is not Netlify.
2. Confirm the handoff answers there, then set the secret and redeploy:
   ```
   curl -o /dev/null -w '%{http_code}\n' https://www.snaghq.co.nz/go/snag/<any-uuid>
   ```
   200 (the chooser) or 307 (a signed-in supervisor) means go. **404 means the
   portal build hasn't caught up — deploy that first.**

### D2 — Leaked-password protection — ✅ decided: on

Supabase → Authentication → Policies → enable "Leaked password protection". There is
no API for this in the MCP tooling, so it is a dashboard action. Checks new passwords
against HaveIBeenPwned at sign-up and change.

### D3 — Notification routing — ✅ decided: the `/go` handoff

Built, tested, and waiting on D1. See §4.5 and §6.

### D4 — The document library — ✅ resolved, and I was wrong about it

**I reported this as a stub. It isn't.** `(portal)/documents` is a complete org-wide
document register: upload, listing with uploader and date, signed-URL download and
delete, backed by the `org-documents` bucket and the `org_documents` table, with RLS
and two storage policies in place. I took "stub" from `CLAUDE.md` instead of reading
the code.

You chose "build a document library" on that false premise. Nothing needed building.
What it needed was checking — so I drove the full round trip against the live project:
upload, listed, downloaded the actual bytes, deleted, and confirmed the org was left
as I found it.

One scare worth recording: the download returned **403 from the browser**, which looked
like a broken signed URL. It wasn't — this sandbox's proxy stops Chromium negotiating
TLS to Supabase at all. `curl` fetched the same URL with a 200 and the right content.
The spec now fetches with Node's `fetch` for exactly that reason.

The register had **zero rows** against a live project. Nothing was broken; nobody had
looked. `apps/web/e2e/documents.spec.ts` now covers the round trip so it can't rot
again quietly.

**Still yours to decide:** whether to *also* build snag-scoped evidence browsing —
seeing evidence across snags rather than one at a time. That is a genuinely separate
feature and remains unbuilt.

### D5 — Native deep links need a device

`snag://` is configured (`app.json` scheme + linking config) and the **web** path is
proven by tests. The native path is correct-by-construction and unverified — it needs
a real build, not Expo Go.

| Option | Trade-off |
|---|---|
| **A. Verify on the next EAS build** *(recommended)* | No extra work; just don't assume it works until someone taps a link on a phone. |
| B. Add Universal/App Links (`apple-app-site-association` + `assetlinks.json`) | `https://` links open the app directly — much better than a custom scheme, and it makes `/go` mostly unnecessary on mobile. Needs D1 first, plus Apple/Google verification files on the domain. |

### D6 — Native paths that no test can reach

`expo-camera` (QR scan), `expo-image-picker` / `-manipulator` (`PhotoPicker`),
`expo-document-picker` (the document library and investigation-document attach —
**a new native dependency, so it needs a fresh EAS build to reach a device at all**),
`expo-file-system`. react-native-web can't exercise these; neither can CI.

The list overstated itself, and it cost. `expo-image-picker` / `-manipulator` /
`-document-picker` all run in the browser; only `expo-camera` and
`expo-file-system` are genuinely absent there. Reading that as "the photo path is
native-only" is what allowed `uploadSnagPhoto` to be moved onto
`expo-file-system` (#14, the 400-on-native fix) with no thought for the web
build — where the same call throws on construction, before any request, so
nothing appears in the Storage logs to say so. Since that change landed on 16
July, exactly one photo has reached `snag-photos` (27 July, and not from a
browser). The Netlify export is a shipped client used from real phones;
"unverified on native" and "broken on web" are different sentences.

| Option | Trade-off |
|---|---|
| **A. A written manual pass before each release** *(recommended)* | Cheap, honest, and these are exactly the paths a worker uses first. |
| B. Maestro or Detox on a device farm | Real automation. Meaningful setup and ongoing cost. |
| C. Keep accepting the gap | It's the photo picker on an app whose core action is photographing a hazard. |

### D7 — Keyboard behaviour on a real device

Reviewed through react-native-web at 412 px, which is faithful for layout and
hierarchy but *not* for native scroll, keyboard avoidance, or the picker. Stage 2
should have largely fixed the three-inputs-behind-one-keyboard problem by never
showing two fields at once — but that is reasoning, not evidence. Folds into D6.

### D8 — Self-acceptance — ✅ decided: a supervisor can sign off their own work

I flagged that an org whose only supervisor attached the document had nobody left who
could accept it, so the snag could not be resolved. Decided: drop the rule.

The reasoning behind it was a wrong assumption about who does the work. A site lead
allocates the investigation to a crew; the crew completes it and the supervisor
accepts, so the two are different people in the normal case anyway. The rule bought
nothing there and deadlocked the case it did apply to.

The record still carries what the rule was trying to guarantee: `document_attached_by`
and `document_accepted_by` are both stamped and both shown, so an auditor can see when
they are the same person. That was always the more useful half.

Corrective actions keep their verifier-cannot-be-owner rule — a task someone was
assigned and marked done themselves is a different thing from an organisation's
completed investigation.

---

## 8. Known gaps, in priority order

1. **The niggle lane has no write-path coverage.** Tier 3 covers the serious lane only;
   `resolve_snag` and the niggle assign flow are untested end to end.
2. **The portal's debrief and corrective-action sections** have no coverage beyond
   rendering.
3. **`packages/supabase-queries` is only partly tested** — the resolve gate has unit
   tests; the query wrappers don't. They each take a `SupabaseClient`, so a stub is
   straightforward.
4. **`notify-snag` has no test coverage at all.** No tier touches edge functions, and
   there's no Deno in CI. Its links are now verified by hand only.
5. **Test data accumulates in `SNAG QA`.** By design — the org exists to be
   disposable — but it will grow with every Tier 3 run.

---

## 8a. Accessibility — audited and fixed

`@axe-core/playwright` now runs WCAG 2.1 A/AA against every public route, the
handoff, and the portal's dashboard, snags, reports and detail pages, in all
three viewport projects. **34 specs, passing.**

The first run failed 10 of 12 routes — every one of them `color-contrast`, and
nothing else. No missing labels, no broken focus order, no unlabelled controls.
The structure was sound; the palette wasn't.

**What was wrong.** The design tokens are Tailwind's default greys and status
hues, which are chosen to look right, not to pass AA on their own tints:

| | Measured | Required |
|---|---|---|
| `--color-text-muted` `#9CA3AF` on the app background | **2.43:1** | 4.5:1 |
| `in_progress` badge — `#F59E0B` on `#FFFBEB` | **2.07:1** | 4.5:1 |
| `resolved` badge — `#10B981` on `#ECFDF5` | **2.41:1** | 4.5:1 |
| Mobile's "NEXT STEP" label on a white card | **2.15:1** | 4.5:1 |
| `flagged`, `rca_pending`, `danger`, `success`, active nav link | 3.2–4.3:1 | 4.5:1 |

The in-progress badge is the one that decided it. On a health-and-safety
product, the label telling someone whether a hazard is being dealt with is not
decoration — and 2.07:1 is not a rounding error.

**The fix, and why it is shaped this way.** A colour and *that colour as text on
its own tint* are different jobs, so they are now different tokens: base hues
(dots, icons, rails, button backgrounds — WCAG's 3:1 non-text threshold) keep
their values, and new `*-fg` / `*Fg` tokens carry the darker shade used for
label text. The brand blue `#2563EB` is untouched; only its text-on-tint
variant changed.

The two lower text tiers shifted down a step (`secondary` `#6B7280` → `#4B5563`,
`muted` `#9CA3AF` → `#6B7280`) because AA leaves no room for a lighter muted on
a near-white ground — `#6B7280` is about the lightest grey that passes at all.
That is a visible change across both apps, and it is the one judgement here
most worth a second opinion. Reverting is two token values.

Dark theme largely passed already; only `--color-text-muted` needed a nudge, and
only because it failed on `--color-surface-raised` specifically.

**Caveat worth keeping:** axe catches roughly a third of real accessibility
issues. A green run is a floor, not a certificate — it says nothing about screen
-reader flow, or about using this one-handed in gloves.

## 9. Standing hazards worth remembering

- **The app reports "Supabase unreachable" and "not logged in" identically.**
  `requireSupervisorOrAdmin()` only checks `if (!user)`, and a failed `getUser()`
  returns `user: null`. So an outage redirects to `/login` exactly like an anonymous
  visit, and the auth-gate specs pass either way. Confirm egress before trusting a
  green run — `TESTING.md` has the curl.
- **The mobile web build returns 200 for every path** (`output: "single"`). A broken
  link there fails silently. This is what hid the `/rca` bug.
- **`snags` rows cannot be deleted**, and retention is enforced in the database. Point
  write tests at a disposable org or don't run them.
