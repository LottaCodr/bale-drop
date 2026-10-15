"use client";

export function CohortRate({ rate }: { rate: number }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[11px] text-muted-foreground">Repeat rate (30d)</p>
      <p className="text-xl font-extrabold">{(rate * 100).toFixed(0)}%</p>
    </div>
  );
}
