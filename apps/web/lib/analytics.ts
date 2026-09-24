/**
 * Analytics — one typed funnel, vendor-neutral.
 *
 * The engineering standards require an analytics event per feature; the research
 * (docs/ROADMAP.md) is blunt that you cannot improve conversion without seeing
 * where buyers drop off. We emit `view_item → add_to_cart → begin_checkout →
 * add_payment_info → purchase` plus split-specific events, push them to
 * `window.dataLayer` when a tag manager exists, and mirror them into
 * `public.analytics_events` (migration 0018) when Supabase is configured.
 *
 * Rules: never send PII (no email/phone/address), never block a user action on
 * telemetry, never throw.
 */
import { isSupabaseLive } from "./config";
import { supabaseBrowser } from "./supabase";

export type AnalyticsEvent =
  | "view_home"
  | "view_item"
  | "view_search_results"
  | "add_to_cart"
  | "remove_from_cart"
  | "save_for_later"
  | "view_cart"
  | "begin_checkout"
  | "add_payment_info"
  /** Handoff to Paystack — the redirect happened; payment is still unconfirmed. */
  | "place_order"
  | "purchase"
  | "reorder"
  | "claim_slot"
  | "slot_payment_started"
  | "share_item"
  | "add_to_wishlist"
  | "remove_from_wishlist"
  | "sign_up"
  | "login"
  | "vendor_apply_start"
  | "vendor_apply_submit"
  | "notification_open"
  | "support_open"
  | "support_resolved";

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

const SESSION_KEY = "bale-drop-analytics-session";
const MAX_STRING = 120;

let memorySessionId: string | null = null;

function sessionId(): string {
  if (typeof window === "undefined") return "server";
  if (memorySessionId) return memorySessionId;
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) {
      memorySessionId = existing;
      return existing;
    }
    const created =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem(SESSION_KEY, created);
    memorySessionId = created;
    return created;
  } catch {
    memorySessionId = `mem-${Date.now()}`;
    return memorySessionId;
  }
}

/** Strip PII-ish keys, truncate strings, drop functions/objects. */
export function sanitizeProps(props: AnalyticsProps | undefined): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (/email|phone|address|password|token|name$/i.test(key)) continue;
    if (value === undefined) continue;
    if (typeof value === "string") out[key] = value.slice(0, MAX_STRING);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean" || value === null) out[key] = value;
  }
  return out;
}

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

/** Fire-and-forget funnel event. Safe to call from anywhere client-side. */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (typeof window === "undefined") return;
  const payload = sanitizeProps(props);

  try {
    if (Array.isArray(window.dataLayer)) window.dataLayer.push({ event, ...payload });
    if (process.env.NODE_ENV !== "production") {
      // Visible funnel while developing — no client-side logging elsewhere.
      console.debug(`[analytics] ${event}`, payload);
    }
  } catch {
    /* telemetry must never break the UI */
  }

  if (!isSupabaseLive()) return;
  void supabaseBrowser()
    .from("analytics_events")
    .insert({
      event_name: event,
      session_id: sessionId(),
      props: payload,
      path: window.location.pathname.slice(0, 200),
    })
    .then(
      () => undefined,
      () => undefined
    );
}
