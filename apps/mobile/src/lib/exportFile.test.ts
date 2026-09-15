import {
  EXPORT_PHOTO_LIMIT, exportFileName, snagExportPhotos, snagExportTable,
  thingExportPhotos, thingExportTable, toCsv,
} from '@snag/supabase-queries';
import { loadExportImages, renderPdf, type ExportImage } from './exportFile';

// An extract is read at a desk, months later, by somebody deciding something —
// what to buy, what to claim, what a tradesperson needs to know. So the things
// worth pinning are the ones that make a file quietly wrong rather than
// obviously broken:
//
//   - a value containing a comma, a quote or a newline, which a snag's
//     description can hold all three of and which is the usual way a CSV
//     arrives looking corrupt,
//   - the BOM, without which Excel guesses a code page and turns a résumé into
//     rÃ©sumÃ©,
//   - a photo-only snag, which has no words of its own and would otherwise be a
//     blank row,
//   - and that a real PDF actually comes out, rather than a stub we called.

const snag = (over: Partial<any> = {}): any => ({
  id: 's1', reference: 'SNAG-0007', householdId: 'h', propertyId: 'p',
  room: 'Kitchen', photoPaths: [], description: 'Gutters', priority: 'low',
  status: 'open', parts: [], needsParts: false, dueAt: null, repeatDays: null,
  assigneeId: null, thingId: null, reporterId: 'me',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  lastDoneAt: null, doneAt: null, propertyName: 'Home', reporterName: 'Mike',
  assigneeName: null, commentCount: 0, thingName: null, thingMake: null, thingModel: null,
  ...over,
});

const thing = (over: Partial<any> = {}): any => ({
  id: 't1', householdId: 'h', propertyId: 'p', kind: 'appliance',
  name: 'Heat pump', room: 'Living room', photoPaths: [], make: 'Mitsubishi',
  model: 'MSZ-AP50VGK', serial: null, consumables: [], documentPaths: [],
  installedAt: null, warrantyUntil: null, serviceDays: null, spec: {}, notes: null,
  createdBy: 'me', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  propertyName: 'Home', snagCount: 0, openSnagCount: 0,
  ...over,
});

const META = { household: '32 Le Roy', place: 'Home', scope: 'Everything', stamp: '2026-09-15' };

