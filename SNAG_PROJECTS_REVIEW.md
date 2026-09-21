# The Projects tab, reconsidered

*A review against the live job, September 2026.*

The brief was: the format is wrong and the flow isn't logical; reconsider it as if
we were building from scratch, against the invoices we actually hold. So this is
written against the one real renovation in the database rather than against the
spec — `SNAG_PROJECTS_MONEY_SPEC.md` argued the model, and most of that argument
survives. What did not survive is the *screen*, and the evidence for that is not
taste. It is a wrong number, on the page, today.

---

## 1. The number on the page is wrong, right now

The Downstairs Renovation shows:

| | On screen today | What is actually true |
|---|---|---|
| Budget | $187,000 | $187,000 |
| **Committed** | **$103,574.22** | **$192,354.22** |
| Invoiced | $97,753.22 | $97,753.22 |
| Paid | $1,952.47 | $1,952.47 |
| | *13 of 18 items priced* | *13 of 18 items priced* |

ReliaBuilder's head contract — `QU-0115`, **$176,755**, dated 30 March — is
sitting at status `tbc`. So it contributes **nothing** to Committed. What stands
in for it is the two progress claims that have been invoiced against it
(`INV-0197` deposit 25%, `INV-0208` claim 2 25%, $43,987.50 each), because
§4.3's fallback is doing exactly what it was written to do: *an invoice is the
commitment when nothing was ever quoted*.

Nothing was ever quoted — as far as the database can tell. The quote is there.
It just was never accepted.

Mark it accepted and Committed becomes **$192,354.22**: $5,354.22 **over** a
$187,000 budget, and that is *before* the five unpriced items (Toilet, Shower
glass and slider, Extractor fan, Geotech engineer, Cabinetry — Kitchen Mania).

**The screen is currently showing $88,780 of headroom that does not exist.**

It is worth being precise about the causality, because it decides the fix. The
model is not wrong — every rule in §3 and §4 computed correctly over the rows it
was given. The rows are wrong, and the rows are wrong because of where the
control lives:

- Accepting a price is a chip **six levels deep**: Projects tab → project card →
  expand the part → tap the item → `ItemSheet` opens → scroll past the status
  chips → the quote row → *Accepted / TBC / Declined*.
- And it is **worded for the wrong moment**. Accepted/TBC/Declined is the
  vocabulary of *comparing three prices for a toilet*. A builder's contract is
  not a price you are comparing; it is a thing you signed in March and have been
  paying since April. Nobody looks at a signed contract and thinks "I should
  mark that accepted."

The two *invoices* against the contract, meanwhile, are both marked `accepted` —
which does almost nothing, since `invoiced_total` counts any invoice that is not
declined. The one status that mattered was never set; the two that barely
mattered were.

That is not a user error. That is a control in the wrong place wearing the wrong
word.

---

## 2. What the live job says about everything else

One project, 4 parts, 18 items, 19 prices, 11 punch-list snags. Here is what is
carrying load and what has never once been touched:

| Feature | Rows | Verdict |
|---|---|---|
| Projects, parts, items | 1 / 4 / 18 | **Used.** The spine works |
| Quotes and invoices with amounts | 19 | **Used**, and the arithmetic is right |
| Punch list (`snags.project_id`) | 11 | **Used.** The best-performing join in the feature |
| Payments | 1 | Barely — the tiles, paid in full |
| **Quote lines / allowances** | **0** | **Never used.** The centrepiece of the money spec |
| **Element budgets** | **0** | Never used |
| **Project-level quotes** | **0** | Never used |
| **Element-level quotes** | **0** | Never used |
| **Project files / paperwork** | **0** | Never used — on a job with a consent and a contract |
| **Handover to the house record** | **0** | Never used (1 item installed) |

The previous spec predicted the first of those itself, in §8: *"A quote's lines
have no editor yet… it is the one that makes the provisional-sum rule reachable
rather than merely correct."* Five months of real use later, that is confirmed
exactly. **The provisional-sum rule has never once run against real data**, not
because it is wrong but because nothing on any screen creates a line.

