"use client";

import { useEffect, useState } from "react";

/** Countdown for "resend email" buttons (Supabase rate-limits auth emails). */
export function useCooldown(): [number, (seconds: number) => void] {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  return [remaining, setRemaining];
}
