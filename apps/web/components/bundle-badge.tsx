"use client";

export function BundleBadge({ qty }: { qty: number }) {
  if (qty < 2) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800 dark:bg-violet-900/30 dark:text-violet-200">
      Bundle eligible
    </span>
  );
}
