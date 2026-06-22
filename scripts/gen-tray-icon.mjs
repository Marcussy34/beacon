#!/usr/bin/env node
// Generates Beacon's macOS menu-bar template icons (black pixels + alpha mask; macOS
// auto-inverts for light/dark). Dependency-free PNG encoder (RGBA) via node:zlib.
// Draws a filled "beacon" dot with a soft ring. Run: node scripts/gen-tray-icon.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// CRC32 (PNG uses the standard IEEE table).
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
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Build an RGBA PNG (black pixels, alpha from `alphaAt(x,y)` in 0..255). */
function makePng(size, alphaAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1)); // +1 filter byte per scanline
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw[o++] = 0; raw[o++] = 0; raw[o++] = 0; // black
      raw[o++] = alphaAt(x, y);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // 10,11,12 = compression/filter/interlace = 0
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// A beacon glyph: solid inner dot + a thin outer ring, antialiased by radial coverage.
function alphaForSize(size) {
  const c = (size - 1) / 2;
  const rInner = size * 0.30;   // solid dot radius
  const rRingIn = size * 0.40;  // ring inner
  const rRingOut = size * 0.48; // ring outer
  return (x, y) => {
    const d = Math.hypot(x - c, y - c);
    const dot = Math.max(0, Math.min(1, rInner - d + 0.5));            // 1 inside dot, soft edge
    const ring = Math.max(0, Math.min(1, (rRingOut - d + 0.5))) * Math.max(0, Math.min(1, (d - rRingIn + 0.5)));
    return Math.round(255 * Math.max(dot, ring * 0.85));
  };
}

mkdirSync(join(ROOT, 'resources'), { recursive: true });
writeFileSync(join(ROOT, 'resources', 'iconTemplate.png'), makePng(16, alphaForSize(16)));
writeFileSync(join(ROOT, 'resources', 'iconTemplate@2x.png'), makePng(32, alphaForSize(32)));
console.log('wrote resources/iconTemplate.png (16) + iconTemplate@2x.png (32)');
