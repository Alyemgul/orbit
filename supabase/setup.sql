-- Orbit database setup for a NEW, empty Supabase project: paste into SQL Editor and Run.
-- Existing projects: run upgrade.sql instead.
-- Generated from supabase/migrations by supabase/build-sql.mjs.

-- ===== migrations/20261105000000_profiles.sql =====
begin;

-- Orbit 0001: user profiles.
-- One row per auth user, created automatically on sign-up.
-- Row Level Security restricts every user to their own row.

create table public.profiles (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  full_name          text,
  email              text not null,
  phone              text,
  location           text,
  links              jsonb not null default '{}'::jsonb,
  work_auth          jsonb not null default '{}'::jsonb,
  preferences        jsonb not null default '{}'::jsonb,
  daily_apply_cap    integer not null default 15 check (daily_apply_cap between 0 and 200),
  review_before_send boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.profiles is 'Per-user profile, preferences and autopilot settings.';

alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Inserts happen only through the trigger below; deletes cascade from auth.users.

-- Keep updated_at current on every update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create the profile row when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

commit;

-- ===== migrations/20261105000100_jobs_pipeline.sql =====
begin;

-- Orbit 0002: jobs, ingestion log, swipes, applications, resumes.
--
-- Jobs are shared (read-only to users, written by the ingest job with the
-- service role). Everything else is per-user and locked down with RLS.
-- Enum values mirror packages/core; tests fail if they drift.

------------------------------------------------------------------------------
-- Enums
------------------------------------------------------------------------------

create type public.ats_type as enum (
  'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'workday',
  'workable', 'personio', 'teamtailor', 'other'
);
create type public.workplace_type as enum ('remote', 'hybrid', 'onsite', 'unknown');
create type public.employment_type as enum ('full_time', 'part_time', 'contract', 'internship', 'temporary', 'unknown');
create type public.experience_level as enum ('intern', 'entry', 'mid', 'senior', 'lead', 'unknown');
create type public.job_category as enum (
  'software_engineering', 'data', 'ml_ai', 'devops_sre', 'security', 'qa',
  'product', 'design', 'it_support', 'other'
);
create type public.visa_sponsorship as enum ('yes', 'no', 'unknown');
create type public.salary_period as enum ('year', 'month', 'week', 'day', 'hour');
create type public.application_status as enum (
  'saved', 'queued', 'tailoring', 'ready', 'submitting', 'needs_input', 'failed',
  'applied', 'interviewing', 'offer', 'rejected', 'archived'
);
create type public.application_mode as enum ('auto', 'assisted', 'manual');
create type public.swipe_decision as enum ('skip', 'save', 'apply');
create type public.event_actor as enum ('user', 'system', 'extension');
create type public.source_run_status as enum ('success', 'empty', 'failed');

------------------------------------------------------------------------------
-- Jobs (shared)
------------------------------------------------------------------------------

create table public.jobs (
  id               uuid primary key default gen_random_uuid(),
  -- SHA-256 of company|title|city: one row per real-world posting across sources.
  dedupe_hash      text not null unique,
  source           text not null,
  -- Company boards (10) outrank aggregators (1-3) when both list a job.
  source_priority  smallint not null default 0,
  source_job_id    text not null,
  -- Listing page, kept for attribution (some feeds require a link back).
  source_url       text,
  ats_type         public.ats_type not null default 'other',
  company          text not null,
  company_logo_url text,
  title            text not null,
  location         text not null default '',
  country_codes    text[] not null default '{}',
  workplace        public.workplace_type not null default 'unknown',
  employment_type  public.employment_type not null default 'unknown',
  experience_level public.experience_level not null default 'unknown',
  category         public.job_category not null default 'other',
  salary_min       numeric(12, 2),
  salary_max       numeric(12, 2),
  salary_currency  text check (salary_currency ~ '^[A-Z]{3}$'),
  salary_period    public.salary_period,
  visa_sponsorship public.visa_sponsorship not null default 'unknown',
  -- Plain text only; raw HTML is never stored.
  description      text not null default '',
  apply_url        text not null check (apply_url ~* '^https?://'),
  posted_at        timestamptz,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  closed_at        timestamptz,
  search           tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(company, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(location, '')), 'C')
  ) stored,
  constraint jobs_salary_range check (salary_min is null or salary_max is null or salary_min <= salary_max)
);

comment on table public.jobs is 'Normalized job postings from all sources. Written only by the ingest job.';

create index jobs_open_recent_idx on public.jobs (posted_at desc nulls last) where closed_at is null;
create index jobs_open_filters_idx on public.jobs (category, experience_level, workplace) where closed_at is null;
create index jobs_source_open_idx on public.jobs (source, last_seen_at) where closed_at is null;
create index jobs_country_codes_idx on public.jobs using gin (country_codes);
create index jobs_search_idx on public.jobs using gin (search);

alter table public.jobs enable row level security;

create policy "jobs: readable by signed-in users"
  on public.jobs for select
  to authenticated
  using (true);

