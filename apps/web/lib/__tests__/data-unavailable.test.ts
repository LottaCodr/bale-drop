import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { getHomeData, getListingData, getProductReviews, getProductsByIds, getVendorStorefront, searchCatalog } from "@/lib/data";
import { isSupabaseLive } from "@/lib/config";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
});

describe("unconfigured storefront", () => {
  it("requires both public database settings", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    expect(isSupabaseLive()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "YOUR_ANON_KEY");
    expect(isSupabaseLive()).toBe(false);
  });

  it("does not show example inventory, vendors, reviews or orderable products", async () => {
    expect(await getHomeData()).toEqual({ bales: [], products: [], vendors: [] });
    expect(await searchCatalog({})).toMatchObject({ results: [], splits: [], vendors: [], total: 0 });
    expect(await getListingData("p1")).toBeNull();
    expect(await getVendorStorefront("v1")).toBeNull();
    expect((await getProductReviews("p1")).reviews).toEqual([]);
    expect((await getProductsByIds(["p1"])).size).toBe(0);
  });
});
