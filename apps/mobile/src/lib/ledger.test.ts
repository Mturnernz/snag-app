import {
  describeDifference, describeQuoted, formatMoney, projectLedger, supplierKeyOf,
} from '@snag/supabase-queries';
import { quote } from '../test/projectFixtures';

const money = (n: number) => formatMoney(n) ?? '';
const inv = (over: any) => quote({ kind: 'invoice', amount: over.amount, unpaid: over.unpaid ?? over.amount, ...over });

describe('projectLedger', () => {
  it('reads two spellings of one business as one supplier, named by the newest', () => {
    const l = projectLedger([
      inv({ id: 'a', supplier: 'RELIABUILDER LIMITED', amount: 100, unpaid: 0, dated: '2026-04-01' }),
      inv({ id: 'b', supplier: 'ReliaBuilder', amount: 50, unpaid: 50, dated: '2026-09-01' }),
    ], null);
    expect(l.suppliers).toHaveLength(1);
    expect(l.suppliers[0].name).toBe('ReliaBuilder');
    expect(l.suppliers[0]).toMatchObject({ invoiced: 150, paid: 100, outstanding: 50 });
  });

  it('counts a bill inside another once, through the one that holds it', () => {
    const l = projectLedger([
      inv({ id: 'host', supplier: 'ReliaBuilder', amount: 1000, unpaid: 0 }),
      inv({ id: 'inner', supplier: 'Force Plumbing', amount: 300, unpaid: 300, billedThroughId: 'host' }),
    ], null);
    expect(l.invoiced).toBe(1000);
    expect(l.outstanding).toBe(0);
    const force = l.suppliers.find((s) => s.name === 'Force Plumbing');
    expect(force?.invoiced).toBe(0);
    expect(force?.invoices).toHaveLength(1);
  });

  it('counts nothing for a declined invoice', () => {
    const l = projectLedger([inv({ supplier: 'X', amount: 500, status: 'declined' })], null);
    expect(l.invoiced).toBe(0);
    expect(l.suppliers[0].invoices).toHaveLength(0);
  });

  it('expects whichever is more, the accepted quotes or the invoices', () => {
    const contract = quote({ id: 'c', supplier: 'ReliaBuilder', amount: 155480, status: 'accepted' });
    const claims = [1, 2, 3].map((n) => inv({ id: `i${n}`, supplier: 'ReliaBuilder', amount: 43987.5, unpaid: 0 }));
    const architect = inv({ id: 'g', supplier: 'Gibson', amount: 2650.75, unpaid: 0 });
    const l = projectLedger([contract, ...claims, architect], 200000);
    const rb = l.suppliers[0];
    expect(rb.invoiced).toBe(131962.5);
    expect(rb.expected).toBe(155480);
    expect(l.expected).toBe(155480 + 2650.75);
    expect(l.difference).toBe(200000 - 158130.75);
  });

  it('a tbc quote never counts towards expected', () => {
    const l = projectLedger([quote({ supplier: 'Tree Co', amount: 900 })], 1000);
    expect(l.expected).toBe(0);
    expect(l.difference).toBe(1000);
  });

  it('has no difference without a budget, and a negative one over it', () => {
    const over = [inv({ supplier: 'X', amount: 1200, unpaid: 0 })];
    expect(projectLedger(over, null).difference).toBeNull();
    expect(projectLedger(over, 1000).difference).toBe(-200);
    expect(describeDifference(-200, money)).toEqual({ text: '$200 over', over: true });
    expect(describeDifference(200, money).over).toBe(false);
  });

  it('reads a receipt as paid', () => {
    const l = projectLedger([quote({ kind: 'receipt', supplier: 'Bunnings', amount: 80 })], null);
    expect(l.suppliers[0]).toMatchObject({ invoiced: 80, paid: 80, outstanding: 0 });
  });

  it('gives the quoted range of quotes nobody turned down', () => {
    expect(projectLedger([], null).quotedRange).toBeNull();
    const one = projectLedger([quote({ amount: 850 })], null).quotedRange;
    expect(describeQuoted(one, money)).toBe('$850');
    const three = projectLedger([
      quote({ id: 'a', amount: 1400 }), quote({ id: 'b', amount: 850 }), quote({ id: 'c', amount: 1100 }),
      quote({ id: 'd', amount: 50, status: 'declined' }),
    ], null).quotedRange;
    expect(describeQuoted(three, money)).toBe('3 quotes · $850–$1,400');
  });

  it('keys a price naming nobody under none', () => {
    expect(supplierKeyOf(null)).toBe('none');
    expect(supplierKeyOf('Kitchen Mania Limited')).toBe(supplierKeyOf('kitchen mania'));
  });
});
