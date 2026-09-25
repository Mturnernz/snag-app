import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import MoneySheet from './MoneySheet';
import { element, item, quote } from '../test/projectFixtures';

/**
 * The one way money gets onto a project.
 *
 * The rules that would erode first: an agreed-to-go-ahead answer arriving
 * pre-filled; a progress bill landing somewhere its contract is not; a quote
 * for a thing being treated as a commitment; and a set-aside amount written as
 * a line with nothing to choose against it.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('./Attachments', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'attachments') };
});

const mock_createQuote = jest.fn();
const mock_addPayment = jest.fn().mockResolvedValue({});
const mock_addQuoteLine = jest.fn();
const mock_createElement = jest.fn();
const mock_createItem = jest.fn();
const mock_setItemSetAside = jest.fn().mockResolvedValue(undefined);
const mock_createExpectedCost = jest.fn().mockResolvedValue({});
jest.mock('../lib/supabase', () => {
  const real = jest.requireActual('@snag/supabase-queries');
  return {
    createQuote: (...a: unknown[]) => mock_createQuote(...a),
    addPayment: (...a: unknown[]) => mock_addPayment(...a),
    addQuoteLine: (...a: unknown[]) => mock_addQuoteLine(...a),
    createElement: (...a: unknown[]) => mock_createElement(...a),
    createItem: (...a: unknown[]) => mock_createItem(...a),
    setItemSetAside: (...a: unknown[]) => mock_setItemSetAside(...a),
    createExpectedCost: (...a: unknown[]) => mock_createExpectedCost(...a),
    formatMoney: real.formatMoney,
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mock_createQuote.mockImplementation(async (input: any) => quote({ id: 'new', ...input }));
  mock_addQuoteLine.mockImplementation(async (_q: string, input: any) => ({ id: `line-${input.name}`, quoteId: 'new', ...input }));
  mock_createItem.mockImplementation(async (elementId: string, name: string) => item({ id: `item-${name}`, elementId, name }));
});

const elements = [
  element({ id: 'eL', name: 'Laundry', room: 'Laundry' }),
  element({ id: 'eB', name: 'Bathroom', room: 'Bathroom', sortOrder: 1 }),
];
const locations = [
  { id: 'l1', propertyId: 'prop', name: 'Laundry', sortOrder: 1 },
  { id: 'l2', propertyId: 'prop', name: 'Bathroom', sortOrder: 2 },
  { id: 'l3', propertyId: 'prop', name: 'Kitchen', sortOrder: 3 },
];

function open(props: Partial<React.ComponentProps<typeof MoneySheet>> = {}) {
  const onSaved = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  const r = render(
    <MoneySheet
      visible
      projectId="p1"
      householdId="h"
      elements={elements}
      items={[]}
      quotes={[]}
      locations={locations}
      knownSuppliers={['Reece']}
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />
  );
  return { r, onSaved, onClose };
}

const node = (r: ReturnType<typeof render>, label: string, prop = 'onPress') => {
  const found = r.root.findAll((n: any) => n.props?.accessibilityLabel === label && n.props?.[prop], { deep: true });
  if (!found.length) throw new Error(`Nothing labelled "${label}" with ${prop}`);
  return found[found.length - 1];
};
const press = async (r: ReturnType<typeof render>, label: string) => {
  await TestRenderer.act(async () => { node(r, label).props.onPress(); });
};
const type = async (r: ReturnType<typeof render>, label: string, text: string) => {
  await TestRenderer.act(async () => { node(r, label, 'onChangeText').props.onChangeText(text); });
};
const text = (r: ReturnType<typeof render>) =>
  r.getAllByType('Text').map((n) => n.children.join('')).join(' | ');

async function pickSupplier(r: ReturnType<typeof render>, name: string) {
  await type(r, 'Search suppliers', name);
  try { await press(r, `Add “${name}”`); } catch { await press(r, name); }
}

describe('what have you got?', () => {
  it('asks in the words on the paper', () => {
    const { r } = open();
    r.getByText('What have you got?');
    for (const option of ['A quote or price', 'An invoice', 'A receipt', 'A cost we’re expecting']) r.getByText(option);
  });

  it('adds a supplier nobody has used before, with no list to set up first', async () => {
    const { r } = open();
    await press(r, 'An invoice');
    await pickSupplier(r, 'Tile Space');
    r.getByText('New bill');
    r.getByText('Tile Space');
  });
});

describe('a quote for the whole job', () => {
  it('will not save until somebody says whether it was agreed — no answer is chosen for them', async () => {
    const { r } = open();
    await press(r, 'A quote or price');
    await pickSupplier(r, 'ReliaBuilder');
    await type(r, 'Amount', '185000');
    await press(r, 'Save');
    expect(mock_createQuote).not.toHaveBeenCalled();
    expect(text(r)).toContain('Say whether you’ve agreed to go ahead');
  });

  it('then asks what it sets aside, and each set-aside becomes a thing in its room', async () => {
    const { r, onSaved } = open();
    await press(r, 'A quote or price');
    await pickSupplier(r, 'ReliaBuilder');
    await type(r, 'Amount', '185000');
    await press(r, 'Yes, agreed');
    await press(r, 'Save');
    expect(mock_createQuote).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', itemId: null, elementId: null, kind: 'quote', status: 'accepted', amount: 185000,
    }));
    r.getByText('Does it set money aside for things you’ll choose?');

    await type(r, 'Set-aside 1: what it’s for', 'Laundry fixtures and fittings');
    await type(r, 'Amount set aside', '8000');
    await press(r, 'Laundry');
    await press(r, 'Save');
    expect(mock_addQuoteLine).toHaveBeenCalledWith('new', expect.objectContaining({
      name: 'Laundry fixtures and fittings', amount: 8000, isAllowance: true,
    }));
    expect(mock_createItem).toHaveBeenCalledWith('eL', 'Laundry fixtures and fittings');
    expect(mock_setItemSetAside).toHaveBeenCalledWith('item-Laundry fixtures and fittings', 'line-Laundry fixtures and fittings');
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it('a quote not yet agreed does not count as agreed', async () => {
    const { r } = open();
    await press(r, 'A quote or price');
    await pickSupplier(r, 'Top Roofing');
    await type(r, 'Amount', '36500');
    await press(r, 'Not yet');
    await press(r, 'Save');
    expect(mock_createQuote).toHaveBeenCalledWith(expect.objectContaining({ status: 'tbc' }));
    expect(text(r)).not.toContain('set money aside');
  });
});

describe('a quote for a thing', () => {
  it('is an option on it, and is never asked whether it was agreed', async () => {
    const toilet = item({ id: 'iT', elementId: 'eB', name: 'Toilet' });
    const { r } = open({ items: [toilet], start: { kind: 'quote', elementId: 'eB', itemId: 'iT' } });
    await pickSupplier(r, 'Reece');
    await type(r, 'Amount', '1450');
    expect(text(r)).not.toContain('Have you agreed to go ahead?');
    await press(r, 'Save');
    expect(mock_createQuote).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'iT', elementId: null, projectId: null, status: 'tbc', kind: 'quote',
    }));
  });

  it('can name the thing on the way past', async () => {
    const { r } = open({ start: { kind: 'quote', elementId: 'eB' } });
    await pickSupplier(r, 'Plumbing World');
    await type(r, 'Amount', '890');
    await type(r, 'Name a new thing', 'Toilet');
    await press(r, 'Save');
    expect(mock_createItem).toHaveBeenCalledWith('eB', 'Toilet');
    expect(mock_createQuote).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'item-Toilet' }));
  });
});

describe('a bill', () => {
  const contract = quote({
    id: 'c1', projectId: 'p1', supplier: 'ReliaBuilder', detail: 'Building contract',
    amount: 185000, status: 'accepted', claimedTotal: 46000,
  });

  it('from somebody with an agreed price, asks whether it is part of it', async () => {
    const { r } = open({ quotes: [contract] });
    await press(r, 'An invoice');
    await pickSupplier(r, 'ReliaBuilder');
    await type(r, 'Amount', '40000');
    r.getByText('Is this part of an agreed price?');
    r.getByText('$185,000 · $46,000 billed so far');
    await press(r, 'Save');
    expect(mock_createQuote).not.toHaveBeenCalled();
    await press(r, 'Building contract');
    r.getByText('$99,000 left to bill after this one');
    await press(r, 'Save');
    // It lands exactly where its contract sits, and says which contract.
    expect(mock_createQuote).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', itemId: null, elementId: null, kind: 'invoice', status: 'accepted',
      againstQuoteId: 'c1', amount: 40000,
    }));
  });

  it('keeps asking however many agreed prices the supplier has', async () => {
    const variation = quote({ id: 'c2', projectId: 'p1', supplier: 'ReliaBuilder', detail: 'Variation — stone benchtop', amount: 1200, status: 'accepted' });
    const { r } = open({ quotes: [contract, variation] });
    await press(r, 'An invoice');
    await pickSupplier(r, 'ReliaBuilder');
    r.getByText('Building contract');
    r.getByText('Variation — stone benchtop');
    r.getByText('No, it’s extra');
  });

  it('that is extra is not a claim on anything', async () => {
    const { r } = open({ quotes: [contract] });
    await press(r, 'An invoice');
    await pickSupplier(r, 'ReliaBuilder');
    await type(r, 'Amount', '800');
    await press(r, 'No, it’s extra');
    await press(r, 'Save');
    expect(mock_createQuote).toHaveBeenCalledWith(expect.objectContaining({ againstQuoteId: null, projectId: 'p1' }));
  });
});

describe('a bill that is already on the job', () => {
  const onJob = quote({
    id: 'b1', projectId: 'p1', kind: 'invoice', status: 'accepted', supplier: 'MSC Consulting',
    detail: 'Structural Engineering', invoiceNumber: 'INV87022', amount: 437, dated: '2026-08-31',
  });

  it('keeps the invoice number as a number, not folded into what it is for', async () => {
    const { r } = open();
    await press(r, 'An invoice');
    await pickSupplier(r, 'Tile Space');
    await type(r, 'Amount', '120');
    await type(r, 'What it’s for', 'Grout');
    await type(r, 'Invoice number', 'V962155');
    await press(r, 'Save');
    expect(mock_createQuote).toHaveBeenCalledWith(expect.objectContaining({
      detail: 'Grout', invoiceNumber: 'V962155',
    }));
  });

  it('says which bill it looks like as soon as the number matches, and still saves', async () => {
    const onOpenBill = jest.fn();
    const { r } = open({ quotes: [onJob], onOpenBill });
    await press(r, 'An invoice');
    await pickSupplier(r, 'MSC Consulting');
    await type(r, 'Amount', '500');
    expect(r.queryByText('Save anyway')).toBeNull();
    await type(r, 'Invoice number', 'inv-87022');
    r.getByText('Looks like INV87022 from MSC Consulting ($437, 31 Aug 2026), already on the job');
    r.getByText('Save anyway');
    await press(r, 'Open the bill already on the job');
    expect(onOpenBill).toHaveBeenCalledWith(onJob);
    await press(r, 'Save anyway');
    expect(mock_createQuote).toHaveBeenCalledWith(expect.objectContaining({ invoiceNumber: 'inv-87022' }));
  });

  it('with no number, warns on the same supplier and figure', async () => {
    const { r } = open({ quotes: [onJob] });
    await press(r, 'An invoice');
    await pickSupplier(r, 'MSC Consulting');
    await type(r, 'Amount', '437');
    r.getByText('Save anyway');
  });

  it('says nothing when the number is different, even for the same figure', async () => {
    const { r } = open({ quotes: [onJob] });
    await press(r, 'An invoice');
    await pickSupplier(r, 'MSC Consulting');
    await type(r, 'Amount', '437');
    await type(r, 'Invoice number', 'INV87100');
    expect(r.queryByText('Save anyway')).toBeNull();
    r.getByText('Save');
  });
});

describe('a receipt', () => {
  it('is a bill and its payment, in one go', async () => {
    const { r, onSaved } = open();
    await press(r, 'A receipt');
    await pickSupplier(r, 'Bunnings');
    await type(r, 'Amount', '180');
    await press(r, 'Save');
    expect(mock_createQuote).toHaveBeenCalledWith(expect.objectContaining({ kind: 'invoice', status: 'accepted' }));
    expect(mock_addPayment).toHaveBeenCalledWith('new', expect.objectContaining({ amount: 180 }));
    expect(onSaved).toHaveBeenCalledWith('Recorded as paid');
  });
});

describe('a cost we are expecting', () => {
  it('needs no supplier and no price', async () => {
    const { r } = open();
    await press(r, 'A cost we’re expecting');
    await type(r, 'What the cost is for', 'Council consent');
    await press(r, 'Save');
    expect(mock_createExpectedCost).toHaveBeenCalledWith('p1', expect.objectContaining({
      name: 'Council consent', amount: null, elementId: null,
    }));
    expect(mock_createQuote).not.toHaveBeenCalled();
  });
});
