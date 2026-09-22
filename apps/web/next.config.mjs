/** @type {import('next').NextConfig} */
const nextConfig = {
  // Shared workspace packages are shipped as TypeScript source and compiled by Next.
  transpilePackages: ["@bale-drop/database"],
  // No remote images in MVP prototype: all art is local CSS/SVG (fast + offline-safe).
  images: { remotePatterns: [] },
};

export default nextConfig;
