import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";

// Keep the shared client type deliberately ungenerated: Edge functions may run
// before the next `supabase gen types` pass, while all writes still go through
// RPCs and RLS/service-role boundaries in the database.
export type AdminClient = SupabaseClient<any, "public">;

export function adminClient(): AdminClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Supabase service environment is not configured");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export function bearer(req: Request): string | null {
  const value = req.headers.get("authorization");
  if (!value?.toLowerCase().startsWith("bearer ")) return null;
  return value.slice(7).trim() || null;
}

export async function authenticatedUser(req: Request, db: AdminClient) {
  const token = bearer(req);
  if (!token) return { user: null, error: "authentication required" };
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) {
    return { user: null, error: "session expired — sign in again" };
  }
  return { user, error: null };
}

export async function profile(db: AdminClient, userId: string) {
  const { data, error } = await db.from("profiles").select(
    "id, role, full_name, phone, city",
  ).eq("id", userId).maybeSingle();
  if (error) throw error;
  return data as {
    id: string;
    role: string;
    full_name: string | null;
    phone: string | null;
    city: string | null;
  } | null;
}

export function cors(req: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}
