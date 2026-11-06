import type { ActivityDay, FeedFilters, PipelineItem } from "@orbit/core";
import { FEED_CATEGORY_GROUPS, FEED_LEVELS, FEED_REGIONS } from "@orbit/core";
import type { FeedJob } from "@/lib/jobs/feed-job";
import { formatSalary } from "@/lib/jobs/format";

/**
 * Sample data for preview mode (no Supabase keys). Companies are fictional.
 * Nothing here is ever written anywhere; swipes stay in the browser tab.
 */

const HOUR = 3_600_000;

type DemoSeed = Omit<FeedJob, "id" | "postedAt" | "postedAtKnown" | "applyUrl" | "salaryPeriod" | "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryText"> & {
  hoursAgo: number;
  salary?: [number, number, string];
};

const SEEDS: DemoSeed[] = [
  {
    company: "Lumen Payments",
    title: "Software Engineer, New Grad 2027",
    location: "Dublin, Ireland",
    countryCodes: ["IE"],
    workplace: "hybrid",
    employmentType: "full_time",
    experienceLevel: "entry",
    category: "software_engineering",
    visaSponsorship: "yes",
    hoursAgo: 3,
    salary: [62_000, 78_000, "EUR"],
    description:
      "Join our graduate cohort and ship payments infrastructure used by millions of businesses.\n\nWhat you'll do\n- Build reliable APIs in Go and TypeScript\n- Own features end to end, from design doc to production\n- Pair with senior engineers through a 12-month mentorship track\n\nWho you are\n- Graduating in 2026 or 2027 with a degree in Computer Science or similar\n- Comfortable with one of Go, Java, Python or TypeScript\n- Curious about distributed systems\n\nWe sponsor work visas for this role.",
  },
  {
    company: "Kestrel Markets",
    title: "Graduate Quantitative Developer",
    location: "Amsterdam, Netherlands",
    countryCodes: ["NL"],
    workplace: "onsite",
    employmentType: "full_time",
    experienceLevel: "entry",
    category: "quant",
    visaSponsorship: "yes",
    hoursAgo: 6,
    salary: [85_000, 110_000, "EUR"],
    description:
      "Build the low-latency trading systems behind our market-making desks.\n\n- Modern C++ and Python\n- Work directly with traders on pricing and risk tools\n- Strong algorithms and data structures fundamentals\n\nRelocation and visa support provided.",
  },
  {
    company: "Northwind Bank",
    title: "Technology Analyst Graduate Programme",
    location: "Budapest, Hungary",
    countryCodes: ["HU"],
    workplace: "hybrid",
    employmentType: "full_time",
    experienceLevel: "entry",
    category: "tech_business",
    visaSponsorship: "unknown",
    hoursAgo: 20,
    description:
      "A two-year rotational programme across engineering, data and markets technology teams in our Budapest technology centre.\n\n- Rotations of 6 to 12 months\n- Java, Python and SQL\n- Training academy in your first month",
  },
  {
    company: "Fjord Analytics",
    title: "Junior Data Engineer",
    location: "Copenhagen, Denmark",
    countryCodes: ["DK"],
    workplace: "hybrid",
    employmentType: "full_time",
    experienceLevel: "entry",
    category: "data",
    visaSponsorship: "unknown",
    hoursAgo: 30,
    description: "Design data pipelines with Spark, dbt and Airflow for our energy-forecasting platform.",
  },
  {
    company: "Helio Robotics",
    title: "Machine Learning Engineer, Graduate",
    location: "Munich, Germany",
    countryCodes: ["DE"],
    workplace: "onsite",
    employmentType: "full_time",
    experienceLevel: "entry",
    category: "ml_ai",
    visaSponsorship: "yes",
    hoursAgo: 44,
    salary: [58_000, 70_000, "EUR"],
    description: "Train perception models for warehouse robots. PyTorch, computer vision, a bias for shipping.",
  },
  {
    company: "Polar Cloud",
    title: "Site Reliability Engineer, Early Career",
    location: "Remote, Europe",
    countryCodes: [],
    workplace: "remote",
    employmentType: "full_time",
    experienceLevel: "entry",
    category: "devops_sre",
    visaSponsorship: "unknown",
    hoursAgo: 52,
    description: "Keep a multi-region Kubernetes platform healthy. Linux, Terraform, on-call with a great runbook culture.",
  },
  {
    company: "Lumen Payments",
    title: "Software Engineering Intern, Summer 2027",
    location: "London, United Kingdom",
    countryCodes: ["GB"],
    workplace: "hybrid",
    employmentType: "internship",
    experienceLevel: "intern",
    category: "software_engineering",
    visaSponsorship: "unknown",
    hoursAgo: 8,
    description: "A 12-week internship building real product with a dedicated mentor.",
  },
  {
    company: "Sakura Mobility",
    title: "Backend Engineer (New Graduate)",
    location: "Tokyo, Japan",
    countryCodes: ["JP"],
    workplace: "hybrid",
    employmentType: "full_time",
    experienceLevel: "entry",
    category: "software_engineering",
    visaSponsorship: "yes",
    hoursAgo: 12,
    salary: [6_000_000, 8_000_000, "JPY"],
    description: "English-speaking engineering team building the backend of a ride-sharing platform. Kotlin and Go.",
  },
  {
    company: "Hanbit Games",
    title: "Game Server Engineer, Entry Level",
    location: "Seoul, South Korea",
    countryCodes: ["KR"],
    workplace: "onsite",
    employmentType: "full_time",
    experienceLevel: "entry",
    category: "software_engineering",
    visaSponsorship: "unknown",
    hoursAgo: 26,
    description: "Build the matchmaking and live-ops services for a global multiplayer title. C++ or C#.",
  },
  {
    company: "Merlion Pay",
    title: "Graduate Software Engineer",
    location: "Singapore",
    countryCodes: ["SG"],
    workplace: "hybrid",
    employmentType: "full_time",
    experienceLevel: "entry",
    category: "software_engineering",
    visaSponsorship: "unknown",
    hoursAgo: 15,
    salary: [5_500, 7_000, "SGD"],
    description: "Cross-border payments for Southeast Asia. Java, Spring and React.",
  },
  {
    company: "Southern Cross Data",
    title: "Graduate Data Analyst",
    location: "Sydney, Australia",
    countryCodes: ["AU"],
    workplace: "hybrid",
    employmentType: "full_time",
    experienceLevel: "entry",
    category: "data",
    visaSponsorship: "unknown",
    hoursAgo: 60,
    description: "SQL, Python and dashboards for our retail-analytics clients.",
  },
  {
    company: "Atlas Security",
    title: "Security Engineering Intern",
    location: "Warsaw, Poland",
    countryCodes: ["PL"],
    workplace: "hybrid",
    employmentType: "internship",
    experienceLevel: "intern",
    category: "security",
    visaSponsorship: "unknown",
    hoursAgo: 70,
    description: "Threat modelling, secure code review and building internal security tooling.",
  },
];

