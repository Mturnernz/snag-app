import { supabase } from './supabase';

// Client half of the worksheet round-trip: download a fillable PDF, and
// send a completed one back. The import stores the PDF as evidence and
// returns whatever typed fields it could read — nothing is written to
// RCA/debrief tables until the user saves through the normal forms.

export async function downloadWorksheet(snagId: string, kind: 'rca' | 'debrief'): Promise<void> {
  const { data, error } = await supabase.functions.invoke('worksheet', {
    body: { snag_id: snagId, kind },
  });
  if (error) throw error;
  const { filename, pdfBase64 } = data as { filename: string; pdfBase64: string };
  const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface WorksheetImportResult {
  evidence_id: string;
  parsed: Record<string, string>;
}

export async function importWorksheet(
  snagId: string,
  kind: 'rca' | 'debrief',
  file: File
): Promise<WorksheetImportResult> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const { data, error } = await supabase.functions.invoke('worksheet-import', {
    body: { snag_id: snagId, kind, pdf_base64: btoa(binary) },
  });
  if (error) throw error;
  return data as WorksheetImportResult;
}
