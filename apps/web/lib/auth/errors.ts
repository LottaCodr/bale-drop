/**
 * Translate Supabase Auth errors into copy a shopper can act on.
 *
 * Supabase returns stable machine codes on `error.code` (auth-js ≥ 2.43);
 * older servers only send `message`, so both are matched. Credential errors
 * stay deliberately vague (never reveal whether an email is registered).
 */

export type AuthErrorKind =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "user_already_exists"
  | "weak_password"
  | "rate_limited"
  | "email_rate_limited"
  | "provider_disabled"
  | "same_password"
  | "reauthentication_needed"
  | "session_missing"
  | "link_invalid"
  | "signup_disabled"
  | "invalid_email"
  | "network"
  | "cancelled"
  | "unknown";

export interface FriendlyAuthError {
  kind: AuthErrorKind;
  message: string;
}

interface AuthLikeError {
  code?: string | null;
  message?: string | null;
  name?: string | null;
  status?: number | null;
}

const MESSAGES: Record<AuthErrorKind, string> = {
  invalid_credentials: "That email and password don't match. Check for typos, or reset your password.",
  email_not_confirmed: "Confirm your email first — we sent you a link when you signed up.",
  user_already_exists: "An account with this email already exists. Sign in instead, or reset your password.",
  weak_password: "Choose a stronger password — at least 8 characters, ideally a short phrase.",
  rate_limited: "Too many attempts. Wait a minute, then try again.",
  email_rate_limited: "We've sent a few emails already. Wait a minute before asking for another.",
  provider_disabled: "That sign-in option isn't enabled yet. Use email and password instead.",
  same_password: "Your new password must be different from the old one.",
  reauthentication_needed: "For security, sign in again before changing your password.",
  session_missing: "Your session expired. Request a new link and try again.",
  link_invalid: "That link is invalid or has expired. Request a new one below.",
  signup_disabled: "New sign-ups are paused right now. Please try again later.",
  invalid_email: "Enter a valid email address, like you@example.com.",
  cancelled: "Sign-in was cancelled. Choose a sign-in option to continue.",
  network: "Can't reach Bale Drop right now. Check your connection and try again.",
  unknown: "Something went wrong. Please try again.",
};

const CODE_MAP: Record<string, AuthErrorKind> = {
  invalid_credentials: "invalid_credentials",
  invalid_grant: "invalid_credentials",
  email_not_confirmed: "email_not_confirmed",
  phone_not_confirmed: "email_not_confirmed",
  user_already_exists: "user_already_exists",
  email_exists: "user_already_exists",
  weak_password: "weak_password",
  over_request_rate_limit: "rate_limited",
  over_email_send_rate_limit: "email_rate_limited",
  over_sms_send_rate_limit: "email_rate_limited",
  provider_disabled: "provider_disabled",
  oauth_provider_not_supported: "provider_disabled",
  email_provider_disabled: "provider_disabled",
  same_password: "same_password",
  reauthentication_needed: "reauthentication_needed",
  session_not_found: "session_missing",
  session_expired: "session_missing",
  otp_expired: "link_invalid",
  flow_state_expired: "link_invalid",
  flow_state_not_found: "link_invalid",
  bad_code_verifier: "link_invalid",
  signup_disabled: "signup_disabled",
  email_address_invalid: "invalid_email",
  validation_failed: "invalid_email",
};

const MESSAGE_PATTERNS: [RegExp, AuthErrorKind][] = [
  [/invalid login credentials/i, "invalid_credentials"],
  [/email not confirmed/i, "email_not_confirmed"],
  [/already (been )?registered|already exists/i, "user_already_exists"],
  [/password should be|weak password|password is known to be weak/i, "weak_password"],
  [/rate limit|too many requests/i, "rate_limited"],
  [/provider is not enabled|unsupported provider/i, "provider_disabled"],
  [/different from the old password|same password/i, "same_password"],
  [/auth session missing/i, "session_missing"],
  [/expired|invalid.*(link|token|code)|code verifier/i, "link_invalid"],
  [/signups? not allowed/i, "signup_disabled"],
  [/unable to validate email|invalid email|email address .* is invalid/i, "invalid_email"],
  [/failed to fetch|network|fetch failed|load failed/i, "network"],
];

export function authErrorKind(error: AuthLikeError | null | undefined): AuthErrorKind {
  if (!error) return "unknown";
  if (error.code && CODE_MAP[error.code]) return CODE_MAP[error.code];
  if (error.name === "AuthRetryableFetchError") return "network";
  if (error.status === 429) return "rate_limited";
  const message = error.message ?? "";
  for (const [pattern, kind] of MESSAGE_PATTERNS) if (pattern.test(message)) return kind;
  return "unknown";
}

export function friendlyAuthError(error: AuthLikeError | null | undefined): FriendlyAuthError {
  const kind = authErrorKind(error);
  return { kind, message: MESSAGES[kind] };
}

/** Copy for `?error=` codes our own callback route redirects with. */
export function messageForErrorParam(code: string | null): string | null {
  if (!code) return null;
  if (code in MESSAGES) return MESSAGES[code as AuthErrorKind];
  return MESSAGES.link_invalid;
}
