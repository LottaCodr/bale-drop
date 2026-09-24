"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { track } from "@/lib/analytics";

/**
 * Header search. Submits a GET to `/search` so results are shareable, cacheable
 * and keyboard-friendly (research: search that resolves in under 3 interactions
 * is the primary revenue lever — the old form just jumped to a home anchor).
 *
 * The input is uncontrolled on purpose: reading `useSearchParams()` inside the
 * layout would opt every route out of static rendering.
 */
export function SearchField({ placeholder = "Search bales, sneakers, vintage jackets…" }: { placeholder?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  // Reflect the active query when navigating between search pages.
  useEffect(() => {
    const sync = () => {
      if (!input.current) return;
      const q = new URLSearchParams(window.location.search).get("q") ?? "";
      const onSearchPage = window.location.pathname === "/search";
      if (input.current.value !== q) input.current.value = onSearchPage ? q : "";
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return (
    <form
      role="search"
      className="relative w-full"
      onSubmit={(event) => {
        event.preventDefault();
        const q = input.current?.value.trim() ?? "";
        track("view_search_results", { search_term: q || null, source: "header" });
        router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
      }}
    >
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={input}
        name="q"
        type="search"
        enterKeyHint="search"
        placeholder={placeholder}
        className="h-11 rounded-full bg-muted pl-10"
        aria-label="Search products"
      />
    </form>
  );
}
