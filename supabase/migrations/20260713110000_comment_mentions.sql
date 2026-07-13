-- comment_mentions: records who was @mentioned in a comment, so a user can
-- see comments that tag them instead of having to read every thread. The
-- app resolves @mentions client-side (autocomplete already picks a real org
-- member), so add_comment takes the resolved user IDs directly rather than
-- re-parsing display names server-side.
create table public.comment_mentions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles(id) on delete cascade,
  snag_id uuid not null references public.snags(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  unique (comment_id, mentioned_user_id)
);

create index comment_mentions_mentioned_user_id_idx on public.comment_mentions (mentioned_user_id, seen_at);
create index comment_mentions_snag_id_idx on public.comment_mentions (snag_id);

alter table public.comment_mentions enable row level security;

create policy "users can view their own mentions"
  on public.comment_mentions for select
  using (mentioned_user_id = (select auth.uid()));

grant select on public.comment_mentions to authenticated;

-- add_comment gains an optional mentioned-user-ids array. Self-mentions and
-- IDs that aren't active members of the snag's org are silently dropped
-- rather than erroring, so a stray "@" doesn't block sending the comment.
drop function if exists public.add_comment(uuid, text);

create function public.add_comment(p_snag_id uuid, p_body text, p_mentioned_user_ids uuid[] default '{}')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_comment_id uuid;
  v_org_id uuid;
  v_uid uuid;
begin
  if p_body is null or btrim(p_body) = '' then
    raise exception 'Comment cannot be empty';
  end if;
  if length(p_body) > 2000 then
    raise exception 'Comment is too long';
  end if;

  select s.org_id into v_org_id from public.snags s where s.id = p_snag_id and s.org_id = current_org_id();
  if v_org_id is null then
    raise exception 'snag not found';
  end if;

  insert into public.comments (snag_id, author_id, body)
  values (p_snag_id, auth.uid(), p_body)
  returning id into v_comment_id;

  if p_mentioned_user_ids is not null then
    foreach v_uid in array p_mentioned_user_ids loop
      if v_uid is distinct from auth.uid() and exists (
        select 1 from public.org_memberships m
        where m.user_id = v_uid and m.org_id = v_org_id and m.removed_at is null
      ) then
        insert into public.comment_mentions (comment_id, mentioned_user_id, snag_id, org_id)
        values (v_comment_id, v_uid, p_snag_id, v_org_id)
        on conflict (comment_id, mentioned_user_id) do nothing;
      end if;
    end loop;
  end if;

  return v_comment_id;
end;
$$;

grant execute on function public.add_comment(uuid, text, uuid[]) to authenticated;

-- Mentions inbox: fetch my mentions in the active org (joined to comment/snag
-- context) and mark them seen once viewed.
create function public.get_my_mentions()
returns table(
  mention_id uuid,
  comment_id uuid,
  comment_body text,
  comment_created_at timestamptz,
  snag_id uuid,
  snag_reference text,
  author_id uuid,
  author_name text,
  seen_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    cm.id, c.id, c.body, c.created_at,
    s.id, s.reference,
    c.author_id, p.name,
    cm.seen_at
  from public.comment_mentions cm
  join public.comments c on c.id = cm.comment_id
  join public.snags s on s.id = cm.snag_id
  join public.profiles p on p.id = c.author_id
  where cm.mentioned_user_id = auth.uid()
    and cm.org_id = public.current_org_id()
  order by c.created_at desc;
$$;

grant execute on function public.get_my_mentions() to authenticated;

create function public.get_unseen_mention_count()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.comment_mentions
  where mentioned_user_id = auth.uid()
    and org_id = public.current_org_id()
    and seen_at is null;
$$;

grant execute on function public.get_unseen_mention_count() to authenticated;

create function public.mark_all_mentions_seen()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.comment_mentions
    set seen_at = now()
    where mentioned_user_id = auth.uid()
      and org_id = public.current_org_id()
      and seen_at is null;
end;
$$;

grant execute on function public.mark_all_mentions_seen() to authenticated;
