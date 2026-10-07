"use client";

import { useEffect, useState } from "react";
import { Check, Eye, FileText, Loader2, Send, Wallet, X } from "lucide-react";
import { AdminMoneyPanel } from "@/components/admin-money";
import { AdminAuditPanel } from "@/components/admin-audit";
import { AdminPromosPanel } from "@/components/admin-promos";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { friendlyErrorMessage } from "@/lib/errors";
import { naira } from "@/lib/format";
import { invokeOperation } from "@/lib/operations";
import {
  listRepliesFor,
  listSupportQueue,
  replyAsTeam,
  resolveSupportMessage,
  TOPIC_LABELS,
  type SupportQueueItem,
  type SupportReply,
} from "@/lib/support";
import { Textarea } from "@/components/ui/textarea";
import { supabaseBrowser } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/** Admin console UI — rendered by the role-gated server page. Queues go live with auth. */

type Tab = "vendors" | "products" | "disputes" | "payouts" | "promos" | "money" | "audit" | "support";

const TABS: { id: Tab; label: string }[] = [
  { id: "vendors", label: "Vendor approvals" },
  { id: "products", label: "Product moderation" },
  { id: "disputes", label: "Disputes" },
  { id: "payouts", label: "Payouts" },
  { id: "promos", label: "Promo codes" },
  { id: "money", label: "Money" },
  { id: "audit", label: "Audit trail" },
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
  const [supportQueue, setSupportQueue] = useState<SupportQueueItem[]>([]);
  const [supportReplies, setSupportReplies] = useState<Record<string, SupportReply[]>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [vendorDocs, setVendorDocs] = useState<Record<string, { type: string; status: string; url: string | null }[]>>({});
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
      // The held amount is the number a refund decision turns on, so it is read
      // from the order rather than left as a placeholder zero.
      void loadDisputeAmounts((disputes.data ?? []).map((d) => ({ id: d.id, order_id: d.order_id })));
      setPayoutQueue((payouts.data ?? []).map((p) => ({ id: p.id, vendor: p.vendor_id.slice(0, 8), gross: p.gross_naira, commission: p.commission_naira, eta: p.status === "failed" ? "Retry" : p.status === "processing" ? "Verify" : "Queued", status: p.status })));
      setHeldEscrow((escrow.data ?? []).reduce((sum, row) => sum + Number(row.total_naira), 0));
      setLoading(false);
    });
    // Support is a separate read: it must not fail the money queues if the
    // migration has not been applied yet.
    listSupportQueue()
      .then(async (queue) => {
        setSupportQueue(queue);
        try {
          const replies = await listRepliesFor(queue.map((item) => item.id));
          const grouped: Record<string, SupportReply[]> = {};
          for (const reply of replies) {
            const bucket = grouped[reply.message_id] ?? [];
            bucket.push(reply);
            grouped[reply.message_id] = bucket;
          }
          setSupportReplies(grouped);
        } catch {
          setSupportReplies({});
        }
      })
      .catch(() => setSupportQueue([]));
  }, [refreshToken]);

  /**
   * Vendor KYC documents. The bucket is private and its Storage policies are
   * owner-only, so this goes through `vendor-documents`, which checks the admin
   * role and returns URLs that expire in five minutes. Approving a seller
   * without ever seeing their ID was the whole point of the gap.
   */
  async function viewVendorDocs(vendorId: string) {
    setError(null); setActionBusy(`docs-${vendorId}`);
    const { data, error: actionError } = await invokeOperation<{
      documents?: { type: string; status: string; url: string | null }[];
    }>("vendor-documents", { vendor_id: vendorId }, { context: "admin" });
    setActionBusy(null);
    if (actionError) { setError(actionError); return; }
    setVendorDocs((current) => ({ ...current, [vendorId]: data?.documents ?? [] }));
  }

  /** Reply in the thread (and optionally resolve it in the same action). */
  async function sendTeamReply(messageId: string, resolve: boolean) {
    const body = (replyDrafts[messageId] ?? "").trim();
    if (body.length < 2) { setError("Write the reply before sending it."); return; }
    setError(null); setActionBusy(`reply-${messageId}`);
    try {
      await replyAsTeam(messageId, body, resolve);
      setReplyDrafts((current) => ({ ...current, [messageId]: "" }));
      setRefreshToken((value) => value + 1);
    } catch (replyError) {
      setError(friendlyErrorMessage(replyError, { context: "admin", fallback: "We couldn’t send that reply. Please try again." }));
    } finally {
      setActionBusy(null);
    }
  }

  /**
   * Fill in the money a dispute is holding. `disputes` has no amount column —
   * the held value is the order's total — so this is a second read keyed on the
   * order ids the queue already returned.
   */
  async function loadDisputeAmounts(rows: { id: string; order_id: string }[]) {
    if (rows.length === 0) return;
    const orderIds = [...new Set(rows.map((row) => row.order_id))];
    const { data } = await supabaseBrowser()
      .from("orders")
      .select("id, total_naira, escrow_status")
      .in("id", orderIds);
    if (!data) return;
    const byOrder = new Map(data.map((order) => [order.id, order]));
    setDisputeQueue((current) =>
      current.map((dispute) => {
        const match = rows.find((row) => row.id === dispute.id);
        const order = match ? byOrder.get(match.order_id) : undefined;
        return order ? { ...dispute, amount: Number(order.total_naira) } : dispute;
      })
    );
  }

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
              : item.id === "money" || item.id === "audit" || item.id === "promos"
                ? // These panels load their own data; a badge count would be a
                  // second read of the same tables for one number.
                  null
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
            {t.count != null && (
              <span className={cn("rounded-full px-1.5 text-xs font-bold", tab === t.id ? "bg-white/20" : "bg-muted")}>
                {t.count}
              </span>
            )}
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
                    <Button variant="outline" size="sm" onClick={() => viewVendorDocs(v.id)} disabled={actionBusy === `docs-${v.id}`}>
                      {actionBusy === `docs-${v.id}` ? <Loader2 className="animate-spin" /> : <FileText className="h-4 w-4" />} Docs
                    </Button>
                    <Button size="sm" onClick={() => decide(v.id, "Approved")} disabled={actionBusy === v.id}>{actionBusy === v.id ? <Loader2 className="animate-spin" /> : <Check />} Approve</Button>
                    <Button variant="destructive" size="sm" onClick={() => decide(v.id, "Rejected")} disabled={actionBusy === v.id}><X /> Reject</Button>
                    {vendorDocs[v.id] && (
                      <div className="basis-full rounded-xl border bg-muted/40 p-3">
                        {vendorDocs[v.id].length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No documents uploaded for this application. You can still approve, but say why in the
                            rejection note if you don&apos;t.
                          </p>
                        ) : (
                          <ul className="flex flex-col gap-1.5">
                            {vendorDocs[v.id].map((doc, index) => (
                              <li key={`${doc.type}-${index}`} className="flex items-center gap-2 text-xs">
                                <Badge variant={doc.status === "approved" ? "verified" : doc.status === "rejected" ? "live" : "amber"}>{doc.status}</Badge>
                                <span className="font-semibold capitalize">{doc.type.replaceAll("_", " ")}</span>
                                {doc.url
                                  ? <a className="font-semibold text-primary hover:underline" href={doc.url} target="_blank" rel="noreferrer">Open (link expires in 5 min)</a>
                                  : <span className="text-muted-foreground">preview unavailable</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
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
        {tab === "promos" && <AdminPromosPanel />}
        {tab === "money" && <AdminMoneyPanel />}
        {tab === "audit" && <AdminAuditPanel />}

        {tab === "support" && (
          <ul className="divide-y">
            {loading ? (
              <li className="p-6 text-sm text-muted-foreground">Loading live queue…</li>
            ) : supportQueue.length === 0 ? (
              <li className="p-6 text-sm text-muted-foreground">
                No support messages yet. Buyers reach this queue from the footer and from order pages.
              </li>
            ) : (
              supportQueue.map((message) => {
                const replies = supportReplies[message.id] ?? [];
                const expanded = openThread === message.id;
                const firstResponse = message.first_response_seconds == null
                  ? null
                  : Math.round(message.first_response_seconds / 60);
                return (
                  <li key={message.id} className="flex flex-col gap-3 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
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
                        {/* The two numbers that decide whether support is working. */}
                        <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                          <span>Waiting {Math.max(0, Math.round(message.age_seconds / 3600))} h</span>
                          <span>{replies.length} repl{replies.length === 1 ? "y" : "ies"} ({message.team_reply_count} from us)</span>
                          {firstResponse != null && <span>First answer after {firstResponse} min</span>}
                          {message.status === "open" && firstResponse == null && message.age_seconds > 12 * 3600 && (
                            <span className="font-bold text-red-600 dark:text-red-400">Unanswered over 12 h</span>
                          )}
                        </p>
                        <p className="mt-2 whitespace-pre-line text-sm">{message.body}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setOpenThread(expanded ? null : message.id)}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            {expanded ? "Hide thread" : `Open thread (${replies.length})`}
                          </button>
                          <a
                            href={`mailto:${message.email}?subject=${encodeURIComponent(`Re: your Bale Drop message${message.order_ref ? ` (${message.order_ref})` : ""}`)}`}
                            className="text-xs font-semibold text-muted-foreground hover:underline"
                          >
                            Reply by email instead
                          </a>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {message.status === "resolved" ? (
                          <Badge variant="verified">Resolved</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => resolveMessage(message.id)}
                            disabled={actionBusy === `support-${message.id}`}
                          >
                            {actionBusy === `support-${message.id}` ? <Loader2 className="animate-spin" /> : <Check />} Mark resolved
                          </Button>
                        )}
                      </div>
                    </div>

                    {expanded && (
                      <div className="rounded-xl border bg-muted/30 p-3">
                        {replies.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No replies yet — this buyer is still waiting.</p>
                        ) : (
                          <ol className="flex flex-col gap-2">
                            {replies.map((reply) => (
                              <li key={reply.id} className={reply.from_team ? "rounded-lg bg-primary/5 px-3 py-2" : "rounded-lg bg-background px-3 py-2"}>
                                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                                  {reply.from_team ? "Team" : message.name} •{" "}
                                  {new Date(reply.created_at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                                </p>
                                <p className="mt-1 whitespace-pre-line text-sm">{reply.body}</p>
                              </li>
                            ))}
                          </ol>
                        )}
                        <Textarea
                          className="mt-3"
                          aria-label={`Reply to ${message.name}`}
                          placeholder="Write the reply that gets stored here and emailed to the buyer"
                          value={replyDrafts[message.id] ?? ""}
                          onChange={(event) => setReplyDrafts((current) => ({ ...current, [message.id]: event.target.value }))}
                        />
                        <div className="mt-2 flex flex-wrap justify-end gap-2">
                          <Button size="sm" variant="outline" disabled={actionBusy === `reply-${message.id}`} onClick={() => sendTeamReply(message.id, false)}>
                            {actionBusy === `reply-${message.id}` ? <Loader2 className="animate-spin" /> : <Send className="h-4 w-4" />} Send reply
                          </Button>
                          <Button size="sm" disabled={actionBusy === `reply-${message.id}`} onClick={() => sendTeamReply(message.id, true)}>
                            <Check className="h-4 w-4" /> Reply &amp; resolve
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}
