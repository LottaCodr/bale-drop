"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isSupabaseLive } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase";
import { loadNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/notifications";
import { useNotificationStore } from "@/lib/store/notification-store";
import { useNotificationBell } from "@/lib/store/hooks";
import { track } from "@/lib/analytics";

/**
 * Notification inbox. Reads the shared store the header bell also uses, so
 * "Mark all read" clears the red dot in the same instant, and the page shows
 * the same unread count the bell does.
 */
export default function NotificationsPage() {
  const live = isSupabaseLive();
  const items = useNotificationStore((state) => state.items);
  const status = useNotificationStore((state) => state.status);
  const error = useNotificationStore((state) => state.error);
  const { unread } = useNotificationBell();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadNotifications();
    track("notification_open", { source: "inbox" });
  }, []);

  async function markAll() {
    setBusy(true);
    await markAllNotificationsRead();
    setBusy(false);
  }

  const loading = status === "loading" || status === "idle";

  return (
    <div className="container max-w-2xl py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Order, split and escrow updates in one place{unread > 0 ? ` • ${unread} unread` : ""}.
          </p>
        </div>
        {unread > 0 && (
          <Button variant="outline" size="sm" onClick={markAll} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} Mark all read
          </Button>
        )}
      </div>

      {loading && (
        <div className="mt-8 flex justify-center text-muted-foreground">
          <Loader2 className="animate-spin" />
        </div>
      )}
      {error && !loading && (
        <p role="alert" className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <Card className="mt-6 p-8 text-center">
          <Bell className="mx-auto h-7 w-7 text-muted-foreground" />
          <p className="mt-2 font-bold">You&apos;re all caught up</p>
          <p className="mt-1 text-sm text-muted-foreground">
            We&apos;ll ping you here when a split fills, a parcel moves or escrow is released.
          </p>
        </Card>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {items.map((item) => (
          <Card key={item.id} className={item.read_at ? "p-4" : "border-primary/40 bg-primary/5 p-4"}>
            <div className="flex gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Bell className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold">{item.title}</p>
                  {!item.read_at && <Badge variant="live">New</Badge>}
                </div>
                {item.body && <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>}
                <p className="mt-2 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString("en-NG")}</p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  {item.href && (
                    <Button variant="link" size="sm" className="h-auto p-0" asChild>
                      <Link href={item.href} onClick={() => void markNotificationRead(item.id)}>
                        View update
                      </Link>
                    </Button>
                  )}
                  {!item.read_at && (
                    <Button variant="ghost" size="sm" className="h-auto p-0 text-muted-foreground" onClick={() => void markNotificationRead(item.id)}>
                      Mark read
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {!live && (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Demo inbox — connect Supabase to receive real order and split notifications.
        </p>
      )}
    </div>
  );
}
