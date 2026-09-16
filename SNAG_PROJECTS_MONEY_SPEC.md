# The money a renovation actually costs — a specification

**Status: specification only. Nothing here is built.** It is written to be read before a
line of code exists, because the decisions below cost three or four migrations and two of
them are hard to reverse once there is data behind them.

It answers a piece of feedback about the Projects tab:

> Include the budget for the project, with a breakdown of the components that make up this
> budget. Include quotes from all suppliers and indicate whether accepted or tbc. Also
> include invoices for what has been charged so far and what has been paid. Include a
> running total of what has been spent so far and what is outstanding so you can monitor
> whether it's likely you're going to go over. Eg Reliabuilder - $84k paid ($84k
> outstanding). Include breakdown of what quotes include if relevant (eg toilet model and
> cost). Also, enable the ability to merge final output with house tab, ie add Laundry and
> Downstairs bathroom and relevant fittings and paint colours and tile colours to that tab.

`SNAG_HOME_PIVOT_REVIEW.md` is why the product is shaped the way it is; CLAUDE.md is the
standing record of every decision already taken. This file is the third kind: a design
that has been agreed and not yet written. When it is built, its content moves into
CLAUDE.md and this file goes.

---

## 1. What ships today, and the bug in it

The Projects tab exists. Four tables (`projects`, `project_elements`, `project_items`,
`project_quotes`), the implicit-element rule that keeps four levels showing as two, quotes
with a supplier and an amount and a GST pill, a `quote | invoice | receipt` kind, three
derived figures — Quoted, Chosen, Spent — and one-at-a-time promotion of a project item
into a House-tab thing.

**`spent_total` double-counts, and it is live.**

```sql
(select sum(home.incl_gst(q.amount, q.amount_incl_gst))
   from home.project_quotes q
  where q.item_id = i.id
    and q.amount is not null
    and q.kind in ('invoice', 'receipt'))
  as spent
```

Record Reliabuilder's $84,000 invoice, then record the $84,000 payment against it as a
receipt, and the project reads **$168,000 spent**. That is the single most misleading
number this app can produce and it misleads in the direction that costs money. It is not a
display bug — the arithmetic is wrong in the view, so it is wrong in the CSV, wrong in the
PDF, and wrong in the You tab's reads.

The fix is not a `case` in the view. It is §4: a payment stops being a sibling of the bill
it settles.

**What else is missing, against the feedback:**

| Asked for | Today |
|---|---|
| Budget with a breakdown of its components | One optional project-level number, rendered as a trailing clause on the denominator line |
| Quotes from all suppliers, accepted or TBC | A `chosen` boolean. An unchosen quote cannot say whether it is undecided or turned down |
| Invoices — charged, and paid | One conflated `spent`, double-counted as above |
| Running total spent and outstanding | No notion of outstanding at all |
| "Reliabuilder — $84k paid ($84k outstanding)" | No supplier rollup anywhere. `supplier` is free text on a quote and nothing groups by it |
| Breakdown of what a quote includes | One 200-character `detail` field, unpriced and untotallable |
| Merge the final output into the House tab | One item at a time, from inside the item sheet. "What it left behind" is a bare count |

---

## 2. The decisions taken

Recorded so the reasoning survives the build.

| # | Decision | Taken |
|---|---|---|
| 1 | Where a quote can attach | Any level: item, part, or the whole project |
| 2 | Breakdown of what a quote includes | Priced line items inside the quote |
| 3 | The Reliabuilder case | **Link a later quote to the master quote's line and show the price build as it gets more granular** |
| 4 | Charged vs paid | A payment is recorded against the invoice it settles |
| 5 | Headline figures | Committed · Paid · Outstanding |
| 6 | Going over | A fourth line: budget, with committed over/under it |
| 7 | Budget breakdown | Per part, rolling up to the project |
| 8 | Suppliers | Free text, but offered from what has been typed before |
| 9 | Quote states | Accepted / TBC / Declined |
| 10 | Quoted range | **Dropped** |
| 11 | Handover to House | A standing "Hand it over" section with tick boxes |
| 12 | How much handover asks | Pre-fill everything it knows, one confirm per row |
| 13 | New thing kinds | Tile |
| 14 | What carries across | Supplier and model from the accepted quote · the invoice as paperwork · installed date from the invoice |

