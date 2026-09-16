# The Projects tab — a proposal

**Status: built.** This is the argument that preceded it; the decisions taken since are recorded
at the foot. The feature itself is documented in `CLAUDE.md` under *Projects: what we're changing*. The mockups live in the artifact published
alongside it; this file is where the reasoning goes, beside `SNAG_HOME_PIVOT_REVIEW.md`.

## The short answer

A **fifth tab**, and no redesign. The bottom bar goes List · House · **Projects** · Schedule · You,
and nothing about the existing screens moves.

SNAG's tabs are already one idea: four views of a place, plus you. What's wrong with it (List),
what's in it (House), when things land (Schedule). "What we're changing about it" is the fourth
view and it has been missing. Putting it behind the House tab as a second mode would be the
`By room / By kind` rail coming back — a tab with two minds, which is how a tab becomes two tabs
badly.

**The cost, stated plainly:** five is the ceiling. At 375pt each tab gets 75pt, and `Projects` and
`Schedule` are both eight characters at 11px — they fit with nothing to spare. If a sixth noun ever
arrives, the answer is not a sixth tab; it is that two of these five were never really different.

Projects sits **third**, beside House, because both describe the fabric of the place. Schedule stays
last: it is still the tab you go to with a question rather than the tab where work is done.

## Four levels, and the rule that stops them being four

A downstairs laundry renovation is a bathroom, a laundry and a storage area; the bathroom is a
toilet, a shower mixer, tiles and waterproofing; the toilet is three quotes of which one is chosen.
That is four levels, not three.

| Level | Is | Example | Carries |
|---|---|---|---|
| **Project** | a body of work on a property | Downstairs laundry | status, dates, budget, photos, paperwork |
| **Element** | a part of it, usually a room | Bathroom renovation | a room tag, a rolled-up total |
| **Item** | one thing to decide or buy | Shower mixer | a decision state, a rolled-up price |
| **Quote** | one supplier's number, with the paper | Mico — $1,150 incl GST | amount, supplier, date, PDF |

**A middle layer appears only when it earns its place.** This is the load-bearing rule and it
applies twice. A new project gets one element, created silently and named after the project — so a
project with one element shows its items directly and the word "element" never appears. An item with
one quote shows that number inline and never mentions quotes. The second one is what makes the layer
visible, at the moment somebody creates it.

So "new deck, one quote, $11,400" is a two-line record and the downstairs laundry is a three-level
one, out of the same tables. The alternative — a nullable `element_id` on an item — gives the rollup
two code paths to sum through, which is how a total starts disagreeing with itself.

**Elements come from step two of the start sheet**, not from a concept anybody has to learn: "which
rooms does it touch" produces one element per room, already named. Pick one room and elements never
appear at all.

## Money that cannot lie about itself

This is the feature's one genuine risk. The assessment feature keeps costs as **text**, quoted back
with the date, because parsing "180–260" asserts a precision the answer never had. A project cannot
do that — rolling up is the whole point of elements. So money here is numeric, and it buys that with
three rules:

- **A total always states its denominator.** Never `$8,990` alone; always `$8,990 · 5 of 9 items
  priced`. A renovation total assembled from half the items is the most misleading number this app
  could show, and it misleads in the direction that costs money.
- **An unpriced item is not zero.** It is counted, named, and excluded from the sum — visible in the
  list as *Not priced*, dragging the denominator down where you can see it.
- **Never read a number out of a PDF.** Every amount is typed by somebody who looked at the quote.
  A scraped figure has a source nobody can check, and it will be wrong about GST, about provisional
  sums, and about which revision it read.

**Three figures, never one.** *Quoted* is what suppliers have said including options not taken;
*Chosen* is the sum of the quotes actually picked — what it's going to cost; *Spent* is what's been
invoiced or receipted — how far in we are. Different questions; a single "total" answers none.

All three are derived **in the view**, never maintained as a column — the same argument that took
`needs_parts` off the snags table. A stored total and the quotes it describes will disagree the
first time somebody edits an amount from the other phone.

## Joins

Two new joins, both on mechanisms already in the schema, and both following the rule `thing_id` set:
**pointing at something is not doing something.**

- **`snags.project_id`**, nullable, `on delete set null`. The defects list at the end of a
  renovation is literally a snag list — it is where the word comes from. A project's "To sort out"
  section is the ordinary list, filtered; the snags live in `home.snags` and appear on the List tab
  in their rooms like everything else. **No second to-do list, and no task inside a project.** And
  filing a snag against a project does **not** move it to `doing` — it is excluded from `v_started`
  in `update_snag`, exactly as `thing_id` is.
- **`things.project_id`** — what the project left behind. This is the payoff, and it is somewhere
  else entirely: the washing machine's page says *"installed during the downstairs laundry, March
  2026"*, and an item is promoted to a thing in one tap with the walkthrough pre-filled. Three years
  later the question isn't what the laundry cost, it's what the model number is and whether it's
  still under warranty — and that is a thing, reached from a project, with the invoice attached to
  the quote that bought it.

**Not on the Schedule tab, at least not yet.** Nothing on that tab writes, and a draggable project
band would be the second scheduling mechanism the whole tab exists to prevent. A read-only span is
compatible and is phase 3, once it's clear projects are actually being used.

## Four things that stay exactly as they are

