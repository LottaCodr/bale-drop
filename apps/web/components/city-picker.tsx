"use client";

import { MapPin } from "lucide-react";
import { CITIES } from "@/lib/taxonomy";
import { useDeliveryCity } from "@/lib/store/hooks";
import { usePrefsStore } from "@/lib/store/prefs-store";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * Delivery city selector. It is a *preference* (drives estimates and the
 * checkout default), not an order field — the address on the order is what
 * fulfillment uses, so changing it here can never silently reroute a parcel.
 */
export function CityPicker({ className }: { className?: string }) {
  const city = useDeliveryCity();
  const setCity = usePrefsStore((state) => state.setCity);

  return (
    <label className={cn("relative hidden items-center gap-1 rounded-full pl-2.5 lg:flex", className)}>
      <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
      <span className="sr-only">Delivery city</span>
      <select
        value={city}
        onChange={(event) => {
          setCity(event.target.value);
          track("view_search_results", { filter_city: event.target.value, source: "city_picker" });
        }}
        className="h-9 cursor-pointer appearance-none rounded-full bg-transparent pr-6 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {CITIES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
