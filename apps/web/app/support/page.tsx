"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, LifeBuoy, Loader2, MessageSquare, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ServiceUnavailable } from "@/components/service-unavailable";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import {
  listMyThreads,
  replyToThread,
  sendSupportMessage,
  SUPPORT_TOPICS,
  TOPIC_LABELS,
  type SupportThread,
  type SupportTopic,
} from "@/lib/support";
import { friendlyErrorMessage } from "@/lib/errors";
import { track } from "@/lib/analytics";

/**
 * Support — the human door.
 *
 * Disputes have an automated path (Orders → Disputes & refunds); everything
 * else (delivery failed twice, payout question, data request) lands here. The
 * copy states the response promise rather than implying instant chat, and the
 * form prefills the signed-in buyer so nobody retypes their details.
 *
 * Migration 0028 turned a one-shot form into a thread: the buyer can read the
 * answer here and add to it, and answering reopens a thread they closed.
 */
export default function SupportPage() {
  const [form, setForm] = useState({ name: "", email: "", orderRef: "", body: "" });
  const [topic, setTopic] = useState<SupportTopic>("order");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyBusy, setReplyBusy] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    if (!isSupabaseLive()) return;
    setThreadsLoading(true);
    try {
      setThreads(await listMyThreads());
    } catch {
      // A thread list that cannot load must not break the form that still can.
      setThreads([]);
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => { void loadThreads(); }, [loadThreads]);

  async function sendReply(messageId: string) {
    const body = (replyDrafts[messageId] ?? "").trim();
    if (body.length < 2) { setError("Write a short reply before sending."); return; }
    setError(null);
    setReplyBusy(messageId);
    try {
      await replyToThread(messageId, body);
      setReplyDrafts((current) => ({ ...current, [messageId]: "" }));
      await loadThreads();
    } catch (replyError) {
      setError(friendlyErrorMessage(replyError, { context: "support" }));
    } finally {
      setReplyBusy(null);
    }
  }

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
      void loadThreads();
    } catch (submitError) {
      setError(friendlyErrorMessage(submitError, { context: "support" }));
    } finally {
      setBusy(false);
    }
  }

  if (!isSupabaseLive()) return <ServiceUnavailable title="Support is temporarily unavailable" description="We cannot receive messages right now. Please try again later." />;

  return (
    <div className="container max-w-3xl py-8">
      <header>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
          <LifeBuoy className="h-3.5 w-3.5" /> Support
        </span>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">Talk to a human</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Order, delivery, refund or vendor question? Send us a message using the form below.
        </p>
      </header>

      {done ? (
        <Card className="mt-6 p-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
            <Check className="h-6 w-6" />
          </span>
          <h2 className="mt-3 text-lg font-bold">Message received</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            We&apos;ll reply to <span className="font-semibold text-foreground">{form.email}</span>. For an urgent order issue, open a dispute from the order as well.
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
          {/* The buyer's own threads. Without this a message was fire-and-forget:
              the answer existed in the database and nowhere the buyer could see. */}
          {threads.length > 0 && (
            <section className="mt-6" aria-label="Your support threads">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Your messages</h2>
                <Button variant="ghost" size="sm" onClick={() => void loadThreads()} disabled={threadsLoading}>
                  {threadsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
                </Button>
              </div>
              <div className="mt-3 flex flex-col gap-3">
                {threads.map((thread) => (
                  <Card key={thread.id} className="overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-4 py-2.5">
                      <p className="text-sm font-bold">
                        {TOPIC_LABELS[thread.topic] ?? thread.topic}
                        {thread.order_ref && <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{thread.order_ref}</span>}
                      </p>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {new Date(thread.created_at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {thread.status === "resolved"
                          ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">Resolved</span>
                          : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Open</span>}
                      </span>
                    </div>
                    <div className="flex flex-col gap-3 p-4">
                      <p className="whitespace-pre-line text-sm">{thread.body}</p>

                      {thread.replies.length > 0 && (
                        <ol className="flex flex-col gap-2 border-l-2 border-dashed pl-3">
                          {thread.replies.map((reply) => (
                            <li key={reply.id} className={reply.from_team ? "rounded-xl bg-primary/5 px-3 py-2" : "rounded-xl bg-muted/60 px-3 py-2"}>
                              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                                {reply.from_team ? "Bale Drop support" : "You"} •{" "}
                                {new Date(reply.created_at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                              </p>
                              <p className="mt-1 whitespace-pre-line text-sm">{reply.body}</p>
                            </li>
                          ))}
                        </ol>
                      )}

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Textarea
                          aria-label={`Reply to your message about ${TOPIC_LABELS[thread.topic] ?? thread.topic}`}
                          className="flex-1"
                          placeholder={thread.status === "resolved" ? "Add to this thread — it reopens if we need to answer again" : "Add more detail for our team"}
                          value={replyDrafts[thread.id] ?? ""}
                          onChange={(event) => setReplyDrafts((current) => ({ ...current, [thread.id]: event.target.value }))}
                        />
                        <Button
                          className="sm:self-end"
                          onClick={() => sendReply(thread.id)}
                          disabled={replyBusy === thread.id}
                        >
                          {replyBusy === thread.id ? <Loader2 className="animate-spin" /> : <Send className="h-4 w-4" />} Send reply
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}

          <div className="mt-6">
            <Card className="p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <ShieldCheck className="h-4 w-4 text-primary" /> Money problem?
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Open a dispute from the order first. This pauses escrow release while we review
                evidence from both sides.
              </p>
              <Link href="/orders" className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">
                Disputes &amp; refunds →
              </Link>
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
