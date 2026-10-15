"use client";

export function VendorScorecard({ score }: { score?: { disputeRate: number; dispatchHours: number } }) {
  const data = score ?? { disputeRate: 0, dispatchHours: 24 };
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-extrabold">Vendor scorecard</h3>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg bg-muted p-2">
          <p className="text-muted-foreground">Dispute rate</p>
          <p className="font-bold">{data.disputeRate.toFixed(1)}%</p>
        </div>
        <div className="rounded-lg bg-muted p-2">
          <p className="text-muted-foreground">Avg dispatch</p>
          <p className="font-bold">{data.dispatchHours}h</p>
        </div>
      </div>
    </div>
  );
}