Decision 3 was written rather than chosen from options, and it is the one the rest of the
money model is built on. In full:

> The builder may have provided a quote, which includes estimates (i.e. a line for bathroom
> fittings), but doesn't himself supply it. If a new quote comes in, link it to the master
> quote and show the price build as the quote begins to get more granular.

---

## 3. The provisional-sum rule

This is the centre of the design. Everything else in §4 hangs off it.

**A builder's number is not one number.** Reliabuilder's $84,000 is a list: labour and
install, waterproofing, tiling — and, against the fittings and the tiles, an *allowance*.
A figure the builder wrote down for something they are not themselves supplying, or have
not yet priced. In New Zealand building contracts these are provisional sums and PC sums,
and they are the reason a renovation goes over: they are the lines that move.

So a quote carries **lines**, and a line is one of two things:

- **Fixed** — this is the price of this, in this quote.
- **An allowance** — a placeholder with a number on it. "Bathroom fittings — allow $6,000."

And a later quote can be **linked to a line**. When the plumbing merchant quotes $890 for
the Caroma Luna, that quote points at the *Bathroom fittings* line of the Reliabuilder
quote. Once it is accepted, the line's contribution to the build-up becomes what was
actually quoted, instead of what was allowed.

```
Reliabuilder · estimate · accepted                              $83,240
  Labour and install                                   $52,000   fixed
  Waterproofing                                         $6,400   fixed
  Bathroom fittings          allowed $6,000  →          $5,240   3 linked, accepted
  Tiling                                               $11,200   fixed
  Tiles                      allowed $8,400  →          $8,400   nothing linked yet

  $83,240 committed · $8,400 of it still an allowance · $760 under what was allowed
```

Four rules make that honest, and each one prevents a specific failure.

### 3.1 Money is summed from exactly one place

**A quote that supersedes a line contributes only through that line.** It never also sums
into its part's total on its own account.

This is the whole answer to "$84k or $84.9k". The toilet's $890 is inside the contract
because somebody linked it, and outside the contract because nobody did — and the act of
linking is the same act that gives you the breakdown you wanted. There is no flag to set
and no question asked on every item. An item's quote that points at nothing is a separate
purchase and sums normally.

The failure this prevents is the one the codebase already names in the elements decision:
*a rollup with two paths to sum through is how a total starts disagreeing with itself.*

### 3.2 A quote says whether its number can move

A quote carries a **basis**:

- **Fixed price** — the $84,000 stands whatever the fittings actually cost. Linked actuals
  still show, because the build-up is worth reading, and variance against an allowance
  still shows — but it is the builder's variance, not yours, and the committed figure does
  not move. A real change costs a variation, which is a new quote.
- **Estimate** — the $84,000 moves as actuals land. Committed is the recomputed build-up.

The app cannot infer which of these it is holding, and guessing would be a lie about
someone's contract. So it asks, once, on the quote, as two named pills — the same argument
that made capture's priority two named pills and the GST control two named halves. Default
**Fixed price**, because a householder who does not know the difference almost certainly
has a fixed-price quote, and because it is the answer that does not silently move.

### 3.3 A recomputed total always says how much of itself is still a guess

*$83,240 committed · $8,400 of it still an allowance.*

This is rule one of the money design — a total always ships its denominator — applied one
level down. A build-up where a third of the lines are numbers the builder made up is
exactly as misleading as a project total assembled from half its items, and it misleads the
same way. `describeTotals` gets a sibling, and no screen may draw a recomputed figure
without it.

### 3.4 An allowance is not an unpriced item

An unpriced item contributes nothing to any sum — it is counted in the denominator and
nowhere else, and that is what makes the denominator do its job. An allowance is the
opposite: somebody wrote a number down, and it is the best number there is. It counts.

The two must never be shown in the same words, or the distinction collapses and the
denominator stops meaning anything. "Not priced" for the first; "still an allowance" for
the second.

### 3.5 Where the early warning actually comes from

Per-line variance is a far better answer to "are we likely to go over" than any
project-level forecast, and it needs nothing invented:

> Tiles — allowed $8,400, quoted $11,900. **$3,500 over the allowance.**

That is a real number from a real quote, three months before the invoice, and it is why
decision 6's budget line is enough on its own and no forecast-at-completion figure is
needed. The app never estimates. It reports the gap between what somebody allowed and what
somebody has since quoted, and lets you draw the conclusion.

