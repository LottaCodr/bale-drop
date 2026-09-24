"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Clock, Info, Loader2, Repeat, ShieldCheck, Truck, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ProductArt } from "@/components/commerce";
import { isSupabaseLive } from "@/lib/config";
import { naira } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase";
import { invokeOperation } from "@/lib/operations";
import { ORDER_STEPS, ORDERS, type Order } from "@/lib/mock";
import { useCartStore } from "@/lib/store/cart-store";
import { track } from "@/lib/analytics";
import { mapProductRow, hueFor, type Database } from "@bale-drop/database";
import { cn } from "@/lib/utils";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type VendorRow = Database["public"]["Tables"]["vendor_profiles"]["Row"];
type ItemRow = Database["public"]["Tables"]["order_items"]["Row"];

type TimelineRow = { id: string; order_id: string; status: string; note: string | null; created_at: string };

type OrderLine = {
  productId: string | null;
  title: string;
  qty: number;
  unit: number;
};

type ViewOrder = {
  id: string;
  title: string;
  vendor: string;
  vendorId: string;
  productId: string | null;
  amount: number;
  date: string;
  status: OrderRow["status"];
  escrow: OrderRow["escrow_status"];
  tracking?: string | null;
  trackingUrl?: string | null;
  step: number;
  hue: number;
  /** Everything the buyer bought — needed for a truthful reorder. */
  lines: OrderLine[];
  /** Real status history; the 5-step bar is the summary, this is the detail. */
  timeline: { status: string; note: string | null; at: string }[];
};

const STATUS_BADGE: Record<string, "amber" | "default" | "verified" | "live"> = {
  pending_payment: "amber",
  paid: "verified",
  processing: "amber",
  ready: "amber",
  in_transit: "default",
  delivered: "verified",
  disputed: "live",
  refunded: "live",
  cancelled: "live",
};

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid • escrow held",
  processing: "Processing",
  ready: "Ready to ship",
  in_transit: "In transit",
  delivered: "Delivered",
  disputed: "Dispute open",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

function orderStep(status: OrderRow["status"], escrow: OrderRow["escrow_status"]): number {
  if (status === "delivered" || escrow === "released") return 4;
  if (status === "in_transit") return 3;
  if (status === "processing" || status === "ready") return 2;
  if (status === "paid") return 1;
  return 0;
}

function toViewOrder(
  order: OrderRow,
  vendorName: string,
  items: ItemRow[],
  timeline: TimelineRow[]
): ViewOrder {
  const first = items[0];
  const lines: OrderLine[] = items.map((item) => ({
    productId: item.product_id,
    title: item.title_snapshot,
    qty: item.qty,
    unit: item.unit_naira,
  }));
  return {
    id: order.id,
    title: first?.title_snapshot ?? "Bale Drop order",
    vendor: vendorName,
    vendorId: order.vendor_id,
    productId: first?.product_id ?? null,
    amount: order.total_naira,
    date: new Date(order.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }),
    status: order.status,
    escrow: order.escrow_status,
    tracking: order.tracking_number,
    trackingUrl: order.tracking_url,
    step: orderStep(order.status, order.escrow_status),
    hue: hueFor(order.id),
    lines,
    timeline: timeline
      .filter((entry) => entry.order_id === order.id)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .map((entry) => ({ status: entry.status, note: entry.note, at: entry.created_at })),
  };
}

const TIMELINE_LABEL: Record<string, string> = {
  pending_payment: "Order created — awaiting payment",
  paid: "Payment received into escrow",
  processing: "Vendor started packing your order",
  ready: "Ready to ship",
  in_transit: "Handed to the courier — tracking live",
  delivered: "Delivered — confirm to release escrow",
  disputed: "Dispute opened — escrow paused",
  refunded: "Refunded to your payment method",
  cancelled: "Order cancelled",
};

