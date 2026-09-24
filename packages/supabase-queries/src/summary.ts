/**
 * What a project page says at the top, worked out from the one page read.
 *
 * The page answers four questions in this order — are we on budget, what is
 * left to decide, what do we have to pay, and where is the money going — and
 * every figure here is arithmetic over rows the reader can open. Nothing is
 * estimated that is not labelled as undecided.
 *
 *     expected = agreed + undecided
 *
 * **Agreed** is Committed with the builder's open set-aside amounts taken out:
 * an allowance nobody has chosen against is not something the household has
 * agreed to spend, whatever the contract's total says.
 *
 * **Undecided** is everything still to be chosen, priced the one honest way
 * each can be:
 *
 *   - a set-aside amount nobody has chosen against: the amount itself;
 *   - one that has been partly chosen against while other things on it are
 *     still open: what is left of it;
 *   - a thing with options and no set-aside: its **dearest** option, so the
 *     total never surprises anybody upwards;
 *   - a cost somebody warned about that nobody has priced: its rough figure;
 *   - an extra the builder said to budget on top: its figure.
 *
 * **Where it is going** is one row per room plus *Whole job*, and the rows add
 * up to the total because *Whole job* is whatever the rooms do not hold. A bill
 * on the whole job that somebody has **shared between rooms** moves its share
 * of Agreed onto those rooms (`roomShares`) — out of *Whole job*, never out of
 * the total. So a wrong split can put money in the wrong room, and cannot make
 * the page's figure disagree with itself.
 *
 * Pure, so `projectSummary.test.ts` can pin it without a network.
 */
import type {
  ProjectBill,
  ProjectItem,
  ProjectQuote,
  ProjectQuoteLine,
} from '@snag/shared-types';
import type { ProjectPage } from './index';

export interface DecisionRow {
  item: ProjectItem;
  room: string | null;
  /** Quotes and prices still in the running, cheapest first. */
  options: ProjectQuote[];
  low: number | null;
  high: number | null;
  setAside: ProjectQuoteLine | null;
}

export interface RoomRow {
  /** The element id, or `'job'` for money that belongs to the whole job. */
  key: string;
  name: string;
  elementId: string | null;
  agreed: number;
  undecided: number;
  total: number;
  toDecide: number;
  supplierCount: number;
  /** Agreed money this room holds from bills on the whole job shared with it. */
  shared: number;
  /** Bills and quotes on the whole job that say they are for this room, split or not. */
  sharedCount: number;
  /** Set-aside amounts chosen against in this room, when every thing on them is decided. */
  setAside: number | null;
  chosen: number | null;
  settled: boolean;
  /** Quotes for this room (or the whole job) nobody has agreed or turned down yet. */
  openQuotes: number;
}

