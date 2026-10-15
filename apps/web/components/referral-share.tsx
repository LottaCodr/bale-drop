"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { Button } from "@/components/ui/button";

export function ReferralShare({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    if (!isSupabaseLive() || !userId) return;
    try {
      const sb = supabaseBrowser();
      const code = `BD-${userId.slice(0, 8).toUpperCase()}`;
      await sb.from("referral_codes").upsert({ profile_id: userId, code, active: true }, { onConflict: "profile_id" });
      const url = `${window.location.origin}/search?ref=${code}`;
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* best effort */
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleGenerate} className="gap-1.5 text-[13px]">
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Share2 className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : "Refer a friend"}
    </Button>
  );
}
