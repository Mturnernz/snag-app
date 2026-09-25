import {
  budgetRemaining,
  describeFileHome,
  describeRemaining,
  describeRenameReach,
  describeSupplier,
  filesBySupplier,
  formatMoney,
  NO_SUPPLIER_HEADING,
  supplierDirectory,
} from '@snag/supabase-queries';
import { quote } from '../test/projectFixtures';

/**
 * Who a job's money and paperwork came from, and how much of the budget the
 * money paid has left. All pure, all read off the page already in hand.
 */

const money = (n: number) => formatMoney(n) ?? '';

const file = (over: any = {}): any => ({
  projectId: 'p1', level: 'quote', ownerId: 'q1', ownerName: 'ReliaBuilder', kind: 'document',
  path: 'h/docs/1-1-INV.pdf', supplier: 'ReliaBuilder', ownerDetail: 'INV-0184', ...over,
});

const expected = (over: any = {}): any => ({
  id: 'x1', projectId: 'p1', elementId: null, name: 'Building consent', amount: 2400, amountInclGst: true,
  likelySupplier: 'Auckland Council', note: null, confirmed: false, settledBy: null,
  createdAt: '2026-05-01T00:00:00Z', ...over,
});

describe('budgetRemaining', () => {
  it('is nothing until something has been paid, and nothing without a budget', () => {
    expect(budgetRemaining(100000, true, null)).toBeNull();
    expect(budgetRemaining(100000, true, 0)).toBeNull();
    expect(budgetRemaining(null, true, 5000)).toBeNull();
    expect(budgetRemaining(0, true, 5000)).toBeNull();
  });

  it('is budget less paid, with the share of the budget that is left', () => {
    const r = budgetRemaining(195000, true, 92165)!;
    expect(r.remaining).toBe(102835);
    expect(r.share).toBeCloseTo(0.5274, 4);
    expect(r.tone).toBe('good');
    expect(r.over).toBe(false);
  });

  it('turns warn at 15% left and danger at 5%, inclusive at both edges', () => {
    const tone = (paid: number) => budgetRemaining(100000, true, paid)!.tone;
    expect(tone(84000)).toBe('good');
    expect(tone(85000)).toBe('warn');
    expect(tone(94999)).toBe('warn');
    expect(tone(95000)).toBe('danger');
    expect(tone(120000)).toBe('danger');
  });

  it('measures against the budget grossed up when it was typed ex GST', () => {
    const r = budgetRemaining(100000, false, 100000)!;
    expect(r.budget).toBe(115000);
    expect(r.remaining).toBe(15000);
  });

  it('says it in words, the percentage agreeing with the colour at the edges', () => {
    expect(describeRemaining(budgetRemaining(100000, true, 84000)!, money))
      .toEqual({ label: 'Budget remaining', value: '$16,000 · 16% left' });
    // 15.4% left is still fern, so it must not read "15% left".
    expect(describeRemaining(budgetRemaining(100000, true, 84600)!, money).value).toBe('$15,400 · 16% left');
    expect(describeRemaining(budgetRemaining(100000, true, 90000)!, money).value).toBe('$10,000 · 10% left');
    expect(describeRemaining(budgetRemaining(45000, true, 47200)!, money))
      .toEqual({ label: 'Over budget', value: '$2,200 · 5% over' });
  });
});

