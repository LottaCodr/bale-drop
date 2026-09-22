"use client";

import { useEffect, useState } from "react";
import type { BaleListing, BaleRow } from "@bale-drop/database";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";

/**
 * Live bale subscription. Server renders `initial` (SEO + instant paint);
 * client subscribes to Realtime for counter/slot updates with no refresh.
 * No-op in mock mode. Requires 0002 migration (publication membership).
 */
export function useBaleLive(baleId: string, initial: BaleListing): BaleListing {
  const [bale, setBale] = useState(initial);

  useEffect(() => {
    setBale(initial);
    if (!isSupabaseLive()) return;
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`bale-${baleId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bale_listings", filter: `id=eq.${baleId}` },
        (payload) => {
          const row = payload.new as BaleRow | null;
          if (!row) return;
          setBale((prev) => ({
            ...prev,
            bookedCount: row.booked_count,
            status: row.status === "open" ? "open" : "full",
            expiresAt: Date.parse(row.expires_at),
          }));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bale_bookings", filter: `bale_id=eq.${baleId}` },
        (payload) => {
          const label = (payload.new as { display_label?: string | null })?.display_label;
          setBale((prev) =>
            label && !prev.joiners.includes(label)
              ? { ...prev, joiners: [...prev.joiners, label] }
              : prev
          );
        }
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [baleId, initial]);

  return bale;
}
