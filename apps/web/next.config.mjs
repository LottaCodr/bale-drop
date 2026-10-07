/** @type {import('next').NextConfig} */

/**
 * Seller photos live in the public-read `product-images` bucket (migration
 * 0003), so `next/image` needs that host allow-listed. It was empty, which is
 * why every listing rendered generated gradient art even when a photo existed.
 *
 * The project URL is known at build time; the wildcard is the fallback so a
 * deployment that reads the URL from a runtime env still renders photos.
 */
function storageHosts() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    if (url) return [{ protocol: "https", hostname: new URL(url).hostname }];
  } catch {
    // fall through to the wildcard
  }
  return [{ protocol: "https", hostname: "**.supabase.co" }];
}

const nextConfig = {
  // Shared workspace packages are shipped as TypeScript source and compiled by Next.
  transpilePackages: ["@bale-drop/database"],
  images: {
    remotePatterns: storageHosts(),
    // Fixed sizes match the card/listing aspect ratios; no arbitrary widths.
    deviceSizes: [360, 480, 640, 828, 1080],
  },
  // Boot-time configuration check lives in instrumentation.ts (stable in Next 15):
  // it warns loudly when production would serve the demo dataset instead of Supabase.
  poweredByHeader: false,
};

export default nextConfig;
