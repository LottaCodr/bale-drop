/**
 * Transactional notifications: email (Resend) and SMS (Termii).
 * Roadmap M-4 / G-3.
 *
 * The in-app `notifications` row is written by SQL (RPCs and Edge Functions),
 * and browser push is delivered by the `push-send` function wired to a Database
 * Webhook on `public.notifications` INSERT. This module is the remaining
 * out-of-app half: the receipt a buyer can find later, the refund message that
 * arrives while the tab is closed, the vendor decision that does not depend on
 * someone reopening the site.
 *
 * Push deliberately does NOT live here: every notification row already triggers
 * `push-send`, so sending from both places would buzz the same phone twice.
 *
 * Rules:
 *  - never throws. A dead email provider must not fail a webhook that just
 *    moved money; the caller logs the summary and moves on.
 *  - every channel is env-gated and independently optional, so a deployment
 *    with only Resend configured still sends receipts.
 *  - no PII in logs: summaries carry channel + ok/failed, never an address.
 */
import type { AdminClient } from "./auth.ts";
import { logInfo, logWarn } from "./monitor.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Bale Drop <no-reply@baledrop.ng>";
const TERMII_API_KEY = Deno.env.get("TERMII_API_KEY");
const TERMII_SENDER_ID = Deno.env.get("TERMII_SENDER_ID") ?? "BaleDrop";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "http://localhost:3000").replace(/\/$/, "");

export interface DeliveryTarget {
  /** Preferred: everything is resolved from the profile. */
  profileId?: string | null;
  /** Used when there is no profile (a guest support thread). */
  email?: string | null;
  phone?: string | null;
}

export interface NotificationContent {
  /** In-app headline — reused as the push title and the email subject fallback. */
  title: string;
  body: string;
  /** App-relative link, e.g. `/orders`. */
  href?: string | null;
  email?: {
    subject?: string;
    /** One line above the fold in the inbox. */
    preheader?: string;
    /** Extra rows rendered as a definition list, e.g. amount / reference. */
    details?: [string, string][];
    ctaLabel?: string;
  };
  /** SMS copy. Omit to skip SMS (it costs money; be deliberate). */
  sms?: string;
}

export interface DeliverySummary {
  email: "sent" | "skipped" | "failed";
  sms: "sent" | "skipped" | "failed";
}

const SKIPPED: DeliverySummary = { email: "skipped", sms: "skipped" };

function absoluteUrl(href?: string | null): string {
  if (!href) return SITE_URL;
  return href.startsWith("http") ? href : `${SITE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Small, image-free HTML: opens fast on a ₦30k Android and in plain clients. */
export function emailHtml(content: NotificationContent): string {
  const details = content.email?.details ?? [];
  const cta = content.email?.ctaLabel ?? "Open Bale Drop";
  const url = absoluteUrl(content.href);
  return `<!doctype html>
<html lang="en-NG"><body style="margin:0;background:#faf7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#12211c">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
  <p style="font-weight:800;font-size:18px;color:#2B8A66;margin:0 0 16px">Bale Drop</p>
  <div style="background:#fff;border-radius:16px;padding:20px;border:1px solid #e6e0d6">
    ${content.email?.preheader ? `<p style="margin:0 0 8px;font-size:13px;color:#6b7280">${escapeHtml(content.email.preheader)}</p>` : ""}
    <h1 style="margin:0 0 8px;font-size:19px;line-height:1.3">${escapeHtml(content.title)}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#374151">${escapeHtml(content.body)}</p>
    ${
    details.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px">${
        details.map(([label, value]) =>
          `<tr><td style="padding:6px 0;color:#6b7280">${escapeHtml(label)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${escapeHtml(value)}</td></tr>`
        ).join("")
      }</table>`
      : ""
  }
    <a href="${escapeHtml(url)}" style="display:inline-block;background:#2B8A66;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:12px">${escapeHtml(cta)}</a>
  </div>
  <p style="font-size:12px;color:#6b7280;margin:16px 4px 0;line-height:1.5">
    Payments are held in escrow and released only when you confirm delivery.
    Need a human? Reply to this email or open
    <a href="${escapeHtml(absoluteUrl("/support"))}" style="color:#2B8A66">Support</a>.
  </p>
</div></body></html>`;
}

async function resolveTarget(
  db: AdminClient,
  target: DeliveryTarget,
): Promise<{ email: string | null; phone: string | null }> {
  let email = target.email?.trim().toLowerCase() || null;
  let phone = target.phone?.trim() || null;
  if (!target.profileId) return { email, phone };
  try {
    if (!email) {
      const { data } = await db.auth.admin.getUserById(target.profileId);
      email = data?.user?.email?.trim().toLowerCase() || null;
    }
    if (!phone) {
      const { data } = await db.from("profiles").select("phone").eq("id", target.profileId).maybeSingle();
      phone = (data?.phone as string | null)?.trim() || null;
    }
  } catch (error) {
    logWarn("notify", "could not resolve contact details", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return { email, phone };
}

async function sendEmail(email: string, content: NotificationContent): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [email],
      subject: content.email?.subject ?? content.title,
      html: emailHtml(content),
      text: `${content.title}\n\n${content.body}\n\n${absoluteUrl(content.href)}`,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    logWarn("notify", "email provider rejected the message", {
      status: response.status,
      reason: (await response.text()).slice(0, 200),
    });
  }
  return response.ok;
}

async function sendSms(phone: string, text: string): Promise<boolean> {
  if (!TERMII_API_KEY) return false;
  const response = await fetch("https://api.ng.termii.com/api/sms/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TERMII_API_KEY,
      to: phone,
      from: TERMII_SENDER_ID,
      sms: text.slice(0, 450),
      type: "plain",
      channel: "generic",
    }),
    signal: AbortSignal.timeout(8000),
  });
  return response.ok;
}

