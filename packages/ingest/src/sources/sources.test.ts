import { describe, expect, it } from "vitest";
import { createHttpClient, redactUrl, type HttpClient } from "../http";
import { DEFAULT_CONFIG } from "../config";
import { amazonSource } from "./amazon";
import { ashbySource } from "./ashby";
import { greenhouseSource } from "./greenhouse";
import { buildSources } from "./index";
import { leverSource } from "./lever";
import type { SourceContext } from "./types";
import { workdaySource } from "./workday";

/** Fake HTTP client: answers by URL substring, records every request. */
function fakeHttp(routes: Record<string, unknown | ((body: unknown) => unknown)>) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const answer = (url: string, body?: unknown) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected request ${url}`);
    const route = routes[key];
    return typeof route === "function" ? (route as (b: unknown) => unknown)(body) : route;
  };
  const http: HttpClient = {
    async getJson(url) {
      calls.push({ method: "GET", url });
      return answer(url);
    },
    async postJson(url, body) {
      calls.push({ method: "POST", url, body });
      return answer(url, body);
    },
  };
  return { http, calls };
}

function ctx(http: HttpClient): SourceContext {
  return { http, signal: new AbortController().signal, log: { info() {}, warn() {}, error() {} } };
}

describe("greenhouse", () => {
  it("decodes double-escaped content and builds the canonical form URL", async () => {
    const { http } = fakeHttp({
      "boards-api.greenhouse.io/v1/boards/n26/jobs": {
        jobs: [
          {
            id: 8333692,
            title: "Backend Engineer",
            absolute_url: "https://n26.com/en-eu/careers/positions/8333692?gh",
            first_published: "2026-10-30T07:37:33-04:00",
            company_name: "N26",
            location: { name: "Paris" },
            offices: [{ name: "Paris", location: "Paris, Paris, France" }],
            metadata: [{ name: "Time Type", value: "Full time" }],
            content: "&lt;p&gt;Build &amp;amp; ship.&lt;/p&gt;",
          },
        ],
      },
    });
    const [job] = await greenhouseSource({ token: "n26", name: "N26" }).fetchJobs(ctx(http));
    expect(job).toMatchObject({
      sourceJobId: "8333692",
      company: "N26",
      countryCodes: ["FR"],
      descriptionHtml: "<p>Build &amp; ship.</p>",
      applyUrl: "https://job-boards.greenhouse.io/n26/jobs/8333692",
      employmentType: "full_time",
    });
  });
});

describe("lever", () => {
  it("joins lists into the description and maps salary and workplace", async () => {
    const { http, calls } = fakeHttp({
      "api.eu.lever.co/v0/postings/acme": [
        {
          id: "abc",
          text: "Platform Engineer",
          hostedUrl: "https://jobs.eu.lever.co/acme/abc",
          applyUrl: "https://jobs.eu.lever.co/acme/abc/apply",
          createdAt: 1792767640768,
          country: "DE",
          workplaceType: "hybrid",
          categories: { location: "Berlin", commitment: "Permanent" },
          description: "<p>Intro</p>",
          lists: [{ text: "You will", content: "<li>Build</li>" }],
          salaryRange: { min: 70000, max: 90000, currency: "EUR", interval: "per-year-salary" },
        },
      ],
    });
    const [job] = await leverSource({ token: "acme", name: "Acme", region: "eu" }).fetchJobs(ctx(http));
    expect(calls[0]?.url).toContain("api.eu.lever.co");
    expect(job).toMatchObject({
      workplace: "hybrid",
      employmentType: "full_time",
      countryCodes: ["DE"],
      salary: { min: 70000, max: 90000, currency: "EUR", period: "year" },
    });
    expect(job?.descriptionHtml).toContain("<h3>You will</h3><ul><li>Build</li></ul>");
  });
});

describe("ashby", () => {
  it("skips unlisted jobs and reads salary components", async () => {
    const { http } = fakeHttp({
      "posting-api/job-board/acme": {
        jobs: [
          {
            id: "1",
            title: "Engineer",
            location: "Remote, Europe",
            employmentType: "FullTime",
            workplaceType: "Remote",
            isListed: true,
            publishedAt: "2026-07-31T18:56:39.246+00:00",
            jobUrl: "https://jobs.ashbyhq.com/acme/1",
            applyUrl: "https://jobs.ashbyhq.com/acme/1/application",
            compensation: {
              compensationTiers: [
                { components: [{ compensationType: "Salary", interval: "1 YEAR", currencyCode: "EUR", minValue: 1, maxValue: 2 }] },
              ],
            },
          },
          { id: "2", title: "Hidden", isListed: false, jobUrl: "https://jobs.ashbyhq.com/acme/2" },
        ],
      },
    });
    const jobs = await ashbySource({ token: "acme", name: "Acme" }).fetchJobs(ctx(http));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ workplace: "remote", salary: { currency: "EUR", period: "year" } });
  });
});

describe("workday", () => {
  it("keeps paging when later pages report total 0, then fetches details", async () => {
    const page = (offset: number, count: number) => ({
      total: offset === 0 ? 45 : 0,
      jobPostings: Array.from({ length: count }, (_, i) => ({
        title: `Job ${offset + i}`,
        externalPath: `/job/Berlin/Job_${offset + i}`,
      })),
    });
    const { http, calls } = fakeHttp({
      "/wday/cxs/acme/External/jobs": (body: unknown) => {
        const offset = (body as { offset: number }).offset;
        return page(offset, offset < 40 ? 20 : 5);
      },
      "/wday/cxs/acme/External/job/": {
        jobPostingInfo: {
          id: "x",
          title: "Engineer",
          jobDescription: "<p>Hi</p>",
          location: "Berlin",
          startDate: "2026-11-05",
          timeType: "Full time",
          externalUrl: "https://acme.wd3.myworkdayjobs.com/External/job/Berlin/Job_1",
          jobReqId: "R1",
          jobRequisitionLocation: { country: { alpha2Code: "DE" } },
        },
      },
    });
    const jobs = await workdaySource({ name: "Acme", host: "acme.wd3.myworkdayjobs.com", tenant: "acme", site: "External", max: 100 }).fetchJobs(ctx(http));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(3);
    expect(jobs).toHaveLength(45);
    expect(jobs[0]).toMatchObject({ countryCodes: ["DE"], employmentType: "full_time", postedAt: "2026-11-05" });
  });

  it("refuses hosts that are not Workday career sites", () => {
    expect(() => workdaySource({ name: "Evil", host: "169.254.169.254", tenant: "a", site: "b" })).toThrow();
  });
});

describe("amazon", () => {
  it("sends country facets in bracket form and maps alpha-3 countries", async () => {
    const { http, calls } = fakeHttp({
      "amazon.jobs/en/search.json": {
        hits: 1,
        jobs: [
          {
            id_icims: "10593412",
            title: "Software Development Engineer II",
            job_path: "/en/jobs/10593412/sde-ii",
            normalized_location: "Berlin, Berlin, DEU",
            country_code: "DEU",
            posted_date: "October 30, 2026",
            description: "Build<br/>things",
            basic_qualifications: "- 3+ years",
            job_schedule_type: "full-time",
            is_intern: false,
          },
        ],
      },
    });
    const [job] = await amazonSource({ id: "europe", countries: ["DEU"], categories: ["software-development"] }).fetchJobs(ctx(http));
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.getAll("normalized_country_code[]")).toEqual(["DEU"]);
    expect(url.searchParams.get("result_limit")).toBe("100");
    expect(job).toMatchObject({
      company: "Amazon",
      countryCodes: ["DE"],
      applyUrl: "https://www.amazon.jobs/en/jobs/10593412/sde-ii",
      employmentType: "full_time",
    });
  });
});

describe("buildSources", () => {
  it("merges the watchlist without duplicating configured boards and ignores bad tokens", () => {
    const sources = buildSources(DEFAULT_CONFIG, {
      watched: [
        { atsType: "greenhouse", boardToken: "n26", companyName: "N26" },
        { atsType: "lever", boardToken: "newco", companyName: "NewCo" },
        { atsType: "ashby", boardToken: "../../etc", companyName: "Bad" },
      ],
      includeAggregators: false,
    });
    const ids = sources.map((s) => s.id);
    expect(ids.filter((id) => id === "greenhouse:n26")).toHaveLength(1);
    expect(ids).toContain("lever:newco");
    expect(ids.some((id) => id.includes("etc"))).toBe(false);
    expect(ids).not.toContain("remotive");
  });

  it("only adds Adzuna when credentials exist", () => {
    expect(buildSources(DEFAULT_CONFIG).some((s) => s.id === "adzuna")).toBe(false);
    expect(buildSources(DEFAULT_CONFIG, { adzunaCredentials: { appId: "a", appKey: "b" } }).some((s) => s.id === "adzuna")).toBe(true);
  });
});

describe("http client", () => {
  it("retries 429 then succeeds, honouring Retry-After", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const client = createHttpClient({
      userAgent: "test",
      sleep: async (ms) => {
        delays.push(ms);
      },
      fetchImpl: (async () => {
        attempts++;
        return attempts === 1
          ? new Response("slow down", { status: 429, headers: { "retry-after": "2" } })
          : new Response('{"ok":true}', { status: 200 });
      }) as typeof fetch,
    });
    await expect(client.getJson("https://example.com/x")).resolves.toEqual({ ok: true });
    expect(delays).toEqual([2000]);
  });

  it("refuses plain http and never leaks query strings in errors", async () => {
    const client = createHttpClient({
      userAgent: "test",
      retries: 0,
      fetchImpl: (async () => new Response("nope", { status: 403 })) as typeof fetch,
    });
    await expect(client.getJson("http://example.com")).rejects.toThrow(/non-HTTPS/);
    await expect(client.getJson("https://api.example.com/jobs?app_key=SECRET")).rejects.toThrow(/^(?!.*SECRET).*403/);
    expect(redactUrl("https://a.com/p?key=1")).toBe("https://a.com/p?…");
  });
});