---

## 4. The money model

### 4.1 A quote attaches to one level

`project_quotes` gains `element_id` and `project_id` beside `item_id`, all nullable, with a
check that **exactly one** is set. Reliabuilder's contract sits on the Downstairs bathroom
part; a council fee sits on the project; the toilet sits on its item.

The reads are then: an item's quotes, a part's own quotes, and the project's own quotes —
three lists, never merged, because a part-level contract is not one of the bathroom's
purchases and showing it among them is how the layer stops meaning anything.

> **Open question A.** With linking in place, is the project level needed at all? A project
> with one implicit part already routes a "whole project" quote onto that part, and the
> person never meets the word. Dropping `project_id` would remove a third summing path
> before it exists. Recommendation: **drop it, allow item and part only** — but it was not
> what was chosen, so it is flagged rather than assumed.

### 4.2 Lines

```
home.project_quote_lines
  id, quote_id, sort_order
  name           text not null          -- "Bathroom fittings"
  detail         text                   -- "Caroma Luna, Methven Krome"
  amount         numeric(12,2)
  amount_incl_gst boolean not null default true
  is_allowance   boolean not null default false
```

**The quote's own amount stays the authority.** Lines explain it; they are not required to
sum to it. Trade quotes round, bundle and carry a margin line that is nobody's business,
and a form that refuses a quote whose lines do not balance teaches people to fudge a line
until it does. Where they differ the page says so quietly — *lines account for $81,900 of
$84,000* — and never corrects either.

The exception is the recomputed build-up of §3, which is arithmetic over lines by
definition, and which is exactly why it is reported as its own figure beside the amount as
typed rather than replacing it.

`detail` on the line is where "toilet model and cost" lands. The 200-character `detail` on
the quote itself stays for the single-item case, where the item's name is nearly the whole
answer and a lines table would be ceremony.

### 4.3 Linking

`project_quotes.supersedes_line_id uuid references home.project_quote_lines(id) on delete set null`

`on delete set null`, never cascade, for the reason every other join in this schema is:
deleting the contract must not delete the plumber's quote. The quote comes unlinked and
starts summing on its own account, which is the correct meaning of the contract having gone
away.

Several quotes may point at one line — that is the normal case, three quotes against the
fittings allowance. **Only accepted ones move the build-up.** TBC ones show against the
line as *3 quotes in, nothing decided*, which is the state that is somebody's next move and
which today has nowhere to be said.

A linked quote must belong to the same project as the line it supersedes. Enforced in the
write function, in words, not left to a foreign key that cannot see across the join.

### 4.4 Accepted / TBC / Declined

`chosen boolean` becomes `status home.project_quote_status` — `tbc | accepted | declined`,
defaulting to `tbc`.

- The partial unique index becomes `where status = 'accepted'` — still at most one accepted
  quote per item, still enforced rather than hoped for.
- **A declined quote stays on the record.** It is dropped from every sum and from the
  build-up, and kept because what you were quoted and by whom is what makes the next
  renovation's numbers credible. It renders quietly, the way a done snag does.
- `home.set_quote_status` replaces `home.set_quote_chosen`, and stays its own function for
  the reason that one is: it is the only write that changes what a total says, and alone it
  cannot have its sibling-clearing skipped by a caller passing a status among eight other
  fields. It clears the sibling *first*, because the index is plain and not deferred.

### 4.5 A payment is not a bill

```
home.project_payments
  id, quote_id           -- the invoice it settles
  amount numeric(12,2) not null
  amount_incl_gst boolean not null default true
  paid_on date
  reference text         -- "Deposit", "Progress claim 2"
  notes text
  created_by, created_at
```

`quote_id` points at a quote whose kind is `invoice`. A deposit and a balance are two
payments against one invoice, which is what actually happens and what the sibling-rows
model could not say.

**Paid** is the sum of payments. **Committed** is the sum of accepted quotes, by the rules
of §3. The double-count is not fixed; it is made unrepresentable, because a payment is no
longer the sort of thing that can be summed alongside a bill.

**`receipt` leaves the vocabulary.** A receipt is a payment's evidence, not a third kind of
paper. Existing `receipt` rows migrate to an `invoice` plus a payment settling it in full on
the same date — both figures preserved, nothing lost. The enum value itself stays, unused
and unoffered, because Postgres cannot drop one; the same shape as `household_members.role`
sitting in the schema with nothing reading it.

