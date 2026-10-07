import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  buildPageHref,
  buildSearchHref,
  describeSearch,
  hasAnyFilter,
  MAX_PAGE,
  parsePage,
  parseSearchParams,
  toQueryString,
} from "@/lib/search-params";
import { sanitizeProps } from "@/lib/analytics";
import { naira, timeLeft, toKobo, untilLabel } from "@/lib/format";

/**
 * Filters are URL state: parsing, serialising and link-building must round-trip
 * so a shared link shows exactly what the sender saw.
 */
describe("search params", () => {
  it("parses and normalises a full filter set", () => {
    const filters = parseSearchParams({
      q: "  denim ",
      category: "Vintage",
      city: "Lagos",
      grade: "a",
      kind: "bale",
      min: "10,000",
      max: "₦150000",
      sort: "price_asc",
    });
    expect(filters).toMatchObject({
      query: "denim",
      category: "Vintage",
      city: "Lagos",
      grade: "A",
      kind: "bale",
      minNaira: 10000,
      maxNaira: 150000,
      sort: "price_asc",
    });
  });

  it("ignores values outside the known vocabulary", () => {
    const filters = parseSearchParams({ category: "Spaceships", city: "Mars", grade: "Z", kind: "bale-bundle", sort: "cheapest" });
    expect(filters.category).toBeUndefined();
    expect(filters.city).toBeUndefined();
    expect(filters.grade).toBeUndefined();
    expect(filters.kind).toBeUndefined();
    expect(filters.sort).toBe("newest");
  });

  it("takes the first value when a param repeats", () => {
    expect(parseSearchParams({ category: ["Bags", "Shoes"] }).category).toBe("Bags");
  });

  it("round-trips through a query string", () => {
    const filters = parseSearchParams({ q: "bags", category: "Bags", grade: "A", min: "20000" });
    const href = `/search${toQueryString(filters)}`;
    const replayed = parseSearchParams(Object.fromEntries(new URL(href, "https://x.test").searchParams));
    expect(replayed).toMatchObject({ query: "bags", category: "Bags", grade: "A", minNaira: 20000 });
  });

  it("omits default sorting from the URL", () => {
    expect(toQueryString({ category: "Bags", sort: "newest" })).toBe("?category=Bags");
    expect(toQueryString({ query: "bags", sort: "relevance" })).toBe("?q=bags");
  });

  it("patches one filter while preserving the others", () => {
    const current = parseSearchParams({ q: "denim", city: "Lagos" });
    expect(buildSearchHref(current, { grade: "A" })).toBe("/search?q=denim&city=Lagos&grade=A");
    expect(buildSearchHref(current, { city: null })).toBe("/search?q=denim");
    expect(buildSearchHref(current, { kind: "bale" })).toBe("/search?q=denim&city=Lagos&kind=bale");
  });

  it("reports whether filters are active and describes them for humans", () => {
    expect(hasAnyFilter({ sort: "price_asc" })).toBe(false);
    expect(activeFilterCount({})).toBe(0);
    const filters = parseSearchParams({ q: "gowns", grade: "B", kind: "bale" });
    expect(activeFilterCount(filters)).toBe(3);
    expect(describeSearch(filters)).toBe("“gowns” · Grade B · bale splits");
  });
});

describe("analytics privacy", () => {
  it("drops PII-shaped keys and truncates long strings", () => {
    const props = sanitizeProps({
      item_id: "p1",
      email: "buyer@example.com",
      phone: "0803",
      full_address: "14 Admiralty Way",
      password: "hunter2",
      token: "abc",
      note: "x".repeat(400),
      value: 15000,
      flagged: true,
      nothing: undefined,
      nested: { a: 1 } as unknown as string,
    });
    expect(Object.keys(props).sort()).toEqual(["flagged", "item_id", "note", "value"]);
    expect((props.note as string).length).toBe(120);
    expect(props.value).toBe(15000);
  });
});