describe('the CSV', () => {
  it('survives a comma, a quote and a newline in one description', () => {
    const table = snagExportTable(
      [snag({ description: 'Gutters, "north" side\nand the downpipe' })],
      META,
    );
    const csv = toCsv(table, { bom: false });
    const body = csv.split('\r\n')[1];

    // Quoted, with the inner quote doubled — the row is one row, not three.
    expect(body).toContain('"Gutters, ""north"" side\nand the downpipe"');
    // Header + one body row, and the newline inside the value did not split it.
    expect(csv.trimEnd().split('\r\n').filter((l) => l.startsWith('"SNAG'))).toHaveLength(1);
  });

  // Without this Excel guesses a code page, and every macron in a NZ address
  // comes back mangled. It looks like corruption and isn't.
  it('starts with a BOM so Excel reads it as UTF-8', () => {
    expect(toCsv(snagExportTable([snag()], META))).toMatch(/^﻿/);
  });

  it('ends every line CRLF, which is what Excel on Windows still wants', () => {
    const csv = toCsv(snagExportTable([snag()], META), { bom: false });
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).not.toMatch(/[^\r]\n[^"]/);
  });
});

describe('what a row says', () => {
  // A photo-only snag has no words of its own, and a spreadsheet cannot show
  // the photo — so the headline the list uses has to carry into the file, or
  // the row is blank where it matters most.
  it('gives a photo-only snag the headline the list gives it', () => {
    const table = snagExportTable(
      [snag({ description: null, photoPaths: ['h/one.jpg'] })],
      META,
    );
    expect(table.rows[0][1]).not.toBe('');
    expect(table.rows[0][14]).toBe('1');
  });

  it('writes a repeat in the words the app uses, not a number of days', () => {
    expect(snagExportTable([snag({ repeatDays: 90 })], META).rows[0][8]).toBe('3 months');
    expect(snagExportTable([snag({ repeatDays: 365 })], META).rows[0][8]).toBe('year');

    // Six months, from either the repeat chips or the service sheet — the two
    // used to disagree about what number that was. See cycles.test.ts.
    expect(snagExportTable([snag({ repeatDays: 180 })], META).rows[0][8]).toBe('6 months');

    // The fallback is still there for a hand-set interval: create_snag takes
    // any 1..3650, and an extract should say what the row holds rather than
    // round it into a lie.
    expect(snagExportTable([snag({ repeatDays: 45 })], META).rows[0][8]).toBe('45 days');
  });

  it('names the house, the place, the scope and the day at the top', () => {
    const table = snagExportTable([snag()], META);
    expect(table.name).toBe('32 Le Roy list');
    expect(table.subtitle).toBe('Home · Everything · 2026-09-15');
  });

  it('files a thing with no room under Whole house, as the tab does', () => {
    const table = thingExportTable([thing({ room: null })], META);
    expect(table.rows[0][0]).toBe('Whole house');
  });

  it('carries the model number, which is what somebody came for', () => {
    const table = thingExportTable([thing()], META);
    expect(table.rows[0]).toContain('MSZ-AP50VGK');
  });
});

describe('the file name', () => {
  it('is a name a file system will accept', () => {
    expect(exportFileName('32 Le Roy list', '2026-09-15', 'csv'))
      .toBe('32-le-roy-list-2026-09-15.csv');
  });

  it('never comes out empty, whatever the house is called', () => {
    expect(exportFileName('///', '2026-09-15', 'pdf')).toBe('snag-2026-09-15.pdf');
  });
});

describe('the PDF', () => {
  // A real one, from the real library. A mocked jsPDF would assert only that we
  // called a mock — and the thing that actually breaks here is the library
  // failing to run at all, which is exactly what a mock hides.
  it('is a real PDF, not a stub', () => {
    const bytes = renderPdf(snagExportTable([snag(), snag({ id: 's2' })], META));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1000);
    // Every PDF starts %PDF- and ends %%EOF.
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe('%PDF-');
    expect(String.fromCharCode(...bytes.subarray(-6)).trim()).toBe('%%EOF');
  });

  // An empty extract is a real answer — the sheet says so and blocks it, but
  // the renderer must not be the thing that explodes if it ever gets through.
  it('survives having no rows at all', () => {
    const bytes = renderPdf(thingExportTable([], META));
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe('%PDF-');
  });
});

// A 1x1 PNG. Real bytes, because the thing that breaks when photos are added to
// a PDF is the library refusing to read them — which a fake would hide exactly
// the way a mocked jsPDF would.
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
));

const image = (over: Partial<ExportImage> = {}): ExportImage => ({
  caption: 'Gutters', detail: 'SNAG-0007 · Roof', bytes: PNG, kind: 'PNG', ...over,
});

describe('which photos go in', () => {
  // Row order would let one snag somebody photographed from five angles spend a
  // quarter of the allowance, and an extract of fourteen jobs would come back
  // showing four of them.
  it('pictures every row once before it pictures any row twice', () => {
    const chosen = snagExportPhotos([
      snag({ id: 'a', photoPaths: ['a1', 'a2', 'a3'] }),
      snag({ id: 'b', photoPaths: ['b1'] }),
      snag({ id: 'c', photoPaths: ['c1', 'c2'] }),
    ]);
    expect(chosen.map((p) => p.path)).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'a3']);
  });

  it('stops at the cap', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      snag({ id: `s${i}`, photoPaths: [`p${i}`] }));
    expect(snagExportPhotos(many)).toHaveLength(EXPORT_PHOTO_LIMIT);
    expect(snagExportPhotos(many, 4)).toHaveLength(4);
  });

  it('says what each picture is, since a page of uncaptioned photos answers nothing', () => {
    const [first] = snagExportPhotos([snag({ photoPaths: ['h/one.jpg'] })]);
    expect(first.caption).toBe('Gutters');
    expect(first.detail).toBe('SNAG-0007 · Kitchen');
  });

  it('captions a thing with its room and the number somebody came for', () => {
    const [first] = thingExportPhotos([thing({ photoPaths: ['h/plate.jpg'] })]);
    expect(first.caption).toContain('Heat pump');
    expect(first.detail).toContain('Living room');
    expect(first.detail).toContain('MSZ-AP50VGK');
  });

  it('is empty when nothing has been photographed', () => {
    expect(snagExportPhotos([snag()])).toEqual([]);
  });
});

