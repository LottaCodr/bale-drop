/**
 * Inbox loading — one function, used by the header bell and the page, so they
 * can never disagree about what is unread.
 */
import { isSupabaseLive } from "./config";
import { supabaseBrowser } from "./supabase";
import { DEMO_NOTICES, useNotificationStore, type Notice } from "./store/notification-store";

const COLUMNS = "id, title, body, href, read_at, created_at";
const LIMIT = 50;

/** Load the signed-in profile's inbox into the store. No-op in demo mode. */
export async function loadNotifications(): Promise<void> {
  const store = useNotificationStore.getState();
  if (!isSupabaseLive()) {
    store.setItems(DEMO_NOTICES, null);
    return;
  }
  store.setLoading(store.userId);
  try {
    const sb = supabaseBrowser();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) {
      useNotificationStore.getState().reset();
      return;
    }
    const { data, error } = await sb
      .from("notifications")
      .select(COLUMNS)
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (error) {
      useNotificationStore.getState().setError(error.message);
      return;
    }
    useNotificationStore.getState().setItems((data ?? []) as Notice[], user.id);
  } catch (err) {
    useNotificationStore.getState().setError(err instanceof Error ? err.message : "Could not load notifications");
  }
}

/** Mark one notification read (optimistic; the server row follows). */
export async function markNotificationRead(id: string): Promise<void> {
  useNotificationStore.getState().markRead(id);
  if (!isSupabaseLive()) return;
  try {
    const sb = supabaseBrowser();
    await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  } catch {
    /* the badge will correct itself on the next load */
  }
}

/** Mark every unread notification read. */
export async function markAllNotificationsRead(): Promise<void> {
  const { userId, markAllRead } = useNotificationStore.getState();
  markAllRead();
  if (!isSupabaseLive() || !userId) return;
  try {
    const sb = supabaseBrowser();
    await sb
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("profile_id", userId)
      .is("read_at", null);
  } catch {
    /* ignore — the UI is already optimistic */
  }
}
