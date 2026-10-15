"use client";

export function PayoutBatchBadge({ batchId }: { batchId?: string | null }) {
  if (!batchId) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
      Batch #{batchId.slice(0, 8)}
    </span>
  );
}
