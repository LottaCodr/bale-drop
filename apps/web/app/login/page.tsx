"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";

/** Login — real Supabase auth when live, demo pass-through in mock mode. */

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedNext = params.get("next") ?? "/";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function signInWithGoogle() {
    setError(null);
    const { error: err } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (err) setError(err.message);
  }

  if (!isSupabaseLive()) {
    return (
      <Card className="p-6 text-center">
        <p className="font-bold">Demo mode — no login needed</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Auth lights up automatically once Supabase keys are configured.
        </p>
        <Button className="mt-4 w-full" onClick={() => router.push(next)}>
          Continue exploring
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form onSubmit={signIn} className="flex flex-col gap-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-semibold">Email</label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2"><label htmlFor="password" className="block text-sm font-semibold">Password</label><Link href="/reset-password" className="text-xs font-semibold text-primary hover:underline">Forgot password?</Link></div>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
      <Button variant="outline" className="w-full" onClick={signInWithGoogle}>
        Continue with Google
      </Button>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        New here? <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-primary hover:underline">Create an account</Link>
      </p>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Demo logins: buyer1@baledrop.demo • adaeze@baledrop.demo • admin@baledrop.demo (BaleDrop123!)
      </p>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="container max-w-md py-10">
      <div className="mb-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Package className="h-6 w-6" />
        </span>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to shop, split and track orders.</p>
      </div>
      <Suspense fallback={<Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