- **No compose bar on this tab.** A project is created deliberately, at a desk, like a thing — not
  in ten seconds standing in a doorway. Capture belongs to snags.
- **No notifications, still.** "Your quote expires Friday" would be the first thing in this product
  that speaks unasked.
- **No ghosts.** The House tab arrives furnished because a catalogue can guess a kitchen has a
  rangehood. Nothing can guess your renovations, and a suggested project would be a fabrication
  rather than a prompt.
- **No second bucket.** PDFs and photos go to `home-photos` under `<household_id>/docs/`, through
  `HOUSEHOLD_FILES_BUCKET` and `getFileUrl`. The mime type already admits `application/pdf` and the
  four storage policies already answer for the folder.

## Schema

Every write a SECURITY DEFINER RPC; reads through `home.is_property_member`; grants by name; the
view's columns written out one at a time rather than `select p.*`.

| Table | Key columns | Notes |
|---|---|---|
| `home.projects` | household_id, property_id, name, status, started_on, target_on, finished_on, budget, photo_paths, document_paths | `project_status`: planned · underway · done. Property-scoped, so the bach's reno is the bach's. |
| `home.project_elements` | project_id, name, room, sort_order, implicit | `implicit` is what hides the layer: true on the auto-created one, false the moment a second is added. |
| `home.project_items` | element_id, name, status, sort_order, notes | `item_status`: considering · chosen · ordered · installed. Never *done* — that word belongs to snags. |
| `home.project_quotes` | item_id, supplier, amount, kind, chosen, dated, document_paths, photo_paths | `kind`: quote · invoice · receipt. Partial unique index: one chosen quote per item. |
| `home.snags` +1 | `project_id` nullable, on delete set null | Excluded from `v_started`. |
| `home.things` +1 | `project_id` nullable, on delete set null | Deleting the project must never delete the appliance. |
| `home.projects_with_totals` | quoted, chosen, spent, item_count, priced_count, element_count, snag_count | Derived, never stored. Columns one by one. |

Deleting a project cascades to elements, items and quotes — and the client clears the storage keys
afterwards through `deleteStoredFiles`, because `storage.protect_delete()` raises `42501` on a direct
row delete and SQL cannot do it. Same order the property delete uses: membership survives, so keys
handed back are keys you can still act on.

**Apply the migration before the merge that deploys the code needing it.** `main` is what
`app.snaghq.co.nz` serves, and a client naming a column the database hasn't got gets a 400 on the
whole request, which reads on screen as an empty tab. This is the one that bit the House tab.

## Build order

1. **Projects exist** — table, tab, list, detail page, three-step start sheet, photos and PDFs. One
   implicit element, no elements UI at all. This alone answers "where are the deck quotes".
2. **It goes three deep** — elements, items, quotes, the chosen-quote rollup, the honest denominator
   line. The middle-layer rule lands here, so phase 1's projects keep looking as they did.
3. **It joins up** — `snags.project_id` and `things.project_id`: the "To sort out" section, the
   *Part of* row, promoting an item to a thing, the *Installed during* row on the House record. A
   read-only project band on Schedule if it's earning its keep.
4. **It leaves the app** — `projectExportTable` through the existing one-table-two-renderers path: a
   renovation dossier PDF with photographs, quotes and what was actually spent. The artefact you
   hand an insurer, a valuer or a buyer, and probably the most valuable single thing here.

## Five things only the household can answer

1. ~~**Is five tabs acceptable?**~~ **Answered: yes.** Built as a fifth tab, third in the bar.
2. **Does "element" survive contact with your mouth?** Accurate, but nobody says "the bathroom
   element" out loud. *Parts* is taken by the shopping list; *stages* implies an order renovations
   don't have. Proposal: the heading reads **"What it takes"** and the word stays in the schema.
3. ~~**GST — in or out?**~~ **Answered: both, per amount.** Every money box carries a sliding
   incl/excl pill, defaulted to incl, and the line beneath shows the other figure as it is typed.
   Nothing is converted on save; the rollups normalise to inclusive, and every extract says so.
4. **Labour tracked separately from materials?** One more field on an item, and how a renovation
   budget is actually argued about — but also the first step towards a spreadsheet, and this app's
   whole discipline is not being one.
5. ~~**Can a project span properties?**~~ **Answered: no**, as assumed — a project belongs to one
   place, and `create_snag`, `update_snag`, `create_thing` and `update_thing` all refuse a link
   across places rather than leaving it to be noticed later.

Two remain open and neither blocks anything: whether **"element"** survives being said out loud
(shipped as *Parts of the job* on screen, with the word left in the schema), and whether **labour
should be tracked separately from materials** (not built — it is the first step towards being a
spreadsheet).

## What changed between the proposal and the build

- **Files at every level**, not just the project: elements, items and quotes each take photos and
  PDFs through one shared `Attachments` component. They **roll up** into the project's folder and
  never roll down, so the council consent is not shown inside the bathroom.
- **GST is per amount**, as above — the proposal had assumed one household-wide answer.
- **Quoted became a range rather than a single figure.** Summing per-item maxima produced a number
  nobody could defend; low-and-high is the decision actually outstanding.
- **An implicit element with nothing in it is deleted** when the first real element arrives, rather
  than lingering as a phantom part named after the project.
