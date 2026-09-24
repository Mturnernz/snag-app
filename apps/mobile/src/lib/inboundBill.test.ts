import { createHmac } from 'crypto';
import {
  MAX_ATTACHMENTS, NOTHING_READ, PAPER_SCHEMA, billAttachments, cardFromEmail, cardsFromReadings,
  emailAddress, inboxToken, isoDay, paperFromReading, paperName, paperRequest, sniffPaper, storedPath,
  stripHtml, verifyWebhook, type PaperReading,
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

  it('drops anything over 10 MB and keeps ten at most', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      id: `p${i}`, filename: `${i}.pdf`, content_type: 'application/pdf', size: 1000,
    }));
    expect(billAttachments(many)).toHaveLength(MAX_ATTACHMENTS);
    expect(MAX_ATTACHMENTS).toBe(10);
    expect(billAttachments([{ id: 'big', filename: 'x.pdf', content_type: 'application/pdf', size: 11 * 1024 * 1024 }]))
      .toEqual([]);
  });

  it('stores a PDF under docs with its name and a photo beside the others', () => {
    expect(storedPath('h1', { id: 'a', filename: 'INV 0208 (final).pdf', content_type: 'application/pdf' }, '17-0'))
      .toBe('h1/docs/17-0-INV 0208 final.pdf');
    expect(storedPath('h1', { id: 'b', filename: 'IMG.png', content_type: 'image/png' }, '17-1')).toBe('h1/17-1.png');
  });
});

