"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Landmark,
  ShieldCheck,
  Store,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { naira } from "@/lib/format";
import { CITIES } from "@/lib/mock";
import { cn } from "@/lib/utils";

/**
 * Vendor onboarding — 3-step wizard.
 * Live + signed in: upserts vendor_profiles, uploads docs to the private
 * bucket, files vendor_documents rows, flips role to vendor.
 * Otherwise: guided demo with sign-in prompt.
 */

const STEPS = ["Shop details", "Verification", "Bank & plan"] as const;

const PLANS = [
  { id: "starter", name: "Starter", fee: 2500, commission: "7%", perks: ["20 active listings", "Standard support"] },
  { id: "pro", name: "Pro", fee: 7500, commission: "4%", perks: ["Unlimited listings", "Bale Split + priority placement", "Dedicated support"] },
] as const;

const BANKS = [
  { name: "GTBank", code: "058" },
  { name: "Access Bank", code: "044" },
  { name: "First Bank", code: "011" },
  { name: "UBA", code: "033" },
  { name: "Zenith", code: "057" },
  { name: "Kuda", code: "50211" },
  { name: "FCMB", code: "214" },
  { name: "Fidelity", code: "070" },
  { name: "Stanbic IBTC", code: "221" },
];

const DOCS = [
  { key: "nin", label: "NIN slip or voter's card", hint: "Clear photo or PDF", dbType: "nin" },
  { key: "shop", label: "Shop photo", hint: "Show your signboard + stock", dbType: "shop_photo" },
  { key: "bale", label: "Sample bale photo", hint: "One open bale, natural light", dbType: "bale_sample" },
] as const;

const MAX_FILE_MB = 5;

interface Fields {
  shop: string;
  city: string;
  phone: string;
  market: string;
  bank: string;
  acct: string;
}

