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
        Row: { id: string; buyer_id: string; vendor_id: string; status: OrderStatus; escrow_status: EscrowStatus; subtotal_naira: number; delivery_fee_naira: number; subsidy_naira: number; total_naira: number; paystack_reference: string | null; tracking_number: string | null; tracking_url: string | null; delivered_at: string | null; escrow_release_at: string | null; address_id: string | null; shipping_address_snapshot: string | null; shipping_city: string | null; shipping_phone: string | null; inventory_released: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; buyer_id: string; vendor_id: string; status?: OrderStatus; escrow_status?: EscrowStatus; subtotal_naira?: number; delivery_fee_naira?: number; subsidy_naira?: number; total_naira?: number; paystack_reference?: string | null; tracking_number?: string | null; tracking_url?: string | null; delivered_at?: string | null; escrow_release_at?: string | null; address_id?: string | null; shipping_address_snapshot?: string | null; shipping_city?: string | null; shipping_phone?: string | null; inventory_released?: boolean; created_at?: string; updated_at?: string };
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
      /** One row per promo redemption (migration 0025). Keyed on the payment
       * reference so a replayed checkout cannot double-count a code. */
      promo_redemptions: {
        Row: { id: string; code: string; profile_id: string; payment_reference: string; amount_naira: number; created_at: string };
        Insert: { id?: string; code: string; profile_id: string; payment_reference: string; amount_naira?: number; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["promo_redemptions"]["Insert"]>;
        Relationships: [];
      };
      /** Operator-maintained query → category synonyms (migration 0026).
       * Public read, admin write; consulted by `search_products()`. */
      search_synonyms: {
        Row: { id: string; term: string; category: string; created_at: string };
        Insert: { id?: string; term: string; category: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["search_synonyms"]["Insert"]>;
        Relationships: [];
      };
      /** Sliding-window limiter state (migration 0027). No client policies:
       * only `check_rate_limit()` (service_role) may read or write it. */
      rate_limits: {
        Row: { bucket: string; window_start: string; hits: number };
        Insert: { bucket: string; window_start?: string; hits?: number };
        Update: Partial<Database["public"]["Tables"]["rate_limits"]["Insert"]>;
        Relationships: [];
      };
      /** Immutable support conversation (migration 0028). `update`/`delete`
       * are revoked from clients — a trail you can edit is not a trail. */
      support_replies: {
        Row: { id: string; message_id: string; author_profile_id: string | null; from_team: boolean; body: string; created_at: string };
        Insert: { id?: string; message_id: string; author_profile_id?: string | null; from_team?: boolean; body: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["support_replies"]["Insert"]>;
        Relationships: [];
      };
      /** Browser push endpoints (migration 0029). Owner insert/select/delete;
       * no update, so a stolen session cannot silently retarget a device. */
      push_subscriptions: {
        Row: { id: string; profile_id: string; endpoint: string; p256dh_key: string; auth_key: string; user_agent: string | null; last_used_at: string | null; created_at: string };
        Insert: { id?: string; profile_id: string; endpoint: string; p256dh_key: string; auth_key: string; user_agent?: string | null; last_used_at?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["push_subscriptions"]["Insert"]>;
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
          first_response_at: string | null;
          last_activity_at: string | null;
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
          first_response_at?: string | null;
          last_activity_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["support_messages"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      /** Admin support workload (migration 0028). `security_invoker = on`, so
       * the admin RLS on `support_messages` still decides what is visible. */
      support_queue: {
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
          first_response_at: string | null;
          last_activity_at: string | null;
          age_seconds: number;
          first_response_seconds: number | null;
          reply_count: number;
          team_reply_count: number;
        };
        Relationships: [];
      };
    };
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
      /* ---------------- 0016 pending-payment expiry ---------------- */
      expire_uninitialized_payment_sessions: {
        Args: { p_age_minutes?: number };
        Returns: Json;
      };

      /* ---------------- 0022 bale split lifecycle ---------------- */
      commission_rate_for_vendor: {
        Args: { p_vendor_id: string };
        Returns: number;
      };
      create_bale_split: {
        Args: { p_product_id: string; p_split_count: number; p_price_per_slot_naira: number; p_expires_hours?: number };
        Returns: Json;
      };
      cancel_bale_split: { Args: { p_bale_id: string }; Returns: Json };
      fulfil_bale_split: {
        Args: { p_bale_id: string; p_vendor_profile_id: string; p_handover_note?: string | null };
        Returns: Json;
      };
      complete_vendor_payout_checked: {
        Args: { p_payout_id: string; p_expected_reference: string; p_status: string; p_transfer_code?: string | null; p_error?: string | null };
        Returns: Json;
      };

      /* ---------------- 0023 escrow auto-release ---------------- */
      escrow_release_window: { Args: Record<string, never>; Returns: string };
      release_order_escrow: {
        Args: { p_order_id: string; p_note?: string };
        Returns: Json;
      };
      release_due_escrows: { Args: { p_batch?: number }; Returns: Json };

      /* ---------------- 0024 listing management + metrics ---------------- */
      set_listing_status: {
        Args: { p_product_id: string; p_status: string };
        Returns: Json;
      };
      record_product_view: { Args: { p_product_id: string }; Returns: Json };

      /* ---------------- 0025 promo accounting ---------------- */
      reserve_promo_code: {
        Args: { p_code: string; p_profile_id: string; p_payment_reference: string };
        Returns: Json;
      };
      release_promo_reservation: { Args: { p_payment_reference: string }; Returns: Json };

      /* ---------------- 0026 full-text search ---------------- */
      search_products: {
        Args: {
          p_query?: string | null;
          p_category?: string | null;
          p_city?: string | null;
          p_grade?: string | null;
          p_kind?: string | null;
          p_vendor_id?: string | null;
          p_min_naira?: number | null;
          p_max_naira?: number | null;
          p_sort?: string | null;
          p_limit?: number | null;
          p_offset?: number | null;
        };
        Returns: Json;
      };

      /* ---------------- 0027 rate limiting ---------------- */
      check_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number };
        Returns: Json;
      };
      prune_rate_limits: { Args: { p_older_than_minutes?: number }; Returns: Json };
      upload_within_limits: {
        Args: { p_metadata: Json; p_max_bytes: number; p_allowed_mime_prefixes: string[] };
        Returns: boolean;
      };

      /* ---------------- 0029 push subscriptions ---------------- */
      mark_push_delivery: {
        Args: { p_endpoint: string; p_drop?: boolean };
        Returns: Json;
      };
      list_push_endpoints: { Args: { p_profile_id: string }; Returns: Json };

      /* ------------- 0031/0032 privilege + storage hardening ------------- */
      /**
       * Policy helper: does the caller own this order? SECURITY DEFINER so the
       * `dispute-evidence` bucket policies can be evaluated by a role with no
       * SELECT on `orders` (anon) — the same reason `is_admin()` is granted to
       * anon in 0017. Never called from app code.
       */
      is_own_order: { Args: { p_order_id: string | null }; Returns: boolean };
      /** BEFORE UPDATE guard on profiles/vendor_profiles/products; trigger-only. */
      guard_protected_columns: { Args: Record<string, never>; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** Canonical typed client. Apps must use this — never `SupabaseClient<any>`. */
export type DbClient = SupabaseClient<Database>;