> **Before writing that migration: count the live rows.** Projects shipped on 2026-09-16 and
> there may be no `receipt` rows at all, in which case the conversion is a no-op and should
> say so rather than being written defensively against data that does not exist.

### 4.6 The three figures, and the fourth line

The strip becomes:

```
Committed      $168,000
Paid            $84,000
Outstanding     $84,000
———
Budget         $180,000 · $12,000 under
5 of 9 items priced · 2 quoted, not decided · $8,400 still an allowance
```

- **Committed** — accepted quotes, by §3's rules.
- **Paid** — payments.
- **Outstanding** — committed less paid. This is your Reliabuilder line: what is still to go
  out on work already agreed. It is deliberately *not* invoiced-less-paid, which is a
  different and shorter-horizon question.
- **Budget** — §4.7, with committed over or under it, in words.

**Quoted is dropped.** `rangeLow`, `rangeHigh`, `rangeLabel` and `hasOpenRange` go, along
with the range column in both extracts and the tests pinning the range collapsing when
nothing is left to decide. CLAUDE.md's "Three figures, never one" paragraph is rewritten
rather than amended — Quoted was doing the early-planning job, and per-line allowance
variance (§3.5) now does it better and against real numbers.

> **Open question B.** Should the per-supplier rows also carry *invoiced but not yet paid* —
> the near-term cash question, distinct from outstanding? Recommendation: not on the strip,
> but shown when a supplier's row is expanded, where its invoices already are.

### 4.7 Budget per part

`project_elements` gains `budget numeric(12,2)` and `budget_incl_gst boolean not null
default true`.

**`projects.budget` stays and remains the project's budget.** This is a deliberate
divergence from the wording of decision 7, which said the project budget "stops being typed
separately", and it is flagged as such because it is worth arguing about.

The reason: a derived project budget that silently overwrites a number somebody typed is the
app telling them they did not mean what they typed. And the ordinary way a renovation is
budgeted is top-down — $180,000 for the job, broken into rooms later, and the breakdown
never quite adds up because the contingency lives nowhere. So both exist and the page names
the difference rather than resolving it:

> *Parts budgeted $172,000 of $180,000 · $8,000 unallocated*
>
> *Parts budgeted $186,000 — $6,000 more than the project budget*

That is the denominator rule applied to budget: it cannot lie, it never rewrites, and it
handles the case where the parts are deliberately under the total.

A project with one implicit part types one budget on the project page and never meets the
concept, exactly as it never meets the word "element".

### 4.8 Who's owed what

A section on the project page, under the money strip, absent entirely when nothing is owed —
the same rule as the shopping pill at zero and *Fit* in the photo viewer.

```
Who's owed what
  Reliabuilder          committed $168,000   paid $84,000   outstanding $84,000
  Heat Pumps Direct      committed  $4,600   paid  $4,600   settled
  Tile Depot             committed $11,900   paid      —    outstanding $11,900
```

`home.project_supplier_totals`, a view grouping on `lower(btrim(supplier))` and displaying
the most recently used spelling. Quotes with no supplier named group under one unnamed row
rather than being dropped — money owed to somebody you did not name is still money owed.

Two supporting pieces:

- **The supplier field offers what has been typed before** on this property, so
  "Reliabuilder" is tapped rather than retyped as "Relia Builder". The same argument as the
  room picker: *a picker is the only control that cannot misspell the vocabulary* — except
  here it stays free text underneath, because a supplier list nobody wanted to fill in is
  setup, and this app does not do setup.
- **`home.rename_supplier(p_project_id, p_from, p_to)`**, because otherwise a typo noticed
  at $168,000 is fixable only quote by quote, and a rollup nobody can correct is a rollup
  nobody trusts.

> **Open question C.** House-wide rather than per project — "who do we owe, across
> everything"? Genuinely useful with two renovations running. Not in this spec: five tabs is
> the stated ceiling, so it would be a second screen inside Projects, and it should wait
> until one project's version has been lived with.

---

## 5. Merging into the House tab

### 5.1 Which items have been handed over

