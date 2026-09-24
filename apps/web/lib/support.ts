/**
 * Support messages — client helpers around `support_messages` (migration 0020).
 *
 * RLS does the enforcement (insert-only for guests, author/admin read); this
 * module's job is to make the shapes and failure messages usable in the UI.
 */
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";

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
}

const SELECT_COLUMNS = "id, name, email, topic, body, order_ref, status, created_at, resolved_at";

/**
 * Send a message. Works signed-out (RLS accepts a null `profile_id`), and
 * waits for the profile id only when a session happens to exist so the thread
 * shows up under the buyer's own account.
 */
export async function sendSupportMessage(input: SupportMessageInput): Promise<void> {
  if (!isSupabaseLive()) {
    // Demo mode: no database to write to, but the form should still feel real
    // and the copy below tells the buyer exactly what to expect.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return;
  }

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
  if (error) throw new Error(error.message);
}

/** Admin queue — RLS only returns rows when the caller is an admin. */
export async function listSupportMessages(): Promise<SupportMessage[]> {
  if (!isSupabaseLive()) return [];
  const { data, error } = await supabaseBrowser()
    .from("support_messages")
    .select(SELECT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as SupportMessage[];
}

export async function resolveSupportMessage(id: string): Promise<void> {
  if (!isSupabaseLive()) return;
  const { error } = await supabaseBrowser()
    .from("support_messages")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