describe('supplierDirectory', () => {
  const page = (over: any = {}) => ({ quotes: [], expected: [], files: [], ...over });

  it('is one supplier per trimmed, lower-cased name, in the latest spelling', () => {
    const list = supplierDirectory(page({
      quotes: [
        quote({ id: 'a', supplier: 'MSC consulting', createdAt: '2026-04-01T00:00:00Z' }),
        quote({ id: 'b', supplier: ' MSC Consulting ', createdAt: '2026-06-01T00:00:00Z' }),
      ],
    }));
    expect(list).toHaveLength(1);
    expect(list[0].key).toBe('msc consulting');
    expect(list[0].name).toBe('MSC Consulting');
    expect(list[0].prices).toBe(2);
  });

  it('counts declined quotes and expected costs, because a rename has to reach them', () => {
    const [council, reece] = supplierDirectory(page({
      quotes: [quote({ supplier: 'Reece', status: 'declined' })],
      expected: [expected()],
    }));
    expect(council).toMatchObject({ name: 'Auckland Council', prices: 0, expectedCosts: 1 });
    expect(reece).toMatchObject({ name: 'Reece', prices: 1 });
  });

  it('adds up what has been paid against their bills, and counts their files', () => {
    const [entry] = supplierDirectory(page({
      quotes: [
        quote({ id: 'c', supplier: 'ReliaBuilder', kind: 'quote', amount: 176755 }),
        quote({ id: 'i1', supplier: 'ReliaBuilder', kind: 'invoice', paidTotal: 43987.5 }),
        quote({ id: 'i2', supplier: 'ReliaBuilder', kind: 'invoice', paidTotal: 43987.5 }),
      ],
      files: [file(), file({ path: 'h/docs/2', level: 'payment' }), file({ supplier: null, path: 'h/docs/3' })],
    }));
    expect(entry.paid).toBe(87975);
    expect(entry.files).toBe(2);
    expect(describeSupplier(entry, money)).toBe('3 prices · $87,975 paid · 2 files');
  });

  it('suggests that two spellings of one business are one, and offers the smaller up', () => {
    const list = supplierDirectory(page({
      quotes: [
        quote({ id: 'a', supplier: 'ReliaBuilder' }),
        quote({ id: 'b', supplier: 'ReliaBuilder' }),
        quote({ id: 'c', supplier: 'RELIABUILDER LIMITED' }),
        quote({ id: 'd', supplier: 'Force Plumbing' }),
      ],
    }));
    const byName = Object.fromEntries(list.map((e) => [e.name, e]));
    expect(byName['RELIABUILDER LIMITED'].sameAs).toEqual(['reliabuilder']);
    expect(byName['RELIABUILDER LIMITED'].mergeInto).toBe('reliabuilder');
    // Only one of the pair offers, so the page never shows two Merges pointing at each other.
    expect(byName.ReliaBuilder.mergeInto).toBeNull();
    expect(byName['Force Plumbing'].sameAs).toEqual([]);
  });

  it('names what a rename would touch', () => {
    expect(describeRenameReach({ prices: 3, expectedCosts: 1 })).toBe('3 prices and 1 expected cost');
    expect(describeRenameReach({ prices: 1, expectedCosts: 0 })).toBe('1 price');
  });
});

describe('filesBySupplier', () => {
  it('groups by supplier alphabetically, with what came from nobody last', () => {
    const groups = filesBySupplier([
      file({ path: 'a', supplier: null, level: 'project', ownerName: 'Laundry' }),
      file({ path: 'b', supplier: 'Tile Depot' }),
      file({ path: 'c', supplier: 'force plumbing' }),
      file({ path: 'd', supplier: 'Tile Depot', kind: 'photo' }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(['force plumbing', 'Tile Depot', NO_SUPPLIER_HEADING]);
    const tiles = groups[1];
    expect(tiles.documents.map((f) => f.path)).toEqual(['b']);
    expect(tiles.photos.map((f) => f.path)).toEqual(['d']);
    expect(groups[2].key).toBeNull();
  });

  it('puts a payment’s paperwork under the supplier of the bill it paid', () => {
    const groups = filesBySupplier([
      file({ path: 'inv', level: 'quote' }),
      file({ path: 'bank', level: 'payment', ownerName: 'Deposit', ownerDetail: 'INV-0184' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].documents.map((f) => f.path)).toEqual(['inv', 'bank']);
  });

  it('groups on the name the way the money does, and takes the heading’s spelling from the directory', () => {
    const groups = filesBySupplier(
      [file({ path: 'a', supplier: 'MSC Consulting' }), file({ path: 'b', supplier: 'msc consulting ' })],
      new Map([['msc consulting', 'MSC Consulting']]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('MSC Consulting');
  });

  it('keeps two spellings nobody has merged as two groups', () => {
    const groups = filesBySupplier([
      file({ path: 'a', supplier: 'ReliaBuilder' }),
      file({ path: 'b', supplier: 'RELIABUILDER LIMITED' }),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe('describeFileHome', () => {
  it('says what a file hangs off, never who sent it', () => {
    expect(describeFileHome(file({ level: 'project', ownerName: 'Laundry' }))).toBe('On the job');
    expect(describeFileHome(file({ level: 'element', ownerName: 'Bathroom' }))).toBe('On Bathroom');
    expect(describeFileHome(file({ level: 'quote', ownerDetail: 'INV-0184' }))).toBe('On INV-0184');
    expect(describeFileHome(file({ level: 'quote', ownerDetail: null }))).toBe('On their price');
    expect(describeFileHome(file({ level: 'payment', ownerName: 'Deposit', ownerDetail: 'INV-0184' })))
      .toBe('Deposit · paying INV-0184');
    expect(describeFileHome(file({ level: 'expected_line', ownerName: 'Initial payment', ownerDetail: 'Building consent' })))
      .toBe('Initial payment · Building consent');
  });
});
