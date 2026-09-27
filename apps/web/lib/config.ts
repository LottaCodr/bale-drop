/**
 * Runtime config (isomorphic — safe in server + client components).
 * Commerce features are available only when both public Supabase settings
 * are configured. An unconfigured site never serves sample inventory.
 */
export function supabaseUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || url.includes("placeholder")) return null;
  return url;
}

export function isSupabaseLive(): boolean {
  return supabaseUrl() !== null && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.includes("YOUR_");
}
