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
import { execFileSync, spawnSync } from 'child_process';

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
/* Errors thrown INSIDE a clip's iframe reach here too, and several checks
   below deliberately break a clip to see what it reports. Those are the point,
   not a failure — so the last check counts only errors nobody asked for. */
const errors = [];
let expected = false;
const note = s => { if (!expected) errors.push(s); };
page.on('pageerror', e => note('page: ' + e.message));
page.on('console', m => { if (m.type() === 'error') note('console: ' + m.text().slice(0, 120)); });
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
await type(`duration(4000);\nline('big', 'ON SCREEN', t, { top: 400, size: 220,\n  opacity: fadeIn(0, 400), y: change(0, 400, -80, 0, overshoot) });`);
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

expected = true;             /* everything until the fix below is on purpose */
/* ---- a broken clip says why, and says it ON the line ----

   This block is the whole point of the error work. A missing comma must never
   read as "the clip did not finish loading". It has to land on a line, put a
   squiggle on the character, and say a sentence you can act on. */
await type(`duration(3000);\nlien('x', 'oops', t, { top: 100 });`);
const banner = await page.evaluate(() => {
  const e = document.querySelector('#stageErr');
  return e && e.style.display !== 'none' ? e.textContent : null;
});
ok('a broken clip reports itself', /not defined/.test(banner || ''), banner || 'nothing shown');

const marks = () => page.evaluate(() => ({
  strip:  document.querySelector('#codeErr').textContent,
  line:   !!document.querySelector('.CodeMirror-linebackground.errLine'),
  gutter: !!document.querySelector('.errGutter'),
  dot:    !!document.querySelector('.errDot'),
  tok:    (document.querySelector('.errTok') || {}).textContent || null
}));

let mk = await marks();
ok('a typo suggests the right name', /did you mean line/.test(mk.strip), mk.strip);
ok('the bad token is marked', mk.tok === 'lien' && mk.line && mk.gutter && mk.dot,
   `tok=${mk.tok} line=${mk.line} gutter=${mk.gutter} dot=${mk.dot}`);

/* the one that started all this */
await type(`duration(3000);\nline('a', 'hi', t, { top: 300\n  size: 200 });`);
mk = await marks();
ok('a missing comma is named', /missing comma at the end of line 2/.test(mk.strip), mk.strip);
ok('the comma squiggle is placed', mk.tok === 'size' && mk.line, `tok=${mk.tok}`);

await type(`duration(3000);\nline('a', 'hi, t, { top: 300 });`);
mk = await marks();
ok('an unclosed quote is named', /quote that is never closed/.test(mk.strip), mk.strip);

/* The line number must be EXACT, deep into a clip. It is produced by taking
   the wrapper's height back off the reported line, and that height used to be
   a hand-typed constant that was fourteen lines wrong — so every error pointed
   at the wrong place. It is counted now; this is what proves it. */
await type(`duration(3000);\n\n\nline('a', 'hi', t, { top: 300, size: 200 });\nnotAThing();`);
mk = await marks();
ok('the line number is exact', /^line 5 /.test(mk.strip), mk.strip);
const off = await page.evaluate(() =>
  document.querySelector('#stage iframe').contentWindow.SHELL_OFFSET);
ok('the shell offset is derived', typeof off === 'number' && off > 0, `${off} lines of wrapper`);
await type(`duration(3000);\nline('big', 'fixed', t, { top: 400, size: 200, opacity: fadeIn(0, 300) });`);
const cleared = await page.evaluate(() => {
  const e = document.querySelector('#stageErr');
  return !e || e.style.display === 'none';
});
ok('the error clears when fixed', cleared);
expected = false;
const gone = await marks();
ok('the marks clear too', !gone.line && !gone.dot && !gone.tok && !gone.strip,
   JSON.stringify(gone));

/* ---- duration drives the timeline ---- */
await type(`duration(5200);\nline('big', 'fixed', t, { top: 400, size: 200, opacity: fadeIn(0, 300) });`);
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

/* ---- the preview is yours to control ---- */
const ballAt = () => page.evaluate(() => document.querySelector('#curveBall').style.left);
const a0 = await ballAt();
await page.waitForTimeout(300);
ok('the preview runs', (await ballAt()) !== a0, 'the ball moves');

await page.click('#curvePlay');
await page.waitForTimeout(200);
const held = await ballAt();
await page.waitForTimeout(400);
ok('the preview pauses', (await ballAt()) === held,
   `${await page.textContent('#curvePlay')}, held at ${held}`);

