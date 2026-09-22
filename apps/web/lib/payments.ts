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
    let message = error.message || "Could not start payment";
    let retrySameAttempt = false;
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as { error?: string; retry_same_attempt?: boolean } | null;
      if (payload?.error) message = payload.error;
      retrySameAttempt = payload?.retry_same_attempt === true;
    }
    return { data: null, error: message, retry_same_attempt: retrySameAttempt };
  }
  if (!data?.reference || !data.payment_session_id || (!data.already_processed && !data.authorization_url)) {
    return { data: null, error: "Payment service returned an incomplete response", retry_same_attempt: false };
  }
  return { data, error: null };
}
