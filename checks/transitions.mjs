/* ============================================================================
   TRANSITIONS — the checks.

     PORT=4333 node server.mjs        in one terminal
     node studio/checks/transitions.mjs

   IT MEASURES PIXELS, like test.mjs, and for the same reason: the question a
   person asks of a dissolve is "what colour is the screen half way through",
   and that is not a question the DOM can answer. A layer can carry a perfect
   opacity and still be invisible — behind another layer, outside the stage,
   filtered to nothing — and every DOM-reading check would pass.

   It goes one step further than test.mjs's lit(), which counts bytes over 200
   in the compressed png and is exactly right for "is anything on screen". A
   dissolve needs the actual channel values: clip A is pure red, clip B is pure
   blue, so a real blend is measurably purple and neither original can be
   mistaken for it. That needs decoded pixels, so there is a small png reader
   below — zlib is a node builtin, so this still costs no dependency.

   THE EXPORT IS CHECKED AGAINST THE PREVIEW rather than on its own. The whole
   design is that /render composites with the same stage.js, so the assertion
   worth making is that the two agree frame for frame in the middle of a
   transition — that is what would break if a transition were ever implemented
   anywhere but the paint path.
   ========================================================================== */
import { chromium } from 'playwright';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const B = process.env.STUDIO || 'http://localhost:4333';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'shots');
const P = '_tx';

let failures = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name.padEnd(38)} ${detail}`);
};

const api = (u, m = 'GET', body) => fetch(B + u, body === undefined ? { method: m }
  : { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  .then(r => r.json());

/* ------------------------------------------------------------ png pixels --
   Enough of the format to read what playwright hands back: 8-bit, one image,
   the five scanline filters. Anything else throws rather than lying. */
function decode(buf) {
  let i = 8, w = 0, h = 0, ct = 0, bits = 0;
  const idat = [];
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bits = data[8]; ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    i += 12 + len;
    if (type === 'IEND') break;
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  if (bits !== 8 || !bpp) throw new Error(`png is ${bits}-bit type ${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

const px = (im, x, y) => {
  const o = y * im.w * im.bpp + x * im.bpp;
  return [im.data[o], im.data[o + 1], im.data[o + 2]];
};

/* The average colour of the frame. Both test clips fill it with one flat
   colour, so the mean IS the composite and a blend cannot hide in it. */
function mean(im) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 2; y < im.h - 2; y += 3)
    for (let x = 2; x < im.w - 2; x += 3) {
      const p = px(im, x, y);
      r += p[0]; g += p[1]; b += p[2]; n++;
    }
  return { r: r / n, g: g / n, b: b / n };
}
const say = m => `r${Math.round(m.r)} g${Math.round(m.g)} b${Math.round(m.b)}`;
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* The biggest jump from one pixel to the next along the middle of the frame.
   A hard seam is a big number and a smear is a small one, which is the only
   difference between a push and a whip that a screenshot can see. */