export default function SellPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [plan, setPlan] = useState<(typeof PLANS)[number]["id"]>("pro");
  const [fields, setFields] = useState<Fields>({ shop: "", city: "Lagos", phone: "", market: "", bank: BANKS[0].code, acct: "" });
  const [files, setFiles] = useState<Record<string, File>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  function set<K extends keyof Fields>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function pickFile(key: string, file?: File | null) {
    setError(null);
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`"${file.name}" is over ${MAX_FILE_MB}MB — compress and retry.`);
      return;
    }
    setFiles((f) => ({ ...f, [key]: file }));
  }

  function validate(s: number): string | null {
    if (s === 0) {
      if (fields.shop.trim().length < 3) return "Enter your shop name.";
      if (fields.phone.replace(/\D/g, "").length < 10) return "Enter a valid phone number.";
      if (fields.market.trim().length < 5) return "Enter your market / shop address.";
    }
    if (s === 1 && DOCS.some((d) => !files[d.key])) return "Upload all 3 verification documents.";
    if (s === 2 && !/^\d{10}$/.test(fields.acct.trim())) return "Account number must be 10 digits.";
    return null;
  }

  function next() {
    const err = validate(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep((s) => s + 1);
  }

  async function submit() {
    const err = validate(2);
    if (err) {
      setError(err);
      return;
    }
    if (!isSupabaseLive()) {
      setReference("VD-1024"); // demo
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) {
        router.push("/login?next=/sell");
        return;
      }
      // 1) vendor profile. Protected review fields are changed only by the
      // vendor-onboard Edge Function/admin; this client writes business details.
      const { data: existingVendor, error: existingVendorError } = await sb
        .from("vendor_profiles")
        .select("id, verification_status")
        .eq("profile_id", user.id)
        .maybeSingle();
      if (existingVendorError) throw new Error(existingVendorError.message);
      if (existingVendor && ["approved", "inspected"].includes(existingVendor.verification_status)) {
        throw new Error("This account already has an approved vendor profile.");
      }
      const vendorPayload = {
        shop_name: fields.shop.trim(),
        city: fields.city,
        market_address: fields.market.trim(),
        bank_code: fields.bank,
        account_number: fields.acct.trim(),
        subscription_plan: plan,
      };
      const { data: vendor, error: vendorErr } = existingVendor
        ? await sb.from("vendor_profiles").update(vendorPayload).eq("id", existingVendor.id).select("id, verification_status").single()
        : await sb.from("vendor_profiles").insert({ ...vendorPayload, profile_id: user.id }).select("id, verification_status").single();
      if (vendorErr) throw new Error(vendorErr.message);

      // 2) document uploads (private bucket, folder = user id)
      for (const doc of DOCS) {
        const file = files[doc.key];
        const path = `${user.id}/${doc.key}-${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
        const { error: upErr } = await sb.storage.from("vendor-documents").upload(path, file, {
          cacheControl: "3600",
          upsert: false,
        });
        if (upErr) throw new Error(`Upload failed (${doc.label}): ${upErr.message}`);
        const { error: docErr } = await sb.from("vendor_documents").insert({
          vendor_id: vendor.id,
          type: doc.dbType,
          storage_path: path,
        });
        if (docErr) throw new Error(docErr.message);
      }

      // 3) promote the account server-side; clients cannot write role.
      const { error: roleErr } = await sb.functions.invoke("vendor-onboard", {
        body: { vendor_id: vendor.id, resubmit: existingVendor?.verification_status === "rejected" },
      });
      if (roleErr) throw new Error(roleErr.message);

      setReference(`VD-${vendor.id.slice(0, 4).toUpperCase()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (reference) {
    return (
      <div className="container max-w-lg py-12 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <BadgeCheck className="h-8 w-8" />
        </span>
        <h1 className="mt-4 text-2xl font-extrabold">Application received!</h1>
        <p className="mt-2 text-muted-foreground">
          Reference <b className="text-foreground">{reference}</b>. Our team reviews documents within 24
          hours. Physical inspection happens within 1 week for the Inspected badge.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild><Link href="/">Back to home</Link></Button>
          <Button variant="outline" asChild><Link href="/admin">Preview seller dashboard</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-5xl py-6">
      <Badge variant="amber" className="mb-3"><Store /> Vendor onboarding</Badge>
      <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Sell on Bale Drop</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Verified vendors sell 3x faster. Complete all 3 steps — takes about 5 minutes.
        {isSupabaseLive() ? " You'll need an account to submit." : " Demo mode: submission is simulated."}
      </p>

      {/* Stepper */}
      <div className="mt-6">
        <Progress value={((step + 1) / STEPS.length) * 100} className="h-2" />
        <ol className="mt-2 flex gap-1">
          {STEPS.map((s, i) => (
            <li key={s} className={cn("flex-1 text-xs font-semibold", i <= step ? "text-primary" : "text-muted-foreground")}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="p-5 md:p-6">
          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="shop" className="mb-1.5 block text-sm font-semibold">Shop name</label>
                <Input id="shop" placeholder="e.g. Adaeze Thrift Co." value={fields.shop} onChange={(e) => set("shop", e.target.value)} />
              </div>
              <div>
                <label htmlFor="city" className="mb-1.5 block text-sm font-semibold">Base city</label>
                <select id="city" value={fields.city} onChange={(e) => set("city", e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
                  {CITIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="phone" className="mb-1.5 block text-sm font-semibold">Phone (WhatsApp)</label>
                <Input id="phone" type="tel" placeholder="0803 000 0000" value={fields.phone} onChange={(e) => set("phone", e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="market" className="mb-1.5 block text-sm font-semibold">Market / shop address</label>
                <Input id="market" placeholder="e.g. Shop 12, Katangua Market, Lagos" value={fields.market} onChange={(e) => set("market", e.target.value)} />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
                <b>Why we verify:</b> buyers only pay vendors they trust. Documents are encrypted,
                visible only to our review team, and never shared.
              </div>
              {DOCS.map((d) => (
                <div key={d.key}>
                  <span className="mb-1.5 block text-sm font-semibold">{d.label}</span>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-input p-4 transition hover:border-primary/60 hover:bg-muted/50">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      {files[d.key] ? <Check className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
                    </span>
                    <span className="text-sm">
                      <span className="block font-semibold">{files[d.key]?.name ?? "Tap to upload"}</span>
                      <span className="block text-xs text-muted-foreground">{d.hint} • max {MAX_FILE_MB}MB</span>
                    </span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="sr-only"
                      onChange={(e) => pickFile(d.key, e.target.files?.[0])}
                    />
                  </label>
                </div>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="bank" className="mb-1.5 block text-sm font-semibold">Bank</label>
                  <select id="bank" value={fields.bank} onChange={(e) => set("bank", e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
                    {BANKS.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="acct" className="mb-1.5 block text-sm font-semibold">Account number</label>
                  <Input id="acct" inputMode="numeric" maxLength={10} placeholder="10-digit NUBAN" value={fields.acct} onChange={(e) => set("acct", e.target.value.replace(/\D/g, ""))} />
                </div>
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-semibold">Subscription plan</span>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Plan">
                  {PLANS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={plan === p.id}
                      onClick={() => setPlan(p.id)}
                      className={cn(
                        "rounded-xl border p-4 text-left transition",
                        plan === p.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50"
                      )}
                    >
                      <span className="flex items-center justify-between">
                        <span className="font-bold">{p.name}</span>
                        <Landmark className="h-4 w-4 text-primary" />
                      </span>
                      <span className="mt-1 block text-xl font-extrabold tabular-nums">{naira(p.fee)}<span className="text-xs font-medium text-muted-foreground">/mo</span></span>
                      <span className="text-xs font-semibold text-primary">{p.commission} commission per sale</span>
                      <ul className="mt-2 space-y-1 text-[13px] text-muted-foreground">
                        {p.perks.map((perk) => <li key={perk} className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-primary" />{perk}</li>)}
                      </ul>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex gap-3">
            {step > 0 && (
              <Button variant="outline" onClick={() => { setError(null); setStep((s) => s - 1); }}>
                <ChevronLeft /> Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button className="ml-auto" onClick={next}>
                Continue <ChevronRight />
              </Button>
            ) : (
              <Button className="ml-auto" size="lg" onClick={submit} disabled={submitting}>
                {submitting ? "Submitting…" : "Submit application"}
              </Button>
            )}
          </div>
        </Card>

        {/* What happens next */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-32 lg:self-start">
          <Card className="p-5">
            <h2 className="font-bold">What happens next</h2>
            <ol className="mt-3 space-y-3 text-sm">
              {[
                ["Document review", "Within 24 hours. Rejected? You get a clear reason + can re-submit."],
                ["Start selling", "List singles, full bales and splits. Payouts held in 48hr escrow."],
                ["Get inspected", "Physical visit within 1 week unlocks the Inspected badge."],
              ].map(([t, b], i) => (
                <li key={t} className="flex gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                  <span><b>{t}.</b> <span className="text-muted-foreground">{b}</span></span>
                </li>
              ))}
            </ol>
          </Card>
          <Card className="border-primary/30 bg-primary/5 p-4">
            <p className="flex items-start gap-2 text-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span><b>48-hour escrow</b> protects you too — buyers can&apos;t claim &ldquo;no delivery&rdquo; after confirming.</span>
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
