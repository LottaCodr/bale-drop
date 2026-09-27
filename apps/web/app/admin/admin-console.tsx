"use client";

import { useEffect, useState } from "react";
import { Check, Eye, Loader2, Wallet, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { friendlyErrorMessage } from "@/lib/errors";
import { naira } from "@/lib/format";
import { invokeOperation } from "@/lib/operations";
import { listSupportMessages, resolveSupportMessage, TOPIC_LABELS, type SupportMessage } from "@/lib/support";
import { supabaseBrowser } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/** Admin console UI — rendered by the role-gated server page. Queues go live with auth. */

type Tab = "vendors" | "products" | "disputes" | "payouts" | "support";

const TABS: { id: Tab; label: string }[] = [
  { id: "vendors", label: "Vendor approvals" },
  { id: "products", label: "Product moderation" },
  { id: "disputes", label: "Disputes" },
  { id: "payouts", label: "Payouts" },
  { id: "support", label: "Support" },
];

type VendorQueueItem = { id: string; shop: string; city: string; docs: string; when: string };
type ProductQueueItem = { id: string; title: string; vendor: string; grade: string; price: number };
type DisputeQueueItem = { id: string; order: string; issue: string; evidence: number; amount: number };
type PayoutQueueItem = { id: string; vendor: string; gross: number; commission: number; eta: string; status: string };

export function AdminConsole() {
  const [tab, setTab] = useState<Tab>("vendors");
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [vendorQueue, setVendorQueue] = useState<VendorQueueItem[]>([]);
  const [productQueue, setProductQueue] = useState<ProductQueueItem[]>([]);
  const [disputeQueue, setDisputeQueue] = useState<DisputeQueueItem[]>([]);
  const [payoutQueue, setPayoutQueue] = useState<PayoutQueueItem[]>([]);
  const [supportQueue, setSupportQueue] = useState<SupportMessage[]>([]);
  const [heldEscrow, setHeldEscrow] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [evidenceLinks, setEvidenceLinks] = useState<Record<string, string[]>>({});
  const [refreshToken, setRefreshToken] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    Promise.all([
      sb.from("vendor_profiles").select("id, shop_name, city, verification_status, created_at").eq("verification_status", "pending").order("created_at", { ascending: false }),
      sb.from("products").select("id, title, vendor_id, grade, price_naira, status").eq("status", "pending").order("created_at", { ascending: false }),
      sb.from("disputes").select("id, order_id, reason, status, evidence_urls, created_at").in("status", ["open", "under_review"]).order("created_at", { ascending: false }),
      sb.from("vendor_payouts").select("id, vendor_id, gross_naira, commission_naira, net_naira, status, created_at").in("status", ["pending", "processing", "failed"]).order("created_at", { ascending: false }),
      sb.from("orders").select("total_naira").eq("escrow_status", "held"),
    ]).then(([vendors, products, disputes, payouts, escrow]) => {
      const firstError = vendors.error ?? products.error ?? disputes.error ?? payouts.error ?? escrow.error;
      if (firstError) setError(friendlyErrorMessage(firstError, { context: "admin", fallback: "We couldn’t load the admin queues. Please refresh and try again." }));
      setVendorQueue((vendors.data ?? []).map((v) => ({ id: v.id, shop: v.shop_name, city: v.city ?? "Not provided", docs: "Pending review", when: new Date(v.created_at).toLocaleDateString("en-NG") })));
      setProductQueue((products.data ?? []).map((p) => ({ id: p.id, title: p.title, vendor: p.vendor_id.slice(0, 8), grade: p.grade, price: p.price_naira })));
      setDisputeQueue((disputes.data ?? []).map((d) => ({ id: d.id, order: d.order_id.slice(0, 8), issue: d.reason, evidence: d.evidence_urls?.length ?? 0, amount: 0 })));
      setPayoutQueue((payouts.data ?? []).map((p) => ({ id: p.id, vendor: p.vendor_id.slice(0, 8), gross: p.gross_naira, commission: p.commission_naira, eta: p.status === "failed" ? "Retry" : p.status === "processing" ? "Verify" : "Queued", status: p.status })));
      setHeldEscrow((escrow.data ?? []).reduce((sum, row) => sum + Number(row.total_naira), 0));
      setLoading(false);
    });
    // Support is a separate read: it must not fail the money queues if the
    // migration has not been applied yet.
    listSupportMessages()
      .then(setSupportQueue)
      .catch(() => setSupportQueue([]));
  }, [refreshToken]);

  async function viewEvidence(id: string) {
    setError(null); setActionBusy(`evidence-${id}`);
    const { data, error: actionError } = await invokeOperation<{ links?: string[] }>("dispute-evidence", { dispute_id: id }, { context: "admin" });
    setActionBusy(null);
    if (actionError) { setError(actionError); return; }
    setEvidenceLinks((current) => ({ ...current, [id]: data?.links ?? [] }));
  }

  async function decide(id: string, verdict: string) {
    setError(null);
    setActionBusy(id);
    let functionName = "admin-action";
    let body: Record<string, unknown> = { entity_id: id };
    if (tab === "vendors") body.action = verdict === "Approved" ? "approve_vendor" : "reject_vendor";
    if (tab === "products") body.action = verdict === "Live" ? "approve_product" : "reject_product";
    if (tab === "disputes") { body.action = "resolve_dispute"; body.resolution = verdict === "Refunded buyer" ? "buyer_refund" : "vendor_release"; }
    if (tab === "payouts") { functionName = "vendor-payout"; body = { payout_id: id, force_reconcile: true }; }
    const { error: actionError } = await invokeOperation(functionName, body, { context: "admin" });
    setActionBusy(null);
    if (actionError) { setError(actionError); return; }
    setDecided((d) => ({ ...d, [id]: tab === "payouts" ? "Transfer queued" : verdict }));
    setRefreshToken((value) => value + 1);
  }

  async function resolveMessage(id: string) {
    setError(null);
    setActionBusy(`support-${id}`);
    try {
      await resolveSupportMessage(id);
      setSupportQueue((current) =>
        current.map((message) =>
          message.id === id ? { ...message, status: "resolved", resolved_at: new Date().toISOString() } : message
        )
      );
    } catch (resolveError) {
      setError(friendlyErrorMessage(resolveError, { context: "admin", fallback: "We couldn’t resolve this support message. Please try again." }));
    } finally {
      setActionBusy(null);
    }
  }

  const tabs = TABS.map((item) => ({
    ...item,
    count:
      item.id === "vendors"
        ? vendorQueue.length
        : item.id === "products"
          ? productQueue.length
          : item.id === "disputes"
            ? disputeQueue.length
            : item.id === "payouts"
              ? payoutQueue.length
              : supportQueue.filter((message) => message.status === "open").length,
  }));

  return (
    <div className="container max-w-5xl py-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Admin console</h1>
          <p className="mt-1 text-sm text-muted-foreground">Trust operations: approvals, moderation, disputes, money.</p>
        </div>
        <Badge variant="outline">Live</Badge>
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      {/* Stats */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Pending vendors", String(vendorQueue.length)],
          ["Listings to review", String(productQueue.length)],
          ["Open disputes", String(disputeQueue.length)],
          ["Held in escrow", naira(heldEscrow ?? 0)],
        ].map(([k, v]) => (
          <Card key={k} className="p-4">
            <p className="text-[13px] text-muted-foreground">{k}</p>
            <p className="text-base font-extrabold tabular-nums break-words sm:text-xl">{v}</p>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="no-scrollbar mt-5 flex gap-2 overflow-x-auto" role="tablist" aria-label="Admin queues">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition",
              tab === t.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/50"
            )}
          >
            {t.label}
            <span className={cn("rounded-full px-1.5 text-xs font-bold", tab === t.id ? "bg-white/20" : "bg-muted")}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      <Card className="mt-4 overflow-hidden">
        {tab === "vendors" && (
          <ul className="divide-y">
            {loading ? <li className="p-6 text-sm text-muted-foreground">Loading live queue…</li> : vendorQueue.map((v) => (
              <li key={v.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <Avatar initials={v.shop.split(" ").map((w) => w[0]).slice(0, 2).join("")} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{v.shop} <span className="font-mono text-xs font-normal text-muted-foreground">{v.id}</span></p>
                  <p className="text-[13px] text-muted-foreground">{v.city} • Docs: {v.docs} • {v.when}</p>
                </div>
                {decided[v.id] ? (
                  <Badge variant={decided[v.id] === "Approved" ? "verified" : "live"}>{decided[v.id]}</Badge>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm"><Eye /> Docs</Button>
                    <Button size="sm" onClick={() => decide(v.id, "Approved")} disabled={actionBusy === v.id}>{actionBusy === v.id ? <Loader2 className="animate-spin" /> : <Check />} Approve</Button>
                    <Button variant="destructive" size="sm" onClick={() => decide(v.id, "Rejected")} disabled={actionBusy === v.id}><X /> Reject</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {tab === "products" && (
          <ul className="divide-y">
            {loading ? <li className="p-6 text-sm text-muted-foreground">Loading live queue…</li> : productQueue.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{p.title}</p>
                  <p className="text-[13px] text-muted-foreground">{p.vendor} • Grade {p.grade} • {naira(p.price)}</p>
                </div>
                {decided[p.id] ? (
                  <Badge variant={decided[p.id] === "Live" ? "verified" : "live"}>{decided[p.id]}</Badge>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => decide(p.id, "Live")} disabled={actionBusy === p.id}>{actionBusy === p.id ? <Loader2 className="animate-spin" /> : <Check />} Approve</Button>
                    <Button variant="destructive" size="sm" onClick={() => decide(p.id, "Rejected")} disabled={actionBusy === p.id}><X /> Reject</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {tab === "disputes" && (
          <ul className="divide-y">
            {loading ? <li className="p-6 text-sm text-muted-foreground">Loading live queue…</li> : disputeQueue.map((d) => (
              <li key={d.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{d.id}: {d.issue}</p>
                  <p className="text-[13px] text-muted-foreground">Order {d.order} • {d.evidence} evidence photos • {naira(d.amount)} held</p>
                </div>
                {decided[d.id] ? (
                  <Badge variant="verified">{decided[d.id]}</Badge>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => viewEvidence(d.id)} disabled={actionBusy === `evidence-${d.id}`}>{actionBusy === `evidence-${d.id}` ? <Loader2 className="animate-spin" /> : <Eye />} Evidence</Button>
                    <Button size="sm" onClick={() => decide(d.id, "Refunded buyer")} disabled={actionBusy === d.id}>{actionBusy === d.id ? <Loader2 className="animate-spin" /> : <Check />} Refund buyer</Button>
                    <Button variant="secondary" size="sm" onClick={() => decide(d.id, "Released to vendor")} disabled={actionBusy === d.id}>Release</Button>
                    {evidenceLinks[d.id]?.map((link, index) => <a key={link} href={link} target="_blank" rel="noreferrer" className="basis-full text-xs font-semibold text-primary hover:underline">Open evidence {index + 1}</a>)}
                    {evidenceLinks[d.id]?.length === 0 && evidenceLinks[d.id] && <span className="basis-full text-xs text-muted-foreground">No readable evidence files.</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {tab === "payouts" && (
          <ul className="divide-y">
            {loading ? <li className="p-6 text-sm text-muted-foreground">Loading live queue…</li> : payoutQueue.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Wallet className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{p.vendor}</p>
                  <p className="text-[13px] text-muted-foreground">
                    Gross {naira(p.gross)} • Commission {naira(p.commission)} • Net <b className="text-foreground">{naira(p.gross - p.commission)}</b> • {p.eta}
                  </p>
                </div>
                {decided[p.id] ? (
                  <Badge variant="verified">{decided[p.id]}</Badge>
                ) : (
                  <Button size="sm" onClick={() => decide(p.id, "Transfer sent")} disabled={actionBusy === p.id}>
                    {actionBusy === p.id && <Loader2 className="animate-spin" />}
                    {p.status === "processing" ? "Reconcile transfer" : "Release via Paystack"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {tab === "support" && (
          <ul className="divide-y">
            {loading ? (
              <li className="p-6 text-sm text-muted-foreground">Loading live queue…</li>
            ) : supportQueue.length === 0 ? (
              <li className="p-6 text-sm text-muted-foreground">
                No support messages yet. Buyers reach this queue from the footer and from order pages.
              </li>
            ) : (
              supportQueue.map((message) => (
                <li key={message.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">
                      {message.name}{" "}
                      <span className="font-mono text-xs font-normal text-muted-foreground">{message.id.slice(0, 8)}</span>
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      {TOPIC_LABELS[message.topic]} • {message.email}
                      {message.order_ref ? ` • ${message.order_ref}` : ""} •{" "}
                      {new Date(message.created_at).toLocaleString("en-NG")}
                    </p>
                    <p className="mt-2 whitespace-pre-line text-sm">{message.body}</p>
                    <a
                      href={`mailto:${message.email}?subject=${encodeURIComponent(`Re: your Bale Drop message${message.order_ref ? ` (${message.order_ref})` : ""}`)}`}
                      className="mt-2 inline-block text-xs font-semibold text-primary hover:underline"
                    >
                      Reply by email
                    </a>
                  </div>
                  {message.status === "resolved" ? (
                    <Badge variant="verified">Resolved</Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => resolveMessage(message.id)}
                      disabled={actionBusy === `support-${message.id}`}
                    >
                      {actionBusy === `support-${message.id}` ? <Loader2 className="animate-spin" /> : <Check />} Mark resolved
                    </Button>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}
