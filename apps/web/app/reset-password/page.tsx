"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, KeyRound, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { PasswordStrength } from "@/components/auth/password-strength";
import { AuthShell, FormAlert } from "@/components/auth/auth-shell";
import { isSupabaseLive } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase";
import { friendlyAuthError, messageForErrorParam } from "@/lib/auth/errors";
import { checkPassword } from "@/lib/auth/password";
import { pwnedCount } from "@/lib/auth/pwned";
import { useCooldown } from "@/lib/auth/use-cooldown";
import { isValidEmail, normalizeEmail } from "@/lib/auth/validation";
import { hardNavigate } from "@/lib/auth/navigate";

type View = "checking" | "request" | "update" | "done";

function ResetPasswordFlow() {
  const params = useSearchParams();
  const live = isSupabaseLive();
  const [view, setView] = useState<View>(live ? "checking" : "request");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(messageForErrorParam(params.get("error")));
  const [cooldown, startCooldown] = useCooldown();

  useEffect(() => {
    if (!live) return;
    const sb = supabaseBrowser();
    let active = true;
    sb.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUserEmail(data.user?.email);
      setView((current) => (current === "checking" ? (data.user ? "update" : "request") : current));
    });
    const { data: listener } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && event === "SIGNED_IN")) {
        setUserEmail(session?.user.email);
        setView((current) => (current === "done" ? current : "update"));
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [live]);

  async function requestReset(event: React.FormEvent) {
    event.preventDefault();
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      setError("Enter a valid email address, like you@example.com.");
      return;
    }
    if (cooldown > 0) return;
    setBusy(true);
    setError(null);
    const { error: resetError } = await supabaseBrowser().auth.resetPasswordForEmail(normalized, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
    });
    setBusy(false);
    // Don't reveal whether the email exists — only surface throttling/network issues.
    if (resetError) {
      const friendly = friendlyAuthError(resetError);
      if (["email_rate_limited", "rate_limited", "network"].includes(friendly.kind)) {
        setError(friendly.message);
        return;
      }
    }
    setSentTo(normalized);
    startCooldown(60);
  }

  async function updatePassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const check = checkPassword(password, { email: userEmail });
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    if ((await pwnedCount(password)) > 0) {
      setBusy(false);
      setError("This password has appeared in a known data breach. Please choose a different one.");
      return;
    }
    const { error: updateError } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(friendlyAuthError(updateError).message);
      return;
    }
    setView("done");
  }

  if (!live) {
    return (
      <Card className="p-6 text-center">
        <p className="font-bold">Demo mode</p>
        <p className="mt-1 text-sm text-muted-foreground">Password recovery becomes available when Supabase is connected.</p>
        <Button className="mt-4" asChild><Link href="/login">Back to sign in</Link></Button>
      </Card>
    );
  }

  if (view === "checking") {
    return <Card className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking your link…</Card>;
  }

  if (view === "done") {
    return (
      <Card className="p-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-6 w-6" aria-hidden="true" /></span>
        <h2 className="mt-3 font-bold">Password updated</h2>
        <p className="mt-1 text-sm text-muted-foreground">You&apos;re signed in. Other devices were signed out for your security.</p>
        <Button className="mt-4 w-full" onClick={() => hardNavigate("/")}>Continue shopping</Button>
      </Card>
    );
  }

  if (view === "update") {
    return (
      <Card className="p-6">
        <div className="mb-1 flex items-center gap-2 font-bold"><KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />Choose a new password</div>
        {userEmail && <p className="mb-4 text-sm text-muted-foreground">For <b className="text-foreground">{userEmail}</b></p>}
        <form onSubmit={updatePassword} className="flex flex-col gap-4" noValidate>
          {/* Hidden username helps password managers update the right entry. */}
          <input type="email" name="username" autoComplete="username" value={userEmail ?? ""} readOnly hidden />
          <div>
            <label htmlFor="new-password" className="mb-1.5 block text-sm font-semibold">New password</label>
            <PasswordInput
              id="new-password"
              name="new-password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              aria-describedby="new-password-strength"
            />
            <PasswordStrength id="new-password-strength" password={password} context={{ email: userEmail }} />
          </div>
          {error && <FormAlert>{error}</FormAlert>}
          <Button type="submit" size="lg" disabled={busy}>{busy ? <><Loader2 className="animate-spin" /> Updating…</> : "Update password"}</Button>
        </form>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      {sentTo ? (
        <div className="text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><MailCheck className="h-6 w-6" aria-hidden="true" /></span>
          <h2 className="mt-3 font-bold">Check your inbox</h2>
          <p className="mt-1 text-sm text-muted-foreground">If an account exists for <b className="text-foreground">{sentTo}</b>, you&apos;ll get a reset link shortly. Open it on this device.</p>
          {error && <div className="mt-4"><FormAlert>{error}</FormAlert></div>}
          <form onSubmit={requestReset}>
            <Button type="submit" variant="outline" className="mt-4 w-full" disabled={busy || cooldown > 0}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend link"}
            </Button>
          </form>
          <button type="button" className="mt-3 text-sm font-semibold text-primary hover:underline" onClick={() => { setSentTo(null); setError(null); }}>Use a different email</button>
        </div>
      ) : (
        <form onSubmit={requestReset} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-muted-foreground">Enter the email you signed up with and we&apos;ll send you a link to choose a new password.</p>
          <div>
            <label htmlFor="reset-email" className="mb-1.5 block text-sm font-semibold">Account email</label>
            <Input id="reset-email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          {error && <FormAlert>{error}</FormAlert>}
          <Button type="submit" size="lg" disabled={busy}>{busy ? <><Loader2 className="animate-spin" /> Sending…</> : "Send reset link"}</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-muted-foreground"><Link href="/login" className="font-semibold text-primary hover:underline">Back to sign in</Link></p>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Reset your password" subtitle="Keep your Bale Drop account secure.">
      <Suspense fallback={<Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card>}>
        <ResetPasswordFlow />
      </Suspense>
    </AuthShell>
  );
}
