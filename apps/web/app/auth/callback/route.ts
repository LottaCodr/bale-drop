import type { NextRequest } from "next/server";
import { handleAuthCallback } from "@/lib/auth/callback-handler";

/** OAuth, email-confirmation and password-recovery links land here. */
export async function GET(request: NextRequest) {
  return handleAuthCallback(request);
}
