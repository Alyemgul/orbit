# Orbit

Swipe to apply. Orbit pulls jobs from company career sites and job boards, tailors your
resume for each one, submits the application, and keeps your pipeline up to date.

## What works today

- **Discover**: a swipe deck of fresh jobs. Right = apply (queues it), up = save, left = skip,
  with undo. Keyboard: arrow keys, `Z` to undo, `Enter` for details. Filters for region
  (Europe, Japan, Korea, Singapore, Australia, visa sponsored), level (new grad, internships)
  and field (software, data, quant, tech & business). A list view for fast triage.
- **Pipeline**: a live board (Saved → Applying → Applied → Interviewing → Offer). Drag
  cards, or use each card's "Move to" menu. Changes from other devices show up instantly.
- **Stats**: a ring of where your applications stand, and a year of daily activity with streaks.
- **Daily cap**: right swipes past your cap (15 a day by default) are saved instead.

Still to come: resume tailoring, the autopilot browser extension, the inbox.

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

Without Supabase keys the app runs in **preview mode**: every screen works with sample
jobs; sign-in and saving are off.

## Connect Supabase (free tier)

1. Create a project at supabase.com.
2. In the SQL editor, run `supabase/setup.sql` (a new project), or each file in
   `supabase/migrations/` you haven't run yet, in order.
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