export function OrdersClient() {
  const live = isSupabaseLive();
  const [orders, setOrders] = useState<ViewOrder[]>([]);
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmedDemo, setConfirmedDemo] = useState<string[]>([]);
  const [disputeOrder, setDisputeOrder] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("Item not as described");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [reviewedOrders, setReviewedOrders] = useState<string[]>([]);
  const [reviewOrder, setReviewOrder] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!live) {
      setOrders(ORDERS.map((order: Order) => ({
        id: order.id,
        title: order.title,
        vendor: order.vendor,
        vendorId: "",
        productId: null,
        amount: order.amount,
        date: order.date,
        status: order.status === "processing" ? "processing" : order.status === "in_transit" ? "in_transit" : "delivered",
        escrow: order.status === "delivered" ? "released" : "held",
        tracking: order.tracking,
        trackingUrl: null,
        step: order.step,
        hue: order.hue,
        lines: [{ productId: null, title: order.title, qty: 1, unit: order.amount }],
        timeline: [],
      })));
      setLoading(false);
      return;
    }

    let active = true;
    const sb = supabaseBrowser();
    let channel: ReturnType<typeof sb.channel> | undefined;

    async function load(userId: string) {
      setLoading(true);
      const { data: rows, error: orderError } = await sb
        .from("orders")
        .select("*")
        .eq("buyer_id", userId)
        .order("created_at", { ascending: false });
      if (orderError) {
        if (active) {
          setError(orderError.message);
          setLoading(false);
        }
        return;
      }

      const orderRows = rows as OrderRow[];
      const orderIds = orderRows.map((row) => row.id);
      const vendorIds = [...new Set(orderRows.map((row) => row.vendor_id))];
      const [{ data: vendors }, { data: items }, { data: reviews }, { data: timeline }] = await Promise.all([
        vendorIds.length ? sb.from("vendor_profiles").select("*").in("id", vendorIds) : Promise.resolve({ data: [] as VendorRow[] }),
        orderIds.length ? sb.from("order_items").select("*").in("order_id", orderIds) : Promise.resolve({ data: [] as ItemRow[] }),
        orderIds.length ? sb.from("reviews").select("order_id").in("order_id", orderIds) : Promise.resolve({ data: [] as { order_id: string }[] }),
        orderIds.length
          ? sb.from("order_timeline").select("id, order_id, status, note, created_at").in("order_id", orderIds)
          : Promise.resolve({ data: [] as TimelineRow[] }),
      ]);
      if (!active) return;
      const vendorMap = new Map((vendors ?? []).map((vendor) => [vendor.id, vendor.shop_name]));
      const itemsByOrder = new Map<string, ItemRow[]>();
      for (const item of items ?? []) {
        const bucket = itemsByOrder.get(item.order_id) ?? [];
        bucket.push(item);
        itemsByOrder.set(item.order_id, bucket);
      }
      setOrders(
        orderRows.map((row) =>
          toViewOrder(
            row,
            vendorMap.get(row.vendor_id) ?? "Verified vendor",
            itemsByOrder.get(row.id) ?? [],
            (timeline ?? []) as TimelineRow[]
          )
        )
      );
      setReviewedOrders((reviews ?? []).map((review) => review.order_id));
      setLoading(false);
    }

    async function start() {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) {
        if (active) {
          setError("Sign in to see your orders.");
          setLoading(false);
        }
        return;
      }
      await load(user.id);
      if (!active) return;
      channel = sb
        .channel(`orders-for-${user.id}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `buyer_id=eq.${user.id}` }, () => {
          // The initial query is the source of truth; a refresh after a
          // webhook update keeps escrow status current without client writes.
          void load(user.id);
        })
        .subscribe();
    }

    void start();

    return () => {
      active = false;
      if (channel) void sb.removeChannel(channel);
    };
  }, [live, refreshToken]);

  async function confirmDelivery(orderId: string) {
    setError(null); setNotice(null); setActionBusy(orderId);
    const { error: actionError } = await invokeOperation("order-action", { action: "confirm_delivery", order_id: orderId });
    setActionBusy(null);
    if (actionError) { setError(actionError); return; }
    setNotice("Delivery confirmed. Escrow has been released and the vendor payout is queued.");
    setRefreshToken((value) => value + 1);
  }

  /**
   * Reorder — the cheapest repeat purchase a marketplace can offer. Lines are
   * priced immediately from the catalog where possible; the cart re-checks them
   * again before payment, and `paystack-initialize` re-prices server-side, so a
   * stale snapshot can never become a wrong charge.
   */
  async function reorder(order: ViewOrder) {
    setError(null);
    setNotice(null);
    setActionBusy(`reorder-${order.id}`);
    const add = useCartStore.getState().add;
    let added = 0;
    try {
      const ids = order.lines.map((line) => line.productId).filter((id): id is string => Boolean(id));
      const catalog = new Map<string, { title: string; price: number; city: string; category: string; grade: "A" | "B" | "C"; hue: number; vendorId: string }>();
      if (ids.length > 0) {
        if (live) {
          const sb = supabaseBrowser();
          const { data } = await sb.from("products").select("*").in("id", ids).eq("status", "active");
          for (const row of data ?? []) {
            const product = mapProductRow(row);
            catalog.set(product.id, {
              title: product.title,
              price: product.price,
              city: product.city,
              category: product.category,
              grade: product.grade,
              hue: product.hue,
              vendorId: product.vendorId,
            });
          }
        }
      }
      for (const line of order.lines) {
        const fresh = line.productId ? catalog.get(line.productId) : undefined;
        if (!fresh) continue; // listing gone or paused — we say so below
        add(
          { productId: line.productId!, ...fresh, vendorName: order.vendor },
          line.qty
        );
        added += 1;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reorder");
    }
    setActionBusy(null);
    if (added === 0) {
      setError("Those listings are no longer available. Browse similar items instead.");
      return;
    }
    track("reorder", { order_id: order.id, items: added, value: order.amount });
    setNotice(`${added} item${added === 1 ? "" : "s"} added to your cart — prices will be confirmed at checkout.`);
  }

  async function submitReview(order: ViewOrder) {
    if (!live) { setReviewedOrders((current) => [...current, order.id]); setReviewOrder(null); setNotice("Thanks — your review was recorded in the demo."); return; }
    setError(null); setNotice(null); setActionBusy(`review-${order.id}`);
    const { error: actionError } = await invokeOperation("review-create", {
      order_id: order.id, rating: reviewRating, body: reviewBody, product_id: order.productId,
    });
    setActionBusy(null);
    if (actionError) { setError(actionError); return; }
    setReviewedOrders((current) => [...current, order.id]); setReviewOrder(null); setReviewBody(""); setReviewRating(5);
    setNotice("Review published. Thanks for helping other buyers shop with confidence.");
  }

  async function openDispute(orderId: string) {
    if (!disputeDescription.trim()) { setError("Add a short description so the review team can help."); return; }
    setError(null); setNotice(null); setActionBusy(orderId);
    const evidencePaths: string[] = [];
    if (evidenceFiles.length > 0) {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { setActionBusy(null); setError("Sign in again before uploading evidence."); return; }
      for (const file of evidenceFiles) {
        if (file.size > 5 * 1024 * 1024) { setActionBusy(null); setError("Each evidence file must be 5MB or smaller."); return; }
        const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
        const path = `${user.id}/${orderId}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await sb.storage.from("dispute-evidence").upload(path, file, { upsert: false, cacheControl: "3600" });
        if (uploadError) {
          if (evidencePaths.length) await sb.storage.from("dispute-evidence").remove(evidencePaths);
          setActionBusy(null);
          setError(uploadError.message);
          return;
        }
        evidencePaths.push(path);
      }
    }
    const { error: actionError } = await invokeOperation("order-action", {
      action: "open_dispute", order_id: orderId, reason: disputeReason, description: disputeDescription, evidence_urls: evidencePaths,
    });
    setActionBusy(null);
    if (actionError) {
      if (evidencePaths.length) await supabaseBrowser().storage.from("dispute-evidence").remove(evidencePaths);
      setError(actionError);
      return;
    }
    setDisputeOrder(null); setDisputeDescription(""); setEvidenceFiles([]);
    setNotice("Dispute opened. Your payment remains held while the team reviews it.");
    setRefreshToken((value) => value + 1);
  }

  const activeOrders = useMemo(
    () => orders.filter((order) => !["delivered", "refunded", "cancelled"].includes(order.status)),
    [orders]
  );

  return (
    <div className="container max-w-3xl py-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">My orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Payment confirmation is webhook-driven. Escrow stays held until you confirm delivery.
          </p>
        </div>
        {orders.length > 0 && (
          <p className="text-[13px] text-muted-foreground">
            <b className="text-foreground">{activeOrders.length}</b> active • {orders.length - activeOrders.length} finished
          </p>
        )}
      </div>

      {loading && <div className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading orders…</div>}
      {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</p>}
      {!loading && !error && orders.length === 0 && (
        <Card className="mt-6 p-8 text-center"><h2 className="font-bold">No orders yet</h2><p className="mt-1 text-sm text-muted-foreground">Choose a listing and your paid orders will appear here.</p><Button className="mt-4" asChild><Link href="/search">Browse listings</Link></Button></Card>
      )}

      <div className="mt-6 flex flex-col gap-4">
        {orders.map((order) => {
          const isDemoConfirmed = confirmedDemo.includes(order.id) || order.status === "delivered";
          const step = isDemoConfirmed && !live ? 4 : order.step;
          const status = isDemoConfirmed && !live ? "delivered" : order.status;
          return (
            <Card key={order.id} className="overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-4 py-3">
                <p className="text-sm font-bold">{live ? `BD-${order.id.slice(0, 6).toUpperCase()}` : order.id} <span className="font-normal text-muted-foreground">• {order.date}</span></p>
                <Badge variant={STATUS_BADGE[status]}>{STATUS_LABEL[status]}</Badge>
              </div>
              <div className="flex flex-col gap-4 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-14 shrink-0 overflow-hidden rounded-xl border"><ProductArt hue={order.hue} category="Bales" className="aspect-square w-full" iconClassName="h-5 w-5" /></div>
                  <div className="min-w-0"><p className="truncate text-sm font-semibold">{order.title}</p><p className="text-xs text-muted-foreground">{order.vendor}</p><p className="text-sm font-extrabold tabular-nums">{naira(order.amount)}</p></div>
                </div>

                <ol className="flex items-start" aria-label="Order progress">
                  {ORDER_STEPS.map((label, index) => {
                    const done = index < step;
                    const current = index === step;
                    return (
                      <li key={label} className={cn("flex flex-1 flex-col items-center gap-1.5", index > 0 && "-ml-1")}>
                        <span className="flex w-full items-center"><span className={cn("h-0.5 flex-1", index === 0 ? "bg-transparent" : done || current ? "bg-primary" : "bg-muted")} /><span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", done ? "bg-primary text-primary-foreground" : current ? "bg-primary/15 text-primary ring-2 ring-primary" : "bg-muted text-muted-foreground")}>{done ? <Check className="h-3.5 w-3.5" /> : index + 1}</span><span className={cn("h-0.5 flex-1", done ? "bg-primary" : "bg-muted")} /></span>
                        <span className={cn("text-center text-[11px] font-medium leading-tight", current ? "text-foreground" : "text-muted-foreground")}>{label}</span>
                      </li>
                    );
                  })}
                </ol>

                {order.timeline.length > 0 && (
                  <details className="rounded-xl border bg-muted/30 px-3 py-2">
                    <summary className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold">
                      <Clock className="h-3.5 w-3.5 text-primary" /> Status history ({order.timeline.length})
                    </summary>
                    <ol className="mt-2 space-y-2 border-l border-dashed pl-4 text-[13px]">
                      {order.timeline.map((entry) => (
                        <li key={`${entry.status}-${entry.at}`}>
                          <p className="font-semibold">{TIMELINE_LABEL[entry.status] ?? entry.status}</p>
                          <p className="text-muted-foreground">
                            {new Date(entry.at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </p>
                          {entry.note && <p className="text-muted-foreground">{entry.note}</p>}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => reorder(order)}
                    disabled={actionBusy === `reorder-${order.id}` || order.lines.length === 0}
                  >
                    {actionBusy === `reorder-${order.id}` ? <Loader2 className="animate-spin" /> : <Repeat />} Buy again
                  </Button>
                  {order.productId && (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/listing/${order.productId}`}>View listing</Link>
                    </Button>
                  )}
                </div>

                {order.tracking && !isDemoConfirmed && <div className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-sm"><Truck className="h-4 w-4 shrink-0 text-primary" /><span className="font-mono font-semibold">{order.tracking}</span>{order.trackingUrl ? <Button variant="link" size="sm" className="ml-auto h-auto p-0" asChild><a href={order.trackingUrl} target="_blank" rel="noreferrer">Track package</a></Button> : <span className="ml-auto text-xs text-muted-foreground">Tracking updates soon</span>}</div>}

                {!live && !isDemoConfirmed && (
                  <div className="flex flex-col gap-2 sm:flex-row"><Button className="flex-1" onClick={() => setConfirmedDemo((current) => [...current, order.id])}><Check /> Confirm delivery</Button><Button variant="outline" className="flex-1" onClick={() => setNotice("Demo preview: connect Supabase to open a persisted dispute.")}><Info /> Open dispute</Button></div>
                )}
                {live && order.escrow === "held" && !["delivered", "refunded", "cancelled"].includes(order.status) && (
                  <div className="flex flex-col gap-2">
                    <p className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"><ShieldCheck className="h-4 w-4" /> Payment is held in escrow. Delivery confirmation is protected.</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      {['processing', 'ready', 'in_transit'].includes(order.status) && <Button className="flex-1" onClick={() => confirmDelivery(order.id)} disabled={actionBusy === order.id}>{actionBusy === order.id ? <Loader2 className="animate-spin" /> : <Check />} Confirm delivery</Button>}
                      <Button variant="outline" className="flex-1" onClick={() => setDisputeOrder(disputeOrder === order.id ? null : order.id)}><Info /> Open dispute</Button>
                    </div>
                    {order.status === "paid" && <p className="text-xs text-muted-foreground">Your vendor must begin fulfillment before delivery can be confirmed.</p>}
                    <p className="text-xs text-muted-foreground">Ignore this and escrow auto-releases 48 hours after delivery — you can still open a dispute before then.</p>
                    {disputeOrder === order.id && <div className="rounded-xl border bg-muted/40 p-3"><label className="mb-1.5 block text-sm font-semibold" htmlFor={`reason-${order.id}`}>Reason</label><select id={`reason-${order.id}`} value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"><option>Item not as described</option><option>Order never arrived</option><option>Damaged or incomplete</option><option>Wrong item received</option></select><Textarea className="mt-2" placeholder="Tell us what happened" value={disputeDescription} onChange={(event) => setDisputeDescription(event.target.value)} /><label className="mt-2 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed p-3 text-sm"><Upload className="h-4 w-4 text-primary" /><span>{evidenceFiles.length ? `${evidenceFiles.length} evidence file${evidenceFiles.length > 1 ? "s" : ""} selected` : "Attach photos or PDF evidence (optional)"}</span><input type="file" accept="image/*,.pdf" multiple className="sr-only" onChange={(event) => setEvidenceFiles(Array.from(event.target.files ?? []).slice(0, 5))} /></label><div className="mt-2 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setDisputeOrder(null)}>Cancel</Button><Button size="sm" onClick={() => openDispute(order.id)} disabled={actionBusy === order.id}>{actionBusy === order.id ? "Opening…" : "Submit dispute"}</Button></div></div>}
                  </div>
                )}
                {isDemoConfirmed && <p className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"><Check className="h-4 w-4" /> Delivered &amp; escrow released. Thanks for shopping!</p>}
                {isDemoConfirmed && !reviewedOrders.includes(order.id) && <div className="rounded-xl border bg-muted/40 p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-bold">How was this order?</p>{reviewOrder !== order.id && <Button variant="outline" size="sm" onClick={() => setReviewOrder(order.id)}>Leave a review</Button>}</div>{reviewOrder === order.id && <div className="mt-3"><div className="flex items-center gap-1" aria-label="Rating"><span className="mr-2 text-sm font-semibold">Rating</span>{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" aria-label={`${value} star${value > 1 ? "s" : ""}`} onClick={() => setReviewRating(value)} className={cn("text-xl leading-none", value <= reviewRating ? "text-amber-500" : "text-muted-foreground")}>★</button>)}</div><Textarea className="mt-2" placeholder="Share a helpful note (optional)" value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} /><div className="mt-2 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setReviewOrder(null)}>Cancel</Button><Button size="sm" onClick={() => submitReview(order)} disabled={actionBusy === `review-${order.id}`}>{actionBusy === `review-${order.id}` ? <Loader2 className="animate-spin" /> : <Check />} Publish review</Button></div></div>}</div>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
