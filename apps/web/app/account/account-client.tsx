"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bell,
  Check,
  Heart,
  Loader2,
  MapPin,
  Package,
  ShieldCheck,
  Store,
  SunMoon,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabaseBrowser } from "@/lib/supabase";
import { CITIES } from "@/lib/taxonomy";
import { usePrefsStore } from "@/lib/store/prefs-store";
import { usePreferences } from "@/lib/store/hooks";
import { useWishlistCount } from "@/lib/store/hooks";
import { hueFor } from "@bale-drop/database";
import { track } from "@/lib/analytics";

interface AccountInitial {
  email: string;
  role: string;
  fullName: string;
  phone: string;
  city: string;
}

const ROLE_LABEL: Record<string, string> = {
  buyer: "Buyer",
  vendor: "Vendor",
  admin: "Admin",
};

export function AccountClient({ live, initial }: { live: boolean; initial: AccountInitial }) {
  const [fields, setFields] = useState({
    fullName: initial.fullName,
    phone: initial.phone,
    city: initial.city,
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prefsCity = usePrefsStore((state) => state.city);
  const setPrefsCity = usePrefsStore((state) => state.setCity);
  const { theme, setTheme } = usePreferences();
  const wishlistCount = useWishlistCount();

  function update<K extends keyof typeof fields>(key: K, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (fields.fullName.trim().length < 2) {
      setError("Add the name delivery riders should ask for.");
      return;
    }
    if (fields.phone.replace(/\D/g, "").length < 10) {
      setError("Add a reachable Nigerian phone number.");
      return;
    }
    setPrefsCity(fields.city);

    if (!live) {
      setNotice("Saved in this browser. Connect Supabase to sync your profile.");
      return;
    }

    setSaving(true);
    const sb = supabaseBrowser();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) {
      setSaving(false);
      setError("Your session expired — sign in again to save.");
      return;
    }
    const { error: updateError } = await sb
      .from("profiles")
      .update({ full_name: fields.fullName.trim(), phone: fields.phone.trim(), city: fields.city })
      .eq("id", user.id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setNotice("Profile updated.");
    track("login", { source: "profile_save" });
  }

  return (
    <div className="mt-5 flex flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <Avatar initials={initial.fullName.slice(0, 2).toUpperCase()} hue={hueFor(initial.email)} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-bold">
            {initial.fullName} <Badge variant="outline">{ROLE_LABEL[initial.role] ?? initial.role}</Badge>
          </p>
          <p className="truncate text-sm text-muted-foreground">{initial.email}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Escrow protected buyer account
          </p>
        </div>
      </Card>

      {notice && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      )}

      <Card className="p-5">
        <h2 className="font-bold">Delivery details</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Used to pre-fill checkout. The address saved on each order is what fulfillment uses.
        </p>
        <form className="mt-4 grid gap-3" onSubmit={save}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="account-name" className="mb-1.5 block text-sm font-semibold">
                Full name
              </label>
              <Input id="account-name" value={fields.fullName} onChange={(event) => update("fullName", event.target.value)} autoComplete="name" />
            </div>
            <div>
              <label htmlFor="account-phone" className="mb-1.5 block text-sm font-semibold">
                Phone
              </label>
              <Input id="account-phone" type="tel" value={fields.phone} onChange={(event) => update("phone", event.target.value)} autoComplete="tel" />
            </div>
          </div>
          <div>
            <label htmlFor="account-city" className="mb-1.5 block text-sm font-semibold">
              Default delivery city
            </label>
            <select
              id="account-city"
              value={fields.city}
              onChange={(event) => update("city", event.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              {CITIES.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> Header city is now <b className="text-foreground">{prefsCity}</b>
            </p>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Check />} Save changes
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <SunMoon className="h-4 w-4 text-primary" /> Appearance
        </h2>
        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Theme">
          {(["system", "light", "dark"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={theme === option}
              onClick={() => setTheme(option)}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold capitalize transition ${
                theme === option ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { href: "/orders", icon: Package, title: "Your orders", sub: "Track, confirm delivery, open a dispute" },
          { href: "/account/addresses", icon: MapPin, title: "Saved addresses", sub: "Manage delivery addresses" },
          { href: "/wishlist", icon: Heart, title: `Saved items${wishlistCount ? ` (${wishlistCount})` : ""}`, sub: "Move a saved item into your cart" },
          { href: "/notifications", icon: Bell, title: "Notifications", sub: "Order and escrow updates" },
          { href: "/vendor", icon: Store, title: "Seller dashboard", sub: "Listings, fulfillment and payouts" },
          { href: "/reset-password", icon: ShieldCheck, title: "Password & security", sub: "Reset your password" },
        ].map((link) => (
          <Card key={link.href} className="p-0">
            <Link href={link.href} className="flex items-center gap-3 p-4 transition hover:bg-muted/50">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <link.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{link.title}</span>
                <span className="block text-[13px] text-muted-foreground">{link.sub}</span>
              </span>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
