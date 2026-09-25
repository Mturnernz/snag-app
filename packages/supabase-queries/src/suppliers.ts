/**
 * Who a job's money and paperwork came from, read off the page already in
 * hand.
 *
 * **Supplier is free text, and these group it the way the money does** — on
 * the trimmed, lower-cased name, the rule `project_supplier_totals` groups on —
 * so the Suppliers list, *To pay* and the Documents groups can never disagree
 * about who is one supplier. A spelling nobody has merged is two suppliers
 * here exactly as it is two in the rollup, and `businessKey` only *suggests*
 * that two might be one: "RELIABUILDER LIMITED" and "ReliaBuilder" look alike,
 * and only the person holding the paper can say they are.
 *
 * Pure, and importing nothing from `index` (which re-exports this file).
 */
import type { ProjectExpectedCost, ProjectFile, ProjectQuote } from '@snag/shared-types';
import { businessKey } from './papers';

const keyOf = (name: string | null | undefined): string | null => {
  const key = name?.trim().toLowerCase();
  return key ? key : null;
};

export interface SupplierEntry {
  /** The trimmed, lower-cased name: what the rollups group on. */
  key: string;
  /** The spelling entered most recently. */
  name: string;
  /** Quotes and bills on the job, declined ones included — a rename reaches them all. */
  prices: number;
  /** Expected costs naming them as the likely supplier. */
  expectedCosts: number;
  /** What has gone out against their bills. */
  paid: number;
  /** Files on their prices, payments and expected costs. */
  files: number;
  /** Other suppliers on the job that look like the same business. */
  sameAs: string[];
  /**
   * The supplier this one would fold into, when it is the smaller of a
   * likely pair. Only one of the pair carries it, so the page offers one
   * Merge rather than two pointing at each other.
   */
  mergeInto: string | null;
}

/**
 * Every supplier the job names, alphabetically.
 *
 * Counts quotes, bills and expected costs rather than the supplier rollup's
 * rows, because the rollup leaves out a declined quote and an unconfirmed
 * expectation, and a rename has to reach both or it has only half happened.
 */
export function supplierDirectory(page: {
  quotes: Pick<ProjectQuote, 'supplier' | 'kind' | 'paidTotal' | 'createdAt'>[];
  expected: Pick<ProjectExpectedCost, 'likelySupplier' | 'createdAt'>[];
  files: Pick<ProjectFile, 'supplier'>[];
}): SupplierEntry[] {
  const entries = new Map<string, SupplierEntry & { seen: string }>();
  const touch = (name: string | null, at: string, add: (e: SupplierEntry) => void) => {
    const key = keyOf(name);
    if (!key) return;
    const trimmed = name!.trim();
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        key, name: trimmed, prices: 0, expectedCosts: 0, paid: 0, files: 0,
        sameAs: [], mergeInto: null, seen: at,
      };
      entries.set(key, entry);
    } else if (at >= entry.seen) {
      entry.name = trimmed;
      entry.seen = at;
    }
    add(entry);
  };

  for (const q of page.quotes) {
    touch(q.supplier, q.createdAt, (e) => {
      e.prices += 1;
      if (q.kind === 'invoice') e.paid += q.paidTotal ?? 0;
    });
  }
  for (const x of page.expected) {
    touch(x.likelySupplier, x.createdAt, (e) => { e.expectedCosts += 1; });
  }
  for (const f of page.files) {
    const entry = entries.get(keyOf(f.supplier) ?? '');
    if (entry) entry.files += 1;
  }

  const list = [...entries.values()]
    .map(({ seen: _seen, ...entry }) => ({ ...entry, paid: Math.round(entry.paid * 100) / 100 }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const weight = (e: SupplierEntry) => e.prices + e.expectedCosts;
  for (const entry of list) {
    const mine = businessKey(entry.name);
    if (!mine) continue;
    const alike = list.filter((o) => o !== entry && businessKey(o.name) === mine);
    entry.sameAs = alike.map((o) => o.key);
    const biggest = alike
      .slice()
      .sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))[0];
    if (!biggest) continue;
    const smaller = weight(entry) < weight(biggest)
      || (weight(entry) === weight(biggest) && entry.name.localeCompare(biggest.name, undefined, { sensitivity: 'base' }) > 0);
    entry.mergeInto = smaller ? biggest.key : null;
  }
  return list;
}

