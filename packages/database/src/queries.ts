/**
 * Read queries + transactional writes against Supabase.
 * Simple, batched, type-safe selects (no deep embedding) — fast enough at
 * MVP scale and trivially portable to React Native (same client, same calls).
 */
import type { DbClient } from "./types";
import type { BaleRow, ProductRow, VendorRow } from "./domain";

export interface PaidBookingLabel {
  bale_id: string;
  display_label: string | null;
}

/** Live splits, soonest-expiring first (urgency ordering). */
export async function listOpenBales(client: DbClient): Promise<BaleRow[]> {
  const { data, error } = await client
    .from("bale_listings")
    .select("*")
    .eq("status", "open")
    .order("expires_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getBaleByProductId(client: DbClient, productId: string): Promise<BaleRow | null> {
  const { data, error } = await client
    .from("bale_listings")
    .select("*")
    .eq("product_id", productId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listProducts(client: DbClient, opts?: { limit?: number }): Promise<ProductRow[]> {
  const { data, error } = await client
    .from("products")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 50);
  if (error) throw error;
  return data;
}

export async function listProductsByIds(client: DbClient, ids: string[]): Promise<ProductRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client.from("products").select("*").in("id", ids);
  if (error) throw error;
  return data;
}

export async function getProductById(client: DbClient, id: string): Promise<ProductRow | null> {
  const { data, error } = await client.from("products").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listVendorsByIds(client: DbClient, ids: string[]): Promise<VendorRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client.from("vendor_profiles").select("*").in("id", ids);
  if (error) throw error;
  return data;
}

/** Paid slot labels per bale — powers the live slot chips (no PII). */
export async function listPaidBookings(client: DbClient, baleIds: string[]): Promise<PaidBookingLabel[]> {
  if (baleIds.length === 0) return [];
  const { data, error } = await client
    .from("bale_bookings")
    .select("bale_id, display_label")
    .in("bale_id", baleIds)
    .eq("status", "paid")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export interface ClaimResult {
  booking_id: string;
  booked_count: number;
  status: string;
}

/**
 * Transactional slot claim (requires authenticated buyer; RLS + RPC enforce
 * one-slot-per-buyer, open status, expiry, capacity). Call BEFORE Paystack
 * payment — booking starts `pending`, webhook flips to `paid`.
 */
export async function claimSlot(
  client: DbClient,
  baleId: string
): Promise<{ booking: ClaimResult | null; error: string | null }> {
  const { data, error } = await client.rpc("claim_bale_slot", { p_bale_id: baleId });
  if (error) return { booking: null, error: error.message };
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { booking: null, error: "Unexpected claim response" };
  }
  const booking = data as unknown as ClaimResult;
  return { booking, error: null };
}
