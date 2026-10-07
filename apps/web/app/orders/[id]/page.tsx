import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Clock, Printer, Receipt, ShieldCheck, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ServiceUnavailable } from "@/components/service-unavailable";
import { getOrderReceipt } from "@/lib/data";
import { naira } from "@/lib/format";
import { isSupabaseLive } from "@/lib/config";

/**
 * The receipt — `/orders/[id]`.
 *
 * A marketplace that holds a buyer's money in escrow owes them a document: what
 * was bought, what it cost, the breakdown the server actually charged, when the
 * money moved and where it is now. Until this page existed the only record was
 * the order card on `/orders`, which showed a total and nothing else — so a
 * buyer who needed proof for a dispute, a bank or their own bookkeeping had
 * none, and the email receipt (added in `_shared/notify.ts`) linked back to a
 * list rather than to the order.
 *
 * Everything here is read with the buyer's own session, so RLS decides what is
 * visible; an order that is not theirs 404s rather than leaking that it exists.
 */
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid — escrow held",
  processing: "Processing",
  ready: "Ready to ship",
  in_transit: "In transit",
  delivered: "Delivered",
  disputed: "Dispute open",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

const ESCROW_LABEL: Record<string, string> = {
  none: "No payment yet",
  held: "Held in escrow",
  released: "Released to the seller",
  refunded: "Refunded to you",
  partial_refund: "Partly refunded",
};

const LEDGER_LABEL: Record<string, string> = {
  pay_in: "You paid",
  commission: "Platform commission",
  payout: "Seller payout",
  refund: "Refund",
  subsidy: "Delivery subsidy",
};

const TIMELINE_LABEL: Record<string, string> = {
  pending_payment: "Order created, awaiting payment",
  paid: "Payment received into escrow",
  processing: "Seller started packing",
  ready: "Ready to ship",
  in_transit: "Handed to the courier",
  delivered: "Delivered",
  disputed: "Dispute opened, escrow paused",
  refunded: "Refunded to your payment method",
  cancelled: "Order cancelled",
};

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

function dateTimeLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const receipt = await getOrderReceipt(id);
  if (!receipt) return { title: "Order" };
  return {
    title: `Receipt ${receipt.reference} | Bale Drop`,
    description: `Receipt for ${receipt.reference}: ${naira(receipt.total)} on ${dateLabel(receipt.placedAt)}.`,
  };
}

