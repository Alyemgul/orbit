import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { pdfSafeText, renderResumePdf, resumeFileName } from "../resume/pdf";
import type { Resume } from "../resume/schema";
import { applicationFormUrl, autopilotAtsFor, decodeConnection, encodeConnection } from "./connection";
import { applicantProfile, classifyField, standardValue } from "./fields";
import {
  findAnswer,
  isMarketingConsent,
  isPrivacyConsent,
  isSensitiveQuestion,
  matchOption,
  normalizeQuestion,
  questionHash,
} from "./questions";

const resume: Resume = {
  version: 1,
  basics: {
    name: "Alex Kovács Novak",
    headline: "CSE student",
    email: "alex@example.com",
    phone: "+36 30 000 0000",
    location: "Budapest, Hungary",
    links: [
      { label: "LinkedIn", url: "linkedin.com/in/alex" },
      { label: "GitHub", url: "https://github.com/alex" },
      { label: "Site", url: "alex.dev" },
    ],
  },
  summary: "Student who builds backend systems, and ships them.",
  sections: [
    {
      id: "s1",
      kind: "education",
      title: "Education",
      entries: [
        { id: "e1", title: "BSc Computer Science", org: "Budapest University of Technology", location: "", dates: "2023 – 2027", link: "", bullets: [{ id: "b1", text: "GPA 4.5/5" }] },
      ],
    },
    {
      id: "s2",
      kind: "experience",
      title: "Experience",
      entries: [
        { id: "e2", title: "Intern", org: "Riverline", location: "Budapest", dates: "Jun 2025 – Present", link: "", bullets: [{ id: "b2", text: "Built a Python service that cut manual checks by 40% ✱ őű" }] },
      ],
    },
  ],
  skills: [{ id: "k1", name: "Languages", items: ["Python", "C++"] }],
};

describe("answer memory", () => {
  it("normalizes questions so the same question matches across forms", async () => {
    expect(normalizeQuestion("Are you legally authorized to work in the EU? *")).toBe("are you legally authorized to work in the eu");
    expect(await questionHash("Notice period (required)")).toBe(await questionHash("notice   period?"));
    expect(await questionHash("a")).toMatch(/^[0-9a-f]{64}$/);
    const saved = [{ questionText: "Will you require visa sponsorship?", answer: "Yes", sensitive: true }];
    expect(findAnswer("Will you require Visa Sponsorship? ✱", saved)?.answer).toBe("Yes");
    expect(findAnswer("Do you require relocation?", saved)).toBeNull();
  });

  it("flags questions that must never be guessed", () => {
    for (const q of [
      "Are you authorized to work in Germany?",
      "Will you now or in the future require sponsorship?",
      "Gender",
      "Do you identify as a veteran?",
      "What are your salary expectations?",
    ]) {
      expect(isSensitiveQuestion(q)).toBe(true);
    }
    for (const q of ["Why do you want to join us?", "Which programming languages do you know?", "How did you hear about us?"]) {
      expect(isSensitiveQuestion(q)).toBe(false);
    }
  });

  it("tells privacy notices from marketing opt-ins", () => {
    expect(isPrivacyConsent("I have read and agree to the Candidate Privacy Notice")).toBe(true);
    expect(isPrivacyConsent("I consent to the processing of my personal data")).toBe(true);
    expect(isMarketingConsent("Contact me about future job opportunities")).toBe(true);
    expect(isPrivacyConsent("Contact me about future job opportunities and keep my personal data")).toBe(false);
  });

  it("matches saved answers to options carefully", () => {
    expect(matchOption("yes", ["No", "Yes"])).toBe("Yes");
    expect(matchOption("Yes", ["No, I am not", "Yes, I am authorized"])).toBe("Yes, I am authorized");
    expect(matchOption("No", ["Not sure", "Yes"])).toBeNull();
    expect(matchOption("Maybe", ["Yes", "No"])).toBeNull();
  });
});

