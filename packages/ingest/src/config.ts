/**
 * What to ingest. Every board below was checked live (2026-11-05/06).
 * Users add more companies through their watchlist (watched_companies);
 * those are merged in at run time.
 */

import type { ScopeRule } from "@orbit/core";
import type { AmazonConfig } from "./sources/amazon";
import type { MyCareersFutureConfig } from "./sources/mycareersfuture";
import type { SmartRecruitersConfig } from "./sources/smartrecruiters";
import type { WorkdayConfig } from "./sources/workday";

export interface IngestConfig {
  greenhouse: { token: string; name: string }[];
  lever: { token: string; name: string; region?: "global" | "eu" }[];
  ashby: { token: string; name: string }[];
  recruitee: { token: string; name: string }[];
  smartrecruiters: SmartRecruitersConfig[];
  workday: WorkdayConfig[];
  amazon: AmazonConfig[];
  myCareersFuture: MyCareersFutureConfig | null;
  arbeitnow: { maxPages: number } | null;
  remotive: { categories?: string[] } | null;
  adzuna: { countries: string[]; what: string; pagesPerCountry: number } | null;
  /**
   * Only jobs in these regions are stored, plus visa-sponsored jobs anywhere.
   * Owner's search: Europe (new grad first), Japan/Korea/Singapore, Australia.
   */
  scope: ScopeRule;
  /** Closed jobs nobody applied to are deleted after this many days. */
  retentionDays: number;
  /** Sources fetched in parallel. */
  concurrency: number;
  /** A source that takes longer is cancelled and recorded as failed. */
  sourceTimeoutMs: number;
}

/** Titles worth pulling from huge bank boards: graduate schemes, engineering, quant, tech analyst. */
const BANK_SEARCHES = [
  "graduate",
  "technology analyst",
  "software engineer",
  "developer",
  "quant",
  "data engineer",
];

function bank(name: string, host: string, tenant: string, site: string): WorkdayConfig {
  return { name, host, tenant, site, searches: BANK_SEARCHES, maxPerSearch: 60, max: 300 };
}

