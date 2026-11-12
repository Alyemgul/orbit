/**
 * The owner's real master CV, as pdf.js extracts it from the LaTeX PDF
 * (contact details replaced with placeholders). A large, real-world CV:
 * no bullet symbols survive extraction, headings are free-form ("AI and
 * Data Projects"), headers are "Project | Tech · link", lines wrap.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { resumeHealth } from "./health";
import { parseResumeText } from "./parse";
import { renderResumePdf } from "./pdf";
import { cleanText, pdfItemsToText, type PdfTextItem } from "./pdf-text";
import { resumeBullets, type Resume } from "./schema";

const text = readFileSync(join(__dirname, "fixtures", "owner-cv.pdf.txt"), "utf8").replace("{{NUL}}", "\u0000");
const cv = parseResumeText(text);
const section = (title: string) => cv.sections.find((s) => s.title === title)!;
const outline = (resume: Resume) =>
  resume.sections.map((s) => ({ title: s.title, entries: s.entries.map((e) => [e.title, e.bullets.length] as const) }));

const PROJECTS: Record<string, [string, number][]> = {
  "AI and Data Projects": [
    ["Orbit, AI-Assisted Job Application Platform", 6],
    ["ReviewPilot, AI Assisted Code Review Tool", 2],
    ["RAG From Scratch", 1],
    ["Autonomous Driving Bug Triage Agent", 2],
    ["AI Sprint Assistant for Agile Teams", 2],
    ["QAlytics, Software Quality Analysis Tool", 3],
    ["AI Algorithms Labs", 1],
    ["Computer Vision Experiments", 2],
    ["Image Processing / AI Detection Project", 0],
    ["Sales Analytics Dashboard", 2],
  ],
  "Software and Systems Projects": [
    ["Cloud Deployment of Key Value Server with CI/CD", 1],
    ["Kubernetes Deployment of Key Value Server", 1],
    ["Container Runtime From Scratch", 1],
    ["Redis-Style Key Value Database Server", 1],
    ["Pipe in the Desert, Team Project", 1],
    ["Open Source Public Transportation Mapping Project", 0],
    ["MiraGram", 1],
    ["Blog Application v2", 1],
    ["Mini Blog Console App", 1],
    ["Password Strength Analyzer", 2],
  ],
  "Embedded and Hardware Projects": [
    ["Embedded Weather Station", 1],
    ["5-Stage Pipelined RISC-V Processor", 2],
    ["Parameterized Synchronous FIFO", 2],
    ["FSM-Based Vending Machine Controller", 1],
    ["Embedded Photo Booth Controller", 1],
  ],
  "Mobile Projects": [
    ["Workplace Management Android App", 1],
    ["Android Wallet App", 1],
    ["Public Transport Ticket App", 1],
    ["Simple Drawer", 1],
  ],
};

describe("owner's master CV (LaTeX PDF)", () => {
  it("reads the header", () => {
    expect(cv.basics).toMatchObject({
      name: "Alyemgul Guljazira",
      email: "candidate@example.com",
      phone: "+36 00 000 0000",
      location: "Budapest, Hungary",
    });
    expect(cv.basics.links).toEqual([{ label: "LinkedIn", url: "linkedin.com/in/example-candidate" }]);
    expect(cv.basics.headline).toMatch(/^Master CV: every project and role in one place/);
  });

  it("finds every section with its own heading", () => {
    expect(cv.sections.map((s) => [s.kind, s.title, s.entries.length])).toEqual([
      ["education", "Education", 1],
      ["projects", "Research", 1],
      ["projects", "AI and Data Projects", 10],
      ["projects", "Software and Systems Projects", 10],
      ["projects", "Embedded and Hardware Projects", 5],
      ["projects", "Mobile Projects", 4],
      ["experience", "Experience", 3],
    ]);
  });

  it("keeps all 33 projects apart, each with its own bullets", () => {
    for (const [title, projects] of Object.entries(PROJECTS)) {
      expect(section(title).entries.map((e) => [e.title, e.bullets.length]), title).toEqual(projects);
    }
  });

  it("reads tech stacks and links from the project header lines", () => {
    const orbit = section("AI and Data Projects").entries[0]!;
    expect(orbit.org).toBe("TypeScript, Next.js 15, React 19, PostgreSQL (Supabase), Chrome Extension (MV3), GitHub Actions");
    expect(orbit.link).toBe("github.com/Alyemgul/orbit");
    expect(section("AI and Data Projects").entries[5]!.link).toBe("github.com/alyemgul/qalytics");
    // Hyphenated across two lines in the PDF.
    expect(section("Software and Systems Projects").entries[9]!.link).toBe("github.com/Alyemgul/password-strength-analyzer");
    expect(section("Mobile Projects").entries.map((e) => e.org)).toEqual([
      "Kotlin, Jetpack Compose, ViewModel, Material Design",
      "Kotlin, Jetpack Compose, Material Design",
      "Kotlin, Jetpack Compose, Material Design",
      "Kotlin, Jetpack Compose, Material Design",
    ]);
  });

  it("rejoins bullets the PDF wrapped over several lines", () => {
    const research = section("Research").entries[0]!;
    expect(research).toMatchObject({ title: "Synthetic-Image (Deepfake) Detection, Thesis Research", org: "Python, PyTorch, Diffusion Models, Statistics" });
    expect(research.bullets[1]!.text).toBe(
      "Showed that a white-box PGD attack fools the ensemble on 99.9% of images (888 of 889); combining diffusion " +
        "purification with the ensemble kept 88% of detection at the cost of more false alarms, and a size-adaptive purifier " +
        "raised clean accuracy from 65.9% to 74.9%",
    );
    const bullets = resumeBullets(cv).map((b) => b.bullet.text);
    expect(bullets.find((t) => t.startsWith("Shipped an installable"))).toContain("(Vitest, in-memory Postgres)");
    expect(bullets.find((t) => t.startsWith("Designed a 4-state FSM"))).toContain("accepts 5- and 10-unit coins");
    for (const t of bullets) {
      expect(t, t).not.toMatch(/^[a-z]/); // nothing starts mid-sentence
      expect(t, t).not.toMatch(/ \| /); // no project header swallowed into a bullet
      expect(t.length).toBeLessThan(600); // nothing cut off at the limit
    }
  });

  it("reads education and experience headers", () => {
    expect(section("Education").entries[0]).toMatchObject({
      title: "Bachelor of Science in Computer Science Engineering",
      org: "Budapest University of Technology and Economics (BME)",
      location: "Budapest, Hungary",
      dates: "Sep. 2023 – Expected 2027",
    });
    expect(section("Education").entries[0]!.bullets.map((b) => b.text)).toEqual([
      "Most recent semester GPA: 4.49/5.00",
      "Thesis (TDK research): Improving Cross-Dataset Generalization and Adversarial Robustness of Synthetic-Image Detectors, advisor Dr. Gergely Acs",
    ]);
    expect(section("Experience").entries.map((e) => [e.title, e.org, e.location, e.dates])).toEqual([
      ["Teaching Assistant, Basics of Programming I", "Budapest University of Technology and Economics", "Budapest, Hungary", "2025 – Present"],
      ["Educational Coordinator", "BME International Affairs Committee (IAC)", "Budapest, Hungary", "2025 – Present"],
      ["Scriptwriter and Content Creator", "Gej Yu Ve Science Communication Initiative", "Remote", "2024 – Present"],
    ]);
  });

  it("reads every skill group, including lines that wrap", () => {
    expect(cv.skills.map((g) => [g.name, g.items.length])).toEqual([
      ["Programming", 8],
      ["AI and ML", 18],
      ["Data and Statistics", 12],
      ["Backend and Systems", 8],
      ["Web and Cloud", 7],
      ["DevOps and Testing", 7],
      ["Mobile and Embedded", 7],
      ["Spoken Languages", 2],
    ]);
    expect(cv.skills[1]!.items).toContain("Adversarial Attacks (PGD)");
    expect(cv.skills[2]!.items).toContain("SQL Server");
  });

  it("scores the health checklist on real content", () => {
    const health = resumeHealth(cv);
    expect(health.checks.map((c) => c.ok)).toEqual([true, true, false, true, false, true]);
    expect(health.checks[3]!.label).toBe("Bullets start with an action verb (49/51)");
    expect(health.score).toBe(67);
  });

  it("survives a round trip through Orbit's own PDF", async () => {
    const pdf = await renderResumePdf(cv);
    const doc = await getDocument({ data: pdf, isEvalSupported: false }).promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const items: PdfTextItem[] = [];
      for (const item of content.items) if ("str" in item) items.push(item);
      pages.push(pdfItemsToText(items));
    }
    const again = parseResumeText(cleanText(pages.join("\n\n")));
    const projectsOnly = (r: Resume) => outline(r).filter((s) => s.title !== "Experience" && s.title !== "Education");
    expect(projectsOnly(again)).toEqual(projectsOnly(cv));
    expect(resumeBullets(again).map((b) => b.bullet.text)).toEqual(resumeBullets(cv).map((b) => b.bullet.text));
    expect(again.skills.map((g) => [g.name, g.items])).toEqual(cv.skills.map((g) => [g.name, g.items]));
  });
});
