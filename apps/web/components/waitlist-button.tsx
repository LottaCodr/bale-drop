"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { Button } from "@/components/ui/button";

export function WaitlistButton({ productId, userId }: { productId: string; userId?: string }) {
  const [joined, setJoined] = useState(false);

  async function handleJoin() {
    if (!isSupabaseLive() || !userId) return;
    try {
      const sb = supabaseBrowser();
      await sb.from("waitlists").upsert({ profile_id: userId, product_id: productId }, { onConflict: "profile_id,product_id", ignoreDuplicates: true });
      setJoined(true);
    } catch {
      /* best effort */
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleJoin} disabled={joined} className="gap-1.5 text-[13px]">
      <Bell className="h-3.5 w-3.5" />
      {joined ? "On waitlist" : "Notify when available"}
    </Button>
  );
}