/**
 * Deliver one notification over every configured channel. Best-effort and
 * never fatal; the returned summary is meant for a log line.
 */
export async function deliver(
  db: AdminClient,
  target: DeliveryTarget,
  content: NotificationContent,
): Promise<DeliverySummary> {
  const summary: DeliverySummary = { ...SKIPPED };
  try {
    const { email, phone } = await resolveTarget(db, target);

    if (email) {
      summary.email = (await sendEmail(email, content)) ? "sent" : (RESEND_API_KEY ? "failed" : "skipped");
    }
    if (content.sms && phone) {
      summary.sms = (await sendSms(phone, content.sms)) ? "sent" : (TERMII_API_KEY ? "failed" : "skipped");
    }
  } catch (error) {
    logWarn("notify", "delivery failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  logInfo("notify", "delivery summary", {
    title: content.title.slice(0, 60),
    email: summary.email,
    sms: summary.sms,
  });
  return summary;
}

/** True when at least one out-of-app channel is configured. */
export function notificationsConfigured(): boolean {
  return Boolean(RESEND_API_KEY || TERMII_API_KEY);
}

/* -------------------------------------------------------------------------- */
/* Ready-made templates for the five events roadmap M-4 requires by name.      */
/* -------------------------------------------------------------------------- */

export function naira(amount: number): string {
  return `₦${Math.round(amount).toLocaleString("en-NG")}`;
}

export interface ReceiptInput {
  reference: string;
  amountNaira: number;
  orderIds: string[];
  kind: "order" | "slot";
  channel?: string | null;
}

/** "The money record must exist outside the browser." */
export function receiptContent(input: ReceiptInput): NotificationContent {
  const isSlot = input.kind === "slot";
  const reference = isSlot ? input.reference : (input.orderIds[0] ? `BD-${input.orderIds[0].slice(0, 6).toUpperCase()}` : input.reference);
  return {
    title: isSlot ? "Receipt — Bale Split slot" : "Receipt — payment confirmed",
    body: isSlot
      ? `We received ${naira(input.amountNaira)} for your Bale Split slot. It is held in escrow until the split fills; if the deadline passes without a full group, the same amount is refunded automatically.`
      : `We received ${naira(input.amountNaira)}. Your payment is held in escrow and is released to the vendor only when you confirm delivery, or automatically 48 hours after delivery is marked complete.`,
    href: isSlot ? "/orders" : "/orders",
    email: {
      subject: `Bale Drop receipt — ${naira(input.amountNaira)}`,
      preheader: "Proof of purchase. Keep this email.",
      details: [
        ["Amount paid", naira(input.amountNaira)],
        [isSlot ? "Slot reference" : "Order", reference],
        ["Payment reference", input.reference],
        ["Method", input.channel ? input.channel.replaceAll("_", " ") : "Paystack"],
        ["Held in escrow", "Yes — released on your confirmation"],
      ],
      ctaLabel: "Track this order",
    },
    sms: isSlot
      ? `Bale Drop: slot paid, ${naira(input.amountNaira)} held in escrow. Refunded automatically if the split does not fill.`
      : `Bale Drop: ${naira(input.amountNaira)} paid and held in escrow. Confirm delivery to release it.`,
  };
}

export function refundContent(
  amountNaira: number,
  reason: string,
  reference?: string | null,
): NotificationContent {
  return {
    title: "Refund issued",
    body: `${naira(amountNaira)} has been refunded to your original payment method. ${reason} Banks usually post a refund within 3–5 working days.`,
    href: "/orders",
    email: {
      subject: `Bale Drop refund — ${naira(amountNaira)}`,
      details: [
        ["Refunded", naira(amountNaira)],
        ["Reason", reason],
        ...(reference ? [["Payment reference", reference] as [string, string]] : []),
      ],
      ctaLabel: "View your orders",
    },
    sms: `Bale Drop: ${naira(amountNaira)} refunded to your original payment method.`,
  };
}

export function disputeUpdateContent(status: string, note?: string | null): NotificationContent {
  return {
    title: "Dispute updated",
    body: note?.trim()
      ? note.trim()
      : `Your dispute is now "${status.replaceAll("_", " ")}". Our team reviews evidence in the order it arrives.`,
    href: "/orders",
    email: { subject: `Bale Drop dispute — ${status.replaceAll("_", " ")}` },
    sms: `Bale Drop: dispute update — ${status.replaceAll("_", " ")}.`,
  };
}

export function vendorDecisionContent(
  decision: "approved" | "rejected",
  reason?: string | null,
): NotificationContent {
  const approved = decision === "approved";
  return {
    title: approved ? "Seller account approved" : "Seller account needs changes",
    body: approved
      ? "Your shop can now submit listings for moderation. Payouts are queued automatically once a buyer confirms delivery."
      : (reason?.trim() || "Please review your documents and resubmit your application."),
    href: "/vendor",
    email: {
      subject: approved ? "Your Bale Drop shop is approved" : "Your Bale Drop application needs changes",
      ctaLabel: approved ? "Open seller workspace" : "Review your application",
    },
  };
}

export function slotClosingContent(
  productTitle: string,
  slotsLeft: number,
  minutesLeft: number,
): NotificationContent {
  return {
    title: `Split closing — ${slotsLeft} slot${slotsLeft === 1 ? "" : "s"} left`,
    body: `${productTitle} closes in about ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}. If it does not fill, every paid slot is refunded automatically.`,
    href: "/search?kind=bale",
  };
}
