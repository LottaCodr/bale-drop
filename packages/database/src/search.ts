/**
 * Catalog search — one filter vocabulary, two execution paths.
 *
 * `filterProducts()` is a pure function over a normalized "search view", used
 * by the mock/demo path and by unit tests. `searchProducts()` in
 * `queries.ts` translates the *same* `ProductFilters` into a Postgres query for
 * live mode, so a filter can never behave differently in the two modes.
 */
import type { Grade, Product } from "./domain";

export const PRODUCT_SORTS = ["relevance", "newest", "price_asc", "price_desc", "rating"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const SORT_LABELS: Record<ProductSort, string> = {
  relevance: "Most relevant",
  newest: "Newest first",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  rating: "Top rated",
};

export interface ProductFilters {
  query?: string;
  /** "All" (or empty) means "no category filter". */
  category?: string;
  city?: string;
  grade?: Grade;
  kind?: "bale" | "single";
  minNaira?: number;
  maxNaira?: number;
  vendorId?: string;
  sort?: ProductSort;
  limit?: number;
}

/** Structural shape shared by domain products and DB rows. */
export interface SearchView {
  id: string;
  title: string;
  description: string | null;
  category: string;
  city: string;
  grade: Grade;
  price: number;
  isBale: boolean;
  vendorId: string;
  rating: number;
  sold: number;
  createdAt: number | null;
}

/** Words that should pull a category in even when they don't appear in a title. */
export const SEARCH_SYNONYMS: Record<string, string> = {
  sneaker: "Shoes",
  sneakers: "Shoes",
  shoe: "Shoes",
  shoes: "Shoes",
  trainer: "Shoes",
  jacket: "Vintage",
  jackets: "Vintage",
  denim: "Vintage",
  vintage: "Vintage",
  hoodie: "Men",
  hoodies: "Men",
  shirt: "Men",
  shirts: "Men",
  gown: "Women",
  gowns: "Women",
  dress: "Women",
  dresses: "Women",
  bag: "Bags",
  bags: "Bags",
  handbag: "Bags",
  handbags: "Bags",
  kid: "Kids",
  kids: "Kids",
  children: "Kids",
  bale: "Bales",
  bales: "Bales",
  okirika: "All",
  thrift: "All",
};

const MAX_QUERY = 80;

/** Trim, clamp and validate raw (URL-derived) input. Never throws. */
export function normalizeFilters(input: ProductFilters = {}): ProductFilters {
  const query = (input.query ?? "").trim().slice(0, MAX_QUERY);
  const category = input.category && input.category !== "All" ? input.category.slice(0, 40) : undefined;
  const city = input.city?.trim().slice(0, 40) || undefined;
  const grade = input.grade && ["A", "B", "C"].includes(input.grade) ? input.grade : undefined;
  const min = clampMoney(input.minNaira);
  const max = clampMoney(input.maxNaira);
  return {
    query: query || undefined,
    category,
    city,
    grade,
    kind: input.kind === "bale" || input.kind === "single" ? input.kind : undefined,
    minNaira: min === undefined ? undefined : min,
    maxNaira: max === undefined ? undefined : max,
    vendorId: input.vendorId || undefined,
    sort: input.sort && PRODUCT_SORTS.includes(input.sort) ? input.sort : query ? "relevance" : "newest",
    limit: input.limit ? Math.max(1, Math.min(60, Math.round(input.limit))) : undefined,
  };
}

function clampMoney(value: number | undefined): number | undefined {
  if (value === undefined || Number.isNaN(value)) return undefined;
  return Math.max(0, Math.min(100_000_000, Math.round(value)));
}

export function tokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

/** Minimum textual relevance for a product to count as a search match. */
export const MATCH_THRESHOLD = 1;

/**
 * Pure textual relevance for a query (0 = the product has nothing to do with
 * it). Kept separate from quality signals so that "zzz" returns *no* results
 * instead of the best-rated items in the catalog — a mistake that quietly
 * destroys trust in search.
 */
export function textScore(product: SearchView, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const title = product.title.toLowerCase();
  const category = product.category.toLowerCase();
  const description = (product.description ?? "").toLowerCase();
  let score = 0;
  if (title.includes(q)) score += 60;
  if (category === q) score += 30;
  if (category.includes(q)) score += 20;
  if (description.includes(q)) score += 12;
  for (const token of tokens(q)) {
    if (title.includes(token)) score += 14;
    else if (category.includes(token)) score += 8;
    else if (description.includes(token)) score += 4;
    const synonym = SEARCH_SYNONYMS[token];
    // A synonym only counts when it points at this product's category.
    if (synonym && synonym !== "All" && category === synonym.toLowerCase()) score += 6;
  }
  return score;
}

/**
 * Ranking score = textual relevance + small quality nudges so equally relevant
 * listings order sensibly. Only call it for products that already matched.
 */
export function scoreProduct(product: SearchView, query: string): number {
  const relevance = textScore(product, query);
  if (relevance === 0) {
    // No query (or no textual hit, which callers have already filtered out):
    // fall back to quality so sorting stays deterministic.
    return Math.min(6, product.rating) + Math.min(6, product.sold / 50);
  }
  return relevance + Math.min(6, product.rating) + Math.min(6, product.sold / 50);
}

export function matchesFilters(product: SearchView, filters: ProductFilters): boolean {
  if (filters.category && product.category.toLowerCase() !== filters.category.toLowerCase()) return false;
  if (filters.city && product.city.toLowerCase() !== filters.city.toLowerCase()) return false;
  if (filters.grade && product.grade !== filters.grade) return false;
  if (filters.kind && product.isBale !== (filters.kind === "bale")) return false;
  if (filters.vendorId && product.vendorId !== filters.vendorId) return false;
  if (filters.minNaira !== undefined && product.price < filters.minNaira) return false;
  if (filters.maxNaira !== undefined && product.price > filters.maxNaira) return false;
  // A query must be an actual textual match — never padded by ratings/sales.
  if (filters.query && textScore(product, filters.query) < MATCH_THRESHOLD) return false;
  return true;
}

export function sortViews<T extends SearchView>(list: T[], filters: ProductFilters): T[] {
  const sort = filters.sort ?? "newest";
  const copy = [...list];
  switch (sort) {
    case "price_asc":
      return copy.sort((a, b) => a.price - b.price);
    case "price_desc":
      return copy.sort((a, b) => b.price - a.price);
    case "rating":
      return copy.sort((a, b) => b.rating - a.rating || b.sold - a.sold);
    case "relevance":
      return copy.sort(
        (a, b) => scoreProduct(b, filters.query ?? "") - scoreProduct(a, filters.query ?? "") || b.sold - a.sold
      );
    case "newest":
    default:
      return copy.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.sold - a.sold);
  }
}

