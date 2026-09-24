import { Card } from "@/components/ui/card";

/**
 * Route-level loading skeleton. The Definition of Done requires loading, empty
 * and error states on every screen; this covers navigation between routes while
 * a server component fetches (cards keep their aspect ratio, so zero layout
 * shift when the real content lands).
 */
export default function Loading() {
  return (
    <div className="container py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page…</span>
      <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted" />
      <div className="mt-6 grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Card key={index} className="overflow-hidden p-0">
            <div className="aspect-[4/3] w-full animate-pulse bg-muted" />
            <div className="flex flex-col gap-2 p-3.5">
              <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
              <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
