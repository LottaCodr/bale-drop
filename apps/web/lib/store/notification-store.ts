/**
 * Notification store — one cached copy of the inbox for the bell *and* the
 * notifications page.
 *
 * Before this store the header badge and the page each ran their own query, so
 * "Mark all read" left a red dot behind. Server rows remain the source of
 * truth: the store only caches them, and Realtime inserts land here so every
 * surface updates together.
 */
import { create } from "zustand";

export interface Notice {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

export const DEMO_NOTICES: Notice[] = [
  {
    id: "demo-1",
    title: "Escrow protects your next order",
    body: "Your vendor is paid only after delivery confirmation.",
    href: "/#escrow",
    read_at: null,
    created_at: new Date().toISOString(),
  },
  {
    id: "demo-2",
    title: "Launch delivery subsidy active",
    body: "Save on tracked delivery while the launch promo lasts.",
    href: "/",
    read_at: null,
    created_at: new Date().toISOString(),
  },
];

export type NoticeStatus = "idle" | "loading" | "ready" | "error";

export interface NotificationState {
  items: Notice[];
  status: NoticeStatus;
  error: string | null;
  userId: string | null;
  setLoading: (userId: string | null) => void;
  setItems: (items: Notice[], userId: string | null) => void;
  setError: (message: string) => void;
  upsert: (notice: Notice) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  reset: () => void;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  items: [],
  status: "idle",
  error: null,
  userId: null,

  setLoading: (userId) => set({ status: "loading", error: null, userId }),

  setItems: (items, userId) =>
    set({
      items: [...items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
      status: "ready",
      error: null,
      userId,
    }),

  setError: (message) => set({ status: "error", error: message }),

  upsert: (notice) =>
    set((state) =>
      state.items.some((item) => item.id === notice.id)
        ? { items: state.items.map((item) => (item.id === notice.id ? { ...item, ...notice } : item)) }
        : { items: [notice, ...state.items] }
    ),

  markRead: (id) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, read_at: item.read_at ?? new Date().toISOString() } : item
      ),
    })),

  markAllRead: () =>
    set((state) => ({
      items: state.items.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })),
    })),

  reset: () => set({ items: [], status: "idle", error: null, userId: null }),
}));

export const selectNotices = (state: NotificationState): Notice[] => state.items;
export const selectUnreadCount = (state: NotificationState): number =>
  state.items.reduce((count, item) => count + (item.read_at ? 0 : 1), 0);
export const selectNoticeStatus = (state: NotificationState): NoticeStatus => state.status;
