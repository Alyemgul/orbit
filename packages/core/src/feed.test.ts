import { describe, expect, it } from "vitest";
import { DEFAULT_FEED_FILTERS, feedArgs, feedFiltersToQuery, parseFeedFilters } from "./feed";

describe("feed filters", () => {
  it("defaults to Europe new-grad roles in CS-skill categories", () => {
    const filters = parseFeedFilters({});
    expect(filters).toEqual(DEFAULT_FEED_FILTERS);
    const args = feedArgs(filters, null);
    expect(args.p_countries).toContain("DE");
    expect(args.p_countries).toContain("HU");
    expect(args.p_countries).not.toContain("US");
    expect(args.p_region_word).toBe("europe");
    expect(args.p_levels).toEqual(["entry"]);
    expect(args.p_categories).toEqual(expect.arrayContaining(["software_engineering", "data", "quant", "tech_business"]));
    expect(args.p_categories).not.toContain("other");
    expect(args.p_visa_only).toBe(false);
  });

  it("falls back to defaults for unknown values instead of failing", () => {
    const filters = parseFeedFilters({ region: "mars", level: "ceo", cat: "software,nope", q: "  rust  " });
    expect(filters.region).toBe("europe");
    expect(filters.level).toBe("new_grad");
    expect(filters.groups).toEqual(DEFAULT_FEED_FILTERS.groups);
    expect(filters.query).toBe("rust");
  });

  it("round-trips through the URL and leaves defaults out", () => {
    expect(feedFiltersToQuery(DEFAULT_FEED_FILTERS)).toBe("");
    const filters = parseFeedFilters(new URLSearchParams("region=korea&level=intern&cat=quant&remote=1&q=c%2B%2B"));
    expect(filters).toEqual({ region: "korea", level: "intern", groups: ["quant"], remoteOnly: true, query: "c++" });
    expect(parseFeedFilters(new URLSearchParams(feedFiltersToQuery(filters)))).toEqual(filters);
  });

  it("maps visa and everywhere to no country filter", () => {
    const visa = feedArgs(parseFeedFilters({ region: "visa", level: "any" }), null);
    expect(visa).toMatchObject({ p_countries: null, p_visa_only: true, p_levels: null });
    const anywhere = feedArgs(parseFeedFilters({ region: "anywhere", cat: "" }), null);
    expect(anywhere).toMatchObject({ p_countries: null, p_visa_only: false, p_categories: null });
  });

  it("passes the cursor through", () => {
    const cursor = { ts: "2026-11-05T10:00:00.000Z", id: "8d7c2f4e-6c1a-4f5b-9a3e-2b1c0d9e8f7a" };
    expect(feedArgs(DEFAULT_FEED_FILTERS, cursor, 10)).toMatchObject({
      p_cursor_ts: cursor.ts,
      p_cursor_id: cursor.id,
      p_limit: 10,
    });
  });
});
