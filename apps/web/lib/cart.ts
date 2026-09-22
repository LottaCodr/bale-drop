export interface CartItem {
  productId: string;
  qty: number;
}

export const CART_STORAGE_KEY = "bale-drop-cart";

export function readCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is CartItem => Boolean(item && typeof item === "object" && "productId" in item && typeof item.productId === "string" && typeof (item as CartItem).qty === "number"))
      .map((item) => ({ productId: item.productId, qty: Math.max(1, Math.min(20, Math.round(item.qty))) }));
  } catch {
    return [];
  }
}

export function writeCart(items: CartItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("bale-drop-cart-updated"));
}

export function addToCart(productId: string, qty = 1): CartItem[] {
  const items = readCart();
  const existing = items.find((item) => item.productId === productId);
  if (existing) existing.qty = Math.min(20, existing.qty + qty);
  else items.push({ productId, qty: Math.max(1, Math.min(20, qty)) });
  writeCart(items);
  return items;
}

export function removeFromCart(productId: string): CartItem[] {
  const items = readCart().filter((item) => item.productId !== productId);
  writeCart(items);
  return items;
}

export function clearCart() {
  writeCart([]);
}
