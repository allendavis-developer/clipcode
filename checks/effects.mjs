/* ============================================================================
   MATTES AND THE EFFECTS STACK, driven through the real app.

     PORT=4332 node server.mjs      in one terminal
     node checks/effects.mjs        in another

   Same house rules as test.mjs, and one more that this suite needs:

   IT COUNTS PIXELS, NOT BYTES. test.mjs asks "is it lit" by weighing the
   compressed screenshot, which is the right question for "did anything appear
   at all" and useless for "how much of it appeared" — a half-revealed
   headline and a whole one compress to about the same size. A matte is only
   correct if the AREA is right, so checks/png.mjs inflates the screenshot and
   these count real pixels, sample real colours, and measure real bounds.

   The claim each mask check makes is the honest one: with the wipe part way
   across, the lit area must sit STRICTLY BETWEEN the hidden frame and the
   revealed one, and where the arithmetic is exact it must match the fraction
   of the shape the wipe has passed.
   ========================================================================== */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { lit, dark, bounds, at, leaning, size } from './png.mjs';

const B = process.env.STUDIO || 'http://localhost:4332';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.SHOTS || path.join(HERE, '_shots');
const P = '_effects';
const STAGE_W = 1920, STAGE_H = 1080;

let failures = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name.padEnd(40)} ${detail}`);
};

const api = (u, m = 'GET', body) => fetch(B + u, body === undefined ? { method: m }
  : { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  .then(r => r.json());

fs.rmSync(path.join(HERE, '..', 'projects', P), { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
await api('/api/project/new', 'POST', { name: P });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('page: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 140)); });

const type = async code => {
  await page.evaluate(c => document.querySelector('.CodeMirror').CodeMirror.setValue(c), code);
  await page.waitForTimeout(2200);
};

/* Ask the clip for one exact moment. Scrubbing the timeline would work, but by
   the third clip the playhead is not a reliable way to ask THIS clip what it
   looks like at 500ms — the same reason test.mjs stops scrubbing partway. */
const frameAt = async (ms, save) => {
  await page.evaluate(t => {
    const f = document.querySelector('#stage iframe');
    f.contentWindow.__render(t, Math.round(t / 1000 * 30));
  }, ms);
  await page.waitForTimeout(160);
  const buf = await page.locator('#stageFit').screenshot();
  if (save) fs.writeFileSync(path.join(SHOTS, save), buf);
  return buf;
};

/* The viewer draws 1920x1080 scaled to whatever the pane is, so a stage
   coordinate has to be scaled before a pixel can be read at it. */
const sample = (buf, x, y) => {
  const k = size(buf).w / STAGE_W;
  return at(buf, Math.round(x * k), Math.round(y * k));
};

/* What the browser actually resolved, not what we set — the whole point of the
   composition work is that several effects survive being asked for together. */
const styleOf = (sel, prop) => page.evaluate(([s, p]) => {
  const d = document.querySelector('#stage iframe').contentDocument;
  const e = d.querySelector(s);
  return e ? getComputedStyle(e)[p] : null;
}, [sel, prop]);

console.log('\nSTUDIO — mattes and effects\n');

await page.goto(B);
await page.waitForTimeout(800);
await page.selectOption('#project', P);
await page.waitForTimeout(900);
await page.click('#btnNewCode');
await page.waitForTimeout(1600);
errors.length = 0;

/* ------------------------------------------------------------------------ */
/* 1. A wipe across a solid block, where the arithmetic is exact.

   head spans x 360..1560. The wipe's right edge starts exactly on 360 and
   travels 1300px linearly over 1000ms, so at 500ms it has passed 650 of the
   block's 1200 — 54.2% of it and not a pixel more. */
const WIPE = extra => `
const head = shape({ width: 1200, height: 400, background: '#fff' }).at(360, 340);
const wipe = shape({ width: 2400, height: 600, background: '#fff' }).at(-2040, 240);
wipe.move({ x: 1300 }, 1000);
head.${extra};`;

await type(WIPE('showWhere(wipe)'));
const m0 = lit(await frameAt(0, 'matte-0.png'));
const m5 = lit(await frameAt(500, 'matte-500.png'));
const m9 = lit(await frameAt(1000, 'matte-1000.png'));

ok('a matte hides what is not under it', m0 < m9 * 0.02, `${m0} lit at 0ms vs ${m9} at 1000ms`);
ok('a matte reveals what is', m9 > 20000, `${m9} lit pixels`);
ok('and part way across it is part way', m5 > m0 && m5 < m9,
   `${m0} < ${m5} < ${m9}`);
const frac = m5 / m9;
ok('the revealed area is the area passed', Math.abs(frac - 0.5417) < 0.04,
   `${(frac * 100).toFixed(1)}% revealed, 54.2% swept`);

/* the boundary is a hard vertical edge where the wipe's edge is, not a fade */
const edge = bounds(await frameAt(500));
const k = size(await frameAt(500)).w / STAGE_W;
ok('the edge is where the wipe edge is',
   edge && Math.abs(edge.x1 / k - 1010) < 12 && Math.abs(edge.x0 / k - 360) < 12,
   edge ? `x ${Math.round(edge.x0 / k)}..${Math.round(edge.x1 / k)}, wipe edge at 1010` : 'nothing lit');

/* ------------------------------------------------------------------------ */
/* 2. The shape doing the cutting is not in the picture unless asked for. */
await type(WIPE('showWhere(wipe, { show: true })'));
const shown = lit(await frameAt(500, 'matte-show.png'));
ok('{ show: true } draws the matte shape too', shown > m5 * 3,
   `${m5} hidden -> ${shown} shown`);

/* ------------------------------------------------------------------------ */
/* 3. The inverse. Same wipe, same instant: what one shows the other hides, so
   the two areas must add up to the whole block. */
await type(WIPE('hideWhere(wipe)'));
const i5 = lit(await frameAt(500, 'matte-inverse.png'));
const i0 = lit(await frameAt(0));
ok('hideWhere is the other half', Math.abs((i5 + m5) - m9) < m9 * 0.05,
   `${i5} hidden-half + ${m5} shown-half = ${i5 + m5}, whole is ${m9}`);
ok('and with nothing over it, all of it shows', Math.abs(i0 - m9) < m9 * 0.03,
   `${i0} at 0ms vs ${m9} whole`);

/* ------------------------------------------------------------------------ */
/* 4. The case the whole feature is for: a matte that is itself being drawn on.
   The reveal follows the stroke because the mask is a redraw of the live path,
   dash offset and all — nothing about .draw() had to know about masks. */
await type(`
const head = text('REVEALED').font('Figtree Black', 240).at(200, 380).color('#fff');
const brush = path([[120, 500], [700, 430], [1300, 560], [1800, 470]],
                   { smooth: true, width: 320, color: '#fff' });
