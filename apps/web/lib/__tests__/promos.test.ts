import { describe, expect, it } from "vitest";
import {
  isValidPromoCode,
  normalizePromoCode,
  promoRedemptionsLeft,
  promoState,
  type PromoSummary,
} from "@/lib/promos";
import { funnelRate, ledgerTotals, type FunnelStep, type LedgerRow } from "@/lib/admin-ledger";

/**
 * Promo codes and the admin ledger are both money surfaces: the first decides
 * what a buyer is allowed to deduct, the second is what an operator reads to
 * find money that did not move. Both are pure functions over stored rows, so
 * the rules are asserted here rather than in a browser.
 */

const NOW = Date.parse("2026-03-01T12:00:00.000Z");

function promo(over: Partial<PromoSummary> = {}): PromoSummary {
  return {
    code: "LAUNCH1500",
    kind: "delivery_subsidy",
    amountNaira: 1500,
    maxUses: null,
    used: 0,
    active: true,
    expiresAt: null,
    ...over,
  };
}

describe("promo code normalisation", () => {
  it("uppercases and strips characters the column constraint rejects", () => {
    expect(normalizePromoCode("  launch 1500! ")).toBe("LAUNCH1500");
    expect(normalizePromoCode("save_20-off")).toBe("SAVE_20-OFF");
  });

  it("enforces the 3–40 character window", () => {
    expect(isValidPromoCode("AB")).toBe(false);
    expect(isValidPromoCode("ABC")).toBe(true);
    expect(isValidPromoCode("A".repeat(40))).toBe(true);
    expect(isValidPromoCode("A".repeat(41))).toBe(false);
    // Stripped-to-nothing input is not a code.
    expect(isValidPromoCode("!!!")).toBe(false);
  });
});

describe("promo redeemability", () => {
  it("is live when active, unexpired and under the cap", () => {
    expect(promoState(promo(), NOW)).toBe("live");
    expect(promoState(promo({ maxUses: 10, used: 9 }), NOW)).toBe("live");
    expect(promoState(promo({ expiresAt: new Date(NOW + 60_000).toISOString() }), NOW)).toBe("live");
  });

  it("reports an admin switch-off ahead of expiry or cap", () => {
    // The order matters: "off" is the state an operator chose, so it wins.
    expect(promoState(promo({ active: false }), NOW)).toBe("off");
    expect(
      promoState(promo({ active: false, expiresAt: new Date(NOW - 1).toISOString(), maxUses: 2, used: 2 }), NOW)
    ).toBe("off");
  });

  it("expires at the boundary, not after it", () => {
    expect(promoState(promo({ expiresAt: new Date(NOW).toISOString() }), NOW)).toBe("expired");
    expect(promoState(promo({ expiresAt: new Date(NOW - 1).toISOString() }), NOW)).toBe("expired");
  });

  it("is exhausted exactly when the cap is reached", () => {
    expect(promoState(promo({ maxUses: 1, used: 1 }), NOW)).toBe("exhausted");
    expect(promoState(promo({ maxUses: 1, used: 2 }), NOW)).toBe("exhausted");
    expect(promoRedemptionsLeft(promo({ maxUses: 5, used: 2 }))).toBe(3);
    // An oversold legacy row must never report negative headroom.
    expect(promoRedemptionsLeft(promo({ maxUses: 2, used: 9 }))).toBe(0);
    expect(promoRedemptionsLeft(promo({ maxUses: null, used: 999 }))).toBeNull();
  });
});

describe("ledger totals", () => {
  const row = (kind: string, amountNaira: number): LedgerRow => ({
    id: `${kind}-${amountNaira}`,
    kind,
    amountNaira,
    orderId: null,
    bookingId: null,
    vendorId: null,
    reference: null,
    createdAt: "2026-03-01T12:00:00.000Z",
  });

  it("sums by kind so inflow, commission, payout and refund stay separable", () => {
    const totals = ledgerTotals([
      row("pay_in", 100000),
      row("pay_in", 25000),
      row("commission", 7000),
      row("payout", 93000),
      row("refund", 25000),
    ]);
    expect(totals).toEqual({ pay_in: 125000, commission: 7000, payout: 93000, refund: 25000 });
  });

  it("does not net a refund against a pay-in — the ledger is append-only", () => {
    const totals = ledgerTotals([row("pay_in", 50000), row("refund", 50000)]);
    expect(totals.pay_in).toBe(50000);
    expect(totals.refund).toBe(50000);
  });

  it("returns an empty object for an empty ledger", () => {
    expect(ledgerTotals([])).toEqual({});
  });
});

describe("funnel rate", () => {
  const steps = (counts: number[]): FunnelStep[] =>
    counts.map((count, index) => ({ count, event: `e${index}`, label: `Step ${index}` }));

  it("measures every step against the first, not the previous one", () => {
    const funnel = steps([1000, 400, 200, 120, 100]);
    expect(funnelRate(funnel, 0)).toBe(100);
    expect(funnelRate(funnel, 1)).toBe(40);
    expect(funnelRate(funnel, 4)).toBe(10);
  });

  it("says 'unknown' rather than dividing by zero on an empty window", () => {
    expect(funnelRate(steps([0, 0]), 1)).toBeNull();
    expect(funnelRate([], 0)).toBeNull();
  });

  it("rounds to whole percent so the bar and the number agree", () => {
    expect(funnelRate(steps([3, 1]), 1)).toBe(33);
    expect(funnelRate(steps([6, 1]), 1)).toBe(17);
  });
});