await page.click('#curvePlay');
await page.waitForTimeout(200);
const b0 = await ballAt();
await page.waitForTimeout(300);
ok('the preview restarts', (await ballAt()) !== b0, 'the ball moves again');

await page.evaluate(() => {
  const d = document.querySelector('#curveDur');
  d.value = '2000';
  d.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(250);
ok('the preview length is adjustable', (await page.textContent('#curveDurVal')) === '2.00s',
   await page.textContent('#curveDurVal'));

/* The length it offers should be the length of the move it is attached to.
   Watching a 340ms move at 340ms is the question you are actually asking. */
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.setValue('duration(2200);\n'
    + "line('a', 'x', t, { top: 300, size: 150,\n"
    + '  scale: change(0, 340, .72, 1, bezier(0.34, 1.56, 0.64, 1)) });');
  cm.setCursor({ line: 2, ch: 44 });
});
await page.waitForTimeout(900);
ok('it offers the real length of the move',
   /340ms/.test(await page.textContent('#curveMatch')), await page.textContent('#curveMatch'));
await page.click('#curveMatch');
await page.waitForTimeout(250);
ok('matching sets that length', (await page.textContent('#curveDurVal')) === '0.34s',
   await page.textContent('#curveDurVal'));

/* ---- the scene layer ----

   The claim being tested is the one the layer exists for: that timing written
   as a relationship survives an edit. Change the length of the first thing and
   everything behind it must move with it, still the same gap behind. */
const plan = () => page.evaluate(() => {
  const w = document.querySelector('#stage iframe').contentWindow;
  w.__render(0, 0);
  return w.__scenePlan();
});
const CHOREO = ms => `const title    = text('Title').at(90, 200).size(120);
const subtitle = text('Subtitle').at(90, 380).size(70);
const chart    = text('Chart').at(90, 520).size(70);

title.enter(${ms});
subtitle.enter(250).after(title, 80);
chart.enter(600).after(subtitle, -120);`;

await type(CHOREO(300));
let p1 = await plan();
ok('relative timing resolves',
   p1[0].start === 0 && p1[1].start === 380 && p1[2].start === 510,
   p1.map(n => `${n.text}@${n.start}`).join(' '));

await type(CHOREO(500));
let p2 = await plan();
ok('and it survives an edit',
   p2[1].start === 580 && p2[2].start === 710,
   `title 300->500 moved subtitle ${p1[1].start}->${p2[1].start}, `
   + `chart ${p1[2].start}->${p2[2].start}`);
ok('the gaps are what was preserved',
   p2[1].start - p2[0].end === 80 && p2[2].start - p2[1].end === -120,
   `+80 and -120 either side`);
/* the clip's OWN length, not #len, which is the whole timeline */
const clipLen = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('.clip')].pop();
  return el ? el.querySelector('.cd').textContent : null;
});
ok('the clip length follows the choreography', (await clipLen()) === '1.31s',
   `${await clipLen()} for a 1310ms choreography`);

await type(`const a = text('A').at(90,100).size(60).enter(300).start(400);
const b = text('B').at(90,200).size(60).enter(200).with(a);
const c = text('C').at(90,300).size(60).enter(400).before(a, 100);
const d = text('D').at(90,400).size(60).enter(150).alignEnd(a);`);
const p3 = await plan();
ok('with, before and alignEnd', p3[1].start === 400 && p3[2].start === 300 && p3[3].end === 700,
   p3.map(n => `${n.text} ${n.start}-${n.end}`).join('  '));

await type(`const a = text('A').at(90,100).size(60).enter(300);
const b = text('B').at(90,200).size(60).enter(200);
a.after(b, 10); b.after(a, 10);`);
ok('a circular timing says so', /refers back to itself/.test(await page.textContent('#codeErr')),
   await page.textContent('#codeErr'));

/* a group lays its children out, and with no stagger moves as one */
await type(`const stat = group(text('11'), text('3361 people'));
stat.layout('row', { gap: 130 }).size(140).color('#e12392').at(90, 340)
  .enter(340, 'pop');`);
const kids = await page.evaluate(() => {
  const d = document.querySelector('#stage iframe').contentDocument;
  document.querySelector('#stage iframe').contentWindow.__render(600, 36);
  return [...d.querySelectorAll('#__world > * > *')]
    .map(e => ({ t: e.textContent, x: Math.round(e.getBoundingClientRect().left),
                 w: Math.round(e.getBoundingClientRect().width) }));
});
ok('a group lays its children out in a row',
   kids.length === 2 && kids[1].x === kids[0].x + kids[0].w + 130,
   kids.map(k => `${k.t}@${k.x}`).join(' '));

