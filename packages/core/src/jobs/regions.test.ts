import { describe, expect, it } from "vitest";
import { inferExperienceLevel } from "./classify";
import { regionOf, scopeDecision, type ScopeInput, type ScopeRule } from "./regions";

const rule: ScopeRule = { regions: ["europe", "asia"], keepIfVisaSponsored: true, keepUnknownLocation: true };

function job(overrides: Partial<ScopeInput>): ScopeInput {
  return { countryCodes: [], location: "", workplace: "unknown", visaSponsorship: "unknown", ...overrides };
}

describe("scopeDecision", () => {
  it.each([
    [{ countryCodes: ["DE"], location: "Berlin" }, "in_region"],
    [{ countryCodes: ["SG"], location: "Singapore" }, "in_region"],
    [{ countryCodes: ["US", "GB"], location: "New York or London" }, "in_region"],
    [{ countryCodes: ["US"], location: "Seattle, WA" }, "out_of_scope"],
    [{ countryCodes: ["US"], location: "Seattle, WA", visaSponsorship: "yes" }, "visa_sponsored"],
    [{ location: "Remote (Worldwide)", workplace: "remote" }, "remote_anywhere"],
    [{ location: "Remote - Europe", workplace: "remote" }, "in_region"],
    [{ location: "Remote, APAC", workplace: "remote" }, "in_region"],
    [{ location: "Remote (USA)", workplace: "remote" }, "out_of_scope"],
    [{ location: "Remote (USA)", workplace: "remote", visaSponsorship: "yes" }, "visa_sponsored"],
    [{ location: "Somewhere unclear" }, "unknown_location"],
  ] as const)("%j -> %s", (input, expected) => {
    expect(scopeDecision(job(input), rule)).toBe(expected);
  });

  it("drops unplaceable jobs when asked to be strict", () => {
    expect(scopeDecision(job({ location: "Somewhere unclear" }), { ...rule, keepUnknownLocation: false })).toBe(
      "out_of_scope",
    );
  });

  it("never keeps a no-sponsorship job outside the regions", () => {
    expect(scopeDecision(job({ countryCodes: ["CA"], visaSponsorship: "no" }), rule)).toBe("out_of_scope");
  });

  it("maps countries to regions", () => {
    expect(regionOf("hu")).toBe("europe");
    expect(regionOf("JP")).toBe("asia");
    expect(regionOf("US")).toBe("americas");
    expect(regionOf("ZZ")).toBeNull();
  });
});

describe("student roles", () => {
  it.each([
    ["Master Thesis: Distributed Systems (f/m/x)", "intern"],
    ["Working Student Software Engineering", "intern"],
    ["Software Engineer Co-op", "intern"],
    ["Software Engineer, New Grad 2027", "entry"],
    ["University Graduate - Backend", "entry"],
    ["Technology Graduate Programme 2027", "entry"],
    ["Summer Analyst - Technology", "intern"],
    ["Off-Cycle Software Engineering Internship", "intern"],
  ] as const)("%s is %s", (title, level) => {
    expect(inferExperienceLevel(title)).toBe(level);
  });
});