But the more interesting number is the three zeroes in the middle.

### The workaround that proves the model has an axis missing

CLAUDE.md is explicit about why project-level quotes exist:

> A main contractor's contract covers the bathroom *and* the laundry, so it
> belongs to neither; forcing it onto the item layer meant inventing an item
> called "Main contract — ReliaBuilder" sitting beside the vanity, which is how
> the item layer stops meaning "a thing being bought".

Here is the live data:

```
Part: "Whole job"  (room: null)
  ├── Main contract — ReliaBuilder          ← quote $176,755 + 2 invoices
  ├── Pre-start investigation               ← invoice $839.50
  ├── Structural engineering — MSC Consulting ← 3 invoices
  ├── Architect — Gibson Architects         ← invoice $2,650.75
  ├── Tiles — Tile Space                    ← quote + invoice
  └── Geotech engineer                      ← nothing yet
```

The exact item the spec named as the thing to avoid — *"Main contract —
ReliaBuilder"* — exists, in an invented part called **"Whole job"**, beside five
more items that are not things being bought either. They are **suppliers**.
Three of them have the supplier's name in the item name.

The feature built to prevent this was shipped and is sitting at zero, because
nothing on screen offers it. Given a page with no way to say "this is a contract
covering the whole job", the only available move was to build a fake room and
fake items — and that is what happened.

