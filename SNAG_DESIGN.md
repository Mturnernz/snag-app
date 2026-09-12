# Snag — design system

The visual language for the household app, and the reasoning behind it. The screens are drawn
up as a canvas (see "The mockups" at the end); the working files are in `design/`.

**Status: the colour system and the brand assets are shipped; the shape and type proposals are
not.** `apps/mobile/src/constants/theme.ts` and `apps/web/src/app/globals.css` now carry the warm
palette, and the icon, favicon and wordmark are in `apps/mobile/public/`. What is still only
proposed here is the softer radius scale (18 / 13 / pill) and the two-typeface pairing — the
shipped app keeps 12 / 8 / 4 and the system face.

Three hues were darkened slightly against the table below when the identity was finalised, so the
shipped values win where they differ: **muted `#6A6156`** (was `#736A5F`), **clay `#9E3522`** (was
`#A63D29`), **brass `#825611`** (was `#8F6117`). Every pair was re-measured; the tightest shipped
pair is muted-on-sunken at 5.31:1.

---

## The problem with what's there now

The retired product's palette was the SaaS default: cool near-white ground, blue-600 primary,
blue-grey text. It was the right call for a compliance tool read by whoever happened to be the
safety officer that month — neutral, institutional, forgettable on purpose.

It is the wrong call for a house. A near-white ground with a cobalt accent reads as *software*:
something you're logged into. A household list is furniture. It sits on a phone on the bench, gets
opened with wet hands on a Saturday, and is shared with one other person who did not sign up for
an application.

So: **warm, worked-in, still precise.** Plaster and painted joinery, not grey and cobalt. The
warmth comes from the ground, the ink and the radii — not from novelty type or ornament.

---

## Palette

Two rules govern the whole thing: **the ground is warm**, and **colour is spent on state, never
on decoration.**

### Neutrals

| Token | Value | Use |
|---|---|---|
| `ground` | `#FAF7F2` | The app background. Warm plaster, not near-white. |
| `surface` | `#FFFFFF` | Cards, sheets, the tab bar. |
| `sunken` | `#F4EFE7` | Inactive chips, inputs inside a card, neutral badges. |
| `border` | `#E7DFD3` | Hairlines and resting chip outlines. |
| `borderStrong` | `#D8CEC0` | Outline buttons, checkbox rests — a border meant to be seen. |
| `ink` | `#2B2724` | Primary text. Warm near-black, not blue-black. |
| `secondary` | `#5C554C` | Body copy, field labels. |
| `muted` | `#736A5F` | Room names, counts, supporting detail. |

`ink` is warm on purpose. A blue-black on a warm ground looks like two palettes stapled together;
`#2B2724` sits down into the paper.

### Colour

Four, each with one job. Nothing else gets a hue.

| Token | Value | Tint | Means |
|---|---|---|---|
| `fern` | `#2E6A4F` | `#E4EFE7` | Every primary action, and the active tab. |
| `clay` | `#A63D29` | `#F9E7E1` | Overdue, and priority **high**. |
| `brass` | `#8F6117` | `#F7EEDC` | In progress, and due soon. |
| `slate` | `#35526E` | `#E9EFF6` | Open. A state, not a warning. |

**Why green rather than a blue or a clay.** Green reads domestic — painted joinery, garden,
outside — where blue reads institutional and clay reads restaurant. It is also the one hue that
carries "go" without shouting, which suits a screen whose main button says *Add to the list*.

**Green is the brand, so green is not "done".** This is the decision most likely to be
second-guessed later, so it's worth stating plainly: a finished item goes **neutral**, not green.
The reward for finishing a household job is the item leaving the list — not a green tick
celebrating it. Spending the brand hue on completion would also mean the list's calmest state was
its loudest colour.

### Contrast

Every foreground/background pair clears WCAG AA (4.5:1). Measured, not eyeballed:

| Pair | Ratio |
|---|---|
| ink on ground | 13.85 |
| secondary on ground | 6.87 |
| **muted on sunken** (the tightest) | **4.64** |
| muted on ground | 4.97 |
| fern on surface | 6.38 |
| white on fern | 6.38 |
| fern on its tint | 5.41 |
| brass on its tint | 4.68 |
| clay on its tint | 5.28 |
| slate on its tint | 7.02 |

**A warm ground reads lighter than a cool one, so the greys had to go darker, not lighter.** The
first pass of this palette failed three pairings — `muted` at `#7C7368`, and brass at `#A9741F`
— purely because a warm tint lifts perceived lightness while doing nothing for measured
luminance. If a future change warms the ground further, re-run the numbers rather than trusting
how it looks.

