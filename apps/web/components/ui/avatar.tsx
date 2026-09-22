import * as React from "react";
import { cn } from "@/lib/utils";

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  initials: string;
  hue?: number;
  size?: "xs" | "sm" | "md" | "lg";
}

/** Initials avatar — deterministic color from hue, zero network cost. */
const sizes = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
} as const;

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, initials, hue = 160, size = "md", ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full font-bold text-white ring-2 ring-background",
        sizes[size],
        className
      )}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 30) % 360} 60% 32%))` }}
      {...props}
    >
      {initials}
    </div>
  )
);
Avatar.displayName = "Avatar";

function AvatarStack({ items, max = 5, className }: { items: { initials: string; hue?: number }[]; max?: number; className?: string }) {
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;
  return (
    <div className={cn("flex -space-x-2", className)}>
      {shown.map((a, i) => (
        <Avatar key={`${a.initials}-${i}`} initials={a.initials} hue={a.hue ?? (i * 47) % 360} size="sm" />
      ))}
      {extra > 0 && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground ring-2 ring-background">
          +{extra}
        </div>
      )}
    </div>
  );
}

export { Avatar, AvatarStack };
