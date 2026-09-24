/**
 * Shared Supabase layer — single source of truth for every app
 * (web, mobile, admin). Product code imports clients, queries and domain
 * models from `@bale-drop/database` and nowhere else.
 *
 * RULE: browser/server clients use the ANON key (RLS enforced).
 * The SERVICE_ROLE key is ONLY allowed inside Edge Functions.
 */
import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { Database, DbClient } from "./types";

function publicEnv() {
  // Placeholder fallback keeps the UI prototype running before Supabase is wired.
  // Real requests will fail closed until env vars are set — RLS still enforced.
  return {
    url:
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      process.env.EXPO_PUBLIC_SUPABASE_URL ??
      "https://placeholder.supabase.co",
    anonKey:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      "placeholder-anon-key",
  };
}

let browserClient: DbClient | null = null;

/** Client-component / React Native browser client (singleton). */
export function supabaseBrowser(): DbClient {
  if (browserClient) return browserClient;
  const { url, anonKey } = publicEnv();
  browserClient = createBrowserClient<Database>(url, anonKey);
  return browserClient;
}

interface CookieStore {
  getAll: () => { name: string; value: string }[];
  set: (cookie: { name: string; value: string; [k: string]: unknown }) => void;
}

interface CookieToSet {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

/** Next.js App Router server client — pass `next/headers` cookies. */
export function supabaseServer(cookieStore: CookieStore): DbClient {
  const { url, anonKey } = publicEnv();
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet: CookieToSet[]) =>
        cookiesToSet.forEach((c) => cookieStore.set({ name: c.name, value: c.value, ...(c.options ?? {}) })),
    },
  });
}

/**
 * Edge Function admin client (SERVICE_ROLE, bypasses RLS).
 * ONLY import this in `supabase/functions/*`. Never in app code.
 */
export function supabaseAdmin(): DbClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

export type { Database, DbClient } from "./types";
export * from "./domain";
export * from "./queries";
export * from "./search";
