import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, type RenderResult } from '../test/render';
import FilePaperworkSheet from './FilePaperworkSheet';
import { element, quote } from '../test/projectFixtures';
import type { InvoiceReview } from '../types';

// Where a piece of paperwork that came in by email goes. Filing moves files and
// never a figure, so all this asks is where — and it puts the bill from the same
// business first, because that is nearly always the answer.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const paper = (over: Partial<InvoiceReview> = {}): InvoiceReview => ({
  id: 'r1', projectId: 'p1', elementId: null, kind: 'paperwork', addressedTo: null, sourcePart: 1,
  supplier: 'Good Connection', detail: 'Certificate of compliance', amount: null, amountInclGst: true,
  invoiceNumber: null, dated: null, dueOn: null,
  paid: false, paidOn: null, paidEvidence: null, category: null,
  sourceRef: 'em_1', sourceSubject: 'Fwd: Variations', sourceFrom: null, sourceAt: null,
  inferred: [], state: 'pending', quoteId: null, decidedAt: null,
  createdAt: '2026-09-24T00:00:00Z', photoPaths: [], documentPaths: ['h/docs/1-1-CoC.pdf'],
  roomIds: [], roomAmounts: null,
  ...over,
});

const quotes = [
  quote({ id: 'rb', projectId: 'p1', supplier: 'RELIABUILDER LIMITED', kind: 'invoice', invoiceNumber: 'INV-0184', amount: 6325, dated: '2026-09-10' }),
  quote({ id: 'gc', projectId: 'p1', supplier: 'Good Connection Ltd', kind: 'invoice', invoiceNumber: '5521', amount: 880, dated: '2026-09-01' }),
  quote({ id: 'old', projectId: 'p1', supplier: 'Good Connection', kind: 'quote', status: 'declined', amount: 990 }),
];
const parts = [element({ id: 'eRoof', name: 'Roof' }), element({ id: 'eDeck', name: 'Deck' })];

const radio = (r: RenderResult, title: string) =>
  r.root.findAll((n) => n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel === title && n.props.onPress, { deep: true })[0];
const TAGS = ['Compliance certificate', 'Product sheet', 'Warranty', 'Other'];
/** Where it is going — the tag chips are radios too, and are asked about on their own. */
const selected = (r: RenderResult) =>
  r.root.findAll((n) => n.props.accessibilityRole === 'radio' && n.props.accessibilityState?.selected && n.props.onPress, { deep: true })
    .map((n) => n.props.accessibilityLabel)
    .filter((label: string) => !TAGS.includes(label));
const litTag = (r: RenderResult) =>
  r.root.findAll((n) => n.props.accessibilityRole === 'radio' && n.props.accessibilityState?.selected && n.props.onPress, { deep: true })
    .map((n) => n.props.accessibilityLabel)
    .filter((label: string) => TAGS.includes(label));
const tap = (r: RenderResult, label: string) =>
  r.root.findAll((n) => n.props.accessibilityLabel === label && n.props.onPress, { deep: true })[0];

async function open(review: InvoiceReview, onFile = jest.fn().mockResolvedValue(undefined)) {
  const onClose = jest.fn();
  let r!: RenderResult;
  await TestRenderer.act(async () => {
    r = render(<FilePaperworkSheet review={review} quotes={quotes} elements={parts} onClose={onClose} onFile={onFile} />);
  });
  return { r, onFile, onClose };
}

it('puts the bill from the same business first, chosen already', async () => {
  const { r } = await open(paper());
  expect(r.queryByText('With the bill it’s about')).not.toBeNull();
  expect(selected(r)).toEqual(['Good Connection Ltd · 5521']);
});

// The plumber's variation made out to the builder goes with the builder's bill.
it('suggests the bill of the business it was made out to', async () => {
  const { r } = await open(paper({ supplier: 'Force Plumbing', addressedTo: 'ReliaBuilder', detail: 'Variation' }));
  expect(selected(r)).toEqual(['RELIABUILDER LIMITED · INV-0184']);
});

it('chooses the whole job when no bill is from that business, and offers the rest', async () => {
  const { r } = await open(paper({ supplier: 'Roof Inspections NZ' }));
  expect(selected(r)).toEqual(['The whole job']);
  expect(r.queryByText('With a bill')).not.toBeNull();
  expect(radio(r, 'Roof')).toBeDefined();
});

it('never offers a declined quote', async () => {
  const { r } = await open(paper());
  const titles = r.root.findAll((n) => n.props.accessibilityRole === 'radio' && n.props.onPress, { deep: true })
    .map((n) => n.props.accessibilityLabel);
  expect(titles.filter((t: string) => t.startsWith('Good Connection'))).toEqual(['Good Connection Ltd · 5521']);
});

it('files where it was told, and closes', async () => {
  const { r, onFile, onClose } = await open(paper());
  await TestRenderer.act(async () => { radio(r, 'Deck').props.onPress(); });
  await TestRenderer.act(async () => { await tap(r, 'File it').props.onPress(); });
  expect(onFile).toHaveBeenCalledWith({ quoteId: null, elementId: 'eDeck' }, 'compliance');
  expect(onClose).toHaveBeenCalled();
});

it('stays open and says why when the filing is refused', async () => {
  const { r, onClose } = await open(paper(), jest.fn().mockRejectedValue(new Error('That bill belongs to another job')));
  await TestRenderer.act(async () => { await tap(r, 'File it').props.onPress(); });
  expect(r.queryByText('That bill belongs to another job')).not.toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});

// What the paper is, asked at the one moment it is in somebody's hand.
it('suggests what the paper is from its title, and files it with that tag', async () => {
  const { r } = await open(paper());
  expect(litTag(r)).toEqual(['Compliance certificate']);
  expect(r.queryByText('Suggested from its title: Compliance certificate')).not.toBeNull();
});

it('takes a different answer, and says nothing about a suggestion once somebody has answered', async () => {
  const { r, onFile } = await open(paper());
  await TestRenderer.act(async () => { radio(r, 'Warranty').props.onPress(); });
  expect(r.queryByText('Suggested from its title: Compliance certificate')).toBeNull();
  await TestRenderer.act(async () => { await tap(r, 'File it').props.onPress(); });
  expect(onFile).toHaveBeenCalledWith(expect.anything(), 'warranty');
});

it('leaves it untagged when the lit chip is pressed again', async () => {
  const { r, onFile } = await open(paper());
  await TestRenderer.act(async () => { radio(r, 'Compliance certificate').props.onPress(); });
  expect(litTag(r)).toEqual([]);
  await TestRenderer.act(async () => { await tap(r, 'File it').props.onPress(); });
  expect(onFile).toHaveBeenCalledWith(expect.anything(), null);
});

it('guesses nothing when the words say nothing', async () => {
  const { r } = await open(paper({ detail: 'Variation', documentPaths: ['h/docs/1-1-Variation.pdf'] }));
  expect(litTag(r)).toEqual([]);
});

// A photo of the deck is not a certificate, whatever the paper beside it was.
it('does not ask what photos are', async () => {
  const { r, onFile } = await open(paper({ detail: 'Photos', documentPaths: [], photoPaths: ['h/1.jpg'] }));
  expect(r.queryByText('What is it?')).toBeNull();
  await TestRenderer.act(async () => { await tap(r, 'File it').props.onPress(); });
  expect(onFile).toHaveBeenCalledWith(expect.anything(), null);
});
