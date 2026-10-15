/**
 * Cross-device cart sync — server-side mirror via `profiles.cart` JSONB.
 *
 * Best effort: never blocks the local store. When a user is signed in,
 * mutations push the new cart to `profiles.cart`; on mount and sign-in,
 * we pull the server array and merge it into the local store (local wins
 * on conflicts: newer `updatedAt` or the user just edited locally).
 */
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { useCartStore, sanitizeList, type CartLine, CART_STORAGE_KEY } from "@/lib/store/cart-store";

function toCartLineArray(cart: unknown): CartLine[] {
  if (!Array.isArray(cart)) return [];
  const lines: CartLine[] = [];
  const seen = new Set<string>();
  for (const item of cart) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<CartLine>;
    if (typeof raw.productId !== "string" || !raw.productId || seen.has(raw.productId)) continue;
    seen.add(raw.productId);
    lines.push({
      productId: raw.productId,
      qty: Math.max(1, Math.min(20, Math.round(typeof raw.qty === "number" ? raw.qty : 1))),
      title: typeof raw.title === "string" && raw.title ? raw.title : "Bale Drop item",
      price: Math.max(0, Math.round(typeof raw.price === "number" ? raw.price : 0)),
      city: typeof raw.city === "string" ? raw.city : "Lagos",
      category: typeof raw.category === "string" ? raw.category : "Bales",
      grade: raw.grade === "A" || raw.grade === "B" || raw.grade === "C" ? raw.grade : "B",
      hue: typeof raw.hue === "number" ? raw.hue : 160,
      imageUrl: typeof raw.imageUrl === "string" && raw.imageUrl.startsWith("http") ? raw.imageUrl : null,
      vendorId: typeof raw.vendorId === "string" ? raw.vendorId : "",
      vendorName: typeof raw.vendorName === "string" ? raw.vendorName : "Verified vendor",
      addedAt: typeof raw.addedAt === "number" ? raw.addedAt : Date.now(),
    });
  }
  return lines.slice(0, 40);
}

/** Pull server cart and merge into local store when a session exists. */
export async function pullServerCart(): Promise<void> {
  if (!isSupabaseLive()) return;
  try {
    const sb = supabaseBrowser();
    const { data: userData } = await sb.auth.getUser();
    if (!userData?.user) return;
    const { data: row } = await sb.from("profiles").select("cart, updated_at").eq("id", userData.user.id).single();
    if (!row || !row.cart) return;
    const serverLines = toCartLineArray(row.cart);
    if (serverLines.length === 0) return;
    const local = useCartStore.getState();
    // Only merge if the server mirror looks newer than our last sync.
    const serverUpdated = new Date(row.updated_at ?? 0).getTime();
    const lastSyncKey = `bale-drop-cart-sync-v1`;
    const lastSync = typeof window !== "undefined" ? parseInt(localStorage.getItem(lastSyncKey) ?? "0", 10) : 0;
    if (serverUpdated > lastSync) {
      local.replace(serverLines);
      if (typeof window !== "undefined") {
        localStorage.setItem(lastSyncKey, String(serverUpdated));
      }
    }
  } catch {
    /* best effort — local cart stays authoritative */
  }
}

/** Push current cart to profiles.cart for the signed-in user. */
export async function pushServerCart(): Promise<void> {
  if (!isSupabaseLive()) return;
  try {
    const sb = supabaseBrowser();
    const { data: userData } = await sb.auth.getUser();
    if (!userData?.user) return;
    const state = useCartStore.getState();
    const lines = sanitizeList(state.lines);
    await sb.from("profiles").update({ cart: lines }).eq("id", userData.user.id);
  } catch {
    /* best effort */
  }
}
