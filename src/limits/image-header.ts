// Image header parse and metadata strip (PRD 6.2, D-87). Pure: bytes in, numbers or bytes out; no decoder, no
// dependency. Written from the rules in tools/uploadlib.py's docstring; fixtures/uploads/cases.json is the oracle.
// ponytail: the cap applies to the size the header CLAIMS. A decoder that disagrees with its own header, and APNG
// frames (bounded by the canvas by spec, unchecked here), are not modelled. A thumbnailer behind the D-51 seam would
// re-check after decoding.
export type ImageSize = { width: number; height: number };
export type HeaderRefusal = { reason: 'bad_signature' | 'bad_marker' | 'truncated' | 'ihdr_not_first' | 'no_sof' | 'two_sof' | 'unknown_chunk' | 'zero_dimension' | 'too_many_pixels'; width?: number; height?: number };
export type HeaderVerdict = ({ verdict: 'allow' } & ImageSize) | ({ verdict: 'refuse' } & HeaderRefusal);

class Bad extends Error {
  constructor(readonly reason: HeaderRefusal['reason']) {
    super(reason);
  }
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const standalone = (m: number) => m === 0x01 || (m >= 0xd0 && m <= 0xd7); // TEM, RSTn

function png(b: Uint8Array): ImageSize {
  if (b.length < 16 || PNG_SIG.some((x, i) => b[i] !== x)) throw new Bad('bad_signature');
  if (ascii(b, 12, 4) !== 'IHDR') throw new Bad('ihdr_not_first');
  if (view(b).getUint32(8) !== 13 || b.length < 29) throw new Bad('truncated');
  return { width: view(b).getUint32(16), height: view(b).getUint32(20) };
}

function jpeg(b: Uint8Array): ImageSize {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Bad('bad_signature');
  let i = 2;
  let size: ImageSize | null = null;
  for (;;) {
    if (i >= b.length) throw new Bad('truncated');
    if (b[i] !== 0xff) throw new Bad('bad_marker');
    while (i < b.length && b[i] === 0xff) i++;
    if (i >= b.length) throw new Bad('truncated');
    const m = b[i++]!;
    if (standalone(m)) continue;
    if (m === 0xda) {
      if (!size) throw new Bad('no_sof');
      return size;
    }
    if (m === 0xd9) throw new Bad(size ? 'truncated' : 'no_sof');
    if (i + 2 > b.length) throw new Bad('truncated');
    const n = view(b).getUint16(i);
    if (n < 2 || i + n > b.length) throw new Bad('truncated');
    if (SOF.has(m)) {
      if (size) throw new Bad('two_sof');
      if (n < 7) throw new Bad('truncated');
      size = { height: view(b).getUint16(i + 3), width: view(b).getUint16(i + 5) };
    }
    i += n;
  }
}

function webp(b: Uint8Array): ImageSize {
  if (b.length < 20 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') throw new Bad('bad_signature');
  const tag = ascii(b, 12, 4);
  const p = b.subarray(20);
  const v = view(p);
  if (tag === 'VP8 ') {
    if (p.length < 10) throw new Bad('truncated');
    if (p[3] !== 0x9d || p[4] !== 0x01 || p[5] !== 0x2a) throw new Bad('bad_marker');
    return { width: v.getUint16(6, true) & 0x3fff, height: v.getUint16(8, true) & 0x3fff };
  }
  if (tag === 'VP8L') {
    if (p.length < 5) throw new Bad('truncated');
    if (p[0] !== 0x2f) throw new Bad('bad_marker');
    const bits = v.getUint32(1, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (tag === 'VP8X') {
    if (p.length < 10) throw new Bad('truncated');
    const u24 = (at: number) => p[at]! | (p[at + 1]! << 8) | (p[at + 2]! << 16);
    return { width: u24(4) + 1, height: u24(7) + 1 };
  }
  throw new Bad('unknown_chunk');
}

const PARSERS: Record<string, (b: Uint8Array) => ImageSize> = { 'image/png': png, 'image/jpeg': jpeg, 'image/webp': webp };

/** The size the container header claims, checked against max_pixels. An unknown mime is the caller's refusal. */
export function readImageHeader(mime: string, bytes: Uint8Array, maxPixels: number): HeaderVerdict {
  const parse = PARSERS[mime];
  if (!parse) return { verdict: 'refuse', reason: 'bad_signature' };
  let s: ImageSize;
  try {
    s = parse(bytes);
  } catch (e) {
    if (e instanceof Bad) return { verdict: 'refuse', reason: e.reason };
    throw e;
  }
  if (s.width === 0 || s.height === 0) return { verdict: 'refuse', reason: 'zero_dimension', ...s };
  if (s.width * s.height > maxPixels) return { verdict: 'refuse', reason: 'too_many_pixels', ...s };
  return { verdict: 'allow', ...s };
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

function stripPng(b: Uint8Array): Uint8Array {
  const keep = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const end = i + 12 + view(b).getUint32(i);
    if (end > b.length) break;
    if (!['eXIf', 'tEXt', 'iTXt', 'zTXt'].includes(ascii(b, i + 4, 4))) keep.push(b.subarray(i, end));
    i = end;
  }
  return concat([...keep, b.subarray(i)]);
}

function stripJpeg(b: Uint8Array): Uint8Array {
  const keep = [b.subarray(0, 2)];
  let i = 2;
  while (i < b.length) {
    let j = i;
    while (j < b.length && b[j] === 0xff) j++;
    if (j >= b.length || j === i) break;
    const m = b[j]!;
    if (standalone(m)) {
      keep.push(b.subarray(i, j + 1));
      i = j + 1;
      continue;
    }
    if (m === 0xda || m === 0xd9 || j + 3 > b.length) break;
    const end = j + 1 + view(b).getUint16(j + 1);
    if (end > b.length) break;
    if (m !== 0xe1) keep.push(b.subarray(i, end)); // APP1 holds Exif and XMP
    i = end;
  }
  return concat([...keep, b.subarray(i)]);
}

function stripWebp(b: Uint8Array): Uint8Array {
  const keep = [b.subarray(0, 12)];
  let i = 12;
  while (i + 8 <= b.length) {
    const n = view(b).getUint32(i + 4, true);
    const end = i + 8 + n + (n & 1);
    if (end > b.length) break;
    const tag = ascii(b, i, 4);
    if (tag === 'VP8X' && n >= 1) {
      const c = b.slice(i, end);
      c[8] = c[8]! & ~0x0c; // clear the EXIF (0x08) and XMP (0x04) flags
      keep.push(c);
    } else if (tag !== 'EXIF' && tag !== 'XMP ') keep.push(b.subarray(i, end));
    i = end;
  }
  const out = concat([...keep, b.subarray(i)]);
  view(out).setUint32(4, out.length - 8, true);
  return out;
}

const STRIPPERS: Record<string, (b: Uint8Array) => Uint8Array> = { 'image/png': stripPng, 'image/jpeg': stripJpeg, 'image/webp': stripWebp };

/** Drops metadata containers (EXIF, XMP, PNG text chunks); pixels and structure are copied byte for byte. Call
 *  only on bytes readImageHeader allowed. */
export const stripMetadata = (mime: string, bytes: Uint8Array): Uint8Array => STRIPPERS[mime]!(bytes);
