"use client";

import { Check, Circle } from "lucide-react";
import { checkPassword, PASSWORD_MIN, type PasswordContext } from "@/lib/auth/password";
import { cn } from "@/lib/utils";

const BAR_COLORS = ["bg-muted", "bg-red-500", "bg-amber-500", "bg-emerald-500", "bg-emerald-600"];
const TEXT_COLORS = ["text-muted-foreground", "text-red-600 dark:text-red-400", "text-amber-700 dark:text-amber-300", "text-emerald-700 dark:text-emerald-300", "text-emerald-700 dark:text-emerald-300"];

/**
 * Live strength meter + guidance for new passwords. Length-first (NIST): we
 * nudge towards passphrases instead of demanding symbols.
 */
export function PasswordStrength({ id, password, context, hideError }: { id: string; password: string; context?: PasswordContext; hideError?: boolean }) {
  const check = checkPassword(password, context);
  const longEnough = password.length >= PASSWORD_MIN;

  return (
    <div id={id} className="mt-2" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((segment) => (
          <span
            key={segment}
            className={cn("h-1.5 flex-1 rounded-full transition-colors", password && check.strength >= segment ? BAR_COLORS[check.strength] : "bg-muted")}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className={cn("flex items-center gap-1", longEnough ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
          {longEnough ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Circle className="h-3 w-3" aria-hidden="true" />}
          At least {PASSWORD_MIN} characters
        </span>
        {password && (
          <span className={cn("font-semibold", TEXT_COLORS[check.strength])}>
            Strength: {check.label}
          </span>
        )}
      </div>
      {password && longEnough && check.error && !hideError && <p className="mt-1 text-xs font-semibold text-red-600 dark:text-red-400">{check.error}</p>}
      {password && check.ok && check.strength < 3 && (
        <p className="mt-1 text-xs text-muted-foreground">Tip: a short phrase like “yellow-bale-market-2026” is stronger and easier to remember.</p>
      )}
    </div>
  );
}