describe('fetching them', () => {
  const signed = (map: Record<string, string>) => async () => map;

  afterEach(() => { (global as any).fetch = undefined; });

  // A signed URL expires and a key can be orphaned. Somebody waiting on a file
  // at a desk wants the pictures that did arrive, not an error naming one that
  // didn't.
  it('drops a photo that will not come rather than failing the export', async () => {
    (global as any).fetch = jest.fn(async (url: string) =>
      (url.includes('good')
        ? { ok: true, arrayBuffer: async () => PNG.buffer }
        : { ok: false }));

    const images = await loadExportImages(
      [
        { path: 'a', caption: 'One', detail: '' },
        { path: 'b', caption: 'Two', detail: '' },
        { path: 'c', caption: 'Three', detail: '' },
      ],
      signed({ a: 'https://good', b: 'https://gone' }),
    );

    // 'c' was never signed at all, 'b' answered 404, 'a' came back.
    expect(images.map((i) => i.caption)).toEqual(['One']);
  });

  // jsPDF raises on anything it cannot identify, and it would do it after the
  // whole table had been laid out.
  it('drops bytes that are not a JPEG or a PNG', async () => {
    (global as any).fetch = jest.fn(async () => ({
      ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
    }));
    const images = await loadExportImages(
      [{ path: 'a', caption: 'One', detail: '' }],
      signed({ a: 'https://whatever' }),
    );
    expect(images).toEqual([]);
  });

  it('asks for nothing when there is nothing to ask for', async () => {
    const sign = jest.fn();
    expect(await loadExportImages([], sign as any)).toEqual([]);
    expect(sign).not.toHaveBeenCalled();
  });
});

describe('the photos in the PDF', () => {
  it('adds pages for them, and none when there are none', () => {
    const table = snagExportTable([snag()], META);
    const without = renderPdf(table);
    const with20 = renderPdf(table, Array.from({ length: 20 }, () => image()));

    expect(with20.length).toBeGreaterThan(without.length);
    expect(String.fromCharCode(...with20.subarray(0, 5))).toBe('%PDF-');
    expect(String.fromCharCode(...with20.subarray(-6)).trim()).toBe('%%EOF');
  });

  // Six to a page, so twenty is four extra pages on top of the table's own.
  it('lays them out six to a page', () => {
    const table = snagExportTable([snag()], META);
    const pages = (n: number) =>
      countPages(renderPdf(table, Array.from({ length: n }, () => image())));

    const base = countPages(renderPdf(table));
    expect(pages(1)).toBe(base + 1);
    expect(pages(6)).toBe(base + 1);
    expect(pages(7)).toBe(base + 2);
    expect(pages(20)).toBe(base + 4);
  });

  // A photograph jsPDF cannot read must leave its well empty rather than take
  // the document down at the last step of a slow export.
  it('survives one that cannot be decoded', () => {
    const broken = image({ bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), kind: 'JPEG' });
    const bytes = renderPdf(snagExportTable([snag()], META), [broken, image()]);
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe('%PDF-');
  });
});

/** Counts the page objects in a rendered PDF. */
function countPages(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString('latin1');
  return (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}