------------------------------------------------------------------------------
-- Ingest run log (source health)
------------------------------------------------------------------------------

create table public.source_runs (
  id          bigint generated always as identity primary key,
  source      text not null,
  status      public.source_run_status not null,
  started_at  timestamptz not null,
  finished_at timestamptz not null default now(),
  fetched     integer not null default 0 check (fetched >= 0),
  upserted    integer not null default 0 check (upserted >= 0),
  closed      integer not null default 0 check (closed >= 0),
  invalid     integer not null default 0 check (invalid >= 0),
  error       text
);

create index source_runs_source_recent_idx on public.source_runs (source, started_at desc);

alter table public.source_runs enable row level security;

create policy "source_runs: readable by signed-in users"
  on public.source_runs for select
  to authenticated
  using (true);

------------------------------------------------------------------------------
-- Watched companies (per user; the ingest job reads all of them)
------------------------------------------------------------------------------

create table public.watched_companies (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ats_type     public.ats_type not null
               check (ats_type in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee')),
  board_token  text not null check (board_token ~ '^[A-Za-z0-9._-]{1,100}$'),
  company_name text not null check (length(company_name) between 1 and 200),
  created_at   timestamptz not null default now(),
  primary key (user_id, ats_type, board_token)
);

alter table public.watched_companies enable row level security;

create policy "watched_companies: own rows"
  on public.watched_companies for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

------------------------------------------------------------------------------
-- Swipes
------------------------------------------------------------------------------

create table public.swipes (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_id     uuid not null references public.jobs (id) on delete cascade,
  decision   public.swipe_decision not null,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create index swipes_user_recent_idx on public.swipes (user_id, created_at desc);

alter table public.swipes enable row level security;

create policy "swipes: own rows"
  on public.swipes for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

------------------------------------------------------------------------------
-- Resumes
------------------------------------------------------------------------------

create table public.resumes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null default 'Master resume' check (length(title) between 1 and 120),
  is_master  boolean not null default false,
  -- Structured resume (JSON Resume compatible), validated in the app.
  content    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index resumes_one_master_per_user_idx on public.resumes (user_id) where is_master;

create trigger resumes_set_updated_at
  before update on public.resumes
  for each row execute function public.set_updated_at();

alter table public.resumes enable row level security;

create policy "resumes: own rows"
  on public.resumes for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

------------------------------------------------------------------------------
-- Applications
------------------------------------------------------------------------------

create table public.applications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- restrict: a job someone applied to is never pruned.
  job_id            uuid not null references public.jobs (id) on delete restrict,
  status            public.application_status not null default 'saved',
  mode              public.application_mode not null default 'auto',
  resume_variant_id uuid,
  applied_at        timestamptz,
  notes             text check (length(notes) <= 10000),
  last_error        text,
  -- Who made the latest change; copied onto the event log by trigger.
  updated_by        public.event_actor not null default 'user',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, job_id)
);

create index applications_user_status_idx on public.applications (user_id, status, updated_at desc);

alter table public.applications enable row level security;

create policy "applications: own rows"
  on public.applications for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table public.resume_variants (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  application_id   uuid not null references public.applications (id) on delete cascade,
  base_resume_id   uuid references public.resumes (id) on delete set null,
  content          jsonb not null,
  diff             jsonb not null default '[]'::jsonb,
  match_score      numeric(5, 2) check (match_score between 0 and 100),
  missing_keywords text[] not null default '{}',
  pdf_path         text,
  created_at       timestamptz not null default now()
);

create index resume_variants_application_idx on public.resume_variants (application_id, created_at desc);

alter table public.resume_variants enable row level security;

create policy "resume_variants: own rows"
  on public.resume_variants for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.applications
  add constraint applications_resume_variant_fk
  foreign key (resume_variant_id) references public.resume_variants (id) on delete set null;

------------------------------------------------------------------------------
-- Screening answer memory
------------------------------------------------------------------------------

create table public.screening_answers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Hash of the normalized question text, so rephrased whitespace still matches.
  question_hash text not null,
  question_text text not null check (length(question_text) <= 2000),
  answer        jsonb not null,
  -- Work authorization / EEO answers: only ever filled from this table, never guessed.
  is_sensitive  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, question_hash)
);

create trigger screening_answers_set_updated_at
  before update on public.screening_answers
  for each row execute function public.set_updated_at();

alter table public.screening_answers enable row level security;

create policy "screening_answers: own rows"
  on public.screening_answers for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

------------------------------------------------------------------------------
-- Application state machine (mirrors APPLICATION_TRANSITIONS in packages/core)
------------------------------------------------------------------------------

create table public.application_transitions (
  from_status public.application_status not null,
  to_status   public.application_status not null,
  primary key (from_status, to_status)
);