**The diagnosis: scope has one axis and money has two.** Scope is by room —
Bathroom, Laundry, Workshop. Money arrives by **vendor and contract** —
ReliaBuilder, MSC, Gibson, Tile Space, Elite Bathroomware, Kitchen Mania. The
current page makes the room axis structural and the vendor axis derived
(*Who's owed what*, a read-only roll-up near the top). So every time money
arrives that does not belong to a room, it has to be smuggled in wearing a
room's clothes.

Rebuilt from scratch, **a commitment is a noun, not an attribute of a scope
item.**

---

## 3. The flow, and why it isn't one

Today's page runs: status chips → four figures → budget → who's owed → parts and
items → punch list → hand it over → paperwork → everything filed under → export
→ delete.

That is the order of the *data model*, top to bottom. It is not the order of any
question anybody asks. On a live job the questions are, in frequency order:

1. **A bill arrived. Where does it go?** (several times a month)
2. **Are we over?** (every time the first one happens)
3. **Who have we still got to pay?**
4. **What's left to decide?**
5. What did the bathroom cost? (once, at the end, for four years later)

Question 1 is the most frequent thing anybody does on this page and it is the
**deepest buried**: six levels down, and only if a scope item already exists to
hang it on. Recording MSC's third invoice means finding an item called
"Structural engineering — MSC Consulting" inside a part called "Whole job" and
adding a price to it with the kind chip flipped to Invoice.

Question 2 is answered at the top, wrongly, as §1 showed.

And there is no Forecast anywhere — which matters because question 2 is a
*forecast* question. "Committed $103,574 of $187,000" invites exactly one
reading, and that reading is wrong twice over: the contract is missing, and five
items are unpriced and contribute zero. The app deliberately refuses to put a
figure on unpriced work — rightly, as a default — but the consequence is that
the most prominent number on the page systematically **understates**, and it
understates in the direction that costs money. That is the same failure mode
§3's rules were written against, arriving through a different door.

---

## 4. What a rebuild lands on

Nearly the same tables. A different page, and two structural changes.

### 4.1 Two axes, said out loud

- **Scope** — what we are doing. Parts (rooms and non-rooms) → items. Physical
  status. This is the WBS, and it is what the handover and the house record hang
  off.
- **Commitments** — who we are paying. A contract or an order with a vendor, its
  build-up, its claims, its payments.

They meet at the line level: a commitment's line **points at** scope. They are
not the same tree and the page should stop pretending they are.

The rule that keeps this from doubling the total is the one already written and
already correct: **money is summed from exactly one place.** A commitment line
that names a scope item contributes through that item; one that names nothing is
a project-level cost. It is §3.1, applied to a noun that now exists.

### 4.2 A commitment is a first-class row

`home.project_commitments`: vendor, reference, kind (contract / order / fee
agreement / direct purchase), amount, `amount_incl_gst`, basis (fixed / estimate),
**signed_on**, status.

The word is **Signed**, not *Accepted*. "Have you signed this?" is a question
anybody can answer about a builder's contract in under a second, which
"Accepted / TBC / Declined" demonstrably is not — §1 is the proof. Comparing
three prices for a toilet keeps *Accepted / Declined*; those are genuinely
different moments and should stop sharing a control.

`project_quote_lines` becomes a commitment's build-up, with `is_allowance` and
an explicit `allowance_kind` — **PC sum / provisional sum / fixed package** —
because the brief asks for the distinction and because in New Zealand practice
the three behave differently at final account.

### 4.3 Forecast, and the honest way to have one

Four figures become five, in the order they are asked:

| | |
|---|---|
| **Budget** | what you said you'd spend. Typed |
| **Forecast** | committed + open allowances + unpriced scope at its part budget |
| **Committed** | signed contracts and accepted prices |
| **Invoiced** | what has been charged |
| **Paid** | what has left the account |

Forecast is the new one and it is the one that can lie, so it carries the same
discipline every other figure here already carries:

- **It always ships its denominator**, and the denominator now has two parts:
  *"$198,400 · 13 of 18 items priced · $11,200 of it still an allowance or a
  budget line."*
- **"Still a guess" never collapses into "not priced."** That distinction is
  §3.4 and it holds: an allowance is somebody's written number and it counts; an
  unpriced item contributes only whatever budget was set against its part, and
  **nothing at all** when no budget was set. A forecast that invents a figure for
  work nobody has priced or budgeted is the one thing this feature must not do.
- **Variance is named, not colour-coded.** Forecast over budget by more than 5%
  gets a clay line saying *"$11,400 over — the builder's tiling allowance is
  $3,500 short and four items aren't priced."* A percentage with no cause is a
  number people learn to ignore.

### 4.4 Pass-through, which the live job needs and cannot express

Tiles are the live case. ReliaBuilder's $176,755 is a lump with no build-up, and
Tile Space has been paid $1,952.47 direct. Right now those are two unrelated
rows and the app cannot tell whether the tiles are inside the contract or on top
of it. **Nobody can answer that from this screen**, which means the total is
either right or $1,952.47 double-counted and there is no way to know which.

With a build-up it is answerable and it is the brief's §Contract Allowance rule,
in this app's vocabulary:

1. The contract carries a line — *Tiling allowance, $12,400, PC sum*.
2. A direct vendor purchase **points at that line** (`supersedes_line_id`, which
   already exists and already computes correctly).
3. The line then contributes the real number instead of the allowed one, and the
   contract contributes its build-up rather than its face value — which is
   already what `project_quotes_with_totals.effective_amount` does for an
   estimate.
4. The variance is stated in words, in both tenses: *"allowed $12,400; Tile
   Space have quoted $15,900 — $3,500 over, if you accept it."*
5. **And it asks the one question the app cannot infer:** is the builder charging
   attendance or margin on the pass-through? A yes adds a percentage line to the
   contract; a no is recorded so it stops asking. Guessing either way is a lie
   about somebody's contract — the same reason `basis` asks rather than infers.

The arithmetic for all five steps is **already built and already tested**. What
is missing is the four screens that let anybody enter a line.

### 4.5 Claims, and over-billing

The live data already contains the shape: *"INV-0208 — claim 2, 25%"*. The
percentage is in a free-text field where nothing can read it.

A claim against a commitment carries **percent claimed** and, separately,
**percent you agree is done** — defaulting to *unanswered*, never to the claimed
figure. Where they disagree the page says so: *"ReliaBuilder have claimed 50%.
You've signed off 35%."* That is the brief's over-billing protection and it costs
one number and one question per claim.

Retentions ride on the claim as a number, because on a residential contract a
retention is a line on the invoice rather than a concept needing a table.

**What is deliberately not built:** quantities delivered, unit rates, m² of
tile, and a serialised asset registry. Three reasons. The house record already
*is* the asset registry — `home.things` holds make, model, serial, warranty, and
the handover path exists to fill it; a second registry inside Projects would be
two answers to "which dishwasher". Unit rates and delivered quantities are a
main contractor's job on a job this size, and a householder who types them is
doing the QS's work twice with worse data. And every one of them fails test 1 of
the loose-ends rule: **the app would not be certain**, it would be holding
somebody's retyped guess. If a later job needs them, they arrive as lines on a
commitment, not as a new hierarchy.

---

## 5. The page, in the order the questions get asked

**Projects tab** — mostly as it is. Grouped by state, done dims and sinks, no
compose bar, genuinely empty on day one. One change: each card carries forecast
against budget, so *are we over* is answerable without opening anything.

**Project page**, top to bottom:

1. **One primary action: *Record a bill or a quote*.** The most frequent thing
   anybody does, at the top, as the only filled button on the page. It asks four
   things in one sheet — **vendor → what kind of paper → amount → what it's
   against** — and *what it's against* offers the commitments and the scope items
   that already exist. **It never creates scope.** An invoice maps to scope or it
   is a project-level cost; it does not get to invent a part called "Whole job".
   That is the brief's rule and it is also the fix for §2.

2. **Where the money is.** Five figures, stacked, right-aligned, denominator
   under them, variance line in words when it is over.

3. **Who we're paying.** The commitments, each a row: vendor, signed or not,
   committed / claimed / paid / outstanding. Expands to its build-up — the
   allowance lines, what has superseded them, and what each is now reading. This
   is where the head contract lives, and where it gets signed, and it is the
   second thing on the page rather than the sixth. *Settled* rather than a zero,
   absent entirely when nobody is owed anything.

4. **What we're doing.** The scope tree. Parts and items, physical status, price
   where there is one. Unchanged in substance — this part works — but it stops
   carrying the supplier accounts, because they have somewhere to live now.

5. **To sort out** — the punch list. Unchanged. It is the best-used join here.

6. **Hand it over** — unchanged, and still standing rather than a prompt at the
   end.

7. **Paperwork**, the roll-up, export, delete. Unchanged.

The reordering alone moves *record a bill* from six levels deep to zero, and
*sign the contract* from six to two.

### What stays exactly as it is

Every one of these was argued somewhere and none of the argument has weakened:
no compose bar on this tab; no notifications; no ghosts; done dims and sinks
rather than leaving; a project page is a push and not a sheet; GST is a fact
about each amount and never a household setting; **nothing reads a figure out of
an attachment**; and every total ships its denominator. The last two are the
ones to hold hardest — the brief asks the app to extract fields from invoices,
and typing the number off the page you are looking at is the only version of
that with a source anybody can check.

---

## 6. Migration, and the live rows

Nothing is destructive and no figure moves without somebody saying so.

- `project_quotes` rows with `element_id`/`project_id` set, or with kind
  `quote`/`contract` shape, become commitments. There are none of the first two,
  so in practice this is a small, checkable set.
- The five supplier-shaped items under **"Whole job"** are the interesting case.
  Each becomes a commitment with its invoices as claims against it; the item row
  goes; the part goes with it. That is a one-off script against six rows, and it
  should be run in front of somebody rather than silently.
- `supersedes_line_id`, `basis`, `allowance_open`, `effective_amount`,
  `project_scope_money` and the supplier roll-up all survive untouched. This is
  the part worth saying plainly: **the money engine does not need rebuilding.**
  It needs a way in.

And the first thing to do, before any of it: **mark ReliaBuilder's contract
accepted.** One row. It moves Committed from $103,574.22 to $192,354.22 and the
job from comfortably-under to 2.9% over with five items still to price. Every
decision above is easier to judge once the page is telling the truth.
