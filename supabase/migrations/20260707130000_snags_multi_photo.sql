-- Support up to 5 photos per snag. photo_path (singular) is kept as the
-- "cover" photo for backward compatibility with every existing reader
-- (IssueCard thumbnails, snags_with_details consumers); photo_paths is the
-- full ordered list, populated alongside it going forward.

alter table public.snags add column photo_paths text[] not null default '{}';

update public.snags
  set photo_paths = array[photo_path]
  where photo_path is not null and photo_paths = '{}';

drop function public.create_snag(public.snag_kind, text, public.snag_severity, text, double precision, double precision, uuid);

create function public.create_snag(
  p_kind public.snag_kind,
  p_description text default null,
  p_severity public.snag_severity default null,
  p_photo_paths text[] default '{}',
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_site_id uuid default null
)
returns table (id uuid, reference text)
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_site_id uuid := p_site_id;
  v_snag_id uuid;
  v_photo_paths text[] := coalesce(p_photo_paths, '{}');
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;

  if v_site_id is null then
    select site_id into v_site_id from public.site_members where user_id = auth.uid() limit 1;
  end if;
  if v_site_id is null then
    raise exception 'You are not assigned to a site yet';
  end if;
  if not exists (select 1 from public.sites where id = v_site_id and org_id = v_org_id) then
    raise exception 'That site does not belong to your organisation';
  end if;
  if array_length(v_photo_paths, 1) > 5 then
    raise exception 'A maximum of 5 photos are allowed';
  end if;

  insert into public.snags (
    org_id, site_id, reporter_id, kind, severity, description, photo_path, photo_paths, latitude, longitude
  ) values (
    v_org_id, v_site_id, auth.uid(), p_kind, p_severity, p_description,
    v_photo_paths[1], v_photo_paths, p_latitude, p_longitude
  ) returning public.snags.id into v_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', v_snag_id, 'created', auth.uid());

  return query select v_snag_id, s.reference from public.snags s where s.id = v_snag_id;
end;
$$;

grant execute on function public.create_snag(
  public.snag_kind, text, public.snag_severity, text[], double precision, double precision, uuid
) to authenticated;

create or replace view public.snags_with_details as
 select s.id,
    s.reference,
    s.org_id,
    s.site_id,
    s.reporter_id,
    s.kind,
    s.lane,
    s.severity,
    s.description,
    s.photo_path,
    s.occurred_at,
    s.latitude,
    s.longitude,
    s.status,
    s.created_at,
    s.owner_id,
    s.assigned_at,
    s.resolution_note,
    s.retained_until,
    s.is_notifiable,
    s.resolved_by,
    s.resolved_at,
    s.confirmed_by,
    s.confirmed_at,
    s.escalated_by,
    s.escalated_at,
    s.approver_id,
    reporter.name as reporter_name,
    reporter.email as reporter_email,
    owner.name as owner_name,
    site.name as site_name,
    coalesce(cc.completed_count, 0::bigint) as checklist_completed_count,
    coalesce(ev.evidence_count, 0::bigint) as evidence_count,
    coalesce(ca.open_count, 0::bigint) as open_corrective_action_count,
    coalesce(cm.comment_count, 0::bigint) as comment_count,
    coalesce(v.vote_score, 0::bigint) as vote_score,
    coalesce(v.upvote_count, 0::bigint) as upvote_count,
    coalesce(v.downvote_count, 0::bigint) as downvote_count,
    s.photo_paths
   from (((((((( public.snags s
     left join public.profiles reporter on reporter.id = s.reporter_id)
     left join public.profiles owner on owner.id = s.owner_id)
     left join public.sites site on site.id = s.site_id)
     left join ( select checklist_completions.snag_id,
            count(*) as completed_count
           from public.checklist_completions
          group by checklist_completions.snag_id) cc on cc.snag_id = s.id)
     left join ( select evidence_items.snag_id,
            count(*) as evidence_count
           from public.evidence_items
          group by evidence_items.snag_id) ev on ev.snag_id = s.id)
     left join ( select corrective_actions.snag_id,
            count(*) as open_count
           from public.corrective_actions
          where corrective_actions.status = 'open'::public.corrective_action_status
          group by corrective_actions.snag_id) ca on ca.snag_id = s.id)
     left join ( select comments.snag_id,
            count(*) as comment_count
           from public.comments
          group by comments.snag_id) cm on cm.snag_id = s.id)
     left join ( select votes.snag_id,
            sum(votes.value) as vote_score,
            count(*) filter (where votes.value = 1) as upvote_count,
            count(*) filter (where votes.value = '-1'::integer) as downvote_count
           from public.votes
          group by votes.snag_id) v on v.snag_id = s.id);
