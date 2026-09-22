/** Central formatting helpers — one source of truth for money/time. */

export function naira(amountNaira: number): string {
  return `\u20A6${Math.round(amountNaira).toLocaleString("en-NG")}`;
}

/** Paystack charges in kobo — convert at the boundary, never in UI code. */
export function toKobo(amountNaira: number): number {
  return Math.round(amountNaira * 100);
}

export interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
  /** urgency tier drives color: calm > 24h, soon < 24h, critical < 6h */
  urgency: "calm" | "soon" | "critical" | "expired";
}

export function timeLeft(expiresAt: number): TimeLeft {
  const diff = Math.max(0, expiresAt - Date.now());
  const seconds = Math.floor(diff / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const expired = diff <= 0;
  const urgency: TimeLeft["urgency"] = expired
    ? "expired"
    : diff < 6 * 3600_000
      ? "critical"
      : diff < 24 * 3600_000
        ? "soon"
        : "calm";
  return { days, hours, minutes, seconds: secs, expired, urgency };
}

export function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function pluralize(count: number, one: string, many?: string): string {
  return count === 1 ? one : (many ?? `${one}s`);
}
