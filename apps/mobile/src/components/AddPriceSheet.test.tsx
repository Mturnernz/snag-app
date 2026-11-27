import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import AddPriceSheet from './AddPriceSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const press = async (node: any) => {
  let n = node;
  while (n && !(n.props.onClick || n.props.onPress)) n = n.parent;
  await TestRenderer.act(async () => { (n.props.onClick ?? n.props.onPress)(); });
};
const field = (r: any, label: string) =>
  r.root.findAll((n: any) => typeof n.type === 'string' && n.props.accessibilityLabel === label, { deep: true })[0];
const type = async (node: any, text: string) =>
  TestRenderer.act(async () => { (node.props.onChangeText ?? node.props.onChange)?.(node.props.onChangeText ? text : { nativeEvent: { text } }); });
const amountBox = (r: any) =>
  r.root.findAll((n: any) => typeof n.type === 'string' && typeof n.props.onChangeText === 'function', { deep: true })
    .find((n: any) => n.props.accessibilityLabel === 'Amount' || n.props.keyboardType === 'decimal-pad');

const existing: any = {
  id: 'i1', supplier: 'ReliaBuilder', kind: 'invoice', status: 'tbc', invoiceNumber: 'INV-0215',
  amountIncl: 43987.5, dated: '2026-09-26', detail: null, notes: null,
};

function open(onSave = jest.fn().mockResolvedValue(undefined), prices: any[] = []) {
  const r = render(
    <AddPriceSheet visible defaultKind="invoice" prices={prices} onSave={onSave} onClose={jest.fn()} />,
  );
  return { r, onSave };
}

describe('AddPriceSheet', () => {
  it('saves who, how much, number and paid', async () => {
    const { r, onSave } = open();
    await type(field(r, 'Who from'), 'Laser Plumbing');
    await type(amountBox(r), '5500');
    await type(field(r, 'Invoice number'), 'INV-9');
    await press(r.getByText('Already paid'));
    await press(r.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'invoice', supplier: 'Laser Plumbing', amount: 5500, invoiceNumber: 'INV-9', paid: true,
    }));
  });

  it('asks for a supplier and an amount in words, writing nothing', async () => {
    const { r, onSave } = open();
    await press(r.getByText('Save'));
    r.getByText('Who is it from?');
    await type(field(r, 'Who from'), 'X');
    await press(r.getByText('Save'));
    r.getByText('How much is it?');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('warns about a bill already on the job, and still saves', async () => {
    const { r, onSave } = open(undefined, [existing]);
    await type(field(r, 'Who from'), 'ReliaBuilder');
    await type(amountBox(r), '43987.50');
    await type(field(r, 'Invoice number'), 'INV-0215');
    expect(r.getAllByType('Text').map((n: any) => n.children.join('')).join(' ')).toMatch(/Looks like INV-0215/);
    await press(r.getByText('Save anyway'));
    expect(onSave).toHaveBeenCalled();
  });

  it('offers names the job already uses', async () => {
    const { r } = open(undefined, [existing]);
    await type(field(r, 'Who from'), 'relia');
    await press(field(r, 'Use ReliaBuilder'));
    expect(field(r, 'Who from').props.value).toBe('ReliaBuilder');
  });
});
