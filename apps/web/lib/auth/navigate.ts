/**
 * Navigate with a full page load after an auth state change (sign in/out,
 * signup, onboarding, password reset).
 *
 * A soft `router.replace()` + `router.refresh()` can reuse client router
 * state captured while the user was signed out (e.g. a middleware redirect
 * from /orders → /login) and land them on the wrong page — reproduced in e2e
 * when signing in twice in one tab. A document navigation guarantees the
 * middleware, server components, realtime channels and store sync all start
 * fresh under the new identity.
 */
export function hardNavigate(path: string): void {
  window.location.assign(path);
}
