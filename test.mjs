/* ============================================================================
   Regression suite. Drives the real app in a real browser.

     node studio.mjs          in one terminal
     node studio/test.mjs     in another

   IT CHECKS PIXELS, NOT THE DOM. A whole afternoon went into a bug where the
   text existed in the document and was not on screen — the clip's iframe was
   sitting at its intrinsic 300x150 in the corner. Every DOM-reading test
   passed. So the question this asks is "is it lit?", which is the question a
   person looking at the viewer is asking.
   ========================================================================== */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const B = process.env.STUDIO || 'http://localhost:4321';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const P = '_test';
const dir = path.join(HERE, 'projects', P);

let failures = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name.padEnd(34)} ${detail}`);
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
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120)); });
page.on('dialog', async d => d.accept('shot'));

const clips = () => { try { return fs.readdirSync(path.join(dir, 'clips')); } catch { return []; } };
const type = async code => {
  await page.evaluate(c => document.querySelector('.CodeMirror').CodeMirror.setValue(c), code);
  await page.waitForTimeout(2200);
};
/* how much of the viewer is lit — the only honest measure of "is it on screen" */
const lit = async () => {
  const buf = await page.locator('#stageFit').screenshot();
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] > 200) n++;
  return n;
};
/* Scrub on the RULER, the way you would. Clicking a clip selects it and
   deliberately does not move the playhead, so a test that clicked the track
   was testing selection and calling it a seek.

   And a real mouse, not a synthetic MouseEvent: the timeline runs on pointer
   capture, and dispatchEvent(new MouseEvent(...)) produces no pointer events —
   a test that fakes the input stops testing the input. */
const seek = async ms => {
  const box = await page.evaluate(() => {
    const r = document.querySelector('#ruler').getBoundingClientRect();
    return { left: r.left, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.left + (ms / 1000) * 90, box.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(450);
};

console.log('\nSTUDIO — regression\n');

await page.goto(B);
await page.waitForTimeout(800);
await page.selectOption('#project', P);
await page.waitForTimeout(900);
/* Boot opens whichever project comes first, which may be one of yours with a
   half-written clip in it. Only errors from THIS project are ours to report. */
errors.length = 0;

/* ---- a new clip is empty ---- */
await page.click('#btnNewCode');
await page.waitForTimeout(1600);
const src = await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
ok('new clip has no boilerplate', !/<meta|<style|__ready|__render/.test(src),
   `${src.trim().split('\n').length} line(s)`);
ok('new clip file is .js', clips().some(f => f.endsWith('.js')), clips().join(', '));

/* ---- the viewer sizes its iframe ---- */
await type(`duration(4000);\nline('big', 'ON SCREEN', t, { top: 400, size: 220,\n  o: on(0, 400), y: go(0, 400, -80, 0, back) });`);
const geo = await page.evaluate(() => {
  const f = document.querySelector('#stage iframe'), s = document.querySelector('#stageFit');
  if (!f || !s) return null;
  const a = f.getBoundingClientRect(), b = s.getBoundingClientRect();
  return { same: Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2,
           size: `${Math.round(a.width)}x${Math.round(a.height)}` };
});
ok('clip iframe fills the viewer', !!geo && geo.same, geo ? geo.size : 'no iframe');

/* ---- it is actually lit, and follows time ---- */
await seek(0);   const dark = await lit();
await seek(800); const bright = await lit();
ok('picture is lit', bright > 500, `${bright} bright bytes`);
ok('picture follows the playhead', bright > dark * 2, `${dark} at 0ms -> ${bright} at 800ms`);
ok('status reports the clip', (await page.textContent('#what')) === 'code:ready',
   await page.textContent('#what'));

/* ---- playback: the clock AND the thing that draws it ---- */
const headX = () => page.evaluate(() =>
  Math.round(parseFloat(getComputedStyle(document.querySelector('#playhead')).left) || 0));
await seek(0);
const x0 = await headX();
await page.click('#play');
await page.waitForTimeout(900);
const moved = await page.textContent('#tc');
const x1 = await headX();
await page.click('#play');
ok('play moves the clock', moved !== '00:00:00:00', moved);
ok('the playhead graphic follows', x1 > x0 + 4, `${x0}px -> ${x1}px`);

await seek(2000);
ok('scrubbing moves the graphic', (await headX()) > x1, `${await headX()}px at 2s`);

/* ---- a broken clip says why ---- */
await type(`duration(3000);\nlien('x', 'oops', t, { top: 100 });`);
const banner = await page.evaluate(() => {
  const e = document.querySelector('#stageErr');
  return e && e.style.display !== 'none' ? e.textContent : null;
});
ok('a broken clip reports itself', /not defined/.test(banner || ''), banner || 'nothing shown');
await type(`duration(3000);\nline('big', 'fixed', t, { top: 400, size: 200, o: on(0, 300) });`);
const cleared = await page.evaluate(() => {
  const e = document.querySelector('#stageErr');
  return !e || e.style.display === 'none';
});
ok('the error clears when fixed', cleared);

/* ---- duration drives the timeline ---- */
await type(`duration(5200);\nline('big', 'fixed', t, { top: 400, size: 200, o: on(0, 300) });`);
ok('clip length follows duration()', (await page.textContent('#len')) === '5.2s',
   await page.textContent('#len'));

/* ---- deletion means deletion ---- */
const before = clips().length;
await page.click('.clip');
await page.waitForTimeout(300);
await page.keyboard.press('Delete');
await page.waitForTimeout(1500);
ok('delete removes the file', clips().length === before - 1, clips().join(', ') || '(empty)');
await page.click('#btnNewCode');
await page.waitForTimeout(1500);
ok('the name is free again', !clips().some(f => /-2\.js$/.test(f)), clips().join(', '));

/* ---- the curve editor ---- */
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.setValue('duration(2200);\n'
    + "line('a', 'x', t, { top: 300, size: 150,\n"
    + '  scale: change(0, 340, .72, 1, bezier(0.34, 1.56, 0.64, 1)) });');
  cm.setCursor({ line: 2, ch: 44 });
});
await page.waitForTimeout(900);
const curveOpen = await page.evaluate(() =>
  !document.querySelector('#curve').classList.contains('hidden'));
ok('curve editor opens on a bezier', curveOpen, await page.textContent('#curveNums'));

await page.click('#curveToPoints');
await page.waitForTimeout(800);
const asPoints = await page.evaluate(() =>
  document.querySelector(".CodeMirror").CodeMirror.getLine(2));
ok('bezier converts to points', /curve\(\[\[0, 0\]/.test(asPoints) && !/bezier\(curve/.test(asPoints),
   asPoints.trim().slice(0, 58) + '…');

const svg = await page.locator('#curveSvg').boundingBox();
await page.mouse.click(svg.x + svg.width * 0.62, svg.y + svg.height * 0.22);
await page.waitForTimeout(700);
const added = await page.textContent('#curveNums');
await page.mouse.click(svg.x + svg.width * 0.62, svg.y + svg.height * 0.22, { button: 'right' });
await page.waitForTimeout(700);
const removed = await page.textContent('#curveNums');
ok('a point can be added', added === '6 points', added);
ok('a point can be removed', removed === '5 points', removed);

ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n  ${failures ? failures + ' FAILED' : 'all passed'}\n`);
process.exit(failures ? 1 : 0);
