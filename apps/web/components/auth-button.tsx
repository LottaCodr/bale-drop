"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut, User } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { hueFor } from "@bale-drop/database";
import { hardNavigate } from "@/lib/auth/navigate";

/** Header auth state: Sign in → avatar + sign out. Static in mock mode. */
export function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isSupabaseLive()) {
      setLoaded(true);
      return;
    }
    const sb = supabaseBrowser();
    sb.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null);
      setLoaded(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function logout() {
    await supabaseBrowser().auth.signOut();
    setEmail(null);
    // Full reload: leaves private pages and drops every in-memory trace of the
    // previous user (router cache, realtime channels) — matters on shared phones.
    hardNavigate("/");
  }

  if (!loaded) {
    return <span className="h-9 w-9 animate-pulse rounded-full bg-muted" aria-hidden="true" />;
  }
  if (!email) {
    return (
      <Button size="sm" variant="outline" asChild>
        <Link href="/login">
          <User /> Sign in
        </Link>
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1" title={email}>
      <Link href="/account" aria-label="Your account">
        <Avatar initials={email.slice(0, 2).toUpperCase()} hue={hueFor(email)} size="sm" />
      </Link>
      <Button size="sm" variant="ghost" onClick={logout} aria-label="Sign out" className="px-2">
        <LogOut />
      </Button>
    </span>
  );
}
