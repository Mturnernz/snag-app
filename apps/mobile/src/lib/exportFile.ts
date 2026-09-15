import { ExportTable, toCsv, exportDateStamp, exportFileName } from '@snag/supabase-queries';
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
): Promise<SavedFile & { fileName: string }> {
  // Stamped with the local day, so two extracts of the same list don't land in
  // a downloads folder as "(1)" and "(2)" with nothing to tell them apart.
  const fileName = exportFileName(table.name, exportDateStamp(), format);
  if (format === 'csv') {
    const saved = await saveFile(fileName, toCsv(table), 'text/csv;charset=utf-8');
    return { ...saved, fileName };
  }
  const saved = await saveFile(fileName, renderPdf(table), 'application/pdf');
  return { ...saved, fileName };
}

/**
 * Landscape, because these tables are wide and a portrait page turns fifteen
 * columns into fifteen unreadable ones.
 *
 * Only the standard 14 fonts are used, so nothing is embedded and nothing is
 * fetched — a font file would be a network request the CSP has no rule for.
 */
export function renderPdf(table: ExportTable): Uint8Array {
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

  return new Uint8Array(doc.output('arraybuffer'));
}
