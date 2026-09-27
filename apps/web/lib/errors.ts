/**
 * Generic, user-facing error copy.
 *
 * Supabase/Postgres/Edge Functions can return messages such as
 * "new row violates row-level security policy". Those are useful to engineers
 * but scary and unactionable for shoppers and sellers, so every visible error
 * should pass through this translator unless it already came from a dedicated
 * friendly mapper (for example auth/errors.ts).
 */

export type FriendlyErrorContext =
  | "account"
  | "address"
  | "admin"
  | "generic"
  | "listing"
  | "notifications"
  | "operation"
  | "order"
  | "orderAction"
  | "payment"
  | "reorder"
  | "review"
  | "slot"
  | "support"
  | "upload"
  | "vendorApplication"
  | "vendorDashboard";

export interface FriendlyErrorOptions {
  context?: FriendlyErrorContext;
  fallback?: string;
}

type ErrorLike = {
  code?: unknown;
  details?: unknown;
  error?: unknown;
  hint?: unknown;
  message?: unknown;
  name?: unknown;
  status?: unknown;
  context?: unknown;
};

const CONTEXT_FALLBACKS: Record<FriendlyErrorContext, string> = {
  account: "We couldn’t save your profile changes. Please try again.",
  address: "We couldn’t save that address. Please check the details and try again.",
  admin: "We couldn’t complete that admin action. Please try again.",
  generic: "Something went wrong. Please try again.",
  listing: "We couldn’t submit your listing. Make sure your seller account is approved, then try again.",
  notifications: "We couldn’t load your notifications. Please refresh and try again.",
  operation: "We couldn’t complete that action. Please try again.",
  order: "We couldn’t load your orders. Please refresh and try again.",
  orderAction: "We couldn’t update that order. Please try again.",
  payment: "We couldn’t start payment right now. Please try again in a few minutes.",
  reorder: "We couldn’t add those items again. Please browse similar listings instead.",
  review: "We couldn’t post your review. Please try again.",
  slot: "We couldn’t reserve that slot. Please try again.",
  support: "We couldn’t send your message. Please try again.",
  upload: "We couldn’t upload that file. Please check the file and try again.",
  vendorApplication: "We couldn’t submit your seller application. Please check your details and try again.",
  vendorDashboard: "We couldn’t load your seller dashboard. Please refresh and try again.",
};

const TECHNICAL_PATTERNS = [
  /row-level security|rls|violates .*policy|policy for table/i,
  /permission denied|not authorized|unauthorized|forbidden|admin access required|vendor or admin access required/i,
  /jwt|auth session missing|session_not_found|session_expired/i,
  /duplicate key|unique constraint|foreign key|violates .*constraint|not-null constraint|null value in column|check constraint/i,
  /invalid input syntax|invalid json|schema cache|column .* does not exist|relation .* does not exist|operator does not exist|syntax error/i,
  /pgrst\d+|postgrest|postgres|supabase|service_role/i,
  /idempotency_key|[a-z]+_[a-z]+ is required|\b[a-z]+_id\b|uuid/i,
  /method not allowed|unexpected .*response|incomplete response|edge function|non-2xx/i,
  /paystack did not return|paystack initialization|payment service is not configured|secret key/i,
  /bucket not found|storage.*object|object not found/i,
];

function fallbackFor(options?: FriendlyErrorOptions | string): string {
  if (typeof options === "string") return options;
  return options?.fallback ?? CONTEXT_FALLBACKS[options?.context ?? "generic"];
}

