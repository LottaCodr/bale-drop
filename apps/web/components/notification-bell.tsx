"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isSupabaseLive } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase";
import { loadNotifications } from "@/lib/notifications";
import { useNotificationStore, type Notice } from "@/lib/store/notification-store";
import { useNotificationBell } from "@/lib/store/hooks";

/**
 * Header bell. Shares the notification store with `/notifications` — marking
 * all read on the page now clears this dot too (the old bell kept its own
 * `unread` flag and drifted out of sync). Realtime inserts update both.
 */
export function NotificationBell() {
  const { unread, hydrated } = useNotificationBell();
  const upsert = useNotificationStore((state) => state.upsert);
  const reset = useNotificationStore((state) => state.reset);

  useEffect(() => {
    if (!isSupabaseLive()) {
      void loadNotifications();
      return;
    }
    const sb = supabaseBrowser();
    let channel: ReturnType<typeof sb.channel> | undefined;
    let active = true;

    async function start() {
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (!active) return;
      if (!user) {
        reset();
        return;
      }
      await loadNotifications();
      if (!active) return;
      channel = sb
        .channel(`notifications-${user.id}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `profile_id=eq.${user.id}` },
          (payload) => upsert(payload.new as Notice)
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "notifications", filter: `profile_id=eq.${user.id}` },
          (payload) => upsert(payload.new as Notice)
        )
        .subscribe();
    }

    void start();
    return () => {
      active = false;
      if (channel) void sb.removeChannel(channel);
    };
  }, [upsert, reset]);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className="relative"
      asChild
    >
      <Link href="/notifications">
        <Bell className="h-5 w-5" />
        {hydrated && unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}
