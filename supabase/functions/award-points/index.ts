import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// SLA thresholds in hours
const SLA_HOURS: Record<string, number> = {
  high: 24,
  medium: 72,
  low: 168,
};

async function awardPoints(
  userId: string,
  orgId: string,
  event: string,
  points: number,
  issueId?: string,
) {
  // Upsert total points
  await supabase.rpc('increment_user_points', {
    p_user_id: userId,
    p_org_id: orgId,
    p_points: points,
  });

  // Insert audit log
  await supabase.from('points_log').insert({
    user_id: userId,
    org_id: orgId,
    event,
    points,
    issue_id: issueId ?? null,
  });
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const { type, table, record, old_record } = payload;

    // ── Comment inserted → +2 to commenter ──────────────────────────────────
    if (table === 'comments' && type === 'INSERT') {
      const comment = record;
      // Get the issue to find org_id
      const { data: issue } = await supabase
        .from('issues')
        .select('organisation_id')
        .eq('id', comment.issue_id)
        .single();
      if (issue) {
        await awardPoints(comment.author_id, issue.organisation_id, 'comment_added', 2, comment.issue_id);
      }
    }

    // ── Issue inserted → +10 to reporter ────────────────────────────────────
    if (table === 'issues' && type === 'INSERT') {
      const issue = record;
      await awardPoints(issue.reporter_id, issue.organisation_id, 'issue_submitted', 10, issue.id);
    }

    // ── Issue updated ────────────────────────────────────────────────────────
    if (table === 'issues' && type === 'UPDATE') {
      const issue = record;
      const prev = old_record;

      // Status changed to resolved
      if (issue.status === 'resolved' && prev.status !== 'resolved') {
        // +5 to reporter
        await awardPoints(issue.reporter_id, issue.organisation_id, 'issue_resolved_reporter', 5, issue.id);

        // +20 to assignee (if any)
        if (issue.assignee_id) {
          await awardPoints(issue.assignee_id, issue.organisation_id, 'issue_resolved_assignee', 20, issue.id);
        }

        // SLA bonus: check if resolved within SLA threshold
        const slaHours = SLA_HOURS[issue.priority] ?? 72;
        const created = new Date(issue.created_at).getTime();
        const resolved = new Date(issue.updated_at).getTime();
        const hoursElapsed = (resolved - created) / (1000 * 60 * 60);
        if (hoursElapsed <= slaHours) {
          const beneficiary = issue.assignee_id ?? issue.reporter_id;
          await awardPoints(beneficiary, issue.organisation_id, 'sla_bonus', 15, issue.id);
        }
      }

      // Issue reached 5+ upvotes → +10 to reporter
      const prevUpvotes = prev.upvote_count ?? 0;
      const newUpvotes = issue.upvote_count ?? 0;
      if (newUpvotes >= 5 && prevUpvotes < 5) {
        await awardPoints(issue.reporter_id, issue.organisation_id, 'issue_popular', 10, issue.id);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
