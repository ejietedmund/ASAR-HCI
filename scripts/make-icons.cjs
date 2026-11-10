const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const navy = [30, 58, 138, 255];
  const white = [255, 255, 255, 255];
  const accent = [37, 99, 235, 255];
  const page = [240, 242, 247, 255];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = navy;
      const pageX0 = size * 0.22;
      const pageX1 = size * 0.78;
      const pageY0 = size * 0.16;
      const pageY1 = size * 0.84;
      if (inRoundedRect(x + 0.5, y + 0.5, pageX0, pageY0, pageX1, pageY1, size * 0.04)) {
        color = page;
        const barX0 = size * 0.3;
        const barX1 = size * 0.7;
        const bars = [0.32, 0.42, 0.52, 0.62];
        for (let i = 0; i < bars.length; i++) {
          const by0 = size * bars[i];
          const by1 = by0 + size * 0.045;
          const end = i === 0 ? size * 0.55 : barX1;
          if (x >= barX0 && x <= end && y >= by0 && y <= by1) {
            color = i === 0 ? accent : navy;
          }
        }
      }
      const offset = (y * size + x) * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = color[3];
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = process.argv[2] || path.join(__dirname, 'public');
fs.writeFileSync(path.join(outDir, 'icon-192.png'), makeIcon(192));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), makeIcon(512));
console.log('icons written to', outDir);
