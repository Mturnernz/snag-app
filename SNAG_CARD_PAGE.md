# The Snag Card Page

How the snag list works: what each card shows, what every tag means, how the list is ordered
and filtered, and why each of those decisions was made.

**Scope.** The "snag card page" is `apps/mobile`'s **Snags tab** — `IssueListScreen.tsx`
rendering a two-column grid of `IssueCard.tsx`. `apps/web`'s `/snags` is the same data in a
different shape (a single-column row list); its divergences are collected in §10 rather than
scattered through the document.

**Files this describes**

| Concern | File |
|---|---|
| The page: query, filters, select mode, modals | `apps/mobile/src/screens/IssueListScreen.tsx` |
| The card | `apps/mobile/src/components/IssueCard.tsx` |
| Ordering + the attention strip's rule | `apps/mobile/src/lib/snagOrdering.ts` (`.test.ts`) |
| Tags | `apps/mobile/src/components/{Status,Category,Priority,Relevance}Badge.tsx` → `Badge.tsx` |
| Tokens | `apps/mobile/src/constants/theme.ts` |
| Enums + labels, shared by both clients | `packages/shared-types/src/index.ts` |
| The view everything reads | `snags_with_details` (latest def: `supabase/migrations/20260724120000_rca_waiver_and_outstanding.sql`) |
| Web counterpart | `apps/web/src/app/(portal)/snags/page.tsx` |

---

## 1. Where the data comes from

Every card is one row of **`snags_with_details`** — the view that joins snags to reporter/owner/
site names and pre-aggregates the counts. The list never queries `snags` directly, because half
of what a card displays (`reporter_name`, `owner_name`, `site_name`, `comment_count`,
`vote_score`, `child_count`) exists only in the view.

The page selects a deliberately narrow column list rather than `*` — a card needs 20 columns and
the view has roughly four times that, including investigation columns only the detail screen
reads.

```
id, reference, status, kind, lane, severity, photo_path, created_at,
reporter_id, reporter_name, owner_id, owner_name,
comment_count, vote_score, description,
site_id, site_name, is_public_submission, child_count, work_group_id
```

Three clauses are on the query unconditionally, before any user filter:

- **`.is('parent_snag_id', null)`** — merged children never appear in the list. They are reachable
  only from their parent's "Merged snags" section. The hierarchy is single-level and enforced
  server-side, so a parent is never itself a child and parents always show.
- **`.eq('org_id', activeOrgId)`** — *not* redundant with RLS. RLS additionally allows you to see
  any snag *you* reported, even in a different org, so that a cross-org or public reporter can
  track their own report. Without the explicit org filter, those snags leak into the active org's
  list.
- **`.eq('is_public_submission', publicOnly)`** — members see internal reports by default; the
  Public toggle switches the list to the public-submission queue. It is a switch between two
  queues, not an additive filter.

Aggregate semantics, from the view:

