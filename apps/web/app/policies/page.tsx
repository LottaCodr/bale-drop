import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LifeBuoy, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { POLICIES } from "@/lib/policies";

export const metadata: Metadata = {
  title: "Policies & buyer protection — Bale Drop",
  description:
    "Escrow, refunds, delivery fees, privacy and the terms that apply when you buy or sell on Bale Drop.",
};

/**
 * Policy index. Linked from every footer, so a buyer can answer "what happens if
 * this goes wrong?" without leaving the site or opening a support ticket.
 */
export default function PoliciesPage() {
  return (
    <div className="container max-w-3xl py-8">
      <header>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <ShieldCheck className="h-3.5 w-3.5" /> Buyer protection
        </span>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">Policies</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Plain-language rules for buying and selling: how your money is held, what we refund, what
          delivery costs, and what we do with your data.
        </p>
      </header>

      <div className="mt-6 grid gap-4">
        {POLICIES.map((policy) => (
          <Card key={policy.slug} className="p-5">
            <h2 className="text-base font-bold">
              <Link href={`/policies/${policy.slug}`} className="hover:text-primary">
                {policy.title}
              </Link>
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{policy.summary}</p>
            <Link
              href={`/policies/${policy.slug}`}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              Read {policy.title.toLowerCase()} <ArrowRight className="h-4 w-4" />
            </Link>
          </Card>
        ))}
      </div>

      <Card className="mt-4 p-5">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <LifeBuoy className="h-4 w-4 text-primary" /> Still stuck?
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Support answers order, delivery, refund and vendor questions — and it is the right place to
          raise a data request.
        </p>
        <Link
          href="/support"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          Contact support <ArrowRight className="h-4 w-4" />
        </Link>
      </Card>
    </div>
  );
}
