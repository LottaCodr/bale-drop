import { OrdersClient } from "./orders-client";
import { ServiceUnavailable } from "@/components/service-unavailable";
import { isSupabaseLive } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function OrdersPage() {
  if (!isSupabaseLive()) return <ServiceUnavailable title="Orders are temporarily unavailable" />;
  return <OrdersClient />;
}
