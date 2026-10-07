/**
 * Browser push — the client half of migration 0029 + the `push-send` function.
 *
 * Flow:
 *   1. register `/sw.js` (shows the notification, opens the right page);
 *   2. ask the browser for permission and subscribe with the VAPID public key;
 *   3. store `{ endpoint, p256dh, auth }` in `push_subscriptions` — RLS lets a
 *      profile insert and delete its own rows, never read anyone else's;
 *   4. `push-send` (triggered by the Database Webhook on `notifications` INSERT)
 *      fans each notification out to those endpoints.
 *
 * The private VAPID key never reaches the browser. Nothing here throws at the
 * caller: push is an enhancement, and a blocked permission prompt must not
 * break the page that offered it.
 */
import { isSupabaseLive } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const SW_URL = "/sw.js";

export type PushSupport =
  | { supported: true; configured: true }
  | { supported: true; configured: false; reason: string }
  | { supported: false; reason: string };

export type PushState = "unsupported" | "prompt" | "granted" | "denied" | "subscribed" | "error";

/** What this browser + deployment can do, checked before offering a toggle. */
export function pushSupport(): PushSupport {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { supported: false, reason: "This browser does not support push notifications." };
  }
  if (!VAPID_PUBLIC_KEY) {
    return {
      supported: true,
      configured: false,
      reason: "Push is not configured on this deployment yet (NEXT_PUBLIC_VAPID_PUBLIC_KEY).",
    };
  }
  return { supported: true, configured: true };
}

/** Current permission, mapped to the states the UI renders. */
export function pushPermission(): PushState {
  const support = pushSupport();
  if (!support.supported || !support.configured) return "unsupported";
  if (typeof Notification === "undefined") return "unsupported";
  const permission = Notification.permission;
  if (permission === "denied") return "denied";
  return permission === "granted" ? "granted" : "prompt";
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  } catch {
    return null;
  }
}

/** Convert the raw key bytes to the base64url form `web-push` expects. */
function toBase64Url(buffer: ArrayBuffer | null): string | null {
  if (!buffer) return null;
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** True when this browser already has a subscription the server knows about. */
export async function hasStoredSubscription(): Promise<boolean> {
  if (!isSupabaseLive()) return false;
  try {
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return false;
    const registration = await navigator.serviceWorker.getRegistration(SW_URL);
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return false;
    const { count } = await sb
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", user.id)
      .eq("endpoint", subscription.endpoint);
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

export interface EnablePushResult {
  state: PushState;
  message: string;
}

/**
 * Ask for permission, subscribe and store the endpoint. Safe to call twice: an
 * existing subscription is upserted on its unique `endpoint`.
 */
export async function enablePush(): Promise<EnablePushResult> {
  const support = pushSupport();
  if (!support.supported) return { state: "unsupported", message: support.reason };
  if (!support.configured) return { state: "unsupported", message: support.reason };
  if (!isSupabaseLive()) {
    return { state: "error", message: "Push needs a live connection. Please try again later." };
  }

  const sb = supabaseBrowser();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return { state: "error", message: "Sign in before turning on notifications." };
  }

  let permission = typeof Notification !== "undefined" ? Notification.permission : "denied";
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = "denied";
    }
  }
  if (permission !== "granted") {
    return {
      state: "denied",
      message: "Notifications are blocked for this site. You can allow them from your browser's site settings.",
    };
  }

  const registration = await registerServiceWorker();
  if (!registration) {
    return { state: "error", message: "We could not start the notification service. Please refresh and try again." };
  }

  let subscription: PushSubscription | null = null;
  try {
    subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(VAPID_PUBLIC_KEY),
      });
    }
  } catch {
    return { state: "error", message: "Your browser refused the notification subscription. Please try again." };
  }

  const keys = subscription.getKey ? {
    p256dh: toBase64Url(subscription.getKey("p256dh")),
    auth: toBase64Url(subscription.getKey("auth")),
  } : { p256dh: null, auth: null };
  if (!keys.p256dh || !keys.auth) {
    return { state: "error", message: "This browser did not provide the keys push needs." };
  }

  const { error } = await sb.from("push_subscriptions").upsert(
    {
      profile_id: user.id,
      endpoint: subscription.endpoint,
      p256dh_key: keys.p256dh,
      auth_key: keys.auth,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    return { state: "error", message: "We could not save this device for notifications. Please try again." };
  }

  return { state: "subscribed", message: "Notifications are on for this device." };
}

/** Unsubscribe locally and delete the stored endpoint. */
export async function disablePush(): Promise<EnablePushResult> {
  if (!isSupabaseLive()) return { state: "error", message: "Push needs a live connection." };
  const sb = supabaseBrowser();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { state: "prompt", message: "You are signed out." };

  const registration = await navigator.serviceWorker.getRegistration(SW_URL);
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await subscription.unsubscribe().catch(() => undefined);
    await sb.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  }
  return { state: "prompt", message: "Notifications are off for this device." };
}

/** `applicationServerKey` wants bytes, not the base64url string from env. */
function urlBase64ToArrayBuffer(base64Url: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new ArrayBuffer(raw.length);
  const view = new Uint8Array(output);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return output;
}
