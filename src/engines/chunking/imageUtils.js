const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      BASE64_CHARS[(triple >> 18) & 63] +
      BASE64_CHARS[(triple >> 12) & 63] +
      BASE64_CHARS[(triple >> 6) & 63] +
      BASE64_CHARS[triple & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const value = bytes[i] << 16;
    out += BASE64_CHARS[(value >> 18) & 63] + BASE64_CHARS[(value >> 12) & 63] + '==';
  } else if (remaining === 2) {
    const value = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += BASE64_CHARS[(value >> 18) & 63] + BASE64_CHARS[(value >> 12) & 63] + BASE64_CHARS[(value >> 6) & 63] + '=';
  }
  return out;
}

export function bytesToDataUrl(bytes, mime) {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function writeUint32BE(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  writeUint32BE(out, 0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  writeUint32BE(out, 8 + data.length, crc32(crcInput));
  return out;
}

export function encodePngStored(width, height, rgba) {
  const stride = 1 + width * 4;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }

  const blocks = [];
  const MAX = 65535;
  for (let offset = 0; offset < raw.length; offset += MAX) {
    const slice = raw.subarray(offset, Math.min(offset + MAX, raw.length));
    const isFinal = offset + MAX >= raw.length ? 1 : 0;
    const header = new Uint8Array(5 + slice.length);
    header[0] = isFinal;
    header[1] = slice.length & 0xff;
    header[2] = (slice.length >> 8) & 0xff;
    header[3] = ~slice.length & 0xff;
    header[4] = (~slice.length >> 8) & 0xff;
    header.set(slice, 5);
    blocks.push(header);
  }

  const zlibData = new Uint8Array(2 + blocks.reduce((sum, block) => sum + block.length, 0) + 4);
  zlibData[0] = 0x78;
  zlibData[1] = 0x01;
  let cursor = 2;
  for (const block of blocks) {
    zlibData.set(block, cursor);
    cursor += block.length;
  }
  writeUint32BE(zlibData, cursor, adler32(raw));

  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlibData), pngChunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  cursor = 0;
  for (const part of parts) {
    png.set(part, cursor);
    cursor += part.length;
  }
  return png;
}

const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

function toRgba(image) {
  const { width, height, kind, data } = image;
  if (!width || !height || !data) return null;
  if (kind === RGBA_32BPP && data.length >= width * height * 4) {
    return new Uint8ClampedArray(data.subarray(0, width * height * 4));
  }
  if (kind === RGB_24BPP && data.length >= width * height * 3) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < width * height; i += 1, j += 3) {
      rgba[i * 4] = data[j];
      rgba[i * 4 + 1] = data[j + 1];
      rgba[i * 4 + 2] = data[j + 2];
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }
  if (kind === GRAYSCALE_1BPP) {
    const stride = Math.ceil(width / 8);
    if (data.length < stride * height) return null;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bit = (data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
        const value = bit ? 255 : 0;
        const at = (y * width + x) * 4;
        rgba[at] = value;
        rgba[at + 1] = value;
        rgba[at + 2] = value;
        rgba[at + 3] = 255;
      }
    }
    return rgba;
  }
  if (!kind && data.length === width * height * 4) {
    return new Uint8ClampedArray(data.subarray(0, width * height * 4));
  }
  if (!kind && data.length === width * height * 3) {
    return toRgba({ ...image, kind: RGB_24BPP });
  }
  return null;
}

export function imageObjToDataUrl(image) {
  if (!image || image.imageMask) return null;
  const { width, height } = image;
  const hasCanvas =
    typeof document !== 'undefined' && typeof ImageData !== 'undefined';
  if (hasCanvas && image.bitmap && typeof image.bitmap.width === 'number') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width || image.bitmap.width;
      canvas.height = height || image.bitmap.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(image.bitmap, 0, 0);
        return canvas.toDataURL('image/png');
      }
    } catch {
      /* fall through to pixel decoding */
    }
  }
  const rgba = toRgba(image);
  if (!rgba) return null;
  if (hasCanvas) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
        return canvas.toDataURL('image/png');
      }
    } catch {
      /* fall through to the pure-JS encoder */
    }
  }
  return bytesToDataUrl(encodePngStored(width, height, rgba), 'image/png');
}
