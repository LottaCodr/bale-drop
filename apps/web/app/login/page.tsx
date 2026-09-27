"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
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
import { track } from "@/lib/analytics";
import { hardNavigate } from "@/lib/auth/navigate";

/** Login — real Supabase auth when live, demo pass-through in mock mode. */

function LoginForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const initialError = messageForErrorParam(params.get("error"));
  const notice = params.get("reset") === "success"
    ? "Password updated. Sign in with your new password."
    : params.get("confirmed") === "1"
      ? "Email confirmed. Sign in to continue."
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
        <p className="font-bold">Sign-in is temporarily unavailable</p>
        <p className="mt-1 text-sm text-muted-foreground">Please try again later.</p>
        <Button className="mt-4 w-full" asChild><Link href="/">Back to home</Link></Button>
      </Card>
    );
  }

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
                <p className="mt-1 flex items-center gap-1.5 font-normal"><MailCheck className="h-4 w-4" /> New confirmation link sent. Check your inbox and spam folder.</p>
              ) : (
                <button type="button" onClick={resendConfirmation} disabled={disabled} className="mt-1 font-bold underline underline-offset-2">
                  {busy === "resend" ? "Sending…" : "Resend confirmation email"}
                </button>
              )
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