export const DEFAULT_CONFIG: IngestConfig = {
  greenhouse: [
    // Tech, Europe-heavy
    { token: "stripe", name: "Stripe" },
    { token: "figma", name: "Figma" },
    { token: "cloudflare", name: "Cloudflare" },
    { token: "databricks", name: "Databricks" },
    { token: "gitlab", name: "GitLab" },
    { token: "airbnb", name: "Airbnb" },
    { token: "datadog", name: "Datadog" },
    { token: "n26", name: "N26" },
    { token: "celonis", name: "Celonis" },
    { token: "hellofresh", name: "HelloFresh" },
    { token: "contentful", name: "Contentful" },
    { token: "wolt", name: "Wolt" },
    { token: "trivago", name: "trivago" },
    { token: "sumup", name: "SumUp" },
    { token: "getyourguide", name: "GetYourGuide" },
    { token: "mongodb", name: "MongoDB" },
    { token: "elastic", name: "Elastic" },
    { token: "twilio", name: "Twilio" },
    { token: "grafanalabs", name: "Grafana Labs" },
    { token: "canonical", name: "Canonical" },
    { token: "wise", name: "Wise" },
    { token: "monzo", name: "Monzo" },
    { token: "adyen", name: "Adyen" },
    // Trading firms (London, Amsterdam, Singapore, Hong Kong, Sydney)
    { token: "optiverus", name: "Optiver" },
    { token: "imc", name: "IMC Trading" },
    { token: "janestreet", name: "Jane Street" },
    { token: "jumptrading", name: "Jump Trading" },
    { token: "wehrtyou", name: "Hudson River Trading" },
    { token: "drweng", name: "DRW" },
    { token: "flowtraders", name: "Flow Traders" },
    { token: "towerresearchcapital", name: "Tower Research Capital" },
    { token: "squarepointcapital", name: "Squarepoint Capital" },
    // Korea, Japan, Southeast Asia
    { token: "coupang", name: "Coupang" },
    { token: "krafton", name: "KRAFTON" },
    { token: "moloco", name: "Moloco" },
    { token: "paypay", name: "PayPay" },
    { token: "xendit", name: "Xendit" },
  ],
  lever: [
    { token: "spotify", name: "Spotify" },
    { token: "palantir", name: "Palantir" },
    { token: "pigment", name: "Pigment" },
    { token: "woven-by-toyota", name: "Woven by Toyota" },
    { token: "ninjavan", name: "Ninja Van" },
  ],
  ashby: [
    { token: "openai", name: "OpenAI" },
    { token: "notion", name: "Notion" },
    { token: "linear", name: "Linear" },
    { token: "ramp", name: "Ramp" },
    { token: "supabase", name: "Supabase" },
    { token: "cursor", name: "Cursor" },
    { token: "elevenlabs", name: "ElevenLabs" },
    { token: "n8n", name: "n8n" },
    { token: "clickhouse", name: "ClickHouse" },
    { token: "posthog", name: "PostHog" },
    { token: "airwallex", name: "Airwallex" },
  ],
  recruitee: [{ token: "bunq", name: "bunq" }],
  smartrecruiters: [{ token: "BoschGroup", name: "Bosch", query: "software", max: 150 }],
  workday: [
    { name: "NVIDIA", host: "nvidia.wd5.myworkdayjobs.com", tenant: "nvidia", site: "NVIDIAExternalCareerSite", searches: ["software engineer", "new college grad"], max: 150 },
    { name: "Salesforce", host: "salesforce.wd12.myworkdayjobs.com", tenant: "salesforce", site: "External_Career_Site", searches: ["software engineer", "graduate"], max: 150 },
    { name: "Workday", host: "workday.wd5.myworkdayjobs.com", tenant: "workday", site: "Workday", searches: ["software engineer"], max: 100 },
    // Banks and market infrastructure: big tech centres in Budapest, Warsaw, London, Singapore
    bank("Morgan Stanley", "ms.wd5.myworkdayjobs.com", "ms", "External"),
    bank("Citi", "citi.wd5.myworkdayjobs.com", "citi", "2"),
    bank("Deutsche Bank", "db.wd3.myworkdayjobs.com", "db", "DBWebsite"),
    bank("BlackRock", "blackrock.wd1.myworkdayjobs.com", "blackrock", "BlackRock_Professional"),
    bank("LSEG", "lseg.wd3.myworkdayjobs.com", "lseg", "Careers"),
    bank("State Street", "statestreet.wd1.myworkdayjobs.com", "statestreet", "Global"),
    bank("Barclays", "barclays.wd3.myworkdayjobs.com", "barclays", "External_Career_Site_Barclays"),
  ],
  amazon: [
    {
      id: "europe",
      countries: ["DEU", "GBR", "IRL", "NLD", "FRA", "ESP", "ITA", "POL", "HUN", "AUT", "CZE", "ROU", "LUX"],
      categories: ["software-development"],
      max: 400,
    },
    {
      id: "asia-pacific",
      countries: ["JPN", "KOR", "SGP", "AUS", "NZL", "IND", "HKG", "TWN", "VNM", "MYS", "ARE", "ISR"],
      categories: ["software-development"],
      max: 500,
    },
  ],
  myCareersFuture: { searches: ["software engineer", "graduate", "developer", "data engineer", "quant"], pagesPerSearch: 2 },
  arbeitnow: { maxPages: 3 },
  remotive: {},
  adzuna: { countries: ["de", "gb", "nl", "fr", "at", "pl", "sg", "au"], what: "software engineer", pagesPerCountry: 2 },
  scope: { regions: ["europe", "asia", "oceania"], keepIfVisaSponsored: true, keepUnknownLocation: true },
  retentionDays: 30,
  concurrency: 4,
  sourceTimeoutMs: 240_000,
};
