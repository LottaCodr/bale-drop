/** Warn operators if backend configuration is missing. Public features fail closed. */
export async function register(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const configured = Boolean(url && anon && !url.includes("placeholder"));

  if (configured) {
    console.info("[bale-drop] Supabase configured — serving live data.");
    return;
  }

  const message =
    "[bale-drop] No Supabase configuration found: commerce and account features are unavailable. " +
    "No sample catalog or simulated transactions are served. " +
    "See docs/SUPABASE-SETUP.md.";

  if (process.env.NODE_ENV === "production") {
    // Health reports degraded so deployment checks can refuse promotion.
    console.error(`[bale-drop] LAUNCH BLOCKER — ${message}`);
  } else {
    console.info(message);
  }
}
