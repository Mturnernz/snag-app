import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import ProjectScreen from './ProjectScreen';
import SupplierScreen from './SupplierScreen';

/**
 * The project page and a supplier's page, as the wireframe reads them: the
 * figures by state, one card per supplier, Total (paid) once nothing is owed,
 * accepting a quote starting the project, and paying through `payBill`.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mock_navigate = jest.fn();
const mock_nav = { navigate: mock_navigate, goBack: jest.fn(), addListener: () => () => {} };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mock_nav,
  useFocusEffect: (cb: () => void) => require('react').useEffect(() => cb(), [cb]),
}));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => ({ household: { id: 'h', name: 'Home' } }) }));
jest.mock('../components/ProjectTitle', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: ({ name }: { name: string }) => React.createElement(Text, null, name) };
});

const mock_ = {
  getProject: jest.fn(),
  getProjectPrices: jest.fn(),
  getPendingReviews: jest.fn(),
  getSupplierNames: jest.fn(),
  setQuoteStatus: jest.fn(),
  updateProject: jest.fn(),
  payBill: jest.fn(),
  createQuote: jest.fn(),
  deleteQuote: jest.fn(),
  deleteStoredFiles: jest.fn(),
  updateQuote: jest.fn(),
  approveInvoiceReview: jest.fn(),
  declineInvoiceReview: jest.fn(),
  filePaperwork: jest.fn(),
};
jest.mock('../lib/supabase', () => {
  const out: Record<string, unknown> = {};
  const keys = ['getProject', 'getProjectPrices', 'getPendingReviews', 'getSupplierNames', 'setQuoteStatus',
    'updateProject', 'payBill', 'createQuote', 'deleteQuote', 'deleteStoredFiles', 'updateQuote',
    'approveInvoiceReview', 'declineInvoiceReview', 'filePaperwork'];
  for (const k of keys) out[k] = (...a: unknown[]) => (mock_ as any)[k](...a);
  return out;
});

const project = (over: any = {}): any => ({
  id: 'p1', householdId: 'h', propertyId: 'prop', name: 'Downstairs', status: 'underway',
  startedOn: '2026-03-26', finishedOn: null, budget: 200000, budgetInclGst: true, ...over,
});

const price = (over: any): any => ({
  id: over.id ?? Math.random().toString(36), projectId: 'p1', supplier: 'ReliaBuilder', detail: null,
  amount: over.amountIncl, amountInclGst: true, kind: 'invoice', status: 'tbc', dated: null, dueOn: null,
  billedThroughId: null, invoiceNumber: null, photoPaths: [], documentPaths: [], createdAt: '2026-04-01T00:00:00Z',
  paidTotal: null, unpaid: over.unpaid ?? (over.kind === 'quote' ? null : over.amountIncl), ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mock_.getPendingReviews.mockResolvedValue([]);
  mock_.getSupplierNames.mockResolvedValue([]);
  for (const k of ['setQuoteStatus', 'updateProject', 'payBill', 'deleteStoredFiles', 'updateQuote'] as const) {
    mock_[k].mockResolvedValue(undefined);
  }
});

async function open(p: any, prices: any[], screen: 'project' | 'supplier' = 'project', supplierKey = 'reliabuilder') {
  mock_.getProject.mockResolvedValue(p);
  mock_.getProjectPrices.mockResolvedValue(new Map([['p1', prices]]));
  const r = render(screen === 'project'
    ? <ProjectScreen {...({ route: { params: { projectId: 'p1' } }, navigation: mock_nav } as any)} />
    : <SupplierScreen {...({ route: { params: { projectId: 'p1', supplierKey } }, navigation: mock_nav } as any)} />);
  await TestRenderer.act(async () => {});
  return r;
}

const allText = (r: any) => r.getAllByType('Text').map((n: any) => n.children.join('')).join(' | ');
const press = async (node: any) => {
  let n = node;
  while (n && !(n.props.onClick || n.props.onPress)) n = n.parent;
  await TestRenderer.act(async () => { (n.props.onClick ?? n.props.onPress)(); });
};
const byLabel = (r: any, label: string) =>
  r.root.findAll((n: any) => typeof n.type === 'string' && n.props.accessibilityLabel === label, { deep: true })[0];

describe('the project page, in progress', () => {
  const prices = [
    price({ id: 'c', kind: 'quote', status: 'accepted', amountIncl: 155480 }),
    price({ id: 'i1', amountIncl: 43987.5, unpaid: 0 }),
    price({ id: 'i2', amountIncl: 22913.75 }),
    price({ id: 'g', supplier: 'Gibson Architects', amountIncl: 2650.75, unpaid: 0 }),
  ];

  it('leads with the expected total, then budget, difference, paid and outstanding', async () => {
    const r = await open(project(), prices);
    const t = allText(r);
    expect(t).toContain('Expected total');
    expect(t).toContain('$158,130.75');
    expect(t).toContain('$41,869.25 under');
    expect(t).toContain('Outstanding');
  });

  it('gives each supplier a card: Total, Paid, Outstanding — or Total (paid) once settled', async () => {
    const r = await open(project(), prices);
    const rb = byLabel(r, 'ReliaBuilder');
    const rbText = rb.findAll((n: any) => n.type === 'Text', { deep: true }).map((n: any) => n.children.join(''));
    expect(rbText).toEqual(['ReliaBuilder', 'Total', '$66,901.25', 'Paid', '$43,987.50', 'Outstanding', '$22,913.75']);
    const gib = byLabel(r, 'Gibson Architects');
    const gibText = gib.findAll((n: any) => n.type === 'Text', { deep: true }).map((n: any) => n.children.join(''));
    expect(gibText).toEqual(['Gibson Architects', 'Total (paid)', '$2,650.75']);
  });

  it('opens a supplier on a press', async () => {
    const r = await open(project(), prices);
    await press(byLabel(r, 'Gibson Architects'));
    expect(mock_navigate).toHaveBeenCalledWith('ProjectSupplier', { projectId: 'p1', supplierKey: 'gibsonarchitects' });
  });

  it('survives the emailed-bills read failing', async () => {
    mock_.getPendingReviews.mockRejectedValue(new Error('offline'));
    const r = await open(project(), prices);
    expect(allText(r)).toContain('Expected total');
  });
});

describe('the project page, completed and planned', () => {
  it('a completed project says what it cost', async () => {
    const r = await open(project({ status: 'done' }), [price({ amountIncl: 3200, unpaid: 0 })]);
    const t = allText(r);
    expect(t).toContain('Cost');
    expect(t).toContain('$3,200');
    expect(t).not.toContain('Expected total');
  });

  it('a planned project lists its quotes, and accepting one starts it', async () => {
    const r = await open(project({ status: 'planned', startedOn: null, budget: 1000 }), [
      price({ id: 'q1', kind: 'quote', supplier: 'Tree Co', amountIncl: 850 }),
      price({ id: 'q2', kind: 'quote', supplier: 'Arborist', amountIncl: 1400 }),
    ]);
    expect(allText(r)).toContain('Supplier quotes');
    expect(allText(r)).toContain('2 quotes · $850–$1,400');
    await press(byLabel(r, 'Accept Tree Co quote'));
    expect(mock_.setQuoteStatus).toHaveBeenCalledWith('q1', 'accepted');
    expect(mock_.updateProject).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'underway' }));
    expect(mock_.setQuoteStatus.mock.invocationCallOrder[0]).toBeLessThan(mock_.updateProject.mock.invocationCallOrder[0]);
  });

  it('accepting on a project already underway leaves its status alone', async () => {
    const r = await open(project(), [price({ id: 'q1', kind: 'quote', amountIncl: 500 })], 'supplier');
    await press(r.getByText('Quotes · 1'));
    await press(byLabel(r, 'Accept this quote'));
    expect(mock_.setQuoteStatus).toHaveBeenCalledWith('q1', 'accepted');
    expect(mock_.updateProject).not.toHaveBeenCalled();
  });
});

describe("a supplier's page", () => {
  it('lists invoices, and pays one through payBill', async () => {
    const r = await open(project(), [
      price({ id: 'i2', invoiceNumber: 'INV-0219', amountIncl: 22913.75, dated: '2099-01-01' }),
    ], 'supplier');
    expect(allText(r)).toContain('INV-0219');
    await press(byLabel(r, 'INV-0219'));
    await press(byLabel(r, 'Mark as paid'));
    expect(mock_.payBill).toHaveBeenCalledWith('i2', 22913.75, expect.any(String));
  });

  it('shows no Quotes tab on a completed project', async () => {
    const r = await open(project({ status: 'done' }), [
      price({ amountIncl: 100, unpaid: 0 }), price({ kind: 'quote', amountIncl: 90 }),
    ], 'supplier');
    expect(allText(r)).not.toMatch(/Quotes ·/);
  });
});
