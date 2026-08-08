/**
 * Generates the app icons as PNGs with no dependencies.
 *
 * The mark is the equals key: two white bars on the accent background. Run with
 * `node tools/make-icons.mjs` after changing the accent colour; the output is
 * committed so GitHub Pages can serve it.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0x1c, 0x3f, 0x77];
const FG = [0xff, 0xff, 0xff];

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = draw(x, y) ? FG : BG;
      const p = row + 1 + x * 4;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Two rounded bars, centred. `scale` shrinks them for the maskable safe zone. */
function equalsMark(size, scale) {
  const w = size * 0.46 * scale;
  const h = size * 0.085 * scale;
  const gap = size * 0.12 * scale;
  const r = h / 2;
  const x0 = (size - w) / 2;
  const cy = size / 2;
  const bars = [cy - gap / 2 - h / 2, cy + gap / 2 + h / 2];

  return (x, y) => bars.some((by) => {
    const top = by - h / 2;
    const dy = y + 0.5 - by;
    if (Math.abs(dy) > h / 2) return false;
    const dx = x + 0.5 - x0;
    if (dx < 0 || dx > w) return false;
    if (dx >= r && dx <= w - r) return true;
    const cx = dx < r ? r : w - r;
    return (dx - cx) ** 2 + dy ** 2 <= r * r;
  });
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });

const targets = [
  ['icon-180.png', 180, 1],
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.72],
];

for (const [name, size, scale] of targets) {
  const out = new URL(`../icons/${name}`, import.meta.url);
  writeFileSync(out, png(size, equalsMark(size, scale)));
  console.log(`${name}  ${size}x${size}`);
}
