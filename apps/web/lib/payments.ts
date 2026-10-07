import { friendlyErrorMessage, functionErrorMessage } from "@/lib/errors";
import { supabaseBrowser } from "@/lib/supabase";

export type PaymentKind = "order" | "slot";

export interface PaymentItem {
  product_id: string;
  qty: number;
}

export interface ShippingInput {
  address_id?: string;
  full_address: string;
  city: string;
  phone: string;
}

export interface InitializePaymentInput {
  kind: PaymentKind;
  idempotency_key: string;
  items?: PaymentItem[];
  shipping?: ShippingInput;
  booking_id?: string;
  delivery_method?: "standard" | "express";
  payment_method?: "card" | "bank_transfer" | "ussd";
  promo_code?: string;
  callback_url?: string;
}

export interface InitializePaymentResult {
  authorization_url?: string;
  access_code: string;
  reference: string;
  payment_session_id: string;
  amount_naira: number;
  already_processed?: boolean;
  order_ids?: string[];
  /**
   * The server-computed money breakdown (see docs/ENGINEERING-STANDARDS.md §4:
   * totals are recomputed server-side, never trusted from the browser). The
   * checkout summary reconciles against these before handing the buyer to
   * Paystack, so what they saw is what they are charged.
   */
  subtotal_naira?: number;
  delivery_fee_naira?: number;
  subsidy_naira?: number;
  promo_code?: string | null;
}

/**
 * Calls the authenticated Edge Function. Paystack's secret never enters the
 * Next.js bundle; this helper only receives a short-lived authorization URL.
 */
export async function initializePayment(
  input: InitializePaymentInput
): Promise<{ data: InitializePaymentResult | null; error: string | null; retry_same_attempt?: boolean }> {
  const { data, error } = await supabaseBrowser().functions.invoke<InitializePaymentResult>("paystack-initialize", {
    body: input,
  });
  if (error) {
    let retrySameAttempt = false;
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as { error?: string; retry_same_attempt?: boolean } | null;
      retrySameAttempt = payload?.retry_same_attempt === true;
    }
    const payloadMessage = await functionErrorMessage(error);
    return {
      data: null,
      error: friendlyErrorMessage(payloadMessage ?? error, { context: "payment" }),
      retry_same_attempt: retrySameAttempt,
    };
  }
  if (!data?.reference || !data.payment_session_id || (!data.already_processed && !data.authorization_url)) {
    return { data: null, error: friendlyErrorMessage("Payment service returned an incomplete response", { context: "payment" }), retry_same_attempt: false };
  }
  return { data, error: null };
}