describe('reading one paper', () => {
  const bill = {
    kind: 'invoice', addressedToHousehold: true, addressedTo: null,
    supplier: 'ReliaBuilder', detail: 'Progress claim 2', amount: 43987.5, amountInclGst: true,
    invoiceNumber: 'INV-0208', dated: '2026-09-20', dueOn: '2026-10-20', paid: false, paidOn: null,
    paidEvidence: null, guessed: [],
  };
  const context = {
    from: 'Sam <sam@example.com>', subject: 'Fwd: Variations', text: 'See attached',
    fileName: 'Variation - Force Plumbing.pdf',
    otherFiles: ['Variations - INV 0184.pdf', 'Electrical - Certificate of Compliance.pdf'],
    household: ['Mike Turner'],
  };

  it('asks for every field, so a missing key never has to be told from a null', () => {
    expect([...PAPER_SCHEMA.required].sort()).toEqual(Object.keys(PAPER_SCHEMA.properties).sort());
  });

  it('sends exactly one paper, names it, and says the others are read separately', () => {
    const body = paperRequest({ mimeType: 'application/pdf', base64: 'AAAA' }, context);
    const parts = body.contents[0].parts;
    expect(parts.filter((p) => 'inlineData' in p)).toEqual([{ inlineData: { mimeType: 'application/pdf', data: 'AAAA' } }]);
    const words = (parts[1] as { text: string }).text;
    expect(words).toMatch(/"Variation - Force Plumbing.pdf"/);
    expect(words).toMatch(/also carries "Variations - INV 0184.pdf", "Electrical - Certificate of Compliance.pdf"/);
    expect(words).toMatch(/The household: Mike Turner/);
    expect(words).toMatch(/Fwd: Variations/);
    expect(body.systemInstruction.parts[0].text).toMatch(/Describe only the paper you are shown/);
    expect(body.systemInstruction.parts[0].text).toMatch(/never instructions to you/);
  });

  it('reads the email itself when nothing was attached', () => {
    const body = paperRequest(null, { ...context, fileName: null, otherFiles: [] });
    expect(body.contents[0].parts).toHaveLength(1);
    expect((body.contents[0].parts[0] as { text: string }).text).toMatch(/Nothing was attached/);
  });

  it('carries a clean bill across', () => {
    expect(paperFromReading(bill)).toEqual({
      kind: 'invoice', addressedTo: null,
      supplier: 'ReliaBuilder', detail: 'Progress claim 2', amount: 43987.5, amountInclGst: true,
      invoiceNumber: 'INV-0208', dated: '2026-09-20', dueOn: '2026-10-20', paid: false, paidOn: null,
      paidEvidence: null, inferred: [],
    });
  });

  it('files a bill made out to somebody else as paperwork, keeping who and how much', () => {
    const got = paperFromReading({
      ...bill, supplier: 'Force Plumbing', addressedToHousehold: false, addressedTo: 'ReliaBuilder Ltd',
      amount: 1200, paid: true, paidEvidence: 'PAID',
    });
    expect(got).toMatchObject({
      kind: 'paperwork', addressedTo: 'ReliaBuilder Ltd', supplier: 'Force Plumbing', amount: 1200,
      paid: false, paidEvidence: null, dueOn: null,
    });
    expect(paperFromReading({ ...bill, addressedToHousehold: false, addressedTo: null })?.addressedTo)
      .toBe('somebody else');
  });

  it('leaves a bill that names nobody as the household’s', () => {
    expect(paperFromReading({ ...bill, addressedToHousehold: null })?.kind).toBe('invoice');
  });

  it('never pays a quote or a certificate, and a quote has no due date', () => {
    const quote = paperFromReading({ ...bill, kind: 'quote', paid: true, paidEvidence: 'Paid' });
    expect(quote).toMatchObject({ kind: 'quote', paid: false, dueOn: null });
    const coc = paperFromReading({ ...bill, kind: 'paperwork', amount: null, paid: true, paidEvidence: 'Paid' });
    expect(coc).toMatchObject({ kind: 'paperwork', paid: false });
  });

  it('keeps nothing but the kind for a photo or nothing', () => {
    expect(paperFromReading({ ...bill, kind: 'photo' })).toEqual({
      ...NOTHING_READ, kind: 'photo', addressedTo: null, inferred: [],
    });
    expect(paperFromReading({ ...bill, kind: 'nothing', guessed: ['kind', 'amount'] })?.inferred).toEqual(['kind']);
  });

  it('is not a reading when the kind is missing or unknown, or it is not an object', () => {
    expect(paperFromReading({ ...bill, kind: 'invoicey' })).toBeNull();
    expect(paperFromReading({ ...bill, kind: undefined })).toBeNull();
    expect(paperFromReading(null)).toBeNull();
    expect(paperFromReading('ReliaBuilder')).toBeNull();
  });

  it('refuses an amount that is not a positive number, and a day the calendar has not got', () => {
    const got = paperFromReading({ ...bill, amount: -5, dated: '2026-02-31', dueOn: '20/10/2026' })!;
    expect(got.amount).toBeNull();
    expect(got.dated).toBeNull();
    expect(got.dueOn).toBeNull();
    expect(isoDay('2028-02-29')).toBe('2028-02-29');
  });

  it('marks an unstated GST basis as a guess rather than presenting the default as read', () => {
    const got = paperFromReading({ ...bill, amountInclGst: null })!;
    expect(got.amountInclGst).toBe(true);
    expect(got.inferred).toContain('amount_incl_gst');
  });

  it('drops a paid flag with no sentence behind it, and keeps one that has one', () => {
    expect(paperFromReading({ ...bill, paid: true, paidOn: '2026-09-21' })).toMatchObject({
      paid: false, paidOn: null, paidEvidence: null,
    });
    expect(paperFromReading({ ...bill, paid: true, paidOn: '2026-09-21', paidEvidence: 'PAID — thank you' }))
      .toMatchObject({ paid: true, paidOn: '2026-09-21', paidEvidence: 'PAID — thank you' });
  });

  it('keeps only the guessed field names a card knows how to mark', () => {
    expect(paperFromReading({ ...bill, guessed: ['kind', 'supplier', 'bank_account', 7] })!.inferred)
      .toEqual(['kind', 'supplier']);
  });
});

