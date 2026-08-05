# Snag — Brand Guidelines

**Territory: The Record.** Version 0.1 — draft for review.
Owner: Mike Turner. Last updated: 5 August 2026.

This document governs the brand. `apps/mobile/src/constants/theme.ts` and
`apps/web/src/app/globals.css` govern the implementation, and where this document and
those files disagree, **the files win until someone reconciles them** — a guideline that
has drifted from the shipped product is worse than no guideline. §9 lists exactly what
needs to change in code for the two to agree.

---

## 1. The decisions this rests on

Four, made deliberately. Everything downstream follows from them, so if one of these
changes, re-read the whole document rather than patching a section.

| Decision | Ruling |
|---|---|
| **Audience** | Any workplace, genuinely. Not construction-first. |
| **Provenance** | New Zealand Police investigation background, front and centre. |
| **Lead promise** | Authority. *It holds the line for you.* |
| **Name** | **Snag** is the product. **SnagHQ** is the company. |

### What "any workplace" costs

It costs the hard hat, and it costs the words that come with it. A dental practice, a
primary school, a commercial kitchen and a joinery all have someone who trips on the
same loose mat. The brand's centre of gravity moves off *industry* and onto *risk* —
which is fortunate, because risk is also where the product's actual advantage lives.

Concretely, the following must go (see §9 for the code locations):

- The `HardHat` icon on the landing page.
- *"Built for construction, trades, manufacturing, logistics, and other field-based teams."*
- Any stock-photography instinct toward hi-vis, scaffolding, or a man pointing at a clipboard.

**"Site" stays.** It is the product's data model and it is also just a word for a place
of work — a café has a site. Don't rename it; do make sure nothing around it is
industrial.

### What "authority" costs

It costs cheerfulness. No exclamation marks, no confetti, no "Nice work! 🎉". This is a
product whose defining behaviour is **refusing to let you close something**. A brand that
grins while it blocks you is a brand nobody believes.

The reconciliation with "reduce barriers for employees" is not a softer tone — it is
**effort**. Reporting is thirty seconds and asks nothing of you. The rigour lands on the
organisation, not the reporter. Say the small thing; we'll carry the weight of it.

---

## 2. Positioning

### The one-sentence version

> Snag is the workplace reporting system that won't let a serious incident be quietly
> closed.

### The idea

Most reporting tools are inboxes with a photo attached. They record that something was
said, and then that a manager said it was handled. Nothing in them can tell the
difference between an investigation and a shrug.

Snag can, because closure is a **gate, not a button**. A serious snag cannot reach
*resolved* until the checklist, a witness statement, evidence, the notifiable decision
and a root cause all exist — enforced in the database, not in a policy document somebody
is supposed to remember. If a supervisor closes one anyway, they write down why, and that
reason is stamped into the record beside the conditions that were still outstanding.

That is the whole brand. Everything else is delivery.

### Why we can claim it

Because the process wasn't designed by software people guessing at what an investigation
looks like. It was designed by someone who ran them.

> ⟨**TO CONFIRM — do not publish until filled in.** Years of service; role and unit;
> the investigative discipline being drawn on (serious crime? scene examination? file
> preparation for prosecution?); and whether NZ Police have any restriction on referencing
> service commercially. No provenance copy ships with placeholders in it.⟩

Two rules for how this is used:

1. **It explains the product's shape, never its quality.** "This is why the gate exists"
   is true and defensible. "Police-grade software" is a claim about the code and invites
   someone to test it.
2. **It is a person, not a badge.** Named, with a face, in the first person. A crest, a
   silhouette, or anything implying endorsement by or affiliation with NZ Police is out —
   both because it isn't true and because it's the fastest way to lose the asset.

### The competitive line

We do not name competitors. When forced to describe the difference, the shape is:

> Most tools help you record that something happened. Snag is built for the day someone
> asks you to prove what you did about it.

---

## 3. The name

