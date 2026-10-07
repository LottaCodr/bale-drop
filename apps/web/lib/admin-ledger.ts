/**
 * Admin money views — ledger, refunds, payment sessions, audit trail, funnel.
 *
 * Every table here already has an admin-read RLS policy (migrations 0005, 0008,
 * 0018), so the console reads them with the admin's own session and Postgres
 * decides what is visible. Nothing in this module can write: the ledger is
 * append-only and every mutation goes through an RPC or an Edge Function.
 *
 * Before this existed the only money number an admin could see was "held in
 * escrow" — a refund stuck in `failed`, a session that never left `pending`, or
 * a commission row that never landed were all invisible, which is exactly how a
 * marketplace loses money without noticing.
 */
import { isSupabaseLive } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase";

export type LedgerKind = "pay_in" | "commission" | "payout" | "refund" | string;

export interface LedgerRow {
  id: string;
  kind: LedgerKind;
  amountNaira: number;
  orderId: string | null;
  bookingId: string | null;
  vendorId: string | null;
  reference: string | null;
  createdAt: string;
}

export interface RefundRow {
  id: string;
  /** Which table it came from — the two refund ledgers have different keys. */
  source: "order" | "bale";
  entityId: string;
  amountNaira: number;
  status: string;
  attempts: number;
  lastError: string | null;
  reference: string;
  requestedAt: string;
  processedAt: string | null;
}

export interface SessionRow {
  id: string;
  reference: string;
  kind: "order_batch" | "slot";
  amountNaira: number;
  status: string;
  channel: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  adminId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  note: string | null;
  createdAt: string;
}

/** One funnel step: how many events fired in the window. */
export interface FunnelStep {
  event: string;
  label: string;
  count: number;
}

/** The buyer funnel, in order. Conversion is computed against the first step. */
export const FUNNEL_EVENTS: { event: string; label: string }[] = [
  { event: "view_item", label: "Viewed a listing" },
  { event: "add_to_cart", label: "Added to cart" },
  { event: "begin_checkout", label: "Started checkout" },
  { event: "place_order", label: "Handed off to Paystack" },
  { event: "purchase", label: "Paid" },
];

/** Refunds that still need a human. `succeeded` rows are history, not work. */
const REFUND_ATTENTION = ["pending", "processing", "failed", "needs_attention"];

export async function loadLedger(limit = 40): Promise<LedgerRow[]> {
  if (!isSupabaseLive()) return [];
  const { data, error } = await supabaseBrowser()
    .from("transactions")
    .select("id, kind, amount_naira, order_id, bale_booking_id, vendor_id, paystack_reference, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    amountNaira: Number(row.amount_naira),
    orderId: row.order_id,
    bookingId: row.bale_booking_id,
    vendorId: row.vendor_id,
    reference: row.paystack_reference,
    createdAt: row.created_at,
  }));
}

/** Running totals per ledger kind, from the rows already on screen. */
export function ledgerTotals(rows: LedgerRow[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    totals[row.kind] = (totals[row.kind] ?? 0) + row.amountNaira;
  }
  return totals;
}

export async function loadRefunds(limit = 25): Promise<RefundRow[]> {
  if (!isSupabaseLive()) return [];
  const [orders, bales] = await Promise.all([
    supabaseBrowser()
      .from("order_refunds")
      .select("id, order_id, amount_naira, status, attempts, last_error, paystack_reference, requested_at, processed_at")
      .in("status", REFUND_ATTENTION)
      .order("updated_at", { ascending: false })
      .limit(limit),
    supabaseBrowser()
      .from("bale_refunds")
      .select("id, booking_id, amount_naira, status, attempts, last_error, paystack_reference, requested_at, processed_at")
      .in("status", REFUND_ATTENTION)
      .order("updated_at", { ascending: false })
      .limit(limit),
  ]);
  if (orders.error) throw orders.error;
  if (bales.error) throw bales.error;

  const rows: RefundRow[] = [
    ...(orders.data ?? []).map((row) => ({
      id: row.id,
      source: "order" as const,
      entityId: row.order_id,
      amountNaira: Number(row.amount_naira),
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      reference: row.paystack_reference,
      requestedAt: row.requested_at,
      processedAt: row.processed_at,
    })),
    ...(bales.data ?? []).map((row) => ({
      id: row.id,
      source: "bale" as const,
      entityId: row.booking_id,
      amountNaira: Number(row.amount_naira),
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      reference: row.paystack_reference,
      requestedAt: row.requested_at,
      processedAt: row.processed_at,
    })),
  ];
  // Newest first across both ledgers, so the queue reads as one list.
  return rows.sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1)).slice(0, limit);
}

/**
 * Sessions that did not become money. `pending` past a few minutes means the
 * buyer dropped off at Paystack or the webhook never arrived — both are things
 * an admin must be able to see without opening the Paystack dashboard.
 */
export async function loadSessions(limit = 25): Promise<SessionRow[]> {
  if (!isSupabaseLive()) return [];
  const { data, error } = await supabaseBrowser()
    .from("payment_sessions")
    .select("id, reference, kind, amount_naira, status, channel, failure_reason, paid_at, created_at")
    .in("status", ["pending", "failed", "abandoned"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    amountNaira: Number(row.amount_naira),
    status: row.status,
    channel: row.channel,
    failureReason: row.failure_reason,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  }));
}

export async function loadAuditLog(limit = 40): Promise<AuditRow[]> {
  if (!isSupabaseLive()) return [];
  const { data, error } = await supabaseBrowser()
    .from("admin_audit_log")
    .select("id, admin_id, action, entity_type, entity_id, note, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    adminId: row.admin_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    note: row.note,
    createdAt: row.created_at,
  }));
}

/**
 * Funnel counts for the last `days`.
 *
 * PostgREST cannot group, so each step is one `head` count query — five cheap
 * requests instead of pulling the event table into the browser.
 */
export async function loadFunnel(days = 7): Promise<FunnelStep[]> {
  if (!isSupabaseLive()) return FUNNEL_EVENTS.map((step) => ({ ...step, count: 0 }));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const counts = await Promise.all(
    FUNNEL_EVENTS.map(async (step) => {
      const { count, error } = await supabaseBrowser()
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .eq("event_name", step.event)
        .gte("created_at", since);
      // A missing migration must not blank the whole panel.
      if (error) return 0;
      return count ?? 0;
    })
  );
  return FUNNEL_EVENTS.map((step, index) => ({ ...step, count: counts[index] }));
}

/** Percentage of the first step that reached this one. */
export function funnelRate(steps: FunnelStep[], index: number): number | null {
  const first = steps[0]?.count ?? 0;
  const current = steps[index]?.count ?? 0;
  if (first <= 0) return null;
  return Math.round((current / first) * 100);
}
