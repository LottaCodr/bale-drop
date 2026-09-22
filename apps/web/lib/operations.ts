import { supabaseBrowser } from "@/lib/supabase";

export async function invokeOperation<T = unknown>(functionName: string, body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabaseBrowser().functions.invoke<T>(functionName, { body });
  if (error) return { data: null, error: error.message || "Operation failed" };
  return { data: data ?? null, error: null };
}