| Form | Where |
|---|---|
| **Snag** | The product. All prose, all UI, the wordmark, the app. Sentence case, always. |
| **SnagHQ** | The company. Footer copyright, legal pages, invoices, contracts, terms, the domain. |
| **snaghq.co.nz** | The domain only. Never set in running copy as the product's name. |
| ~~SNAG~~ | **Retired.** Not a logotype, not an acronym, not a heading style. |

- A snag (lower case) is also the thing itself: *"three snags open at Wharf Road."*
  This double duty is deliberate and worth protecting — it's why the name works.
- **Niggle** stays. It is the product's word for the small end of the scale, it is
  precise, and it is doing real work in getting people to report trivia. It is NZ/UK
  vernacular; if the brand ever goes to North America, this is the first word to retest.
- Never possessive the product name in UI ("Snag's dashboard" → "your dashboard").

---

## 4. Voice

Five principles. Each one has a failure mode attached, because that's how they get broken.

**1. State, don't sell.**
Declarative sentences. The product does what it does; adjectives make it sound like it
might not.
*Not:* "Powerful, intuitive investigation tools that empower your team."
*Yes:* "A serious snag can't be closed until it's been investigated."

**2. Name the thing.**
Use the real noun. Witness statement. Root cause. Corrective action. Notifiable event.
These are the words a regulator uses, and using them is itself the proof.
*Not:* "Add some more details."
*Yes:* "Add a witness statement."

**3. Never apologise for the gate.**
When Snag blocks something, it says what is missing and what would unblock it. No
"sorry", no "unfortunately", no softening. The refusal is the feature.
*Not:* "Sorry, you can't resolve this just yet!"
*Yes:* "Can't be resolved — no witness statement recorded."

**4. Small words for big things.**
The reader is on a phone, in bad light, possibly shaken. Short sentences. Plain English.
Nothing that needs a second read.

**5. The record is the hero.**
Not the app, not the dashboard, not "the platform". Write about what will exist
afterwards.

### Vocabulary

**Use:** snag · niggle · record · evidence · witness · root cause · close out · hold ·
notifiable · site · report

**Never use:** empower · seamless · revolutionise · game-changing · solution · leverage ·
best-in-class · "safety culture" (unearned, and everyone claims it) · exclamation marks ·
emoji

**Handle with care:**
- **"Incident"** and **"notifiable"** carry statutory meaning under HSWA 2015. Never use
  either loosely or as a synonym for "problem".
- **"Compliant" / "compliance".** Snag builds the record; it does not make anyone
  compliant. Every claim in this area carries the existing disclaimer: *general guidance,
  not legal advice.*
- **"Audit trail."** True — append-only, five-year retention — so it can be said plainly.
  Don't decorate it.

---

## 5. Colour

Two rules, and the second one is the interesting one.

**Rule one: the text tiers do not move.** `#111827` / `#4B5563` / `#6B7280` are the
darkest-hue-preserving greys that clear WCAG AA on this ground, `apps/web/e2e/a11y.spec.ts`
holds the line, and warming them for aesthetic reasons is the lowest-value change
available. They stay exactly as they are.

**Rule two: Snag has no brand colour.** Colour in this product *means* something —
flagged, in progress, resolved, RCA pending, serious. A decorative brand hue competing
with those is noise on a safety product, and the existing `#2563EB` primary already sits
uncomfortably close to `#3B82F6` flagged. So the action colour is **Ink**, and every
remaining colour is earned by carrying a status.

This is the territory made literal: a case file is black on paper, and colour is a tag.

### Core

| Token | Value | Job |
|---|---|---|
| **Ink** | `#0B1220` | The mark, headlines, primary buttons, the app icon ground. |
| **Paper** | `#FAF8F3` | Page ground. Replaces `#F9FAFB`. |
| **Card** | `#FFFFFF` | Surfaces sitting on Paper. Unchanged. |
| **Manila** | `#EDE7DA` | The one material tone. Section grounds and document affordances, used sparingly. |
| **Evidence** | `#1D4ED8` | Links and interactive affordance **only** — never a fill, never a brand hue. |

