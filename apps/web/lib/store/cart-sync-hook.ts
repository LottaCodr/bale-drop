"use client";

import { useEffect, useRef } from "react";
import { useCartStore } from "@/lib/store/cart-store";
import { pullServerCart, pushServerCart } from "@/lib/cart-sync-server";

/** Best-effort server sync: pull on mount, push on mutation (debounced). */
export function useCartServerSync() {
  const didPull = useRef(false);

  useEffect(() => {
    if (didPull.current) return;
    didPull.current = true;
    pullServerCart();
  }, []);

  // Subscribe to store changes and push (debounced 800ms).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useCartStore.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        pushServerCart();
        timer = null;
      }, 800);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
