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

/**
 * "in 45 min" / "in 31 h" / "in 4 days" — the countdown a buyer actually needs
 * for an escrow release or a closing split.
 *
 * Returns `null` when there is no date to count to (or it is unparseable) so
 * callers can drop the sentence instead of printing "in NaN h". Past-due reads
 * "now": the release is due, the cron will pick it up.
 */
export function untilLabel(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "now";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} days`;
}
