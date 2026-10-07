/**
 * URL ⇄ filter mapping for `/search`.
 *
 * Filters live in the URL (not in a store) because a search result must be
 * shareable, bookmarkable, back-button friendly and cacheable — the state
 * management rule in docs/ENGINEERING-STANDARDS.md §3a. This module is pure so
 * it can be unit tested without rendering anything.
 */
import { normalizeFilters, type ProductFilters } from "@bale-drop/database";
import { CATEGORIES, CITIES } from "./taxonomy";

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

function numberish(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Hard ceiling on how deep the pager goes: `(page - 1) * limit` stays sane. */
export const MAX_PAGE = 200;

/**
 * `page` is 1-based and lives next to the filters in the URL, so a deep result
 * set is still shareable. Anything malformed collapses to page 1 rather than
 * throwing on a hand-edited query string.
 */
export function parsePage(raw: RawSearchParams): number {
  const parsed = Number.parseInt(first(raw.page) ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_PAGE);
}

/** `/search?q=denim&category=Vintage&grade=A&city=Lagos&sort=price_asc&page=2` */
export function parseSearchParams(raw: RawSearchParams): ProductFilters {
  const category = first(raw.category);
  const city = first(raw.city);
  const grade = first(raw.grade)?.toUpperCase();
  return normalizeFilters({
    query: first(raw.q),
    category: category && CATEGORIES.includes(category as (typeof CATEGORIES)[number]) && category !== "All" ? category : undefined,
    city: city && CITIES.includes(city as (typeof CITIES)[number]) ? city : undefined,
    grade: grade === "A" || grade === "B" || grade === "C" ? grade : undefined,
    kind: first(raw.kind) === "bale" || first(raw.kind) === "single" ? (first(raw.kind) as "bale" | "single") : undefined,
    minNaira: numberish(first(raw.min)),
    maxNaira: numberish(first(raw.max)),
    vendorId: first(raw.vendor)?.slice(0, 64),
    sort: first(raw.sort) as ProductFilters["sort"],
  });
}

/** Serialize filters back into a query string (omitting defaults). */
export function toQueryString(filters: ProductFilters & { page?: number }): string {
  const normalized = normalizeFilters(filters);
  const params = new URLSearchParams();
  const page = "page" in filters ? filters.page : undefined;
  if (normalized.query) params.set("q", normalized.query);
  if (normalized.category) params.set("category", normalized.category);
  if (normalized.city) params.set("city", normalized.city);
  if (normalized.grade) params.set("grade", normalized.grade);
  if (normalized.kind) params.set("kind", normalized.kind);
  if (normalized.minNaira !== undefined) params.set("min", String(normalized.minNaira));
  if (normalized.maxNaira !== undefined) params.set("max", String(normalized.maxNaira));
  if (normalized.vendorId) params.set("vendor", normalized.vendorId);
  if (normalized.sort && normalized.sort !== "newest" && normalized.sort !== "relevance") params.set("sort", normalized.sort);
  if (page && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Pager link: same filters, different page. Page 1 drops the param entirely. */
export function buildPageHref(current: ProductFilters, page: number): string {
  return `/search${toQueryString({ ...normalizeFilters(current), page: Math.max(1, page) })}`;
}

/**
 * Build a link that changes one filter while preserving the rest — the pattern
 * that makes chip filters feel like toggles instead of page reloads.
 * `null` clears a key.
 */
export function buildSearchHref(
  current: ProductFilters,
  patch: Partial<Record<keyof ProductFilters | "min" | "max", string | number | null | undefined>>
): string {
  const next: ProductFilters = { ...normalizeFilters(current) };
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "min") mapped.minNaira = value === null || value === undefined || value === "" ? undefined : Number(value);
    else if (key === "max") mapped.maxNaira = value === null || value === undefined || value === "" ? undefined : Number(value);
    else mapped[key] = value === null || value === undefined || value === "" ? undefined : value;
  }
  // Changing a filter always returns to page 1: page 7 of "denim in Lagos"
  // means nothing once the buyer narrows it to Grade A.
  return `/search${toQueryString({ ...next, ...mapped } as ProductFilters & { page?: number })}`;
}

export function hasAnyFilter(filters: ProductFilters): boolean {
  const normalized = normalizeFilters(filters);
  return Boolean(
    normalized.query ||
      normalized.category ||
      normalized.city ||
      normalized.grade ||
      normalized.kind ||
      normalized.minNaira !== undefined ||
      normalized.maxNaira !== undefined
  );
}

export function activeFilterCount(filters: ProductFilters): number {
  const normalized = normalizeFilters(filters);
  return [
    normalized.query,
    normalized.category,
    normalized.city,
    normalized.grade,
    normalized.kind,
    normalized.minNaira ?? normalized.maxNaira,
    normalized.vendorId,
  ].filter((value) => value !== undefined && value !== "").length;
}

/** Copy for empty results: whatever the buyer actually asked for. */
export function describeSearch(filters: ProductFilters): string {
  const normalized = normalizeFilters(filters);
  const parts: string[] = [];
  if (normalized.query) parts.push(`“${normalized.query}”`);
  if (normalized.category) parts.push(normalized.category);
  if (normalized.grade) parts.push(`Grade ${normalized.grade}`);
  if (normalized.city) parts.push(normalized.city);
  if (normalized.kind === "bale") parts.push("bale splits");
  if (normalized.kind === "single") parts.push("single pieces");
  if (normalized.vendorId) parts.push("this vendor");
  return parts.join(" · ") || "everything";
}
