/**
 * paystack-initialize — authenticated payment creation.
 *
 * The browser sends product IDs / quantities only. This function reads current
 * prices and vendor ownership from Supabase, creates pending order rows, then
 * asks Paystack for an authorization URL. It never accepts a client total.
 *
 * Secrets: PAYSTACK_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Optional: SITE_URL (the public web origin used for Paystack callbacks).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SITE_URL = Deno.env.get("SITE_URL");

const DELIVERY_FEES: Record<string, number> = {
  standard: 2500,
  express: 4500,
};

const ALLOWED_CHANNELS = ["card", "bank_transfer", "ussd"];

type CheckoutItem = { product_id: string; qty: number };
type ShippingBody = {
  address_id?: string;
  full_address: string;
  city: string;
  phone: string;
};
type InitializeBody = {
  kind?: "order" | "slot";
  idempotency_key?: string;
  items?: CheckoutItem[];
  shipping?: ShippingBody;
  booking_id?: string;
  delivery_method?: string;
  payment_method?: string;
  promo_code?: string;
  callback_url?: string;
};

type Product = {
  id: string;
  vendor_id: string;
  title: string;
  price_naira: number;
  qty: number;
  status: string;
};

type Vendor = { id: string; verification_status: string };

class PaystackInitializationError extends Error {
  constructor(message: string, readonly ambiguous: boolean) {
    super(message);
    this.name = "PaystackInitializationError";
  }
}

function isAmbiguousInitialization(
  error: unknown,
): error is PaystackInitializationError {
  return error instanceof PaystackInitializationError && error.ambiguous;
}

const headers = (req: Request): HeadersInit => ({
  "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
});

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(req) });
}

function reference(): string {
  // Paystack references allow alphanumeric characters plus -, ., =.
  return `BD-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function safeCallbackUrl(req: Request, supplied?: string): string | undefined {
  const fallback = SITE_URL
    ? `${SITE_URL.replace(/\/$/, "")}/checkout`
    : undefined;
  const candidate = supplied || fallback;
  if (!candidate) return undefined;

  try {
    const url = new URL(candidate);
    if (url.pathname !== "/checkout") return fallback;
    const requestOrigin = req.headers.get("origin");
    const allowedOrigins = [SITE_URL, requestOrigin]
      .filter(Boolean)
      .map((origin) => {
        try {
          return new URL(origin!).origin;
        } catch {
          return "";
        }
      });
    if (allowedOrigins.length === 0 || allowedOrigins.includes(url.origin)) {
      return url.toString();
    }
  } catch {
    // Fall through to the configured site URL.
  }
  return fallback;
}

async function paystackInitialize(input: {
  email: string;
  amountNaira: number;
  reference: string;
  metadata: Record<string, unknown>;
  callbackUrl?: string;
  preferredChannel?: string;
}): Promise<
  { authorization_url: string; access_code: string; reference: string }
> {
  if (!PAYSTACK_SECRET) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured");
  }

  const body: Record<string, unknown> = {
    email: input.email,
    amount: String(input.amountNaira * 100), // Paystack expects kobo
    currency: "NGN",
    reference: input.reference,
    channels: ALLOWED_CHANNELS.includes(input.preferredChannel ?? "")
      ? [input.preferredChannel]
      : ALLOWED_CHANNELS,
    metadata: JSON.stringify(input.metadata),
  };
  if (input.callbackUrl) body.callback_url = input.callbackUrl;

  let response: Response;
  try {
    response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    // The request may have reached Paystack even though the Edge runtime did
    // not receive a response. Keep the durable session pending and retry the
    // same reference instead of releasing inventory and creating a new charge.
    throw new PaystackInitializationError(
      "Paystack response was not received; retry this payment attempt",
      true,
    );
  }

  let payload: {
    status?: boolean;
    message?: string;
    data?: {
      authorization_url?: string;
      access_code?: string;
      reference?: string;
    };
  } | null;
  try {
    payload = await response.json() as {
      status?: boolean;
      message?: string;
      data?: {
        authorization_url?: string;
        access_code?: string;
        reference?: string;
      };
    };
  } catch {
    throw new PaystackInitializationError(
      "Paystack returned an unreadable response; retry this payment attempt",
      true,
    );
  }

  if (!response.ok || !payload?.status || !payload.data?.authorization_url) {
    const message = payload?.message || "";
    const normalizedMessage = message.toLowerCase();
    const duplicateReference = normalizedMessage.includes("duplicate") &&
        (normalizedMessage.includes("reference") ||
          normalizedMessage.includes("transaction")) ||
      normalizedMessage.includes("reference already") ||
      normalizedMessage.includes("reference has been used");
    const ambiguous = response.status >= 500 || duplicateReference ||
      (response.ok && payload?.status === true);
    throw new PaystackInitializationError(
      message ||
        (ambiguous
          ? "Paystack initialization status is unknown; retry this payment attempt"
          : "Paystack could not initialize this payment"),
      ambiguous,
    );
  }

  return {
    authorization_url: payload.data.authorization_url,
    access_code: payload.data.access_code ?? "",
    reference: payload.data.reference ?? input.reference,
  };
}

function authToken(req: Request): string | null {
  const value = req.headers.get("authorization");
  if (!value?.toLowerCase().startsWith("bearer ")) return null;
  return value.slice(7).trim() || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: headers(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "method not allowed" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(req, { error: "payment service is not configured" }, 503);
  }

  const token = authToken(req);
  if (!token) return json(req, { error: "sign in required" }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const { data: { user }, error: userError } = await db.auth.getUser(token);
  if (userError || !user?.id || !user.email) {
    return json(req, { error: "session expired — sign in again" }, 401);
  }

  let body: InitializeBody;
  try {
    body = await req.json() as InitializeBody;
  } catch {
    return json(req, { error: "invalid JSON body" }, 400);
  }

  const kind = body.kind === "slot" ? "slot" : "order";
  const idempotencyKey = typeof body.idempotency_key === "string"
    ? body.idempotency_key.trim()
    : "";
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    return json(req, { error: "a valid idempotency_key is required" }, 400);
  }
  const callbackUrl = safeCallbackUrl(req, body.callback_url);
  const preferredChannel = ALLOWED_CHANNELS.includes(body.payment_method ?? "")
    ? body.payment_method!
    : "card";
  const createdOrderIds: string[] = [];
  let paymentSessionReference: string | null = null;
  let inventoryReserved = false;

  try {
    // Replaying the same browser attempt must reuse its server-created
    // payment session instead of creating another order batch.
    if (kind === "order") {
      const { data: existingByKey, error: existingByKeyError } = await db
        .from("payment_sessions")
        .select(
          "id, reference, amount_naira, order_ids, status, authorization_url, access_code, meta",
        )
        .eq("buyer_id", user.id)
        .eq("kind", "order_batch")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingByKeyError) throw existingByKeyError;
      if (existingByKey) {
        paymentSessionReference = existingByKey.reference;
        if (existingByKey.status === "success") {
          return json(req, {
            already_processed: true,
            authorization_url: "",
            access_code: "",
            reference: existingByKey.reference,
            payment_session_id: existingByKey.id,
            order_ids: existingByKey.order_ids,
            amount_naira: existingByKey.amount_naira,
          });
        }
        if (existingByKey.status !== "pending") {
          return json(req, {
            error:
              "this payment attempt is already closed — start a new checkout attempt",
          }, 409);
        }
        if (existingByKey.authorization_url) {
          return json(req, {
            authorization_url: existingByKey.authorization_url,
            access_code: existingByKey.access_code,
            reference: existingByKey.reference,
            payment_session_id: existingByKey.id,
            order_ids: existingByKey.order_ids,
            amount_naira: existingByKey.amount_naira,
          });
        }
        try {
          const initialized = await paystackInitialize({
            email: user.email,
            amountNaira: existingByKey.amount_naira,
            reference: existingByKey.reference,
            preferredChannel,
            callbackUrl,
            metadata: {
              kind: "order_batch",
              payment_session_id: existingByKey.id,
              order_ids: existingByKey.order_ids,
              idempotency_key: idempotencyKey,
            },
          });
          const { error: resumeUpdateError } = await db.from("payment_sessions")
            .update({
              authorization_url: initialized.authorization_url,
              access_code: initialized.access_code,
            }).eq("id", existingByKey.id).eq("status", "pending");
          if (resumeUpdateError) throw resumeUpdateError;
          return json(req, {
            ...initialized,
            payment_session_id: existingByKey.id,
            order_ids: existingByKey.order_ids,
            amount_naira: existingByKey.amount_naira,
          });
        } catch (error) {
          if (!isAmbiguousInitialization(error)) {
            const reason = error instanceof Error
              ? error.message
              : "Paystack initialization failed";
            const { error: cancelError } = await db.rpc(
              "cancel_payment_session",
              { p_reference: existingByKey.reference, p_reason: reason },
            );
            if (cancelError) {
              console.error(
                "paystack-initialize: could not cancel resumed session",
                cancelError.message,
              );
            }
          }
          throw error;
        }
      }
    }

    if (kind === "slot") {
      if (!body.booking_id) {
        return json(req, { error: "booking_id is required" }, 400);
      }

      const { data: booking, error: bookingError } = await db
        .from("bale_bookings")
        .select("id, buyer_id, bale_id, status, amount_naira")
        .eq("id", body.booking_id)
        .eq("buyer_id", user.id)
        .maybeSingle();
      if (bookingError) throw bookingError;
      if (!booking) {
        return json(req, { error: "slot reservation not found" }, 404);
      }
      if (booking.status !== "pending") {
        return json(
          req,
          { error: "this slot is no longer awaiting payment" },
          409,
        );
      }

      const { data: existing } = await db
        .from("payment_sessions")
        .select(
          "id, reference, authorization_url, access_code, amount_naira, status, idempotency_key",
        )
        .eq("booking_id", booking.id)
        .eq("status", "pending")
        .maybeSingle();
      if (existing?.authorization_url) {
        return json(req, {
          authorization_url: existing.authorization_url,
          access_code: existing.access_code,
          reference: existing.reference,
          payment_session_id: existing.id,
          amount_naira: existing.amount_naira,
        });
      }
      const session = existing ?? (await db
        .from("payment_sessions")
        .insert({
          buyer_id: user.id,
          reference: reference(),
          kind: "slot",
          amount_naira: booking.amount_naira,
          booking_id: booking.id,
          idempotency_key: idempotencyKey,
          preferred_channel: preferredChannel,
          meta: {
            payment_method: preferredChannel,
            idempotency_key: idempotencyKey,
          },
        })
        .select(
          "id, reference, amount_naira, authorization_url, access_code, status, idempotency_key",
        )
        .single()).data;
      if (!session) throw new Error("Could not create payment session");
      const paymentReference = session.reference;
      paymentSessionReference = paymentReference;
      if (!session.idempotency_key) {
        await db.from("payment_sessions").update({
          idempotency_key: idempotencyKey,
        }).eq("id", session.id);
      }

      try {
        const initialized = await paystackInitialize({
          email: user.email,
          amountNaira: session.amount_naira,
          reference: paymentReference,
          preferredChannel,
          callbackUrl,
          metadata: {
            kind: "slot",
            payment_session_id: session.id,
            booking_id: booking.id,
            idempotency_key: idempotencyKey,
          },
        });
        const { error: sessionUpdateError } = await db.from("payment_sessions")
          .update({
            authorization_url: initialized.authorization_url,
            access_code: initialized.access_code,
          }).eq("id", session.id);
        if (sessionUpdateError) throw sessionUpdateError;
        return json(req, {
          ...initialized,
          payment_session_id: session.id,
          amount_naira: booking.amount_naira,
        });
      } catch (error) {
        if (!isAmbiguousInitialization(error)) {
          const reason = error instanceof Error
            ? error.message
            : "Paystack initialization failed";
          const { error: cancelError } = await db.rpc(
            "cancel_payment_session",
            { p_reference: paymentReference, p_reason: reason },
          );
          if (cancelError) {
            await db.from("payment_sessions").update({
              status: "failed",
              failure_reason: reason,
            }).eq("id", session.id);
          }
        }
        throw error;
      }
    }

    if (
      !Array.isArray(body.items) || body.items.length === 0 ||
      body.items.length > 20
    ) {
      return json(req, { error: "add at least one item to checkout" }, 400);
    }
    const items = body.items.map((item) => ({
      product_id: String(item?.product_id || ""),
      qty: Number(item?.qty),
    }));
    if (
      items.some((item) =>
        !item.product_id || !Number.isInteger(item.qty) || item.qty < 1 ||
        item.qty > 20
      )
    ) {
      return json(req, { error: "invalid cart item" }, 400);
    }

    const shipping = body.shipping;
    if (
      !shipping || typeof shipping.full_address !== "string" ||
      typeof shipping.city !== "string" || typeof shipping.phone !== "string" ||
      shipping.full_address.trim().length < 5 ||
      shipping.city.trim().length < 2 ||
      shipping.phone.replace(/\D/g, "").length < 10
    ) {
      return json(req, { error: "complete delivery address is required" }, 400);
    }
    let addressId: string | null = null;
    if (shipping.address_id) {
      const { data: address } = await db.from("addresses").select("id").eq(
        "id",
        shipping.address_id,
      ).eq("profile_id", user.id).maybeSingle();
      if (!address) {
        return json(req, {
          error: "delivery address does not belong to this account",
        }, 400);
      }
      addressId = address.id;
    }

    const productIds = [...new Set(items.map((item) => item.product_id))];
    const { data: products, error: productsError } = await db
      .from("products")
      .select("id, vendor_id, title, price_naira, qty, status")
      .in("id", productIds)
      .eq("status", "active");
    if (productsError) throw productsError;
    if (!products || products.length !== productIds.length) {
      return json(req, {
        error: "one or more listings are no longer available",
      }, 409);
    }

    const productById = new Map(
      (products as Product[]).map((product) => [product.id, product]),
    );
    const grouped = new Map<string, { product: Product; qty: number }[]>();
    for (const item of items) {
      const product = productById.get(item.product_id)!;
      const group = grouped.get(product.vendor_id) ?? [];
      group.push({ product, qty: item.qty });
      grouped.set(product.vendor_id, group);
    }

    const vendorIds = [...grouped.keys()];
    const { data: vendors, error: vendorsError } = await db
      .from("vendor_profiles")
      .select("id, verification_status")
      .in("id", vendorIds);
    if (vendorsError) throw vendorsError;
    const approved = new Set(
      (vendors as Vendor[] ?? [])
        .filter((vendor) =>
          ["approved", "inspected"].includes(vendor.verification_status)
        )
        .map((vendor) => vendor.id),
    );
    if (vendorIds.some((id) => !approved.has(id))) {
      return json(req, {
        error: "one or more vendors are not currently accepting orders",
      }, 409);
    }

    const deliveryMethod =
      body.delivery_method && DELIVERY_FEES[body.delivery_method]
        ? body.delivery_method
        : "standard";
    const deliveryFee = DELIVERY_FEES[deliveryMethod];
    let subsidy = 0;
    let promoCode: string | null = null;
    if (body.promo_code) {
      const { data: promo } = await db
        .from("promo_codes")
        .select("code, amount_naira, max_uses, used, active, expires_at")
        .eq("code", body.promo_code.trim().toUpperCase())
        .eq("active", true)
        .maybeSingle();
      if (
        promo &&
        (!promo.expires_at || new Date(promo.expires_at) > new Date()) &&
        (promo.max_uses == null || promo.used < promo.max_uses)
      ) {
        subsidy = Math.max(
          0,
          Math.min(Number(promo.amount_naira), deliveryFee * vendorIds.length),
        );
        promoCode = promo.code;
      }
    }

    const orderIds = createdOrderIds;
    let totalNaira = 0;
    for (const [vendorId, group] of grouped) {
      const subtotal = group.reduce(
        (sum, line) => sum + line.product.price_naira * line.qty,
        0,
      );
      const orderSubsidy = orderIds.length === 0
        ? Math.min(subsidy, deliveryFee)
        : 0;
      const total = subtotal + deliveryFee - orderSubsidy;
      const { data: order, error: orderError } = await db
        .from("orders")
        .insert({
          buyer_id: user.id,
          vendor_id: vendorId,
          status: "pending_payment",
          escrow_status: "none",
          subtotal_naira: subtotal,
          delivery_fee_naira: deliveryFee,
          subsidy_naira: orderSubsidy,
          total_naira: total,
          address_id: addressId,
          shipping_address_snapshot: shipping.full_address.trim(),
          shipping_city: shipping.city.trim(),
          shipping_phone: shipping.phone.trim(),
        })
        .select("id")
        .single();
      if (orderError) throw orderError;
      orderIds.push(order.id);
      totalNaira += total;

      const { error: itemError } = await db.from("order_items").insert(
        group.map((line) => ({
          order_id: order.id,
          product_id: line.product.id,
          title_snapshot: line.product.title,
          qty: line.qty,
          unit_naira: line.product.price_naira,
        })),
      );
      if (itemError) throw itemError;
    }

    const { error: inventoryError } = await db.rpc("reserve_order_inventory", {
      p_order_ids: orderIds,
    });
    if (inventoryError) throw inventoryError;
    inventoryReserved = true;

    const paymentReference = reference();
    const { data: session, error: sessionError } = await db
      .from("payment_sessions")
      .insert({
        buyer_id: user.id,
        reference: paymentReference,
        kind: "order_batch",
        amount_naira: totalNaira,
        order_ids: orderIds,
        idempotency_key: idempotencyKey,
        preferred_channel: preferredChannel,
        meta: {
          delivery_method: deliveryMethod,
          promo_code: promoCode,
          item_count: items.length,
          payment_method: preferredChannel,
          idempotency_key: idempotencyKey,
        },
      })
      .select("id, reference, amount_naira")
      .single();
    if (sessionError) throw sessionError;
    paymentSessionReference = session.reference;

    try {
      const initialized = await paystackInitialize({
        email: user.email,
        amountNaira: totalNaira,
        reference: paymentReference,
        preferredChannel,
        callbackUrl,
        metadata: {
          kind: "order_batch",
          payment_session_id: session.id,
          order_ids: orderIds,
          idempotency_key: idempotencyKey,
        },
      });
      const { error: sessionUpdateError } = await db.from("payment_sessions")
        .update({
          authorization_url: initialized.authorization_url,
          access_code: initialized.access_code,
        }).eq("id", session.id);
      if (sessionUpdateError) throw sessionUpdateError;
      return json(req, {
        ...initialized,
        payment_session_id: session.id,
        order_ids: orderIds,
        amount_naira: totalNaira,
      });
    } catch (error) {
      // The outer catch cancels the session through the atomic recovery RPC.
      // An ambiguous provider response deliberately leaves it pending so the
      // same idempotency key/reference can be retried safely.
      throw error;
    }
  } catch (error) {
    if (isAmbiguousInitialization(error)) {
      console.error(
        "paystack-initialize: ambiguous provider response",
        error.message,
      );
      return json(req, {
        error: error.message,
        retry_same_attempt: true,
        payment_session_reference: paymentSessionReference,
      }, 503);
    }

    let recoveryError: string | null = null;
    if (paymentSessionReference) {
      // This RPC releases every order line in one database transaction. Do not
      // also release individual products from the Edge runtime.
      const { error: cancelError } = await db.rpc("cancel_payment_session", {
        p_reference: paymentSessionReference,
        p_reason: error instanceof Error
          ? error.message
          : "Paystack initialization failed",
      });
      recoveryError = cancelError?.message ?? null;
    } else if (inventoryReserved && createdOrderIds.length > 0) {
      // No session exists yet (for example, the session insert failed), so
      // restore each fully-reserved order with an idempotent RPC.
      const restorations = await Promise.allSettled(
        createdOrderIds.map((orderId) =>
          db.rpc("restore_order_inventory", { p_order_id: orderId })
        ),
      );
      if (
        restorations.some((result) =>
          result.status === "rejected" || result.value.error
        )
      ) recoveryError = "stock release needs recovery";
    }
    if (
      createdOrderIds.length > 0 && !recoveryError && !paymentSessionReference
    ) {
      const { error: orderCancelError } = await db.from("orders").update({
        inventory_released: true,
        status: "cancelled",
      }).in("id", createdOrderIds).eq("status", "pending_payment");
      if (orderCancelError) recoveryError = orderCancelError.message;
    } else if (
      createdOrderIds.length > 0 && recoveryError && !paymentSessionReference
    ) {
      // Keep inventory_released=false so bale-expiry can retry the repair.
      await db.from("orders").update({ status: "cancelled" }).in(
        "id",
        createdOrderIds,
      ).eq("status", "pending_payment");
    }
    console.error(
      "paystack-initialize:",
      error,
      recoveryError ? `recovery: ${recoveryError}` : "",
    );
    return json(req, {
      error: error instanceof Error
        ? error.message
        : "Could not initialize payment",
      recovery_error: recoveryError,
    }, recoveryError ? 500 : 502);
  }
});
