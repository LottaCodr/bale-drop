#!/usr/bin/env node
/**
 * Regenerate browser and PWA icons from the supplied Bale Drop bag artwork.
 * Run `npm run icons` after changing public/bale-logo/bale-favicon.jpeg.
 * The square white canvas preserves the complete portrait illustration; the
 * maskable variant keeps it inside the install icon's safe area.
 */
import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public");
const source = join(publicDir, "bale-logo", "bale-favicon.jpeg");

for (const [name, size, fill] of [
  ["favicon.png", 48, 0.94],
  ["icon-192.png", 192, 0.94],
  ["icon-512.png", 512, 0.94],
  ["icon-maskable-512.png", 512, 0.76],
  ["apple-touch-icon.png", 180, 0.94],
]) {
  const inner = Math.round(size * fill);
  const artwork = await sharp(source)
    .resize(inner, inner, { fit: "contain", background: "#ffffff" })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 3, background: "#ffffff" },
  })
    .composite([{ input: artwork, gravity: "centre" }])
    .png()
    .toFile(join(publicDir, name));
  console.log(`✓ ${name} (${size}×${size})`);
}
