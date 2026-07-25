import { NextResponse } from 'next/server';
import { exportGovernanceReport } from '@snag/supabase-queries';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

// Invokes the export-governance-report edge function and redirects to the
// 1-hour signed URL it returns. No new export RPC — see SNAG_WEB_APP_PLAN.md §4.
//
// POST, not GET: this generates a PDF, writes it to the governance-reports
// bucket and inserts a governance_reports audit row. It used to be a GET linked
// with next/link, which prefetches links entering the viewport in production —
// so merely scrolling the Reports page could have fired an export
// (PRODUCT_REVIEW.md §6.3).
//
// The role gate is called explicitly: route handlers do NOT inherit
// (portal)/layout.tsx, so the layout's supervisor/admin check never covered
// this file. The edge function re-checks officer_admin itself, but relying on
// that alone left this sibling inconsistent with export-csv (§6.4).
export async function POST(request: Request) {
  const { activeMembership } = await requireSupervisorOrAdmin();
  if (activeMembership.role !== 'officer_admin') {
    return NextResponse.redirect(
      new URL('/reports?error=' + encodeURIComponent('Governance report export is available to officer admins.'), request.url),
      303
    );
  }

  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const periodStart = searchParams.get('start') ?? undefined;
  const periodEnd = searchParams.get('end') ?? undefined;

  const { signedUrl, error } = await exportGovernanceReport(supabase, periodStart, periodEnd);
  if (error || !signedUrl) {
    const message = error?.message ?? 'Could not generate the report.';
    return NextResponse.redirect(new URL('/reports?error=' + encodeURIComponent(message), request.url), 303);
  }

  // 303 so the browser follows with a GET — a default 307 would replay the POST
  // against the storage URL.
  return NextResponse.redirect(signedUrl, 303);
}