---

## Type

Two faces, one of them optional.

- **UI — the system face** (San Francisco / Roboto). Correct for a phone app: nothing to
  download, respects the reader's own text-size setting, familiar. The mockups stand in
  **Hanken Grotesk**, a warm humanist grotesque with close metrics, to show the intended tone.
  Shipping it is a nice-to-have, not a requirement.
- **Data — IBM Plex Mono.** Snag references, dates, counts — the things you scan for rather than
  read. Inherited from the web app's existing identity, so it isn't an arbitrary pick, and it adds
  a workshop note that suits the subject.

Scale (unchanged from `theme.ts` — the existing ramp is fine):

| | Size | Weight | Use |
|---|---|---|---|
| Screen title | 30 | 700 | *The list*, *Free weekend?* |
| Item title | 22 | 700 | A snag on its own screen |
| Section | 17–18 | 700 | *Sort it out*, a room heading |
| Card title | 15.5 | 600 | A snag in the list |
| Body | 15 | 400 | Descriptions, notes |
| Label | 13 | 600 | Field labels |
| Meta | 12.5–13 | 400 | Room names, counts, dates |
| Badge | 11.5–12 | 500–600 | Every pill |

Titles get `letter-spacing: -0.02em` and `text-wrap: pretty`. Nothing below 11.5px.

---

## Shape and elevation

Softer than the workplace product, which used 12 / 8 / 4.

| | Now | Was |
|---|---|---|
| Card | 18 | 12 |
| Button, input | 13 | 8 |
| Photo thumbnail | 12 | — |
| Badge | fully round | 4 |

Badges are pills, never rounded rectangles — a 4px-radius chip reads as a data tag, a pill reads
as a label someone put there.

Shadows are **warm-tinted and never black**:

```
sm   0 1px 2px rgba(43,39,36,0.04)
md   0 1px 2px rgba(43,39,36,0.04), 0 4px 14px rgba(43,39,36,0.05)
lg   0 1px 2px rgba(43,39,36,0.04), 0 6px 18px rgba(43,39,36,0.06)
```

The existing rule holds: an elevated card drops its border. Never both.

Minimum hit target stays 48×48; primary controls are 50–52px tall, because this is operated
one-handed in a hallway.

---

## What each badge is allowed to say

The colour budget is the design. Four badge families sit on the same card, so only one of them
may raise its voice.

- **Status** — `Open` (slate) · `Doing` (brass) · `Done` (neutral). Done recedes, per above.
- **Priority** — `High` (clay) and `Low` (neutral pill with a grey dot). Only high takes a hue: a
  second saturated colour on the same card and neither one reads. `Low` still renders rather than
  hiding, because priority is set at capture on every snag — a missing badge would mean *nobody
  has looked at this*, which is a different thing.
- **Effort** — `Quick` / `Half day` / `Big job`, entirely colourless. Effort answers *can I finish
  this today*, which is not an alarm.
- **Due** — neutral when scheduled, brass when within a week, clay when overdue. Overdue earns red
  because it's a fact about a date, not a judgement about importance.

**Needs parts** rides inside the effort pill as a cart glyph rather than taking a badge of its
own. It is a property of the job, not a state of it — and it already has a louder home on the
Weekend screen.

---

## The screens

### Add

A photo, a location tag, high or low, and one optional line. Three taps and no keyboard, in the
common case.

**There is no title.** A photo of the thing says what a title would, and requiring one put a
keyboard between someone and the problem in front of them. A snag needs a photo *or* a
description; one with neither is nothing, and the server refuses it in words rather than through
a constraint name.

**Location is a tag, not a field, and it sits last.** Twelve chips, seeded per property, so they
are full on the day a place exists — which is the day someone decides whether this is quicker than
saying it out loud. A list derived from past use is empty exactly then. `Elsewhere` sits last in
the list and is the escape hatch that stops a fixed list being a dead end.

The row is deliberately the quietest thing on the screen: *below* the description, under a muted
"Where is it? Optional", borderless and unfilled until one is tapped, at `Typography.sm` rather
than `base`. A tag is a suggestion — a snag without one is a perfectly good snag — and a row of
twelve solid buttons above the fold said the opposite. The touch target stays at 48px; a
transparent 48px row reads as air, not as a control. Picked reads as a `primaryLight` fill, dark
text and a small checkmark, so selection isn't carried by colour alone.

Adding a thirteenth is a sit-down job, so it lives in **You → Location tags**, not here.