function contextFor(options?: FriendlyErrorOptions | string): FriendlyErrorContext {
  return typeof options === "string" ? "generic" : options?.context ?? "generic";
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function errorObject(error: unknown): ErrorLike | null {
  if (error && typeof error === "object") return error as ErrorLike;
  return null;
}

function displayMessage(error: unknown): string {
  if (typeof error === "string") return error.trim();
  const object = errorObject(error);
  if (!object) return "";
  return firstString(object.message, object.error);
}

function diagnosticText(error: unknown): string {
  if (typeof error === "string") return error;
  const object = errorObject(error);
  if (!object) return "";
  return [object.name, object.code, object.status, object.message, object.error, object.details, object.hint]
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .join(" ");
}

function isTechnical(text: string): boolean {
  return TECHNICAL_PATTERNS.some((pattern) => pattern.test(text));
}

function permissionMessage(context: FriendlyErrorContext): string {
  if (context === "listing") {
    return "Your seller account must be approved before you can submit listings. If you were already approved, sign in again and try once more.";
  }
  if (context === "vendorApplication") {
    return "We couldn’t save your seller application. Sign in again and try once more.";
  }
  if (context === "admin") return "You don’t have access to do that. Ask an admin if you think this is a mistake.";
  return "You don’t have permission to do that yet. Sign in again or contact support if it keeps happening.";
}

function notFoundMessage(context: FriendlyErrorContext): string | null {
  if (context === "vendorDashboard") {
    return "We couldn’t find your seller profile. Please finish seller onboarding or contact support if you already applied.";
  }
  if (context === "slot") return "We couldn’t find that slot reservation. Please reserve the slot again.";
  if (context === "order" || context === "orderAction") return "We couldn’t find that order. Please refresh and try again.";
  if (context === "listing") return "We couldn’t find that listing. It may have been removed or paused.";
  return null;
}

function specificFriendlyMessage(error: unknown, context: FriendlyErrorContext): string | null {
  const raw = diagnosticText(error);
  if (!raw) return null;

  if (/failed to fetch|fetch failed|network|load failed|timed? out|timeout/i.test(raw)) {
    return "We couldn’t connect to Bale Drop. Check your internet connection and try again.";
  }

  if (/sign in required/i.test(raw)) return "Sign in to continue.";

  if (/session expired|auth session missing|jwt|token has expired/i.test(raw)) {
    return "Your session expired. Sign in again to continue.";
  }

  if (/row-level security|rls|violates .*policy|policy for table|permission denied|not authorized|unauthorized|forbidden|admin access required|vendor or admin access required/i.test(raw)) {
    return permissionMessage(context);
  }

  if (/vendor profile not found|vendor application not found|vendor not found|product not found|listing not found|order not found|dispute not found|payout not found|slot reservation not found/i.test(raw)) {
    return notFoundMessage(context) ?? "We couldn’t find that record. Please refresh and try again.";
  }

  if (/duplicate key|unique constraint/i.test(raw)) {
    if (context === "review") return "You’ve already reviewed this order.";
    if (context === "address") return "That address is already saved.";
    return "This has already been saved. Refresh the page if you don’t see it yet.";
  }

  if (/foreign key|violates .*constraint|not-null constraint|null value in column|check constraint|invalid input syntax|schema cache|column .* does not exist|relation .* does not exist|operator does not exist|syntax error|pgrst\d+|postgrest|postgres|supabase|service_role|idempotency_key|\b[a-z]+_id\b|method not allowed|invalid json|edge function|non-2xx/i.test(raw)) {
    return CONTEXT_FALLBACKS[context];
  }

  if (/payment service is not configured|paystack did not return|paystack initialization|authorization link|secret key|payment session/i.test(raw)) {
    return context === "admin"
      ? "The payment provider didn’t complete that request. Please try again or check the payout record."
      : CONTEXT_FALLBACKS.payment;
  }

  if (/invalid cart item|add at least one item to checkout/i.test(raw)) {
    return "Review your cart, then try checkout again.";
  }

  if (/complete delivery address is required/i.test(raw)) {
    return "Add a complete delivery address and phone number.";
  }

  if (/bucket not found|storage.*object|object not found|upload failed|mime|file too large/i.test(raw)) {
    return CONTEXT_FALLBACKS.upload;
  }

  if (/vendor bank details are incomplete/i.test(raw)) {
    return "The vendor’s bank details are incomplete. Ask them to update payout details before retrying.";
  }
  if (/payout is already being reconciled/i.test(raw)) return "This payout is already being checked. Please wait a moment and refresh.";
  if (/order has no paystack reference to refund/i.test(raw)) return "We couldn’t find the payment reference for this order. Please check the order before retrying.";

  if (/application is not pending/i.test(raw)) return "This application has already been reviewed.";
  if (/dispute is already resolved/i.test(raw)) return "This dispute has already been resolved.";
  if (/order is not ready for dispatch/i.test(raw)) return "This order is not ready to dispatch yet.";
  if (/order escrow is no longer held/i.test(raw)) return "This order has already been settled, so escrow can’t be changed.";
  if (/already closed|no longer awaiting payment/i.test(raw)) return "That payment attempt has expired. Please start again.";

  return null;
}

/**
 * Return safe, plain-language copy for an error value.
 * Friendly messages already written by the app are preserved; technical details
 * are replaced by context-aware fallback text.
 */
export function friendlyErrorMessage(error: unknown, options?: FriendlyErrorOptions | string): string {
  const fallback = fallbackFor(options);
  const context = contextFor(options);
  const specific = specificFriendlyMessage(error, context);
  if (specific) return specific;

  const message = displayMessage(error);
  if (!message) return fallback;

  // Long/provider/stack-like strings are rarely helpful to shoppers.
  if (message.length > 180 || isTechnical(message)) return fallback;
  return message;
}

/** Extract an `{ error: "..." }` payload from a failed Supabase Function call. */
export async function functionErrorMessage(error: unknown): Promise<string | null> {
  const context = errorObject(error)?.context;
  if (typeof Response === "undefined" || !(context instanceof Response)) return null;
  const payload = await context.clone().json().catch(() => null) as { error?: unknown } | null;
  return typeof payload?.error === "string" ? payload.error : null;
}
