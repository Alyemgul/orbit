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
