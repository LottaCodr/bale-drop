"use client";

import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Check, Clock, Share2, ShieldCheck, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CountdownBoxes } from "@/components/countdown";
import { ShareButton } from "@/components/share-button";
import { useBaleLive } from "@/hooks/use-bale-live";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { naira, pad } from "@/lib/format";
import { initializePayment } from "@/lib/payments";
import { PREFS_STORAGE_KEY, usePrefsStore } from "@/lib/store/prefs-store";
import { track } from "@/lib/analytics";
import { claimSlot, slotsLeft, type BaleListing, type Product, type Vendor } from "@bale-drop/database";
import { cn } from "@/lib/utils";

/**
 * How long a `pending` booking holds a slot. Mirrors the `reserved_until`
 * window written by `claim_bale_slot()` and enforced by `release_expired_bale_reservations()`.
 */
const RESERVATION_MS = 10 * 60 * 1000;

/** Re-run a callback when another tab changes the persisted slot claims. */
function syncClaims(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith(PREFS_STORAGE_KEY)) callback();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

function perSlotOf(bale: BaleListing): number {
  return Math.round(bale.totalAmount / bale.splitCount);
}

/** Honest reservation copy: mm:ss when we know the window, generic otherwise. */
function reservationLabel(expiresAt: number | null, now: number): string {
  if (!expiresAt) return "Slot reserved — complete payment to lock it";
  const remaining = Math.max(0, expiresAt - now);
  if (remaining === 0) return "Reservation window closed — re-claim if the slot is still open";
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `Slot reserved for ${pad(minutes)}:${pad(seconds)} — complete payment to lock it`;
}

/**
 * Bale Split booking widget — the conversion core.
 * Server renders `initialBale`; Realtime keeps counters/slots live.
 * Claim path: transactional `claim_bale_slot()` RPC when signed in,
 * demo simulation otherwise (auth UI lands next).
 */
