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
- **Match filter**: once your resume is saved, every Discover card shows a match score,
  and you can hide jobs below 30, 50 or 70%.
- **Settings**: your daily apply limit (up to 200) and today's AI usage are on Profile.

- **Autopilot** (Chrome extension): opens queued Greenhouse, Lever and Ashby applications,
  fills them from your tailored resume (uploaded as a real PDF) and saved answers, and
  submits them, one at a time, 3 minutes apart, up to your daily limit. Review mode fills
  and waits for you to press Submit. "Fill this page" fills any supported form you open.
- **Inbox**: questions the autopilot couldn't answer, CAPTCHAs and failed submissions.
  Answer once; the answer memory reuses it on every form. Visa, work-authorization and
  diversity questions are only ever filled from your own saved answers.
- **Gmail reply tracking**: a small script in your own Google account moves applications to
  Interviewing, Offer or Rejected when companies reply. Only sender and subject reach Orbit.

- **Your data**: Profile → Your data downloads everything Orbit stores about you as one
  JSON file, or deletes your account and all of it (shared job postings stay).
- **Offline**: installed as an app, pages you've opened stay viewable without a connection;
  others show an offline screen. Saved pages are cleared when you sign out.
- **Accessibility**: keyboard-first (skip link, visible focus, keyboard swiping and a
  "Move to" menu instead of drag), screen-reader labels, reduced-motion support, and colors
  that meet WCAG AA contrast in light and dark. Every page passes an axe audit.

## Layout

```
apps/web          Next.js 15 app (web + installable PWA)
apps/extension    Chrome extension: the autopilot (Manifest V3)
packages/core     Shared domain logic: state machine, resume engine, form matching, PDF
packages/ingest   Job ingestion CLI (runs on GitHub Actions)
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
them. Orbit allows 200 AI rewrites a day (400 for the whole app), enforced in the database;
in practice the provider's free quota is the limit. When the main model is rate-limited,
Orbit retries once on a lighter free model (`LLM_FALLBACK_MODEL` to change it). Asking again
for the same job reuses the earlier answer, so it costs no quota.

## Autopilot extension (free)

The Chrome Web Store charges a fee, so the extension is loaded unpacked instead:

1. Run `npm run build -w @orbit/extension`.
2. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick
   `apps/extension/dist`.
3. In Orbit, open Profile → Autopilot extension → **Connect extension**, copy the code,
   paste it into the extension's popup, and switch it on.

Chrome has to be open for it to run. It checks every minute, never solves CAPTCHAs, and
sends anything it can't finish to the Inbox. Rebuild and press reload on
`chrome://extensions` after pulling updates.

## Gmail reply tracking (free)

Profile → Gmail reply tracking → **Set up**. Paste the generated script into a new project
at script.google.com, run `setup` once and allow access. It runs every 30 minutes in your own
account, classifies job emails there, and sends Orbit only sender, subject and reply type.

## Storage

Tailored resumes are stored as small JSON rows, never as files: the PDF is made on demand.
Each job keeps one working version (saving replaces it); the version you actually applied
with is kept permanently. Drafts for jobs rejected or archived more than 60 days ago are
removed when you next save.

## Checks

```bash
npm run typecheck
npm test
npm run build
```
