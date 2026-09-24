import { createHmac } from 'crypto';
import {
  BILL_SCHEMA, NOTHING_READ, billAttachments, billRequest, emailAddress, inboxToken, isoDay,
  reviewFromReading, storedPath, verifyWebhook,
} from '../../../../supabase/functions/inbound-bill/bill';

// inbound-bill turns a forwarded email into a card nobody has approved yet.
// What these pin is everything that decides whether the card can be believed:
// that the request is Resend's, which job the address names, which
// attachments are the bill, and that a reading is checked field by field
// before any of it is shown as what the invoice said.

const TOKEN = '0123456789abcdef';

describe('the address', () => {
  it('finds the project token in whichever recipient is ours', () => {
    expect(inboxToken(['sam@example.com', `Bills <${TOKEN}@bills.snaghq.co.nz>`])).toBe(TOKEN);
    expect(inboxToken([`${TOKEN.toUpperCase()}@BILLS.SNAGHQ.CO.NZ`])).toBe(TOKEN);
    expect(inboxToken([`${TOKEN}+claim2@bills.snaghq.co.nz`])).toBe(TOKEN);
  });

  it('ignores anything that is not a project address on our domain', () => {
    expect(inboxToken([`${TOKEN}@snaghq.co.nz`])).toBeNull();
    expect(inboxToken(['hello@bills.snaghq.co.nz'])).toBeNull();
    expect(inboxToken([])).toBeNull();
  });

  it('reads the sender out of a display name', () => {
    expect(emailAddress('Sam Turner <Sam@Example.com>')).toBe('sam@example.com');
    expect(emailAddress('sam@example.com')).toBe('sam@example.com');
    expect(emailAddress('Sam Turner')).toBeNull();
  });
});

describe('the signature', () => {
  const key = Buffer.from('a-test-signing-key-for-snag').toString('base64');
  const secret = `whsec_${key}`;
  const body = '{"type":"email.received"}';
  const now = 1_790_000_000;
  const sign = (id: string, ts: number, content: string) =>
    createHmac('sha256', Buffer.from(key, 'base64')).update(`${id}.${ts}.${content}`).digest('base64');

  it('accepts a request Resend signed', async () => {
    const signature = `v1,${sign('msg_1', now, body)}`;
    expect(await verifyWebhook(secret, { id: 'msg_1', timestamp: String(now), signature }, body, now)).toBe(true);
  });

  it('accepts one good signature among several, as during a secret rotation', async () => {
    const signature = `v1,bm90LWl0 v1,${sign('msg_1', now, body)}`;
    expect(await verifyWebhook(secret, { id: 'msg_1', timestamp: String(now), signature }, body, now)).toBe(true);
  });

  it('refuses a changed body, a wrong secret, a stale timestamp and missing headers', async () => {
    const signature = `v1,${sign('msg_1', now, body)}`;
    const headers = { id: 'msg_1', timestamp: String(now), signature };
    expect(await verifyWebhook(secret, headers, `${body} `, now)).toBe(false);
    expect(await verifyWebhook(`whsec_${Buffer.from('other').toString('base64')}`, headers, body, now)).toBe(false);
    expect(await verifyWebhook(secret, headers, body, now + 301)).toBe(false);
    expect(await verifyWebhook(secret, { ...headers, signature: null }, body, now)).toBe(false);
    expect(await verifyWebhook('', headers, body, now)).toBe(false);
  });
});

