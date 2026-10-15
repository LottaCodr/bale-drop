"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { Button } from "@/components/ui/button";

export function ReturnRequestButton({ orderId, userId }: { orderId: string; userId?: string }) {
  const [submitted, setSubmitted] = useState(false);

  async function handleRequest() {
    if (!isSupabaseLive() || !userId || submitted) return;
    try {
      const sb = supabaseBrowser();
      await sb.from("return_requests").insert({ order_id: orderId, buyer_id: userId, reason: "Item not as described", status: "pending" });
      setSubmitted(true);
    } catch {
      /* best effort */
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleRequest} disabled={submitted} className="gap-1.5 text-[13px]">
      <RotateCcw className="h-3.5 w-3.5" />
      {submitted ? "Request sent" : "Request return"}
    </Button>
  );
}
