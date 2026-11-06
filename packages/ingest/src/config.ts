/**
 * What to ingest. Every board below was checked live on 2026-11-05.
 * Users add more companies through their watchlist (watched_companies);
 * those are merged in at run time.
 */

import type { AmazonConfig } from "./sources/amazon";
import type { SmartRecruitersConfig } from "./sources/smartrecruiters";
import type { WorkdayConfig } from "./sources/workday";

export interface IngestConfig {
  greenhouse: { token: string; name: string }[];
  lever: { token: string; name: string; region?: "global" | "eu" }[];
  ashby: { token: string; name: string }[];
  recruitee: { token: string; name: string }[];
  smartrecruiters: SmartRecruitersConfig[];
  workday: WorkdayConfig[];
  amazon: AmazonConfig | null;
  arbeitnow: { maxPages: number } | null;
  remotive: { categories?: string[] } | null;
  adzuna: { countries: string[]; what: string; pagesPerCountry: number } | null;
  /** Closed jobs nobody applied to are deleted after this many days. */
  retentionDays: number;
  /** Sources fetched in parallel. */
  concurrency: number;
  /** A source that takes longer is cancelled and recorded as failed. */
  sourceTimeoutMs: number;
}

export const DEFAULT_CONFIG: IngestConfig = {
  greenhouse: [
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
  ],
  lever: [
    { token: "spotify", name: "Spotify" },
    { token: "palantir", name: "Palantir" },
    { token: "pigment", name: "Pigment" },
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
  ],
  recruitee: [{ token: "bunq", name: "bunq" }],
  smartrecruiters: [{ token: "BoschGroup", name: "Bosch", query: "software", max: 150 }],
  workday: [
    { name: "NVIDIA", host: "nvidia.wd5.myworkdayjobs.com", tenant: "nvidia", site: "NVIDIAExternalCareerSite", searchText: "software engineer", max: 150 },
    { name: "Salesforce", host: "salesforce.wd12.myworkdayjobs.com", tenant: "salesforce", site: "External_Career_Site", searchText: "software engineer", max: 150 },
    { name: "Workday", host: "workday.wd5.myworkdayjobs.com", tenant: "workday", site: "Workday", searchText: "software engineer", max: 100 },
  ],
  amazon: {
    countries: ["DEU", "GBR", "IRL", "NLD", "FRA", "ESP", "ITA", "POL", "HUN", "AUT", "CZE", "ROU", "LUX"],
    categories: ["software-development"],
    max: 400,
  },
  arbeitnow: { maxPages: 3 },
  remotive: {},
  adzuna: { countries: ["de", "gb", "nl", "fr", "at", "pl"], what: "software engineer", pagesPerCountry: 2 },
  retentionDays: 30,
  concurrency: 4,
  sourceTimeoutMs: 180_000,
};
