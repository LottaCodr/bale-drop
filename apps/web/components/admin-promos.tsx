"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Ticket, TicketX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyErrorMessage } from "@/lib/errors";
import { naira } from "@/lib/format";
import { invokeOperation } from "@/lib/operations";
import { isSupabaseLive } from "@/lib/config";
import {
  isValidPromoCode,
  normalizePromoCode,
  promoRedemptionsLeft,
  promoState,
  PROMO_KIND_LABEL,
  PROMO_STATE_LABEL,
} from "@/lib/promos";
import { supabaseBrowser } from "@/lib/supabase";

/**
 * Promo codes: create, cap, expire and switch off.
 *
 * Checkout has always accepted a code, and since migration 0025 `used` is
 * maintained by `reserve_promo_code` / `release_promo_reservation`, so a cap is
 * real. What was missing was any way to *operate* a code: the only writes were
 * hand-editing `seed.sql` or the Table Editor, and the public read policy hides
 * inactive rows, so an admin could not even see a code they had turned off.
 *
 * Reads use the admin policy from migration 0030; both writes go through
 * `admin-action`, which is role-checked, rate-limited and audited. `used` is
 * never written from here.
 */

interface PromoRow {
  id: string;
  code: string;
  kind: string;
  amount_naira: number;
  max_uses: number | null;
  used: number;
  active: boolean;
  expires_at: string | null;
}

/** Column-shaped row → the pure helper's shape (one adapter, no logic here). */
function toSummary(row: PromoRow) {
  return {
    code: row.code,
    kind: row.kind,
    amountNaira: row.amount_naira,
    maxUses: row.max_uses,
    used: row.used,
    active: row.active,
    expiresAt: row.expires_at,
  };
}

export function AdminPromosPanel() {
  const [rows, setRows] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ code: "", amount: "1500", maxUses: "", expires: "" });

  const load = useCallback(async () => {
    if (!isSupabaseLive()) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: readError } = await supabaseBrowser()
      .from("promo_codes")
      .select("id, code, kind, amount_naira, max_uses, used, active, expires_at")
      .order("code", { ascending: true });
    setLoading(false);
    if (readError) {
      // 42P01/42703 = migration 0030 not applied yet; say so instead of failing blank.
      setError(
        friendlyErrorMessage(readError, {
          context: "admin",
          fallback: "We couldn’t load promo codes. Apply migration 0030 and refresh.",
        })
      );
      return;
    }
    setRows((data ?? []) as PromoRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createPromo() {
    const code = normalizePromoCode(draft.code);
    const amount = Number(draft.amount);
    if (!isValidPromoCode(code)) {
      setError("A code needs 3–40 characters: letters, numbers, - or _.");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Enter the discount in naira (0 or more).");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("create");
    const { error: actionError } = await invokeOperation(
      "admin-action",
      {
        action: "create_promo",
        code,
        amount_naira: Math.round(amount),
        kind: "delivery_subsidy",
        max_uses: draft.maxUses.trim() ? Number(draft.maxUses) : null,
        expires_at: draft.expires || null,
      },
      { context: "admin" }
    );
    setBusy(null);
    if (actionError) {
      setError(actionError);
      return;
    }
    setNotice(`${code} created. Buyers can enter it at checkout.`);
    setDraft({ code: "", amount: "1500", maxUses: "", expires: "" });
    setCreating(false);
    await load();
  }

  async function toggleActive(row: PromoRow) {
    setError(null);
    setNotice(null);
    setBusy(row.id);
    const { error: actionError } = await invokeOperation(
      "admin-action",
      { action: "set_promo_active", entity_id: row.id, active: !row.active },
      { context: "admin" }
    );
    setBusy(null);
    if (actionError) {
      setError(actionError);
      return;
    }
    setNotice(row.active ? `${row.code} switched off — it stops working at the next checkout.` : `${row.code} is live again.`);
    await load();
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Delivery subsidies and discount codes. A cap is enforced server-side and released if the buyer never pays.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </Button>
          <Button size="sm" onClick={() => setCreating((value) => !value)}>
            <Plus className="h-4 w-4" /> {creating ? "Close" : "New code"}
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          {notice}
        </p>
      )}

      {creating && (
        <div className="rounded-xl border bg-muted/30 p-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-[13px] font-semibold">
              <span className="mb-1 block text-muted-foreground">Code</span>
              <Input
                value={draft.code}
                onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))}
                placeholder="LAUNCH2000"
                autoCapitalize="characters"
                spellCheck={false}
                aria-label="Promo code"
              />
            </label>
            <label className="text-[13px] font-semibold">
              <span className="mb-1 block text-muted-foreground">Discount ₦</span>
              <Input
                value={draft.amount}
                onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))}
                inputMode="numeric"
                aria-label="Discount in naira"
              />
            </label>
            <label className="text-[13px] font-semibold">
              <span className="mb-1 block text-muted-foreground">Max redemptions</span>
              <Input
                value={draft.maxUses}
                onChange={(event) => setDraft((current) => ({ ...current, maxUses: event.target.value }))}
                inputMode="numeric"
                placeholder="Unlimited"
                aria-label="Maximum redemptions"
              />
            </label>
            <label className="text-[13px] font-semibold">
              <span className="mb-1 block text-muted-foreground">Expires</span>
              <Input
                type="date"
                value={draft.expires}
                onChange={(event) => setDraft((current) => ({ ...current, expires: event.target.value }))}
                aria-label="Expiry date"
              />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The discount raises the delivery subsidy above its ₦ floor; it never takes an order total below zero. One
            redemption per buyer per code.
          </p>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={() => void createPromo()} disabled={busy === "create"}>
              {busy === "create" ? <Loader2 className="animate-spin" /> : <Plus className="h-4 w-4" />} Create code
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading promo codes…</p>
      ) : rows.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Ticket className="h-4 w-4" /> No promo codes yet. Every order still gets the launch delivery subsidy from
          the environment setting.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {rows.map((row) => {
            const state = promoState(toSummary(row));
            return (
              <li key={row.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Ticket className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-bold">{row.code}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {PROMO_KIND_LABEL[row.kind] ?? row.kind} • {naira(row.amount_naira)} •{" "}
                    {row.max_uses == null
                      ? `${row.used} used, no cap`
                      : `${row.used}/${row.max_uses} used · ${promoRedemptionsLeft(toSummary(row)) ?? 0} left`}
                    {row.expires_at
                      ? ` • expires ${new Date(row.expires_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}`
                      : " • no expiry"}
                  </p>
                </div>
                <Badge variant={state === "live" ? "verified" : state === "off" ? "outline" : "amber"}>
                  {PROMO_STATE_LABEL[state]}
                </Badge>
                <Button
                  size="sm"
                  variant={row.active ? "outline" : "default"}
                  onClick={() => void toggleActive(row)}
                  disabled={busy === row.id}
                >
                  {busy === row.id ? <Loader2 className="animate-spin" /> : row.active ? <TicketX className="h-4 w-4" /> : <Ticket className="h-4 w-4" />}
                  {row.active ? "Switch off" : "Turn on"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
