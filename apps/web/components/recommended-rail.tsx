"use client";

export function RecommendedRail({ productIds }: { productIds: string[] }) {
  return (
    <section aria-label="Recommended for you" className="mt-10 border-t pt-6">
      <h2 className="text-sm font-extrabold tracking-tight">Because you viewed…</h2>
      <p className="text-[11px] text-muted-foreground">Recommendations grow as you browse.</p>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
        {productIds.slice(0, 5).map((id) => (
          <a key={id} href={`/listing/${id}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] font-bold text-muted-foreground hover:bg-primary hover:text-primary-foreground transition">
            {id.slice(0, 4)}
          </a>
        ))}
      </div>
    </section>
  );
}
