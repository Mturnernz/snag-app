import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, flattenStyle } from '../test/render';
import LookAlikeSheet, { cardFacts, swipeOutcome, type LookAlikeContext } from './LookAlikeSheet';
import ConfirmDialog from './ConfirmDialog';
import { quote } from '../test/projectFixtures';
import type { InvoiceReview } from '../types';
import { Typography } from '../constants/theme';

/**
 * Two prices that look like one, compared a card at a time from *Worth
 * checking*. The live case: ReliaBuilder's $176,755 on Downstairs, emailed in
 * twice a day apart, once as QU-0115 and once with no number.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../lib/supabase', () => ({ getFileUrl: jest.fn().mockResolvedValue('https://signed/doc') }));
jest.mock('../lib/openUrl', () => ({ openUrl: jest.fn() }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));

const unnumbered = quote({
  id: 'a', projectId: 'p1', supplier: 'RELIABUILDER LIMITED', amount: 176755,
  createdAt: '2026-09-25T01:00:00Z', createdBy: 'mike', documentPaths: ['h/docs/1790131965741-888034-QU-0115.pdf'],
});
const numbered = quote({
  id: 'b', projectId: 'p1', supplier: 'RELIABUILDER LIMITED', amount: 176755, invoiceNumber: 'QU-0115',
  detail: 'Downstairs Renovation ESTIMATE', createdAt: '2026-09-26T01:00:00Z', createdBy: 'me',
  documentPaths: ['h/docs/1790200000000-123456-Estimate.pdf'],
});
const third = quote({ id: 'c', projectId: 'p1', supplier: 'RELIABUILDER LIMITED', amount: 176755, createdAt: '2026-09-27T01:00:00Z' });

const review = (over: Partial<InvoiceReview>): InvoiceReview => ({
  id: 'r', projectId: 'p1', elementId: null, kind: 'quote', addressedTo: null, sourcePart: 0,
  supplier: null, detail: null, amount: null, amountInclGst: true, invoiceNumber: null, dated: null, dueOn: null,
  paid: false, paidOn: null, paidEvidence: null, alreadyPaid: null, againstQuoteId: null, claimDecided: false,
  category: null, sourceRef: null, sourceSubject: null, sourceFrom: null, sourceAt: null, inferred: [],
  state: 'approved', quoteId: null, decidedAt: null, photoPaths: [], documentPaths: [], roomIds: [],
  roomAmounts: null, createdAt: '2026-09-25T00:00:00Z', ...over,
});

const context = (over: Partial<LookAlikeContext> = {}): LookAlikeContext => ({
  quotes: [unnumbered, numbered],
  payments: [],
  reviews: [
    review({ id: 'r1', quoteId: 'a', sourceAt: '2026-09-25T00:30:00Z', sourceSubject: 'Fwd: Quote / Estimate for Renovation downstairs' }),
    review({ id: 'r2', quoteId: 'b', sourceAt: '2026-09-26T00:30:00Z', sourceSubject: 'Fwd: Overall update, quote updates, and invoice claim.' }),
  ],
  elements: [],
  items: [],
  nameOf: (id) => (id === 'me' ? 'you' : id === 'mike' ? 'Mike' : null),
  ...over,
});

function open(prices = [unnumbered, numbered], over: Partial<React.ComponentProps<typeof LookAlikeSheet>> = {}) {
  const onDelete = jest.fn().mockResolvedValue(undefined);
  const onKeepAll = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  const r = render(
    <LookAlikeSheet
      visible
      group={{ kind: prices[0].kind === 'invoice' ? 'invoice' : 'quote', prices }}
      context={context({ quotes: prices })}
      onDelete={onDelete}
      onKeepAll={onKeepAll}
      onClose={onClose}
      {...over}
    />
  );
  return { r, onDelete, onKeepAll, onClose };
}

/** The card's own buttons, by their words; the dialog's are looked for inside the dialog. */
const button = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll((n: any) => n.props?.label === label && n.props?.onPress && n.type !== 'Text', { deep: true })
    .filter((n: any) => !isInsideDialog(n))[0];
