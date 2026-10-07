import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { safeNext } from "@/lib/auth/redirect";
import { isSupabaseLive } from "@/lib/config";

/**
 * Session refresh + route guards.
 * Mock mode (no env): everything passes through for demo flows.
 * Live mode:
 *  - protected routes require a session (role checks for /admin + /vendor
 *    happen server-side in the page, where we can read profiles);
 *  - signed-in users are sent away from /login and /signup to where they
 *    were heading, so the back button never shows a stale sign-in form.
 *
 * `/vendor` is deliberately split in two:
 *   - `/vendor`        → the seller workspace. Requires a session.
 *   - `/vendor/<id>`   → the *public* storefront a product card links to.
 * Treating the second as protected sent every anonymous shopper to
 * `/login?next=/vendor/...`, so a discovered shop could never be browsed.
 */
const PROTECTED = ["/checkout", "/orders", "/admin", "/notifications", "/account", "/welcome"];
/** Guarded by exact path only — their sub-paths are public. */
const PROTECTED_EXACT = ["/vendor"];
const GUEST_ONLY = ["/login", "/signup"];

function matches(pathname: string, routes: string[]): boolean {
  return routes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isProtected(pathname: string): boolean {
  return matches(pathname, PROTECTED) || PROTECTED_EXACT.includes(pathname);
}

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!isSupabaseLive() || !url || !anonKey) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates the JWT with Supabase Auth (getSession() would trust the cookie).
  const { data: { user } } = await supabase.auth.getUser();
  const { pathname, search } = request.nextUrl;

  // Redirects must carry any refreshed session cookies or the user is logged out.
  const redirectTo = (target: URL) => {
    const redirect = NextResponse.redirect(target);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (!user && isProtected(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return redirectTo(loginUrl);
  }

  if (user && matches(pathname, GUEST_ONLY)) {
    const target = request.nextUrl.clone();
    const next = safeNext(request.nextUrl.searchParams.get("next"));
    const [nextPath, nextQuery = ""] = next.split("?");
    target.pathname = nextPath;
    target.search = nextQuery ? `?${nextQuery}` : "";
    return redirectTo(target);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)"],
};
