import { describe, expect, it } from "vitest";
import { dedupeHash, normalizeJob, toIsoDate, type RawJob } from "./normalize";

const source = { id: "greenhouse:acme", priority: 10 };

function raw(overrides: Partial<RawJob> = {}): RawJob {
  return {
    sourceJobId: "1",
    title: "Senior Backend Engineer",
    company: "Acme",
    applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
    location: "Berlin, Germany",
    descriptionHtml: "<p>We cannot offer visa sponsorship.</p>",
    postedAt: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

describe("normalizeJob", () => {
  it("fills classifications from title, location and description", () => {
    const result = normalizeJob(raw(), source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job).toMatchObject({
      atsType: "greenhouse",
      countryCodes: ["DE"],
      experienceLevel: "senior",
      category: "software_engineering",
      visaSponsorship: "no",
      description: "We cannot offer visa sponsorship.",
      postedAt: "2026-11-01T10:00:00.000Z",
    });
  });

  it("lets explicit source values win over guesses", () => {
    const result = normalizeJob(raw({ workplace: "remote", experienceLevel: "lead", countryCodes: ["nl"] }), source);
    expect(result.ok && result.job).toMatchObject({ workplace: "remote", experienceLevel: "lead", countryCodes: ["NL"] });
  });

  it("rejects jobs without a usable http apply link", () => {
    expect(normalizeJob(raw({ applyUrl: "javascript:alert(1)" }), source).ok).toBe(false);
    expect(normalizeJob(raw({ applyUrl: "not a url" }), source).ok).toBe(false);
  });

  it("rejects empty titles", () => {
    expect(normalizeJob(raw({ title: "   " }), source).ok).toBe(false);
  });

  it("drops non-http logo and source links instead of failing the job", () => {
    const result = normalizeJob(raw({ companyLogoUrl: "data:image/png;base64,xx", sourceUrl: "ftp://x" }), source);
    expect(result.ok && result.job).toMatchObject({ companyLogoUrl: null, sourceUrl: null });
  });

  it("cleans salaries: swaps reversed ranges, drops zeros and bad currencies", () => {
    const swapped = normalizeJob(raw({ salary: { min: 90000, max: 70000, currency: "eur", period: "year" } }), source);
    expect(swapped.ok && swapped.job).toMatchObject({ salaryMin: 70000, salaryMax: 90000, salaryCurrency: "EUR" });
    const junk = normalizeJob(raw({ salary: { min: 0, max: null, currency: "euros" } }), source);
    expect(junk.ok && junk.job).toMatchObject({ salaryMin: null, salaryMax: null, salaryCurrency: null });
  });
});

describe("toIsoDate", () => {
  const now = Date.UTC(2026, 10, 6);
  it.each([
    ["2026-11-01T10:00:00Z", "2026-11-01T10:00:00.000Z"],
    ["2026-10-30 16:32:58 UTC", "2026-10-30T16:32:58.000Z"],
    [1793899873, "2026-11-05T17:31:13.000Z"],
    [1793899873000, "2026-11-05T17:31:13.000Z"],
    ["October 30, 2026", new Date("October 30, 2026").toISOString()],
  ] as const)("%s", (input, expected) => {
    expect(toIsoDate(input, now)).toBe(expected);
  });

  it("rejects garbage, ancient and future dates", () => {
    expect(toIsoDate("Posted Today", now)).toBeNull();
    expect(toIsoDate("1990-01-01", now)).toBeNull();
    expect(toIsoDate("2030-01-01", now)).toBeNull();
    expect(toIsoDate(null, now)).toBeNull();
  });
});

describe("dedupeHash", () => {
  it("matches the same posting from different sources", () => {
    const a = dedupeHash({ company: "Acme GmbH", title: "Backend Engineer (m/w/d)", location: "Berlin, Germany" });
    const b = dedupeHash({ company: "acme", title: "Backend Engineer", location: "Berlin" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
