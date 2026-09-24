import type { MetadataRoute } from "next";

/**
 * PWA manifest (ADR-001: web ships first as a mobile-first PWA so store review
 * never blocks launch). Installable, standalone, with the two commerce
 * shortcuts a returning buyer actually uses.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bale Drop — Trusted Okirika, Split Bales",
    short_name: "Bale Drop",
    description:
      "Buy verified Okirika bales and single pieces with escrow protection. Split full bales with other buyers and pay per slot.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf7f2",
    theme_color: "#167454",
    lang: "en-NG",
    dir: "ltr",
    categories: ["shopping", "lifestyle"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Live bale splits", url: "/search?kind=bale", description: "Join a split before it fills" },
      { name: "My cart", url: "/cart", description: "Resume checkout" },
      { name: "Track orders", url: "/orders", description: "Delivery status and escrow" },
    ],
  };
}
