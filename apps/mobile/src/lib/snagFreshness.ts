/**
 * "New since your last visit" — the badge on the freshest cards in the grid.
 *
 * A badge, not a reorder. The first card is still the most recent one (see
 * snagOrdering.ts for why that needed writing down); this only marks which of
 * them arrived while the reader was away.
 *
 * Two rules are doing real work here, and both are about not crying wolf:
 *
 * - **A first visit marks nothing.** With no stored timestamp every snag in
 *   the org is newer than "never", so the whole grid would come up shouting on
 *   the one screen where the reader has no idea what any of it means yet.
 * - **Your own reports are never new to you.** You were there when it was
 *   created — and since the default scope is "Relevant to me", which includes
 *   everything you raised, the reporter would otherwise see their own snag as
 *   the loudest thing on their own list every time they filed one.
 *
 * The timestamp itself is written on blur rather than on focus: writing it on
 * arrival would mark everything read before the reader had looked at any of
 * it. See IssueListScreen's LAST_SEEN_STORAGE_PREFIX effects.
 */

export interface FreshnessInput {
  created_at?: string | null;
  reporter_id?: string | null;
}

export function isNewSince(
  snag: FreshnessInput,
  lastSeenAt: string | null,
  currentUserId: string | null
): boolean {
  if (!lastSeenAt || !snag.created_at) return false;
  if (currentUserId && snag.reporter_id === currentUserId) return false;

  const created = new Date(snag.created_at).getTime();
  const seen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(created) || Number.isNaN(seen)) return false;

  return created > seen;
}
