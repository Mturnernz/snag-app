-- A note can be corrected or taken back by the person who wrote it.
--
-- Until now a note was permanent: a typo, a wrong price, or a note left on the
-- wrong job stayed for ever. The October 2026 function review counted 12 notes
-- on 8 jobs and listed this among the missing basics.
--
-- Three rules:
--
--   * **Only the author.** Two people share a list, and each says their own
--     piece. Editing the other person's words would be putting words in their
--     mouth, so both functions refuse anybody else in words.
--   * **An edit is said.** `edited_at` is set on every change and the job page
--     shows "edited" beside the time, so a note that changed after the other
--     person read it does not pass for what they read.
--   * **Neither one starts the job.** `add_comment` moves an open job to
--     'doing', because writing a note is dealing with it. Correcting one is
--     not new work, and taking one back is the opposite of it, so these touch
--     neither the snag's status nor its `updated_at`.
--
-- The client reads `edited_at` by name, and falls back to the old column list
-- if this has not been applied, so applying it is not urgent; but apply it
-- before merging all the same.

alter table home.comments add column edited_at timestamptz;

create function home.update_comment(p_comment_id uuid, p_body text)
returns home.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment home.comments;
  v_body text := btrim(coalesce(p_body, ''));
begin
  select * into v_comment from home.comments where id = p_comment_id;
  if v_comment.id is null then
    raise exception 'That note has gone';
  end if;

  perform home.require_property_member(home.snag_property(v_comment.snag_id));

  if v_comment.author_id is distinct from auth.uid() then
    raise exception 'Only the person who wrote a note can change it';
  end if;
  if v_body = '' then
    raise exception 'A note needs some words. Delete it instead';
  end if;
  if length(v_body) > 4000 then
    raise exception 'That note is too long';
  end if;

  if v_body = v_comment.body then
    return v_comment;
  end if;

  update home.comments
  set body = v_body, edited_at = now()
  where id = p_comment_id
  returning * into v_comment;

  return v_comment;
end;
$$;

create function home.delete_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment home.comments;
begin
  select * into v_comment from home.comments where id = p_comment_id;
  if v_comment.id is null then
    -- Already gone, from the other phone or a second press: nothing to say.
    return;
  end if;

  perform home.require_property_member(home.snag_property(v_comment.snag_id));

  if v_comment.author_id is distinct from auth.uid() then
    raise exception 'Only the person who wrote a note can delete it';
  end if;

  delete from home.comments where id = p_comment_id;
end;
$$;

revoke execute on function home.update_comment(uuid, text) from public, anon;
grant execute on function home.update_comment(uuid, text) to authenticated;
revoke execute on function home.delete_comment(uuid) from public, anon;
grant execute on function home.delete_comment(uuid) to authenticated;

notify pgrst, 'reload schema';