`home.things` gains `project_item_id uuid references home.project_items(id) on delete set
null`, not unique — a tiled bathroom leaves a tile record and a grout record from one item.
`on delete set null` for the standing reason: deleting the record of the renovation must not
delete the washing machine.

Without it there is no way to know which items are already in the record, and a handover
checklist that cannot tell offers everything again every time.

`create_thing` gains `p_project_item_id`, carried in at creation rather than written
afterwards — *a create-then-update is two chances to write half of it*.

### 5.2 Hand it over

A standing section on the project page, not a prompt at the end:

```
Hand it over                                        3 of 11 in the house record

  ☐  Caroma Luna toilet          Downstairs bathroom
  ☐  Methven Krome mixer         Downstairs bathroom
  ☑  Bosch dishwasher            Laundry              → in the house record
```

Available from day one, because the model number gets recorded the week the thing is
installed and the paperwork is in your hand — not eight months later, and not only if
somebody remembers to mark the project done. It replaces the current bare count.

**Each tick opens the walkthrough pre-filled, and you confirm.** Not a bulk write. The rule
this protects is already in CLAUDE.md, about creating a thing from a snag:

> a record created from here has to be as strong as one created from the House tab, or this
> is the back door that fills the house record with rows nobody can read in a shop.

Twelve confirmations is slower than one tap. An 8%-complete house record is worse than none,
and this is the exact door it would come through.

### 5.3 What is pre-filled

| Thing field | Comes from |
|---|---|
| Name | The item's name |
| Room | The part's room |
| Make | The accepted quote's supplier |
| Model | The accepted quote's `detail`, or the superseding line's `detail` |
| Documents | The invoice PDF for that item |
| Installed | The invoice's date |
| Kind | Asked — see below |

Kind is the one thing not guessable, and guessing it wrong turns a dishwasher into a tin of
paint on a page that no longer offers a kind switch. It is asked in the walkthrough's step
two, as it already is.

Photos were considered and left out: a photo of a quote document is not a photo of the
fitting, and the strip is the one place on the thing page that has to be worth opening.

### 5.4 Tile

`home.thing_kind` gains `tile`, and `THING_KINDS` offers three: Appliance, Paint, Tile.

Tiles behave like paint and not like an appliance — the colour is the headline, there are
several in one room, and the thing that tells two apart is where they went. So they take the
paint shape:

```
tile: { make: 'Range', model: 'Colour or code', notes: 'Where it went' }
```

with size, finish and grout colour in `spec`, which is what `spec` is for — *the small tail,
never the body*. `notes` renders on the card, as a finish's does, and for the same reason:
two tiles in one bathroom are told apart by the floor and the wall.

**`alter type ... add value` must be its own migration.** Postgres will not let a new enum
value be used in the same transaction that adds it, and `apply_migration` runs in one. So
the value is added alone and anything referring to the literal comes in the next file — in
practice nothing server-side does, since `create_thing` takes the kind as an argument, but
the file boundary is not optional and getting it wrong fails the whole migration.

> **Open question D.** Should `ROOM_SUGGESTIONS` grow a Tile ghost for bathrooms, laundries
> and kitchens? It would follow the Paint precedent exactly — one general prompt per room,
> answered by any tile recorded in it. Recommendation: yes, but in the handover migration's
> follow-up, once the kind has been lived with.

### 5.5 Rooms

Nothing to build. A part is created from the room picker, which writes through
`home.create_location`, so "Downstairs bathroom" is already a room on the House tab and the
List tab the moment the project names it — *one vocabulary, or the tabs stop describing the
same house*. Parts that are not rooms — *Consent and council*, *Scaffolding* — carry a null
room and correctly become nothing on the House tab.

---

## 6. The work

### Migrations

| File | What |
|---|---|
| `20260918090000_a_payment_is_not_a_bill.sql` | `project_payments`; `project_quote_status`; `chosen` → `status`; `receipt` rows → invoice + payment; rollups rewritten to Committed / Paid / Outstanding; range columns dropped. **Fixes the live double-count.** |
| `20260918091000_a_quote_can_cover_more_than_one_thing.sql` | `element_id` / `project_id` on quotes with exactly-one check; `project_quote_lines`; `supersedes_line_id`; quote `basis`; rollups recomputed under §3 |
| `20260918092000_a_budget_has_parts.sql` | Element budgets; the unallocated line; `project_supplier_totals`; `rename_supplier` |
| `20260918093000_a_thing_knows_which_item_it_came_from.sql` | `things.project_item_id`; `create_thing` gains it; the handover read |
| `20260918094000_a_tile_is_not_paint.sql` | `alter type home.thing_kind add value 'tile'` — **alone in its file** |

