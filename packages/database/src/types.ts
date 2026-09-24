/**
 * Database types — hand-maintained mirror of supabase/migrations/*.sql.
 * Regenerate authoritatively any time with:
 *   supabase gen types typescript --linked > packages/database/src/types.ts
 * (then re-add the DbClient alias below.)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Role = "buyer" | "vendor" | "admin";
export type VerificationStatus = "pending" | "approved" | "rejected" | "inspected";
export type ListingStatus = "draft" | "pending" | "active" | "rejected" | "paused";
export type BaleStatus = "open" | "full" | "processing" | "fulfilled" | "expired" | "cancelled";
export type BookingStatus = "pending" | "paid" | "refunded" | "cancelled";
export type OrderStatus =
  | "pending_payment" | "paid" | "processing" | "ready" | "in_transit"
  | "delivered" | "disputed" | "refunded" | "cancelled";
export type EscrowStatus = "none" | "held" | "released" | "refunded" | "partial_refund";
export type PaymentSessionStatus = "pending" | "success" | "failed" | "abandoned";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; role: Role; full_name: string | null; phone: string | null; city: string | null; avatar_url: string | null; created_at: string; updated_at: string };
        Insert: { id: string; role?: Role; full_name?: string | null; phone?: string | null; city?: string | null; avatar_url?: string | null; created_at?: string; updated_at?: string };
        Update: { role?: Role; full_name?: string | null; phone?: string | null; city?: string | null; avatar_url?: string | null; updated_at?: string };
        Relationships: [];
      };
      vendor_profiles: {
        Row: { id: string; profile_id: string; shop_name: string; city: string | null; market_address: string | null; verification_status: VerificationStatus; rejection_reason: string | null; bank_code: string | null; account_number: string | null; account_name: string | null; paystack_recipient_code: string | null; subscription_plan: string; subscription_status: string; strikes: number; inspected_at: string | null; rating_avg: number; reviews_count: number; sales_count: number; created_at: string; updated_at: string };
        Insert: { id?: string; profile_id: string; shop_name: string; city?: string | null; market_address?: string | null; verification_status?: VerificationStatus; rejection_reason?: string | null; bank_code?: string | null; account_number?: string | null; account_name?: string | null; paystack_recipient_code?: string | null; subscription_plan?: string; subscription_status?: string; strikes?: number; inspected_at?: string | null; rating_avg?: number; reviews_count?: number; sales_count?: number; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["vendor_profiles"]["Insert"]>;
        Relationships: [];
      };
      vendor_documents: {
        Row: { id: string; vendor_id: string; type: string; storage_path: string; status: string; reviewed_by: string | null; reviewed_at: string | null; created_at: string };
        Insert: { id?: string; vendor_id: string; type: string; storage_path: string; status?: string; reviewed_by?: string | null; reviewed_at?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["vendor_documents"]["Insert"]>;
        Relationships: [];
      };
      products: {
        Row: { id: string; vendor_id: string; title: string; description: string | null; category: string; grade: string; kind: string; price_naira: number; old_price_naira: number | null; qty: number; city: string | null; status: ListingStatus; weight_kg: number | null; pieces_estimate: string | null; views: number; sold_count: number; rating_avg: number; created_at: string; updated_at: string };
        Insert: { id?: string; vendor_id: string; title: string; description?: string | null; category: string; grade: string; kind?: string; price_naira: number; old_price_naira?: number | null; qty?: number; city?: string | null; status?: ListingStatus; weight_kg?: number | null; pieces_estimate?: string | null; views?: number; sold_count?: number; rating_avg?: number; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["products"]["Insert"]>;
        Relationships: [];
      };
      product_images: {
        Row: { id: string; product_id: string; storage_path: string; sort_order: number; created_at: string };
        Insert: { id?: string; product_id: string; storage_path: string; sort_order?: number; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["product_images"]["Insert"]>;
        Relationships: [];
      };
      bale_listings: {
        Row: { id: string; product_id: string; total_naira: number; split_count: number; price_per_slot_naira: number; booked_count: number; expires_at: string; status: BaleStatus; created_at: string; updated_at: string };
        Insert: { id?: string; product_id: string; total_naira: number; split_count: number; price_per_slot_naira: number; booked_count?: number; expires_at: string; status?: BaleStatus; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["bale_listings"]["Insert"]>;
        Relationships: [];
      };
      bale_bookings: {
        Row: { id: string; bale_id: string; buyer_id: string; status: BookingStatus; amount_naira: number; paystack_reference: string | null; display_label: string | null; reserved_until: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; bale_id: string; buyer_id: string; status?: BookingStatus; amount_naira: number; paystack_reference?: string | null; display_label?: string | null; reserved_until?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["bale_bookings"]["Insert"]>;
        Relationships: [];
      };
      addresses: {
        Row: { id: string; profile_id: string; label: string; full_address: string; city: string; phone: string; is_default: boolean; created_at: string };
        Insert: { id?: string; profile_id: string; label?: string; full_address: string; city: string; phone: string; is_default?: boolean; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["addresses"]["Insert"]>;
        Relationships: [];
      };
      orders: {
        Row: { id: string; buyer_id: string; vendor_id: string; status: OrderStatus; escrow_status: EscrowStatus; subtotal_naira: number; delivery_fee_naira: number; subsidy_naira: number; total_naira: number; paystack_reference: string | null; tracking_number: string | null; tracking_url: string | null; delivered_at: string | null; address_id: string | null; shipping_address_snapshot: string | null; shipping_city: string | null; shipping_phone: string | null; inventory_released: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; buyer_id: string; vendor_id: string; status?: OrderStatus; escrow_status?: EscrowStatus; subtotal_naira?: number; delivery_fee_naira?: number; subsidy_naira?: number; total_naira?: number; paystack_reference?: string | null; tracking_number?: string | null; tracking_url?: string | null; delivered_at?: string | null; address_id?: string | null; shipping_address_snapshot?: string | null; shipping_city?: string | null; shipping_phone?: string | null; inventory_released?: boolean; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>;
        Relationships: [];
      };
      order_items: {
        Row: { id: string; order_id: string; product_id: string | null; bale_booking_id: string | null; title_snapshot: string; qty: number; unit_naira: number };
        Insert: { id?: string; order_id: string; product_id?: string | null; bale_booking_id?: string | null; title_snapshot: string; qty?: number; unit_naira: number };
        Update: Partial<Database["public"]["Tables"]["order_items"]["Insert"]>;
        Relationships: [];
      };
      order_timeline: {
        Row: { id: string; order_id: string; status: string; note: string | null; created_at: string };
        Insert: { id?: string; order_id: string; status: string; note?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["order_timeline"]["Insert"]>;
        Relationships: [];
      };
      payment_sessions: {
        Row: { id: string; buyer_id: string; reference: string; kind: "order_batch" | "slot"; amount_naira: number; currency: "NGN"; order_ids: string[]; booking_id: string | null; status: PaymentSessionStatus; preferred_channel: string | null; authorization_url: string | null; access_code: string | null; idempotency_key: string | null; paystack_transaction_id: string | null; gateway_response: string | null; channel: string | null; paid_at: string | null; failure_reason: string | null; meta: Json; created_at: string; updated_at: string };
        Insert: { id?: string; buyer_id: string; reference: string; kind: "order_batch" | "slot"; amount_naira: number; currency?: "NGN"; order_ids?: string[]; booking_id?: string | null; status?: PaymentSessionStatus; preferred_channel?: string | null; authorization_url?: string | null; access_code?: string | null; idempotency_key?: string | null; paystack_transaction_id?: string | null; gateway_response?: string | null; channel?: string | null; paid_at?: string | null; failure_reason?: string | null; meta?: Json; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["payment_sessions"]["Insert"]>;
        Relationships: [];
      };
      transactions: {
        Row: { id: string; kind: string; amount_naira: number; order_id: string | null; bale_booking_id: string | null; vendor_id: string | null; buyer_id: string | null; paystack_reference: string | null; meta: Json; created_at: string };
        Insert: { id?: string; kind: string; amount_naira: number; order_id?: string | null; bale_booking_id?: string | null; vendor_id?: string | null; buyer_id?: string | null; paystack_reference?: string | null; meta?: Json; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["transactions"]["Insert"]>;
        Relationships: [];
      };
      vendor_payouts: {
        Row: { id: string; vendor_id: string; order_id: string | null; gross_naira: number; commission_naira: number; net_naira: number; status: string; paystack_transfer_code: string | null; paystack_transfer_reference: string | null; processing_started_at: string | null; last_checked_at: string | null; attempts: number; last_error: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; vendor_id: string; order_id?: string | null; gross_naira: number; commission_naira: number; net_naira: number; status?: string; paystack_transfer_code?: string | null; paystack_transfer_reference?: string | null; processing_started_at?: string | null; last_checked_at?: string | null; attempts?: number; last_error?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["vendor_payouts"]["Insert"]>;
        Relationships: [];
      };
      disputes: {
        Row: { id: string; order_id: string; buyer_id: string; status: string; reason: string; description: string | null; evidence_urls: string[]; resolution_note: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; order_id: string; buyer_id: string; status?: string; reason: string; description?: string | null; evidence_urls?: string[]; resolution_note?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["disputes"]["Insert"]>;
        Relationships: [];
      };
      order_refunds: {
        Row: { id: string; order_id: string; dispute_id: string | null; paystack_reference: string; paystack_refund_id: string | null; amount_naira: number; status: string; attempts: number; last_error: string | null; requested_at: string; processed_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; order_id: string; dispute_id?: string | null; paystack_reference: string; paystack_refund_id?: string | null; amount_naira: number; status?: string; attempts?: number; last_error?: string | null; requested_at?: string; processed_at?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["order_refunds"]["Insert"]>;
        Relationships: [];
      };
      bale_refunds: {
        Row: { id: string; booking_id: string; paystack_reference: string; paystack_refund_id: string | null; amount_naira: number; status: string; attempts: number; last_error: string | null; requested_at: string; processed_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; booking_id: string; paystack_reference: string; paystack_refund_id?: string | null; amount_naira: number; status?: string; attempts?: number; last_error?: string | null; requested_at?: string; processed_at?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["bale_refunds"]["Insert"]>;
        Relationships: [];
      };
      reviews: {
        Row: { id: string; order_id: string; buyer_id: string; vendor_id: string; product_id: string | null; rating: number; body: string | null; created_at: string };
        Insert: { id?: string; order_id: string; buyer_id: string; vendor_id: string; product_id?: string | null; rating: number; body?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["reviews"]["Insert"]>;
        Relationships: [];
      };
      notifications: {
        Row: { id: string; profile_id: string; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string };
        Insert: { id?: string; profile_id: string; title: string; body?: string | null; href?: string | null; read_at?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
        Relationships: [];
      };
      fulfillment_events: {
        Row: { id: string; order_id: string; provider: string; external_event_id: string | null; status: string; tracking_number: string | null; tracking_url: string | null; payload: Json; created_at: string };
        Insert: { id?: string; order_id: string; provider?: string; external_event_id?: string | null; status: string; tracking_number?: string | null; tracking_url?: string | null; payload?: Json; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["fulfillment_events"]["Insert"]>;
        Relationships: [];
      };
      admin_audit_log: {
        Row: { id: string; admin_id: string; action: string; entity_type: string; entity_id: string | null; before_state: Json | null; after_state: Json | null; note: string | null; created_at: string };
        Insert: { id?: string; admin_id: string; action: string; entity_type: string; entity_id?: string | null; before_state?: Json | null; after_state?: Json | null; note?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["admin_audit_log"]["Insert"]>;
        Relationships: [];
      };
      promo_codes: {
        Row: { id: string; code: string; kind: string; amount_naira: number; max_uses: number | null; used: number; active: boolean; expires_at: string | null };
        Insert: { id?: string; code: string; kind?: string; amount_naira: number; max_uses?: number | null; used?: number; active?: boolean; expires_at?: string | null };
        Update: Partial<Database["public"]["Tables"]["promo_codes"]["Insert"]>;
        Relationships: [];
      };
      /** Saved products (migration 0018). Owner-only RLS. */
      wishlists: {
        Row: { id: string; profile_id: string; product_id: string; created_at: string };
        Insert: { id?: string; profile_id: string; product_id: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["wishlists"]["Insert"]>;
        Relationships: [];
      };
      /** First-party funnel events (migration 0018). Insert-only for clients. */
      analytics_events: {
        Row: {
          id: string;
          profile_id: string | null;
          session_id: string;
          event_name: string;
          props: Json;
          path: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id?: string | null;
          session_id: string;
          event_name: string;
          props?: Json;
          path?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["analytics_events"]["Insert"]>;
        Relationships: [];
      };
      /** Buyer/vendor support threads (migration 0020). Guests may insert. */
      support_messages: {
        Row: {
          id: string;
          profile_id: string | null;
          name: string;
          email: string;
          topic: string;
          body: string;
          order_ref: string | null;
          status: string;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          profile_id?: string | null;
          name: string;
          email: string;
          topic?: string;
          body: string;
          order_ref?: string | null;
          status?: string;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["support_messages"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      mark_notification_read: { Args: { p_id: string }; Returns: undefined };
      mark_all_notifications_read: { Args: Record<string, never>; Returns: number };
      claim_bale_slot: {
        Args: { p_bale_id: string };
        Returns: Json;
      };
      finalize_payment_session: {
        Args: {
          p_reference: string;
          p_amount_naira: number;
          p_paystack_transaction_id?: string | null;
          p_channel?: string | null;
          p_gateway_response?: string | null;
          p_event?: Json;
        };
        Returns: Json;
      };
      release_expired_bale_reservations: {
        Args: { p_bale_id?: string | null };
        Returns: number;
      };
      reserve_product_stock: {
        Args: { p_product_id: string; p_qty: number };
        Returns: boolean;
      };
      reserve_order_inventory: {
        Args: { p_order_ids: string[] };
        Returns: Json;
      };
      release_product_stock: {
        Args: { p_product_id: string; p_qty: number };
        Returns: boolean;
      };
      cancel_payment_session: {
        Args: { p_reference: string; p_reason?: string };
        Returns: Json;
      };
      restore_order_inventory: {
        Args: { p_order_id: string };
        Returns: Json;
      };
      confirm_order_delivery: {
        Args: { p_order_id: string; p_buyer_id: string };
        Returns: Json;
      };
      release_disputed_order_to_vendor: {
        Args: { p_order_id: string };
        Returns: Json;
      };
      create_order_review: {
        Args: { p_order_id: string; p_buyer_id: string; p_rating: number; p_body?: string | null; p_product_id?: string | null };
        Returns: Json;
      };
      open_order_dispute: {
        Args: { p_order_id: string; p_buyer_id: string; p_reason: string; p_description: string; p_evidence_urls?: string[] };
        Returns: Json;
      };
      set_order_fulfillment_status: {
        Args: { p_order_id: string; p_vendor_profile_id: string; p_status: string; p_tracking_number?: string | null; p_tracking_url?: string | null };
        Returns: Json;
      };
      claim_vendor_payout: {
        Args: { p_payout_id: string; p_force?: boolean };
        Returns: Json;
      };
      rotate_vendor_payout_reference: {
        Args: { p_payout_id: string };
        Returns: Json;
      };
      complete_vendor_payout: {
        Args: { p_payout_id: string; p_status: string; p_transfer_code?: string | null; p_error?: string | null };
        Returns: Json;
      };
      claim_order_refund: {
        Args: { p_order_id: string; p_dispute_id?: string | null };
        Returns: Json;
      };
      settle_order_refund: {
        Args: { p_refund_id: string; p_status: string; p_paystack_refund_id?: string | null; p_error?: string | null };
        Returns: Json;
      };
      claim_bale_refund: {
        Args: { p_booking_id: string };
        Returns: Json;
      };
      settle_bale_refund: {
        Args: { p_refund_id: string; p_status: string; p_paystack_refund_id?: string | null; p_error?: string | null };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** Canonical typed client. Apps must use this — never `SupabaseClient<any>`. */
export type DbClient = SupabaseClient<Database>;
