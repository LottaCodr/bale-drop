"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { naira } from "@/lib/format";

/**
 * Share / invite — the Pinduoduo growth loop that group buying depends on:
 * a split only fills if buyers can drag in their own network. Uses the native
 * share sheet where available, WhatsApp (the default channel in Nigeria) and a
 * clipboard fallback. Also offers an explicit copy-link affordance because
 * WhatsApp Web previews can't be triggered from a web page directly.
 */
export function ShareButton({
  title,
  url,
  pricePerSlot,
  slotsLeftCount,
  variant = "outline",
  size = "default",
  className,
}: {
  title: string;
  /** Absolute URL shared; defaults to the current page. */
  url?: string;
  pricePerSlot?: number;
  slotsLeftCount?: number;
  variant?: "outline" | "ghost" | "default" | "accent";
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  function shareUrl(): string {
    if (typeof window === "undefined") return url ?? "";
    return url ?? window.location.href;
  }

  function message(link: string): string {
    const slot = pricePerSlot ? ` at ${naira(pricePerSlot)}/slot` : "";
    const left = slotsLeftCount ? ` — ${slotsLeftCount} slot${slotsLeftCount === 1 ? "" : "s"} left` : "";
    return `Join my split for ${title}${slot}${left}. Escrow protected, auto-refund if it doesn't fill: ${link}`;
  }

  async function handleShare() {
    const link = shareUrl();
    const text = message(link);
    const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
    track("share_item", { item_name: title, channel: canShare ? "native" : "clipboard" });
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: `${title} — Bale Drop`, text, url: link });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // User dismissed the sheet, or clipboard is blocked — fall back to WhatsApp.
      if (typeof window !== "undefined") {
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
      }
    }
  }

  return (
    <span className={className ? `inline-flex items-center gap-2 ${className}` : "inline-flex items-center gap-2"}>
      <Button variant={variant} size={size} onClick={handleShare}>
        {copied ? <Check /> : <Share2 />}
        {copied ? "Link copied" : "Share split"}
      </Button>
      <Button variant="ghost" size={size === "lg" ? "default" : "sm"} asChild>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message(url ?? ""))}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track("share_item", { item_name: title, channel: "whatsapp" })}
          className="hidden items-center gap-1.5 sm:inline-flex"
        >
          <Copy className="h-4 w-4" /> WhatsApp
        </a>
      </Button>
    </span>
  );
}