insert into public.application_transitions (from_status, to_status) values
  ('saved', 'queued'), ('saved', 'applied'), ('saved', 'archived'),
  ('queued', 'tailoring'), ('queued', 'failed'), ('queued', 'archived'),
  ('tailoring', 'ready'), ('tailoring', 'failed'), ('tailoring', 'archived'),
  ('ready', 'submitting'), ('ready', 'applied'), ('ready', 'archived'),
  ('submitting', 'applied'), ('submitting', 'needs_input'), ('submitting', 'failed'),
  ('needs_input', 'submitting'), ('needs_input', 'applied'), ('needs_input', 'archived'),
  ('failed', 'queued'), ('failed', 'applied'), ('failed', 'archived'),
  ('applied', 'interviewing'), ('applied', 'offer'), ('applied', 'rejected'), ('applied', 'archived'),
  ('interviewing', 'offer'), ('interviewing', 'rejected'), ('interviewing', 'archived'),
  ('offer', 'rejected'), ('offer', 'archived'),
  ('rejected', 'archived'),
  ('archived', 'saved'), ('archived', 'applied'), ('archived', 'interviewing'),
  ('archived', 'offer'), ('archived', 'rejected');

alter table public.application_transitions enable row level security;

create policy "application_transitions: readable by signed-in users"
  on public.application_transitions for select
  to authenticated
  using (true);