**Priority is here rather than in triage**, and it is the one exception to the capture/triage
split. It's the single judgement only the person standing there can make: is this a today problem
or not. Two values, because a third would need thinking about.

**The place is a picker, and only when there is one to make.** A bach is a property — its own
people, its own tag list — not a tag. With one place the row isn't rendered at all, so a
single-property household never meets the concept.

Everything else — effort, needs-parts, due date, repeat, who's doing it — still belongs on the
detail screen. `CLAUDE.md` states the rule; the visual restraint is how someone feels it before
reading it.

### The list

Photo-led. A 76px thumbnail, the title, the room, then a wrapping row of badges. Twelve jobs with
thumbnails is a Saturday you can act on; twelve lines of text is a list you skim and close — so
the photo gets real space and the metadata stays one row.

Two chip rows above it: the four lenses (*To do · Mine · Parts · Done*) and the rooms actually in
use. The lenses are a flat set rather than a status tab bar on purpose — *Mine* and *Parts* cut
across status, and a household doesn't think in workflow states.

### Free weekend?

The screen a filtered list cannot be. Three things make it answerable:

1. **Bounded by time available**, not importance — an hour and a Saturday need different lists out
   of the same pile.
2. **Grouped by room**, because that is how work is batched. You do the garage once.
3. **The shopping list on top** — everything marked *needs parts*, collected. One trip to the
   hardware store clears a fortnight of small jobs, and that trip is the single most common reason
   a small job doesn't get done.

The shopping card is the only `lg`-elevation surface on the screen, and the only place brass
appears as a filled circle. It should feel like the thing you open the app for on a Saturday
morning.

### Snag detail

Everything capture deliberately didn't ask for. Photos, title, state, then *Sort it out* —
priority, effort, needs-parts, assignee, repeat.

**No Save button.** Every control writes on tap. Triage is a series of small independent decisions
("this is a quick one", "this needs a part"), and making someone confirm each one turns sorting a
pile of twelve into forty taps.

### You

Your name, the household, the tag list, and Sign out. Four rows, and the only screen in the app
that is administration.

**Location tags** is here rather than at capture because it is a sit-down job and capture is not —
the same line the capture/triage split draws. Rows of tags with a single close affordance each,
one text field and an *Add* button; removal asks first, in two buttons, and says in words that
everything already filed keeps its tag. The screen carries the property picker when there is more
than one place, for the same reason capture does: the house's list and the bach's are different
lists.

---

## The alternate direction

The canvas carries one genuine alternative, **Direction B — Ink**: the same system with charcoal
as the primary instead of fern.

It's more conventionally professional, and it lets the photographs carry the only colour in the
chrome — which is a real argument for a photo-led app. The tradeoff is that it gives up exactly
the warmth the brief asked for, and a two-person household tool has no logo or brand furniture to
carry an identity instead. Fern is the recommendation; Ink is there so the choice is visible on
real UI rather than as swatches.

---

## Applying it

Everything above lives in one file. `apps/mobile/src/constants/theme.ts`:

- `Colors.background` → `#FAF7F2`, `surface` → `#FFFFFF`, plus a new `sunken` `#F4EFE7`
- `Colors.border` → `#E7DFD3`, plus `borderStrong` `#D8CEC0`
- `Colors.textPrimary/Secondary/Muted` → `#2B2724` / `#5C554C` / `#736A5F`
- `Colors.primary` → `#2E6A4F`, `primaryLight` → `#E4EFE7`, plus `primaryPressed` `#24543E`
- `Colors.status` → open/doing/done on slate / brass / neutral
- `Colors.priority` → high/low on clay / neutral
- `Colors.due` → scheduled/soon/overdue on neutral / brass / clay
- `Radius` → card 18, button 13, input 13, chip 999
- `Shadow` → the warm-tinted scale above

The components already read every one of these through tokens, so the screens change with the
file. Two things need touching by hand: `EffortBadge` and `DueBadge` reference
`Colors.effort`/`Colors.due`, which stay as they are; and `SnagCard`'s thumbnail is 76px already.

Add a contrast test alongside `csp.test.ts` pinning the table above — the workplace product had
one for the same reason, and the three failures in the first pass of this palette are the argument
for keeping it.

## The mockups

Published as a canvas: **Snag Home UI** — Add, The list, Free weekend, Snag detail, a foundations
sheet, and Direction B. Working files in `design/*.dc.html`.

Photographs in the mockups are placeholders — soft tonal blocks standing in for the real thing.
Everything else is real: real copy, real badge combinations, real spacing.
