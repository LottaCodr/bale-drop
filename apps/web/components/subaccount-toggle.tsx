"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { Button } from "@/components/ui/button";

export function SubaccountToggle({ vendorId, current }: { vendorId: string; current?: string | null }) {
  const [schedule, setSchedule] = useState(current ?? "automatic");

  async function toggle() {
    if (!isSupabaseLive()) return;
    try {
      const sb = supabaseBrowser();
      const next = schedule === "automatic" ? "manual" : "automatic";
      await sb.from("vendor_profiles").update({ settlement_schedule: next }).eq("id", vendorId);
      setSchedule(next);
    } catch {
      /* best effort */
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={toggle} className="gap-1.5 text-[13px]">
      <CreditCard className="h-3.5 w-3.5" />
      {schedule === "manual" ? "Manual settlement" : "Switch to manual"}
    </Button>
  );
}
