/* ============================================================================
   The shape editor, driven the way a person drives it.

     PORT=4331 node server.mjs      in one terminal
     node studio/checks/pathedit.mjs      in another

   IT ASSERTS ON THE CODE THAT CAME BACK. The whole claim of this panel is that
   the file is the only document — so every check here drags something with a
   real mouse and then reads the source out of the editor, not out of the
   panel's own head.

   And a real mouse: page.mouse.move/down/up, never a dispatched MouseEvent.
   The drag runs on pointer capture, and a synthetic MouseEvent produces no
   pointer events at all — a test that fakes the input stops testing it.
   ========================================================================== */
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const B = process.env.STUDIO || 'http://localhost:4331';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const P = '_pathedit';
const dir = path.join(HERE, '..', 'projects', P);
const SHOTS = path.join(os.tmpdir(), 'pathedit-shots');
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name.padEnd(40)} ${detail}`);
};
const api = (u, m = 'GET', body) => fetch(B + u, body === undefined ? { method: m }
  : { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  .then(r => r.json());

fs.rmSync(dir, { recursive: true, force: true });
await api('/api/project/new', 'POST', { name: P });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('page: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 140)); });
/* a new clip asks for its name, and an unanswered prompt is auto-dismissed —
   which is a clip that never gets made and a pane with nothing selected */
page.on('dialog', d => d.accept('shape'));

/* ------------------------------------------------------------------ tools -- */
const code = () => page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
const put = async (src, line, ch) => {
  await page.evaluate(([s, l, c]) => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    cm.setValue(s);
    cm.setCursor({ line: l, ch: c });
  }, [src, line, ch]);
  await page.waitForTimeout(700);
};
const open = () => page.evaluate(() =>
  !document.querySelector('#pathedit').classList.contains('hidden'));
const nums = () => page.textContent('#pathNums');

/* the panel's canvas, and the map from stage coordinates to screen pixels —
   the same map the panel itself claims to be using */
const canvas = () => page.evaluate(() => {
  const s = document.querySelector('#pathSvg');
  const r = s.getBoundingClientRect();
  const vb = (s.getAttribute('viewBox') || '0 0 1 1').split(/\s+/).map(Number);
  return { x: r.x, y: r.y, w: r.width, h: r.height, vw: vb[2], vh: vb[3] };
});
const at = (b, x, y) => ({ x: b.x + (x / b.vw) * b.w, y: b.y + (y / b.vh) * b.h });

const dragTo = async (from, to) => {
  const b = await canvas();
  const a = at(b, from[0], from[1]), z = at(b, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + z.x) / 2, (a.y + z.y) / 2);
  await page.mouse.move(z.x, z.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
};
const clickStage = async (x, y, opt) => {
  const b = await canvas();
  const p = at(b, x, y);
  await page.mouse.click(p.x, p.y, opt);
  await page.waitForTimeout(500);
};
const shot = async (name, sel = '#pathedit') => {
  const f = path.join(SHOTS, name + '.png');
  await page.locator(sel).screenshot({ path: f });
  return f;
};
/* how much of the viewer is lit — the only honest "is it on screen" */
const lit = async () => {
  const buf = await page.locator('#stageFit').screenshot();
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] > 200) n++;
  return n;
};

console.log('\nSTUDIO — the shape editor\n');

await page.goto(B);
await page.waitForTimeout(800);
await page.selectOption('#project', P);
await page.waitForTimeout(900);
await page.click('#btnNewCode');
await page.waitForTimeout(1500);
errors.length = 0;

/* ---- it opens on a path(), and on nothing else ---- */
const SRC = "duration(2000);\n\npath([[300, 800], [800, 300], [1400, 700]], { smooth: true });\n";
await put(SRC, 2, 10);
ok('opens on a path() call', await open(), await nums());
ok('and knows how many points', (await nums()).startsWith('3 points'), await nums());

await put(SRC, 0, 3);
ok('closes when the cursor leaves it', !(await open()), 'cursor on duration()');

/* ---- the canvas is the shape of the frame ---- */
await put(SRC, 2, 10);
const box = await canvas();
ok('the canvas is the stage aspect',
   Math.abs((box.w / box.h) - (box.vw / box.vh)) < 0.02 * (box.vw / box.vh),
   `${Math.round(box.w)}x${Math.round(box.h)} for a ${box.vw}x${box.vh} stage`);

/* ---- a point dragged to the middle of the canvas IS the middle of frame ---- */
await dragTo([800, 300], [960, 540]);
const centred = await code();
const all = [...centred.matchAll(/\[(\d+), (\d+)\]/g)].map(m => [+m[1], +m[2]]);
const hit = all.find(p => Math.abs(p[0] - 960) < 14 && Math.abs(p[1] - 540) < 14);
ok('dragging rewrites the numbers in the code', !!hit,
   hit ? `middle of the canvas wrote [${hit}] — the stage centre is [960, 540]`
       : centred.split('\n')[2]);
ok('and the other points are untouched',
   /\[300, 800\]/.test(centred) && /\[1400, 700\]/.test(centred),
   centred.split('\n')[2].trim());

const f1 = await shot('panel');
console.log(`        ${f1}`);

/* ---- add and remove ---- */
await clickStage(1700, 900);
const added = await code();
ok('clicking empty space adds a point', (await nums()).startsWith('4 points'),
   `${await nums()} — ${(added.match(/\[\d+, \d+\]/g) || []).length} pairs in the code`);
ok('the new point is in the code', /\[17\d\d, 9\d\d\]/.test(added),
   (added.match(/\[\d+, \d+\]/g) || []).join(' '));

await clickStage(1700, 900, { button: 'right' });
const removed = await code();
ok('right-clicking a point removes it', (await nums()).startsWith('3 points'),
   `${await nums()} — ${(removed.match(/\[\d+, \d+\]/g) || []).length} pairs in the code`);
ok('and it is gone from the code', !/\[17\d\d, 9\d\d\]/.test(removed),
   removed.split('\n')[2].trim().slice(0, 60));

/* ---- the options object ---- */
await page.click('#pathClosed');
await page.waitForTimeout(400);
ok('closed is written back', /closed: true/.test(await code()), (await code()).split('\n')[2].trim());
await page.click('#pathSmooth');
await page.waitForTimeout(400);
ok('and smooth turns off by removing it', !/smooth/.test(await code()),
   (await code()).split('\n')[2].trim());

await page.evaluate(() => {
  const c = document.querySelector('#pathColour');
  c.value = '#3ac47d';
  c.dispatchEvent(new Event('input', { bubbles: true }));
  const w = document.querySelector('#pathWidth');
  w.value = '14';
  w.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(500);
await page.click('#pathFill');
await page.waitForTimeout(500);
const styled = await code();
ok('stroke colour, width and fill are written',
   /color: '#3ac47d'/.test(styled) && /width: 14/.test(styled) && /fill: '#/.test(styled),
   styled.split('\n')[2].trim());

const f2 = await shot('styled');
console.log(`        ${f2}`);

/* ---- an option the panel has no control for must survive being dragged ---- */
await put("duration(2000);\n\npath([[200, 200], [900, 900]], { glow: true, dash: '18 14', width: 9 });\n", 2, 10);
await dragTo([900, 900], [1500, 400]);
const kept = await code();
ok('options it does not own are left alone',
   /glow: true/.test(kept) && /dash: '18 14'/.test(kept) && /\[1[45]\d\d, 4\d\d\]/.test(kept),
   kept.split('\n')[2].trim());

/* ---- raw() opens, and editing it converts the call ---- */
await put("duration(2000);\n\nraw('M200 800 C 600 200, 1200 1000, 1700 300', { width: 8 });\n", 2, 8);
ok('opens on raw() path data', await open(), await nums());
ok('and samples it into points', Number((await nums()).split(' ')[0]) >= 3, await nums());
const before = await code();
await dragTo([200, 800], [260, 760]);
const converted = await code();
ok('editing raw() converts the whole call',
   /path\(\[\[/.test(converted) && !/raw\(/.test(converted) && !/path\(raw|raw\(path/.test(converted),
   converted.split('\n')[2].trim().slice(0, 74) + '…');
ok('and it keeps the options it had', /width: 8/.test(converted),
   before.split('\n')[2].trim().slice(0, 40) + ' -> ' + converted.split('\n')[2].trim().slice(0, 40));

/* ---- a call spread over several lines ---- */
const WRAPPED = "duration(2000);\n\npath([\n  [200, 900], [500, 400],\n  [1000, 700], [1500, 250]\n], { smooth: true });\n";
await put(WRAPPED, 3, 6);
ok('opens on a call spread over lines', await open() && (await nums()).startsWith('4 points'),
   await nums());
await dragTo([200, 900], [300, 1000]);
const rewrapped = await code();
ok('and rewrites it without corrupting it',
   /^duration\(2000\);/.test(rewrapped)
   && (rewrapped.match(/path\(/g) || []).length === 1
   && /\[3\d\d, (9|10)\d\d\]/.test(rewrapped)
   && /\[1500, 250\]/.test(rewrapped),
   JSON.stringify(rewrapped.split('\n').slice(2).join(' ').trim().slice(0, 78)));

/* ---- the curve editor still owns easings ---- */
await put("duration(2000);\n\nline('a', 'x', t, { scale: change(0, 340, .7, 1, bezier(0.34, 1.56, 0.64, 1)) });\n", 2, 62);
ok('an easing still belongs to the curve editor',
   !(await open()) && !(await page.evaluate(() =>
     document.querySelector('#curve').classList.contains('hidden'))),
   'shape panel closed, curve panel open');

/* ---- the new-shape affordance: never answer a click with an instruction ---- */
await put("duration(2000);\n\n", 2, 0);
ok('an empty line has no shape on it', !(await open()));
await page.click('#pickShape');
await page.waitForTimeout(700);
const started = await code();
ok('the shape button starts one on an empty line',
   /path\(\[\[/.test(started) && (await open()),
   started.split('\n')[2].trim());
ok('the starter lands in the middle of the frame',
   [...started.matchAll(/\[(\d+), (\d+)\]/g)]
     .every(m => +m[1] > 300 && +m[1] < 1620 && +m[2] > 200 && +m[2] < 900),
   started.split('\n')[2].trim());

await put("duration(2000);\ntext('hi').at(100, 100);\n", 1, 5);
await page.click('#pickShape');
await page.waitForTimeout(700);
const below = await code();
ok('and on a line with code it goes underneath it',
   /text\('hi'\)[\s\S]*\n\s*path\(\[\[/.test(below) && (await open()),
   below.split('\n').slice(1, 3).join(' / ').trim());

/* ---- and the shape is actually on the picture ---- */
await put("duration(2000);\n\npath([[200, 900], [900, 200], [1700, 800]], { smooth: true, width: 20, color: '#ffb02e' });\n", 2, 10);
await page.waitForTimeout(1800);
const drawn = await page.evaluate(() => {
  const f = document.querySelector('#stage iframe');
  if (!f || !f.contentDocument) return null;
  return [...f.contentDocument.querySelectorAll('#__wires path')]
    .map(p => Math.round(p.getTotalLength()));
});
ok('the shape is on the stage', !!drawn && drawn.length === 1 && drawn[0] > 1600,
   drawn ? `${drawn[0]}px of path drawn` : 'no path in the clip');
const bright = await lit();
ok('and it is lit', bright > 400, `${bright} bright bytes in the viewer`);
const f3 = await shot('stage', '#stageFit');
console.log(`        ${f3}`);
const f4 = await shot('pane', '#codePane');
console.log(`        ${f4}`);

/* ---- snapping ---- */
await put(SRC, 2, 10);
await page.click('#pathSnap');
await dragTo([800, 300], [844, 524]);
const snapped = await code();
ok('snap rounds to the grid', /\[840, 520\]/.test(snapped), snapped.split('\n')[2].trim());
await page.click('#pathSnap');

/* ---- a long drag writes many times and must not corrupt the call ----

   This is the one the curve editor learned the hard way: cursorActivity fires
   on every write, and re-deriving the range in the middle of one eats the
   code. The guard is the only reason this comes back as a single call. */
await put(SRC, 2, 10);
const b = await canvas();
const a0 = at(b, 800, 300), z0 = at(b, 1600, 950);
await page.mouse.move(a0.x, a0.y);
await page.mouse.down();
await page.mouse.move(z0.x, z0.y, { steps: 24 });
await page.mouse.up();
await page.waitForTimeout(600);
const long = await code();
ok('a long drag leaves one intact call',
   (long.match(/path\(/g) || []).length === 1
   && (long.match(/\[\d+, \d+\]/g) || []).length === 3
   && /^duration\(2000\);\n\npath\(\[.*\], \{ smooth: true \}\);\n$/.test(long),
   long.split('\n')[2].trim());

/* ---- the canvas is the stage, not a 16:9 assumption ----

   A point is written in stage coordinates, so the panel has to be the shape of
   THIS project's frame. Turn the stage portrait and the canvas turns with it,
   or every position it reports is a lie. */
const cfg = path.join(dir, 'project.json');
const saved = fs.readFileSync(cfg, 'utf8');
fs.writeFileSync(cfg, saved.replace('"w": 1920', '"w": 1080').replace('"h": 1080', '"h": 1920'));
await page.reload();
await page.waitForTimeout(1000);
await page.selectOption('#project', P);
await page.waitForTimeout(1000);
await put("path([[200, 400], [540, 960], [880, 1500]], { smooth: true });\n", 0, 8);
const port = await canvas();
ok('the canvas follows the project stage', port.vw === 1080 && port.vh === 1920,
   `viewBox ${port.vw}x${port.vh}, drawn ${Math.round(port.w)}x${Math.round(port.h)}`);
ok('and it is drawn at that aspect',
   Math.abs((port.w / port.h) - (port.vw / port.vh)) < 0.02 * (port.vw / port.vh),
   `${(port.w / port.h).toFixed(3)} against ${(port.vw / port.vh).toFixed(3)}`);
await dragTo([200, 400], [540, 960]);
const middle = [...(await code()).matchAll(/\[(\d+), (\d+)\]/g)].map(m => [+m[1], +m[2]]);
ok('the middle of the canvas is the middle of a portrait frame',
   middle.some(q => Math.abs(q[0] - 540) < 12 && Math.abs(q[1] - 960) < 22),
   `wrote ${JSON.stringify(middle[0])} where a 1080x1920 centre is [540, 960]`);
const f5 = await shot('portrait');
console.log(`        ${f5}`);
fs.writeFileSync(cfg, saved);

ok('nothing threw', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${failures ? failures + ' FAILED' : 'all good'}\n`);
process.exit(failures ? 1 : 0);
