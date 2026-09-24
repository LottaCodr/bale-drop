import { describe, expect, it } from "vitest";
import {
  escapeLikePattern,
  filterProducts,
  normalizeFilters,
  sanitizeRemoteQuery,
  searchSignature,
  searchViewOfProduct,
  textScore,
  type SearchView,
} from "@bale-drop/database";

/**
 * The filter contract is shared by live Postgres queries and the demo dataset;
 * these tests are what stop the two paths from drifting apart.
 */

const view = (over: Partial<SearchView> & { id: string }): SearchView => ({
  id: over.id,
  title: over.title ?? "Grade A Denim Jacket Bale",
  description: over.description ?? null,
  category: over.category ?? "Bales",
  city: over.city ?? "Lagos",
  grade: over.grade ?? "A",
  price: over.price ?? 100000,
  isBale: over.isBale ?? true,
  vendorId: over.vendorId ?? "v1",
  rating: over.rating ?? 4.5,
  sold: over.sold ?? 10,
  createdAt: over.createdAt ?? 0,
});

const catalog: SearchView[] = [
  view({ id: "p1", title: "Grade A Unisex Vintage Denim Jackets — Full Bale", category: "Bales", price: 150000, city: "Lagos", sold: 132, rating: 4.8, createdAt: 9 }),
  view({ id: "p2", title: "Grade A Sneakers Bale — Mixed Sizes 40–45", category: "Shoes", price: 220000, city: "Kano", sold: 210, rating: 4.9, createdAt: 8 }),
  view({ id: "p3", title: "Men Corporate Shirts Bale", category: "Men", price: 95000, city: "Abuja", grade: "A", isBale: true, sold: 98, createdAt: 7 }),
  view({ id: "p4", title: "Leather Handbags (5 pcs bundle)", category: "Bags", price: 28000, city: "Abuja", grade: "A", isBale: false, sold: 187, rating: 4.9, createdAt: 6 }),
  view({ id: "p5", title: "Grade B Mixed Ladies Gowns Bale", category: "Women", price: 90000, city: "Port Harcourt", grade: "B", sold: 76, createdAt: 5 }),
  view({ id: "p6", title: "Kids Party Dresses Bundle", description: "Bright prints for ages 3–8", category: "Kids", price: 46000, city: "Abuja", grade: "A", isBale: false, sold: 29, createdAt: 4 }),
];

describe("filter normalization", () => {
  it("treats 'All' and blanks as no filter", () => {
    const filters = normalizeFilters({ category: "All", city: "  ", grade: undefined, query: "   " });
    expect(filters.category).toBeUndefined();
    expect(filters.city).toBeUndefined();
    expect(filters.query).toBeUndefined();
  });

  it("drops unknown grades/sorts and clamps absurd money values", () => {
    const filters = normalizeFilters({ grade: "Z" as never, sort: "cheapest" as never, minNaira: -50, maxNaira: 1e12 });
    expect(filters.grade).toBeUndefined();
    expect(filters.sort).toBe("newest");
    expect(filters.minNaira).toBe(0);
    expect(filters.maxNaira).toBe(100_000_000);
  });

  it("caps the query length and clamps the limit", () => {
    const filters = normalizeFilters({ query: "x".repeat(500), limit: 9999 });
    expect(filters.query).toHaveLength(80);
    expect(filters.limit).toBe(60);
  });
});

describe("text relevance", () => {
  it("scores a title hit far above a description hit", () => {
    const title = textScore(view({ id: "a", title: "Denim Jacket" }), "denim");
    const description = textScore(view({ id: "b", description: "includes denim", title: "Mixed lot" }), "denim");
    expect(title).toBeGreaterThan(description);
    expect(description).toBeGreaterThan(0);
  });

  it("returns zero for an unrelated term so search can be honest about it", () => {
    expect(textScore(view({ id: "c", title: "Leather Handbags" }), "zzzznothing")).toBe(0);
  });

  it("maps everyday words onto categories", () => {
    expect(textScore(view({ id: "d", title: "Nike Air Max Bundle", category: "Shoes" }), "sneakers")).toBeGreaterThan(0);
    expect(textScore(view({ id: "e", title: "Silk Scarves", category: "Vintage" }), "scarves")).toBeGreaterThan(0);
  });
});

