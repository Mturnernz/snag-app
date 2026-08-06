# SNAG — deferred work

Items that came out of the August 2026 review round and were deliberately **not** built,
with the reason and the cheapest moment to pick them up. Live items being built now are
tracked in the branch, not here.

---

## 1. Ask the lane question at the point of reporting

**Deferred by decision, not by doubt — this is the one to revisit first.**

A reporter chooses the lane implicitly: the niggle form offers `fixit` / `improvement` in a
segmented chip, and reaching the serious lane means noticing the quieter
**Report a Serious Incident** button below the primary submit. That quietness is deliberate
(`seriousOutline` — findable, not hittable by accident), but it means a serious event can be
filed as a niggle by someone who did not recognise the button as the way through.

A niggle never engages any of the apparatus the serious lane exists for: no first-response
checklist, no witness statement, no evidence, no notifiable decision, no resolve gate. So a
mis-filed injury is not "in the wrong bucket" — it is outside the compliance process entirely.

**The fix:** one routing question after the description — *"was anyone hurt, or could they
have been?"* — that moves the report into the serious lane when answered yes.

**When to do it:** during the title-field work (deferred item 2). That work opens the niggle
report form anyway, and adding the question in the same pass is close to free. Doing it on its
own is a medium-sized change for the same result.

**Related, and already handled:** `merge_snags` used to write severity through unguarded, so a
merge could produce a niggle carrying `injury`/`critical`. That hole is closed — see the
migration adding the same `case when kind in ('hazard','incident')` guard `recategorise_snag`
has always had. Closing it does **not** cover the case above, which happens at entry.

---

## 2. A title field through the report flow

The card uses the description as its title, truncated to two lines, because snags have no title
field. Where a description is a few characters, a card carries a status, a kind, and nothing
that says what happened.

Large: it touches the report form, `snags`, `snags_with_details`, `packages/shared-types`, and
both clients' cards and detail views. Decide up front whether it is required or optional —
"optional" reproduces the current problem for anyone who skips it.

---

## 3. One management screen — ✅ mostly done

Merged. `Manage` is one route with three tabs (Organisation | Sites | Teams) and a real
`SiteDetail` route under the Sites tab. Site creation is down from three call sites to one, and
the per-site QR now sits with the org switch that makes it work instead of a sentence telling
the reader to go to another screen.

**The members × sites matrix was not built**, and the decision is worth recording rather than
re-taking. A matrix is one surface for *n* sites × *m* people; master–detail is *n* surfaces of
*m* rows. Master–detail won because a site needed to be addressable for its own sake — the admin
dashboard's "Sites with no site lead" can now link to the site, which is the fix that row was
always missing. A matrix would still be the better assignment surface for an org with twenty
sites and one person to place; if that org shows up, it belongs *inside* the Sites tab as a
second view, not as a replacement for the detail screen.

Still open:

- **"All sites" is a cleared selection, not a value.** A work group with no sites applies to
  every site, so "applies everywhere" and "nobody has configured this" look identical. Untouched
  by the merge — `SiteMultiSelect` still clears the selection to mean "all".
- **No site archive or delete.** `update_site` (20260806090000) closed the rename gap. A site
  that closes still has to stay in every picker forever, because nothing can retire it.

---

## 4. Parked until there is production data

These came out of the Docunation organisation, which is a demo: descriptions read `Test`,
`Thus`, `1`. The behaviour they describe is real; whether the *volume* holds in a working
organisation is not established, and each would cost design time on that assumption.

- **The photo-less card.** 21 of 30 snags had no photo, so the grid is mostly camera
  placeholders. Proposed fix: structured content — category, site, reference — instead of a
  placeholder icon.
- **Trending.** 18 of 30 snags scored zero engagement and the highest score was 3. With a stable
  sort, an all-zero population keeps its `created_at` order, so Trending returns the same list as
  Most recent. Proposed fix: hide it until there is engagement, the way the Public button already
  hides itself until the org has a public submission.
- **Unused work groups.** Seven work groups for three members across three sites. Proposed fix:
  surface config with no snags against it and offer to archive.
- **Empty sites in the Site filter.** Two of three sites had no snags, so two of the three filter
  options always returned nothing.

Re-check all four against a real organisation before committing to any of them.

---

## 5. Considered and not recommended

Kept here so they are not re-proposed without the context.

- **Dark mode on `apps/mobile`.** There is no theming layer: `theme.ts` is a flat set of light
  values and there are zero `useColorScheme` usages. This means building runtime theming,
  designing a second palette that holds the contrast line the light one was tuned to, and
  auditing every stylesheet across 28 screens. `apps/web` already has a designed dark theme, so
  the gap is mobile-only and deliberate. It is a project, not a design-system tweak.
- **Giving `minor`/`moderate` severity an alert colour.** They are neutral dots on purpose, so
  severity cannot collide with the status palette — a green "Minor" reads as *resolved*.
  Distinguishing them by *shape* would be compatible with that rule; colour is not.
- **Micro-copy on long-press.** Long-press on a snag card already enters select mode for merge
  and bulk actions. For a supervisor the gesture is taken; for a worker it does nothing, so the
  same gesture would mean two different things depending on role.
- **Restructuring the gate chain in `App.tsx`.** The *order* encodes fixed bugs — the
  inactive-organisation check precedes the org gate because `profile.org_id` is a mirror that
  goes stale, and the QR token resolves before the session check so a scanned code does not
  require signing in first. Document it; do not reorder it.