Every view is rewritten with its columns **written out one by one**, never `select t.*`, and
every new column is added to `things_with_details` / the project rollups by name. `create or
replace view` can only append, so restoring a column to its place means dropping and
recreating — which takes the grant with it, and the grant must be re-issued.

`notify pgrst, 'reload schema';` after each. And each is applied **before** the merge that
deploys the code reading it: `main` is what `app.snaghq.co.nz` serves, and a client naming a
column the database has not got gets a 400 on the whole request, which reads on screen as an
empty tab.

### Client

- `packages/shared-types` — `ProjectQuoteStatus`, `ProjectQuoteBasis`, `ProjectQuoteLine`,
  `ProjectPayment`, `ProjectSupplierTotals`; `ProjectTotals` loses `rangeLow`/`rangeHigh`
  and gains `committedTotal`, `paidTotal`, `allowanceTotal`; `THING_KINDS` gains `tile`.
- `packages/supabase-queries` — the writes; `describeBuildUp` beside `describeTotals`;
  `supplierTotals`; `rangeLabel` and `hasOpenRange` deleted; both extract builders updated.
- `ItemSheet` — status pills replacing the chosen tick, lines, linking.
- New: `QuoteLinesSheet`, `PaymentSheet`, `SupplierTotals`, `HandItOver`.
- `ProjectDetailScreen` — the four-line strip, Who's owed what, Hand it over.
- `ThingDetailScreen` / `AddThingSheet` — the tile kind's labels and spec fields.

Every new amount uses `MoneyField` and carries the GST pill. Every new date uses
`DateField`. Every confirmation is `ConfirmDialog`, never `Alert.alert`. No new colour: a
line over its allowance takes clay, which is already what overdue means, and nothing else
gains a hue.

### Tests

`projects.test.ts` carries the money rules as properties, and gains:

- A payment can never be summed as a bill — the $84k double-count, as a regression test.
- A superseded quote contributes through its line and not also to its part's total.
- A fixed-price quote's committed figure does not move when a linked actual lands; an
  estimate's does.
- A recomputed total always reports how much of itself is still an allowance.
- An allowance counts toward the total; an unpriced item does not — and they are never
  worded the same.
- A declined quote leaves every sum and stays on the record.
- Supplier grouping is case- and whitespace-insensitive and drops nobody.
- Parts budgeting under, over and exactly to the project budget.

`ItemSheet.test.tsx` — the three states, a line with and without a price, linking and
unlinking, and that `status` never rides along with a correction.
`ProjectDetailScreen.test.tsx` — no figure without its denominator, the supplier section
absent at zero, the handover list excluding what is already in the record.
`ThingDetailScreen.test.tsx` — a tile's labels, and no Serial box on one.
`HouseScreen.test.tsx` — a tile counts as recorded.
`exportFile.test.ts` — the new columns, and the range column gone.

### CLAUDE.md

Rewritten, not appended: *Money that cannot lie about itself* (three figures → four lines),
*Nobody types Quoted, Chosen or Spent*, *Five kinds, two built* → three built, and a new
section for the provisional-sum rule.

### Order

Migration 1 alone, first, and merged on its own — it fixes a wrong number on a live app and
should not wait behind a House-tab feature. Then 2–3 as the money change, then 4–5 as the
handover. Three reviewable pushes, each independently useful.

---

## 7. What is still open

| | Question | Recommendation |
|---|---|---|
| A | Is a project-level quote needed, now that linking exists? | Drop it; item and part only |
| B | Invoiced-but-unpaid as a fourth per-supplier figure? | Not on the strip; on the expanded supplier row |
| C | A house-wide "who do we owe" across projects? | Wait until one project's version has been lived with |
| D | A Tile ghost in `ROOM_SUGGESTIONS`? | Yes, after the kind has shipped |
| E | §4.7 keeps `projects.budget` as a typed number, against the wording of decision 7 | Keep both and name the gap — but this is the one divergence worth arguing about |
| F | Count live `receipt` rows before writing their migration | — |
