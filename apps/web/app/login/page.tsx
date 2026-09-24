"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn, MailCheck, ShieldCheck, ShoppingBag, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { AuthShell, FormAlert, GoogleIcon } from "@/components/auth/auth-shell";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { friendlyAuthError, messageForErrorParam, type AuthErrorKind } from "@/lib/auth/errors";
import { postAuthPath, safeNext } from "@/lib/auth/redirect";
import { isValidEmail, normalizeEmail } from "@/lib/auth/validation";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, demoLoginsEnabled, type DemoAccount } from "@/lib/auth/demo-accounts";
import { track } from "@/lib/analytics";
import { hardNavigate } from "@/lib/auth/navigate";

/** Login — real Supabase auth when live, demo pass-through in mock mode. */

const DEMO_ICONS = { buyer: ShoppingBag, vendor: Store, admin: ShieldCheck } as const;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const initialError = messageForErrorParam(params.get("error"));
  const notice = params.get("reset") === "success"
    ? "Password updated — sign in with your new password."
    : params.get("confirmed") === "1"
      ? "Email confirmed — sign in to continue."
      : null;

  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ kind: AuthErrorKind | "field"; message: string } | null>(
    initialError ? { kind: "link_invalid", message: initialError } : null
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function completeSignIn(userId: string, metadata: Record<string, unknown> | undefined) {
    const sb = supabaseBrowser();
    const { data: profile } = await sb.from("profiles").select("role, phone, city").eq("id", userId).maybeSingle();
    const destination = postAuthPath(profile?.role, next, {
      onboarded: metadata?.onboarded,
      phone: profile?.phone,
      city: profile?.city,
    });
    track("login", { method: "password", role: profile?.role ?? "buyer" });
    hardNavigate(destination);
  }

  async function signIn(credentials: { email: string; password: string }, source: string) {
    setError(null);
    setResent(false);
    setBusy(source);
    const { data, error: err } = await supabaseBrowser().auth.signInWithPassword(credentials);
    if (err || !data.user) {
      setBusy(null);
      const friendly = friendlyAuthError(err);
      setError(friendly);
      return;
    }
    await completeSignIn(data.user.id, data.user.user_metadata);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      setError({ kind: "field", message: "Enter a valid email address, like you@example.com." });
      return;
    }
    if (!password) {
      setError({ kind: "field", message: "Enter your password." });
      return;
    }
    void signIn({ email: normalized, password }, "form");
  }

  function signInAsDemo(account: DemoAccount) {
    setEmail(account.email);
    setPassword(DEMO_PASSWORD);
    void signIn({ email: account.email, password: DEMO_PASSWORD }, account.email);
  }

  async function resendConfirmation() {
    setBusy("resend");
    const { error: err } = await supabaseBrowser().auth.resend({
      type: "signup",
      email: normalizeEmail(email),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setBusy(null);
    if (err) setError(friendlyAuthError(err));
    else setResent(true);
  }

  async function signInWithGoogle() {
    setError(null);
    setBusy("google");
    const { error: err } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (err) {
      setBusy(null);
      setError(friendlyAuthError(err));
    }
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

  const isDemoEmail = normalizeEmail(email).endsWith("@baledrop.demo");
  const disabled = busy !== null;

  return (
    <Card className="p-6">
      {notice && <div className="mb-4"><FormAlert tone="success">{notice}</FormAlert></div>}
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-semibold">Email</label>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-invalid={error?.kind === "field" && !isValidEmail(email) ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor="password" className="block text-sm font-semibold">Password</label>
            <Link href={`/reset-password${email ? `?email=${encodeURIComponent(normalizeEmail(email))}` : ""}`} className="text-xs font-semibold text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            aria-invalid={error?.kind === "invalid_credentials" ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
        </div>

        {error && (
          <FormAlert id="login-error">
            <p>{error.message}</p>
            {error.kind === "email_not_confirmed" && (
              resent ? (
                <p className="mt-1 flex items-center gap-1.5 font-normal"><MailCheck className="h-4 w-4" /> New confirmation link sent — check your inbox and spam folder.</p>
              ) : (
                <button type="button" onClick={resendConfirmation} disabled={disabled} className="mt-1 font-bold underline underline-offset-2">
                  {busy === "resend" ? "Sending…" : "Resend confirmation email"}
                </button>
              )
            )}
            {error.kind === "invalid_credentials" && isDemoEmail && (
              <p className="mt-1 text-xs font-normal">
                Demo accounts are created by <code>supabase/fix-demo-logins.sql</code> — if this project was seeded before that fix, run it once in the Supabase SQL editor.
              </p>
            )}
          </FormAlert>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={disabled}>
          {busy === "form" ? <><Loader2 className="animate-spin" /> Signing in…</> : "Sign in"}
        </Button>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
      <Button variant="outline" className="w-full" onClick={signInWithGoogle} disabled={disabled}>
        {busy === "google" ? <Loader2 className="animate-spin" /> : <GoogleIcon />} Continue with Google
      </Button>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        New here? <Link href={`/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-primary hover:underline">Create an account</Link>
      </p>

      {demoLoginsEnabled() && (
        <section aria-labelledby="demo-heading" className="mt-5 rounded-xl border border-dashed p-3">
          <h2 id="demo-heading" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Try a demo account</h2>
          <ul className="mt-2 grid gap-2">
            {DEMO_ACCOUNTS.map((account) => {
              const Icon = DEMO_ICONS[account.role];
              return (
                <li key={account.email}>
                  <button
                    type="button"
                    onClick={() => signInAsDemo(account)}
                    disabled={disabled}
                    className="flex w-full items-center gap-3 rounded-lg border bg-background p-2.5 text-left transition hover:border-primary/60 hover:bg-muted/50 disabled:opacity-60"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold">{account.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{account.description}</span>
                    </span>
                    {busy === account.email ? <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="Signing in" /> : <LogIn className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Or type any seeded email (e.g. buyer2@baledrop.demo) with password <code className="font-semibold">{DEMO_PASSWORD}</code>
          </p>
        </section>
      )}
    </Card>
  );
}

export default function LoginPage() {
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to shop, split and track orders.">
      <Suspense fallback={<Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card>}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
