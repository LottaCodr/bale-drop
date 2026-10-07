"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, RefreshCw, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import {
  funnelRate,
  ledgerTotals,
  loadFunnel,
  loadLedger,
  loadRefunds,
  loadSessions,
  type FunnelStep,
  type LedgerRow,
  type RefundRow,
  type SessionRow,
} from "@/lib/admin-ledger";
import { friendlyErrorMessage } from "@/lib/errors";
import { naira } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The money room: what came in, what went out, what is stuck.
 *
 * Read-only by design — every mutation still goes through `admin-action`,
 * `vendor-payout`, or a database RPC, so this panel can never move money, only
 * show where it is. Refunds in `failed` and sessions stuck in `pending` are the
 * two queues that used to be invisible to everyone but Paystack support.
 */

const KIND_LABEL: Record<string, string> = {
  pay_in: "Buyer paid",
  commission: "Commission",
  payout: "Vendor payout",
  refund: "Refund",
};

const SESSION_LABEL: Record<string, string> = {
  pending: "Awaiting Paystack",
  failed: "Failed",
  abandoned: "Abandoned",
};

function shortId(id: string | null): string {
  return id ? `${id.slice(0, 8)}` : "—";
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AdminMoneyPanel() {
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [funnel, setFunnel] = useState<FunnelStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Independent reads: one slow table must not hold up the others.
      const [ledgerRows, refundRows, sessionRows, funnelRows] = await Promise.all([
        loadLedger(40).catch(() => [] as LedgerRow[]),
        loadRefunds(25).catch(() => [] as RefundRow[]),
        loadSessions(25).catch(() => [] as SessionRow[]),
        loadFunnel(7).catch(() => [] as FunnelStep[]),
      ]);
      setLedger(ledgerRows);
      setRefunds(refundRows);
      setSessions(sessionRows);
      setFunnel(funnelRows);
    } catch (readError) {
      setError(
        friendlyErrorMessage(readError, {
          context: "admin",
          fallback: "We couldn’t load the money views. Please refresh and try again.",
        })
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = ledgerTotals(ledger);
  const inflow = totals.pay_in ?? 0;
  const commission = totals.commission ?? 0;
  const paidOut = totals.payout ?? 0;
  const refunded = totals.refund ?? 0;

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Append-only ledger, refund queue, unfinished payments and the buyer funnel. Read-only — money moves through
          payouts and dispute decisions.
        </p>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Totals from the rows on screen — a sample, not a reconciliation. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Collected", value: inflow, tone: "text-foreground" },
          { label: "Commission earned", value: commission, tone: "text-foreground" },
          { label: "Paid to vendors", value: paidOut, tone: "text-foreground" },
          { label: "Refunded", value: refunded, tone: refunded > 0 ? "text-red-600 dark:text-red-400" : "text-foreground" },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-[13px] text-muted-foreground">{stat.label}</p>
            <p className={cn("text-base font-extrabold tabular-nums sm:text-xl", stat.tone)}>{naira(stat.value)}</p>
          </Card>
        ))}
      </div>
      <p className="-mt-2 text-[11px] text-muted-foreground">
        Totals cover the {ledger.length} most recent ledger rows, not all time.
      </p>

      {/* Refunds needing a human */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <AlertTriangle className="h-4 w-4 text-amber-500" /> Refunds needing attention
          <Badge variant="outline">{refunds.length}</Badge>
        </h3>
        {loading ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        ) : refunds.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing stuck. Refunds are claimed and settled by <code className="font-mono text-xs">admin-action</code> and
            the payout reconciler.
          </p>
        ) : (
          <ul className="mt-2 divide-y rounded-xl border">
            {refunds.map((refund) => (
              <li key={`${refund.source}-${refund.id}`} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">
                    {naira(refund.amountNaira)}{" "}
                    <span className="font-mono text-xs font-normal text-muted-foreground">
                      {refund.source === "order" ? `order ${shortId(refund.entityId)}` : `slot ${shortId(refund.entityId)}`}
                    </span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {refund.reference} • requested {when(refund.requestedAt)} • {refund.attempts} attempt
                    {refund.attempts === 1 ? "" : "s"}
                    {refund.lastError ? ` • ${refund.lastError}` : ""}
                  </p>
                </div>
                <Badge variant={refund.status === "failed" || refund.status === "needs_attention" ? "amber" : "outline"}>
                  {refund.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sessions that never became money */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <Wallet className="h-4 w-4 text-primary" /> Payments that did not complete
          <Badge variant="outline">{sessions.length}</Badge>
        </h3>
        {loading ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No unfinished payment sessions.</p>
        ) : (
          <ul className="mt-2 divide-y rounded-xl border">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">
                    {naira(session.amountNaira)}{" "}
                    <span className="font-mono text-xs font-normal text-muted-foreground">{session.reference}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {session.kind === "slot" ? "Bale slot" : `${session.amountNaira ? "Order batch" : "Order"}`} •{" "}
                    {when(session.createdAt)}
                    {session.channel ? ` • ${session.channel}` : ""}
                    {session.failureReason ? ` • ${session.failureReason}` : ""}
                  </p>
                </div>
                <Badge variant="outline">{SESSION_LABEL[session.status] ?? session.status}</Badge>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          <code className="font-mono">expire_uninitialized_payment_sessions</code> closes sessions nobody paid after 30
          minutes; a <code className="font-mono">pending</code> row older than that means the webhook never arrived.
        </p>
      </section>

      {/* Funnel */}
      <section>
        <h3 className="text-sm font-bold">Buyer funnel — last 7 days</h3>
        {funnel.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No funnel data yet.</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-1.5">
            {funnel.map((step, index) => {
              const rate = funnelRate(funnel, index);
              return (
                <li key={step.event} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 text-[13px] font-medium">{step.label}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.max(2, rate ?? 0)}%` }}
                    />
                  </span>
                  <span className="w-24 shrink-0 text-right text-[13px] font-bold tabular-nums">{step.count}</span>
                  <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {rate == null ? "—" : `${rate}%`}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Ledger */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <ArrowDownLeft className="h-4 w-4 text-primary" />
          <ArrowUpRight className="h-4 w-4 text-primary" /> Ledger
        </h3>
        {loading ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        ) : ledger.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No ledger rows yet. Every payment, commission, payout and refund writes one.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-bold">When</th>
                  <th className="px-3 py-2 font-bold">Kind</th>
                  <th className="px-3 py-2 text-right font-bold">Amount</th>
                  <th className="px-3 py-2 font-bold">Order / slot</th>
                  <th className="px-3 py-2 font-bold">Vendor</th>
                  <th className="px-3 py-2 font-bold">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {ledger.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{when(row.createdAt)}</td>
                    <td className="px-3 py-2 font-semibold">{KIND_LABEL[row.kind] ?? row.kind}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-bold tabular-nums",
                        row.kind === "refund" && "text-red-600 dark:text-red-400"
                      )}
                    >
                      {row.kind === "refund" ? "−" : ""}
                      {naira(row.amountNaira)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {shortId(row.orderId ?? row.bookingId)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{shortId(row.vendorId)}</td>
                    <td className="max-w-[180px] truncate px-3 py-2 font-mono text-xs text-muted-foreground">
                      {row.reference ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