const isInsideDialog = (n: any): boolean => {
  for (let p = n.parent; p; p = p.parent) if (p.type === ConfirmDialog) return true;
  return false;
};
const press = async (node: any) => { await TestRenderer.act(async () => { await node.props.onPress(); }); };
const dialog = (r: ReturnType<typeof render>) => r.root.findByType(ConfirmDialog);
// The app's own Text, as the card styles it: bold becomes a font file further down.
const valueOf = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll((n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel?.startsWith?.(`${label}: `), { deep: true })[0];

describe('a card', () => {
  it('says what tells the copies apart, oldest first', () => {
    const { r } = open();
    r.getByText('Same quote twice');
    r.getByText('1 of 2');
    r.getByText('RELIABUILDER LIMITED');
    r.getByText('$176,755');
    r.getByText('None');
    r.getByText('25 Sep 2026 by Mike');
    r.getByText('Email · 25 Sep 2026 · Fwd: Quote / Estimate for Renovation downstairs');
    expect(r.getAllByText('QU-0115.pdf').length).toBeGreaterThan(0);
  });

  it('puts what the cards disagree on in bold, and leaves what they share alone', () => {
    const { r } = open();
    for (const label of ['Number', 'Says', 'Added', 'From', 'Files']) {
      expect(flattenStyle(valueOf(r, label).props.style).fontWeight).toBe(Typography.bold);
      expect(valueOf(r, label).props.accessibilityLabel).toMatch(/differs$/);
    }
    for (const label of ['Part', 'Agreed', 'Dated']) {
      expect(flattenStyle(valueOf(r, label).props.style).fontWeight).not.toBe(Typography.bold);
      expect(valueOf(r, label).props.accessibilityLabel).not.toMatch(/differs$/);
    }
  });

  it('names you as you, and leaves out somebody it cannot name', () => {
    const facts = cardFacts(numbered, context());
    expect(facts.find((f) => f.name === 'added')?.value).toBe('26 Sep 2026 by you');
    expect(cardFacts(third, context()).find((f) => f.name === 'added')?.value).toBe('27 Sep 2026');
    expect(cardFacts(third, context()).find((f) => f.name === 'from')?.value).toBe('Typed in');
  });

  it('counts what hangs off a price', () => {
    const stage = quote({ id: 's1', kind: 'invoice', againstQuoteId: 'b' });
    const inside = quote({ id: 'i1', kind: 'invoice', billedThroughId: 'b' });
    const facts = cardFacts({ ...numbered, lineCount: 3 }, context({
      quotes: [numbered, stage, inside],
      payments: [{ id: 'p1', quoteId: 'b' } as any, { id: 'p2', quoteId: 'b' } as any],
    }));
    expect(facts.find((f) => f.name === 'on')?.value).toBe('1 stage · 1 invoice inside · 2 payments · 3 lines');
    expect(cardFacts(unnumbered, context()).find((f) => f.name === 'on')?.value).toBe('Nothing');
  });

  it('says an invoice is an invoice, with its due date and whether it is paid', () => {
    const one = quote({ id: 'i1', kind: 'invoice', supplier: 'Kitchen Mania', invoiceNumber: 'INV-15879', amount: 27480.37, dueOn: '2026-10-05', paidTotal: 27480.37, unpaid: 0 });
    const two = quote({ ...one, id: 'i2', paidTotal: null, unpaid: 27480.37, createdAt: '2026-09-28T00:00:00Z' });
    const { r } = open([one, two]);
    r.getByText('Same invoice twice');
    r.getByText('INVOICE');
    expect(r.getAllByText('5 Oct 2026').length).toBe(1);
    // The label and the answer both say it.
    expect(r.getAllByText('Paid').length).toBe(2);
  });

  it('opens a file from the card', async () => {
    const { openUrl } = jest.requireMock('../lib/openUrl');
    const { r } = open();
    const file = r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Open QU-0115.pdf' && n.props?.onPress, { deep: true });
    expect(file.length).toBeGreaterThan(0);
    await TestRenderer.act(async () => { await file[0].props.onPress(); });
    expect(openUrl).toHaveBeenCalledWith('https://signed/doc');
  });
});

describe('keep', () => {
  it('moves to the next card without writing anything', async () => {
    const { r, onKeepAll, onClose } = open();
    await press(button(r, 'Keep'));
    r.getByText('2 of 2');
    r.getByText('QU-0115');
    expect(onKeepAll).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps them all once every card is kept, then closes', async () => {
    const { r, onKeepAll, onClose } = open();
    await press(button(r, 'Keep'));
    await press(button(r, 'Keep'));
    expect(onKeepAll).toHaveBeenCalledWith([unnumbered, numbered]);
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open and says why when keeping is refused', async () => {
    const { r, onClose } = open(undefined, { onKeepAll: jest.fn().mockRejectedValue(new Error('Those prices are on different jobs')) });
    await press(button(r, 'Keep'));
    await press(button(r, 'Keep'));
    r.getByText('Those prices are on different jobs');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('delete', () => {
  it('asks first, in the words the price’s own sheet uses, and deletes nothing until asked', async () => {
    const { r, onDelete } = open();
    expect(dialog(r).props.visible).toBe(false);
    await press(button(r, 'Delete'));
    expect(dialog(r).props.visible).toBe(true);
    expect(dialog(r).props.title).toBe('Delete this quote?');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('names the payments that go with it', async () => {
    const { r } = open([unnumbered, numbered], {
      context: context({ payments: [{ id: 'p1', quoteId: 'a' } as any] }),
    });
    await press(button(r, 'Delete'));
    expect(dialog(r).props.message).toBe('Its payment goes with it.');
  });

  it('deletes on the second press, and closes once one price is left', async () => {
    const { r, onDelete, onClose } = open();
    await press(button(r, 'Delete'));
    await TestRenderer.act(async () => { await dialog(r).props.onConfirm(); });
    expect(onDelete).toHaveBeenCalledWith(unnumbered);
    expect(onClose).toHaveBeenCalled();
  });

  it('says how many copies there are when there are more than two', () => {
    const { r } = open([unnumbered, numbered, third]);
    r.getByText('Same quote 3 times');
    r.getByText('1 of 3');
  });

  it('stays open while two copies are left', async () => {
    const { r, onDelete, onClose } = open([unnumbered, numbered, third]);
    await press(button(r, 'Delete'));
    await TestRenderer.act(async () => { await dialog(r).props.onConfirm(); });
    expect(onDelete).toHaveBeenCalledWith(unnumbered);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('deletes nothing when the question is turned down', async () => {
    const { r, onDelete } = open();
    await press(button(r, 'Delete'));
    await TestRenderer.act(async () => { dialog(r).props.onCancel(); });
    expect(dialog(r).props.visible).toBe(false);
    expect(onDelete).not.toHaveBeenCalled();
    r.getByText('1 of 2');
  });

  it('says why a delete was refused, with the sheet still open', async () => {
    const { r, onClose } = open(undefined, { onDelete: jest.fn().mockRejectedValue(new Error('That wasn’t deleted')) });
    await press(button(r, 'Delete'));
    await TestRenderer.act(async () => { await dialog(r).props.onConfirm(); });
    r.getByText('That wasn’t deleted');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('moving between cards', () => {
  it('lets the dots show another card without deciding anything', async () => {
    const { r, onKeepAll, onDelete } = open();
    const dot = r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Show 2 of 2' && n.props?.onPress, { deep: true })[0];
    await TestRenderer.act(async () => { dot.props.onPress(); });
    r.getByText('2 of 2');
    r.getByText('QU-0115');
    expect(onKeepAll).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('a swipe', () => {
  it('deletes to the left and keeps to the right, past the line', () => {
    expect(swipeOutcome(-120, 10)).toBe('delete');
    expect(swipeOutcome(120, -10)).toBe('keep');
  });

  it('is nothing when it is short, or more down than across', () => {
    expect(swipeOutcome(-60, 0)).toBeNull();
    expect(swipeOutcome(120, 100)).toBeNull();
    expect(swipeOutcome(-120, -200)).toBeNull();
  });
});
