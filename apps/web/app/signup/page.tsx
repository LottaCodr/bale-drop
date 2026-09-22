"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, Package, ShoppingBag, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { CITIES } from "@/lib/mock";
import { cn } from "@/lib/utils";

/** Signup — metadata feeds the handle_new_user() trigger (role/name/phone/city). */

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const rawNext = params.get("next") ?? "/";
  const requestedNext = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const [role, setRole] = useState<"buyer" | "vendor">("buyer");
  const [fields, setFields] = useState({ name: "", phone: "", city: "Lagos", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof fields>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { data, error: err } = await supabaseBrowser().auth.signUp({
      email: fields.email,
      password: fields.password,
      options: {
        data: { full_name: fields.name, phone: fields.phone, city: fields.city, role },
      },
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (!data.session) {
      setSent(true); // email confirmation required
      return;
    }
    router.push(role === "vendor" ? "/sell" : requestedNext);
    router.refresh();
  }

  if (!isSupabaseLive()) {
    return (
      <Card className="p-6 text-center">
        <p className="font-bold">Demo mode — no signup needed</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Auth lights up automatically once Supabase keys are configured.
        </p>
        <Button className="mt-4 w-full" onClick={() => router.push(requestedNext)}>
          Continue exploring
        </Button>
      </Card>
    );
  }

  if (sent) {
    return (
      <Card className="p-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <BadgeCheck className="h-6 w-6" />
        </span>
        <p className="mt-3 font-bold">Check your inbox</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a confirmation link to <b className="text-foreground">{fields.email}</b>.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="mb-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
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
            <r.icon className="h-4 w-4 text-primary" /> {r.label}
          </button>
        ))}
      </div>
      <form onSubmit={signUp} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="mb-1.5 block text-sm font-semibold">Full name</label>
            <Input id="name" required value={fields.name} onChange={(e) => set("name", e.target.value)} placeholder="Adaeze Okafor" />
          </div>
          <div>
            <label htmlFor="phone" className="mb-1.5 block text-sm font-semibold">Phone</label>
            <Input id="phone" type="tel" required value={fields.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0803 000 0000" />
          </div>
        </div>
        <div>
          <label htmlFor="city" className="mb-1.5 block text-sm font-semibold">City</label>
          <select id="city" value={fields.city} onChange={(e) => set("city", e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
            {CITIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-semibold">Email</label>
          <Input id="email" type="email" autoComplete="email" required value={fields.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-semibold">Password</label>
          <Input id="password" type="password" autoComplete="new-password" required minLength={6} value={fields.password} onChange={(e) => set("password", e.target.value)} placeholder="Min. 6 characters" />
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? "Creating account…" : `Create ${role} account`}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Have an account? <Link href={`/login?next=${encodeURIComponent(requestedNext)}`} className="font-semibold text-primary hover:underline">Sign in</Link>
      </p>
    </Card>
  );
}

export default function SignupPage() {
  return (
    <div className="container max-w-md py-10">
      <div className="mb-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Package className="h-6 w-6" />
        </span>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Join Bale Drop</h1>
        <p className="mt-1 text-sm text-muted-foreground">One account for buying and selling.</p>
      </div>
      <Suspense fallback={<Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card>}>
        <SignupForm />
      </Suspense>
    </div>
  );
}