/** Pure catalog search over already-loaded items (mock/demo path + tests). */
export function filterProducts<T extends SearchView>(list: T[], rawFilters: ProductFilters = {}): T[] {
  const filters = normalizeFilters(rawFilters);
  const matched = list.filter((product) => matchesFilters(product, filters));
  const sorted = sortViews(matched, filters);
  return filters.limit ? sorted.slice(0, filters.limit) : sorted;
}

/** Domain model → search view. */
export function searchViewOfProduct(product: Product, createdAt?: number): SearchView {
  return {
    id: product.id,
    title: product.title,
    description: product.description ?? null,
    category: product.category,
    city: product.city,
    grade: product.grade,
    price: product.price,
    isBale: product.isBale,
    vendorId: product.vendorId,
    rating: product.rating,
    sold: product.sold,
    createdAt: createdAt ?? null,
  };
}

/** Stable cache/analytics key for a filter set. */
export function searchSignature(rawFilters: ProductFilters): string {
  const f = normalizeFilters(rawFilters);
  return [
    f.query ?? "",
    f.category ?? "",
    f.city ?? "",
    f.grade ?? "",
    f.kind ?? "",
    f.minNaira ?? "",
    f.maxNaira ?? "",
    f.vendorId ?? "",
    f.sort ?? "",
  ].join("|");
}

/** Human summary for empty states: "Grade A · Shoes · Lagos". */
export function describeFilters(rawFilters: ProductFilters): string[] {
  const f = normalizeFilters(rawFilters);
  const parts: string[] = [];
  if (f.query) parts.push(`“${f.query}”`);
  if (f.kind === "bale") parts.push("Bale splits");
  if (f.category) parts.push(f.category);
  if (f.grade) parts.push(`Grade ${f.grade}`);
  if (f.city) parts.push(f.city);
  if (f.minNaira !== undefined || f.maxNaira !== undefined)
    parts.push(`₦${f.minNaira ?? 0}–${f.maxNaira ?? "∞"}`);
  return parts;
}

/**
 * Escape user input for a Postgres `ilike` pattern. `%` and `_` are wildcards
 * and `\` is the escape character itself, so all three get a backslash.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}



/**
 * Make a search term safe to embed in a PostgREST filter expression.
 *
 * supabase-js sends `or(title.ilike.%term%,...)` as raw filter grammar, where
 * `,` `.` `(` `)` `:` `"` `'` `*` `%` are operators. A buyer typing "levi's,
 * size M (blue)" must not be able to reshape that expression, so we strip the
 * grammar characters (they carry no meaning for a keyword search) and keep only
 * word characters, spaces and hyphens. Returns "" when nothing usable is left.
 */
export function sanitizeRemoteQuery(value: string): string {
  return value
    .replace(/[,.():"'*%\\]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY);
}
