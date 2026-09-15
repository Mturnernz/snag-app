import {
  ExportTable, ExportPhoto, toCsv, exportDateStamp, exportFileName,
} from '@snag/supabase-queries';
import { saveFile, type SavedFile } from './download';

/**
 * The two renderers over one table, so a CSV and a PDF of the same extract can
 * never disagree about what is in it.
 *
 * `jspdf` is imported at module scope deliberately. `"output": "single"` in
 * app.json means Metro emits one web bundle with no lazy chunks, so a dynamic
 * import would be inlined anyway — and the deployed CSP is `default-src 'self'`
 * with no CDN, so there is nowhere to fetch it from at export time either. It
 * ships in the bundle or the feature does not exist. That cost was weighed:
 * see CLAUDE.md, "Taking a list out of the app".
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export type ExportFormat = 'csv' | 'pdf';

export async function writeExport(
  table: ExportTable,
  format: ExportFormat,
  images: ExportImage[] = [],
): Promise<SavedFile & { fileName: string }> {
  // Stamped with the local day, so two extracts of the same list don't land in
  // a downloads folder as "(1)" and "(2)" with nothing to tell them apart.
  const fileName = exportFileName(table.name, exportDateStamp(), format);
  if (format === 'csv') {
    const saved = await saveFile(fileName, toCsv(table), 'text/csv;charset=utf-8');
    return { ...saved, fileName };
  }
  const saved = await saveFile(fileName, renderPdf(table, images), 'application/pdf');
  return { ...saved, fileName };
}

/** A photograph, fetched and ready for jsPDF. */
export interface ExportImage {
  caption: string;
  detail: string;
  bytes: Uint8Array;
  kind: 'JPEG' | 'PNG';
}

/** JPEG starts FF D8 FF; PNG starts with the eight-byte signature. */
function imageKind(bytes: Uint8Array): ExportImage['kind'] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'PNG';
  return null;
}

/**
 * Fetch the chosen photographs so `renderPdf` can lay them out.
 *
 * **Bytes, not an `<Image>`.** jsPDF can take a DOM image element, but this
 * code runs on phones as well as in a browser and a DOM element is not
 * available on one of them — and reading the pixels back off a canvas would
 * need `img-src`/`connect-src` to agree about a `blob:` the CSP has no rule
 * for. A signed URL fetched as an array buffer is the one path both platforms
 * and the deployed policy already allow, because it is the same request every
 * thumbnail on the list already makes.
 *
 * **A photograph that will not come is left out, never thrown.** A signed URL
 * can expire, a key can be orphaned, and somebody waiting on a file at a desk
 * wants the twelve pictures that did arrive rather than an error naming one
 * that did not. Anything that is not a JPEG or a PNG is dropped for the same
 * reason: jsPDF would raise on it mid-document.
 */
export async function loadExportImages(
  photos: ExportPhoto[],
  signPaths: (paths: string[]) => Promise<Record<string, string>>,
): Promise<ExportImage[]> {
  if (photos.length === 0) return [];
  const urls = await signPaths(photos.map((photo) => photo.path));

  const fetched = await Promise.all(photos.map(async (photo): Promise<ExportImage | null> => {
    const url = urls[photo.path];
    if (!url) return null;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const kind = imageKind(bytes);
      return kind ? { caption: photo.caption, detail: photo.detail, bytes, kind } : null;
    } catch {
      return null;
    }
  }));

  return fetched.filter((image): image is ExportImage => image !== null);
}

/**
 * Landscape, because these tables are wide and a portrait page turns fifteen
 * columns into fifteen unreadable ones.
 *
 * Only the standard 14 fonts are used, so nothing is embedded and nothing is
 * fetched — a font file would be a network request the CSP has no rule for.
 */
