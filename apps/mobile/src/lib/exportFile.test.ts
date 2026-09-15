import {
  exportFileName, snagExportTable, thingExportTable, toCsv,
} from '@snag/supabase-queries';
import { renderPdf } from './exportFile';

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

    // Worth knowing rather than worth hiding: REPEAT_PRESETS labels 182 days
    // "Every 6 months", but describeCycle only reaches months on a multiple of
    // 30, so 182 comes out in weeks. That mismatch is the app's, not the
    // extract's — the file says exactly what every other screen says.
    expect(snagExportTable([snag({ repeatDays: 182 })], META).rows[0][8]).toBe('26 weeks');
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
