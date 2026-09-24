/** @type {import('next').NextConfig} */
const nextConfig = {
  // Shared workspace packages are shipped as TypeScript source and compiled by Next.
  transpilePackages: ["@bale-drop/database"],
  // No remote images in MVP prototype: all art is local CSS/SVG (fast + offline-safe).
  images: { remotePatterns: [] },
  // Boot-time configuration check lives in instrumentation.ts (stable in Next 15):
  // it warns loudly when production would serve the demo dataset instead of Supabase.
  poweredByHeader: false,
};

export default nextConfig;
