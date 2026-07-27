# SNAG — production readiness

Written 27 July 2026, against `main` @ `e9dc818` plus the branch described in §6.

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
| Tests | 49 unit · 116 web E2E · 24 mobile E2E, plus an opt-in write-path suite |
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

### D1 — The portal's production domain ⚠️ blocks §6

You own `www.snaghq.co.nz`. DNS resolves to `27.124.125.171`, which is not Netlify;
port 80 returns 403 and HTTPS doesn't complete a handshake, so it isn't serving the
portal today. `snag-app-website.netlify.app` is a branch deploy. `snag.app` is parked
and for sale.

| Option | Trade-off |
|---|---|
| **A. Point `www.snaghq.co.nz` at the Netlify site** *(recommended)* | A domain you own, in every notification email. Costs a DNS change. |
| B. Promote the Netlify site to production, use its `.netlify.app` name | Works today, zero cost. Looks provisional in mail to customers. |
| C. Buy `snag.app` | Best brand fit; it's parked with a broker, so price is unknown and it blocks everything else. |

*(One caveat: this sandbox filters egress, so I can't completely rule out that my
reading of `snaghq.co.nz` is a local artefact. If it works from your machine, trust that.)*

### D2 — Leaked-password protection

Currently **off**. Supabase can check new passwords against HaveIBeenPwned.

| Option | Trade-off |
|---|---|
| **A. Turn it on** *(recommended)* | Auth → Policies, one toggle. Blocks known-breached passwords at sign-up and change. For an app holding injury records under a statutory duty, this is close to free. |
| B. Leave off | One less thing between a worker and an account. Weak justification given the data. |

### D3 — Who receives notification traffic

Answered in principle by §4.5, but confirm the shape:

| Option | Trade-off |
|---|---|
| **A. The `/go` handoff** *(built, recommended)* | One URL, right for every recipient, survives role changes and forwarded mail. Needs D1. |
| B. Per-event routing | No new route, but can't be correct for `serious_created`'s mixed audience without splitting sends. |
| C. Everything to the app | Simplest. Supervisors get a phone-shaped layout on a desktop for management work. |

### D4 — The `documents/` stub

`(portal)/documents` is a deliberate stub pending a decision recorded in
`SNAG_WEB_APP_PLAN.md` §10. It is currently in the sidebar and goes nowhere useful.

| Option | Trade-off |
|---|---|
| **A. Hide it until built** *(recommended)* | A nav item that leads nowhere reads as broken to a customer. One-line change. |
| B. Build snag-scoped evidence browsing | Reuses `snag-evidence`, RLS already correct. Moderate. |
| C. Build a general document library | Bigger: policies, SWMS, inductions. Its own upload/versioning story. |

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
`expo-file-system`. react-native-web can't exercise these; neither can CI.

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

---

## 8. Known gaps, in priority order

1. **The niggle lane has no write-path coverage.** Tier 3 covers the serious lane only;
   `resolve_snag` and the niggle assign flow are untested end to end.
2. **The portal's debrief and corrective-action sections** have no coverage beyond
   rendering.
3. **No accessibility audit.** `@axe-core/playwright` would slot straight into the
   Tier 1 specs. This is the cheapest real coverage still on the table.
4. **`packages/supabase-queries` is only partly tested** — the resolve gate has unit
   tests; the query wrappers don't. They each take a `SupabaseClient`, so a stub is
   straightforward.
5. **`notify-snag` has no test coverage at all.** No tier touches edge functions, and
   there's no Deno in CI. Its links are now verified by hand only.
6. **Test data accumulates in `SNAG QA`.** By design — the org exists to be
   disposable — but it will grow with every Tier 3 run.

---

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
