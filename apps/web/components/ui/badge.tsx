import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * shadcn Badge + Bale Drop semantic variants.
 * Grade badges are COLOR-CODED everywhere (A=green, B=sky, C=amber) —
 * buyers learn the system once and read it at a glance.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        verified: "border-transparent bg-emerald-600 text-white",
        inspected: "border-transparent bg-teal-700 text-white",
        live: "border-transparent bg-red-600 text-white",
        gradeA: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
        gradeB: "border-transparent bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
        gradeC: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
        amber: "border-transparent bg-amber-400 text-amber-950",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
