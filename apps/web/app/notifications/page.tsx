"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, BellOff, BellRing, Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ServiceUnavailable } from "@/components/service-unavailable";
import { isSupabaseLive } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase";
import { loadNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/notifications";
import { disablePush, enablePush, hasStoredSubscription, pushSupport, type PushState } from "@/lib/push";
import { useNotificationStore } from "@/lib/store/notification-store";
import { useNotificationBell } from "@/lib/store/hooks";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";

/**
 * Notification inbox. Reads the shared store the header bell also uses, so
 * "Mark all read" clears the red dot in the same instant, and the page shows
 * the same unread count the bell does.
 *
 * The bell only works while the tab is open. Push (migration 0029 + `push-send`)
 * is what tells a buyer their escrow released or their split refunded while the
 * app is closed — which is why the toggle lives here rather than in settings.
 */
export default function NotificationsPage() {
  const items = useNotificationStore((state) => state.items);
  const status = useNotificationStore((state) => state.status);
  const error = useNotificationStore((state) => state.error);
  const { unread } = useNotificationBell();
  const [busy, setBusy] = useState(false);
  const [pushState, setPushState] = useState<PushState>("prompt");
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    void loadNotifications();
    track("notification_open", { source: "inbox" });
  }, []);

  // Reflect what the browser already knows before offering anything.
  useEffect(() => {
    const support = pushSupport();
    if (!support.supported || !support.configured) {
      setPushState("unsupported");
      setPushMessage(support.reason);
      return;
    }
    let cancelled = false;
    void hasStoredSubscription().then((stored) => {
      if (cancelled) return;
      setPushState(stored ? "subscribed" : Notification.permission === "denied" ? "denied" : "prompt");
    });
    return () => { cancelled = true; };
  }, []);

  async function togglePush() {
    setPushBusy(true);
    setPushMessage(null);
    const result = pushState === "subscribed" ? await disablePush() : await enablePush();
    setPushState(result.state);
    setPushMessage(result.message);
    setPushBusy(false);
    track(result.state === "subscribed" ? "push_enabled" : "push_disabled", { source: "notifications" });
  }

  async function markAll() {
    setBusy(true);
    await markAllNotificationsRead();
    setBusy(false);
  }

  const loading = status === "loading" || status === "idle";

  if (!isSupabaseLive()) return <ServiceUnavailable title="Notifications are temporarily unavailable" />;

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

      {pushState !== "unsupported" && (
        <Card className="mt-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <span className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            pushState === "subscribed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-primary/10 text-primary",
          )}>
            {pushState === "subscribed" ? <BellRing className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">
              {pushState === "subscribed" ? "Alerts are on for this device" : "Get alerts when the app is closed"}
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {pushMessage ??
                "Escrow released, split refunded, order dispatched — pushed to this device instead of waiting for you to open the app."}
            </p>
          </div>
          <Button
            variant={pushState === "subscribed" ? "outline" : "default"}
            size="sm"
            className="shrink-0"
            onClick={() => void togglePush()}
            disabled={pushBusy}
          >
            {pushBusy ? <Loader2 className="animate-spin" /> : pushState === "subscribed" ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
            {pushState === "subscribed" ? "Turn off" : "Turn on"}
          </Button>
        </Card>
      )}

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

    </div>
  );
}
