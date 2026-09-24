import { Package } from "lucide-react";
import type { ReactNode } from "react";

/** Shared frame for auth screens: brand mark, heading, helper text. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="container max-w-md py-10">
      <div className="mb-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Package className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function FormAlert({ tone = "error", children, id }: { tone?: "error" | "success" | "info"; children: ReactNode; id?: string }) {
  const styles = {
    error: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300",
    success: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
    info: "bg-muted text-foreground",
  }[tone];
  return (
    <div id={id} role={tone === "error" ? "alert" : "status"} className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${styles}`}>
      {children}
    </div>
  );
}

/** Google "G" mark (brand guidelines require the multicolour logo). */
export function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-4 w-4">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}