/* A stagger has to actually reach the children. It did not at first: the moves
   sat on the group, so the delay had nothing to act on and the resolved length
   was the only thing that knew about it. */
await type(`group(text('3361'), text('people'))
  .layout('row', { gap: 130 }).size(140).center(340)
  .stagger(130).alternate()
  .enter(340, { opacity: [0, 1], y: [70, 0], ease: 'overshoot' });`);
const cascade = await page.evaluate(() => {
  const f = document.querySelector('#stage iframe');
  f.contentWindow.__render(130, 8);
  return [...f.contentDocument.querySelectorAll('#__world > * > *')].map(e => ({
    t: e.textContent, o: Number(getComputedStyle(e).opacity).toFixed(2) }));
});
/* At 130ms the first word is most of the way in and the second has not begun,
   which is what a 130ms stagger means. The first is not at 1.00 — it is 130 of
   340 through an eased move — so the check is "well under way", not "done". */
ok('a stagger reaches the children',
   Number(cascade[0].o) > 0.5 && cascade[1].o === '0.00',
   `at 130ms: ${cascade.map(c => `${c.t}=${c.o}`).join(' ')}`);

const alt = await page.evaluate(() => {
  const f = document.querySelector('#stage iframe');
  f.contentWindow.__render(0, 0);
  return [...f.contentDocument.querySelectorAll('#__world > * > *')]
    .map(e => Math.round(new DOMMatrix(getComputedStyle(e).transform).f));
});
ok('alternate reverses every second one', alt[0] === 70 && alt[1] === -70,
   `y offsets ${alt.join(' and ')}`);

/* Render the clip at a chosen time directly. seek() moves the TIMELINE, and by
   this point the project holds more than one clip, so the playhead is not a
   reliable way to ask this clip what it looks like at 400ms. */
const renderAt = async ms => {
  await page.evaluate(t => {
    const f = document.querySelector('#stage iframe');
    f.contentWindow.__render(t, Math.round(t / 1000 * 60));
  }, ms);
  await page.waitForTimeout(150);
  return lit();
};
const sceneDark = await renderAt(0);
const sceneLit = await renderAt(400);
ok('and the group is on the picture', sceneLit > sceneDark * 2,
   `${sceneDark} lit at 0ms -> ${sceneLit} at 400ms`);

/* ---- the reference ----

   Its content comes out of the doc comments in motion.js, so these checks are
   really asking whether the parser still agrees with the format those comments
   are written in. A silently empty panel is the failure to catch. */
await page.keyboard.press('F1');
await page.waitForTimeout(700);
ok('F1 opens the reference',
   await page.evaluate(() => !document.querySelector('#help').classList.contains('hidden')));

const cards = await page.$$eval('.helpCard', n => n.length);
ok('every function is documented', cards >= 30, `${cards} entries`);
ok('and every one has an example',
   (await page.evaluate(() => [...document.querySelectorAll('.helpCard')]
     .filter(c => !c.querySelector('.helpEx')).length)) === 0);
ok('aligned tables keep their columns',
   /^ {2}linear {4,}constant rate$/m.test(await page.evaluate(() =>
     [...document.querySelectorAll('.helpDefs')].map(n => n.textContent).join('\n'))));

await page.fill('#helpFind', 'stagger');
await page.waitForTimeout(350);
const few = await page.$$eval('.helpCard', n => n.length);
ok('search narrows it', few > 0 && few < cards, `${few} of ${cards}`);
await page.fill('#helpFind', '');
await page.waitForTimeout(300);

/* clicking an example puts it in the code, and it must PARSE */
await type('duration(3000);\n');
await page.keyboard.press('F1');
await page.waitForTimeout(600);
await page.evaluate(() => {
  const c = [...document.querySelectorAll('.helpCard')]
    .find(c => c.querySelector('.helpSig').textContent.startsWith('line(id'));
  c.scrollIntoView();
  c.querySelector('.helpEx').click();
});
await page.waitForTimeout(2200);
const inserted = await page.evaluate(() =>
  document.querySelector('.CodeMirror').CodeMirror.getValue());
