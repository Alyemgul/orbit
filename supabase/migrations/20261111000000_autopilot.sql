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
