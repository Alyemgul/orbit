# Orbit

Swipe to apply. Orbit pulls jobs from company career sites and job boards, tailors your
resume for each one, submits the application, and keeps your pipeline up to date.

## Layout

```
apps/web          Next.js 15 app (web + installable PWA)
packages/core     Shared domain logic: application state machine, schemas
supabase/         Database migrations (Postgres + Row Level Security)
```

## Run locally

Requires Node 20.11+.

```bash
npm install
npm run dev        # http://localhost:3000
```

Without Supabase keys the app runs in **preview mode**: every screen works, sign-in and
saving are off.

## Connect Supabase (free tier)

1. Create a project at supabase.com.
2. In the SQL editor, run each file in `supabase/migrations/` in order.
3. Authentication → URL Configuration: set Site URL to `http://localhost:3000` (and your
   deployed URL later), and add `http://localhost:3000/auth/callback` to Redirect URLs.
4. Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in the project URL and
   anon/publishable key from Project Settings → API.
5. Optional: set `ALLOWED_EMAILS` to an invite list for you and your friends.

Restart `npm run dev` after editing `.env.local`.

## Checks

```bash
npm run typecheck
npm test
npm run build
```
