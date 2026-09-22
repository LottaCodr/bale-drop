"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { pad, timeLeft, type TimeLeft } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Live countdown primitives. Mount-gated to avoid SSR hydration mismatch —
 * server renders a skeleton, client takes over ticking every second.
 * Production: `expiresAt` comes from Supabase Realtime (`bale_listings`).
 */
export function useCountdown(expiresAt: number): TimeLeft | null {
  const [, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!mounted) return null;
  return timeLeft(expiresAt);
}

const urgencyText: Record<TimeLeft["urgency"], string> = {
  calm: "text-emerald-700 dark:text-emerald-300",
  soon: "text-amber-700 dark:text-amber-300",
  critical: "text-red-600 dark:text-red-400",
  expired: "text-muted-foreground",
};

/** Single-line countdown for cards: "2d 4h left". */
export function CompactCountdown({ expiresAt, className }: { expiresAt: number; className?: string }) {
  const left = useCountdown(expiresAt);
  if (!left) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground", className)}>
        <Timer className="h-3.5 w-3.5" /> …
      </span>
    );
  }
  if (left.expired) return <span className="text-xs font-semibold text-muted-foreground">Expired</span>;
  const label =
    left.days > 0
      ? `${left.days}d ${left.hours}h left`
      : left.hours > 0
        ? `${left.hours}h ${left.minutes}m left`
        : `${left.minutes}m ${pad(left.seconds)}s left`;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-bold tabular-nums", urgencyText[left.urgency], className)}>
      <Timer className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

/** Boxed DD:HH:MM:SS countdown for the booking widget. */
export function CountdownBoxes({ expiresAt }: { expiresAt: number }) {
  const left = useCountdown(expiresAt);
  const cells = left
    ? [
        { v: pad(left.days), l: "days" },
        { v: pad(left.hours), l: "hrs" },
        { v: pad(left.minutes), l: "min" },
        { v: pad(left.seconds), l: "sec" },
      ]
    : [
        { v: "--", l: "days" },
        { v: "--", l: "hrs" },
        { v: "--", l: "min" },
        { v: "--", l: "sec" },
      ];
  return (
    <div className="grid grid-cols-4 gap-2" role="timer" aria-label="Time left to join this split">
      {cells.map((c) => (
        <div key={c.l} className="rounded-xl bg-muted px-2 py-2 text-center">
          <div className="text-lg font-extrabold tabular-nums leading-none">{c.v}</div>
          <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{c.l}</div>
        </div>
      ))}
    </div>
  );
}
