/**
 * Two things the filter bar needs to say about itself, kept out of the screen
 * so they can be tested without a renderer.
 *
 * Both exist because the bar scrolls. Seven controls do not fit one row on a
 * phone, so Assigned, Trending and Public sit off the right-hand edge — which
 * means the bar's own rule, "a button renders in its active style only when it
 * differs from its default", can be true of a button nobody can see.
 */

export interface FilterButtonLayout {
  x: number;
  width: number;
}

export interface FilterActiveState {
  key: string;
  active: boolean;
}

/**
 * How many *active* filter buttons are scrolled off the right-hand edge.
 *
 * This is the number the count chip shows, and the reason it earns its place:
 * an aggregate count next to buttons you can already see is redundant, since
 * each of those buttons is already rendering its own active style. It only
 * tells you something when the button doing the filtering isn't on screen.
 *
 * A chip is "off" once more than half of it is past the edge — a sliver of a
 * chip is not something you can read an active style off, and counting only
 * fully-invisible chips would leave that case silent.
 */
export function countActiveOffscreen(
  buttons: FilterActiveState[],
  layouts: Record<string, FilterButtonLayout | undefined>,
  scrollX: number,
  viewportWidth: number
): number {
  // Nothing measured yet — say nothing rather than guess.
  if (viewportWidth <= 0) return 0;

  const edge = scrollX + viewportWidth;
  return buttons.filter((b) => {
    if (!b.active) return false;
    const layout = layouts[b.key];
    if (!layout) return false;
    return layout.x + layout.width / 2 > edge;
  }).length;
}

function joinOr(items: string[]): string {
  return items.length === 1 ? items[0] : `${items[0]} or ${items[1]}`;
}

/**
 * The empty-state title, named after what was actually filtered for: "No
 * Flagged snags at Hendo" rather than "Nothing matches those filters".
 *
 * Returns null when there is nothing worth naming, and the caller keeps the
 * generic copy. That happens more often than it sounds: with only four
 * statuses in existence and three of them on by default, a selection of three
 * or more is close enough to "everything" that listing them tells the reader
 * nothing and costs them a long title. Same for a handful of sites — past two,
 * the count is the useful fact, not the names.
 */
export function describeFilteredEmptyState(statusLabels: string[], siteNames: string[]): string | null {
  const statusPart = statusLabels.length > 0 && statusLabels.length <= 2 ? `${joinOr(statusLabels)} ` : '';
  const sitePart =
    siteNames.length === 0 ? ''
      : siteNames.length <= 2 ? ` at ${joinOr(siteNames)}`
      : ` at ${siteNames.length} sites`;

  if (!statusPart && !sitePart) return null;
  return `No ${statusPart}snags${sitePart}`;
}
