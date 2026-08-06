-- Retiring a site: archive for one that has history, delete for one that never did.
--
-- The reason this is two verbs rather than one is `snags.site_id on delete
-- cascade` meeting golden rule #4, which is a harder wall than it first looks:
--
--   sites → snags → comments, votes, evidence_items, witness_statements,
--                   checklist_completions, investigations, investigation_files,
--                   corrective_actions, snag_rca, snag_debriefs, snag_views
--
-- The cascade does *not* quietly destroy that. `block_snag_delete_within_
-- retention` is a BEFORE DELETE trigger on snags that raises unconditionally —
-- despite the name there is no date test in it, and MVP-SPEC golden rule #4
-- says so outright: "the delete block is unconditional beyond even that".
-- So deleting a site with any snag on it aborts the whole transaction.
--
-- That makes a hard delete of a used site impossible rather than merely
-- inadvisable, and it is why `delete_site` counts snags itself instead of
-- letting the cascade decide. Without the count, an admin deleting a site gets
-- "Snags can never be deleted — see CLAUDE.md golden rule #4" thrown at them
-- by a trigger about a table they did not mention, and no idea what to do
-- next. With it they get the number and the alternative. At the time of
-- writing one site in Snagv1 ("Hendo") carries 42 snags.
--
-- Hence:
--   * delete_site  — only a site with no snags. That is the real-world case the
--                    request came from: a typo, a duplicate, a site created by
--                    the old work-group sheet with nothing on it.
--   * archive_site — everything else, and the only route for a used site. It
--                    stops appearing anywhere a new report could be aimed at
--                    it, and every record it carries stays exactly where it is.

alter table public.sites add column if not exists archived_at timestamptz;

comment on column public.sites.archived_at is
  'Set when a site is retired. Archived sites keep every snag but are hidden from '
  'report pickers, work-group scoping and public intake. Null = active.';

-- Partial index: every read path filters `archived_at is null`, and archived
-- sites are the rare row.
create index if not exists sites_active_idx on public.sites (org_id) where archived_at is null;

-- ── No new reports at an archived site ──────────────────────────────────────
-- A trigger rather than a check inside create_snag, because there are three
-- insert paths (two create_snag overloads and create_public_snag) that each
-- validate the site separately, and a fourth would be written eventually. The
-- trigger covers the table, so the rule cannot be forgotten by a new caller.
--
-- Note this is BEFORE INSERT only: archiving a site must not stop anyone
-- updating, resolving or investigating a snag already filed there.
create or replace function public.refuse_snag_at_archived_site()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.site_id is not null and exists (
    select 1 from public.sites
     where id = new.site_id and archived_at is not null
  ) then
    raise exception 'That site has been archived and is not accepting new reports';
  end if;
  return new;
end;
$$;

drop trigger if exists refuse_snag_at_archived_site on public.snags;
create trigger refuse_snag_at_archived_site
  before insert on public.snags
  for each row execute function public.refuse_snag_at_archived_site();

-- ── Archive / restore ───────────────────────────────────────────────────────
create or replace function public.archive_site(p_site_id uuid, p_archived boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_remaining int;
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can archive a site';
  end if;
  if not exists (select 1 from public.sites where id = p_site_id and org_id = v_org_id) then
    raise exception 'Site not found';
  end if;

  if p_archived then
    -- An org with no active site cannot receive a report at all:
    -- getReportableSites falls back to every site in the org, which would be
    -- an empty list, and the report form has nothing to submit against.
    select count(*) into v_remaining
      from public.sites
     where org_id = v_org_id and archived_at is null and id <> p_site_id;
    if v_remaining = 0 then
      raise exception 'This is the only active site — add another before archiving this one';
    end if;

    update public.sites
       set archived_at = now(),
           -- A closed site's printed QR codes should stop working. Restoring
           -- deliberately does not revive them: a site coming back into use
           -- gets a fresh code rather than silently re-enabling posters that
           -- have been on a wall through the closure.
           public_report_token = null
     where id = p_site_id and org_id = v_org_id;

    -- Org-wide public intake cannot point at an archived site.
    update public.organisations
       set public_intake_site_id = null,
           is_public = false
     where id = v_org_id and public_intake_site_id = p_site_id;
  else
    update public.sites set archived_at = null where id = p_site_id and org_id = v_org_id;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'site', p_site_id,
            case when p_archived then 'archived' else 'restored' end, auth.uid());
end;
$$;

revoke execute on function public.archive_site(uuid, boolean) from public, anon;
grant execute on function public.archive_site(uuid, boolean) to authenticated;

-- ── Delete, for a site that carries nothing ─────────────────────────────────
create or replace function public.delete_site(p_site_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snags int;
  v_remaining int;
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can delete a site';
  end if;
  if not exists (select 1 from public.sites where id = p_site_id and org_id = v_org_id) then
    raise exception 'Site not found';
  end if;

  -- The whole point. The cascade would hit block_snag_delete_within_retention
  -- and abort with a message about snags, to somebody who asked to delete a
  -- site. Count first so the refusal names the number and the alternative.
  select count(*) into v_snags from public.snags where site_id = p_site_id;
  if v_snags > 0 then
    raise exception
      'This site has % report(s) on it. Archive it instead — deleting would erase them and every investigation on them.',
      v_snags;
  end if;

  select count(*) into v_remaining
    from public.sites
   where org_id = v_org_id and archived_at is null and id <> p_site_id;
  if v_remaining = 0 then
    raise exception 'This is the only active site — rename it rather than deleting it';
  end if;

  -- organisations.public_intake_site_id is ON DELETE NO ACTION, so a site
  -- wired up as the org's public intake would fail the delete with a raw FK
  -- error naming a constraint. Clear it first and say what happened.
  update public.organisations
     set public_intake_site_id = null,
         is_public = false
   where id = v_org_id and public_intake_site_id = p_site_id;

  -- site_members / site_supervisors / site_default_owners / work_group_sites
  -- are all ON DELETE CASCADE, and with no snags that is exactly right: they
  -- describe the site rather than being records of their own.
  delete from public.sites where id = p_site_id and org_id = v_org_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'site', p_site_id, 'deleted', auth.uid());
end;
$$;

revoke execute on function public.delete_site(uuid) from public, anon;
grant execute on function public.delete_site(uuid) to authenticated;

-- The trigger function is internal — nobody calls it over the API. Revoking
-- EXECUTE does not stop the trigger firing; the privilege is checked when the
-- trigger is created. See 20260805100000_relock_internal_functions.sql.
revoke execute on function public.refuse_snag_at_archived_site() from public, anon, authenticated;