export interface ProjectSummary {
  agreed: number;
  undecided: number;
  expected: number;
  budget: number | null;
  left: number | null;
  paid: number;
  toPay: number;
  toDecide: DecisionRow[];
  bills: ProjectBill[];
  rooms: RoomRow[];
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const round = (n: number): number => Math.round(n * 100) / 100;

function gross(amount: number | null, incl: boolean): number {
  if (amount === null) return 0;
  return incl ? amount : round(amount * 1.15);
}

/**
 * Quotes for the whole job or a room that are still waiting on a decision.
 *
 * A quote for a thing is an option on it and is counted through the thing.
 * A quote for the job or a room had nowhere to count: not in Agreed, because
 * nobody agreed it, and not in Undecided, which only held things and
 * set-asides — so a planned job whose one price was a tree surgeon's quote
 * read $0 and had no row to find it under. Now, where **nothing at that level
 * is agreed or billed yet**, its open quotes are the decision still to make and
 * count in Undecided at the dearest, the rule things already follow so the
 * total never surprises upwards. Once anything there is agreed or billed, an
 * open quote could be a variation or an alternative and the app cannot tell
 * which, so it is listed and not counted.
 *
 * Keyed by element id, or `'job'`.
 */
export function openScopeQuotes(page: Pick<ProjectPage, 'quotes'>): Map<string, { count: number; dearest: number }> {
  const scopeOf = (q: ProjectQuote): string | null =>
    q.itemId ? null : q.elementId ?? (q.projectId ? 'job' : null);
  const settled = new Set<string>();
  const open = new Map<string, { count: number; dearest: number }>();
  for (const q of page.quotes) {
    const scope = scopeOf(q);
    if (scope === null || q.status === 'declined') continue;
    if ((q.kind === 'quote' && q.status === 'accepted') || q.kind === 'invoice') settled.add(scope);
  }
  for (const q of page.quotes) {
    const scope = scopeOf(q);
    if (scope === null || settled.has(scope) || q.kind !== 'quote' || q.status !== 'tbc') continue;
    const prev = open.get(scope) ?? { count: 0, dearest: 0 };
    open.set(scope, { count: prev.count + 1, dearest: Math.max(prev.dearest, q.amountIncl ?? 0) });
  }
  return open;
}

/** Whether a thing still needs choosing: not excluded, and nothing agreed or billed. */
export function isUndecided(item: ProjectItem): boolean {
  return !item.excluded && item.committed === null;
}

/** The options still in the running on one thing. */
export function optionsFor(page: Pick<ProjectPage, 'quotes'>, itemId: string): ProjectQuote[] {
  return page.quotes
    .filter((q) => q.itemId === itemId && q.kind === 'quote' && q.status !== 'declined')
    .sort((a, b) => (a.amountIncl ?? 0) - (b.amountIncl ?? 0));
}

/** What has been chosen against a set-aside amount so far. */
export function chosenAgainst(page: Pick<ProjectPage, 'quotes'>, lineId: string): number {
  return sum(
    page.quotes
      .filter((q) => q.supersedesLineId === lineId && q.kind === 'quote' && q.status === 'accepted')
      .map((q) => q.amountIncl ?? 0),
  );
}

/** Set-aside amounts on signed quotes — the only ones inside Agreed to begin with. */
export function liveSetAsides(page: Pick<ProjectPage, 'quotes' | 'lines'>): ProjectQuoteLine[] {
  const signed = new Set(
    page.quotes.filter((q) => q.kind === 'quote' && q.status === 'accepted').map((q) => q.id),
  );
  return page.lines.filter((l) => l.isAllowance && !l.additional && signed.has(l.quoteId));
}

const supplierKey = (name: string | null): string | null => {
  const key = name?.trim().toLowerCase();
  return key ? key : null;
};

/**
 * What one price on the whole job puts in Agreed, which is the only part of
 * it a room share can move.
 *
 * The same rules the views apply, read off the row: a signed quote counts what
 * it contributes less its open set-asides; a bill counts unless it is a claim
 * (its contract counts instead) or the same supplier has a signed price on the
 * whole job (it is a draw on that). Anything declined, unsigned, or standing
 * in for a set-aside counts nothing here. Getting one of these wrong can only
 * leave money on *Whole job* — the room rows are a remainder, not a second sum.
 */
export function agreedContribution(page: Pick<ProjectPage, 'quotes'>, q: ProjectQuote): number {
  if (q.status === 'declined' || q.supersedesLineId || q.againstQuoteId) return 0;
  // A bill inside another bill counts through that one — the views drop it too.
  if (q.kind === 'invoice' && q.billedThroughId) return 0;
  if (q.kind === 'quote') {
    return q.status === 'accepted'
      ? round((q.effectiveAmount ?? q.amountIncl ?? 0) - q.allowanceOpen)
      : 0;
  }
  const key = supplierKey(q.supplier);
  const signed = key !== null && page.quotes.some((o) =>
    o.id !== q.id && o.kind === 'quote' && o.status === 'accepted'
      && o.projectId !== null && o.projectId === q.projectId && supplierKey(o.supplier) === key);
  return signed ? 0 : q.amountIncl ?? 0;
}

/**
 * How much of Agreed each room holds from shared bills, by element id.
 *
 * Each share is the room's fraction of the bill as typed, applied to what the
 * bill contributes. Shares that somehow add up to more than the bill are scaled
 * back to it; shares that cover all of it are rounded so they add up to the
 * cent, or *Whole job* would carry a one-cent row for ever.
 */
export function roomShares(page: Pick<ProjectPage, 'quotes' | 'quoteRooms' | 'elements'>): Map<string, number> {
  const shares = new Map<string, number>();
  const known = new Set(page.elements.map((e) => e.id));
  for (const q of page.quotes) {
    if (q.projectId === null || q.againstQuoteId || !q.amount) continue;
    const rows = (page.quoteRooms ?? [])
      .filter((r) => r.quoteId === q.id && r.amount !== null && known.has(r.elementId));
    if (rows.length === 0) continue;
    const contribution = agreedContribution(page, q);
    if (contribution === 0) continue;

    let fractions = rows.map((r) => (r.amount as number) / (q.amount as number));
    const whole = sum(fractions);
    if (whole > 1) fractions = fractions.map((f) => f / whole);
    const covered = Math.abs(sum(fractions) - 1) < 1e-9;

    const amounts = fractions.map((f) => round(contribution * f));
    if (covered) amounts[amounts.length - 1] = round(contribution - sum(amounts.slice(0, -1)));
    rows.forEach((r, i) => shares.set(r.elementId, round((shares.get(r.elementId) ?? 0) + amounts[i])));
  }
  return shares;
}

export function projectSummary(page: ProjectPage): ProjectSummary {
  const { project, elements, items } = page;
  const elementOf = new Map(elements.map((e) => [e.id, e]));
  const roomName = (elementId: string): string | null => {
    const e = elementOf.get(elementId);
    return e ? e.room ?? e.name : null;
  };
  const setAsides = liveSetAsides(page);
  const lineById = new Map(setAsides.map((l) => [l.id, l]));

  // ---------------------------------------------------------------- decide
  const toDecide: DecisionRow[] = items.filter(isUndecided).map((item) => {
    const options = optionsFor(page, item.id);
    const amounts = options.map((o) => o.amountIncl).filter((a): a is number => a !== null);
    return {
      item,
      room: roomName(item.elementId),
      options,
      low: amounts.length ? Math.min(...amounts) : null,
      high: amounts.length ? Math.max(...amounts) : null,
      setAside: item.setAsideLineId ? lineById.get(item.setAsideLineId) ?? null : null,
    };
  });

  // ------------------------------------------------------------- undecided
  // Each set-aside amount, and which element its things live in. The first
  // linked thing decides the room — a set-aside is about one place.
  const lineElement = new Map<string, string>();
  for (const item of items) {
    if (item.setAsideLineId && !lineElement.has(item.setAsideLineId)) {
      lineElement.set(item.setAsideLineId, item.elementId);
    }
  }

  /** What each set-aside still contributes to Undecided. */
  const lineUndecided = new Map<string, number>();
  for (const line of setAsides) {
    const amount = gross(line.amount, line.amountInclGst);
    const chosen = chosenAgainst(page, line.id);
    const linked = items.filter((i) => i.setAsideLineId === line.id && !i.excluded);
    const open = linked.some(isUndecided);
    if (chosen === 0) lineUndecided.set(line.id, amount); // still inside allowanceOpen
    else if (open) lineUndecided.set(line.id, Math.max(amount - chosen, 0));
    else lineUndecided.set(line.id, 0);
  }

  const itemUndecided = (d: DecisionRow): number =>
    d.setAside ? 0 : d.high ?? 0;

  const scopeQuotes = openScopeQuotes(page);

  const undecided = round(
    sum([...scopeQuotes.values()].map((o) => o.dearest))
      + sum([...lineUndecided.values()])
      // An allowance on a signed quote but not marked as a set-aside line above
      // (an additional one, or on a quote we could not see) still counts.
      + Math.max(project.allowanceOpen - sum(setAsides
          .filter((l) => chosenAgainst(page, l.id) === 0)
          .map((l) => gross(l.amount, l.amountInclGst))), 0)
      + project.additionalOpen
      + project.expectedOpen
      + sum(toDecide.map(itemUndecided)),
  );

  const agreed = round((project.committedTotal ?? 0) - project.allowanceOpen);
  const expected = round(agreed + undecided);
  const budget = project.budget === null ? null : gross(project.budget, project.budgetInclGst);

  // ----------------------------------------------------------------- rooms
  const quoteElement = (q: ProjectQuote): string | null => {
    if (q.elementId) return q.elementId;
    if (q.itemId) return items.find((i) => i.id === q.itemId)?.elementId ?? null;
    return null;
  };

  const shares = roomShares(page);
  const sharedWith = (elementId: string): ProjectQuote[] => {
    const ids = new Set((page.quoteRooms ?? []).filter((r) => r.elementId === elementId).map((r) => r.quoteId));
    return page.quotes.filter((q) => ids.has(q.id) && q.status !== 'declined');
  };

  const rooms: RoomRow[] = elements.map((e) => {
    const inRoom = toDecide.filter((d) => d.item.elementId === e.id);
    const lines = setAsides.filter((l) => lineElement.get(l.id) === e.id);
    const lineAmount = sum(lines.map((l) => gross(l.amount, l.amountInclGst)));
    const lineChosen = sum(lines.map((l) => chosenAgainst(page, l.id)));
    const settled = lines.length > 0 && lines.every((l) => lineUndecided.get(l.id) === 0 && chosenAgainst(page, l.id) > 0);
    const shared = shares.get(e.id) ?? 0;
    const tagged = sharedWith(e.id);
    const roomAgreed = round((e.committedTotal ?? 0) - e.allowanceOpen + shared);
    const roomUndecided = round(
      (scopeQuotes.get(e.id)?.dearest ?? 0)
        + sum(inRoom.map(itemUndecided))
        + sum(lines.map((l) => lineUndecided.get(l.id) ?? 0))
        + e.expectedOpen,
    );
    const suppliers = new Set(
      [...page.quotes.filter((q) => quoteElement(q) === e.id && q.status !== 'declined'), ...tagged]
        .filter((q) => q.supplier)
        .map((q) => q.supplier!.trim().toLowerCase()),
    );
    return {
      key: e.id,
      name: e.room ?? e.name,
      elementId: e.id,
      agreed: roomAgreed,
      undecided: roomUndecided,
      total: round(roomAgreed + roomUndecided),
      toDecide: inRoom.length,
      supplierCount: suppliers.size,
      shared,
      sharedCount: tagged.length,
      setAside: lines.length ? lineAmount : null,
      chosen: lines.length ? lineChosen : null,
      settled,
      openQuotes: scopeQuotes.get(e.id)?.count ?? 0,
    };
  });

  const jobAgreed = round(agreed - sum(rooms.map((r) => r.agreed)));
  const jobUndecided = round(undecided - sum(rooms.map((r) => r.undecided)));
  const jobQuotes = scopeQuotes.get('job')?.count ?? 0;
  if (Math.abs(jobAgreed) >= 0.01 || Math.abs(jobUndecided) >= 0.01 || jobQuotes > 0) {
    const suppliers = new Set(
      page.quotes
        .filter((q) => quoteElement(q) === null && q.status !== 'declined' && q.supplier)
        .map((q) => q.supplier!.trim().toLowerCase()),
    );
    rooms.unshift({
      key: 'job',
      name: 'Whole job',
      elementId: null,
      agreed: jobAgreed,
      undecided: jobUndecided,
      total: round(jobAgreed + jobUndecided),
      toDecide: 0,
      supplierCount: suppliers.size,
      shared: 0,
      sharedCount: 0,
      setAside: null,
      chosen: null,
      settled: false,
      openQuotes: jobQuotes,
    });
  }

  // ----------------------------------------------------------------- bills
  const bills = page.bills
    .filter((b) => (b.unpaid ?? 0) > 0)
    .sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999'));

  return {
    agreed,
    undecided,
    expected,
    budget,
    left: budget === null ? null : round(budget - expected),
    paid: project.paidTotal ?? 0,
    toPay: project.dueToPay,
    toDecide,
    bills,
    rooms: rooms.filter((r) => r.total !== 0 || r.toDecide > 0 || r.openQuotes > 0 || r.key !== 'job'),
  };
}

/**
 * The line under a room's name. Only facts the reader can add up: a set-aside
 * compared with what was chosen against it, what is left to decide, or who is
 * involved.
 */
export function describeRoom(room: RoomRow, money: (n: number) => string): string {
  if (room.setAside !== null && room.chosen !== null && room.settled) {
    const diff = round(room.chosen - room.setAside);
    if (diff > 0) return `${money(diff)} over the ${money(room.setAside)} set aside`;
    if (diff < 0) return `${money(-diff)} under the ${money(room.setAside)} set aside`;
    return `Matches the ${money(room.setAside)} set aside`;
  }
  const parts: string[] = [];
  if (room.setAside !== null) parts.push(`${money(room.setAside)} set aside`);
  if (room.toDecide > 0) parts.push(`${room.toDecide} to decide`);
  if (room.openQuotes > 0) {
    parts.push(room.openQuotes === 1 ? '1 quote not agreed' : `${room.openQuotes} quotes not agreed`);
  }
  if (room.shared > 0) parts.push(`${money(room.shared)} of shared bills`);
  else if (room.sharedCount > 0) {
    parts.push(room.sharedCount === 1 ? 'On 1 shared bill' : `On ${room.sharedCount} shared bills`);
  }
  if (parts.length === 0 && room.supplierCount > 0) {
    parts.push(room.supplierCount === 1 ? '1 supplier' : `${room.supplierCount} suppliers`);
  }
  return parts.join(' · ');
}

/** One supplier's rows, under the one name the list shows for them. */
export interface SupplierGroup<T> {
  /** The trimmed, lower-cased name — or `row:<id>` for a row naming nobody. */
  key: string;
  /** The spelling on the most recently dated row. Null when nobody was named. */
  supplier: string | null;
  rows: T[];
}

/**
 * Rows from one supplier gathered under one heading.
 *
 * An engineer billing monthly is four rows reading *MSC Consulting Group Ltd*
 * one after another, and what somebody wants off that is the supplier once and
 * their bills underneath. Grouped on the trimmed, lower-cased name — the same
 * rule `project_supplier_totals` groups on, so "MSC" and "msc " are one
 * supplier here exactly as they are one in the rollup — and shown in the
 * spelling used most recently.
 *
 * **A row naming nobody is never grouped.** Two bills with no supplier are not
 * known to be from the same place, and putting them under one heading would say
 * they were.
 *
 * Groups keep the order of their first row, so a list already sorted by due
 * date stays sorted by the soonest thing each supplier is owed; rows inside a
 * group keep the order they came in.
 */
export function groupBySupplier<T extends { id: string; supplier: string | null; dated: string | null }>(
  rows: T[],
): SupplierGroup<T>[] {
  const groups = new Map<string, SupplierGroup<T>>();
  const latest = new Map<string, string>();
  for (const row of rows) {
    const name = row.supplier?.trim() ?? '';
    const key = name ? name.toLowerCase() : `row:${row.id}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { key, supplier: name || null, rows: [row] });
      if (row.dated) latest.set(key, row.dated);
      continue;
    }
    group.rows.push(row);
    const seen = latest.get(key);
    if (row.dated && (!seen || row.dated >= seen)) {
      latest.set(key, row.dated);
      group.supplier = name;
    } else if (!row.dated && !seen) {
      group.supplier = name;
    }
  }
  return [...groups.values()];
}
