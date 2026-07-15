// アイコンPNGを作り直すスクリプト。`node scripts/make-icons.mjs` で icons/ に出力する。
// 依存パッケージを増やしたくないので、PNGは自前で組み立てている。

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const BG = [196, 85, 47];      // --accent
const FG = [255, 255, 255];

// 100×100 の座標系で描いた稲妻。⚡＝「今！」の思いつきを表す。
const BOLT = [[60, 6], [25, 56], [46, 56], [38, 96], [76, 44], [54, 44], [61, 6]];

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 角丸の内側かどうか。r は size に対する比率。 */
function inRoundRect(x, y, size, r) {
  const rad = size * r;
  const cx = Math.min(Math.max(x, rad), size - rad);
  const cy = Math.min(Math.max(y, rad), size - rad);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= rad * rad;
}

/**
 * @param {number} size 出力ピクセル数
 * @param {number} radius 角丸の比率（0=四角、0.5=円）
 * @param {number} boltScale 稲妻の大きさ（1=キャンバスいっぱい）
 */
function render(size, radius, boltScale) {
  const px = new Uint8Array(size * size * 4);
  const S = 3; // 3×3 のスーパーサンプリングでギザギザを消す
  const off = (1 - boltScale) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      let fgHits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const fx = x + (sx + 0.5) / S;
          const fy = y + (sy + 0.5) / S;
          if (!inRoundRect(fx, fy, size, radius)) continue;
          bgHits++;
          // キャンバス座標 → 稲妻の 100×100 座標
          const bx = ((fx / size - off) / boltScale) * 100;
          const by = ((fy / size - off) / boltScale) * 100;
          if (pointInPolygon(bx, by, BOLT)) fgHits++;
        }
      }
      const total = S * S;
      const i = (y * size + x) * 4;
      const alpha = bgHits / total;
      if (alpha === 0) continue;
      const fgRatio = fgHits / Math.max(1, bgHits);
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(BG[c] * (1 - fgRatio) + FG[c] * fgRatio);
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

// ---- PNG エンコーダ（8bit RGBA、フィルタなし） ----

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
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: None
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });

const jobs = [
  ['icon-192.png', 192, 0.22, 0.78],
  ['icon-512.png', 512, 0.22, 0.78],
  ['icon-180.png', 180, 0.0, 0.78],   // iOSは自分で角を丸めるので四角のまま
  ['icon-maskable-512.png', 512, 0.0, 0.56], // 端が切られるので中央に小さめ
];

for (const [name, size, radius, scale] of jobs) {
  writeFileSync(join(OUT, name), encodePNG(render(size, radius, scale), size));
  console.log('wrote', name, `${size}x${size}`);
}
