#!/usr/bin/env node
/**
 * Generates the PWA icon set with zero image dependencies.
 *
 * Why hand-rolled: the icon is brand geometry (a bale/cube on brand green), so
 * drawing it in code keeps it reproducible, reviewable in a diff, and free of
 * the binary-blob build tooling a designer handoff would need. Run with:
 *
 *   node scripts/generate-icons.mjs
 *
 * Outputs (committed, referenced by app/manifest.ts):
 *   apps/web/public/icon-192.png
 *   apps/web/public/icon-512.png
 *   apps/web/public/icon-maskable-512.png
 *   apps/web/public/apple-touch-icon.png
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "apps", "web", "public");

/* ---------- brand ---------- */
const BRAND = [0x16, 0x74, 0x54]; // hsl(160 68% 27%) — --primary
const WHITE = [0xff, 0xff, 0xff];
const AMBER = [0xf2, 0xa6, 0x1d]; // --accent
const SHADE = [0x0f, 0x5a, 0x41]; // primary, darkened — cube side face

/* ---------- tiny rasterizer ---------- */
/** Even-odd polygon fill test, in 0..1 normalized coordinates. */
function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundedSquare(x, y, radius) {
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * The mark: a shipping bale (cube) with an amber strap, on a rounded green tile.
 * `padding` shrinks the artwork for maskable icons (safe zone = 80%).
 */
function renderIcon(size, { padding = 0.16, round = 0.22, background = true } = {}) {
  const SS = 4; // supersampling factor
  const px = Buffer.alloc(size * size * 4);

  const cx = 0.5;
  const art = 1 - padding * 2;
  const top = padding + art * 0.06;
  const mid = padding + art * 0.36;
  const bottom = padding + art * 0.86;
  const left = cx - art * 0.36;
  const right = cx + art * 0.36;

  // Cube geometry (top rhombus + two side faces)
  const topFace = [
    [cx, top],
    [right, mid],
    [cx, padding + art * 0.64],
    [left, mid],
  ];
  const leftFace = [
    [left, mid],
    [cx, padding + art * 0.64],
    [cx, bottom],
    [left, mid + (bottom - mid)],
  ];
  const rightFace = [
    [right, mid],
    [cx, padding + art * 0.64],
    [cx, bottom],
    [right, mid + (bottom - mid)],
  ];
  // Amber strap: a horizontal band wrapped around the two side faces.
  const strapTop = padding + art * 0.66;
  const strapBottom = padding + art * 0.77;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px0 = (x + (sx + 0.5) / SS) / size;
          const py0 = (y + (sy + 0.5) / SS) / size;
          let colour = null;
          if (background) {
            if (inRoundedSquare(px0, py0, round)) colour = BRAND;
          } else {
            colour = [0, 0, 0]; // transparent tile, cube only
          }
          if (colour) {
            const onSide = inPolygon(px0, py0, leftFace) || inPolygon(px0, py0, rightFace);
            if (onSide) colour = SHADE;
            if (inPolygon(px0, py0, topFace)) colour = WHITE;
            // The strap sits across the side faces only, never over the lid.
            if (onSide && py0 >= strapTop && py0 <= strapBottom) colour = AMBER;
            r += colour[0];
          r += colour[0];
            g += colour[1];
            b += colour[2];
            a += 255;
          }
        }
      }
      const samples = SS * SS;
      const offset = (y * size + x) * 4;
      const alpha = a / samples;
      // premultiplied average, then un-premultiply to keep edges clean
      px[offset] = alpha ? Math.round(r / (alpha / 255) / samples) : 0;
      px[offset + 1] = alpha ? Math.round(g / (alpha / 255) / samples) : 0;
      px[offset + 2] = alpha ? Math.round(b / (alpha / 255) / samples) : 0;
      px[offset + 3] = Math.round(alpha);
    }
  }
  return px;
}

/* ---------- PNG encoder ---------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- emit ---------- */
mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ["icon-192.png", 192, { padding: 0.16, round: 0.22 }],
  ["icon-512.png", 512, { padding: 0.16, round: 0.22 }],
  ["icon-maskable-512.png", 512, { padding: 0.26, round: 0.5 }],
  ["apple-touch-icon.png", 180, { padding: 0.14, round: 0 }],
];

for (const [name, size, options] of targets) {
  const png = encodePng(size, renderIcon(size, options));
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`✓ ${name} (${size}×${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}
