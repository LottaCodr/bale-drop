/**
 * Server session helper (imports next/headers — server components only).
 * Returns the signed-in user's id + role, or null in mock mode / signed out.
 */
import { cookies } from "next/headers";
import { supabaseServer } from "@bale-drop/database";
import { isSupabaseLive } from "./config";

export interface SessionProfile {
  userId: string;
  email: string | undefined;
  role: string;
  fullName: string | null;
}

export async function getSessionProfile(): Promise<SessionProfile | null> {
  if (!isSupabaseLive()) return null;
  const store = await cookies();
  const sb = supabaseServer({ getAll: () => store.getAll(), set: () => undefined });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();
  return {
    userId: user.id,
    email: user.email,
    role: profile?.role ?? "buyer",
    fullName: profile?.full_name ?? null,
  };
}
