import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { postAuthPath, safeNext } from "./redirect";

/**
 * Shared handler for /auth/callback and /auth/confirm.
 *
 * Supports every link Supabase can send:
 *  - PKCE `?code=` (OAuth, and email links using {{ .ConfirmationURL }});
 *  - `?token_hash=&type=` (email templates using {{ .TokenHash }} — works
 *    even when the link is opened in a different browser than the one that
 *    signed up, which PKCE cannot);
 *  - `?error=&error_description=` (expired/denied links, OAuth cancellation).
 *
 * Failures redirect to a page that explains what happened instead of
 * silently dropping the user on the homepage signed-out.
 */
const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

interface CookieToSet {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

export async function handleAuthCallback(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type");
  const type = OTP_TYPES.includes(rawType as EmailOtpType) ? (rawType as EmailOtpType) : null;
  const providerError = url.searchParams.get("error_code") ?? url.searchParams.get("error");
  const isRecovery = type === "recovery" || safeNext(url.searchParams.get("next")).startsWith("/reset-password");
  const next = isRecovery ? "/reset-password" : safeNext(url.searchParams.get("next"));

  const fail = (reason: string) => {
    const target = new URL(isRecovery ? "/reset-password" : "/login", request.url);
    target.searchParams.set("error", reason);
    if (!isRecovery && next !== "/") target.searchParams.set("next", next);
    return NextResponse.redirect(target);
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey || supabaseUrl.includes("placeholder")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (providerError) {
    // `access_denied` without an error_code = the user backed out of Google.
    return fail(providerError === "access_denied" && !url.searchParams.get("error_code") ? "cancelled" : "link_invalid");
  }
  if (!code && !(tokenHash && type)) return fail("link_invalid");

  const pendingCookies: CookieToSet[] = [];
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
          pendingCookies.push(cookie);
        }
      },
    },
  });

  const { data, error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ token_hash: tokenHash as string, type: type as EmailOtpType });

  if (error || !data.user) {
    // A confirmation link opened in another browser can't complete PKCE, but
    // the email *is* confirmed — tell them to sign in rather than "error".
    if (!isRecovery && error?.code === "bad_code_verifier") {
      const target = new URL("/login", request.url);
      target.searchParams.set("confirmed", "1");
      return NextResponse.redirect(target);
    }
    return fail("link_invalid");
  }

  let destination = next;
  const nextPath = next.split("?")[0];
  if (!isRecovery && nextPath !== "/welcome") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, phone, city")
      .eq("id", data.user.id)
      .maybeSingle();
    destination = postAuthPath(profile?.role as string | undefined, next, {
      onboarded: data.user.user_metadata?.onboarded,
      phone: profile?.phone as string | null | undefined,
      city: profile?.city as string | null | undefined,
    });
  }

  const response = NextResponse.redirect(new URL(destination, request.url));
  for (const { name, value, options } of pendingCookies) response.cookies.set(name, value, options);
  // Never let a CDN cache a response that sets session cookies.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