describe("filterProducts", () => {
  it("filters by query without padding results with irrelevant items", () => {
    const results = filterProducts(catalog, { query: "zzzznothing" });
    expect(results).toHaveLength(0);
  });

  it("matches a query against title, category and description", () => {
    expect(filterProducts(catalog, { query: "sneakers" }).map((p) => p.id)).toEqual(["p2"]);
    // A description-only hit still counts (nobody types the full title).
    expect(filterProducts(catalog, { query: "prints" }).map((p) => p.id)).toEqual(["p6"]);
  });

  it("uses synonyms to widen an everyday word, with the literal hit first", () => {
    const results = filterProducts(catalog, { query: "dresses" });
    expect(results[0].id).toBe("p6"); // title: "Kids Party Dresses"
    expect(results.map((p) => p.id)).toContain("p5"); // Women category synonym
  });

  it("combines structured filters", () => {
    expect(filterProducts(catalog, { category: "Bags", city: "Abuja" }).map((p) => p.id)).toEqual(["p4"]);
    expect(filterProducts(catalog, { grade: "B", city: "Port Harcourt" }).map((p) => p.id)).toEqual(["p5"]);
    expect(filterProducts(catalog, { kind: "single" }).map((p) => p.id)).toEqual(["p4", "p6"]);
  });

  it("applies price bounds inclusively", () => {
    expect(filterProducts(catalog, { minNaira: 90000, maxNaira: 150000 }).map((p) => p.id)).toEqual(["p1", "p3", "p5"]);
  });

  it("sorts by price, rating and recency", () => {
    expect(filterProducts(catalog, { sort: "price_asc" })[0].id).toBe("p4");
    expect(filterProducts(catalog, { sort: "price_desc" })[0].id).toBe("p2");
    expect(filterProducts(catalog, { sort: "rating" })[0].rating).toBe(4.9);
    expect(filterProducts(catalog, { sort: "newest" })[0].id).toBe("p1");
  });

  it("ranks an exact title match first for a relevance query", () => {
    expect(filterProducts(catalog, { query: "sneakers", sort: "relevance" })[0].id).toBe("p2");
  });

  it("respects the limit", () => {
    expect(filterProducts(catalog, { limit: 3 })).toHaveLength(3);
  });

  it("filters by vendor", () => {
    const withVendor = [...catalog, view({ id: "p7", vendorId: "v9" })];
    expect(filterProducts(withVendor, { vendorId: "v9" }).map((p) => p.id)).toEqual(["p7"]);
  });
});

describe("search helpers", () => {
  it("builds a stable signature for caching and analytics", () => {
    const a = searchSignature({ query: "denim", city: "Lagos", sort: "relevance" });
    const b = searchSignature({ query: " denim ", city: "Lagos", sort: "relevance" });
    expect(a).toBe(b);
    expect(searchSignature({ category: "Shoes" })).not.toBe(a);
  });

  it("escapes ilike wildcards so a buyer cannot break the SQL pattern", () => {
    expect(escapeLikePattern("50%_off,bale")).toBe("50\\%\\_off,bale");
  });

  it("adapts a domain product into a search view", () => {
    const view = searchViewOfProduct({
      id: "x1",
      title: "Kids Mix Bale",
      description: undefined,
      category: "Kids",
      grade: "B",
      price: 68000,
      city: "Lagos",
      vendorId: "v1",
      hue: 40,
      rating: 4.8,
      sold: 61,
      isBale: true,
    });
    expect(view).toMatchObject({ id: "x1", isBale: true, description: null, createdAt: null });
  });
});