create table public.application_events (
  id             bigint generated always as identity primary key,
  application_id uuid not null references public.applications (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  type           text not null,
  from_status    public.application_status,
  to_status      public.application_status,
  actor          public.event_actor not null,
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index application_events_application_idx on public.application_events (application_id, created_at);

alter table public.application_events enable row level security;

-- Read-only for users: events are written by the trigger below, so the
-- timeline cannot be edited after the fact.
create policy "application_events: read own"
  on public.application_events for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Enforce entry states and transitions for every writer (app, extension, functions).
create or replace function public.applications_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('saved', 'queued', 'applied') then
      raise exception 'applications must start as saved, queued or applied (got %)', new.status
        using errcode = 'check_violation';
    end if;
  else
    if new.user_id <> old.user_id or new.job_id <> old.job_id then
      raise exception 'application owner and job cannot change' using errcode = 'check_violation';
    end if;
    if new.status is distinct from old.status and not exists (
      select 1 from public.application_transitions t
      where t.from_status = old.status and t.to_status = new.status
    ) then
      raise exception 'invalid application transition: % -> %', old.status, new.status
        using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  if new.status = 'applied' and new.applied_at is null then
    new.applied_at := now();
  end if;
  return new;
end;
$$;

create trigger applications_validate
  before insert or update on public.applications
  for each row execute function public.applications_validate();

create or replace function public.applications_log_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.application_events (application_id, user_id, type, from_status, to_status, actor)
    values (new.id, new.user_id, 'created', null, new.status, new.updated_by);
  elsif new.status is distinct from old.status then
    insert into public.application_events (application_id, user_id, type, from_status, to_status, actor, payload)
    values (
      new.id, new.user_id, 'status_changed', old.status, new.status, new.updated_by,
      case when new.last_error is not null and new.status = 'failed'
           then jsonb_build_object('error', new.last_error) else '{}'::jsonb end
    );
  end if;
  return null;
end;
$$;

create trigger applications_log_event
  after insert or update on public.applications
  for each row execute function public.applications_log_event();

------------------------------------------------------------------------------
-- Ingest functions (service role only)
------------------------------------------------------------------------------

-- Upsert a batch of normalized jobs. On a dedupe collision the higher (or
-- equal) priority source wins; a lower-priority sighting changes nothing, so
-- a job removed from the company's own board still closes even if an
-- aggregator keeps listing it.
create or replace function public.ingest_upsert_jobs(p_jobs jsonb)
returns integer
language sql
security definer
set search_path = ''
as $$
  with input as (
    select *
    from jsonb_to_recordset(p_jobs) as j (
      dedupe_hash text, source text, source_priority smallint, source_job_id text, source_url text,
      ats_type public.ats_type, company text, company_logo_url text, title text, location text,
      country_codes text[], workplace public.workplace_type, employment_type public.employment_type,
      experience_level public.experience_level, category public.job_category,
      salary_min numeric, salary_max numeric, salary_currency text, salary_period public.salary_period,
      visa_sponsorship public.visa_sponsorship, description text, apply_url text, posted_at timestamptz
    )
  ),
  written as (
    insert into public.jobs as t (
      dedupe_hash, source, source_priority, source_job_id, source_url, ats_type, company,
      company_logo_url, title, location, country_codes, workplace, employment_type,
      experience_level, category, salary_min, salary_max, salary_currency, salary_period,
      visa_sponsorship, description, apply_url, posted_at
    )
    select
      dedupe_hash, source, source_priority, source_job_id, source_url, ats_type, company,
      company_logo_url, title, location, country_codes, workplace, employment_type,
      experience_level, category, salary_min, salary_max, salary_currency, salary_period,
      visa_sponsorship, description, apply_url, posted_at
    from input
    on conflict (dedupe_hash) do update set
      source = excluded.source,
      source_priority = excluded.source_priority,
      source_job_id = excluded.source_job_id,
      source_url = excluded.source_url,
      ats_type = excluded.ats_type,
      company = excluded.company,
      company_logo_url = excluded.company_logo_url,
      title = excluded.title,
      location = excluded.location,
      country_codes = excluded.country_codes,
      workplace = excluded.workplace,
      employment_type = excluded.employment_type,
      experience_level = excluded.experience_level,
      category = excluded.category,
      salary_min = excluded.salary_min,
      salary_max = excluded.salary_max,
      salary_currency = excluded.salary_currency,
      salary_period = excluded.salary_period,
      visa_sponsorship = excluded.visa_sponsorship,
      description = excluded.description,
      apply_url = excluded.apply_url,
      posted_at = coalesce(excluded.posted_at, t.posted_at),
      last_seen_at = now(),
      closed_at = null
    where excluded.source_priority >= t.source_priority
    returning 1
  )
  select count(*)::integer from written;
$$;

-- Close a source's jobs that a successful run no longer saw.
create or replace function public.ingest_close_missing(p_source text, p_seen_before timestamptz)
returns integer
language sql
security definer
set search_path = ''
as $$
  with closed as (
    update public.jobs
    set closed_at = now()
    where source = p_source and closed_at is null and last_seen_at < p_seen_before
    returning 1
  )
  select count(*)::integer from closed;
$$;

-- Delete long-closed jobs nobody applied to (swipes cascade). Keeps the free tier small.
create or replace function public.ingest_prune(p_retention_days integer)
returns integer
language sql
security definer
set search_path = ''
as $$
  with pruned as (
    delete from public.jobs j
    where j.closed_at < now() - make_interval(days => greatest(p_retention_days, 1))
      and not exists (select 1 from public.applications a where a.job_id = j.id)
    returning 1
  )
  select count(*)::integer from pruned;
$$;

revoke execute on function public.ingest_upsert_jobs(jsonb) from public, anon, authenticated;
revoke execute on function public.ingest_close_missing(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.ingest_prune(integer) from public, anon, authenticated;
grant execute on function public.ingest_upsert_jobs(jsonb) to service_role;
grant execute on function public.ingest_close_missing(text, timestamptz) to service_role;
grant execute on function public.ingest_prune(integer) to service_role;

-- Trigger functions are not meant to be called directly.
revoke execute on function public.applications_validate() from public, anon, authenticated;
revoke execute on function public.applications_log_event() from public, anon, authenticated;

commit;

-- ===== migrations/20261106000000_job_categories_quant_business.sql =====
-- Orbit 0003: categories for CS-skilled roles outside pure software.
--   quant         : quant developer/researcher, trading engineer, trader
--   tech_business : technology analyst, consultant, solutions/implementation, forward deployed
-- Values are appended (Postgres enums only grow at the end); mirrors packages/core JOB_CATEGORIES.

alter type public.job_category add value if not exists 'quant';
alter type public.job_category add value if not exists 'tech_business';

-- ===== migrations/20261106000100_discover_pipeline.sql =====
begin;

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

commit;

-- ===== migrations/20261107000000_resume_engine.sql =====
begin;

-- Orbit 0005: resume engine.
-- Saving the master resume, saving tailored versions against an
-- application, and a per-user plus global daily budget for AI calls.

------------------------------------------------------------------------------
-- Size limits (the app validates shape; the database caps size).
------------------------------------------------------------------------------

-- Safe to run more than once: every step checks what already exists.
alter table public.resumes drop constraint if exists resumes_content_size;
alter table public.resumes
  add constraint resumes_content_size check (pg_column_size(content) <= 262144);

alter table public.resume_variants
  add column if not exists inputs     jsonb not null default '{}'::jsonb,
  add column if not exists source     text not null default 'rules' check (source in ('rules', 'ai')),
  add column if not exists base_updated_at timestamptz;
alter table public.resume_variants
  drop constraint if exists resume_variants_content_size,
  drop constraint if exists resume_variants_diff_size,
  drop constraint if exists resume_variants_inputs_size;
alter table public.resume_variants
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

drop trigger if exists resume_variants_check_owner on public.resume_variants;
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

create table if not exists public.llm_calls (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('tailor', 'import')),
  created_at timestamptz not null default now()
);

create index if not exists llm_calls_user_time_idx on public.llm_calls (user_id, created_at desc);
create index if not exists llm_calls_time_idx on public.llm_calls (created_at desc);

alter table public.llm_calls enable row level security;

-- Users can see their own usage; rows are only ever written by claim_llm_call.
drop policy if exists "llm_calls: read own" on public.llm_calls;
create policy "llm_calls: read own"
  on public.llm_calls for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete, truncate on public.llm_calls from anon, authenticated;

-- Reserves one AI call, or returns false when the user (30 a day) or the
-- whole app (300 a day) is out of budget. Limits live here, not in the
-- caller, so a direct call can only spend the caller's own allowance.
-- Dropped first: 0006 changes its return type, so a re-run must start clean.
drop function if exists public.claim_llm_call(text);
create function public.claim_llm_call(p_kind text)
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

commit;

-- ===== migrations/20261110000000_limits_cache_storage.sql =====
begin;

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

commit;

-- ===== migrations/20261111000000_autopilot.sql =====
begin;

-- Orbit 0007: autopilot extension, "Needs you" inbox and Gmail reply tracking.
--
-- The extension and the Gmail script never hold a Supabase session. Each has
-- a random connection token (only its SHA-256 is stored here) that can call
-- the ext_* / gmail_* functions below and nothing else. Tokens are revocable
-- from Profile, and every function scopes its work to the token's owner.

------------------------------------------------------------------------------
-- Connection tokens
------------------------------------------------------------------------------

create table if not exists public.connection_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('extension', 'gmail')),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists connection_tokens_user_idx on public.connection_tokens (user_id, kind) where revoked_at is null;

alter table public.connection_tokens enable row level security;

drop policy if exists "connection_tokens: read own" on public.connection_tokens;
create policy "connection_tokens: read own"
  on public.connection_tokens for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete, truncate on public.connection_tokens from anon, authenticated;

-- Creates a new token for the signed-in user, revoking the previous one of
-- the same kind. The plain token is returned once and never stored.
create or replace function public.create_connection_token(p_kind text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_token text;
begin
  if v_user is null then
    raise exception 'sign in required' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('extension', 'gmail') then
    raise exception 'unknown connection kind' using errcode = 'check_violation';
  end if;

  update public.connection_tokens set revoked_at = now()
  where user_id = v_user and kind = p_kind and revoked_at is null;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.connection_tokens (user_id, kind, token_hash)
  values (v_user, p_kind, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'));
  return v_token;
end;
$$;

create or replace function public.revoke_connection_token(p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = 'insufficient_privilege';
  end if;
  update public.connection_tokens set revoked_at = now()
  where user_id = auth.uid() and kind = p_kind and revoked_at is null;
end;
$$;

-- Resolves a token to its owner. Internal: not executable by any client role.
create or replace function public.connection_user(p_token text, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_user uuid;
  v_last timestamptz;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,128}$' then
    raise exception 'invalid connection' using errcode = 'invalid_authorization_specification';
  end if;
  select t.id, t.user_id, t.last_used_at into v_id, v_user, v_last
  from public.connection_tokens t
  where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and t.kind = p_kind and t.revoked_at is null;
  if v_user is null then
    raise exception 'invalid connection' using errcode = 'invalid_authorization_specification';
  end if;
  if v_last is null or v_last < now() - interval '1 minute' then
    update public.connection_tokens set last_used_at = now() where id = v_id;
  end if;
  return v_user;
end;
$$;

------------------------------------------------------------------------------
-- Applications: what the autopilot needs from the user, and new transitions.
------------------------------------------------------------------------------

alter table public.applications add column if not exists needs jsonb;
alter table public.applications drop constraint if exists applications_needs_size;
alter table public.applications
  add constraint applications_needs_size check (needs is null or pg_column_size(needs) <= 32768);

insert into public.application_transitions (from_status, to_status) values
  ('queued', 'submitting'),
  ('needs_input', 'ready')
on conflict do nothing;

------------------------------------------------------------------------------
-- Extension API (called with the anon key plus a connection token)
------------------------------------------------------------------------------

-- Daily numbers for the extension popup.
create or replace function public.ext_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.connection_user(p_token, 'extension');
begin
  return jsonb_build_object(
    'email', (select email from public.profiles where user_id = v_user),
    'cap', (select daily_apply_cap from public.profiles where user_id = v_user),
    'review', (select review_before_send from public.profiles where user_id = v_user),
    'applied_today', (
      select count(*) from public.application_events e
      where e.user_id = v_user and e.actor = 'extension' and e.to_status = 'applied'
        and e.created_at > now() - interval '24 hours'
    ),
    'waiting', (
      select count(*) from public.applications a join public.jobs j on j.id = a.job_id
      where a.user_id = v_user and a.status in ('queued', 'ready') and a.mode <> 'manual'
        and j.closed_at is null and j.ats_type in ('greenhouse', 'lever', 'ashby')
    ),
    'needs_you', (select count(*) from public.applications where user_id = v_user and status = 'needs_input')
  );
end;
$$;

-- Hands the extension the next application to submit, or says why not.
-- Enforces the daily cap, one submission at a time, and a pause between them.
create or replace function public.ext_next_application(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_gap constant interval := interval '3 minutes';
  v_user uuid := public.connection_user(p_token, 'extension');
  v_profile public.profiles%rowtype;
  v_applied integer;
  v_last timestamptz;
  v_app public.applications%rowtype;
  v_job public.jobs%rowtype;
  v_resume jsonb;
begin
  -- A submission the extension never reported back on counts as failed.
  update public.applications
  set status = 'failed', last_error = 'The autopilot stopped responding.', updated_by = 'extension'
  where user_id = v_user and status = 'submitting' and updated_at < now() - interval '20 minutes';

  if exists (select 1 from public.applications where user_id = v_user and status = 'submitting') then
    return jsonb_build_object('status', 'busy', 'retry_after', 60);
  end if;

  select * into v_profile from public.profiles where user_id = v_user;
  select count(*) into v_applied from public.application_events e
  where e.user_id = v_user and e.actor = 'extension' and e.to_status = 'applied'
    and e.created_at > now() - interval '24 hours';
  if v_applied >= coalesce(v_profile.daily_apply_cap, 15) then
    return jsonb_build_object('status', 'cap', 'retry_after', 3600, 'cap', v_profile.daily_apply_cap);
  end if;

  select max(e.created_at) into v_last from public.application_events e
  where e.user_id = v_user and e.actor = 'extension' and e.to_status = 'submitting';
  if v_last is not null and v_last > now() - c_gap then
    return jsonb_build_object('status', 'wait', 'retry_after', ceil(extract(epoch from (v_last + c_gap - now())))::integer);
  end if;

  select a.* into v_app
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.user_id = v_user
    and a.status in ('ready', 'queued')
    and a.mode <> 'manual'
    and j.closed_at is null
    and j.ats_type in ('greenhouse', 'lever', 'ashby')
  order by (a.status = 'ready') desc, a.created_at
  limit 1
  for update of a skip locked;

  if not found then
    return jsonb_build_object('status', 'empty', 'retry_after', 900);
  end if;

  select * into v_job from public.jobs where id = v_app.job_id;
  select coalesce(
    (select v.content from public.resume_variants v where v.id = v_app.resume_variant_id),
    (select r.content from public.resumes r where r.user_id = v_user and r.is_master)
  ) into v_resume;

  if v_resume is null then
    -- queued and ready may both move to submitting, and submitting to failed.
    update public.applications set status = 'submitting', updated_by = 'extension' where id = v_app.id;
    update public.applications set status = 'failed', updated_by = 'extension',
      last_error = 'Save your master resume first.'
    where id = v_app.id;
    return jsonb_build_object('status', 'no_resume', 'retry_after', 900);
  end if;

  update public.applications set status = 'submitting', updated_by = 'extension', last_error = null
  where id = v_app.id;

  return jsonb_build_object(
    'status', 'ok',
    'application', jsonb_build_object(
      'id', v_app.id, 'title', v_job.title, 'company', v_job.company,
      'apply_url', v_job.apply_url, 'ats_type', v_job.ats_type
    ),
    'resume', v_resume,
    'profile', jsonb_build_object(
      'full_name', v_profile.full_name, 'email', v_profile.email,
      'phone', v_profile.phone, 'location', v_profile.location
    ),
    'review', coalesce(v_profile.review_before_send, false),
    'accept_privacy', coalesce((v_profile.preferences ->> 'autopilot_accept_privacy')::boolean, false)
  );
end;
$$;

-- The user's saved screening answers.
create or replace function public.ext_answers(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.connection_user(p_token, 'extension');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('question', s.question_text, 'answer', s.answer, 'sensitive', s.is_sensitive))
    from (
      select question_text, answer, is_sensitive from public.screening_answers
      where user_id = v_user order by updated_at desc limit 1000
    ) s
  ), '[]'::jsonb);
end;
$$;

-- Reports how a submission went. "applied" may also carry answers the user
-- typed into the form, which are remembered for next time.
create or replace function public.ext_report(p_token text, p_application_id uuid, p_outcome text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.connection_user(p_token, 'extension');
  v_status public.application_status;
  v_reason text := left(coalesce(p_detail ->> 'reason', ''), 300);
  v_item jsonb;
begin
  if p_outcome not in ('applied', 'needs_input', 'failed') then
    raise exception 'unknown outcome' using errcode = 'check_violation';
  end if;
  if pg_column_size(coalesce(p_detail, '{}'::jsonb)) > 65536 then
    raise exception 'report too large' using errcode = 'check_violation';
  end if;

  select status into v_status from public.applications
  where id = p_application_id and user_id = v_user
  for update;
  if not found or v_status not in ('submitting', 'needs_input') then
    raise exception 'application is not being submitted' using errcode = 'no_data_found';
  end if;

  if p_outcome = 'applied' then
    update public.applications
    set status = 'applied', updated_by = 'extension', last_error = null, needs = null
    where id = p_application_id;

    for v_item in select value from jsonb_array_elements(
      case when jsonb_typeof(p_detail -> 'answers') = 'array' then p_detail -> 'answers' else '[]'::jsonb end
    ) limit 50 loop
      if (v_item ->> 'hash') ~ '^[0-9a-f]{64}$'
         and length(coalesce(v_item ->> 'question', '')) between 1 and 2000
         and jsonb_typeof(v_item -> 'answer') in ('string', 'array')
         and pg_column_size(v_item -> 'answer') <= 4096 then
        insert into public.screening_answers (user_id, question_hash, question_text, answer, is_sensitive)
        values (v_user, v_item ->> 'hash', v_item ->> 'question', v_item -> 'answer',
                coalesce((v_item ->> 'sensitive')::boolean, false))
        on conflict (user_id, question_hash) do update
          set answer = excluded.answer, question_text = excluded.question_text;
      end if;
    end loop;
  elsif p_outcome = 'needs_input' then
    if v_status = 'submitting' then
      update public.applications set status = 'needs_input', updated_by = 'extension' where id = p_application_id;
    end if;
    update public.applications
    set needs = jsonb_build_object(
          'reason', v_reason,
          'questions', case when jsonb_typeof(p_detail -> 'questions') = 'array'
                            then (select coalesce(jsonb_agg(q), '[]'::jsonb) from (
                                    select value as q from jsonb_array_elements(p_detail -> 'questions') limit 30) x)
                            else '[]'::jsonb end,
          'at', now()),
        last_error = nullif(v_reason, '')
    where id = p_application_id;
  else
    if v_status = 'submitting' then
      update public.applications set status = 'failed', updated_by = 'extension', last_error = nullif(v_reason, '')
      where id = p_application_id;
    end if;
  end if;
end;
$$;

-- The master resume and contact details, for "Fill this page" on any supported form.
create or replace function public.ext_profile(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.connection_user(p_token, 'extension');
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where user_id = v_user;
  return jsonb_build_object(
    'resume', (select r.content from public.resumes r where r.user_id = v_user and r.is_master),
    'profile', jsonb_build_object(
      'full_name', v_profile.full_name, 'email', v_profile.email,
      'phone', v_profile.phone, 'location', v_profile.location
    ),
    'accept_privacy', coalesce((v_profile.preferences ->> 'autopilot_accept_privacy')::boolean, false)
  );
end;
$$;

-- Remembers answers the user typed on a form filled with "Fill this page".
create or replace function public.ext_learn(p_token text, p_answers jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.connection_user(p_token, 'extension');
  v_item jsonb;
  v_saved integer := 0;
begin
  if jsonb_typeof(p_answers) <> 'array' or pg_column_size(p_answers) > 65536 then
    raise exception 'answers must be a small array' using errcode = 'check_violation';
  end if;
  for v_item in select value from jsonb_array_elements(p_answers) limit 50 loop
    if (v_item ->> 'hash') ~ '^[0-9a-f]{64}$'
       and length(coalesce(v_item ->> 'question', '')) between 1 and 2000
       and jsonb_typeof(v_item -> 'answer') in ('string', 'array')
       and pg_column_size(v_item -> 'answer') <= 4096 then
      insert into public.screening_answers (user_id, question_hash, question_text, answer, is_sensitive)
      values (v_user, v_item ->> 'hash', v_item ->> 'question', v_item -> 'answer',
              coalesce((v_item ->> 'sensitive')::boolean, false))
      on conflict (user_id, question_hash) do update
        set answer = excluded.answer, question_text = excluded.question_text;
      v_saved := v_saved + 1;
    end if;
  end loop;
  return v_saved;
end;
$$;

------------------------------------------------------------------------------
-- Gmail reply tracking (called by a script in the user's own Google account)
------------------------------------------------------------------------------

-- Each event: {message_id, from, subject, kind: received|interview|rejection|offer}.
-- Only the sender and subject arrive here, never the email body. An event is
-- matched to an application whose company appears in the sender or subject.
create or replace function public.gmail_ingest(p_token text, p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.connection_user(p_token, 'gmail');
  v_event jsonb;
  v_kind text;
  v_text text;
  v_app public.applications%rowtype;
  v_matched integer := 0;
begin
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'events must be an array' using errcode = 'check_violation';
  end if;

  for v_event in select value from jsonb_array_elements(p_events) limit 50 loop
    v_kind := v_event ->> 'kind';
    continue when v_kind is null or v_kind not in ('received', 'interview', 'rejection', 'offer');
    continue when coalesce(v_event ->> 'message_id', '') !~ '^[A-Za-z0-9_.@<>-]{1,200}$';
    continue when exists (
      select 1 from public.application_events e
      where e.user_id = v_user and e.type = 'email' and e.payload ->> 'message_id' = v_event ->> 'message_id'
    );
    v_text := lower(left(coalesce(v_event ->> 'from', ''), 300) || ' ' || left(coalesce(v_event ->> 'subject', ''), 300));

    select a.* into v_app
    from public.applications a
    join public.jobs j on j.id = a.job_id
    where a.user_id = v_user
      and a.status in ('submitting', 'applied', 'interviewing', 'offer')
      and length(j.company) >= 3
      and v_text ~ ('\m' || regexp_replace(lower(j.company), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M')
    order by a.applied_at desc nulls last
    limit 1;
    continue when not found;

    insert into public.application_events (application_id, user_id, type, actor, payload)
    values (v_app.id, v_user, 'email', 'system', jsonb_build_object(
      'message_id', v_event ->> 'message_id',
      'kind', v_kind,
      'subject', left(coalesce(v_event ->> 'subject', ''), 200),
      'from', left(coalesce(v_event ->> 'from', ''), 200)
    ));
    v_matched := v_matched + 1;

    if v_kind = 'interview' and v_app.status = 'applied' then
      update public.applications set status = 'interviewing', updated_by = 'system' where id = v_app.id;
    elsif v_kind = 'offer' and v_app.status in ('applied', 'interviewing') then
      update public.applications set status = 'offer', updated_by = 'system' where id = v_app.id;
    elsif v_kind = 'rejection' and v_app.status in ('applied', 'interviewing', 'offer') then
      update public.applications set status = 'rejected', updated_by = 'system' where id = v_app.id;
    end if;
  end loop;

  return v_matched;
end;
$$;

------------------------------------------------------------------------------
-- Grants
------------------------------------------------------------------------------

revoke all on function public.create_connection_token(text) from public, anon;
revoke all on function public.revoke_connection_token(text) from public, anon;
revoke all on function public.connection_user(text, text) from public, anon, authenticated;
revoke all on function public.ext_status(text) from public;
revoke all on function public.ext_next_application(text) from public;
revoke all on function public.ext_answers(text) from public;
revoke all on function public.ext_report(text, uuid, text, jsonb) from public;
revoke all on function public.gmail_ingest(text, jsonb) from public;
revoke all on function public.ext_profile(text) from public;
revoke all on function public.ext_learn(text, jsonb) from public;

grant execute on function public.create_connection_token(text) to authenticated;
grant execute on function public.revoke_connection_token(text) to authenticated;
-- Token-authenticated: the extension and the Gmail script use the public anon key.
grant execute on function public.ext_status(text) to anon, authenticated;
grant execute on function public.ext_next_application(text) to anon, authenticated;
grant execute on function public.ext_answers(text) to anon, authenticated;
grant execute on function public.ext_report(text, uuid, text, jsonb) to anon, authenticated;
grant execute on function public.gmail_ingest(text, jsonb) to anon, authenticated;
grant execute on function public.ext_profile(text) to anon, authenticated;
grant execute on function public.ext_learn(text, jsonb) to anon, authenticated;

commit;

-- ===== migrations/20261112000000_my_data.sql =====
begin;

-- Orbit 0008: your data. Export everything Orbit stores about you as one JSON
-- document, or delete your account and all of it.

-- Everything that belongs to the caller. Runs as the caller, so Row Level
-- Security limits it to their own rows; token hashes are left out.
create or replace function public.export_my_data()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'format', 'orbit-export-v1',
    'profile', (select to_jsonb(p) from public.profiles p where p.user_id = auth.uid()),
    'resumes', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.resumes r where r.user_id = auth.uid()), '[]'::jsonb),
    'tailored_versions', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at) from public.resume_variants v where v.user_id = auth.uid()), '[]'::jsonb),
    'applications', coalesce((
      select jsonb_agg(to_jsonb(a) || jsonb_build_object('job', jsonb_build_object(
               'title', j.title, 'company', j.company, 'location', j.location,
               'apply_url', j.apply_url, 'source', j.source, 'posted_at', j.posted_at))
             order by a.created_at)
      from public.applications a join public.jobs j on j.id = a.job_id
      where a.user_id = auth.uid()
    ), '[]'::jsonb),
    'application_events', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.application_events e where e.user_id = auth.uid()), '[]'::jsonb),
    'swipes', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.swipes s where s.user_id = auth.uid()), '[]'::jsonb),
    'screening_answers', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at) from public.screening_answers q where q.user_id = auth.uid()), '[]'::jsonb),
    'watched_companies', coalesce((select jsonb_agg(to_jsonb(w)) from public.watched_companies w where w.user_id = auth.uid()), '[]'::jsonb),
    'ai_calls', coalesce((select jsonb_agg(jsonb_build_object('kind', c.kind, 'created_at', c.created_at)) from public.llm_calls c where c.user_id = auth.uid()), '[]'::jsonb),
    'connections', coalesce((
      select jsonb_agg(jsonb_build_object('kind', t.kind, 'created_at', t.created_at, 'last_used_at', t.last_used_at, 'revoked_at', t.revoked_at))
      from public.connection_tokens t where t.user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

-- Deletes the caller's sign-in and, through cascading foreign keys, every
-- row that belongs to them. Shared job postings are not personal data and stay.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'sign in required' using errcode = 'insufficient_privilege';
  end if;
  delete from auth.users where id = v_user;
end;
$$;

revoke all on function public.export_my_data() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.delete_my_account() to authenticated;

commit;

-- ===== migrations/20261113000000_job_categories_finance_legal_health.sql =====
-- Orbit 0009: categories for roles in other fields that use CS skills,
-- kept apart from the computer-science categories.
--   finance          : risk, investment, banking, financial analyst, fintech operations
--   legal_compliance : legal engineer / technologist, compliance, KYC/AML, privacy, regulatory
--   health_bio       : bioinformatics, computational biology, clinical and health data
-- Values are appended (Postgres enums only grow at the end); mirrors packages/core JOB_CATEGORIES.

alter type public.job_category add value if not exists 'finance';
alter type public.job_category add value if not exists 'legal_compliance';
alter type public.job_category add value if not exists 'health_bio';
