/**
 * Runtime config (isomorphic — safe in server + client components).
 * The app runs against the mock dataset until real Supabase env vars exist,
 * then switches to live data automatically. No code changes, no flags.
 */
export function supabaseUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || url.includes("placeholder")) return null;
  return url;
}

export function isSupabaseLive(): boolean {
  return supabaseUrl() !== null;
}
