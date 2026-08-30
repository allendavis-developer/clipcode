/* ============================================================================
   A PNG reader, so a check can count PIXELS rather than bytes.

   test.mjs measures "is it lit" by counting bytes above 200 in the compressed
   screenshot. That is a fine smoke test — a blank frame compresses to almost
   nothing — but it cannot answer the question a mask asks, which is "how much
   of the thing is showing". A half-revealed headline and a fully revealed one
   compress to similar sizes; their lit AREAS differ by a factor of two.

   So this inflates the IDAT and undoes the per-scanline filters. No
   dependency: zlib is Node's own, and Chromium's screenshots are 8-bit
   non-interlaced RGB or RGBA, which is the only case handled.
   ========================================================================== */
import zlib from 'zlib';

export function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let p = 8, w = 0, h = 0, depth = 0, type = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), tag = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (tag === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      depth = body[8]; type = body[9];
      if (depth !== 8 || (type !== 2 && type !== 6)) throw new Error(`png ${depth}-bit type ${type} unsupported`);
      if (body[12] !== 0) throw new Error('interlaced png unsupported');
    } else if (tag === 'IDAT') idat.push(body);
    else if (tag === 'IEND') break;
    p += 12 + len;
  }
  const ch = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * ch);
  const stride = w * ch;
  /* Undo the filter each scanline chose. `a` is the pixel to the left, `b` the
     one above, `c` the one above-left — all zero off the edges. */
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[y * stride + i - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = (i >= ch && y > 0) ? out[(y - 1) * stride + i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[y * stride + i] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

/** How many pixels are brighter than `min` on every channel. */
export function lit(buf, min = 140) {
  const im = decode(buf);
  let n = 0;
  for (let i = 0; i < im.data.length; i += im.ch)
    if (im.data[i] > min && im.data[i + 1] > min && im.data[i + 2] > min) n++;
  return n;
}

/** The colour at one pixel, as [r, g, b]. */
export function at(buf, x, y) {
  const im = decode(buf), i = (y * im.w + x) * im.ch;
  return [im.data[i], im.data[i + 1], im.data[i + 2]];
}

/** The bounding box of everything brighter than `min`, or null if nothing is. */
export function bounds(buf, min = 140) {
  const im = decode(buf);
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const i = (y * im.w + x) * im.ch;
    if (im.data[i] > min && im.data[i + 1] > min && im.data[i + 2] > min) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** How many pixels are darker than `max` on every channel. */
export function dark(buf, max = 90) {
  const im = decode(buf);
  let n = 0;
  for (let i = 0; i < im.data.length; i += im.ch)
    if (im.data[i] < max && im.data[i + 1] < max && im.data[i + 2] < max) n++;
  return n;
}

/** How many pixels have channel `a` at least `by` above channel `b`. */
export function leaning(buf, a, b, by = 40) {
  const im = decode(buf);
  let n = 0;
  for (let i = 0; i < im.data.length; i += im.ch)
    if (im.data[i + a] - im.data[i + b] >= by) n++;
  return n;
}

/** The size of a decoded image, without walking its pixels. */
export function size(buf) { const im = decode(buf); return { w: im.w, h: im.h }; }
