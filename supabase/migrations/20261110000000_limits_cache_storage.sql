-- Orbit 0006: higher AI limits for a single user, cached AI suggestions,
-- and leaner storage of tailored resumes.

------------------------------------------------------------------------------
-- AI calls: higher limits, and each call can keep its result as a cache.
------------------------------------------------------------------------------

alter table public.llm_calls
  add column if not exists application_id  uuid references public.applications (id) on delete cascade,
  -- The master resume's updated_at the suggestions were made from.
  add column if not exists base_updated_at timestamptz,
  add column if not exists result          jsonb;
alter table public.llm_calls drop constraint if exists llm_calls_result_size;
alter table public.llm_calls
  add constraint llm_calls_result_size check (result is null or pg_column_size(result) <= 65536);

create index if not exists llm_calls_cache_idx on public.llm_calls (user_id, application_id, base_updated_at, id desc)
  where result is not null;

-- Returns the reserved call's id, or null when out of budget. Limits are
-- fixed here (200 per user, 400 for the app per 24 hours); the real ceiling
-- is usually the AI provider's own free quota.
drop function if exists public.claim_llm_call(text);
create function public.claim_llm_call(p_kind text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_user_daily constant integer := 200;
  c_global_daily constant integer := 400;
  v_user uuid := auth.uid();
  v_id bigint;
begin
  if v_user is null then
    raise exception 'sign in required' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 42));

  if (select count(*) from public.llm_calls
      where user_id = v_user and created_at > now() - interval '24 hours') >= c_user_daily then
    return null;
  end if;
  if (select count(*) from public.llm_calls
      where created_at > now() - interval '24 hours') >= c_global_daily then
    return null;
  end if;

  insert into public.llm_calls (user_id, kind) values (v_user, p_kind) returning id into v_id;
  return v_id;
end;
$$;

-- Stores what a call produced, once, on the caller's own row.
create or replace function public.save_llm_result(
  p_call_id bigint,
  p_application_id uuid,
  p_base_updated_at timestamptz,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.applications a where a.id = p_application_id and a.user_id = auth.uid()) then
    raise exception 'application not found' using errcode = 'no_data_found';
  end if;
  update public.llm_calls
  set application_id = p_application_id, base_updated_at = p_base_updated_at, result = p_result
  where id = p_call_id and user_id = auth.uid() and result is null;
end;
$$;

create or replace function public.my_llm_usage()
returns table (used integer, daily_limit integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer, 200
  from public.llm_calls
  where user_id = auth.uid() and created_at > now() - interval '24 hours';
$$;

------------------------------------------------------------------------------
-- Tailored resumes: one working version per job, and a permanent copy of
-- whatever was actually sent.
------------------------------------------------------------------------------

alter table public.resume_variants add column if not exists sent_at timestamptz;

-- When an application is submitted, the version attached to it is frozen.
create or replace function public.applications_stamp_sent_variant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('submitting', 'applied') and new.resume_variant_id is not null then
    update public.resume_variants
    set sent_at = now()
    where id = new.resume_variant_id and user_id = new.user_id and sent_at is null;
  end if;
  return null;
end;
$$;

drop trigger if exists applications_stamp_sent_variant on public.applications;
create trigger applications_stamp_sent_variant
  after insert or update of status on public.applications
  for each row execute function public.applications_stamp_sent_variant();

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

  -- Keep one working copy per job: older drafts go, sent copies stay.
  delete from public.resume_variants
  where application_id = p_application_id and user_id = v_user and id <> v_id and sent_at is null;

  -- Drafts for jobs that ended (rejected or archived) more than 60 days ago go too.
  delete from public.resume_variants v
  using public.applications a
  where v.application_id = a.id
    and v.user_id = v_user
    and v.sent_at is null
    and a.status in ('rejected', 'archived')
    and a.updated_at < now() - interval '60 days';

  return v_id;
end;
$$;

-- The word diff is recomputed in the app, so stored copies drop it.
update public.resume_variants set diff = '[]'::jsonb where diff <> '[]'::jsonb;

revoke all on function public.claim_llm_call(text) from public, anon;
revoke all on function public.save_llm_result(bigint, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.claim_llm_call(text) to authenticated;
grant execute on function public.save_llm_result(bigint, uuid, timestamptz, jsonb) to authenticated;