**Paper is at its limit.** `#6B7280` on `#FAF8F3` measures **4.57:1**. On the old
`#F9FAFB` it was 4.68:1; at `#F7F5F0` it drops to 4.44:1 and fails. Any further warming
breaks the muted text tier. Re-run the axe suite if this value is ever touched.

### Status — unchanged, and deliberately so

Every status, priority, category and relevance colour in `theme.ts` stays exactly as it
is. They are WCAG-verified, they carry the `*Fg` text-on-tint discipline, and they are the
only colours in the system with a job. **`Colors.serious` `#DC2626` remains reserved
exclusively for the hazard/incident lane.** Nothing in this brand refresh may borrow it.

### The rule that survives everything

**Colour is never the only signal.** Already true in the product (`CardAlertBorder` is
paired with `CardAlertGlyph` for exactly this reason). It applies to brand work too:
anything that reads only in colour must also read in monochrome — because it will be
photocopied, faxed, printed on a mono office laser, and attached to something.

---

## 6. Typography

**IBM Plex Sans** and **IBM Plex Mono**, already self-hosted in `apps/web/src/fonts/`.
Kept, and promoted from "a good default" to the centre of the identity.

Plex was drawn for IBM as an institutional voice — it is not fashionable, it is not
neutral, and it has a slightly technical, slightly official temperament that is exactly
the register we want. It also costs nothing to adopt, because it is already shipping.

| Role | Face | Notes |
|---|---|---|
| Display / headlines | Plex Sans Bold (700) | Set large, tight (`-0.02em`), short. `text-wrap: balance`. |
| Body | Plex Sans Regular (400) | ~65 characters per line. |
| Emphasis, buttons, labels | Plex Sans SemiBold (600) | |
| **Data** | **Plex Mono Regular / Medium** | **See below.** |

### Mono is not decoration

Every **reference, count, date, timestamp and status key** is set in Plex Mono. This is
already the rule in `apps/web`; The Record makes it the identity. Mono is what makes a
screen read as a record rather than a feed, and it is the cheapest, most consistent piece
of brand equity available here.

Uppercase labels (eyebrows, table headers, section markers) are Plex Mono, `0.08em`
letter-spacing, at or below 12px.

---

## 7. The mark

### Wordmark

**Snag**, set in Plex Sans Bold, tracking `-0.02em`. Sentence case, always. No custom
letterforms, no ligature tricks, no icon fused into the wordmark.

Clear space on all sides equals the cap height of the S. Minimum size 64px wide on
screen, 16mm in print.

### The reference device — the ownable bit

Square brackets, in Plex Mono, around any snag reference:

```
[ SN-0187 ]
```

This is the brand's one real device, borrowed from exhibit and evidence labelling. It
recurs everywhere the identity needs a signature: eyebrows, section markers, the QR
placard, email subject lines, the empty state. It is typographic, so it costs nothing to
produce, works in monochrome, survives a fax, and cannot be drawn badly by someone in a
hurry.

**Don't** use the brackets around anything that isn't an identifier. `[ Get started ]` is
a button pretending to be a record.

### App icon

The existing `S` **stays** — same letterform, same 29.5%-from-centre placement. Only the
ground changes: `#2563EB` → Ink `#0B1220`.

This is deliberate restraint. `CLAUDE.md` documents that the icon is full-bleed with the
mark inside Android's 40% maskable safe radius, and that `webManifest.test.ts` pins the
sizes. Changing only the ground keeps every one of those guarantees intact and requires no
re-measurement. It also means people who already have Snag on their home screen still
recognise it.

**The brackets do not go on the app icon.** `[S]` is wider than tall and would push
outside the maskable safe radius. Brackets are the system's device; the icon is the
letter.

### Company lockup

