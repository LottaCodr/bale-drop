import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { POLICIES, policyBySlug } from "@/lib/policies";

/**
 * Policy detail pages. Statically rendered (no data dependency), reachable
 * signed-out, and written to be readable on a 360px screen — a policy nobody
 * reads is a policy that does not exist.
 */
export function generateStaticParams() {
  return POLICIES.map((policy) => ({ slug: policy.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const policy = policyBySlug(slug);
  if (!policy) return { title: "Policy not found — Bale Drop" };
  return { title: `${policy.title} — Bale Drop`, description: policy.summary };
}

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const policy = policyBySlug(slug);
  if (!policy) notFound();

  return (
    <article className="container max-w-3xl py-8">
      <Link
        href="/policies"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All policies
      </Link>

      <header className="mt-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
          <FileText className="h-3.5 w-3.5" /> Updated {policy.updated}
        </span>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">{policy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">{policy.summary}</p>
      </header>

      <div className="mt-6 flex flex-col gap-4">
        {policy.sections.map((section) => (
          <Card key={section.heading} className="p-5">
            <h2 className="text-base font-bold">{section.heading}</h2>
            <div className="mt-2 flex flex-col gap-2.5">
              {section.body.map((paragraph) => (
                <p key={paragraph} className="text-sm leading-relaxed text-muted-foreground">
                  {paragraph}
                </p>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Something unclear?{" "}
        <Link href="/support" className="font-semibold text-primary hover:underline">
          Ask support
        </Link>{" "}
        — we answer every message.
      </p>
    </article>
  );
}
