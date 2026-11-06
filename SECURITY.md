# Security

Orbit stores CVs and personal details for a small invited group. This file is
the threat model: what is exposed, and what protects it. Update it whenever a
new entry point is added.

## Entry points and protections

| Entry point | Who can reach it | Protection |
|---|---|---|
| Web app (Next.js) | Anyone with the URL | Every page except `/login` and `/auth/*` requires a verified session (middleware calls `getUser()`). Strict security headers and CSP. `?next=` redirects only to same-site paths. Sign-out is POST-only. |
| Sign-in form | Anyone | Invite-only: public sign-up is disabled in Supabase and the app never creates users. Unknown emails get the same response as known ones (no account discovery). Supabase rate-limits sign-in emails. |
| Supabase REST/Realtime API (publishable key) | Anyone, since the key is public by design | Row Level Security on every table. Users see and change only their own rows; jobs and source health are read-only. Ingest functions are not executable by `anon` or `authenticated`. App functions (`discover_feed`, `record_swipe`, `undo_swipe`, `my_pipeline`, `my_activity`) run as the caller (`security invoker`), are revoked from `anon`, and cap page sizes and date ranges. Status changes are validated by a trigger, so a client cannot skip the pipeline. Realtime streams `applications` changes, filtered by the same RLS policies. |
| Ingest job (GitHub Actions) | Only the scheduled workflow | Uses the service-role key from GitHub encrypted secrets; it never ships to the browser or the repo. Fetches only fixed job-board hosts, never URLs typed by users (no SSRF). Watchlist board tokens are restricted to `[A-Za-z0-9._-]`. |
| Job content from third parties | Shown to users | HTML is converted to plain text before storage and rendered as text by React (no stored XSS). Apply links must be `http(s)://` and open with `rel="noopener noreferrer"`. |
| Server actions (swipe, move, load more) | Signed-in users | Every input is validated with zod (UUIDs, enums, preset filter keys); free-text search is capped at 100 characters and parsed by Postgres `websearch_to_tsquery`, never concatenated into SQL. Next.js checks the request origin on every action. Errors are logged server-side; users see a short message. |
| Browser extension (Batch 5) | The user's own browser | Will accept messages only from the Orbit origin and act only on known ATS hosts. |

## Limits against abuse

- Database caps: text lengths, salary ranges and URL schemes are constrained in SQL.
- Per-user daily limits for the costly actions (AI tailoring, submissions) arrive with those features, enforced in the database, so they also protect the free AI quota.
- Hosting: Vercel and Supabase both provide network-level DDoS protection on free plans.

## Secrets

- `apps/web/.env.local` and `packages/ingest/.env` are git-ignored.
- The Supabase **secret / service_role** key is only ever stored as a GitHub Actions secret.
- Never paste secret keys into issues, chats or code.

## Dependencies

Dependabot opens weekly update PRs. Run `npm audit --omit=dev` before deploying.

## Reporting

Contact the repository owner privately.