- `comment_count` — `count(*)` over `comments` for that snag.
- `vote_score` — `sum(votes.value)`, i.e. **net** score. Upvotes and downvotes are ±1, so this can
  be negative. (`upvote_count`/`downvote_count` exist in the view but the card doesn't select them.)
- `child_count` — how many snags were merged into this one.
- `lane` is a **generated column** on `snags`: `fixit`/`improvement` → `niggle`,
  `hazard`/`incident` → `serious`. The card doesn't display it, but the bulk-actions modal branches
  on it, because niggles and serious snags have different status rules.

---

## 2. Anatomy of a card

The card has two zones: a **photo** carrying four overlays, and a **body** carrying text and tags.
Reading order is deliberate — the photo is the identifying feature of a snag (someone photographed
a thing), so it gets the top and the overlays are pinned to its corners rather than pushing the
text down.

```
┌──────────────────────────────────┐
│ [merge] [relevance]     [status] │  ← photo overlays: top-left stack, top-right
│                                  │
│            (photo)               │
│                                  │
│            ( site )              │  ← bottom-centre pill
├──────────────────────────────────┤
│ SNAG-00042                       │  ← reference (full variant only)
│ Description, 2 lines max…        │
│ [kind] [severity]                │  ← severity badge: full variant only
│ 3h ago              💬 2   ▲ 5   │  ← footer: time + engagement
│                    👤 A. Ngata   │  ← assignee, only if there is one
└──────────────────────────────────┘
```

**Photo.** `expo-image` with `cachePolicy="memory-disk"`, a fixed blurhash placeholder, and a 200ms
transition — the placeholder matters more than it looks, because the grid loads two columns of
images at once and an unplaceheld grid flashes white blocks on every scroll.

Cards with no photo get a bordered placeholder with a camera icon rather than collapsing, so the
grid keeps a uniform row height. The `snags` table's check constraint requires a description **or**
a photo, so a card is never empty of both — but either one alone is possible, which is why both the
placeholder and `'No description'` exist.

**Status overlay** sits top-right on the photo, always. It is the one tag that is on every card in
every configuration, including the compact grid.

**Top-left stack** holds the merge-parent indicator and the relevance tag, stacked vertically, both
`pointerEvents="none"` so they never swallow a tap meant for the card. In select mode the whole
stack is hidden — that corner belongs to the selection checkmark, and two things fighting for one
corner reads as a bug.

**Site pill** is bottom-centre on the photo rather than in the body, because in the compact grid the
body has room for roughly three lines and the site name is worth less than the description. It's
capped at 85% width with `numberOfLines={1}`.

**Body.** Description truncated to two lines (`numberOfLines={2}`) — it's the snag's title in
practice, since snags have no title field.

**Footer** pairs a timestamp with the engagement stats. `timeAgo` is deliberately coarse:
`just now` → `Nm ago` → `Nh ago` → `Nd ago`, and it never rolls over into weeks or months. Nothing
in a snag list is usefully "3 weeks ago" versus "24d ago", and the finer unit stays scannable.

**Assignee** gets its own right-aligned row rather than being tucked into the footer — the compact
footer is a column and the full footer already has the stats in its right-hand slot, so neither has
a free slot. It is **omitted, not labelled "Unassigned"**: most snags in any list have nobody on
them, so the label would appear on nearly every card and carry no information. The empty slot says
the same thing more quietly. Finding unassigned work deliberately is what the Scope dropdown's
"Unassigned in my sites" is for.

### Compact vs. full

Both call sites on the list screen pass `compact`, so the grid is always the compact variant. The
full variant is a complete, working configuration that nothing currently renders — it is the shape
the card takes at one column, and the differences are:

| | compact (the grid) | full |
|---|---|---|
| Photo height | 110px | 220px |
| `SNAG-000xx` reference | hidden | shown |
| Title size | `Typography.sm` | `Typography.lg` |
| Severity badge | **hidden** | shown |
| Footer | two rows (time, then stats) | one row (`site · reporter · time` + stats) |
| Placeholder caption | icon only | icon + "No photo" |

The consequential one is **severity**: in the grid it is not a badge at all. It is carried entirely
by the card's alert border (§3.5). That is intentional — at 110px of photo and two lines of text,
a third pill would crowd the body — but it does mean the border is load-bearing, not decorative.

---

## 3. Every tag on the card

All tags render through one `Badge` component with two variants:

- **`solid`** — a tinted pill: coloured text on a light background of the same hue. For states
  worth calling out.
- **`dot`** — a 6px coloured dot with a neutral `textSecondary` label. For low-signal values that
  shouldn't visually compete with the pills.

Every label comes from `packages/shared-types` (`STATUS_LABELS`, `KIND_LABELS`, `SEVERITY_LABELS`,
`RELEVANCE_REASON_LABELS`), so the two clients cannot drift on wording.

### 3.1 Status — `StatusBadge`, top-right on the photo

`snag_status` has four values and `resolved` is the single terminal state for **both** lanes. There
is no separate "sorted" status; it was retired and collapsed into `resolved`.

| Status | Label | Text | Background |
|---|---|---|---|
| `flagged` | Flagged | `#1D4ED8` | `#EFF6FF` |
| `in_progress` | In Progress | `#B45309` | `#FFFBEB` |
| `resolved` | Resolved | `#047857` | `#ECFDF5` |
| `rca_pending` | RCA Pending | `#B91C1C` | `#FEE2E2` |

The badge uses each status's **`*Fg`** token, not its base hue. This is the whole reason the status
palette carries three values per status instead of two. The base hue is for dots, icons and rails,
where WCAG's 3:1 non-text threshold applies; as label text on its own tint it doesn't clear 4.5:1 —
in-progress measured **2.07:1**, on a badge whose job is to say whether a hazard is being dealt
with. `apps/web` mirrors these values and its axe suite fails if either regresses.

### 3.2 Category — `CategoryBadge`, first in the badge row

`kind` is the reporter's classification and determines the lane.

| Kind | Label | Lane | Colour |
|---|---|---|---|
| `fixit` | Fixit | niggle | grey `#6B7280` on `#F3F4F6` |
| `improvement` | Improvement | niggle | purple `#7C3AED` on `#EDE9FE` |
| `hazard` | Hazard | serious | amber `#B45309` on `#FEF3C7` |
| `incident` | Incident | serious | red `#DC2626` on `#FEE2E2` |

The two niggle kinds are quiet; the two serious kinds carry warm alert hues, so lane is legible
from the badge row without a lane tag existing.

### 3.3 Severity — `PriorityBadge` (full variant only)

`severity` is nullable and is only *required* for `hazard`/`incident` (a table check constraint) —
so a fixit legitimately has none, and the badge returns `null` rather than rendering an empty pill.

| Severity | Label | Rendering |
|---|---|---|
| `critical` | Critical | solid pill, `priority.high` red on `#FEF2F2` |
| `injury` | Injury | solid pill, amber `#B45309` on `#FEF3C7` |
| `moderate` | Moderate | **dot**, `priority.medium` grey |
| `minor` | Minor | **dot**, `priority.low` grey |

The rule: **only the top two severities carry an alert colour.** Rendering `minor` and `moderate`
as coloured pills would put a fourth and fifth alert hue on a card that already has a status pill
and a kind pill, and they would collide with the status colours — a green "Minor" reads as
resolved. The dot variant keeps them present and readable without competing.

### 3.4 Relevance — `RelevanceBadge`, top-left on the photo

This one is different in kind: it answers **"why is this snag in front of me?"** rather than
describing the snag. It is **computed client-side** in `relevanceReason()`, not a column — it
depends on who is signed in.

Evaluated in priority order, and a snag matching several reasons shows only the **first** that
applies:

| Order | Reason | Label | Condition | Colour |
|---|---|---|---|---|
| 1 | `rca_pending` | RCA Pending | you have an open RCA assignment on it (`snag_rca.assigned_to = you`, status `assigned`/`in_progress`) | red `#DC2626` |
| 2 | `assigned` | Assigned | `owner_id` is you | blue `#2563EB` |
| 3 | `tagged` | Tagged | you're @mentioned on it (`comment_mentions`) | purple `#7C3AED` |
| 4 | `reported` | Reported | `reporter_id` is you | grey `#6B7280` |

The order is **most to least actionable**. An RCA assigned to you is work with a deadline; being
the person who reported it is the weakest claim on your attention, so it loses to everything else.
The palette is deliberately distinct from the status and category palettes for the same reason —
these tags are a different sentence about the card.

Note that the reason is computed for **every** loaded row regardless of the active scope, so a card
still says "Assigned" while you're browsing "All in my sites". That's intentional: the tag explains
your relationship to the snag, not the filter that fetched it.

### 3.5 Alert border — the severity signal in the grid

`CardAlertBorder` in `theme.ts`, applied as a 2px border **layered on top of** the card's normal
`Shadow.sm`. This is a narrow, deliberate exception to the design system's "an elevated card drops
its border" rule, and it is documented as such at the token.

Precedence, first match wins:

1. `severity === 'injury'` → **black** (`Colors.black`)
2. `severity === 'critical'` → **red** (`priority.high`)
3. `kind === 'improvement'` → **purple** (`category.other`)
4. otherwise → no border

**Severity outranks kind**: an injury fixit is still an injury. Black for injury rather than a
brighter red is the one colour choice on this page that isn't hue-coded by meaning — red is already
`critical`, and an injury has to outrank a critical without competing with it.

`improvement` gets a border not as an alarm but because it's the one kind that is *good news* in a
list of problems, and it is otherwise the quietest thing on the card (grey-purple pill, no
severity). The border is how it gets found.

Selection borrows the same mechanism: a selected card gets a 2px `Colors.primary` border, and
because it's applied after the alert border in the style array it wins while select mode is active.

### 3.6 Non-badge markers

- **Merge indicator** — an `albums-outline` icon on a dark scrim, shown when `child_count > 0`.
  Icon rather than a count, because the number of merged children is detail the parent's own page
  carries; the list only needs to say "this is a roll-up".
- **Site pill** — dark scrim, white semibold text, bottom-centre.
- **Stats row** — comment count with a `chatbubble-outline`, then net vote score with a **directional
  caret**: `caret-up` green when positive, `caret-down` red when negative, `remove` (a dash) grey at
  zero. The number is rendered as `Math.abs(voteScore)` — the sign lives in the icon and the colour,
  so `-3` reads as "3, downvoted" rather than as a negative number the reader has to parse.
- **Select checkmark** — `checkmark-circle` in primary when selected, `ellipse-outline` in white
  when not, top-left, only in select mode.

---

## 4. Ordering and ranking

`apps/mobile/src/lib/snagOrdering.ts` is a 40-line file with a 20-line comment, and the comment is
the point.

### 4.1 The rule: the first card is the most recent one

That sounds too obvious to write down, and it was. Unresolved injury snags used to be pinned to the
front of the grid, so filing a snag into an org with an open injury put the new one in the **second**
slot — which on a two-column grid is the **top right**. It was reported as *"the new snag appeared
on the right hand side of the cards, not the left"*, which is exactly what it was.

The pin wasn't wrong to want; it was wrong to take the front of a list whose whole promise is
chronological. Open injuries now get their own strip above the grid (§4.3), which surfaces them
**without lying about order** — and does it better, because a pin only ever reordered the page that
happened to be loaded.

`snagOrdering.test.ts` exists specifically to stop that regression coming back, and it tests the
non-obvious direction: that an open injury in the middle of the array **stays** in the middle.

### 4.2 The three sort modes

| Mode | Ordering | Where it happens |
|---|---|---|
| `newest` (default) | `created_at desc` | Postgres |
| `oldest` | `created_at asc` | Postgres |
| `trending` | net engagement desc | client |

```ts
engagement = (vote_score ?? 0) + (comment_count ?? 0)
```

Votes and comments are weighted **equally and unweighted** — one comment is one point, one net
upvote is one point. It's a deliberately crude signal: "how much has the crew reacted to this",
not a ranking model. Note the consequence of using *net* votes: a downvoted snag scores lower than
an untouched one, so trending surfaces contested items only if the discussion (comments)
outweighs the disagreement.

Two implementation details that are load-bearing:

- **`newest`/`oldest` return the array untouched.** `sortSnags` early-returns unless the mode is
  `trending`. The database order is already correct; re-sorting it client-side is where a stray
  comparator gets a chance to break the rule in §4.1.
- **`trending` copies before sorting** (`[...snags].sort(...)`) and relies on `Array.prototype.sort`
  being **stable**, so snags with equal engagement keep their `created_at` order. Ties break toward
  recency for free.

**Known limitation, by construction:** `trending` re-ranks only the rows currently loaded. The
Postgres query still orders and paginates by `created_at` in every mode, so with more than
`PAGE_SIZE` (50) matching snags, "trending" means "the most engaged of what's been fetched so far",
and scrolling can insert a high-engagement card above cards you've already looked at. Fixing it
properly means ordering by engagement server-side; the current behaviour is fine at the list sizes
the app sees and is called out here so nobody discovers it as a bug.

### 4.3 The "Needs attention" strip

Above the grid, when it's non-empty and select mode is off.

**What qualifies:** `severity === 'injury' && status !== 'resolved'`. That's `needsAttention()`, and
it's applied to a **separate query** — not filtered out of the loaded page:

```
snags_with_details
  where parent_snag_id is null
    and org_id = <active org>
    and severity = 'injury'
    and status <> 'resolved'
  order by created_at desc
  limit 6
```

Four decisions are embedded there:

1. **Its own fetch.** The strip must show open injuries that pagination hasn't reached — the entire
   defect in the old pinned-card approach was that it could only ever surface what was already
   loaded.
2. **Independent of the filter bar.** Status, site, scope and Assigned do not apply. *This is an
   alert, not a view of what the user asked for.* An open injury does not stop mattering because
   you filtered to your own snags. (It does respect the active org — an alert about another
   organisation's injury isn't yours.)
3. **`limit 6`.** If there are more than a handful of open injuries, a strip is not the problem.
4. **Horizontal scroll, 200px cards.** It costs exactly one row of height whatever the count, so the
   grid below it stays the answer to "what's newest". The 200px width is chosen so a second card is
   always partly visible — the strip has to read as scrollable, or it reads as one pinned snag,
   which is the thing being fixed.

The header uses `Colors.serious` and the **filled** `alert-circle` — a documented exception to the
outline-icons default, reserved for the serious lane's own identity.

### 4.4 Pagination

`PAGE_SIZE = 50`, offset-based via `.range(from, to)`, appended on `onEndReached` at a 0.5 threshold.

- `hasMore` is inferred from `data.length === PAGE_SIZE`, so the last page costs one extra empty
  fetch. Cheaper than a `count` on every page.
- **Appends are deduped by id.** Offset paging over a table that's being written to can return a row
  twice if something is inserted while you scroll; a duplicate key in a `FlatList` is a visible
  crash-adjacent glitch. Pull-to-refresh resets the whole list.
- `queryCtxRef` snapshots the resolved org context (org id, user id, work-group ids, mentioned ids,
  RCA ids) from the last full fetch so `loadMore` can rebuild an **identical** query without
  re-resolving the org. Re-resolving mid-scroll would let an org switch land halfway through a list.

---

## 5. Filters

Seven controls in one horizontally-scrolling bar. Three open a bottom sheet (chevron shown); three
are one-tap toggles; one is conditional. They are independent axes — none replaces another.

| Control | Type | Default | Visible to |
|---|---|---|---|
| **Scope** ("Show") | dropdown, single-select | `Relevant to me` | org members |
| **Status** | dropdown, multi-select | flagged + in progress + RCA pending | everyone |
| **Date** | dropdown, single-select | Most recent | everyone |
| **Site** | dropdown, multi-select | none (= all) | org members |
| **Assigned** | toggle | off | org members, hidden on unassigned scopes |
| **Trending** | toggle | off | everyone |
| **Public** | toggle | off | public orgs that actually have a public submission |

A button renders in its active style only when it differs from its default — so the bar shows at a
glance which axes have been touched, and the default state has no false "filtered" signal.

### 5.1 Scope — "why would this snag be mine?"

```
Relevant to me            ← default
Assigned to me
All in my sites
Raised by me
Mentioned
Unassigned in my sites          ← supervisor / officer_admin only
Unassigned in my work groups    ← supervisor / officer_admin only
```

**`relevant`** is the union of the four relevance reasons: you own it, you raised it, you're
@mentioned on it, or you have an active RCA on it. It replaced "Assigned to me" as the default,
which missed snags you reported or were tagged on — i.e. the default view of a worker's own app
omitted the snags they had personally filed.

It's built as a single `.or()` because PostgREST's `.or()` ANDs distinct clauses rather than merging
same-column ones, so the two id-driven reasons (mentions, RCAs) are pre-unioned into one
`id.in.(...)`:

```ts
owner_id.eq.<me>, reporter_id.eq.<me>, id.in.(<mentioned ∪ rca>)
```

**`all_in_my_sites` needs no clause at all.** RLS already restricts every role to the sites it can
see (`can_view_site`), so the unfiltered query *is* "everything in my sites". Adding a site list
here would duplicate the policy and drift from it.

**`mentioned`** is available to every role, because being @mentioned isn't role-specific — and RLS
grants visibility into any snag or comment thread you're mentioned on regardless of your normal
site/org access (the `comment_mentions` carve-outs on the SELECT policies). This scope can surface
snags you otherwise couldn't see at all. `getMyMentionedSnagIds` is nonetheless org-scoped, so it
doesn't fight the `org_id` filter.

**Empty-array guard.** `.in()` with `[]` is unreliable across PostgREST versions, so both id-driven
scopes substitute an impossible UUID (`00000000-…-000000000000`) when the list is empty. "I own zero
work groups" then cleanly yields zero rows instead of erroring or matching everything.

**The scope block is gated on `memberOfOrg`** as a whole, so a non-member or public reporter never
has it applied just because `scopeFilter` still holds its default value — the button is hidden for
them, and a hidden control silently filtering is worse than no control.

### 5.2 Status — and why Resolved is off by default

`DEFAULT_STATUS_FILTERS = { flagged, in_progress, rca_pending }`. Resolved snags are noise once
you're triaging what's still open, so they're hidden until someone explicitly checks the box.

Because the default isn't "everything", "is this filtered?" can't be a size check — hence
`setsEqual()`, used both for the button's active styling and for `hasActiveFilters`. Multi-select
with an explicit **Submit** button rather than closing on each tap: you're usually toggling more
than one.

### 5.3 Site

Multi-select. The **options** are role-scoped: admins and supervisors get every org site;
a worker gets only the sites they're assigned to (`getMySiteIds`). Capped at 320px of scroll height
inside the sheet.

### 5.4 Assigned — and its one interaction rule

"Has *somebody* on it, whoever that is" (`owner_id is not null`). Deliberately **distinct** from
Scope's "Assigned to me": this is the supervisor's view of what is actually being worked, which is
why it's a one-tap category rather than an eighth entry in a dropdown nobody opens.

`owner_id` is the assignee on both lanes — on the serious lane, triage sets it to the lead
investigator.

The two "Unassigned…" scopes ask for the exact opposite, so together they can only ever return
nothing. Rather than showing an unexplained empty list, the page does both of:

- **hides** the Assigned button while an unassigned scope is active, and
- **clears** `assignedOnly` via an effect when you switch to one.

### 5.5 Persistence

Status, Scope and Assigned are persisted to `AsyncStorage`, **keyed by user id**
(`snag.statusFilters.<uid>`, `snag.scopeFilter.<uid>`, `snag.assignedOnly.<uid>`), so a shared
device doesn't hand one person's triage view to the next.

Two guards make this safe:

- The save effects no-op until `userIdRef` is populated by the load effect — otherwise the initial
  render would write the *defaults* over the saved preference before it had been read.
- A restored scope value is validated against the known option list before being applied, and a
  malformed status blob is swallowed in favour of the default. Storage is user-writable state from
  the app's point of view; it doesn't get to crash the list.

Date/Trending/Public are **not** persisted — they're momentary ways of looking at the list, not
standing preferences.

### 5.6 Refetch triggers

`buildSnagQuery` is a `useCallback` over every filter, `fetchIssues` depends on it, and an effect
depends on `fetchIssues` — so changing any filter refetches from page zero. Plus:

- **`useFocusEffect`** refetches on every tab focus, because the active org may have changed via the
  org switcher or a QR scan since this tab last rendered.
- Pull-to-refresh.
- After a merge or a bulk action.

Every full fetch also calls `refreshOpenIssueCount()` to keep the Snags tab badge in sync — cheap
enough to do on every load, so status changes made in this session show up immediately.

### 5.7 Empty states

Two messages, chosen by `hasActiveFilters`:

- **filtered** → "Nothing matches those filters" / "Try widening your filters, or report something
  new." No action button — the fix is in the bar directly above.
- **unfiltered** → "All quiet here" / "Nothing reported yet — spot something? Let us know." With a
  **Report a Snag** button, because an empty unfiltered list is a new user, and the next thing they
  should do is file something.

---

## 6. Select mode, merge, and bulk actions

**Entry:** long-press any card. Gated on `canMerge` (supervisor or officer_admin) — a worker's long
press does nothing. While active, the filter bar is replaced by a select bar (Cancel · *N* selected ·
Bulk Actions · Merge Snags), and taps toggle selection instead of navigating.

**The suppressed press.** `TouchableOpacity` fires `onPress` on release *even after* `onLongPress`
has fired for the same gesture. Without `suppressNextPress`, long-pressing to enter select mode
would immediately toggle the selection you just made straight back off. The ref swallows exactly one
press.

**`selectedIds` is ordered, not a set.** The first entry is the **anchor**: the card whose
description pre-fills the merge form.

**Merge** requires ≥2 selected. The modal asks only what it has to:

- Description — always editable, pre-filled from the anchor.
- Kind — only when the selection has more than one.
- Severity — only when kind resolves to `hazard`/`incident` **and** severities differ. A niggle's
  severity isn't load-bearing, so ambiguity there isn't worth a question.
- Site — only when they differ.

The modal states the consequence up front: changing the parent's status changes every child's, and
until then each child keeps its own.

**Bulk actions** (≥1 selected) apply status, an owner, or a work group across the selection. Each
item goes through **the same RPC and the same gates** as the single-snag equivalent — nothing is
pre-validated client-side, because the server is the source of truth for site scoping, investigation
gates and lane rules. Results are summarised afterwards ("Updated 7, 2 failed"), with per-snag
failures collected by reference.

The lane split is enforced here: serious-lane snags can move to any status via `updateSnagStatus`
(which runs the full resolve gate); **niggles can only be marked Resolved, and need a note.**

---

## 7. Performance

The grid renders two columns of photographs, so most of the work is image-shaped.

- **Signed URLs are batched.** `getSnagPhotoUrls` takes the whole page's `photo_path`s, de-dupes
  them, and issues **one** `createSignedUrls` call (1-hour expiry). Cards receive a resolved
  `photoUrl` prop; a card never fetches its own. 50 cards resolving individually would be 50 storage
  round-trips per page. The bucket is private and org-folder-scoped by RLS, so signed URLs are
  mandatory — there is no public URL shortcut.
- **Thumbnails, not originals.** `thumbnailUrl()` appends `width=400&quality=70` to the signed URL,
  using Supabase Storage's transform params, so a list of phone photos doesn't pull full-resolution
  originals over cellular. It's wrapped in try/catch around `new URL()` and falls back to the raw
  URL — a malformed URL shouldn't blank the photo.
- **`React.memo(IssueCard)`** — with `photoUrls` held in a single state object, an unmemoised card
  would re-render every visible card on each page's URL batch landing.
- **FlatList tuning:** `removeClippedSubviews`, `windowSize={5}`, `initialNumToRender={8}`,
  `maxToRenderPerBatch={5}`, `updateCellsBatchingPeriod={50}`. Tuned for image cells, which are
  expensive to mount.
- **Concurrent setup.** Site options, the public-submissions probe, work-group ids, mentioned ids and
  RCA ids are independent of each other and of the page query, so they run in one `Promise.all`
  before the page query — which needs their results — is issued.

---

## 8. Design choices

Everything below is a token from `theme.ts`. Nothing on this page hardcodes a colour, spacing or
shadow value.

**Two columns.** The card leads with a photograph, and photos are what make a snag recognisable at a
glance. Two columns fit roughly twice as many recognisable things on a phone screen; the cost is
paid in the compact variant's omissions (§2).

**Shadow, not border.** Cards are standalone surfaces, so they use `Shadow.sm` and drop their
border, per the design system. The alert border (§3.5) is the documented exception, and it *adds* to
the shadow rather than replacing it.

**Scrim overlays, not gaps.** Everything on the photo (status, site, merge, relevance) sits on
`rgba(17, 24, 39, 0.75)` or a tinted pill rather than in reserved chrome. A snag photo is usually a
dark, busy close-up of a broken thing, so text needs its own background regardless.

**Contrast is a hard constraint, not a preference.** `textSecondary` (`#4B5563`) and `textMuted`
(`#6B7280`) are deliberately darker than the Tailwind greys they resemble: at 4.5:1 against
`#F9FAFB` there is no room for a lighter muted tier. The previous `#9CA3AF` measured **2.43:1**.
`apps/web` mirrors these exactly and `apps/web/e2e/a11y.spec.ts` fails if either regresses.

**Icons, never emoji.** `@expo/vector-icons` (Ionicons) through the shared `Icon` component,
`-outline` variants by default, sizes from the `IconSize` scale. Filled variants are reserved — on
this page, the attention strip's `alert-circle` and the selection `checkmark-circle`.

**Filter bar buttons are 34px tall**, below the 48px `MIN_TOUCH_TARGET`. That is a conscious
trade — seven controls have to fit one scrollable row, and the row's own padding gives the
effective target most of the height back. It's the one place on the page that bends the rule.

**Colour is never the only signal.** Status, kind and severity each pair colour with a text label;
the vote score pairs colour with a directional caret. The alert border is the exception, which is
part of why it's restricted to three cases with a badge equivalent available in the full variant.

---

## 9. Invariants — don't break these

1. **The first card is the most recent one** (in `newest`). Nothing gets pinned to the front of the
   grid. If something needs surfacing, give it a strip. `snagOrdering.test.ts` guards this.
2. **`sortSnags` must not mutate its input**, and must leave `newest`/`oldest` arrays untouched.
   Tested.
3. **The attention strip stays independent of the filter bar.** It's an alert.
4. **Keep the explicit `org_id` filter.** RLS alone lets cross-org self-reported snags through.
5. **Keep `parent_snag_id is null`.** Without it, merged children reappear alongside their parent.
6. **Badge text uses `*Fg` tokens, never base hues.** Both clients' a11y suites depend on it.
7. **Labels come from `packages/shared-types`.** Never re-spell a status or kind in a component.
8. **Never `.in()` with an empty array** — use the impossible-UUID guard.
9. **Preference writes stay behind `userIdRef`**, or the defaults overwrite the saved values on
   mount.
10. **Bulk actions call the same RPCs as single-snag actions.** Don't add a client-side shortcut that
    skips a server gate.

---

## 10. The web counterpart

`apps/web/src/app/(portal)/snags/page.tsx` — a server component behind the `(portal)` group's
supervisor/officer_admin gate. Same view, same `parent_snag_id is null`, same org scoping, same
`owner_name`-or-nothing rule. It is **not** a card grid and doesn't try to be:

| | mobile | web |
|---|---|---|
| Layout | 2-column card grid | single-column rows |
| Photo | yes, leading | none |
| Pagination | 50/page, infinite scroll | `limit(100)`, no paging |
| Sort | newest / oldest / trending | `created_at desc`, fixed |
| Filter state | component state + AsyncStorage | URL query params (`?status=&site=&assigned=`) |
| Status filter | multi-select, resolved hidden by default | single-select chips incl. "All" |
| Scope | 7 options | none |
| Attention strip | yes | no |
| Relevance tags | yes | no |
| Severity | alert border (grid) | `SeverityBadge` on every row |
| Select/merge | long-press → modal | checkboxes → `mergeSelectedAction` |
| Audience | all roles | supervisors and admins only |

Most of the gaps follow from the audience. The portal refuses workers at the route level, so the
relevance tags and the personal scopes — which exist to answer "why is this mine?" for a worker —
have nobody to answer for. Severity gets a badge because a row has horizontal room the compact card
doesn't.

The web filter chips share one `filterHref()` builder rather than each concatenating its own query
string, which is how `?site=` (arriving from the dashboard) came to be silently dropped by whichever
chip forgot it.

Where the two clients **must** agree — enum values, labels, badge colour logic — they agree by
sharing `packages/shared-types` and by `apps/web/src/components/Badge.tsx` mirroring the mobile
badge split component-for-component.