function hardestEdge(im) {
  const y = Math.floor(im.h / 2);
  let worst = 0;
  for (let x = 1; x < im.w; x++) {
    const a = px(im, x - 1, y), b = px(im, x, y);
    worst = Math.max(worst, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  }
  return worst;
}

/* --------------------------------------------------------------- project --
   Two flat, full-frame clips butted together. Flat because a transition is
   about what fraction of each is on screen, and a picture with detail in it
   turns that into a guess. */
const CLIP = colour => `duration(2000);\nbox('bg', { left: 0, top: 0, width: 1920, height: 1080, background: '${colour}' });\n`;

console.log('\nSTUDIO — transitions\n');
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(path.join(HERE, '..', 'projects', P), { recursive: true, force: true });
await api('/api/project/new', 'POST', { name: P });

const A = (await api('/api/clip/new', 'POST', { name: P, title: 'red' })).src;
const Bc = (await api('/api/clip/new', 'POST', { name: P, title: 'blue' })).src;
await api('/api/source', 'PUT', { name: P, src: A, text: CLIP('#ff0000') });
await api('/api/source', 'PUT', { name: P, src: Bc, text: CLIP('#0000ff') });

const tracks = () => [
  { id: 'V1', clips: [
    { id: 'a1', kind: 'code', src: A, start: 0, in: 0, out: 2000 },
    { id: 'b1', kind: 'code', src: Bc, start: 2000, in: 0, out: 2000, trans: trans() }
  ] },
  { id: 'V2', clips: [] }
];
let trans = () => ({ kind: 'dissolve', ms: 400, dir: 'l' });

async function put() { await api('/api/project?name=' + P, 'PUT', { tracks: tracks() }); }
await put();

/* ---- the state survives the round trip through project.json ---- */
{
  const back = (await api('/api/project?name=' + P)).project;
  const t = back.tracks[0].clips[1].trans;
  ok('trans survives project.json', !!t && t.kind === 'dissolve' && t.ms === 400,
     JSON.stringify(t));
}

/* ------------------------------------------------------------------ pages -- */
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('page: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120)); });

async function open() {
  await page.goto(B);
  await page.waitForTimeout(700);
  await page.selectOption('#project', P);
  await page.waitForTimeout(1600);
  errors.length = 0;
}
await open();

/* Scrub on the ruler with a real mouse, like test.mjs: the timeline runs on
   pointer capture, and a synthetic MouseEvent produces no pointer events at
   all — a check that fakes the input stops checking the input. */
const seek = async ms => {
  const box = await page.evaluate(() => {
    const r = document.querySelector('#ruler').getBoundingClientRect();
    return { left: r.left, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.left + (ms / 1000) * 90, box.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(420);
};
const shot = async (file) => {
  const buf = await page.locator('#stageFit').screenshot();
  if (file) fs.writeFileSync(path.join(SHOTS, file), buf);
  return decode(buf);
};
const at = async (ms, file) => { await seek(ms); return shot(file); };

/* ---------------------------------------------------------- the dissolve --
   The cut is at 2000 and the window is the 400ms after it, so 2200 is the
   middle of it and 2200 is where the composite has to be half of each. */
const before = await at(1900, 'dissolve-before.png');
const mid = await at(2200, 'dissolve-mid.png');
const after = await at(2500, 'dissolve-after.png');

ok('before the cut is clip A', before.r > 180 && before.b < 60, say(mean(before)) + ' at 1900ms');
ok('after the window is clip B', after.b > 180 && after.r < 60, say(mean(after)) + ' at 2500ms');
{
  const m = mean(mid);
  const blend = m.r > 60 && m.r < 200 && m.b > 60 && m.b < 200;
  ok('mid-dissolve is a blend of both', blend, say(m) + ' at 2200ms');
  ok('mid-dissolve is neither original', Math.abs(m.r - m.b) < 90,
     `r-b = ${Math.round(m.r - m.b)}`);
  /* the crossfade that does not dip: red + blue at half each should still be
     as much total light as either one on its own */
  ok('no luminance dip in the middle', m.r + m.b > 200,
     `r+b = ${Math.round(m.r + m.b)} vs 255 either side`);
}

/* ------------------------------------------------------------- it is pure --
   Same t, same frame, no matter how the playhead got there. A transition that
   faded over wall-clock time would pass everything above and fail this. */
{
  await seek(3000);
  const back = await at(2200);
  const a = mean(mid), b = mean(back);
  ok('same t from either direction', near(a.r, b.r, 2) && near(a.b, b.b, 2),
     `${say(a)}  ->  ${say(b)}`);
}

/* ------------------------------------------------------------------ shape --
   Every frame of the window, not just the middle: the incoming clip has to
   arrive monotonically or the "transition" is something else with a nice
   middle. */
{
  const blues = [];
  for (let ms = 2000; ms <= 2400; ms += 100) blues.push(mean(await at(ms)).b);
  const climbs = blues.every((v, i) => i === 0 || v >= blues[i - 1] - 2);
  ok('the incoming clip only arrives', climbs, blues.map(v => Math.round(v)).join(' -> '));
}

/* --------------------------------------------------------- dip to black -- */
trans = () => ({ kind: 'dip', ms: 400, dir: 'l' });
await put(); await open();
{
  const m = mean(await at(2200, 'dip-mid.png'));
  ok('dip to black is black in the middle', m.r < 30 && m.g < 30 && m.b < 30, say(m));
  const e = mean(await at(2000));
  ok('dip still starts on clip A', e.r > 150, say(e));
}

/* ---------------------------------------------------------------- push --
   Half way through a leftward push the old picture holds the left of frame
   and the new one holds the right, with one hard seam between them. */
trans = () => ({ kind: 'push', ms: 400, dir: 'l' });
await put(); await open();
let pushEdge = 0;
{
  const im = await at(2200, 'push-mid.png');
  const y = Math.floor(im.h / 2);
  const left = px(im, Math.floor(im.w * 0.15), y);
  const right = px(im, Math.floor(im.w * 0.85), y);
  ok('push holds A on the left', left[0] > 180 && left[2] < 60, `rgb(${left})`);
  ok('push brings B in on the right', right[2] > 180 && right[0] < 60, `rgb(${right})`);
  pushEdge = hardestEdge(im);
  ok('push has one hard seam', pushEdge > 90, `biggest step ${pushEdge}`);
}

/* ----------------------------------------------------------------- whip --
   The same travel, two frames long and smeared. Measured against the push
   above because "is it blurred" is only answerable next to something that is
   not: the same seam, softened, is a much smaller step from pixel to pixel. */
trans = () => ({ kind: 'whip', ms: 400, dir: 'l' });
await put(); await open();
{
  const im = await at(2200, 'whip-mid.png');
  const edge = hardestEdge(im);
  ok('whip smears the seam away', edge < pushEdge / 3, `${edge} vs ${pushEdge} for a push`);
  const m = mean(im);
  ok('whip still swaps the clips', m.b > 30, say(m));
}
/* and the default the palette gives it is two frames, not a third of a second */
{
  const two = await api('/api/project?name=' + P);
  ok('a whip is measured in frames', two.project.fps === 30, `${two.project.fps} fps`);
}

/* ------------------------------------------------------------ the export --
   The render page loads the same stage.js, so a frame from the middle of a
   transition has to be the frame the viewer showed. Anything else means the
   picture has two implementations. */
trans = () => ({ kind: 'dissolve', ms: 400, dir: 'l' });
await put(); await open();
const preview = mean(await at(2200));

{
  const r = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await r.goto(`${B}/render?project=${P}`);
  await r.waitForFunction(() => !!window.__renderReady, null, { timeout: 20000 });
  const good = await r.evaluate(() => window.__renderReady());
  const info = await r.evaluate(() => window.__renderInfo());
  ok('render page loads the project', good && info.ok && info.clips === 2,
     `${info.clips} clips, ${Math.round(info.duration)}ms`);

  await r.evaluate(() => window.__renderSeek(2200));
  const buf = await r.screenshot({ clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  fs.writeFileSync(path.join(SHOTS, 'export-mid.png'), buf);
  const m = mean(decode(buf));
  ok('the export is mid-dissolve too', m.r > 60 && m.r < 200 && m.b > 60 && m.b < 200, say(m));
  ok('the export matches the preview', near(m.r, preview.r, 8) && near(m.b, preview.b, 8),
     `export ${say(m)}  ·  preview ${say(preview)}`);

  /* and the whip's smear survives the trip, which is the part that goes
     through an svg filter built from script rather than a css property */
  await r.evaluate(() => window.__renderSeek(1000));
  const clean = hardestEdge(decode(await r.screenshot({ clip: { x: 0, y: 0, width: 1920, height: 1080 } })));
  ok('a plain frame exports clean', clean < 20, `biggest step ${clean}`);
  await r.close();
}

/* ------------------------------------------------------------- the mouse --
   The gestures, driven as gestures. What they are checked against is the file
   on disk, because that is where an edit has actually happened. */
const disk = async () => (await api('/api/project?name=' + P)).project.tracks[0].clips
  .find(c => c.id === 'b1');

const rowBox = t => page.evaluate(i => {
  const r = document.querySelector(`.track[data-track="${i}"]`).getBoundingClientRect();
  const x = document.querySelector('#tracks').getBoundingClientRect().left;
  return { x, top: r.top, y: r.top + r.height / 2 };
}, t);

/* ---- dropping a kind on a cut ---- */
trans = () => undefined;
await put(); await open();
{
  const row = await rowBox(0);
  const chip = await page.locator('#txBar .txChip[data-kind="push"]').boundingBox();
  await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
  await page.mouse.down();
  await page.mouse.move(row.x + 100, row.y, { steps: 6 });
  await page.mouse.move(row.x + 2000 * 0.09, row.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const c = await disk();
  ok('dropping a chip on a cut makes one', !!c.trans && c.trans.kind === 'push',
     JSON.stringify(c.trans));
  await page.locator('#tlBody').screenshot({ path: path.join(SHOTS, 'timeline-push.png') });
}

/* ---- dragging its edge sets the length ---- */
{
  const was = (await disk()).trans.ms;
  const h = await page.locator('.clip[data-id="b1"] .txh').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 54, h.y + h.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const now = (await disk()).trans.ms;
  ok('dragging the edge sets the length', now > was + 400, `${was}ms -> ${now}ms`);
  ok('the length is on a frame', Math.abs(now - Math.round(now / (1000 / 30)) * (1000 / 30)) < 0.01,
     `${now}ms = ${(now / (1000 / 30)).toFixed(2)} frames`);
}

/* ---- dragging it to nothing removes it ---- */
{
  const h = await page.locator('.clip[data-id="b1"] .txh').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x - 400, h.y + h.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  ok('dragging it to nothing removes it', !(await disk()).trans,
     JSON.stringify((await disk()).trans));
}

/* ---- pushing one clip into the one before it ---- */
{
  const clip = await page.locator('.clip[data-id="b1"]').boundingBox();
  const from = { x: clip.x + clip.width / 2, y: clip.y + clip.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 9, from.y, { steps: 3 });
  await page.mouse.move(from.x - 27, from.y, { steps: 6 });   /* 27px = 300ms */
  await page.mouse.up();
  await page.waitForTimeout(700);
  const c = await disk();
  ok('overlapping two clips makes one', !!c.trans && c.trans.kind === 'dissolve',
     JSON.stringify(c.trans));
  ok('the overlap is its length', c.trans && Math.abs(c.trans.ms - 300) <= 34,
     `${c.trans && Math.round(c.trans.ms)}ms for a 300ms overlap`);
  ok('and the cut did not move', c.start === 2000, `starts at ${c.start}ms`);
  await page.locator('#tlBody').screenshot({ path: path.join(SHOTS, 'timeline-overlap.png') });
}

/* ---- a boundary with one looks different from one without ---- */
{
  const drawn = await page.evaluate(() => {
    const el = document.querySelector('.clip[data-id="b1"] .tx');
    const a = document.querySelector('.clip[data-id="a1"] .tx');
    return { has: !!el, width: el ? Math.round(el.getBoundingClientRect().width) : 0,
             text: el ? el.textContent.trim() : '', neighbour: !!a };
  });
  ok('the boundary is drawn', drawn.has && !drawn.neighbour, JSON.stringify(drawn));
  ok('its length is written on it', /ms/.test(drawn.text), drawn.text || '(nothing)');
}

ok('no unexpected errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures ? `\n  ${failures} failure(s)\n` : '\n  all good\n');
process.exit(failures ? 1 : 0);
