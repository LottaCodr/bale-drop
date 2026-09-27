import { friendlyErrorMessage, functionErrorMessage, type FriendlyErrorOptions } from "@/lib/errors";
import { supabaseBrowser } from "@/lib/supabase";

export async function invokeOperation<T = unknown>(
  functionName: string,
  body: Record<string, unknown>,
  options: FriendlyErrorOptions = { context: "operation" }
): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabaseBrowser().functions.invoke<T>(functionName, { body });
  if (error) {
    const payloadMessage = await functionErrorMessage(error);
    return { data: null, error: friendlyErrorMessage(payloadMessage ?? error, options) };
  }
  return { data: data ?? null, error: null };
}
