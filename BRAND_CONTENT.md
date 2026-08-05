# Snag — Content

Written copy, ready to use. Governed by `BRAND_GUIDELINES.md` — read §4 (Voice) before
editing any of it.

Anything marked ⟨TO CONFIRM⟩ is a fact only Mike can supply. **Nothing containing a
placeholder ships.**

---

## 1. Boilerplate

Use these verbatim. Don't paraphrase them per-surface — the point is that they're the same
everywhere.

**One line (≤ 90 chars) — app stores, meta descriptions, email signatures**

> The workplace reporting system that won't let a serious incident be quietly closed.

**25 words — directory listings, partner sites**

> Snag lets anyone report a workplace problem from their phone in thirty seconds — then
> holds the organisation to a real investigation before it can be closed.

**50 words — About blurbs, press**

> Snag is a workplace reporting system for any kind of business. Workers report anything
> they see, big or small, in about thirty seconds. Anything serious routes into a guided
> investigation — checklist, witness, evidence, root cause — and cannot be marked resolved
> until that work is actually done.

**100 words — media kit, funding decks**

> Snag is a workplace reporting system built on one principle: reporting should be
> effortless, and closing should not be.
>
> Anyone in the business can report a problem from their phone in about thirty seconds — a
> wobbly handrail, a near miss, a wet floor. Small things get out of the way fast. Anything
> serious routes into a guided investigation with a first-response checklist, witness
> statements, evidence, a notifiable-event decision and a documented root cause. The system
> refuses to mark it resolved until those exist, or until a supervisor writes down why not.
>
> The investigation process is drawn from ⟨TO CONFIRM: years⟩ years of investigative work
> in the New Zealand Police.

---

## 2. Homepage

### Hero

> **Eyebrow** `[ WORKPLACE REPORTING ]`
>
> **Headline**
> Anyone can report it in thirty seconds.
> Nobody can quietly close it.
>
> **Subhead**
> Snag takes the effort out of speaking up and puts it back where it belongs — on
> investigating properly. Serious incidents can't be marked resolved until the checklist,
> the witness statement, the evidence and the root cause are all actually there.
>
> **Primary CTA** Start reporting
> **Secondary CTA** Log in to your org
>
> **Under the CTAs** — *replaces the "construction, trades, manufacturing" line*
> Cafés, clinics, workshops, warehouses, schools, sites. Anywhere someone can get hurt.

The existing `SeriousSnagMockup` stays. It is the best asset on the page — it shows the
gate refusing to close, which is the entire proposition, in two seconds and no copy.

### How it works — four steps

Keep the existing four-step structure; these are the rewrites.

| | Title | Body |
|---|---|---|
| 1 | **Report** | Photo, a sentence, done. About thirty seconds. One-off reporters don't need an account — they scan the site's QR code. |
| 2 | **Route** | It lands with the right person or team automatically. Nobody has to decide who to tell. |
| 3 | **Split** | A niggle closes with a note. A hazard or incident routes into a guided investigation and stays open until it's done. |
| 4 | **Close** | With a record that reads back cleanly years later — every action logged, nothing deletable. |

Step 3's existing title, *"Niggle → resolved. Serious → gated."*, is accurate but reads as
system vocabulary rather than English. **Split** with the body above says the same thing to
someone who has never used it.

### Three features

**Two lanes, one system**
Everyday niggles — a broken kettle, a dud light, a sticking door — move fast and get out of
the way. Hazards and incidents route somewhere else entirely: make safe, preserve the
scene, capture evidence, find the root cause. Same app, same thirty seconds to report.

*Icon: replace `HardHat` with `GitFork` or `Split`.*

**Root cause, not just a ticket**
Serious snags carry a structured five-whys analysis and corrective actions through to
independent verification. Closure isn't a single tap by the person who was supposed to fix
it.

**A record built for the day someone asks**
Every action logged. Nothing deletable. Five-year retention enforced in the database, not
by a policy someone has to remember.

### Provenance section — new

Sits directly beneath the hero. This is the section that earns everything above it.

