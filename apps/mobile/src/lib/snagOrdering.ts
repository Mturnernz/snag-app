import { Snag } from '../types';

export type SortMode = 'newest' | 'oldest' | 'trending';

/**
 * The order snags appear in the grid.
 *
 * **The first card is the most recent one.** That sounds too obvious to write
 * down, and it was: unresolved injury snags used to be pinned to the front, so
 * filing a snag into an organisation with an open injury put the new one in the
 * *second* slot — top-right of a two-column grid. Reported as "the new snag
 * appeared on the right hand side of the cards, not the left", which is exactly
 * what it was.
 *
 * The pin wasn't wrong to want; it was wrong to take the front of a list whose
 * whole promise is chronological. Open injuries now get their own strip above
 * the grid (see `needsAttention`), which surfaces them without lying about
 * order — and does it better, because a pin only ever reordered the page that
 * happened to be loaded.
 *
 * `trending` re-ranks by engagement, which is the one sort where recency is
 * explicitly not the rule. Otherwise the database order (newest or oldest) is
 * preserved, which `Array.prototype.sort` guarantees by being stable.
 */
export function sortSnags(snags: Snag[], sortMode: SortMode): Snag[] {
  if (sortMode !== 'trending') return snags;
  const engagement = (s: Snag) => (s.vote_score ?? 0) + (s.comment_count ?? 0);
  return [...snags].sort((a, b) => engagement(b) - engagement(a));
}

/**
 * Snags that shouldn't be allowed to scroll away: an injury that nobody has
 * resolved yet. Newest first, same as everything else.
 *
 * Kept separate from the grid rather than mixed into it, so "most recent is
 * first" holds in both places.
 */
export function needsAttention(snags: Snag[]): Snag[] {
  return snags.filter((s) => s.severity === 'injury' && s.status !== 'resolved');
}
