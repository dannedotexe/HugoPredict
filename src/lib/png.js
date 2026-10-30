'use strict';

const zlib = require('node:zlib');

/*
 * Minimaler PNG-Codec für die eigenen Icons (8 Bit RGBA, ohne Interlacing).
 * Reicht, um Rollen-Icons in die jeweilige Rollenfarbe umzufärben, ohne ein
 * Bildpaket zu installieren.
 */

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('Keine PNG-Datei.');
  let width = 0;
  let height = 0;
  const idat = [];
  for (let off = 8; off < buf.length;) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('Nur 8-Bit-RGBA-PNGs ohne Interlacing werden unterstützt.');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, pixels };
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng({ width, height, pixels }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); // Filter 0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Färbt ein Icon (heller Strich auf dunkler Kachel) in eine Farbe um, macht die
 * Kachel samt Rand durchsichtig und schneidet quadratisch auf das Symbol zu,
 * damit es auch als winziges Rollen-Icon gut erkennbar ist. Kanten bleiben weich.
 * Mit zwei Farben entsteht ein Verlauf von links nach rechts (wie bei
 * Discord-Rollen mit Farbverlauf).
 */
function tintIcon(buf, color, secondColor = null) {
  const img = decodePng(buf);
  const rgb = (c) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
  const from = rgb(color);
  const to = rgb(secondColor ?? color);
  const p = img.pixels;
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  // Der helle Kachelrand liegt am Bildrand, das Symbol in der Mitte.
  const margin = Math.round(Math.min(img.width, img.height) * 0.1);
  for (let i = 0; i < p.length; i += 4) {
    const px = (i / 4) % img.width;
    const py = Math.floor(i / 4 / img.width);
    const inside = px >= margin && py >= margin && px < img.width - margin && py < img.height - margin;
    // Helligkeit zwischen Kachel (dunkel) und Strich (hell) → Deckkraft
    const level = Math.max(p[i], p[i + 1], p[i + 2]);
    // Halbtransparente Pixel gehören zum Kachelrand, nicht zum Symbol.
    const weight = inside && p[i + 3] === 255 ? Math.min(1, Math.max(0, (level - 80) / (180 - 80))) : 0;
    p[i + 3] = Math.round(p[i + 3] * weight);
    if (p[i + 3] > 8) {
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  }
  if (maxX < 0) return encodePng(img);
  // Farbe bzw. Verlauf über die Breite des Symbols
  for (let i = 0; i < p.length; i += 4) {
    const t = maxX > minX ? Math.min(1, Math.max(0, ((i / 4) % img.width - minX) / (maxX - minX))) : 0;
    for (let k = 0; k < 3; k++) p[i + k] = Math.round(from[k] + (to[k] - from[k]) * t);
  }
  const size = Math.max(maxX - minX, maxY - minY) + 1;
  const side = Math.min(Math.max(img.width, img.height), Math.ceil(size * 1.12));
  const offX = Math.round(minX - (side - (maxX - minX + 1)) / 2);
  const offY = Math.round(minY - (side - (maxY - minY + 1)) / 2);
  const out = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const sx = x + offX;
      const sy = y + offY;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      p.copy(out, (y * side + x) * 4, (sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4);
    }
  }
  return encodePng({ width: side, height: side, pixels: out });
}

module.exports = { decodePng, encodePng, tintIcon };
