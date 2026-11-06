-- Orbit database setup for a NEW, empty Supabase project: paste into SQL Editor and Run.
-- Existing projects: run only the migration files you haven't run yet.
-- Generated from supabase/migrations.

begin;

-- ===== migrations/20261105000000_profiles.sql =====
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

-- ===== migrations/20261105000100_jobs_pipeline.sql =====
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

-- Enum additions must run outside the transaction above.

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
