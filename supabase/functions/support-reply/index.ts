/**
 * Support replies — the admin side of a support thread (migration 0028).
 *
 * Before this, the only admin action was "mark resolved" and the only reply
 * channel was a `mailto:` link, so nothing was recorded and first-response time
 * could not be measured. A reply written here is stored, notifies the buyer
 * in-app (trigger), and goes out over email/SMS through `_shared/notify.ts`.
 *
 * A buyer may also add to their own thread; that path reopens a resolved
 * message via the same trigger.
 */
import { adminClient, authenticatedUser, cors, json, profile } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { logError, logInfo } from "../_shared/monitor.ts";
import { deliver } from "../_shared/notify.ts";

type Body = {
  message_id?: string;
  body?: string;
  resolve?: boolean;
  from_team?: boolean;
};

type MessageRow = {
  id: string;
  profile_id: string | null;
  name: string;
  email: string;
  topic: string;
  order_ref: string | null;
  status: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "method not allowed" }, 405);
  }

  const db = adminClient();
  const { user, error: authError } = await authenticatedUser(req, db);
  if (!user) return json(req, { error: authError }, 401);

  const limited = await enforceRateLimit(req, db, "support-reply", user.id, 60, 60, cors(req));
  if (limited) return limited;

  try {
    const body = await req.json() as Body;
    const text = body.body?.trim() ?? "";
    if (!body.message_id) return json(req, { error: "message_id is required" }, 400);
    if (text.length < 2 || text.length > 4000) {
      return json(req, { error: "a reply must be between 2 and 4000 characters" }, 400);
    }

    const { data: message, error: messageError } = await db.from("support_messages")
      .select("id, profile_id, name, email, topic, order_ref, status")
      .eq("id", body.message_id)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!message) return json(req, { error: "support thread not found" }, 404);
    const thread = message as MessageRow;

    const actor = await profile(db, user.id);
    const fromTeam = body.from_team !== false && actor?.role === "admin";
    // A non-admin may only reply to their own thread.
    if (!fromTeam && thread.profile_id !== user.id) {
      return json(req, { error: "you can only reply to your own message" }, 403);
    }

    const { data: reply, error: insertError } = await db.from("support_replies")
      .insert({
        message_id: thread.id,
        author_profile_id: user.id,
        from_team: fromTeam,
        body: text,
      })
      .select("id, created_at")
      .single();
    if (insertError) throw insertError;

    if (body.resolve === true && fromTeam) {
      const { error: resolveError } = await db.from("support_messages")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", thread.id);
      if (resolveError) throw resolveError;
    }

    // Out-of-app copy. A guest thread has no profile, so fall back to the email
    // address they left on the form.
    await deliver(
      db,
      { profileId: thread.profile_id, email: thread.email },
      {
        title: fromTeam ? "Bale Drop support replied" : "New message on your support thread",
        body: text.slice(0, 600),
        href: "/support",
        email: {
          subject: `Re: your Bale Drop message${thread.order_ref ? ` (${thread.order_ref})` : ""}`,
          preheader: `${thread.topic} · ${thread.name}`,
          details: [
            ["Topic", thread.topic],
            ...(thread.order_ref ? [["Order reference", thread.order_ref] as [string, string]] : []),
          ],
          ctaLabel: "Open the thread",
        },
      },
    );

    logInfo("support-reply", "reply stored", {
      message_id: thread.id,
      from_team: fromTeam,
      resolved: body.resolve === true && fromTeam,
    });

    return json(req, { ok: true, reply });
  } catch (error) {
    logError("support-reply", error);
    return json(req, {
      error: error instanceof Error ? error.message : "Could not send that reply",
    }, 400);
  }
});