describe("money + time formatting", () => {
  it("formats naira and converts to kobo at the boundary", () => {
    expect(naira(15000)).toBe("₦15,000");
    expect(naira(1234.6)).toBe("₦1,235");
    expect(toKobo(15000)).toBe(1500000);
    expect(toKobo(19.999)).toBe(2000);
  });

  it("grades urgency from the remaining window", () => {
    const now = Date.now();
    expect(timeLeft(now + 72 * 3600_000).urgency).toBe("calm");
    expect(timeLeft(now + 10 * 3600_000).urgency).toBe("soon");
    expect(timeLeft(now + 2 * 3600_000).urgency).toBe("critical");
    expect(timeLeft(now - 1000).urgency).toBe("expired");
    expect(timeLeft(now - 1000).expired).toBe(true);
  });
});

describe("search pager", () => {
  it("defaults to page 1 and rejects nonsense", () => {
    expect(parsePage({})).toBe(1);
    expect(parsePage({ page: "3" })).toBe(3);
    expect(parsePage({ page: "0" })).toBe(1);
    expect(parsePage({ page: "-2" })).toBe(1);
    expect(parsePage({ page: "abc" })).toBe(1);
    expect(parsePage({ page: ["4", "9"] })).toBe(4);
  });

  it("caps the page so a hand-edited URL cannot ask for an absurd offset", () => {
    expect(parsePage({ page: "999999" })).toBe(MAX_PAGE);
  });

  it("omits page 1 from the query string and keeps every filter on later pages", () => {
    const filters = parseSearchParams({ q: "denim", city: "Lagos", grade: "a", sort: "price_asc" });
    expect(buildPageHref(filters, 1)).toBe("/search?q=denim&city=Lagos&grade=A&sort=price_asc");
    expect(buildPageHref(filters, 3)).toBe("/search?q=denim&city=Lagos&grade=A&sort=price_asc&page=3");
  });

  it("drops back to page 1 when a filter changes", () => {
    const filters = parseSearchParams({ q: "denim", page: "4" } as never);
    expect(buildSearchHref(filters, { city: "Kano" })).toBe("/search?q=denim&city=Kano");
  });

  it("round-trips a paged URL", () => {
    const raw = { q: "bale", page: "2" };
    const filters = parseSearchParams(raw);
    expect(parsePage(raw)).toBe(2);
    expect(toQueryString({ ...filters, page: 2 })).toBe("?q=bale&page=2");
  });
});

describe("escrow countdown copy", () => {
  const now = Date.parse("2026-03-01T12:00:00.000Z");

  it("says nothing when there is no date", () => {
    expect(untilLabel(null, now)).toBeNull();
    expect(untilLabel(undefined, now)).toBeNull();
    expect(untilLabel("not a date", now)).toBeNull();
  });

  it("reads as due once the release time has passed", () => {
    expect(untilLabel("2026-03-01T11:59:59.000Z", now)).toBe("now");
    expect(untilLabel("2026-03-01T12:00:00.000Z", now)).toBe("now");
  });

  it("switches units at the boundaries a buyer cares about", () => {
    expect(untilLabel("2026-03-01T12:20:00.000Z", now)).toBe("in 20 min");
    // Under an hour still rounds up to at least a minute, never "in 0 min".
    expect(untilLabel("2026-03-01T12:00:20.000Z", now)).toBe("in 1 min");
    expect(untilLabel("2026-03-01T19:00:00.000Z", now)).toBe("in 7 h");
    expect(untilLabel("2026-03-02T11:00:00.000Z", now)).toBe("in 23 h");
    // 48 h is the escrow window: at and beyond it, days are the honest unit.
    expect(untilLabel("2026-03-03T12:00:00.000Z", now)).toBe("in 2 days");
    expect(untilLabel("2026-03-06T12:00:00.000Z", now)).toBe("in 5 days");
  });
});
