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
