/**
 * Post-auth redirect helpers (isomorphic, dependency-free → unit tested).
 *
 * Every `?next=` value that reaches us is attacker-controllable, so it is only
 * honoured when it is a same-origin *path*. Anything else falls back to "/".
 */

/** Paths that make no sense as a post-login destination. */
const AUTH_PAGES = ["/login", "/signup", "/auth/callback", "/auth/confirm"];

export function safeNext(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  let value = raw.trim();
  // Decode once if the caller double-encoded (e.g. "%2Forders").
  if (value.startsWith("%2F") || value.startsWith("%2f")) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return fallback;
    }
  }
  // Must be a rooted path, not protocol-relative ("//evil.com") or a
  // backslash variant browsers normalise to one ("/\\evil.com").
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // No control characters / whitespace tricks.
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  const pathname = value.split(/[?#]/)[0];
  if (AUTH_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`))) return fallback;
  return value;
}

export type AppRole = "buyer" | "vendor" | "admin";

/**
 * Where a user lands after signing in. An explicit `next` always wins (they
 * were trying to reach something); otherwise each role gets its home.
 */
export function landingFor(role: string | null | undefined, next: string | null | undefined): string {
  const explicit = safeNext(next, "");
  if (explicit && explicit !== "/") return explicit;
  if (role === "admin") return "/admin";
  if (role === "vendor") return "/vendor";
  return "/";
}

export interface OnboardingState {
  /** `user_metadata.onboarded` — set once the welcome step is completed or skipped. */
  onboarded?: unknown;
  phone?: string | null;
  city?: string | null;
}

/**
 * A user sees the one-time welcome step until they complete or skip it — but
 * never when their profile already has the essentials (e.g. seeded demo users
 * or anyone who filled phone + city elsewhere).
 */
export function needsOnboarding(state: OnboardingState): boolean {
  if (state.onboarded === true || state.onboarded === "true") return false;
  return !state.phone || !state.city;
}

/** Build `/welcome?next=…` (or skip it) for a freshly authenticated user. */
export function postAuthPath(role: string | null | undefined, next: string | null | undefined, state: OnboardingState): string {
  const destination = landingFor(role, next);
  if (!needsOnboarding(state)) return destination;
  return destination === "/" ? "/welcome" : `/welcome?next=${encodeURIComponent(destination)}`;
}