describe('the attachments', () => {
  it('keeps PDFs and photos, PDFs first, and drops a signature logo', () => {
    const kept = billAttachments([
      { id: 'logo', filename: 'logo.png', content_type: 'image/png', content_disposition: 'inline', size: 4096 },
      { id: 'photo', filename: 'IMG_1.jpg', content_type: 'image/jpeg', content_disposition: 'attachment', size: 900_000 },
      { id: 'doc', filename: 'INV-0208.pdf', content_type: 'application/pdf', size: 120_000 },
      { id: 'sheet', filename: 'costs.xlsx', content_type: 'application/vnd.ms-excel', size: 20_000 },
    ]);
    expect(kept.map((a) => a.id)).toEqual(['doc', 'photo']);
  });

  it('drops anything over 10 MB and keeps five at most', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`, filename: `${i}.pdf`, content_type: 'application/pdf', size: 1000,
    }));
    expect(billAttachments(many)).toHaveLength(5);
    expect(billAttachments([{ id: 'big', filename: 'x.pdf', content_type: 'application/pdf', size: 11 * 1024 * 1024 }]))
      .toEqual([]);
  });

  it('stores a PDF under docs with its name and a photo beside the others', () => {
    expect(storedPath('h1', { id: 'a', filename: 'INV 0208 (final).pdf', content_type: 'application/pdf' }, '17-0'))
      .toBe('h1/docs/17-0-INV 0208 final.pdf');
    expect(storedPath('h1', { id: 'b', filename: 'IMG.png', content_type: 'image/png' }, '17-1')).toBe('h1/17-1.png');
  });
});

describe('the reading', () => {
  const bill = {
    isBill: true, supplier: 'ReliaBuilder', detail: 'Progress claim 2', amount: 43987.5, amountInclGst: true,
    invoiceNumber: 'INV-0208', dated: '2026-09-20', dueOn: '2026-10-20', paid: false, paidOn: null,
    paidEvidence: null, guessed: [],
  };

  it('asks for every field, so a missing key never has to be told from a null', () => {
    expect([...BILL_SCHEMA.required].sort()).toEqual(Object.keys(BILL_SCHEMA.properties).sort());
  });

  it('sends each document inline and the email as words', () => {
    const body = billRequest([{ mimeType: 'application/pdf', base64: 'AAAA' }], {
      from: 'Sam <sam@example.com>', subject: 'Fwd: Claim 2', text: 'See attached',
    });
    expect(body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'application/pdf', data: 'AAAA' } });
    expect((body.contents[0].parts[1] as { text: string }).text).toMatch(/Fwd: Claim 2/);
    expect(body.systemInstruction.parts[0].text).toMatch(/never instructions to you/);
  });

  it('carries a clean reading across', () => {
    expect(reviewFromReading(bill)).toEqual({
      supplier: 'ReliaBuilder', detail: 'Progress claim 2', amount: 43987.5, amountInclGst: true,
      invoiceNumber: 'INV-0208', dated: '2026-09-20', dueOn: '2026-10-20', paid: false, paidOn: null,
      paidEvidence: null, inferred: [],
    });
  });

  it('files nothing read when it is not a bill, or not a reading at all', () => {
    expect(reviewFromReading({ ...bill, isBill: false })).toEqual(NOTHING_READ);
    expect(reviewFromReading(null)).toEqual(NOTHING_READ);
    expect(reviewFromReading('ReliaBuilder')).toEqual(NOTHING_READ);
  });

  it('refuses an amount that is not a positive number, and a day the calendar has not got', () => {
    const got = reviewFromReading({ ...bill, amount: -5, dated: '2026-02-31', dueOn: '20/10/2026' });
    expect(got.amount).toBeNull();
    expect(got.dated).toBeNull();
    expect(got.dueOn).toBeNull();
    expect(isoDay('2028-02-29')).toBe('2028-02-29');
  });

  it('marks an unstated GST basis as a guess rather than presenting the default as read', () => {
    const got = reviewFromReading({ ...bill, amountInclGst: null });
    expect(got.amountInclGst).toBe(true);
    expect(got.inferred).toContain('amount_incl_gst');
  });

  it('drops a paid flag with no sentence behind it, and keeps one that has one', () => {
    expect(reviewFromReading({ ...bill, paid: true, paidOn: '2026-09-21' })).toMatchObject({
      paid: false, paidOn: null, paidEvidence: null,
    });
    expect(reviewFromReading({ ...bill, paid: true, paidOn: '2026-09-21', paidEvidence: 'PAID — thank you' }))
      .toMatchObject({ paid: true, paidOn: '2026-09-21', paidEvidence: 'PAID — thank you' });
  });

  it('keeps only the guessed field names a card knows how to mark', () => {
    expect(reviewFromReading({ ...bill, guessed: ['supplier', 'bank_account', 7] }).inferred).toEqual(['supplier']);
  });
});