const BASE = Date.now();

export const DEMO_JOBS: FeedJob[] = SEEDS.map(({ hoursAgo, salary, ...seed }, index) => {
  const period = salary ? (salary[2] === "SGD" ? "month" : "year") : null;
  return {
  ...seed,
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  salaryMin: salary?.[0] ?? null,
  salaryMax: salary?.[1] ?? null,
  salaryCurrency: salary?.[2] ?? null,
  salaryPeriod: period,
  salaryText: salary ? formatSalary(salary[0], salary[1], salary[2], period) : null,
  applyUrl: "https://example.com/careers",
  postedAt: new Date(BASE - hoursAgo * HOUR).toISOString(),
  postedAtKnown: true,
  };
});

/** The same filtering discover_feed() does, for the sample jobs. */
export function demoFeed(filters: FeedFilters): FeedJob[] {
  const region = FEED_REGIONS[filters.region];
  const levels = FEED_LEVELS[filters.level].levels as readonly string[] | null;
  const categories = new Set<string>(filters.groups.flatMap((group) => FEED_CATEGORY_GROUPS[group].categories));
  const countries = region.countries as readonly string[] | null;
  const query = filters.query.toLowerCase();
  return DEMO_JOBS.filter(
    (job) =>
      (!countries ||
        job.countryCodes.some((code) => countries.includes(code)) ||
        (job.countryCodes.length === 0 && region.regionWord === "europe" && /europe/i.test(job.location))) &&
      (!levels || levels.includes(job.experienceLevel)) &&
      (categories.size === 0 || categories.has(job.category)) &&
      (!filters.remoteOnly || job.workplace === "remote") &&
      (filters.region !== "visa" || job.visaSponsorship === "yes") &&
      (!query || `${job.title} ${job.company} ${job.location}`.toLowerCase().includes(query)),
  ).sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

function demoItem(job: FeedJob, status: PipelineItem["status"], daysAgo: number): PipelineItem {
  const at = new Date(BASE - daysAgo * 24 * HOUR).toISOString();
  return {
    id: `10000000-0000-4000-8000-${job.id.slice(-12)}`,
    job_id: job.id,
    status,
    mode: "auto",
    applied_at: status === "applied" || status === "interviewing" ? at : null,
    last_error: null,
    updated_at: at,
    created_at: at,
    title: job.title,
    company: job.company,
    location: job.location,
    country_codes: job.countryCodes,
    workplace: job.workplace,
    experience_level: job.experienceLevel,
    category: job.category,
    apply_url: job.applyUrl,
    job_closed_at: null,
  };
}

export const DEMO_PIPELINE: PipelineItem[] = [
  demoItem(DEMO_JOBS[2]!, "saved", 1),
  demoItem(DEMO_JOBS[6]!, "saved", 2),
  demoItem(DEMO_JOBS[0]!, "queued", 0),
  demoItem(DEMO_JOBS[4]!, "needs_input", 1),
  demoItem(DEMO_JOBS[1]!, "applied", 4),
  demoItem(DEMO_JOBS[7]!, "applied", 6),
  demoItem(DEMO_JOBS[3]!, "interviewing", 9),
];

/** Deterministic pseudo-random activity for the heatmap preview. */
export function demoActivity(days = 182): ActivityDay[] {
  const result: ActivityDay[] = [];
  let seed = 7;
  const random = () => {
    seed = (seed * 16_807) % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  for (let offset = days - 1; offset >= 0; offset--) {
    const roll = random();
    if (roll < 0.45 && offset > 3) continue;
    const swipes = Math.round(random() * (offset < 30 ? 30 : 14));
    const day = new Date(BASE - offset * 24 * HOUR).toISOString().slice(0, 10);
    result.push({ day, swipes, applied: Math.round(swipes * random() * 0.3) });
  }
  return result;
}
