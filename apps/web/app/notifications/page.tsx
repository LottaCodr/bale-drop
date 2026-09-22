"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isSupabaseLive } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase";

type Notice = { id: string; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string };

const DEMO_NOTICES: Notice[] = [
  { id: "demo-1", title: "Escrow protects your next order", body: "Your vendor is paid only after delivery confirmation.", href: "/#escrow", read_at: null, created_at: new Date().toISOString() },
  { id: "demo-2", title: "Launch delivery subsidy active", body: "Save on tracked delivery while the launch promo lasts.", href: "/", read_at: null, created_at: new Date().toISOString() },
];

export default function NotificationsPage() {
  const live = isSupabaseLive();
  const [items, setItems] = useState<Notice[]>(live ? [] : DEMO_NOTICES);
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    const sb = supabaseBrowser();
    sb.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setError("Sign in to see notifications."); setLoading(false); return; }
      const { data, error: queryError } = await sb.from("notifications").select("*").eq("profile_id", user.id).order("created_at", { ascending: false }).limit(50);
      if (queryError) setError(queryError.message); else setItems(data ?? []);
      setLoading(false);
    });
  }, [live]);

  async function markAllRead() {
    if (!live) { setItems((current) => current.map((item) => ({ ...item, read_at: new Date().toISOString() }))); return; }
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("profile_id", user.id).is("read_at", null);
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })));
  }

  return (
    <div className="container max-w-2xl py-6"><div className="flex items-start justify-between gap-3"><div><h1 className="text-2xl font-extrabold tracking-tight">Notifications</h1><p className="mt-1 text-sm text-muted-foreground">Order, vendor and escrow updates in one place.</p></div>{items.some((item) => !item.read_at) && <Button variant="outline" size="sm" onClick={markAllRead}><Check /> Mark all read</Button>}</div>
      {loading && <div className="mt-8 flex justify-center text-muted-foreground"><Loader2 className="animate-spin" /></div>}
      {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      {!loading && !error && items.length === 0 && <Card className="mt-6 p-8 text-center"><Bell className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-2 font-bold">You’re all caught up</p></Card>}
      <div className="mt-6 flex flex-col gap-3">{items.map((item) => <Card key={item.id} className={item.read_at ? "p-4" : "border-primary/40 bg-primary/5 p-4"}><div className="flex gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bell className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="font-bold">{item.title}</p>{!item.read_at && <Badge variant="live">New</Badge>}</div>{item.body && <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>}<p className="mt-2 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString("en-NG")}</p>{item.href && <Button variant="link" size="sm" className="mt-1 h-auto p-0" asChild><Link href={item.href}>View update</Link></Button>}</div></div></Card>)}</div>
    </div>
  );
}
