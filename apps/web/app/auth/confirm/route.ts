import type { NextRequest } from "next/server";
import { handleAuthCallback } from "@/lib/auth/callback-handler";

/**
 * Alias matching Supabase's SSR docs: email templates of the form
 * `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/welcome`
 * work without changes. Same logic as /auth/callback.
 */
export async function GET(request: NextRequest) {
  return handleAuthCallback(request);
}