export function renderPdf(table: ExportTable, images: ExportImage[] = []): Uint8Array {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  doc.setFontSize(16);
  doc.text(table.name, 40, 44);
  doc.setFontSize(10);
  doc.setTextColor(105, 97, 86);
  doc.text(table.subtitle, 40, 60);
  doc.setTextColor(0, 0, 0);

  autoTable(doc, {
    head: [table.columns],
    body: table.rows.length > 0 ? table.rows : [table.columns.map(() => '')],
    startY: 76,
    styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
    // Fern and plaster, the same two the app is built from.
    headStyles: { fillColor: [46, 106, 79], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 247, 242] },
    margin: { left: 40, right: 40, bottom: 40 },
    // A page number, because an extract of a real house runs to several and a
    // loose sheet with no number is a sheet you cannot put back in order.
    didDrawPage: (data: any) => {
      const page = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(105, 97, 86);
      doc.text(
        `${table.name} · page ${data.pageNumber} of ${page}`,
        data.settings.margin.left,
        doc.internal.pageSize.getHeight() - 20,
      );
    },
  });

  drawPhotoPages(doc, table, images);

  return new Uint8Array(doc.output('arraybuffer'));
}

const INK: [number, number, number] = [43, 39, 36];
const MUTED: [number, number, number] = [105, 97, 86];
const SUNKEN: [number, number, number] = [244, 239, 231];

/**
 * The photographs, after the table, three across and two down.
 *
 * **They are in the PDF and never in the CSV**, which is not an omission: a
 * spreadsheet cell cannot hold a picture, and the CSV's job is to be sorted and
 * filtered. The PDF's job is to be sent to somebody — a builder, a landlord, an
 * insurer — and for that reader the photograph is most of the evidence. It is
 * why `snagExportTable` bothers to carry a photo *count* at all.
 *
 * Every picture is captioned with the same headline the list shows and the
 * reference beside it, because a page of uncaptioned photographs of six
 * different rooms is the part of a report nobody can act on.
 *
 * The box is letterboxed rather than cropped. A crop would take the middle of
 * a photograph somebody framed deliberately — and the whole reason a snag has
 * no title is that the framing is the description.
 */
function drawPhotoPages(doc: jsPDF, table: ExportTable, images: ExportImage[]): void {
  if (images.length === 0) return;

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const gutter = 16;
  const columns = 3;
  const rows = 2;

  const headerH = 34;
  const captionH = 26;
  const cellW = (pageW - margin * 2 - gutter * (columns - 1)) / columns;
  const cellH = (pageH - margin * 2 - headerH - gutter * (rows - 1) - 20) / rows;
  const boxH = cellH - captionH;
  const perPage = columns * rows;

  images.forEach((image, i) => {
    const slot = i % perPage;
    if (slot === 0) {
      doc.addPage();
      doc.setFontSize(12);
      doc.setTextColor(...INK);
      doc.text(
        images.length === 1 ? 'Photo' : `Photos (${images.length})`,
        margin,
        margin + 8,
      );
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(table.subtitle, margin, margin + 22);
      doc.text(
        `${table.name} · photos`,
        margin,
        pageH - 20,
      );
    }

    const x = margin + (slot % columns) * (cellW + gutter);
    const y = margin + headerH + Math.floor(slot / columns) * (cellH + gutter);

    doc.setFillColor(...SUNKEN);
    doc.rect(x, y, cellW, boxH, 'F');

    // Letterboxed inside the well, never cropped: the framing is the
    // description on a snag with no title.
    try {
      const props = doc.getImageProperties(image.bytes);
      const fit = Math.min(cellW / props.width, boxH / props.height);
      const w = props.width * fit;
      const h = props.height * fit;
      doc.addImage(
        image.bytes, image.kind,
        x + (cellW - w) / 2, y + (boxH - h) / 2,
        w, h,
      );
    } catch {
      // A photograph jsPDF cannot read leaves its well empty rather than
      // taking the document down at the last step of a slow export.
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text("Couldn't be read", x + 8, y + boxH / 2);
    }

    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(fitText(doc, image.caption, cellW), x, y + boxH + 13);
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(fitText(doc, image.detail, cellW), x, y + boxH + 23);
  });
}

/** One line, cut with an ellipsis rather than spilling into the next cell. */
function fitText(doc: jsPDF, text: string, width: number): string {
  if (!text) return '';
  if (doc.getTextWidth(text) <= width) return text;
  let cut = text;
  while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}
