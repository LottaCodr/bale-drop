"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, KeyRound, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { isSupabaseLive } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const live = isSupabaseLive();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [hasSession, setHasSession] = useState(false);
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    const sb = supabaseBrowser();
    sb.auth.getSession().then(({ data }) => setHasSession(Boolean(data.session)));
    const { data: listener } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setHasSession(true);
    });
    return () => listener.subscription.unsubscribe();
  }, [live]);

  async function requestReset(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    const { error: resetError } = await supabaseBrowser().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password` });
    setBusy(false);
    if (resetError) setError(resetError.message); else setSent(true);
  }

  async function updatePassword(event: React.FormEvent) {
    event.preventDefault(); setError(null);
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    const { error: updateError } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (updateError) setError(updateError.message); else setDone(true);
  }

  return (
    <div className="container max-w-md py-10">
      <div className="mb-6 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><Package className="h-6 w-6" /></span><h1 className="mt-3 text-2xl font-extrabold">Reset your password</h1><p className="mt-1 text-sm text-muted-foreground">Keep your Bale Drop account secure.</p></div>
      {!live && <Card className="p-6 text-center"><p className="font-bold">Demo mode</p><p className="mt-1 text-sm text-muted-foreground">Password recovery becomes available when Supabase is connected.</p><Button className="mt-4" asChild><Link href="/login">Back to sign in</Link></Button></Card>}
      {live && done && <Card className="p-6 text-center"><Check className="mx-auto h-8 w-8 text-emerald-600" /><p className="mt-3 font-bold">Password updated</p><p className="mt-1 text-sm text-muted-foreground">You can now sign in with your new password.</p><Button className="mt-4" asChild><Link href="/login">Sign in</Link></Button></Card>}
      {live && !done && hasSession && <Card className="p-6"><div className="mb-4 flex items-center gap-2 font-bold"><KeyRound className="h-5 w-5 text-primary" />Choose a new password</div><form onSubmit={updatePassword} className="flex flex-col gap-4"><div><label htmlFor="new-password" className="mb-1.5 block text-sm font-semibold">New password</label><Input id="new-password" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></div><div><label htmlFor="confirm-password" className="mb-1.5 block text-sm font-semibold">Confirm password</label><Input id="confirm-password" type="password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>{error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}<Button type="submit" size="lg" disabled={busy}>{busy ? "Updating…" : "Update password"}</Button></form></Card>}
      {live && !done && !hasSession && <Card className="p-6"><form onSubmit={requestReset} className="flex flex-col gap-4"><div><label htmlFor="reset-email" className="mb-1.5 block text-sm font-semibold">Account email</label><Input id="reset-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></div>{sent ? <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">Check your inbox for a reset link.</p> : <Button type="submit" size="lg" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button>}{error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}</form><p className="mt-4 text-center text-sm text-muted-foreground"><Link href="/login" className="font-semibold text-primary hover:underline">Back to sign in</Link></p></Card>}
    </div>
  );
}