/** What a supplier's row says under their name: facts only. */
export function describeSupplier(entry: SupplierEntry, money: (n: number) => string): string {
  return [
    entry.prices ? `${entry.prices} ${entry.prices === 1 ? 'price' : 'prices'}` : null,
    entry.expectedCosts ? `${entry.expectedCosts} expected ${entry.expectedCosts === 1 ? 'cost' : 'costs'}` : null,
    entry.paid > 0.005 ? `${money(entry.paid)} paid` : null,
    entry.files ? `${entry.files} ${entry.files === 1 ? 'file' : 'files'}` : null,
  ].filter(Boolean).join(' · ');
}

/** What renaming or merging a supplier would touch, in words: "3 prices and 1 expected cost". */
export function describeRenameReach(entry: Pick<SupplierEntry, 'prices' | 'expectedCosts'>): string {
  return [
    entry.prices ? `${entry.prices} ${entry.prices === 1 ? 'price' : 'prices'}` : null,
    entry.expectedCosts ? `${entry.expectedCosts} expected ${entry.expectedCosts === 1 ? 'cost' : 'costs'}` : null,
  ].filter(Boolean).join(' and ') || 'nothing';
}

export interface FileGroup {
  /** The supplier key, or null for the files that came from nobody. */
  key: string | null;
  /** What the heading says. */
  name: string;
  documents: ProjectFile[];
  photos: ProjectFile[];
}

export const NO_SUPPLIER_HEADING = 'Not from a supplier';

/**
 * Every file on the job, one group per supplier, alphabetically, and the
 * files from nobody last.
 *
 * `names` lets the heading use the same spelling the Suppliers list shows;
 * without it a group takes the spelling of its last file. Files keep the order
 * they arrived in, documents and photos apart, because a photo is a tile and a
 * PDF is a row.
 */
export function filesBySupplier(
  files: ProjectFile[],
  names?: ReadonlyMap<string, string>,
): FileGroup[] {
  const groups = new Map<string | null, FileGroup>();
  for (const file of files) {
    const key = keyOf(file.supplier);
    let group = groups.get(key);
    if (!group) {
      group = { key, name: NO_SUPPLIER_HEADING, documents: [], photos: [] };
      groups.set(key, group);
    }
    if (key) group.name = names?.get(key) ?? file.supplier!.trim();
    (file.kind === 'photo' ? group.photos : group.documents).push(file);
  }
  const named = [...groups.values()]
    .filter((g) => g.key !== null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const nobody = groups.get(null);
  return nobody ? [...named, nobody] : named;
}

/**
 * Where on the job a file is attached, for the line under its name: *On the
 * job*, *On Bathroom*, *On INV-0184*, *Deposit · paying INV-0184*.
 *
 * The group heading already says who it came from, so this says only what it
 * hangs off — the thing somebody needs to find it again from the other side.
 */
export function describeFileHome(
  file: Pick<ProjectFile, 'level' | 'ownerName' | 'ownerDetail'>,
): string {
  switch (file.level) {
    case 'project':
      return 'On the job';
    case 'element':
    case 'item':
      return `On ${file.ownerName}`;
    case 'quote':
      return file.ownerDetail ? `On ${file.ownerDetail}` : 'On their price';
    case 'payment':
      return file.ownerDetail ? `${file.ownerName} · paying ${file.ownerDetail}` : file.ownerName;
    case 'expected_line':
      return file.ownerDetail ? `${file.ownerName} · ${file.ownerDetail}` : file.ownerName;
    default:
      return file.ownerName;
  }
}
