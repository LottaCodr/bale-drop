/**
 * Promo code helpers shared by checkout copy and the admin console.
 *
 * Pure and dependency-free so the redemption rules can be unit tested without
 * rendering anything: whether a code is usable is a money question, and the
 * admin list must agree with what `reserve_promo_code()` will actually accept.
 */

export type PromoKind = "delivery_subsidy" | "percentage" | string;

export interface PromoSummary {
  code: string;
  kind: PromoKind;
  amountNaira: number;
  maxUses: number | null;
  used: number;
  active: boolean;
  expiresAt: string | null;
}

export type PromoState = "live" | "expired" | "exhausted" | "off";

export const PROMO_KIND_LABEL: Record<string, string> = {
  delivery_subsidy: "Delivery subsidy",
  percentage: "Percentage",
};

export const PROMO_STATE_LABEL: Record<PromoState, string> = {
  live: "Live",
  expired: "Expired",
  exhausted: "Cap reached",
  off: "Switched off",
};

/**
 * Whether a code can still be redeemed.
 *
 * Mirrors `reserve_promo_code()` (migration 0025) in the same order it checks:
 * inactive first, then expiry, then the cap. The order matters for the admin
 * list — a code that is both expired and switched off should read as "off",
 * because that is the state an operator last chose.
 */
export function promoState(promo: PromoSummary, now: number = Date.now()): PromoState {
  if (!promo.active) return "off";
  if (promo.expiresAt && Date.parse(promo.expiresAt) <= now) return "expired";
  if (promo.maxUses != null && promo.used >= promo.maxUses) return "exhausted";
  return "live";
}

/** Codes are compared uppercased at checkout; the admin form stores them that way. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

/** 3–40 characters after normalisation, matching the column constraint (0030). */
export function isValidPromoCode(raw: string): boolean {
  const code = normalizePromoCode(raw);
  return code.length >= 3 && code.length <= 40;
}

/** Remaining redemptions, or `null` when the code is uncapped. */
export function promoRedemptionsLeft(promo: PromoSummary): number | null {
  if (promo.maxUses == null) return null;
  return Math.max(0, promo.maxUses - promo.used);
}
