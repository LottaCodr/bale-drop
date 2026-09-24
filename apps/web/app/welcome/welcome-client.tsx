"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, PackageCheck, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormAlert } from "@/components/auth/auth-shell";
import { supabaseBrowser } from "@/lib/supabase";
import { CITIES } from "@/lib/taxonomy";
import { normalizeNigerianPhone } from "@/lib/auth/validation";
import { usePrefsStore } from "@/lib/store/prefs-store";
import { track } from "@/lib/analytics";
import { hardNavigate } from "@/lib/auth/navigate";

interface Props {
  next: string;
  role: string;
  email: string;
  initial: { fullName: string; phone: string; city: string };
}

const VALUE_PROPS = [
  { icon: ShieldCheck, title: "Escrow on every order", body: "Your money is held until you confirm delivery." },
  { icon: PackageCheck, title: "Verified vendors", body: "Shops are document-checked; Inspected shops are visited in person." },
  { icon: Users, title: "Bale Split", body: "Share a bale with other buyers and pay only for your slot." },
];

export function WelcomeClient({ next, role, email, initial }: Props) {
  const router = useRouter();
  const setPrefsCity = usePrefsStore((state) => state.setCity);
  const [fields, setFields] = useState(initial);
  const [busy, setBusy] = useState<"save" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const firstName = (fields.fullName || email).split(/[\s@]/)[0];
  const isSeller = role === "vendor" || next.startsWith("/sell");

  async function finish(mode: "save" | "skip") {
    setError(null);
    setPhoneError(null);
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }

    if (mode === "save") {
      const phone = fields.phone.trim() ? normalizeNigerianPhone(fields.phone) : null;
      if (fields.phone.trim() && !phone) {
        setPhoneError("Enter a Nigerian mobile number, e.g. 0803 123 4567.");
        document.getElementById("welcome-phone")?.focus();
        return;
      }
      setBusy("save");
      const { error: profileError } = await sb
        .from("profiles")
        .update({ full_name: fields.fullName.trim() || null, phone, city: fields.city })
        .eq("id", user.id);
      if (profileError) {
        setBusy(null);
        setError("We couldn't save your details. Please try again.");
        return;
      }
      setPrefsCity(fields.city);
    } else {
      setBusy("skip");
    }

    // Remember the step is done so it never shows again (merges into user_metadata).
    await sb.auth.updateUser({ data: { onboarded: true } });
    track("sign_up", { step: "welcome", mode, role });
    hardNavigate(next);
  }

  return (
    <div className="container max-w-lg py-10">
      <div className="text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Sparkles className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Welcome{firstName ? `, ${firstName}` : ""}!</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isSeller ? "Two quick details, then we'll set up your shop." : "Two quick details so delivery and checkout are faster."}
        </p>
      </div>

      <Card className="mt-6 p-6">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void finish("save");
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <div>
            <label htmlFor="welcome-name" className="mb-1.5 block text-sm font-semibold">Full name</label>
            <Input id="welcome-name" autoComplete="name" value={fields.fullName} onChange={(e) => setFields((f) => ({ ...f, fullName: e.target.value }))} placeholder="Adaeze Okafor" />
          </div>
          <div>
            <label htmlFor="welcome-phone" className="mb-1.5 block text-sm font-semibold">
              Phone <span className="font-normal text-muted-foreground">(for delivery riders)</span>
            </label>
            <Input
              id="welcome-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={fields.phone}
              onChange={(e) => {
                setFields((f) => ({ ...f, phone: e.target.value }));
                setPhoneError(null);
              }}
              placeholder="0803 123 4567"
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={phoneError ? "welcome-phone-error" : undefined}
            />
            {phoneError && <p id="welcome-phone-error" className="mt-1 text-xs font-semibold text-red-600 dark:text-red-400">{phoneError}</p>}
          </div>
          <div>
            <label htmlFor="welcome-city" className="mb-1.5 block text-sm font-semibold">Delivery city</label>
            <select id="welcome-city" value={fields.city} onChange={(e) => setFields((f) => ({ ...f, city: e.target.value }))} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
              {CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">We&apos;ll show listings and delivery times for this city first.</p>
          </div>
          {error && <FormAlert>{error}</FormAlert>}
          <Button type="submit" size="lg" disabled={busy !== null}>
            {busy === "save" ? <Loader2 className="animate-spin" /> : null}
            {isSeller ? "Save & set up my shop" : "Save & start shopping"} {busy !== "save" && <ArrowRight />}
          </Button>
          <button type="button" onClick={() => void finish("skip")} disabled={busy !== null} className="text-sm font-semibold text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50">
            {busy === "skip" ? "One moment…" : "Skip for now"}
          </button>
        </form>
      </Card>

      <ul className="mt-6 grid gap-3 sm:grid-cols-3">
        {VALUE_PROPS.map((item) => (
          <li key={item.title} className="rounded-xl border bg-card p-3">
            <item.icon className="h-5 w-5 text-primary" aria-hidden="true" />
            <p className="mt-2 text-sm font-bold">{item.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{item.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