> **Eyebrow** `[ WHY IT WORKS THIS WAY ]`
>
> **Headline**
> The process came from doing the job, not from a whiteboard.
>
> **Body**
> I spent ⟨TO CONFIRM: years⟩ years investigating ⟨TO CONFIRM: discipline / unit⟩ with the
> New Zealand Police. ⟨TO CONFIRM: one concrete sentence about what that work involved —
> scenes, statements, file preparation.⟩
>
> The thing that stayed with me is how much of an investigation is decided in the first
> hour, by people who aren't investigators and don't know that's what they're doing. The
> scene gets tidied. Nobody writes down what the witness said while they still remembered
> it. Six weeks later someone needs to reconstruct it and there's a photo and a sentence.
>
> Snag's investigation flow is that first hour, turned into something a supervisor can
> follow without training: make safe, preserve, record who saw it, capture it, then work
> out why. It asks for those things in that order because that's the order they stop being
> available in.
>
> — **Mike Turner**, founder, SnagHQ
>
> *Photograph: one, plain, direct. See guidelines §8.*

**Do not** add a Police crest, badge, silhouette, or the words "police-grade". See
guidelines §2.

### Why it matters — keep

The existing HSWA / WorkSafe $50,000 block is good and stays as written, disclaimer
included. One change: the CTA line currently reads *"This is exactly the kind of record
Snag builds automatically"*, which is a claim about the software. Change to:

> See what the record looks like →

### Trust — keep

All three points stay verbatim. They are specific, true, and checkable, which is exactly
the register.

Headline change: *"Built to survive scrutiny, not just look tidy."* → keep. It's the best
line on the site.

---

## 3. In-app copy

Where the brand actually lives. Voice principle 3 — never apologise for the gate — governs
all of it.

### The gate

| Situation | Copy |
|---|---|
| Blocked, one condition | Can't be resolved — no witness statement recorded. |
| Blocked, several | Can't be resolved — 3 steps outstanding. |
| Closed with exception | Closed by ⟨name⟩ with 4 steps outstanding. Reason recorded. |
| Exception prompt | This snag hasn't met its conditions. Write down why you're closing it anyway — it goes on the record. |

Never "Sorry", never "just", never "Oops". The exception prompt deliberately says *goes on
the record* rather than warning someone off: the point is that it's permitted and
permanent, not that it's naughty.

### Empty states

| Screen | Copy |
|---|---|
| No snags yet | `[ NOTHING OPEN ]` Nothing's been reported here yet. That's either good news or nobody's asked. |
| No snags matching filter | Nothing matches. Clear the filters to see everything. |
| Documents, empty | No documents yet. Policies, procedures, completed investigations — anything the team should be able to find. |
| Investigation not started | Not started. First response first: make the area safe. |

The "good news or nobody's asked" line is doing real work — it's the whole barrier-to-
reporting problem stated in nine words, to the person who can fix it.

### Reporting flow

| Field | Label / placeholder |
|---|---|
| Title | What's the problem? |
| Description | Anything else worth knowing? |
| Photo prompt | Add a photo — it's usually faster than describing it. |
| Submit, niggle | Report it |
| Submit, serious | Report it now |
| After submit | Reported. `[ SN-0187 ]` — you'll get told when it moves. |

**"Report it now"** on the serious lane is deliberate: it signals urgency without the form
lecturing anyone.

### Notification subject lines

Mono reference in brackets, leading — so a supervisor's inbox is scannable and the device
carries into email where we control nothing else.

| Event | Subject |
|---|---|
| Serious created | `[ SN-0187 ]` Serious incident reported — Wharf Road |
| Assigned to you | `[ SN-0187 ]` Assigned to you |
| RCA assigned | `[ SN-0187 ]` Root cause analysis assigned to you |
| Overdue digest | 4 snags need attention |
| Resolved | `[ SN-0187 ]` Closed out |

Body copy: what happened, what's needed, one link. No greeting, no sign-off pleasantry.

---

## 4. Pricing page

Existing framing — free for single-site, per-organisation as you grow, whole team included
— is right and needs no change. One line to add beneath the free tier, because it's the
objection that actually stops people:

> Every plan includes everyone. Charging per user on a reporting tool means someone
> eventually decides who isn't worth a licence, and that person is the one who sees the
> problem.

---

## 5. Things not to say

Collected from the current site and docs, with what to say instead.

| Don't | Do |
|---|---|
| "Empower your team to report" | "Anyone can report it in thirty seconds" |
| "Seamless investigation workflow" | "Checklist, witness, evidence, root cause" |
| "Improve your safety culture" | *(delete — unearned and unmeasurable)* |
| "Police-grade" | "The process came from doing the job" |
| "Fully compliant" | "The record HSWA expects you to be able to produce" + disclaimer |
| "Powerful and intuitive" | *(delete — say what it does)* |
| "SNAG" | "Snag" |
