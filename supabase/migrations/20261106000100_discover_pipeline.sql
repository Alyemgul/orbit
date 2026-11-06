-- Orbit 0004: Discover feed, swipes, pipeline board and activity stats.
-- Every function runs as the calling user (security invoker), so Row Level
-- Security still decides what each person can read and write.

------------------------------------------------------------------------------
-- Discover feed: open jobs the user hasn't swiped yet, newest first.
------------------------------------------------------------------------------

create index if not exists jobs_open_feed_idx
  on public.jobs ((coalesce(posted_at, first_seen_at)) desc, id desc)
  where closed_at is null;

create or replace function public.discover_feed(
  p_countries   text[] default null,
  -- Also match jobs with no country whose location names this region ("Remote, Europe").
  p_region_word text default null,
  p_levels      public.experience_level[] default null,
  p_categories  public.job_category[] default null,
  p_workplaces  public.workplace_type[] default null,
  p_visa_only   boolean default false,
  p_query       text default null,
  p_cursor_ts   timestamptz default null,
  p_cursor_id   uuid default null,
  p_limit       integer default 20
)
returns setof public.jobs
language sql
stable
security invoker
set search_path = ''
as $$
  select j.*
  from public.jobs j
  where j.closed_at is null
    and not exists (
      select 1 from public.swipes s where s.user_id = (select auth.uid()) and s.job_id = j.id
    )
    and (
      p_countries is null
      or j.country_codes && p_countries
      or (
        cardinality(j.country_codes) = 0
        and case p_region_word
          when 'europe' then j.location ~* '\m(europe|european|emea|eu|eea)\M'
          when 'asia' then j.location ~* '\m(asia|apac|asia[- ]pacific)\M'
          when 'oceania' then j.location ~* '\m(australia|oceania|anz|new zealand)\M'
          else false
        end
      )
    )
    and (p_levels is null or j.experience_level = any (p_levels))
    and (p_categories is null or j.category = any (p_categories))
    and (p_workplaces is null or j.workplace = any (p_workplaces))
    and (not coalesce(p_visa_only, false) or j.visa_sponsorship = 'yes')
    and (
      nullif(btrim(p_query), '') is null
      or j.search @@ websearch_to_tsquery('simple', left(p_query, 200))
    )
    and (
      p_cursor_ts is null
      or (coalesce(j.posted_at, j.first_seen_at), j.id) < (p_cursor_ts, p_cursor_id)
    )
  order by coalesce(j.posted_at, j.first_seen_at) desc, j.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

------------------------------------------------------------------------------
-- Swipes: one call records the decision and creates the application.
--   apply -> application queued (autopilot picks it up)
--   save  -> application saved
--   skip  -> swipe only
------------------------------------------------------------------------------

create or replace function public.record_swipe(p_job_id uuid, p_decision public.swipe_decision)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_application uuid;
begin
  if v_user is null then
    raise exception 'sign in required' using errcode = 'insufficient_privilege';
  end if;

  insert into public.swipes (user_id, job_id, decision)
  values (v_user, p_job_id, p_decision)
  on conflict (user_id, job_id) do update set decision = excluded.decision, created_at = now();

  if p_decision = 'skip' then
    return null;
  end if;

  insert into public.applications (user_id, job_id, status, mode, updated_by)
  values (v_user, p_job_id, case when p_decision = 'apply' then 'queued' else 'saved' end::public.application_status, 'auto', 'user')
  on conflict (user_id, job_id) do nothing
  returning id into v_application;

  if v_application is null then
    select id into v_application from public.applications where user_id = v_user and job_id = p_job_id;
  end if;
  return v_application;
end;
$$;

-- Undo the latest swipe on a job. The application it created goes too, but
-- only while nothing has happened to it yet (still saved or queued, under 10 minutes old).
create or replace function public.undo_swipe(p_job_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in required' using errcode = 'insufficient_privilege';
  end if;
  delete from public.applications
  where user_id = v_user
    and job_id = p_job_id
    and status in ('saved', 'queued')
    and created_at > now() - interval '10 minutes';
  delete from public.swipes where user_id = v_user and job_id = p_job_id;
end;
$$;

------------------------------------------------------------------------------
-- Pipeline board: the user's applications with the job fields a card shows.
------------------------------------------------------------------------------

create or replace function public.my_pipeline()
returns table (
  id               uuid,
  job_id           uuid,
  status           public.application_status,
  mode             public.application_mode,
  applied_at       timestamptz,
  last_error       text,
  updated_at       timestamptz,
  created_at       timestamptz,
  title            text,
  company          text,
  location         text,
  country_codes    text[],
  workplace        public.workplace_type,
  experience_level public.experience_level,
  category         public.job_category,
  apply_url        text,
  job_closed_at    timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id, a.job_id, a.status, a.mode, a.applied_at, a.last_error, a.updated_at, a.created_at,
         j.title, j.company, j.location, j.country_codes, j.workplace, j.experience_level, j.category,
         j.apply_url, j.closed_at
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.user_id = (select auth.uid())
  order by a.updated_at desc
  limit 1000;
$$;

------------------------------------------------------------------------------
-- Activity heatmap: swipes and applications per day in the user's time zone.
------------------------------------------------------------------------------

create or replace function public.my_activity(p_days integer default 182, p_time_zone text default 'UTC')
returns table (day date, swipes integer, applied integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text := coalesce(
    (select name from pg_catalog.pg_timezone_names where name = p_time_zone limit 1),
    'UTC'
  );
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 182), 1), 400));
begin
  return query
  with s as (
    select (created_at at time zone v_tz)::date as d, count(*)::integer as n
    from public.swipes
    where user_id = (select auth.uid()) and created_at >= v_since
    group by 1
  ),
  a as (
    select (created_at at time zone v_tz)::date as d, count(*)::integer as n
    from public.application_events
    where user_id = (select auth.uid()) and to_status = 'applied' and created_at >= v_since
    group by 1
  )
  select coalesce(s.d, a.d), coalesce(s.n, 0), coalesce(a.n, 0)
  from s full join a on a.d = s.d
  order by 1;
end;
$$;

------------------------------------------------------------------------------
-- Grants: signed-in users only.
------------------------------------------------------------------------------

revoke all on function public.discover_feed(text[], text, public.experience_level[], public.job_category[], public.workplace_type[], boolean, text, timestamptz, uuid, integer) from public, anon;
revoke all on function public.record_swipe(uuid, public.swipe_decision) from public, anon;
revoke all on function public.undo_swipe(uuid) from public, anon;
revoke all on function public.my_pipeline() from public, anon;
revoke all on function public.my_activity(integer, text) from public, anon;

grant execute on function public.discover_feed(text[], text, public.experience_level[], public.job_category[], public.workplace_type[], boolean, text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.record_swipe(uuid, public.swipe_decision) to authenticated;
grant execute on function public.undo_swipe(uuid) to authenticated;
grant execute on function public.my_pipeline() to authenticated;
grant execute on function public.my_activity(integer, text) to authenticated;

------------------------------------------------------------------------------
-- Live board: stream application changes (RLS still filters to own rows).
------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'applications'
     ) then
    alter publication supabase_realtime add table public.applications;
  end if;
end;
$$;

------------------------------------------------------------------------------
-- State machine: a queued job can be marked applied when the user applies by
-- hand before the autopilot reaches it (mirrors packages/core).
------------------------------------------------------------------------------

insert into public.application_transitions (from_status, to_status)
values ('queued', 'applied')
on conflict do nothing;
