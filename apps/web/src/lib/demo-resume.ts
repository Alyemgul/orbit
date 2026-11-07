import { readResume, type Resume } from "@orbit/core";

/** A fictional student's resume for preview mode. Edits stay in this browser. */
export const DEMO_RESUME: Resume = {
  version: 1,
  basics: {
    name: "Alex Novak",
    headline: "Computer Science & Engineering student, graduating June 2027",
    email: "alex.novak@example.com",
    phone: "",
    location: "Budapest, Hungary",
    links: [{ label: "GitHub", url: "github.com/example" }],
  },
  summary: "Final-year CSE student who enjoys backend systems and data. Interned on a payments team and built a C++ order book in my spare time.",
  sections: [
    {
      id: "sedu",
      kind: "education",
      title: "Education",
      entries: [
        {
          id: "eedu",
          title: "BSc Computer Science & Engineering",
          org: "Budapest University of Technology",
          location: "Budapest",
          dates: "2023 – 2027",
          link: "",
          bullets: [{ id: "bedu1", text: "GPA 4.5/5; coursework in algorithms, operating systems, databases and statistics" }],
        },
      ],
    },
    {
      id: "sexp",
      kind: "experience",
      title: "Experience",
      entries: [
        {
          id: "eint",
          title: "Software Engineering Intern",
          org: "Riverline Payments",
          location: "Budapest",
          dates: "Jun 2025 – Sep 2025",
          link: "",
          bullets: [
            { id: "bint1", text: "Organised weekly demo sessions for the intern cohort" },
            { id: "bint2", text: "Built a Python service that reconciles card settlements, cutting manual checks by 40%" },
            { id: "bint3", text: "Wrote REST endpoints in TypeScript and added integration tests that run in CI/CD" },
            { id: "bint4", text: "Moved two cron jobs into Docker containers deployed on AWS" },
          ],
        },
        {
          id: "eta",
          title: "Teaching Assistant, Data Structures",
          org: "Budapest University of Technology",
          location: "Budapest",
          dates: "Feb 2025 – Present",
          link: "",
          bullets: [{ id: "bta1", text: "Run weekly labs for 30 students on graphs, heaps and hashing in Java" }],
        },
      ],
    },
    {
      id: "sproj",
      kind: "projects",
      title: "Projects",
      entries: [
        {
          id: "pweb",
          title: "Study planner",
          org: "React, Next.js, PostgreSQL",
          location: "",
          dates: "2024",
          link: "",
          bullets: [{ id: "bweb1", text: "Built a study planner used by 120 classmates, with PostgreSQL and a Next.js front end" }],
        },
        {
          id: "pbook",
          title: "Limit order book",
          org: "C++",
          location: "",
          dates: "2025",
          link: "",
          bullets: [{ id: "bbook1", text: "Implemented a C++ matching engine handling 1M orders per second with lock-free queues" }],
        },
      ],
    },
  ],
  skills: [
    { id: "klang", name: "Languages", items: ["Java", "Python", "TypeScript", "C++", "SQL"] },
    { id: "ktool", name: "Tools", items: ["Docker", "AWS", "Git", "Linux", "PostgreSQL", "React"] },
  ],
};

const STORAGE_KEY = "orbit-demo-resume";

/** The preview-mode master resume: the browser copy if there is one. */
export function loadDemoResume(): Resume {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return readResume(JSON.parse(raw)) ?? DEMO_RESUME;
  } catch {
    // Storage blocked or corrupt: fall back to the sample.
  }
  return DEMO_RESUME;
}

export function saveDemoResume(resume: Resume): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(resume));
    return true;
  } catch {
    return false;
  }
}