brush.draw(1000);
head.showWhere(brush);`);
const d0 = lit(await frameAt(0, 'draw-0.png'));
const d5 = lit(await frameAt(500, 'draw-500.png'));
const d9 = lit(await frameAt(1200, 'draw-1200.png'));
ok('a path matte reveals as it draws', d0 < d5 && d5 < d9 && d9 > 1500,
   `${d0} -> ${d5} -> ${d9} lit`);
const db = bounds(await frameAt(500));
const dbFull = bounds(await frameAt(1200));
ok('and only as far as it has drawn', db && dbFull && db.x1 < dbFull.x1 - 40,
   db && dbFull ? `reaches x${db.x1} at 500ms, x${dbFull.x1} when done` : 'nothing lit');

/* ------------------------------------------------------------------------ */
/* 5. A matte belongs to the composition, so the camera carries it. If the mask
   were computed in screen space the reveal would slide off the thing the
   moment the camera moved. */
await type(WIPE('showWhere(wipe)') + `
camera.zoom(1.45, 1);`);
const c5 = lit(await frameAt(500, 'matte-camera.png'));
const c9 = lit(await frameAt(1000, 'matte-camera-full.png'));
ok('a matte travels with the camera', c9 > m9 * 1.6 && Math.abs(c5 / c9 - 0.5417) < 0.05,
   `zoomed whole ${c9} vs unzoomed ${m9}; ${(c5 / c9 * 100).toFixed(1)}% revealed`);

/* 6. And depth, which is the other thing #__world's preserve-3d gives — a
   masked element must not be flattened out of the 3D space to be masked. */
await type(WIPE('showWhere(wipe).depth(-900)'));
const z9 = lit(await frameAt(1000, 'matte-depth.png'));
const z5 = lit(await frameAt(500));
ok('depth survives being masked', z9 < m9 * 0.75 && z9 > 4000,
   `${z9} lit at depth -900 vs ${m9} in the stage plane`);
ok('and the matte still cuts it', z5 > 0 && z5 < z9,
   `${z5} of ${z9} at 500ms`);

/* ------------------------------------------------------------------------ */
/* 7. THE ONE RULE. Ask for 500ms, walk away to 0, come back: the two frames
   must be the same bytes. A matte reads back off live elements, which is
   exactly the shape of code that accumulates if it is written carelessly. */
await type(WIPE('showWhere(wipe)'));
const pure1 = await frameAt(500);
await frameAt(0);
await frameAt(940);
const pure2 = await frameAt(500);
ok('the same t gives the same frame', Buffer.compare(pure1, pure2) === 0,
   `${pure1.length} vs ${pure2.length} bytes, after scrubbing away and back`);

/* ------------------------------------------------------------------------ */
/* 8. glow, animated through a normal spec rather than set. */
await type(`
shape({ width: 300, height: 300, background: '#fff' }).at(810, 390)
  .enter(400, { opacity: [1, 1], glow: [0, 90] });`);
const gOff = await frameAt(0, 'glow-0.png');
const gOn = await frameAt(400, 'glow-400.png');
const f0 = await styleOf('#__world > div', 'filter');
const f4 = await (async () => { await frameAt(400); return styleOf('#__world > div', 'filter'); })();
ok('glow is off when the track says 0', f0 === 'none', String(f0));
ok('glow stacks two haloes for a bloom',
   (String(f4).match(/drop-shadow/g) || []).length === 2, String(f4).slice(0, 90));
/* and it is light on the picture, not just a string: a halo lights pixels
   OUTSIDE the shape, so the lit bounds grow past the 300px box */
const bOff = bounds(gOff, 60), bOn = bounds(gOn, 60);
ok('and it lights pixels outside the shape',
   bOn && bOff && bOn.w > bOff.w + 20 && bOn.h > bOff.h + 20,
   `${bOff && bOff.w}x${bOff && bOff.h} -> ${bOn && bOn.w}x${bOn && bOn.h}`);

/* 9. shadow: a real one, measured as darkness on a light ground. */
await type(`
shape({ width: 1920, height: 1080, background: '#fff' }).at(0, 0);
shape({ width: 400, height: 240, background: '#2b2f3a' }).at(760, 380)
  .enter(400, { opacity: [1, 1], shadowY: [0, 90], shadowBlur: [0, 60] });`);
const sOff = dark(await frameAt(0, 'shadow-0.png'), 150);
const sOn = dark(await frameAt(400, 'shadow-400.png'), 150);
ok('shadow darkens the ground under it', sOn > sOff * 1.35,
   `${sOff} dark pixels -> ${sOn}`);
ok('and it is one drop-shadow with the offset asked for',
   /drop-shadow\(0px 90px 60px/.test(String(await styleOf('#__world > div:nth-child(2)', 'filter'))),
   String(await styleOf('#__world > div:nth-child(2)', 'filter')).slice(0, 70));

/* 10. tint: the colour of a pixel, not the name of a filter. */
await type(`
shape({ width: 600, height: 400, background: '#e12392' }).at(660, 340)
  .enter(400, { opacity: [1, 1], grayscale: [1, 0] });`);
const grey = sample(await frameAt(0, 'tint-grey.png'), 960, 540);
const colour = sample(await frameAt(400, 'tint-colour.png'), 960, 540);
ok('grayscale 1 leaves no colour', Math.abs(grey[0] - grey[1]) < 8 && Math.abs(grey[1] - grey[2]) < 8,
   `rgb(${grey})`);
ok('and it grades back to the real colour', colour[0] - colour[1] > 60,
   `rgb(${colour})`);

/* 11. gradient, on a shape where the pixels are unambiguous, and on text where
   the interesting part is that it is painted through the letters at all. */
await type(`
shape({ width: 1200, height: 400 }).at(360, 340).gradient(['#ff2020', '#2020ff']);`);
const gl = sample(await frameAt(0, 'gradient-shape.png'), 420, 540);
const gr = sample(await frameAt(0), 1500, 540);
ok('a gradient runs across the shape', gl[0] > gl[2] + 80 && gr[2] > gr[0] + 80,
   `left rgb(${gl}), right rgb(${gr})`);

await type(`
const h = text('SOLD OUT').font('Figtree Black', 260).at(180, 380)
  .gradient(['#ff2020', '#20ff20'], { sweep: true });
