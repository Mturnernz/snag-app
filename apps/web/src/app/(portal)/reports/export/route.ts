import { NextResponse } from 'next/server';
import { exportGovernanceReport } from '@snag/supabase-queries';
import { createClient } from '@/lib/supabase/server';

// Mirrors apps/mobile's exportGovernanceReport usage: invokes the existing
// export-governance-report edge function (which re-checks officer_admin
// itself) and redirects to the 1-hour signed URL it returns. No new export
// RPC — see SNAG_WEB_APP_PLAN.md §4.
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { searchParams } = new URL(request.url);
  const periodStart = searchParams.get('start') ?? undefined;
  const periodEnd = searchParams.get('end') ?? undefined;

  const { signedUrl, error } = await exportGovernanceReport(supabase, periodStart, periodEnd);
  if (error || !signedUrl) {
    const message = error?.message ?? 'Could not generate the report.';
    return NextResponse.redirect(new URL('/reports?error=' + encodeURIComponent(message), request.url));
  }

  return NextResponse.redirect(signedUrl);
}
