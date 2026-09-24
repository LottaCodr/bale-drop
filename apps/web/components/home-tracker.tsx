"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

/** Fires the `view_home` funnel event once per landing. Renders nothing. */
export function HomeTracker() {
  useEffect(() => {
    track("view_home", { source: "storefront" });
  }, []);
  return null;
}
