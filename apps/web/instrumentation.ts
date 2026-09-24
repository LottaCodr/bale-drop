/**
 * Next.js instrumentation hook — runs once per server process at boot.
 *
 * Its job is to make the demo/live switch loud. The storefront silently falling
 * back to `lib/mock.ts` is a feature while prototyping and a **critical launch
 * blocker** in production: real buyers would browse fabricated bales and their
 * payments would fail against a database that does not exist. This warns on
 * every boot with `NODE_ENV=production` and no Supabase config, so the problem
 * is visible in the deploy log instead of in a support ticket.
 */
export async function register(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const configured = Boolean(url && anon && !url.includes("placeholder"));

  if (configured) {
    console.info("[bale-drop] Supabase configured — serving live data.");
    return;
  }

  const message =
    "[bale-drop] No Supabase configuration found: the app is serving the DEMO dataset (lib/mock.ts). " +
    "Checkout, slot claims, orders and admin actions cannot move real money in this mode. " +
    "See docs/SUPABASE-SETUP.md.";

  if (process.env.NODE_ENV === "production") {
    // Loud, but not fatal: the PWA still serves the prototype, and /api/health
    // reports `degraded` so a deploy check can refuse to promote it.
    console.error(`[bale-drop] LAUNCH BLOCKER — ${message}`);
  } else {
    console.info(message);
  }
}
