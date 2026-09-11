-- Two corrections to 20260911090000, plus the photo bucket.
--
-- 1. `home.is_member` has to be EXECUTE-able by `authenticated`.
--
--    A row-level security policy expression is evaluated as the *calling* role,
--    so a policy that calls a function the caller cannot execute fails with
--    `42501: permission denied for function is_member` — not with zero rows.
--    Every read policy in the schema calls it, so revoking it turned the whole
--    schema off. Verified by running a select under `set role authenticated`
--    before any client code was written.
--
--    The other three helpers stay revoked and are the reason to keep the
--    distinction rather than granting them all: they are only ever called from
--    inside SECURITY DEFINER functions, where calls run as the function owner
--    and the caller's EXECUTE is never consulted.
--
-- 2. The comments policy is rewritten to reach the snag directly instead of
--    going through `home.snag_household`, which is what forced that helper into
--    a policy in the first place.

grant execute on function home.is_member(uuid) to authenticated;

drop policy "members read their comments" on home.comments;

create policy "members read their comments"
  on home.comments for select using (
    exists (
      select 1 from home.snags s
      where s.id = home.comments.snag_id
        and home.is_member(s.household_id)
    )
  );

-- ---------------------------------------------------------------- storage
--
-- A new bucket rather than the retired product's `snag-photos`, whose policies
-- are written against `public.org_memberships`. Same reasoning as the schema:
-- leave the old one intact as part of the archive.
--
-- Layout is `<household_id>/<file>`, which is what the folder check below
-- assumes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'home-photos',
  'home-photos',
  false,
  15728640,  -- 15 MB; a modern phone photo is 3-6 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

-- SECURITY DEFINER, and it does its own shape check before casting: a folder
-- name that isn't a uuid would otherwise raise 22P02 out of a policy, which
-- surfaces to the client as a failed upload with a Postgres parse error rather
-- than a refusal.
create function home.can_use_photo_folder(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := (storage.foldername(p_object_name))[1];
begin
  if v_folder is null or v_folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return home.is_member(v_folder::uuid);
end;
$$;

grant execute on function home.can_use_photo_folder(text) to authenticated;

create policy "household members read their photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'home-photos' and home.can_use_photo_folder(name));

create policy "household members upload their photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'home-photos' and home.can_use_photo_folder(name));

create policy "household members replace their photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'home-photos' and home.can_use_photo_folder(name))
  with check (bucket_id = 'home-photos' and home.can_use_photo_folder(name));

create policy "household members delete their photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'home-photos' and home.can_use_photo_folder(name));
