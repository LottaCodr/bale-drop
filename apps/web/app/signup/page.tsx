"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MailCheck, ShoppingBag, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { PasswordStrength } from "@/components/auth/password-strength";
import { AuthShell, FormAlert, GoogleIcon } from "@/components/auth/auth-shell";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { friendlyAuthError, type AuthErrorKind } from "@/lib/auth/errors";
import { checkPassword } from "@/lib/auth/password";
import { pwnedCount } from "@/lib/auth/pwned";
import { safeNext } from "@/lib/auth/redirect";
import { useCooldown } from "@/lib/auth/use-cooldown";
import { isValidEmail, normalizeEmail } from "@/lib/auth/validation";
import { track } from "@/lib/analytics";
import { hardNavigate } from "@/lib/auth/navigate";
import { cn } from "@/lib/utils";

/**
 * Signup — asks only for what's needed to create the account (role, name,
 * email, password). Phone + city are collected on the one-time /welcome step
 * (progressive profiling: every extra signup field costs conversions).
 * Metadata feeds the handle_new_user() trigger; only buyer|vendor are honoured.
 */

type Role = "buyer" | "vendor";
type FieldKey = "name" | "email" | "password";

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedNext = safeNext(params.get("next"));
  const [role, setRole] = useState<Role>(params.get("role") === "vendor" ? "vendor" : "buyer");
  const [fields, setFields] = useState({ name: "", email: params.get("email") ?? "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [error, setError] = useState<{ kind: AuthErrorKind; message: string } | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"form" | "google" | "resend" | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [cooldown, startCooldown] = useCooldown();

  // After signup, vendors continue to the shop wizard; everyone passes /welcome.
  const afterWelcome = role === "vendor" ? "/sell" : requestedNext;
  const welcomePath = afterWelcome === "/" ? "/welcome" : `/welcome?next=${encodeURIComponent(afterWelcome)}`;
  const callbackUrl = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(welcomePath)}`;

  function set(key: FieldKey, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((errors) => ({ ...errors, [key]: undefined }));
  }

  function validate(): boolean {
    const errors: Partial<Record<FieldKey, string>> = {};
    if (fields.name.trim().length < 2) errors.name = "Enter your full name.";
    if (!isValidEmail(fields.email)) errors.email = "Enter a valid email address, like you@example.com.";
    const pw = checkPassword(fields.password, { email: fields.email, name: fields.name });
    if (!pw.ok) errors.password = pw.error ?? "Choose a stronger password.";
    setFieldErrors(errors);
    const firstInvalid = (["name", "email", "password"] as const).find((key) => errors[key]);
    if (firstInvalid) document.getElementById(firstInvalid)?.focus();
    return !firstInvalid;
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    setBusy("form");

    // NIST 800-63B: reject passwords seen in breaches (fails open offline).
    if ((await pwnedCount(fields.password)) > 0) {
      setBusy(null);
      setFieldErrors({ password: "This password has appeared in a known data breach. Please choose a different one." });
      document.getElementById("password")?.focus();
      return;
    }

    const email = normalizeEmail(fields.email);
    const { data, error: err } = await supabaseBrowser().auth.signUp({
      email,
      password: fields.password,
      options: {
        emailRedirectTo: callbackUrl(),
        data: { full_name: fields.name.trim(), role },
      },
    });
    if (err) {
      setBusy(null);
      setError(friendlyAuthError(err));
      return;
    }
    // With email confirmation ON, Supabase hides existing accounts by returning
    // a user with no identities instead of an error.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setBusy(null);
      setError(friendlyAuthError({ code: "user_already_exists" }));
      return;
    }
    track("sign_up", { role, method: "password", confirm_required: !data.session });
    if (!data.session) {
      setBusy(null);
      setSentTo(email);
      startCooldown(60);
      return;
    }
    hardNavigate(welcomePath);
  }

  async function resend() {
    if (!sentTo || cooldown > 0) return;
    setBusy("resend");
    setResendNotice(null);
    const { error: err } = await supabaseBrowser().auth.resend({ type: "signup", email: sentTo, options: { emailRedirectTo: callbackUrl() } });
    setBusy(null);
    if (err) {
      setResendNotice(friendlyAuthError(err).message);
      return;
    }
    setResendNotice("Sent again — it can take a minute to arrive.");
    startCooldown(60);
  }

  async function signUpWithGoogle() {
    setError(null);
    setBusy("google");
    const { error: err } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    if (err) {
      setBusy(null);
      setError(friendlyAuthError(err));
    }
  }

  if (!isSupabaseLive()) {
    return (
      <Card className="p-6 text-center">
        <p className="font-bold">Demo mode — no signup needed</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Auth lights up automatically once Supabase keys are configured.
        </p>
        <Button className="mt-4 w-full" onClick={() => router.push(role === "vendor" ? "/sell" : requestedNext)}>
          Continue exploring
        </Button>
      </Card>
    );
  }

  if (sentTo) {
    return (
      <Card className="p-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <MailCheck className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="mt-3 font-bold">Check your inbox</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a confirmation link to <b className="text-foreground">{sentTo}</b>. Open it on this device to finish setting up your account.
        </p>
        <ul className="mt-4 space-y-1 text-left text-xs text-muted-foreground">
          <li>• Can&apos;t find it? Check spam or promotions.</li>
          <li>• The link expires after 24 hours.</li>
        </ul>
        {resendNotice && <div className="mt-4"><FormAlert tone="info">{resendNotice}</FormAlert></div>}
        <Button variant="outline" className="mt-4 w-full" onClick={resend} disabled={cooldown > 0 || busy === "resend"}>
          {busy === "resend" ? <Loader2 className="animate-spin" /> : null}
          {cooldown > 0 ? `Resend email in ${cooldown}s` : "Resend email"}
        </Button>
        <button type="button" className="mt-3 text-sm font-semibold text-primary hover:underline" onClick={() => { setSentTo(null); setResendNotice(null); }}>
          Use a different email
        </button>
      </Card>
    );
  }

  const disabled = busy !== null;

  return (
    <Card className="p-6">
      <fieldset className="mb-4">
        <legend className="mb-2 text-sm font-semibold">What brings you to Bale Drop?</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
          {(
            [
              { id: "buyer", label: "I want to buy", icon: ShoppingBag },
              { id: "vendor", label: "I want to sell", icon: Store },
            ] as const
          ).map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={role === r.id}
              onClick={() => setRole(r.id)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-bold transition",
                role === r.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50"
              )}
            >
              <r.icon className="h-4 w-4 text-primary" aria-hidden="true" /> {r.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {role === "vendor"
            ? "Next you'll set up your shop and upload verification documents (about 5 minutes)."
            : "You can still apply to sell any time from your account."}
        </p>
      </fieldset>

      <form onSubmit={signUp} className="flex flex-col gap-4" noValidate>
        <div>
          <label htmlFor="name" className="mb-1.5 block text-sm font-semibold">Full name</label>
          <Input id="name" name="name" autoComplete="name" required value={fields.name} onChange={(e) => set("name", e.target.value)} placeholder="Adaeze Okafor" aria-invalid={fieldErrors.name ? true : undefined} aria-describedby={fieldErrors.name ? "name-error" : undefined} />
          {fieldErrors.name && <p id="name-error" className="mt-1 text-xs font-semibold text-red-600 dark:text-red-400">{fieldErrors.name}</p>}
        </div>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-semibold">Email</label>
          <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={fields.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" aria-invalid={fieldErrors.email ? true : undefined} aria-describedby={fieldErrors.email ? "email-error" : undefined} />
          {fieldErrors.email && <p id="email-error" className="mt-1 text-xs font-semibold text-red-600 dark:text-red-400">{fieldErrors.email}</p>}
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-semibold">Password</label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={fields.password}
            onChange={(e) => set("password", e.target.value)}
            placeholder="At least 8 characters"
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? "password-error password-strength" : "password-strength"}
          />
          {fieldErrors.password && <p id="password-error" className="mt-1 text-xs font-semibold text-red-600 dark:text-red-400">{fieldErrors.password}</p>}
          <PasswordStrength id="password-strength" password={fields.password} context={{ email: fields.email, name: fields.name }} hideError={Boolean(fieldErrors.password)} />
        </div>

        {error && (
          <FormAlert>
            <p>{error.message}</p>
            {error.kind === "user_already_exists" && (
              <p className="mt-1">
                <Link href={`/login?email=${encodeURIComponent(normalizeEmail(fields.email))}${requestedNext !== "/" ? `&next=${encodeURIComponent(requestedNext)}` : ""}`} className="underline underline-offset-2">Sign in</Link>
                {" · "}
                <Link href={`/reset-password?email=${encodeURIComponent(normalizeEmail(fields.email))}`} className="underline underline-offset-2">Reset password</Link>
              </p>
            )}
          </FormAlert>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={disabled}>
          {busy === "form" ? <><Loader2 className="animate-spin" /> Creating account…</> : role === "vendor" ? "Create seller account" : "Create account"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          By continuing you agree to our <Link href="/policies/terms" className="underline underline-offset-2">Terms</Link> and <Link href="/policies/privacy" className="underline underline-offset-2">Privacy Policy</Link>.
        </p>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
      <Button variant="outline" className="w-full" onClick={signUpWithGoogle} disabled={disabled}>
        {busy === "google" ? <Loader2 className="animate-spin" /> : <GoogleIcon />} Sign up with Google
      </Button>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Have an account? <Link href={`/login${requestedNext !== "/" ? `?next=${encodeURIComponent(requestedNext)}` : ""}`} className="font-semibold text-primary hover:underline">Sign in</Link>
      </p>
    </Card>
  );
}

export default function SignupPage() {
  return (
    <AuthShell title="Join Bale Drop" subtitle="One account for buying and selling.">
      <Suspense fallback={<Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card>}>
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}
