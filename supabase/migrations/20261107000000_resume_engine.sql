-- Orbit 0005: resume engine.
-- Saving the master resume, saving tailored versions against an
-- application, and a per-user plus global daily budget for AI calls.

------------------------------------------------------------------------------
-- Size limits (the app validates shape; the database caps size).
------------------------------------------------------------------------------

alter table public.resumes
  add constraint resumes_content_size check (pg_column_size(content) <= 262144);

alter table public.resume_variants
  add column inputs     jsonb not null default '{}'::jsonb,
  add column source     text not null default 'rules' check (source in ('rules', 'ai')),
  add column base_updated_at timestamptz,
  add constraint resume_variants_content_size check (pg_column_size(content) <= 262144),
  add constraint resume_variants_diff_size check (pg_column_size(diff) <= 262144),
  add constraint resume_variants_inputs_size check (pg_column_size(inputs) <= 131072);

-- A variant must belong to one of the same user's applications.
create or replace function public.resume_variants_check_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.applications a
    where a.id = new.application_id and a.user_id = new.user_id
  ) then
    raise exception 'application not found' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger resume_variants_check_owner
  before insert or update on public.resume_variants
  for each row execute function public.resume_variants_check_owner();

------------------------------------------------------------------------------
-- Master resume
------------------------------------------------------------------------------

create or replace function public.save_master_resume(p_content jsonb)
returns table (id uuid, updated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'sign in required' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_content) is distinct from 'object' then
    raise exception 'resume must be an object' using errcode = 'check_violation';
  end if;

  return query
  insert into public.resumes as r (user_id, title, is_master, content)
  values (v_user, 'Master resume', true, p_content)
  on conflict (user_id) where is_master
  do update set content = excluded.content
  returning r.id, r.updated_at;
end;
$$;

------------------------------------------------------------------------------
-- Tailored versions
------------------------------------------------------------------------------

-- Stores a tailored copy, points the application at it, and moves a queued
-- application on to ready (queued -> tailoring -> ready, both logged).
create or replace function public.save_resume_variant(
  p_application_id uuid,
  p_content jsonb,
  p_inputs jsonb,
  p_diff jsonb,
  p_match_score numeric,
  p_missing_keywords text[],
  p_source text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_status public.application_status;
  v_master public.resumes%rowtype;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'sign in required' using errcode = 'insufficient_privilege';
  end if;

  select a.status into v_status
  from public.applications a
  where a.id = p_application_id and a.user_id = v_user
  for update;
  if not found then
    raise exception 'application not found' using errcode = 'no_data_found';
  end if;

  select * into v_master from public.resumes r where r.user_id = v_user and r.is_master;

  insert into public.resume_variants
    (user_id, application_id, base_resume_id, base_updated_at, content, inputs, diff, match_score, missing_keywords, source)
  values
    (v_user, p_application_id, v_master.id, v_master.updated_at, p_content, coalesce(p_inputs, '{}'::jsonb),
     coalesce(p_diff, '[]'::jsonb), p_match_score, coalesce(p_missing_keywords[1:50], '{}'), p_source)
  returning id into v_id;

  update public.applications set resume_variant_id = v_id, updated_by = 'user'
  where id = p_application_id;

  if v_status = 'queued' then
    update public.applications set status = 'tailoring', updated_by = 'user' where id = p_application_id;
    update public.applications set status = 'ready', updated_by = 'user' where id = p_application_id;
  end if;

  return v_id;
end;
$$;

------------------------------------------------------------------------------
-- AI call budget
------------------------------------------------------------------------------

create table public.llm_calls (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('tailor', 'import')),
  created_at timestamptz not null default now()
);

create index llm_calls_user_time_idx on public.llm_calls (user_id, created_at desc);
create index llm_calls_time_idx on public.llm_calls (created_at desc);

alter table public.llm_calls enable row level security;

-- Users can see their own usage; rows are only ever written by claim_llm_call.
create policy "llm_calls: read own"
  on public.llm_calls for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete, truncate on public.llm_calls from anon, authenticated;

-- Reserves one AI call, or returns false when the user (30 a day) or the
-- whole app (300 a day) is out of budget. Limits live here, not in the
-- caller, so a direct call can only spend the caller's own allowance.
create or replace function public.claim_llm_call(p_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_user_daily constant integer := 30;
  c_global_daily constant integer := 300;
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'sign in required' using errcode = 'insufficient_privilege';
  end if;

  -- One claim at a time per user, so parallel requests can't overshoot.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 42));

  if (select count(*) from public.llm_calls
      where user_id = v_user and created_at > now() - interval '24 hours') >= c_user_daily then
    return false;
  end if;
  if (select count(*) from public.llm_calls
      where created_at > now() - interval '24 hours') >= c_global_daily then
    return false;
  end if;

  insert into public.llm_calls (user_id, kind) values (v_user, p_kind);
  return true;
end;
$$;

create or replace function public.my_llm_usage()
returns table (used integer, daily_limit integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer, 30
  from public.llm_calls
  where user_id = auth.uid() and created_at > now() - interval '24 hours';
$$;

revoke all on function public.save_master_resume(jsonb) from public, anon;
revoke all on function public.save_resume_variant(uuid, jsonb, jsonb, jsonb, numeric, text[], text) from public, anon;
revoke all on function public.claim_llm_call(text) from public, anon;
revoke all on function public.my_llm_usage() from public, anon;
grant execute on function public.save_master_resume(jsonb) to authenticated;
grant execute on function public.save_resume_variant(uuid, jsonb, jsonb, jsonb, numeric, text[], text) to authenticated;
grant execute on function public.claim_llm_call(text) to authenticated;
grant execute on function public.my_llm_usage() to authenticated;