export function BaleWidget({
  initialBale,
  product,
  vendor,
}: {
  initialBale: BaleListing;
  product: Product;
  vendor: Vendor;
}) {
  const bale = useBaleLive(initialBale.id, initialBale);
  const [claimed, setClaimed] = useState(false);
  const [paid, setPaid] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [paymentStarting, setPaymentStarting] = useState(false);
  const slotIdempotencyKey = useRef<string | null>(null);
  const rememberClaim = usePrefsStore((state) => state.rememberClaim);
  const forgetClaim = usePrefsStore((state) => state.forgetClaim);
  const [claimExpiresAt, setClaimExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  /**
   * A reserved slot survives a refresh (or an accidental tab close) because the
   * claim is persisted: a buyer who comes back must be able to finish paying the
   * slot they already hold, not discover it silently lost.
   */
  useEffect(() => {
    const restore = () => {
      const claim = usePrefsStore.getState().slotClaims[initialBale.id];
      if (!claim) return;
      setBookingId((current) => current ?? claim.bookingId);
      setClaimed(true);
      setClaimExpiresAt(claim.claimedAt + RESERVATION_MS);
    };
    restore();
    return syncClaims(restore);
  }, [initialBale.id]);

  // Live countdown on the reservation window; when it lapses we ask the server
  // for the truth instead of guessing (the RPC may already have released it).
  useEffect(() => {
    if (!claimed || paid) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [claimed, paid]);

  const pct = Math.round((bale.bookedCount / bale.splitCount) * 100);
  const left = slotsLeft(bale);
  const perSlot = perSlotOf(bale);

  async function handleClaim() {
    setClaimError(null);
    if (isSupabaseLive()) {
      setClaiming(true);
      try {
        const sb = supabaseBrowser();
        const { data: sessionData } = await sb.auth.getSession();
        if (!sessionData.session) {
          setClaiming(false);
          window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.hash)}`);
          return;
        }
        const { booking, error } = await claimSlot(sb, bale.id);
        if (error || !booking) {
          // RPC enforces one-slot-per-buyer / full / expired — surface it honestly.
          setClaimError(error ?? "Could not reserve this slot");
          setClaiming(false);
          return;
        }
        setBookingId(booking.booking_id);
        setClaimExpiresAt(Date.now() + RESERVATION_MS);
        rememberClaim(bale.id, booking.booking_id);
        track("claim_slot", { item_id: product.id, bale_id: bale.id, value: perSlotOf(bale), slots_left: left });
      } catch (e) {
        setClaimError(e instanceof Error ? e.message : "Claim failed");
        setClaiming(false);
        return;
      }
      setClaiming(false);
    }
    setClaimed(true);
  }

  async function payForSlot() {
    if (!isSupabaseLive()) {
      setPaid(true);
      return;
    }
    if (!bookingId) {
      setClaimError("Reserve the slot first, then try payment again.");
      return;
    }
    setClaimError(null);
    setPaymentStarting(true);
    track("slot_payment_started", { item_id: product.id, bale_id: bale.id, booking_id: bookingId, value: perSlotOf(bale) });
    const idempotencyKey = slotIdempotencyKey.current ?? crypto.randomUUID();
    slotIdempotencyKey.current = idempotencyKey;
    const { data, error, retry_same_attempt: retrySameAttempt } = await initializePayment({
      kind: "slot",
      idempotency_key: idempotencyKey,
      booking_id: bookingId,
      payment_method: "card",
      callback_url: `${window.location.origin}/checkout`,
    });
    if (error || !data) {
      setPaymentStarting(false);
      setClaimError(error ?? "Could not open Paystack");
      // Definitive initialization failures cancel the slot session. Ambiguous
      // provider responses preserve it so the same attempt can be retried.
      if (!retrySameAttempt) {
        setClaimed(false);
        setBookingId(null);
        setClaimExpiresAt(null);
        slotIdempotencyKey.current = null;
        forgetClaim(bale.id);
      }
      return;
    }
    if (data.already_processed) {
      setPaymentStarting(false);
      setPaid(true);
      forgetClaim(bale.id);
      return;
    }
    if (!data.authorization_url) {
      setPaymentStarting(false);
      setClaimError("Paystack did not return an authorization link.");
      return;
    }
    window.location.assign(data.authorization_url);
  }

  return (
    <Card id="book" className="scroll-mt-24 overflow-hidden">
      {/* Live header */}
      <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-4 py-3">
        <Badge variant="live">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
          </span>
          LIVE SPLIT
        </Badge>
        <ShareButton
          title={product.title}
          pricePerSlot={perSlot}
          slotsLeftCount={left}
          variant="ghost"
          size="sm"
          className="[&_a]:hidden"
        />
      </div>

      <div className="flex flex-col gap-4 p-4 md:p-5">
        {/* Price block with anchoring */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-3xl font-extrabold tabular-nums text-primary">{naira(perSlot)}</div>
            <div className="text-[13px] text-muted-foreground">per slot</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold tabular-nums">{naira(bale.totalAmount)}</div>
            <div className="text-[13px] text-muted-foreground">full bale value</div>
          </div>
        </div>

        <CountdownBoxes expiresAt={bale.expiresAt} />

        {/* Fill progress */}
        <div>
          <Progress value={pct} className="h-3" indicatorClassName={left <= 2 ? "bg-red-500" : undefined} />
          <div className="mt-1.5 flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-semibold">
              <Users className="h-4 w-4 text-primary" />
              {bale.bookedCount} of {bale.splitCount} claimed
            </span>
            <span className={cn("font-bold", left <= 2 ? "text-red-600" : "text-amber-600")}>
              Only {left} left
            </span>
          </div>
        </div>

        {/* Slot chips */}
        <div>
          <p className="mb-2 text-[13px] font-semibold text-muted-foreground">Slots</p>
          <div className="grid grid-cols-5 gap-2" role="list" aria-label="Bale slots">
            {Array.from({ length: bale.splitCount }).map((_, i) => {
              const taken = i < bale.bookedCount;
              const joiner = bale.joiners[i];
              return taken ? (
                <div
                  key={i}
                  role="listitem"
                  title={joiner ? `Claimed by ${joiner}` : "Claimed"}
                  className="flex h-11 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground"
                >
                  {joiner ?? <Check className="h-4 w-4" />}
                </div>
              ) : (
                <div
                  key={i}
                  role="listitem"
                  className="flex h-11 items-center justify-center rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 text-sm font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                >
                  {i + 1}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">MVP rule: 1 slot per buyer per bale. No double booking.</p>
        </div>

        {/* Booking states */}
        {claimError && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">
            {claimError}
          </p>
        )}
        {!claimed && (
          <Button size="lg" variant="accent" className="w-full text-base" onClick={handleClaim} disabled={claiming || left === 0}>
            {claiming ? "Reserving…" : left === 0 ? "Split full" : `Claim slot — ${naira(perSlot)}`}
          </Button>
        )}
        {claimed && !paid && (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950/20">
            <p className="flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-200">
              <Clock className="h-4 w-4" /> {reservationLabel(claimExpiresAt, now)}
            </p>
            <Button size="lg" className="w-full text-base" onClick={payForSlot} disabled={paymentStarting}>
              {paymentStarting ? "Opening Paystack…" : `Pay ${naira(perSlot)} with Paystack`}
            </Button>
            <p className="text-center text-xs text-muted-foreground">Card • Bank transfer • USSD</p>
          </div>
        )}
        {paid && (
          <div className="flex flex-col gap-1 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-center dark:bg-emerald-950/20">
            <p className="flex items-center justify-center gap-1.5 font-bold text-emerald-800 dark:text-emerald-200">
              <BadgeCheck className="h-5 w-5" /> You&apos;re in! Slot locked.
            </p>
            <p className="text-sm text-muted-foreground">
              Order BD-2099 • We&apos;ll notify you the moment this split fills.
            </p>
          </div>
        )}

        {/* Guarantees */}
        <div className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-[13px] leading-relaxed">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            <b>Auto-refund guarantee.</b> If this split doesn&apos;t fill before the timer ends,{" "}
            <b>{vendor.shopName}</b> never touches your money — full refund, no stories.
          </p>
        </div>

        {!isSupabaseLive() && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Avatar initials="DE" hue={220} size="xs" />
            Demo data — connect Supabase (docs/SUPABASE-SETUP.md) for live counters.
          </p>
        )}
      </div>
    </Card>
  );
}
