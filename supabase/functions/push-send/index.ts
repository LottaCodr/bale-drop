/**
 * push-send — fan an in-app notification out to the browser (roadmap G-7 / N-3).
 *
 * Two callers:
 *   1. A Supabase **Database Webhook** on `public.notifications` INSERT, posting
 *      the new row (`{ "record": { … } }`). This is the default wiring: every
 *      notification written by any RPC or function reaches a closed tab without
 *      each writer having to remember to send push.
 *   2. Another Edge Function, posting `{ profile_id, title, body, href }`
 *      directly (used where the notification row is written by SQL that runs
 *      after the response is returned).
 *
 * Auth: cron secret or a service-role JWT. Never callable from the browser —
 * the VAPID private key lives only here.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logError, logInfo, logWarn } from "../_shared/monitor.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@baledrop.ng";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "http://localhost:3000").replace(/\/$/, "");

type Payload = {
  profile_id?: string;
  title?: string;
  body?: string | null;
  href?: string | null;
  /** Supabase Database Webhook shape. */
  record?: { profile_id?: string; title?: string; body?: string | null; href?: string | null };
};

type Subscription = { endpoint: string; p256dh: string; auth: string };

function authorized(req: Request): boolean {
  if (CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${SERVICE_KEY}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
  }
  if (!authorized(req)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "push is not configured" }), { status: 503 });
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response(
      JSON.stringify({ ok: true, skipped: "VAPID keys are not configured" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  let payload: Payload;
  try {
    payload = await req.json() as Payload;
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 });
  }

  const record = payload.record ?? payload;
  const profileId = record.profile_id;
  const title = record.title?.trim();
  if (!profileId || !title) {
    return new Response(JSON.stringify({ error: "profile_id and title are required" }), { status: 400 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let subscriptions: Subscription[] = [];
  try {
    const { data, error } = await db.rpc("list_push_endpoints", { p_profile_id: profileId });
    if (error) throw error;
    subscriptions = (data ?? []) as Subscription[];
  } catch (error) {
    logError("push-send", error);
    return new Response(JSON.stringify({ error: "could not load subscriptions" }), { status: 500 });
  }

  if (subscriptions.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, sent: 0, reason: "no subscriptions for this profile" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  let webpush: typeof import("npm:web-push") | null = null;
  try {
    webpush = await import("npm:web-push@1.5.4");
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch (error) {
    logWarn("push-send", "web-push is unavailable in this runtime", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return new Response(
      JSON.stringify({ ok: false, error: "push transport unavailable" }),
      { status: 501, headers: { "Content-Type": "application/json" } },
    );
  }

  const href = record.href ?? "/notifications";
  const message = JSON.stringify({
    title,
    body: record.body?.slice(0, 300) ?? "",
    url: href.startsWith("http") ? href : `${SITE_URL}${href.startsWith("/") ? "" : "/"}${href}`,
    tag: href,
  });

  let sent = 0;
  let dropped = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        message,
        { TTL: 3600, urgency: "high" },
      );
      sent += 1;
      await db.rpc("mark_push_delivery", { p_endpoint: subscription.endpoint, p_drop: false });
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        dropped += 1;
        await db.rpc("mark_push_delivery", { p_endpoint: subscription.endpoint, p_drop: true });
      } else {
        logWarn("push-send", "delivery failed", { status: status ?? 0 });
      }
    }
  }

  logInfo("push-send", "fan-out complete", { sent, dropped, total: subscriptions.length });
  return new Response(
    JSON.stringify({ ok: true, sent, dropped, total: subscriptions.length }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