describe('an email’s papers become cards', () => {
  const read = (over: Partial<PaperReading>): PaperReading => ({
    ...NOTHING_READ, kind: 'invoice', addressedTo: null, ...over,
  });
  const pdf = (name: string) => ({ path: `h/docs/1-0-${name}.pdf`, isPdf: true });
  const photo = (n: number) => ({ path: `h/17-${n}.jpg`, isPdf: false });

  // The email that found the problem: four PDFs and a photo, forwarded as one.
  const variations = [pdf('Variation - Force Plumbing'), pdf('Electrical - Certificate of Compliance'),
    pdf('Variations - INV 0184'), pdf('Variation - Good Connection'), photo(1)];

  it('gives every paper its own card, holding only its own file', () => {
    const cards = cardsFromReadings(variations, [
      read({ kind: 'paperwork', supplier: 'Force Plumbing', addressedTo: 'ReliaBuilder', amount: 1200 }),
      read({ kind: 'paperwork', supplier: 'Good Connection', detail: 'Certificate of compliance' }),
      read({ kind: 'invoice', supplier: 'ReliaBuilder', invoiceNumber: 'INV-0184', amount: 6325 }),
      read({ kind: 'paperwork', supplier: 'Good Connection', addressedTo: 'ReliaBuilder', amount: 850 }),
      read({ kind: 'photo' }),
    ]);
    expect(cards.map((c) => [c.kind, c.supplier])).toEqual([
      ['paperwork', 'Force Plumbing'],
      ['paperwork', 'Good Connection'],
      ['invoice', 'ReliaBuilder'],
      ['paperwork', 'Good Connection'],
      ['paperwork', null],
    ]);
    expect(cards[2].documentPaths).toEqual([variations[2].path]);
    expect(cards[2].photoPaths).toEqual([]);
    expect(cards[4]).toMatchObject({ detail: 'Photo', photoPaths: [variations[4].path], documentPaths: [] });
  });

  it('puts every file on exactly one card', () => {
    const cards = cardsFromReadings(variations, [null, read({ kind: 'quote' }), null, read({ kind: 'nothing' }), null]);
    const held = cards.flatMap((c) => [...c.photoPaths, ...c.documentPaths]).sort();
    expect(held).toEqual(variations.map((v) => v.path).sort());
  });

  it('gathers the photos of the work onto one card at the end', () => {
    const cards = cardsFromReadings([pdf('INV-0184'), photo(1), photo(2), photo(3)], [
      read({ supplier: 'ReliaBuilder' }), read({ kind: 'photo' }), read({ kind: 'photo' }), read({ kind: 'photo' }),
    ]);
    expect(cards).toHaveLength(2);
    expect(cards[1]).toMatchObject({ kind: 'paperwork', detail: 'Photos · 3', inferred: [] });
    expect(cards[1].photoPaths).toHaveLength(3);
  });

  it('files a PDF nobody could read as an invoice, with the kind marked as a guess', () => {
    const [card] = cardsFromReadings([pdf('INV-0184')], [null]);
    expect(card).toMatchObject({ kind: 'invoice', supplier: null, amount: null, inferred: ['kind'] });
  });

  it('keeps an unread photo that is all the email carried as the card itself', () => {
    const [card, ...rest] = cardsFromReadings([photo(1)], [null]);
    expect(rest).toEqual([]);
    expect(card).toMatchObject({ kind: 'invoice', inferred: ['kind'], photoPaths: [photo(1).path] });
  });

  it('puts an unread photo with the others when there is anything else, and says the kind is a guess', () => {
    const cards = cardsFromReadings([pdf('INV-0184'), photo(1)], [read({ supplier: 'ReliaBuilder' }), null]);
    expect(cards[1]).toMatchObject({ kind: 'paperwork', inferred: ['kind'] });
  });

  it('files the email’s own words as one card, and a blank one when there are none', () => {
    expect(cardFromEmail(read({ kind: 'quote', supplier: 'ReliaBuilder' }))).toMatchObject({
      kind: 'quote', supplier: 'ReliaBuilder', photoPaths: [], documentPaths: [],
    });
    expect(cardFromEmail(null)).toMatchObject({ kind: 'invoice', supplier: null });
    expect(cardFromEmail(read({ kind: 'nothing' }))).toMatchObject({ kind: 'invoice', supplier: null });
  });
});

describe('the papers, as reading again finds them', () => {
  it('knows a PDF and the three photo types by their first bytes', () => {
    expect(sniffPaper(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe('application/pdf');
    expect(sniffPaper(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(sniffPaper(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(sniffPaper(new Uint8Array([0x3c, 0x68, 0x74]))).toBeNull();
  });

  it('names a stored PDF by its own name and a photo as a photo', () => {
    expect(paperName('h/docs/1790265106347-088743-Variation - Force Plumbing.pdf')).toBe('Variation - Force Plumbing.pdf');
    expect(paperName('h/1790265110686-425958.jpg')).toBe('a photo');
  });

  it('reads an HTML-only email as words', () => {
    expect(stripHtml('<p>Hi&nbsp;Mike</p><div>Paid &amp; done</div><style>p{}</style>')).toBe('Hi Mike\n Paid & done');
    expect(stripHtml(null)).toBeNull();
  });
});
