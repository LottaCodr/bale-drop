/**
 * Fulfillment adapter. In test mode it creates a deterministic Bale Drop
 * tracking number; a provider adapter can replace createShipment without
 * changing order state transitions.
 */
import {
  adminClient,
  authenticatedUser,
  cors,
  json,
  profile,
} from "../_shared/auth.ts";

function testTracking(orderId: string): { number: string; url: string } {
  return {
    number: `BDX-${orderId.replaceAll("-", "").slice(0, 10).toUpperCase()}`,
    url: `https://track.baledrop.demo/BDX-${
      orderId.replaceAll("-", "").slice(0, 10).toUpperCase()
    }`,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "method not allowed" }, 405);
  }

  const db = adminClient();
  const { user, error: authError } = await authenticatedUser(req, db);
  if (!user) return json(req, { error: authError }, 401);

  try {
    const body = await req.json() as { order_id?: string; provider?: string };
    if (!body.order_id) {
      return json(req, { error: "order_id is required" }, 400);
    }
    const actor = await profile(db, user.id);
    const { data: order, error: orderError } = await db.from("orders").select(
      "*",
    ).eq("id", body.order_id).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return json(req, { error: "order not found" }, 404);
    const { data: vendor } = await db.from("vendor_profiles").select(
      "id, profile_id",
    ).eq("id", order.vendor_id).maybeSingle();
    const permitted = actor?.role === "admin" || vendor?.profile_id === user.id;
    if (!permitted) {
      return json(req, { error: "vendor or admin access required" }, 403);
    }
    if (!["paid", "processing", "ready"].includes(order.status)) {
      return json(req, { error: "order is not ready for dispatch" }, 409);
    }

    const dispatchEventId = `dispatch-${order.id}`;
    const { data: existingEvent, error: existingEventError } = await db
      .from("fulfillment_events")
      .select("order_id, tracking_number, tracking_url, status")
      .eq("external_event_id", dispatchEventId)
      .maybeSingle();
    if (existingEventError) throw existingEventError;
    if (existingEvent) {
      const replay = await db.rpc("set_order_fulfillment_status", {
        p_order_id: order.id,
        p_vendor_profile_id: order.vendor_id,
        p_status: "in_transit",
        p_tracking_number: existingEvent.tracking_number,
        p_tracking_url: existingEvent.tracking_url,
      });
      if (replay.error) throw replay.error;
      return json(req, { ok: true, ...existingEvent, duplicate: true });
    }

    // The adapter deliberately defaults to a sandbox tracking object until a
    // logistics provider contract/key is configured.
    const shipment = testTracking(order.id);
    const { error: eventError } = await db.from("fulfillment_events").insert({
      order_id: order.id,
      provider: body.provider || "bale_drop_sandbox",
      external_event_id: dispatchEventId,
      status: "in_transit",
      tracking_number: shipment.number,
      tracking_url: shipment.url,
      payload: { mode: "sandbox", actor: user.id },
    });
    if (eventError) {
      // Two admin/vendor clicks can race after both read an empty event. The
      // unique external_event_id is the arbiter; return the winner's shipment
      // without sending a second notification or state transition.
      const { data: raceWinner } = await db.from("fulfillment_events").select(
        "order_id, tracking_number, tracking_url, status",
      ).eq("external_event_id", dispatchEventId).maybeSingle();
      if (raceWinner) {
        const replay = await db.rpc("set_order_fulfillment_status", {
          p_order_id: order.id,
          p_vendor_profile_id: order.vendor_id,
          p_status: "in_transit",
          p_tracking_number: raceWinner.tracking_number,
          p_tracking_url: raceWinner.tracking_url,
        });
        if (replay.error) throw replay.error;
        return json(req, { ok: true, ...raceWinner, duplicate: true });
      }
      throw eventError;
    }

    const statusResult = await db.rpc("set_order_fulfillment_status", {
      p_order_id: order.id,
      p_vendor_profile_id: order.vendor_id,
      p_status: "in_transit",
      p_tracking_number: shipment.number,
      p_tracking_url: shipment.url,
    });
    if (statusResult.error) {
      await db.from("fulfillment_events").delete().eq(
        "external_event_id",
        dispatchEventId,
      );
      throw statusResult.error;
    }
    return json(req, {
      ok: true,
      order_id: order.id,
      tracking_number: shipment.number,
      tracking_url: shipment.url,
    });
  } catch (error) {
    console.error("logistics-create:", error);
    return json(req, {
      error: error instanceof Error
        ? error.message
        : "Could not create shipment",
    }, 400);
  }
});
