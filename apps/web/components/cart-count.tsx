"use client";

import { useEffect, useState } from "react";
import { isSupabaseLive } from "@/lib/config";
import { readCart } from "@/lib/cart";

export function CartCount() {
  const [count, setCount] = useState(isSupabaseLive() ? 0 : 2);
  useEffect(() => {
    const update = () => setCount(isSupabaseLive() ? readCart().reduce((sum, item) => sum + item.qty, 0) : 2);
    update();
    window.addEventListener("bale-drop-cart-updated", update);
    return () => window.removeEventListener("bale-drop-cart-updated", update);
  }, []);
  if (count === 0) return null;
  return <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">{count > 99 ? "99+" : count}</span>;
}