h.animate('gradientShift', [[0, 0], [600, 100]]);`);
const tg = await frameAt(0, 'gradient-text.png');
ok('text is filled with the gradient, not a colour',
   /linear-gradient/.test(String(await styleOf('#__world > div', 'backgroundImage')))
   && /text/.test(String(await styleOf('#__world > div', 'webkitBackgroundClip'))),
   String(await styleOf('#__world > div', 'webkitBackgroundClip')));
ok('and both ends of it are on screen',
   leaning(tg, 0, 1, 50) > 200 && leaning(tg, 1, 0, 50) > 200,
   `${leaning(tg, 0, 1, 50)} red-leaning, ${leaning(tg, 1, 0, 50)} green-leaning pixels`);
const shiftA = String(await styleOf('#__world > div', 'backgroundPosition'));
await frameAt(600, 'gradient-shift.png');
const shiftB = String(await styleOf('#__world > div', 'backgroundPosition'));
ok('gradientShift sweeps it across', shiftA !== shiftB, `${shiftA} -> ${shiftB}`);

/* 12. outline: hollow type is the stroke and nothing else. */
await type(`
text('EVERY DAY').font('Figtree Black', 220).at(160, 400).color('#fff');`);
const solid = lit(await frameAt(0, 'outline-solid.png'));
await type(`
text('EVERY DAY').font('Figtree Black', 220).at(160, 400)
  .color('transparent').outline(5, '#fff');`);
const hollow = lit(await frameAt(0, 'outline-hollow.png'));
ok('an outline draws the letters', hollow > 800, `${hollow} lit pixels`);
ok('and hollows them out', hollow < solid * 0.6, `${solid} filled -> ${hollow} hollow`);

/* 13. Several effects at once, which is the thing the composition exists for:
   each of these would otherwise be the sole author of style.filter. */
await type(`
shape({ width: 500, height: 300, background: '#e12392' }).at(710, 390)
  .tint({ saturation: 1.6, contrast: 1.2, hue: 40 })
  .glow(30, '#ffb02e')
  .shadow(0, 20, 40, '#000')
  .enter(400, { opacity: [1, 1], blur: [0, 6] });`);
await frameAt(400, 'stack.png');
const stack = String(await styleOf('#__world > div', 'filter'));
ok('every effect asked for is in the filter',
   ['hue-rotate', 'saturate', 'contrast', 'blur', 'drop-shadow'].every(f => stack.includes(f))
   && (stack.match(/drop-shadow/g) || []).length === 3,
   stack.slice(0, 120));
ok('and they are composed in the documented order',
   /hue-rotate.*saturate.*contrast.*blur.*drop-shadow/.test(stack),
   stack.replace(/\([^)]*\)/g, '()').trim());

/* 14. A look set once and a look animated are the same property, so asking for
   both must not produce two writers — the move wins outright. */
await type(`
shape({ width: 400, height: 300, background: '#fff' }).at(760, 390)
  .glow(80)
  .enter(400, { opacity: [1, 1], glow: [80, 0] });`);
const wonOff = String(await (async () => { await frameAt(400); return styleOf('#__world > div', 'filter'); })());
const wonOn = String(await (async () => { await frameAt(0); return styleOf('#__world > div', 'filter'); })());
ok('an animated effect beats the same one set', !/drop-shadow/.test(wonOff) && /drop-shadow/.test(wonOn),
   `set 80, animated 80->0: at 0ms ${/drop-shadow/.test(wonOn) ? 'glowing' : 'none'}, `
   + `at 400ms ${/drop-shadow/.test(wonOff) ? 'glowing' : 'none'}`);

/* ------------------------------------------------------------------------ */
ok('nothing threw along the way', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n  ${failures ? failures + ' FAILED' : 'all passed'}`);
console.log(`  screenshots in ${SHOTS}\n`);
await browser.close();
process.exit(failures ? 1 : 0);
