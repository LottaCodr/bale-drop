"use client";

import { useEffect } from "react";
import type { ProductFilters } from "@bale-drop/database";
import { track } from "@/lib/analytics";

/** Fires `view_search_results` once per result set (funnel: search → cart). */
export function SearchTracker({ filters, resultCount }: { filters: ProductFilters; resultCount: number }) {
  const signature = [
    filters.query ?? "",
    filters.category ?? "",
    filters.city ?? "",
    filters.grade ?? "",
    filters.kind ?? "",
    filters.minNaira ?? "",
    filters.maxNaira ?? "",
    filters.sort ?? "",
  ].join("|");

  useEffect(() => {
    track("view_search_results", {
      search_term: filters.query ?? null,
      filter_category: filters.category ?? null,
      filter_city: filters.city ?? null,
      filter_grade: filters.grade ?? null,
      filter_kind: filters.kind ?? null,
      result_count: resultCount,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signature is the stable key
  }, [signature, resultCount]);

  return null;
}
