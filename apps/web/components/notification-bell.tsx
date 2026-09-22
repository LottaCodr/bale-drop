"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isSupabaseLive } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase";

export function NotificationBell() {
  const [unread, setUnread] = useState(!isSupabaseLive());
  useEffect(() => {
    if (!isSupabaseLive()) return;
    const sb = supabaseBrowser();
    let channel: ReturnType<typeof sb.channel> | undefined;
    async function load() {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { setUnread(false); return; }
      const { count } = await sb.from("notifications").select("id", { count: "exact", head: true }).eq("profile_id", user.id).is("read_at", null);
      setUnread((count ?? 0) > 0);
      channel = sb.channel(`notifications-${user.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `profile_id=eq.${user.id}` }, () => setUnread(true)).subscribe();
    }
    void load();
    return () => { if (channel) void sb.removeChannel(channel); };
  }, []);
  return <Button variant="ghost" size="icon" aria-label={unread ? "Notifications, unread" : "Notifications"} className="relative" asChild><Link href="/notifications"><Bell className="h-5 w-5" />{unread && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />}</Link></Button>;
}