**SnagHQ**, same face, same tracking, used only where a legal entity is required. Never
alongside the product wordmark — they are not a lockup, they are two different names for
two different things.

---

## 8. Imagery

**No stock photography of workplaces.** It is where every competitor lives, it is
industry-coded the moment a person appears in it, and "any workplace" cannot survive a
photograph of a specific one.

Instead, three sources, in order of preference:

1. **The product's own surfaces.** The gate banner, the checklist, a reference tag, an
   audit line. The landing page already does this well (`SeriousSnagMockup`) and it should
   do more of it.
2. **Document artefacts.** A rule, a stamp, a tabbed divider, a mono reference on Manila.
   Flat, printed, unglamorous.
3. **The founder, once.** One real photograph, on the provenance section. Plain, direct,
   not corporate-headshot-lit. This is the only human face in the brand, and it is the
   only one that needs to be there.

Icons stay as they are: `lucide-react` on web, Ionicons on mobile, outline by default,
via the shared `Icon` component. **Never emoji.** Already a rule; restated because brand
work is where it usually breaks first.

---

## 9. What this changes in code

Not applied — this is the change list for approval, in priority order.

**Do first — copy and positioning, no design risk:**

| File | Change |
|---|---|
| `apps/web/src/app/(marketing)/page.tsx:43` | Delete the "construction, trades, manufacturing, logistics" line. |
| `apps/web/src/app/(marketing)/page.tsx:59` | `HardHat` → a non-industrial icon. |
| `apps/web/src/app/(marketing)/layout.tsx:12` | Wordmark `SNAG` → `Snag`. |
| `apps/web/src/app/(marketing)/layout.tsx:29,38` | Footer wordmark and copyright → `Snag` / `SnagHQ`. |
| `apps/web/src/app/(marketing)/page.tsx` | Add the provenance section (§2), once the facts in §2 are confirmed. |

**Do second — tokens, needs the axe suite re-run:**

| File | Change |
|---|---|
| `apps/mobile/src/constants/theme.ts` | `background: '#F9FAFB'` → `'#FAF8F3'`. Add `ink: '#0B1220'`, `manila: '#EDE7DA'`. |
| `apps/web/src/app/globals.css` | `--color-background` → `#FAF8F3`. Add `--color-ink`, `--color-manila`. Dark theme needs its own paper equivalent — do not invert. |
| both | Primary button fill `#2563EB` → Ink. `--color-primary` stays for links, deepened to `#1D4ED8`. |

⚠️ **`Colors.primary` is load-bearing beyond buttons** — `relevance.assigned` and
`WorkGroupPalette[0]` both use `#2563EB`. Give those their own explicit values before
repointing `primary`, or the assigned-relevance chip and the first work-group tile change
colour as a side effect.

**Do third:**

| File | Change |
|---|---|
| `apps/mobile/assets/icon.png` + `public/icons/` | Re-export with the Ink ground. `webManifest.test.ts` should still pass unchanged. |
| `apps/mobile/public/manifest.webmanifest`, `app.json` | `theme_color` / `backgroundColor` → Ink. |

**Do not change:** any status, priority, category or relevance colour. Any text tier. The
`Shadow` scale. The radius scale. `MIN_TOUCH_TARGET`.

---

## 10. Open

- **The provenance facts.** §2. Blocking on anything customer-facing.
- **`hello@snaghq.co.nz` must exist** before the footer ships it — `layout.tsx` already
  carries the warning.
- **Dark theme paper.** `apps/web` has a designed dark theme; Ink-on-Paper needs a
  deliberate dark equivalent, not an inversion. Not yet drawn.
- **The `[ ]` device on printed QR placards.** Site QR codes are already printed and on
  walls (`snagv1.netlify.app`, per `CLAUDE.md`). Any placard redesign has to assume the old
  ones stay up for years.
- **Trademark.** "Snag" is a common English word; `SnagHQ` is the registrable asset. Worth
  advice before spending on decals.
