# Credits

Orbit borrows ideas and approaches from these open-source projects.

## Code and approaches (MIT)

- **[career-ops](https://github.com/career-ops-hq/career-ops)**, MIT License,
  Copyright (c) 2026 Santiago Fernández de Valderrama.
  The Amazon jobs connector (`packages/ingest/src/sources/amazon.ts`) follows its
  amazon.jobs approach (bracket-form facet filters, offset paging).
- **[Jobs_Applier_AI_Agent](https://github.com/feder-cr/Jobs_Applier_AI_Agent)**, MIT License.
  Per-site application form notes will inform the autofill adapters (Batch 5).

MIT License text, as required for the projects above:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify,
> merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to the following
> conditions: The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
> WITHOUT WARRANTY OF ANY KIND.

## Libraries

Built on open-source libraries including [Next.js](https://nextjs.org),
[Supabase](https://supabase.com), [Motion](https://motion.dev) (MIT) for animation,
[dnd-kit](https://dndkit.com) (MIT) for drag and drop, [Tailwind CSS](https://tailwindcss.com),
[Lucide](https://lucide.dev) icons, [Zod](https://zod.dev), [pdf-lib](https://pdf-lib.js.org) (MIT)
for resume PDFs, and [esbuild](https://esbuild.github.io) (MIT) to build the extension.

## Ideas only (no code copied)

- **[Dossier](https://github.com/AienTech/dossier)** (AGPL-3.0): product ideas such as
  email reply tracking and requirement-by-requirement fit.

## Job data

Jobs come from public company career-site APIs (Greenhouse, Lever, Ashby, Workday,
SmartRecruiters, Recruitee, amazon.jobs) and from free job board APIs. Each job links back
to its original listing. Aggregator credits:
[Arbeitnow](https://www.arbeitnow.com), [Remotive](https://remotive.com),
[Adzuna](https://www.adzuna.com).
