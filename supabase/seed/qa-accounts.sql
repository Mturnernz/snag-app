-- QA test accounts for the E2E suite (see TESTING.md).
--
-- Creates an isolated "SNAG QA" organisation with an officer_admin and a worker.
-- RLS scopes every query by org_id, so this org is invisible to real orgs — which
-- is what makes write-path tests safe to run against the live project. Nothing
-- here touches an existing organisation.
--
-- Idempotent: re-running skips whatever already exists.
--
-- Applied via the Supabase MCP (`execute_sql`) or the SQL Editor. Passwords are
-- deliberately NOT in this file — set them below before running, and put the same
-- values in apps/web/.env.local as E2E_PASSWORD / E2E_WORKER_PASSWORD.
--
-- Why this is raw SQL rather than auth.signUp(): creating a user through the
-- normal flow needs network access to the project's auth endpoint, which isn't
-- always available (a sandboxed agent session, a locked-down CI runner). The auth
-- rows below mirror the exact shape GoTrue creates for an email/password user —
-- aud/role/instance_id, `$2a$` bcrypt, matching raw_user_meta_data.sub, and a
-- companion auth.identities row. All public-schema work goes through the app's
-- own RPCs so profiles, memberships, sites, and audit rows are created normally.

\set qa_admin_email  'CHANGE-ME+qa.admin@example.com'
\set qa_admin_pw     'CHANGE-ME-admin-password'
\set qa_worker_email 'CHANGE-ME+qa.worker@example.com'
\set qa_worker_pw    'CHANGE-ME-worker-password'

begin;

-- 1. Auth users. `confirmed_at` is a generated column and must be omitted.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(), 'authenticated', 'authenticated',
  v.email,
  extensions.crypt(v.password, extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('email', v.email, 'email_verified', true, 'phone_verified', false),
  '', '', '', '',
  false, false
from (values
  (:'qa_admin_email',  :'qa_admin_pw'),
  (:'qa_worker_email', :'qa_worker_pw')
) as v(email, password)
where not exists (select 1 from auth.users u where u.email = v.email);

-- 2. raw_user_meta_data.sub must equal the user id. Separate statement: a
--    data-modifying CTE cannot see rows inserted by a sibling CTE.
update auth.users u
set raw_user_meta_data = u.raw_user_meta_data || jsonb_build_object('sub', u.id::text)
where u.email in (:'qa_admin_email', :'qa_worker_email')
  and coalesce(u.raw_user_meta_data->>'sub', '') <> u.id::text;

-- 3. Companion identity rows — GoTrue expects one per provider.
insert into auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at)
select gen_random_uuid(), u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
       'email', u.id::text, now(), now()
from auth.users u
where u.email in (:'qa_admin_email', :'qa_worker_email')
  and not exists (
    select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
  );

-- 4. Org, profiles, membership and site rows — all through the app's own RPCs,
--    driven by the JWT claims auth.uid()/auth.email() read. set_config(..., true)
--    keeps the claims transaction-local.
--
--    psql \set variables are substituted by the client and are not visible inside
--    a plpgsql block, so hand them over as run-time settings first.
select set_config('qa.admin_email',  :'qa_admin_email',  true),
       set_config('qa.worker_email', :'qa_worker_email', true);

do $$
declare
  v_admin_id  uuid;
  v_worker_id uuid;
  v_admin_email  text := current_setting('qa.admin_email', true);
  v_worker_email text := current_setting('qa.worker_email', true);
  v_invite_id uuid;
  v_token     uuid;
begin
  select id into v_admin_id  from auth.users where email = v_admin_email;
  select id into v_worker_id from auth.users where email = v_worker_email;

  if exists (select 1 from public.organisations where name = 'SNAG QA') then
    raise notice 'SNAG QA already exists — skipping org creation';
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_id::text, 'email', v_admin_email, 'role', 'authenticated')::text, true);
  perform public.create_organisation_and_owner('SNAG QA', 'QA Admin');

  v_invite_id := public.invite_user(v_worker_email, 'worker'::public.user_role, null);
  select token into v_token from public.invites where id = v_invite_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_worker_id::text, 'email', v_worker_email, 'role', 'authenticated')::text, true);
  perform public.accept_invite(v_token, 'QA Worker');
end $$;

commit;

-- 5. Verify: both accounts exist, hash round-trips, identity present, roles right.
select u.email,
       u.raw_user_meta_data->>'sub' = u.id::text as sub_ok,
       (select count(*) from auth.identities i where i.user_id = u.id) as identities,
       p.role, o.name as org
from auth.users u
join public.profiles p on p.id = u.id
join public.organisations o on o.id = p.org_id
where u.email in (:'qa_admin_email', :'qa_worker_email')
order by p.role;
