import { describe, expect, it } from "vitest";
import { detectAtsFromUrl } from "./ats";
import {
  detectVisaSponsorship,
  inferCategory,
  inferEmploymentType,
  inferExperienceLevel,
  inferWorkplace,
} from "./classify";
import { canonicalJobKey, normalizeCompanyName } from "./dedupe";
import { decodeHtmlEntities, htmlToText, truncateText } from "./html";
import { inferCountryCodes } from "./location";

describe("htmlToText", () => {
  it("keeps paragraphs and bullets and drops tags", () => {
    const html = "<h2>About</h2><p>We build <b>things</b>.</p><ul><li>TypeScript</li><li>Go</li></ul>";
    expect(htmlToText(html)).toBe("About\n\nWe build things.\n\n• TypeScript\n• Go");
  });

  it("removes scripts and styles entirely", () => {
    expect(htmlToText("<p>Hi</p><script>alert(1)</script><style>p{}</style>")).toBe("Hi");
  });

  it("decodes Greenhouse-style double-escaped content", () => {
    const escaped = "&lt;p&gt;Caf&amp;eacute; &amp;amp; co&lt;/p&gt;";
    expect(htmlToText(decodeHtmlEntities(escaped))).toBe("Café & co");
  });

  it("decodes numeric entities and ignores invalid code points", () => {
    expect(decodeHtmlEntities("&#8364; &#x1F680; &#99999999;")).toBe("€ 🚀 &#99999999;");
  });

  it("truncates on a word boundary", () => {
    expect(truncateText("one two three four five", 12)).toBe("one two…");
    expect(truncateText("short", 12)).toBe("short");
  });
});

describe("classifiers", () => {
  it.each([
    ["Software Engineering Intern", "intern"],
    ["Werkstudent Softwareentwicklung (m/w/d)", "intern"],
    ["Staff Backend Engineer", "lead"],
    ["Engineering Manager, Payments", "lead"],
    ["Senior Software Engineer - 3D Perception", "senior"],
    ["Software Development Engineer II", "mid"],
    ["Junior Frontend Developer", "entry"],
    ["Software Engineer I", "entry"],
    ["Backend Engineer", "unknown"],
  ] as const)("level of %s is %s", (title, level) => {
    expect(inferExperienceLevel(title)).toBe(level);
  });

  it.each([
    ["Senior Software Engineer", "software_engineering"],
    ["Machine Learning Engineer", "ml_ai"],
    ["AI Platform Engineer", "ml_ai"],
    ["Data Engineer", "data"],
    ["Data Science Manager, Risk", "data"],
    ["Site Reliability Engineer", "devops_sre"],
    ["Application Security Engineer", "security"],
    ["Sales Engineer", "other"],
    ["Markets Quantitative Analysis Developer", "quant"],
    ["Graduate Trader - Amsterdam", "quant"],
    ["Software Engineer, Low Latency Trading Systems", "quant"],
    ["Technology Analyst Graduate Programme", "tech_business"],
    ["Partner Solutions Architect", "tech_business"],
    ["Forward Deployed Engineer", "tech_business"],
    ["Product Designer", "design"],
    ["Account Executive - Commercial", "other"],
    ["Full-Stack Developer", "software_engineering"],
  ] as const)("category of %s is %s", (title, category) => {
    expect(inferCategory(title)).toBe(category);
  });

  it("infers employment type and workplace from free text", () => {
    expect(inferEmploymentType("Werkstudent Data")).toBe("part_time");
    expect(inferEmploymentType("Engineer", "Full time")).toBe("full_time");
    expect(inferEmploymentType("Engineer (Contract)")).toBe("contract");
    expect(inferWorkplace("Remote, Europe")).toBe("remote");
    expect(inferWorkplace("Berlin (Hybrid)")).toBe("hybrid");
    expect(inferWorkplace("Berlin")).toBe("unknown");
  });

  it("reads negative sponsorship statements as no", () => {
    expect(detectVisaSponsorship("We are unable to sponsor visas for this role.")).toBe("no");
    expect(detectVisaSponsorship("Candidates must be authorized to work without sponsorship.")).toBe("no");
    expect(detectVisaSponsorship("We cannot offer visa sponsorship.")).toBe("no");
    expect(detectVisaSponsorship("Visa sponsorship is available for this position.")).toBe("yes");
    expect(detectVisaSponsorship("We offer relocation and visa support.")).toBe("yes");
    expect(detectVisaSponsorship("A great team in Berlin.")).toBe("unknown");
  });
});

describe("inferCountryCodes", () => {
  it.each([
    ["Berlin, Germany", ["DE"]],
    ["Paris", ["FR"]],
    ["US, CA, Santa Clara", ["US"]],
    ["New York, NY", ["US"]],
    ["Munich or Budapest", ["DE", "HU"]],
    ["Milan, Metropolitan City of Milan, Italy", ["IT"]],
    ["Maryland; Virginia; Washington, D.C.", ["US"]],
    ["Bellevue, Washington", ["US"]],
    ["Remote - Texas", ["US"]],
    ["Costa Rica", ["CR"]],
    ["Remote, Global", []],
    ["", []],
  ] as const)("%s -> %j", (location, codes) => {
    expect(inferCountryCodes(location).sort()).toEqual([...codes].sort());
  });

  it("does not read Delaware's code as Germany when a city is known", () => {
    expect(inferCountryCodes("Berlin, DE")).toEqual(["DE"]);
  });
});

describe("detectAtsFromUrl", () => {
  it.each([
    ["https://job-boards.greenhouse.io/n26/jobs/123", "greenhouse"],
    ["https://stripe.com/jobs/search?gh_jid=42", "greenhouse"],
    ["https://jobs.lever.co/spotify/abc", "lever"],
    ["https://jobs.ashbyhq.com/supabase/abc/application", "ashby"],
    ["https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/x", "workday"],
    ["https://bunq.recruitee.com/o/aml", "recruitee"],
    ["https://example.com/careers", "other"],
    ["not a url", "other"],
  ] as const)("%s is %s", (url, ats) => {
    expect(detectAtsFromUrl(url)).toBe(ats);
  });
});

describe("canonicalJobKey", () => {
  it("treats cosmetic differences as the same job", () => {
    const a = canonicalJobKey("N26 GmbH", "Senior Backend Engineer (m/w/d)", "Berlin, Germany");
    const b = canonicalJobKey("n26", "Senior Backend Engineer", "Berlin");
    expect(a).toBe(b);
  });

  it("keeps different cities apart", () => {
    expect(canonicalJobKey("N26", "Engineer", "Berlin")).not.toBe(canonicalJobKey("N26", "Engineer", "Paris"));
  });

  it("strips legal suffixes from company names", () => {
    expect(normalizeCompanyName("Bosch Group")).toBe("bosch");
    expect(normalizeCompanyName("Stripe, Inc.")).toBe("stripe");
  });
});
