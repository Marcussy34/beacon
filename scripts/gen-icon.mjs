#!/usr/bin/env node
// Generate Beacon's monochrome menu-bar template icons from the favicon ring geometry.
// No deps: draws an RGBA buffer (supersampled for smooth edges) and encodes a PNG via zlib.
//
// macOS template images use ONLY the alpha channel (it tints by alpha for light/dark menu bars),
// so RGB is fixed black and the shape lives entirely in alpha. Geometry mirrors
// website/public/favicon.svg (viewBox 32): inner filled dot r=7 (tint 1.0) + outer ring r=12,
// stroke 2 (tint 0.4 — matches the favicon's stroke-opacity).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SS = 4; // supersample factor for anti-aliasing

// Favicon units (viewBox 0..32), center 16,16.
const CENTER = 16;
const DOT_R = 7;          // inner filled dot
const RING_R = 12;        // outer ring radius
const RING_HALF = 1;      // stroke-width 2 → half-width 1
const RING_TINT = 0.4;    // favicon stroke-opacity

// Per-(sub)pixel coverage tint at favicon-space distance d from center.
function tintAt(d) {
  if (d <= DOT_R) return 1;
  if (Math.abs(d - RING_R) <= RING_HALF) return RING_TINT;
  return 0;
}

// Build an RGBA buffer (black, alpha = supersampled coverage) for an N×N icon.
function renderRGBA(n) {
  const buf = Buffer.alloc(n * n * 4); // zero-filled = transparent black
  const unit = 32 / (n * SS); // favicon units per supersample pixel
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let acc = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = (x * SS + sx + 0.5) * unit - CENTER;
          const fy = (y * SS + sy + 0.5) * unit - CENTER;
          acc += tintAt(Math.hypot(fx, fy));
        }
      }
      const alpha = Math.round((acc / (SS * SS)) * 255);
      const i = (y * n + x) * 4;
      buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = alpha;
    }
  }
  return buf;
}

// --- Minimal PNG encoder (RGBA, no filtering) -------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(n, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compression/filter/interlace
  // Prefix each scanline with filter byte 0 (none).
  const stride = n * 4;
  const raw = Buffer.alloc((stride + 1) * n);
  for (let y = 0; y < n; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function write(n, name) {
  const out = join(ROOT, 'resources', name);
  writeFileSync(out, encodePNG(n, renderRGBA(n)));
  console.log(`wrote ${name} (${n}×${n})`);
}

write(16, 'iconTemplate.png');
write(32, 'iconTemplate@2x.png');
