"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, LifeBuoy, Loader2, Mail, MessageSquare, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { TOPIC_LABELS, SUPPORT_TOPICS, sendSupportMessage, type SupportTopic } from "@/lib/support";
import { track } from "@/lib/analytics";

/**
 * Support — the human door.
 *
 * Disputes have an automated path (Orders → Disputes & refunds); everything
 * else (delivery failed twice, payout question, data request) lands here. The
 * copy states the response promise rather than implying instant chat, and the
 * form prefills the signed-in buyer so nobody retypes their details.
 */
export default function SupportPage() {
  const [form, setForm] = useState({ name: "", email: "", orderRef: "", body: "" });
  const [topic, setTopic] = useState<SupportTopic>("order");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseLive()) return;
    let cancelled = false;
    void supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        if (cancelled || !data.user) return;
        const meta = (data.user.user_metadata ?? {}) as { full_name?: string; name?: string; phone?: string };
        setForm((current) => ({
          ...current,
          name: current.name || meta.full_name || meta.name || "",
          email: current.email || data.user?.email || "",
        }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (form.name.trim().length < 2) return setError("Please add your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return setError("Please add a valid email address.");
    if (form.body.trim().length < 10) return setError("Please describe the problem in a sentence or two.");
    setBusy(true);
    try {
      await sendSupportMessage({ ...form, topic });
      track("support_open", { topic });
      setDone(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not send your message.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container max-w-3xl py-8">
      <header>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
          <LifeBuoy className="h-3.5 w-3.5" /> Support
        </span>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">Talk to a human</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Order, delivery, refund or vendor question — send it here and it lands in a queue we work
          every day. We reply to the email you give us, usually within one working day.
        </p>
      </header>

      {done ? (
        <Card className="mt-6 p-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
            <Check className="h-6 w-6" />
          </span>
          <h2 className="mt-3 text-lg font-bold">Message received</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            We&apos;ll reply to <span className="font-semibold text-foreground">{form.email}</span>. If it is
            about a live order or an escrow release that is about to expire, open the dispute from the
            order as well — that pauses the payment clock.
          </p>
          <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
            <Button asChild variant="outline">
              <Link href="/orders">Go to my orders</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/policies/refunds">Read the refund policy</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <ShieldCheck className="h-4 w-4 text-primary" /> Money problem?
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Open the dispute from the order first — that freezes escrow release while we review
                evidence from both sides.
              </p>
              <Link href="/orders" className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">
                Disputes &amp; refunds →
              </Link>
            </Card>
            <Card className="p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <Mail className="h-4 w-4 text-primary" /> Direct email
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                support@baledrop.demo — same queue, useful if you cannot sign in right now.
              </p>
              <Badge variant="outline" className="mt-2">
                Median first reply: under 1 working day
              </Badge>
            </Card>
          </div>

          <Card className="mt-4 p-5">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <MessageSquare className="h-4 w-4 text-primary" /> Send a message
            </h2>
            <form className="mt-4 flex flex-col gap-4" onSubmit={submit} noValidate>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">What is it about?</legend>
                <div className="flex flex-wrap gap-2">
                  {SUPPORT_TOPICS.map((option) => (
                    <label
                      key={option}
                      className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                        topic === option
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input hover:bg-muted"
                      }`}
                    >
                      <input
                        type="radio"
                        name="topic"
                        value={option}
                        checked={topic === option}
                        onChange={() => setTopic(option)}
                        className="sr-only"
                      />
                      {TOPIC_LABELS[option]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="support-name" className="mb-1.5 block text-sm font-semibold">
                    Your name
                  </label>
                  <Input
                    id="support-name"
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Adaeze Okafor"
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label htmlFor="support-email" className="mb-1.5 block text-sm font-semibold">
                    Email we should reply to
                  </label>
                  <Input
                    id="support-email"
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="support-ref" className="mb-1.5 block text-sm font-semibold">
                  Order reference <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="support-ref"
                  value={form.orderRef}
                  onChange={(event) => setForm((current) => ({ ...current, orderRef: event.target.value }))}
                  placeholder="BD-2019 or your booking reference"
                />
              </div>

              <div>
                <label htmlFor="support-body" className="mb-1.5 block text-sm font-semibold">
                  What happened?
                </label>
                <Textarea
                  id="support-body"
                  value={form.body}
                  onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
                  placeholder="Tell us what you ordered, what went wrong, and what you would like us to do."
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </p>
              )}

              <Button type="submit" size="lg" disabled={busy} className="sm:self-start">
                {busy ? (
                  <>
                    <Loader2 className="animate-spin" /> Sending…
                  </>
                ) : (
                  "Send to support"
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Never send card numbers, passwords or one-time codes. We will never ask for them.
              </p>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
