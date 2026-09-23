import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import ThingSheet from './ThingSheet';
import { item, line, quote } from '../test/projectFixtures';

/**
 * One thing being bought, and the options for it.
 *
 * The rule to keep: choosing an option that belongs to a set-aside amount asks
 * who will bill for it and writes both links — which allowance it settles and
 * who passes it on — because without them the allowance and the thing that
 * replaced it both count.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mock_chooseOption = jest.fn().mockResolvedValue(undefined);
const mock_setQuoteStatus = jest.fn().mockResolvedValue(undefined);
const mock_updateQuote = jest.fn().mockResolvedValue(undefined);
const mock_setItemSetAside = jest.fn().mockResolvedValue(undefined);
const mock_setItemExcluded = jest.fn().mockResolvedValue(undefined);
const mock_updateItem = jest.fn().mockResolvedValue(undefined);
jest.mock('../lib/supabase', () => {
  const real = jest.requireActual('@snag/supabase-queries');
  return {
    chooseOption: (...a: unknown[]) => mock_chooseOption(...a),
    setQuoteStatus: (...a: unknown[]) => mock_setQuoteStatus(...a),
    updateQuote: (...a: unknown[]) => mock_updateQuote(...a),
    setItemSetAside: (...a: unknown[]) => mock_setItemSetAside(...a),
    setItemExcluded: (...a: unknown[]) => mock_setItemExcluded(...a),
    updateItem: (...a: unknown[]) => mock_updateItem(...a),
    deleteItem: jest.fn().mockResolvedValue([]),
    deleteStoredFiles: jest.fn(),
    chosenAgainst: real.chosenAgainst,
    formatMoney: real.formatMoney,
  };
});

beforeEach(() => jest.clearAllMocks());

const contract = quote({ id: 'c1', projectId: 'p1', supplier: 'ReliaBuilder', amount: 185000, status: 'accepted' });
const hardware = line({ id: 'lB', quoteId: 'c1', name: 'Bathroom hardware', amount: 12000 });
const options = [
  quote({ id: 't1', itemId: 'iT', supplier: 'Plumbing World', detail: 'Caroma Luna', amount: 890 }),
  quote({ id: 't2', itemId: 'iT', supplier: 'Reece', detail: 'Villeroy & Boch Subway', amount: 1450 }),
];

function open(over: { item?: any; quotes?: any[]; setAsides?: any[] } = {}) {
  const onChanged = jest.fn().mockResolvedValue(undefined);
  const onAddOption = jest.fn();
  const r = render(
    <ThingSheet
      visible
      item={over.item ?? item({ id: 'iT', elementId: 'eB', name: 'Toilet', setAsideLineId: 'lB' })}
      room="Bathroom"
      quotes={over.quotes ?? [contract, ...options]}
      setAsides={over.setAsides ?? [hardware]}
      onClose={jest.fn()}
      onChanged={onChanged}
      onAddOption={onAddOption}
      onOpenBill={jest.fn()}
      onRecordInHouse={jest.fn()}
    />
  );
  return { r, onChanged, onAddOption };
}

const press = async (r: ReturnType<typeof render>, label: string) => {
  const found = r.root.findAll((n: any) => n.props?.accessibilityLabel === label && n.props?.onPress, { deep: true });
  if (!found.length) throw new Error(`Nothing labelled "${label}"`);
  await TestRenderer.act(async () => { found[found.length - 1].props.onPress(); });
};

describe('comparing', () => {
  it('shows every option, cheapest first, and none is chosen until somebody chooses', () => {
    const { r } = open();
    const names = r.getAllByType('Text').map((n) => n.children.join(''));
    expect(names.indexOf('Caroma Luna')).toBeLessThan(names.indexOf('Villeroy & Boch Subway'));
    r.getByText('$890');
    r.getByText('$1,450');
    expect(r.queryByText('Chosen')).toBeNull();
  });

  it('adds another option through the one way money comes in', async () => {
    const { r, onAddOption } = open();
    await press(r, 'Add an option');
    expect(onAddOption).toHaveBeenCalledWith(expect.objectContaining({ id: 'iT' }));
  });
});

describe('choosing against a set-aside', () => {
  it('asks who will bill for it, showing the set-aside and what is chosen so far', async () => {
    const { r } = open();
    await press(r, 'Choose Caroma Luna');
    r.getByText('Who will bill you for it?');
    r.getByText('You pay them directly');
    r.getByText('On their bills');
    r.getByText('Bathroom hardware set aside');
    r.getByText('$12,000');
    r.getByText('$890');
  });

  it('bought direct: settles the set-aside and bills nobody else', async () => {
    const { r, onChanged } = open();
    await press(r, 'Choose Caroma Luna');
    await press(r, 'Choose Caroma Luna');
    expect(mock_chooseOption).toHaveBeenCalledWith('t1', { setAsideLineId: 'lB', billedThroughId: null });
    expect(onChanged).toHaveBeenCalledWith('Chosen');
  });

  it('through the builder: names their quote as the one billing it', async () => {
    const { r } = open();
    await press(r, 'Choose Caroma Luna');
    await press(r, 'ReliaBuilder');
    await press(r, 'Choose Caroma Luna');
    expect(mock_chooseOption).toHaveBeenCalledWith('t1', { setAsideLineId: 'lB', billedThroughId: 'c1' });
  });
});

describe('choosing with no set-aside', () => {
  it('is one press', async () => {
    const { r } = open({ item: item({ id: 'iT', name: 'Toilet' }), setAsides: [] });
    await press(r, 'Choose Villeroy & Boch Subway');
    expect(mock_chooseOption).toHaveBeenCalledWith('t2', { setAsideLineId: null, billedThroughId: null });
  });
});

describe('a choice can be undone', () => {
  it('puts it back to undecided and takes both links off', async () => {
    const chosen = [{ ...options[0], status: 'accepted', supersedesLineId: 'lB' }, options[1]];
    const { r } = open({ quotes: [contract, ...chosen] });
    r.getByText('Plumbing World · Chosen');
    await press(r, 'Undo choosing Caroma Luna');
    expect(mock_setQuoteStatus).toHaveBeenCalledWith('t1', 'tbc');
    expect(mock_updateQuote).toHaveBeenCalledWith('t1', { supersedesLineId: null, billedThroughId: null });
  });
});

describe('the rest of the thing', () => {
  it('can be said to come out of a set-aside amount', async () => {
    const { r } = open({ item: item({ id: 'iT', name: 'Toilet' }) });
    await press(r, 'Which set-aside amount this comes out of');
    await press(r, 'Bathroom hardware');
    expect(mock_setItemSetAside).toHaveBeenCalledWith('iT', 'lB');
  });

  it('can be decided against without deleting it', async () => {
    const { r } = open();
    await press(r, 'Decide against it');
    expect(mock_setItemExcluded).toHaveBeenCalledWith('iT', true);
  });

  it('says whether it is in, in two named halves', async () => {
    const { r } = open();
    await press(r, 'Yes');
    expect(mock_updateItem).toHaveBeenCalledWith('iT', { status: 'installed' });
  });
});
