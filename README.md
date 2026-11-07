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
- **Resume**: a master resume editor (contact, summary, education, experience, projects,
  skills) with a health checklist, paste-to-import (text copied from a PDF or Word file, or
  JSON Resume), and a one-column ATS-friendly layout you can save as PDF from the print dialog.
- **Tailoring**: from any Pipeline card ("Tailor CV"), Orbit scores how well your resume
  matches the post, shows matched and missing skills, reorders your bullets, projects and
  skills by relevance, and lets you drop lines. Optional AI rewording uses a free provider.
  Every reworded line is fact-checked against your master: a rewrite that adds a number,
  a skill or a name you didn't write is blocked and the original line is kept. Each change
  shows as a word-level diff. Saved versions attach to the application.

Still to come: the autopilot browser extension, the inbox.

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

## Optional: AI rewording (free)

Tailoring works without any AI. To add AI rewording, pick one free provider and add two
lines to `apps/web/.env.local` (server-only; never prefix these with `NEXT_PUBLIC_`):

| Provider | Get a key | `.env.local` |
|---|---|---|
| Groq (recommended) | console.groq.com → API Keys (free, no card) | `LLM_PROVIDER=groq` and `LLM_API_KEY=...` |
| Google Gemini | aistudio.google.com → Get API key (free tier) | `LLM_PROVIDER=gemini` and `LLM_API_KEY=...` |
| Ollama (fully local, private) | install from ollama.com, then `ollama pull llama3.1:8b` | `LLM_PROVIDER=ollama` |

`LLM_MODEL` overrides the default model if a provider renames or retires it. Only your
bullets, summary and the job post are sent: never your name, email, phone or links.
Google's free tier may use prompts to improve its products; Groq and Ollama don't train on
them. Each person gets 30 AI rewrites a day and the whole app 300, enforced in the database.

## Checks

```bash
npm run typecheck
npm test
npm run build
```
