"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Accessible quantity stepper (44px targets). Inline editing — never send a
 * buyer to another screen just to change a quantity.
 */
export function QtyStepper({
  value,
  onChange,
  min = 1,
  max = 20,
  label = "Quantity",
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("inline-flex items-center rounded-xl border bg-background", className)}
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-l-xl text-foreground transition hover:bg-muted disabled:opacity-40"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`Decrease ${label.toLowerCase()}`}
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-8 text-center text-sm font-bold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-r-xl text-foreground transition hover:bg-muted disabled:opacity-40"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`Increase ${label.toLowerCase()}`}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
