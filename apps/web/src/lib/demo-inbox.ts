import type { InboxItem, MemoryItem } from "@/lib/inbox.server";
import { DEMO_JOBS } from "@/lib/demo";

/** Sample Inbox for preview mode. Companies are fictional. */
const HOUR = 3_600_000;
const at = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

export const DEMO_INBOX: InboxItem[] = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    status: "needs_input",
    title: DEMO_JOBS[4]!.title,
    company: DEMO_JOBS[4]!.company,
    applyUrl: DEMO_JOBS[4]!.applyUrl,
    reason: "3 questions need your answer",
    questions: [
      { text: "Will you now or in the future require visa sponsorship to work in the Netherlands?", type: "select", options: ["Yes", "No"], required: true },
      { text: "What is your earliest start date?", type: "text", required: true },
      { text: "Which of these languages do you speak fluently?", type: "checkbox", options: ["English", "Dutch", "German", "Hungarian"], required: false },
    ],
    updatedAt: at(2),
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    status: "needs_input",
    title: DEMO_JOBS[1]!.title,
    company: DEMO_JOBS[1]!.company,
    applyUrl: DEMO_JOBS[1]!.applyUrl,
    reason: "A CAPTCHA appeared. Solve it in the open tab and press Submit.",
    questions: [],
    updatedAt: at(5),
  },
];

export const DEMO_MEMORY: MemoryItem[] = [
  { id: "m1", question: "Are you legally authorized to work in the European Union?", answer: "Yes", sensitive: true, updatedAt: at(30) },
  { id: "m2", question: "How did you hear about this job?", answer: "Company website", sensitive: false, updatedAt: at(50) },
  { id: "m3", question: "What is your notice period?", answer: "Available immediately", sensitive: true, updatedAt: at(70) },
];