ok('clicking an example inserts it', /^duration\(3000\);\nline\('l1'/.test(inserted),
   JSON.stringify(inserted.slice(0, 46)));
ok('and the inserted example runs', (await page.textContent('#codeErr')) === '',
   await page.textContent('#codeErr'));

await page.keyboard.press('F1');
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok('Escape closes it',
   await page.evaluate(() => document.querySelector('#help').classList.contains('hidden')));

/* the point of putting it in the editor: you can reach it without stopping */
await page.click('.CodeMirror');
await page.waitForTimeout(200);
await page.keyboard.press('F1');
await page.waitForTimeout(500);
ok('F1 works while typing code',
   await page.evaluate(() => !document.querySelector('#help').classList.contains('hidden')));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

/* ---- a different easing per property ----

   The spec had one `ease` for everything, which was less than the layer
   underneath could say. A layer that takes something away is not a
   simplification. A third element on the pair overrides it. */
await type(`text('A').size(90).center(300)
  .enter(400, { opacity: [0, 1, 'linear'], y: [100, 0, 'overshoot'] });`);
const eased = await page.evaluate(() => {
  const w = document.querySelector('#stage iframe').contentWindow;
  w.__render(200, 12);
  const e = document.querySelector('#stage iframe').contentDocument.querySelector('#__world > *');
  return { o: Number(getComputedStyle(e).opacity).toFixed(2),
           y: Math.round(new DOMMatrix(getComputedStyle(e).transform).f) };
});
ok('each property can have its own easing', eased.o === '0.50' && eased.y < 0,
   `at half way: opacity ${eased.o} (linear), y ${eased.y} (already overshot past 0)`);

/* ---- a control that does nothing says so ---- */
await type(`group(text('A'), text('B')).layout('row', { gap: 40 }).size(80).center(300)
  .stagger(120).alternate()
  .enter(340, 'pop');`);
ok('alternate with nothing to reverse says so',
   /nothing to reverse/.test(await page.textContent('#codeNote')),
   await page.textContent('#codeNote'));

await type(`group(text('A'), text('B')).layout('row', { gap: 40 }).size(80).center(300)
  .stagger(120).alternate()
  .enter(340, { opacity: [0, 1], y: [70, 0] });`);
ok('and the note clears once it has something',
   (await page.textContent('#codeNote')) === '',
   JSON.stringify(await page.textContent('#codeNote')));

/* ---- the pickers ----

   The font picker used to only understand line() and block(), so anywhere in a
   scene chain it answered a click with "put the cursor inside a line(...) or
   block(...)". A picker exists because the name is fiddly to type; refusing to
   hand it over is the one thing it must never do. */
const family = await page.evaluate(() => {
  const o = [...document.querySelectorAll('#pickFont option')].find(o => o.value);
  return o ? o.value : null;
});
const putCursor = async (code, line, ch) => {
  await type(code);
  await page.evaluate(a =>
    document.querySelector('.CodeMirror').CodeMirror.setCursor({ line: a.l, ch: a.ch }),
    { l: line, ch });
  await page.waitForTimeout(200);
};
const pickFont = async () => {
  await page.selectOption('#pickFont', family);
  await page.waitForTimeout(1400);
  return page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
};

await putCursor(`group(text('3361'), text('people'))\n  .layout('row', { gap: 130 })\n  .color('#ffb02e')\n  .center(340);`, 2, 8);
let picked = await pickFont();
ok('the font picker works in a scene chain',
   picked.includes(`.font('${family}')`) && !/put the cursor/i.test(await page.textContent('#codeErr')),
   picked.split('\n').find(l => l.includes('.font')) || 'nothing inserted');

await putCursor(`text('hi')\n  .font('Arial', 268)\n  .center(340);`, 2, 5);
picked = await pickFont();
ok('and swapping a font keeps the size', picked.includes(`.font('${family}', 268)`),
   picked.split('\n').find(l => l.includes('.font')) || '');

await putCursor(`line('l1', 'hi', t, {\n  top: 340, size: 268\n});`, 1, 10);
picked = await pickFont();
ok('it still works in an options object', picked.includes(`font: '${family}'`),
   picked.split('\n')[0]);

await putCursor('', 0, 0);
picked = await pickFont();
ok('and with nowhere to put it, it gives you the name',
   picked.trim() === `'${family}'`, JSON.stringify(picked.trim()));

/* ---- the edit-see loop ----

   Looping the whole timeline means that after every edit you sit through
   everything in front of your shot before seeing the change. Every other cost
   in the editor is paid once; this one is paid on every edit. */
await type(`duration(1200);\ntext('A').size(120).center(400).enter(300);`);
await page.click('.clip');
await page.waitForTimeout(500);
ok('it loops the clip you are working on',
   (await page.textContent('#loopWhat')) === 'loop clip',
   `"${await page.textContent('#loopWhat')}" — ${await page.textContent('#sel')}`);

const msNow = async () => {
  const [, , sec, fr] = (await page.textContent('#tc')).split(':').map(Number);
  return sec * 1000 + Math.round(fr * 1000 / 60);
};
const clipSpan = await page.evaluate(() => {
  const el = document.querySelector('.clip.sel') || document.querySelector('.clip');
  return Number(el.querySelector('.cd').textContent.replace('s', '')) * 1000;
});
await page.evaluate(() => document.activeElement.blur());
await page.keyboard.press('r');                 /* replay */
const seen = [];
for (let i = 0; i < 12; i++) { await page.waitForTimeout(190); seen.push(await msNow()); }
await page.keyboard.press('k');
/* By this point in the suite the clip does not start at t=0, so what matters
   is the WIDTH of what was played rather than where on the timeline it sat. */
const played = Math.max(...seen) - Math.min(...seen);
ok('and never runs past its end', played <= clipSpan + 120,
   `${clipSpan}ms clip, playhead covered ${played}ms`);
ok('and it wraps rather than stopping',
   seen.some((v, i) => i > 0 && v < seen[i - 1]), seen.join(' '));

/* the point of all of it: change a number and see it again, hands on keys */
await page.keyboard.press('r');
await page.waitForTimeout(700);
const beforeEdit = await msNow();
await type(`duration(1200);\ntext('A').size(140).center(400).enter(300);`);
await page.waitForTimeout(300);
const afterEdit = await msNow();
ok('an edit restarts it from the top while playing', afterEdit < beforeEdit,
   `was at ${beforeEdit}ms, back to ${afterEdit}ms without touching the playhead`);
await page.keyboard.press('k');

/* ---- the layout is yours and it stays ---- */
const paneVars = () => page.evaluate(() => {
  const s = getComputedStyle(document.documentElement);
  return { pool: s.getPropertyValue('--pool').trim(),
           mon: s.getPropertyValue('--mon').trim(),
           tl: s.getPropertyValue('--h-timeline').trim() };
});
const dragGutter = async (sel, dx, dy) => {
  const g = await page.locator(sel).boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + dx, g.y + g.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
};
await dragGutter('#gutterL', 120, 0);
await dragGutter('#hGutter', 0, -120);
const dragged = await paneVars();
ok('dragging a splitter is remembered',
   /^\{"--pool":"\d+px".*h-timeline/.test(
     await page.evaluate(() => localStorage.getItem('studio.layout')) || ''),
   await page.evaluate(() => localStorage.getItem('studio.layout')));

await page.reload();
await page.waitForTimeout(1400);
const back = await paneVars();
ok('and it survives a reload', back.pool === dragged.pool && back.tl === dragged.tl,
   `${dragged.pool}/${dragged.tl} -> ${back.pool}/${back.tl}`);

/* the inline restore runs before paint; if it did not, the page would render
   at the stylesheet default and jump, which is the thing being prevented */
ok('applied before the first paint', back.pool !== '210px', `${back.pool}, not the 210px default`);

await page.dblclick('#gutterL');
await page.waitForTimeout(300);
const reset = await paneVars();
const left = await page.evaluate(() => localStorage.getItem('studio.layout'));
ok('double-click resets one and forgets it',
   reset.pool === '210px' && reset.tl === dragged.tl && !/--pool/.test(left || ''),
   `pool back to ${reset.pool}, timeline still ${reset.tl}`);
await page.evaluate(() => localStorage.removeItem('studio.layout'));

/* ---- it comes out as a video ----

   The end of the whole thing. A render drives the same stage.js the viewer
   does, so this checks the one claim that matters: that the file on disk has
   the picture in it. A black frame is the failure mode -- the pipeline can run
   perfectly and export nothing, which is exactly what it did the first time. */
/* Its own project. By this point the suite's has a dozen clips stacked at
   various times from earlier checks, so "render it and look at a frame" would
   be sampling whichever one happened to be under that moment. */
const RP = '_testrender';
const rdir = path.join(HERE, 'projects', RP);
fs.rmSync(rdir, { recursive: true, force: true });
await api('/api/project/new', 'POST', { name: RP });
/* the dropdown was built at load; a project made since is not in it yet */
await page.reload();
await page.waitForTimeout(1200);
await page.selectOption('#project', RP);
await page.waitForTimeout(900);
await page.click('#btnNewCode');
await page.waitForTimeout(1500);
await type(`duration(400);
text('EXPORT').size(300).color('#ffffff').center(400);
camera.zoom(1.2, 400);`);
await page.waitForTimeout(700);

let rendered = null, renderErr = null;
const mp4 = path.join(HERE, 'renders', RP + '.mp4');
try {
  fs.rmSync(mp4, { force: true });
  execFileSync(process.execPath,
    [path.join(HERE, 'render.mjs'), RP, mp4, '--scale', '0.35', '--fps', '10'],
    { stdio: 'pipe', timeout: 120000 });
  rendered = fs.existsSync(mp4) ? fs.statSync(mp4).size : 0;
} catch (e) {
  renderErr = String(e.stdout || e.message).split('\n').slice(-4).join(' ').slice(0, 160);
}
ok('a project renders to an mp4', rendered > 2000, renderErr || `${rendered} bytes`);

/* and the picture is IN it: pull a frame back out and count the lit pixels */
let litFrame = -1;
if (rendered) {
  const png = path.join(HERE, 'renders', RP + '-check.png');
  try {
    /* -ss rather than a select filter: the filter needs a comma escaped, and
       an escaped comma in an args array is a fight with no upside. */
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '0.2', '-i', mp4,
                            '-frames:v', '1', png],
                 { stdio: 'pipe', timeout: 60000 });
    const buf = fs.readFileSync(png);
    litFrame = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] > 200) litFrame++;
    fs.rmSync(png, { force: true });
  } catch (e) { litFrame = -1; }
}
ok('and the frames are not black', litFrame > 400, `${litFrame} bright bytes in frame 2`);
fs.rmSync(mp4, { force: true });

