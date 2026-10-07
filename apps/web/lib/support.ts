/**
 * Support messages — client helpers around `support_messages` (migration 0020).
 *
 * RLS does the enforcement (insert-only for guests, author/admin read); this
 * module's job is to make the shapes and failure messages usable in the UI.
 */
import { isSupabaseLive } from "@/lib/config";
import { friendlyErrorMessage } from "@/lib/errors";
import { invokeOperation } from "@/lib/operations";
import { supabaseBrowser } from "@/lib/supabase";

export const SUPPORT_TOPICS = ["order", "delivery", "refund", "vendor", "account", "general"] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const TOPIC_LABELS: Record<SupportTopic, string> = {
  order: "An order",
  delivery: "Delivery or tracking",
  refund: "Refund or dispute",
  vendor: "Selling / vendor account",
  account: "Account or login",
  general: "Something else",
};

export interface SupportMessageInput {
  name: string;
  email: string;
  topic: SupportTopic;
  body: string;
  orderRef?: string;
}

export interface SupportMessage {
  id: string;
  name: string;
  email: string;
  topic: SupportTopic;
  body: string;
  order_ref: string | null;
  status: "open" | "resolved";
  created_at: string;
  resolved_at: string | null;
  /** Migration 0028: when the team first answered, and the last activity. */
  first_response_at?: string | null;
  last_activity_at?: string | null;
}

/** One turn of a thread (migration 0028). Immutable — update/delete are revoked. */
export interface SupportReply {
  id: string;
  message_id: string;
  author_profile_id: string | null;
  from_team: boolean;
  body: string;
  created_at: string;
}

/**
 * A thread as the *buyer* sees it: their own messages plus every reply.
 * RLS returns only the caller's own rows, so this needs no admin check.
 */
export interface SupportThread extends SupportMessage {
  replies: SupportReply[];
}

const SELECT_COLUMNS =
  "id, name, email, topic, body, order_ref, status, created_at, resolved_at, first_response_at, last_activity_at";

/**
 * Send a message. Works signed-out (RLS accepts a null `profile_id`), and
 * waits for the profile id only when a session happens to exist so the thread
 * shows up under the buyer's own account.
 */
export async function sendSupportMessage(input: SupportMessageInput): Promise<void> {
  if (!isSupabaseLive()) throw new Error("Support is temporarily unavailable. Please try again later.");

  const sb = supabaseBrowser();
  const { data } = await sb.auth.getUser();
  const { error } = await sb.from("support_messages").insert({
    profile_id: data.user?.id ?? null,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    topic: input.topic,
    body: input.body.trim(),
    order_ref: input.orderRef?.trim() || null,
  });
  if (error) throw new Error(friendlyErrorMessage(error, { context: "support" }));
}

/** Admin queue — RLS only returns rows when the caller is an admin. */
export async function listSupportMessages(): Promise<SupportMessage[]> {
  if (!isSupabaseLive()) return [];
  const { data, error } = await supabaseBrowser()
    .from("support_messages")
    .select(SELECT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(friendlyErrorMessage(error, { context: "admin" }));
  return (data ?? []) as SupportMessage[];
}

export async function resolveSupportMessage(id: string): Promise<void> {
  if (!isSupabaseLive()) return;
  const { error } = await supabaseBrowser()
    .from("support_messages")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(friendlyErrorMessage(error, { context: "admin" }));
}

/* -------------------------------------------------------------------------- */
/* Threads (migration 0028)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The signed-in buyer's own threads with their replies.
 *
 * Before this, a buyer who wrote to support had no way to read the answer
 * except their inbox — and if the reply was only stored, they had no way at all.
 */
export async function listMyThreads(): Promise<SupportThread[]> {
  if (!isSupabaseLive()) return [];
  const sb = supabaseBrowser();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return [];

  const { data: messages, error } = await sb
    .from("support_messages")
    .select(SELECT_COLUMNS)
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(friendlyErrorMessage(error, { context: "support" }));
  const rows = (messages ?? []) as SupportMessage[];
  if (rows.length === 0) return [];

  const { data: replies, error: repliesError } = await sb
    .from("support_replies")
    .select("id, message_id, author_profile_id, from_team, body, created_at")
    .in("message_id", rows.map((row) => row.id))
    .order("created_at", { ascending: true });
  if (repliesError) throw new Error(friendlyErrorMessage(repliesError, { context: "support" }));

  const byMessage = new Map<string, SupportReply[]>();
  for (const reply of (replies ?? []) as SupportReply[]) {
    const bucket = byMessage.get(reply.message_id) ?? [];
    bucket.push(reply);
    byMessage.set(reply.message_id, bucket);
  }
  return rows.map((row) => ({ ...row, replies: byMessage.get(row.id) ?? [] }));
}

/**
 * Add to your own thread through the Edge Function. Going through
 * `support-reply` (rather than a direct insert) means the same rate limit,
 * notification and email path applies to a buyer's follow-up as to ours.
 */
export async function replyToThread(messageId: string, body: string): Promise<void> {
  if (!isSupabaseLive()) throw new Error("Support is temporarily unavailable. Please try again later.");
  const { error } = await invokeOperation("support-reply", {
    message_id: messageId,
    body,
    from_team: false,
  }, { context: "support" });
  if (error) throw new Error(error);
}

/** Admin reply. `resolve` also closes the thread in the same call. */
export async function replyAsTeam(messageId: string, body: string, resolve: boolean): Promise<void> {
  if (!isSupabaseLive()) throw new Error("Support is temporarily unavailable. Please try again later.");
  const { error } = await invokeOperation("support-reply", {
    message_id: messageId,
    body,
    from_team: true,
    resolve,
  }, { context: "admin" });
  if (error) throw new Error(error);
}

/**
 * The admin workload view (`public.support_queue`, migration 0028). Falls back
 * to the plain message list if the view has not been created yet, so an
 * unmigrated database still shows a queue instead of an error.
 */
export interface SupportQueueItem extends SupportMessage {
  age_seconds: number;
  first_response_seconds: number | null;
  reply_count: number;
  team_reply_count: number;
}

export async function listSupportQueue(): Promise<SupportQueueItem[]> {
  if (!isSupabaseLive()) return [];
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("support_queue" as never)
    .select("*" as never)
    .order("last_activity_at" as never, { ascending: false })
    .limit(100);
  if (error) {
    // 42P01 = undefined_table (view not migrated yet).
    if (error.code === "42P01") {
      return (await listSupportMessages()).map((message) => ({
        ...message,
        age_seconds: Math.max(0, Math.round((Date.now() - Date.parse(message.created_at)) / 1000)),
        first_response_seconds: null,
        reply_count: 0,
        team_reply_count: 0,
      }));
    }
    throw new Error(friendlyErrorMessage(error, { context: "admin" }));
  }
  return (data ?? []) as SupportQueueItem[];
}

/** Replies for a set of threads — one query, not one per row. */
export async function listRepliesFor(messageIds: string[]): Promise<SupportReply[]> {
  if (!isSupabaseLive() || messageIds.length === 0) return [];
  const { data, error } = await supabaseBrowser()
    .from("support_replies")
    .select("id, message_id, author_profile_id, from_team, body, created_at")
    .in("message_id", messageIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(friendlyErrorMessage(error, { context: "admin" }));
  return (data ?? []) as SupportReply[];
}