export default async function OrderReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseLive()) {
    return <ServiceUnavailable title="Receipts are temporarily unavailable" description="We could not load this receipt right now. Please try again in a minute." />;
  }

  const { id } = await params;
  const receipt = await getOrderReceipt(id);
  if (!receipt) notFound();

  const released = receipt.escrow === "released";
  const disputed = receipt.status === "disputed";

  return (
    <div className="container max-w-2xl py-6 print:max-w-none print:py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/orders">
            <ArrowLeft className="h-4 w-4" /> All orders
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => globalThis.print?.()}>
          <Printer className="h-4 w-4" /> Print / save as PDF
        </Button>
      </div>

      <Card className="mt-3 p-5 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <Receipt className="h-3.5 w-3.5" /> Receipt
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{receipt.reference}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Placed {dateTimeLabel(receipt.placedAt)}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant={released ? "verified" : disputed ? "live" : "amber"}>
              {STATUS_LABEL[receipt.status] ?? receipt.status}
            </Badge>
            <span className="text-xs text-muted-foreground">{ESCROW_LABEL[receipt.escrow] ?? receipt.escrow}</span>
          </div>
        </header>

        <Separator className="my-4" />

        {/* Lines */}
        <table className="w-full text-sm">
          <caption className="sr-only">Items on this order</caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="pb-2 font-semibold">Item</th>
              <th scope="col" className="pb-2 text-right font-semibold">Qty</th>
              <th scope="col" className="pb-2 text-right font-semibold">Unit</th>
              <th scope="col" className="pb-2 text-right font-semibold">Line total</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-muted-foreground">No line items recorded for this order.</td>
              </tr>
            ) : (
              receipt.lines.map((line) => (
                <tr key={`${line.title}-${line.productId ?? "line"}`} className="border-t">
                  <td className="py-2.5 pr-2">
                    {line.productId ? (
                      <Link className="font-semibold hover:text-primary hover:underline" href={`/listing/${line.productId}`}>
                        {line.title}
                      </Link>
                    ) : (
                      <span className="font-semibold">{line.title}</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{line.qty}</td>
                  <td className="py-2.5 text-right tabular-nums">{naira(line.unit)}</td>
                  <td className="py-2.5 text-right font-semibold tabular-nums">{naira(line.unit * line.qty)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Money breakdown — the server's numbers, not a re-computation */}
        <dl className="mt-4 space-y-1.5 rounded-xl bg-muted/50 p-3 text-sm print:bg-transparent">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="font-semibold tabular-nums">{naira(receipt.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Delivery</dt>
            <dd className="font-semibold tabular-nums">{naira(receipt.deliveryFee)}</dd>
          </div>
          {receipt.subsidy > 0 && (
            <div className="flex justify-between text-emerald-700 dark:text-emerald-300">
              <dt>Delivery subsidy</dt>
              <dd className="font-semibold tabular-nums">−{naira(receipt.subsidy)}</dd>
            </div>
          )}
          <Separator />
          <div className="flex justify-between text-base">
            <dt className="font-bold">Total paid</dt>
            <dd className="font-extrabold tabular-nums">{naira(receipt.total)}</dd>
          </div>
        </dl>

        {/* Where the money is */}
        <div className="mt-4 flex flex-col gap-2">
          {released && (
            <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
              Escrow released{receipt.deliveredAt ? ` on ${dateLabel(receipt.deliveredAt)}` : ""}. The seller has been paid.
            </p>
          )}
          {!released && !disputed && receipt.status !== "refunded" && receipt.status !== "cancelled" && (
            <p className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                {naira(receipt.total)} is held in escrow.
                {receipt.escrowReleaseAt ? (
                  <> It releases automatically on <b>{dateTimeLabel(receipt.escrowReleaseAt)}</b> unless you confirm delivery or open a dispute first.</>
                ) : (
                  <> It releases when you confirm delivery, or automatically 48 hours after delivery is marked complete.</>
                )}
              </span>
            </p>
          )}
          {disputed && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" />
              A dispute is open, so the automatic release is paused until our team decides.
            </p>
          )}
          {receipt.refund && (
            <p className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
              <Truck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              Refund of <b className="mx-1 tabular-nums">{naira(receipt.refund.amount)}</b> is{" "}
              <b className="mx-1">{receipt.refund.status.replaceAll("_", " ")}</b>
              {receipt.refund.at ? ` (started ${dateLabel(receipt.refund.at)})` : ""}. Banks usually post it within 3–5 working days.
            </p>
          )}
        </div>

        {/* Delivery + seller */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Delivered to</p>
            <p className="mt-1 text-sm">{receipt.shipping.address ?? "Address not recorded"}</p>
            {receipt.shipping.city && <p className="text-sm text-muted-foreground">{receipt.shipping.city}</p>}
            {receipt.shipping.phone && <p className="text-sm text-muted-foreground">{receipt.shipping.phone}</p>}
            {receipt.tracking.number && (
              <p className="mt-2 text-sm">
                <span className="text-muted-foreground">Tracking </span>
                <span className="font-mono font-semibold">{receipt.tracking.number}</span>
                {receipt.tracking.url && (
                  <a className="ml-2 font-semibold text-primary hover:underline" href={receipt.tracking.url} target="_blank" rel="noreferrer">
                    Follow
                  </a>
                )}
              </p>
            )}
          </div>
          <div className="rounded-xl border p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Seller</p>
            {receipt.vendor ? (
              <>
                <Link className="mt-1 block text-sm font-bold hover:text-primary hover:underline" href={`/vendor/${receipt.vendor.id}`}>
                  {receipt.vendor.shopName}
                </Link>
                <p className="text-sm text-muted-foreground">{receipt.vendor.city}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {receipt.vendor.inspected ? "Inspected shop" : receipt.vendor.verified ? "ID verified" : "Verification pending"}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Seller details unavailable</p>
            )}
            {receipt.paystackReference && (
              <p className="mt-2 text-xs text-muted-foreground">
                Payment ref <span className="font-mono">{receipt.paystackReference}</span>
              </p>
            )}
          </div>
        </div>

        {/* Ledger — the append-only money trail for this order */}
        {receipt.ledger.length > 0 && (
          <section className="mt-5">
            <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Money movements</h2>
            <ul className="mt-2 divide-y rounded-xl border">
              {receipt.ledger.map((entry, index) => (
                <li key={`${entry.kind}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    <span className="font-semibold">{LEDGER_LABEL[entry.kind] ?? entry.kind}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{dateTimeLabel(entry.at)}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{naira(entry.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Timeline */}
        {receipt.timeline.length > 0 && (
          <section className="mt-5">
            <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Status history</h2>
            <ol className="mt-2 space-y-2 border-l border-dashed pl-4 text-sm">
              {receipt.timeline.map((entry, index) => (
                <li key={`${entry.status}-${index}`}>
                  <p className="font-semibold">{TIMELINE_LABEL[entry.status] ?? entry.status}</p>
                  <p className="text-xs text-muted-foreground">{dateTimeLabel(entry.at)}</p>
                  {entry.note && <p className="text-xs text-muted-foreground">{entry.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        )}

        <footer className="mt-5 border-t pt-3 text-xs text-muted-foreground print:border-0">
          <p>
            Bale Drop holds every payment in escrow and releases it only when you confirm delivery, or automatically
            48 hours after delivery is marked complete. Need a human?{" "}
            <Link className="font-semibold text-primary hover:underline" href="/support">Contact support</Link>.
          </p>
          <p className="mt-1">Order {receipt.id}</p>
        </footer>
      </Card>

      <div className="mt-4 flex flex-wrap gap-2 print:hidden">
        {receipt.status !== "refunded" && receipt.status !== "cancelled" && (
          <Button variant="outline" size="sm" asChild>
            <Link href="/orders">Confirm delivery or open a dispute</Link>
          </Button>
        )}
        <Button variant="ghost" size="sm" asChild>
          <Link href="/policies/refunds">Refund policy</Link>
        </Button>
      </div>
    </div>
  );
}