/* ---- and it carries the sound ----

   You cut to a voice, so the voice has to survive the export. The clip is put
   straight into project.json rather than dragged, because what is being tested
   is the mux, not the media pool. */
let hasAudio = false, audioLevel = null;
try {
  const wav = path.join(rdir, 'media', 'tone.wav');
  fs.mkdirSync(path.dirname(wav), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=2', wav], { stdio: 'pipe', timeout: 60000 });

  const pj = path.join(rdir, 'project.json');
  const proj = JSON.parse(fs.readFileSync(pj, 'utf8'));
  proj.media = [{ id: 'mtone', kind: 'audio', name: 'tone.wav', src: 'media/tone.wav', dur: 2000 }];
  proj.tracks[0].clips.push({ id: 'ctone', kind: 'audio', src: 'media/tone.wav',
                              media: 'mtone', start: 0, in: 0, out: 2000, natural: 2000 });
  fs.writeFileSync(pj, JSON.stringify(proj));

  execFileSync(process.execPath,
    [path.join(HERE, 'render.mjs'), RP, mp4, '--scale', '0.25', '--fps', '10'],
    { stdio: 'pipe', timeout: 180000 });

  const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries',
    'stream=codec_type', '-of', 'csv=p=0', mp4], { encoding: 'utf8', timeout: 60000 });
  hasAudio = /audio/.test(streams);

  /* present is not the same as audible: a silent track would pass the check
     above and fail the only thing anyone cares about */
  /* spawnSync, not execFileSync: volumedetect reports on stderr even when the
     command succeeds, and execFileSync only hands back stderr when it throws. */
  const probe = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', mp4, '-map', '0:a',
    '-af', 'volumedetect', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'],
    { encoding: 'utf8', timeout: 60000 });
  const vol = String(probe.stderr || '');
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(vol);
  audioLevel = m ? Number(m[1]) : null;
} catch (e) {
  audioLevel = null;
}
ok('the export carries the audio', hasAudio, hasAudio ? 'an aac stream is there' : 'no audio stream');
ok('and the audio is not silence', audioLevel !== null && audioLevel > -60,
   audioLevel === null ? 'could not measure' : `peaks at ${audioLevel} dB`);
fs.rmSync(mp4, { force: true });
fs.rmSync(rdir, { recursive: true, force: true });

ok('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n  ${failures ? failures + ' FAILED' : 'all passed'}\n`);
process.exit(failures ? 1 : 0);
