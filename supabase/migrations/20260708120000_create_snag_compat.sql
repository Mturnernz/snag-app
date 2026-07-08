-- Restore the pre-multi-photo create_snag signature as a compatibility
-- wrapper. 20260707130000_snags_multi_photo.sql dropped it in favour of the
-- p_photo_paths text[] version, which broke report submission on app builds
-- still calling p_photo_path (text) — "Could not find the function
-- public.create_snag(...) in the schema cache". PostgREST disambiguates the
-- overload by the named parameter, which every client build always sends.

create function public.create_snag(
  p_kind public.snag_kind,
  p_description text default null,
  p_severity public.snag_severity default null,
  p_photo_path text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_site_id uuid default null
)
returns table (id uuid, reference text)
language sql security definer set search_path = public as $$
  select * from public.create_snag(
    p_kind,
    p_description,
    p_severity,
    case when p_photo_path is null then '{}'::text[] else array[p_photo_path] end,
    p_latitude,
    p_longitude,
    p_site_id
  );
$$;

grant execute on function public.create_snag(
  public.snag_kind, text, public.snag_severity, text, double precision, double precision, uuid
) to authenticated;