describe("fields", () => {
  it("classifies standard fields from attributes and labels", () => {
    expect(classifyField({ label: "First Name", id: "first_name" })).toBe("first_name");
    expect(classifyField({ label: "Full name ✱", name: "name" })).toBe("full_name");
    expect(classifyField({ label: "", name: "urls[LinkedIn]" })).toBe("linkedin");
    expect(classifyField({ label: "LinkedIn Profile / Website" })).toBe("linkedin");
    expect(classifyField({ label: "Resume/CV", id: "resume", type: "file" })).toBe("resume");
    expect(classifyField({ label: "Where are you currently based?" })).toBe("location");
    expect(classifyField({ label: "Phone", type: "tel" })).toBe("phone");
    expect(classifyField({ label: "Will you now or in the future require immigration support?" })).toBeNull();
    expect(classifyField({ label: "Are you fluent in Italian?" })).toBeNull();
  });

  it("builds the applicant profile from the resume", () => {
    const profile = applicantProfile(resume);
    expect(profile).toMatchObject({
      firstName: "Alex",
      lastName: "Kovács Novak",
      linkedin: "https://linkedin.com/in/alex",
      github: "https://github.com/alex",
      website: "https://alex.dev",
      currentCompany: "Riverline",
      school: "Budapest University of Technology",
      graduation: "2027",
    });
    expect(standardValue("website", { ...profile, website: "" })).toBe("https://github.com/alex");
  });
});

describe("connection codes and hosts", () => {
  const connection = { url: "https://abcd1234.supabase.co", anonKey: "sb_publishable_abcdefghijklmnop", token: "t".repeat(48) };

  it("round-trips and rejects tampering", () => {
    const code = encodeConnection(connection);
    expect(code.startsWith("orbit1.")).toBe(true);
    expect(decodeConnection(code)).toEqual(connection);
    expect(decodeConnection("orbit1.garbage")).toBeNull();
    expect(() => encodeConnection({ ...connection, url: "https://evil.example.com" })).toThrow();
  });

  it("only allows known application hosts over https", () => {
    expect(autopilotAtsFor("https://job-boards.greenhouse.io/n26/jobs/1")).toBe("greenhouse");
    expect(autopilotAtsFor("https://jobs.lever.co/spotify/abc")).toBe("lever");
    expect(autopilotAtsFor("https://jobs.ashbyhq.com/acme/abc")).toBe("ashby");
    expect(autopilotAtsFor("http://jobs.lever.co/spotify/abc")).toBeNull();
    expect(autopilotAtsFor("https://jobs.lever.co.evil.com/x")).toBeNull();
    expect(autopilotAtsFor("https://acme.wd3.myworkdayjobs.com/x")).toBeNull();
    expect(applicationFormUrl("https://jobs.lever.co/spotify/abc")).toBe("https://jobs.lever.co/spotify/abc/apply");
    expect(applicationFormUrl("https://jobs.ashbyhq.com/acme/abc/")).toBe("https://jobs.ashbyhq.com/acme/abc/application");
    expect(applicationFormUrl("https://job-boards.greenhouse.io/n26/jobs/1#app")).toBe("https://job-boards.greenhouse.io/n26/jobs/1");
  });
});

describe("resume PDF", () => {
  it("renders a readable PDF and survives characters the fonts can't draw", async () => {
    expect(pdfSafeText("őű ✱ 🚀 – ok")).toBe("ou *  – ok");
    const bytes = await renderResumePdf(resume);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Alex Kovács Novak - Resume");
    expect(resumeFileName(resume)).toBe("Alex_Kovacs_Novak_Resume.pdf");
  });

  it("adds pages for long resumes", async () => {
    const entry = resume.sections[1]!.entries[0]!;
    const long: Resume = {
      ...resume,
      sections: [
        {
          ...resume.sections[1]!,
          entries: Array.from({ length: 12 }, (_, i) => ({
            ...entry,
            id: `e${i}`,
            bullets: Array.from({ length: 6 }, (_, j) => ({
              id: `b${i}${j}`,
              text: "Built and operated a reliable service with careful testing and monitoring in production",
            })),
          })),
        },
      ],
    };
    const doc = await PDFDocument.load(await renderResumePdf(long));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
