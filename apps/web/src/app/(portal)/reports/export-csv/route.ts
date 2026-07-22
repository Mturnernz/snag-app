import { NextResponse } from 'next/server';
import { recordGovernanceExport } from '@snag/supabase-queries';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const CSV_COLUMNS = [
  'reference', 'status', 'kind', 'lane', 'severity', 'site_name', 'reporter_name', 'owner_name',
  'description', 'created_at', 'resolved_at', 'resolution_note', 'is_notifiable',
  'is_public_submission', 'checklist_completed_count', 'evidence_count',
  'open_corrective_action_count', 'comment_count',
] as const;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// Raw-data export (SNAG_WEB_APP_PLAN.md §4, gap 2) — snags_with_details is
// wide enough to flatten client-side into one row per snag, so no new view
// or RPC was needed, just this CSV builder. Same generate-upload-record
// pattern as the PDF exports, minus the edge function (nothing to render).
export async function GET(request: Request) {
  const { activeMembership } = await requireSupervisorOrAdmin();
  if (activeMembership.role !== 'officer_admin') {
    return NextResponse.redirect(new URL('/reports?error=' + encodeURIComponent('CSV export is available to officer admins.'), request.url));
  }

  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const now = new Date();
  const periodEnd = searchParams.get('end') ?? now.toISOString().slice(0, 10);
  const periodStart = searchParams.get('start') ?? new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: snags, error: queryError } = await supabase
    .from('snags_with_details')
    .select(CSV_COLUMNS.join(', '))
    .eq('org_id', activeMembership.org_id)
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd + 'T23:59:59')
    .order('created_at', { ascending: false });

  if (queryError) {
    return NextResponse.redirect(new URL('/reports?error=' + encodeURIComponent(queryError.message), request.url));
  }

  const rows = [
    CSV_COLUMNS.join(','),
    ...(snags ?? []).map((row: any) => CSV_COLUMNS.map((col) => csvEscape(row[col])).join(',')),
  ];
  const csv = rows.join('\n');

  const path = `${activeMembership.org_id}/${Date.now()}-snags-export.csv`;
  const { error: uploadError } = await supabase.storage
    .from('governance-reports')
    .upload(path, new Blob([csv], { type: 'text/csv' }), { contentType: 'text/csv', upsert: false });

  if (uploadError) {
    return NextResponse.redirect(new URL('/reports?error=' + encodeURIComponent(`Upload failed: ${uploadError.message}`), request.url));
  }

  const { error: recordError } = await recordGovernanceExport(supabase, path, periodStart, periodEnd);
  if (recordError) {
    return NextResponse.redirect(new URL('/reports?error=' + encodeURIComponent(recordError.message), request.url));
  }

  const { data: signedUrlData, error: signError } = await supabase.storage
    .from('governance-reports')
    .createSignedUrl(path, 60 * 60);

  if (signError || !signedUrlData) {
    return NextResponse.redirect(new URL('/reports?error=' + encodeURIComponent('Export saved but the download link could not be created.'), request.url));
  }

  return NextResponse.redirect(signedUrlData.signedUrl);
}
