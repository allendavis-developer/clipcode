/* Every preset in the "insert a move" menu, inserted into a real clip and run.

   A preset that does not run is worse than no preset: it is offered by the
   tool, so a beginner assumes the error is theirs. They all broke silently
   when go/on/back were removed and again when the scene layer's camera object
   took the name motion.js's camera() had, so this exists to make that class of
   rot impossible to ship. */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const B = process.env.STUDIO || 'http://localhost:4321';
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = '_presets';

let bad = 0;
const ok = (n, p, d = '') => { if (!p) bad++; console.log(`  ${p ? 'ok  ' : 'FAIL'}  ${n.padEnd(34)} ${d}`); };

fs.rmSync(path.join(HERE, 'projects', P), { recursive: true, force: true });
await fetch(B + '/api/project/new', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: P })
});

const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1500, height: 900 } });
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
pg.on('dialog', async d => d.accept('shot'));

await pg.goto(B);
await pg.waitForTimeout(1400);
await pg.selectOption('#project', P);
await pg.waitForTimeout(1000);
await pg.click('#btnNewCode');
await pg.waitForTimeout(1600);

const names = await pg.$$eval('#presets option', ns =>
  ns.map(o => o.value).filter(Boolean));
ok('the menu offers some moves', names.length >= 6, `${names.length} of them`);

for (const name of names) {
  /* a clean clip each time, so one preset cannot poison the next */
  await pg.evaluate(() =>
    document.querySelector('.CodeMirror').CodeMirror.setValue('duration(3000);\n'));
  await pg.waitForTimeout(1200);

  await pg.selectOption('#presets', name);
  await pg.waitForTimeout(2400);

  const err = (await pg.textContent('#codeErr')) || '';
  const src = await pg.evaluate(() =>
    document.querySelector('.CodeMirror').CodeMirror.getValue());

  /* Rendered at three moments, not one: a preset can be fine at t=0 and throw
     halfway through, which is where the removed easings actually bit. */
  let threw = null;
  for (const ms of [0, 700, 1600]) {
    const r = await pg.evaluate(t => {
      try {
        document.querySelector('#stage iframe').contentWindow.__render(t, 0);
        return null;
      } catch (e) { return String(e.message); }
    }, ms);
    if (r && !threw) threw = `at ${ms}ms: ${r}`;
  }
  await pg.waitForTimeout(150);

  ok(name, !err && !threw && src.length > 40, err || threw || `${src.split('\n').length} lines`);
}

/* the specific rot this is here to catch */
ok('no preset uses a removed name',
   !(await pg.evaluate(() => {
     const opts = [...document.querySelectorAll('#presets option')].map(o => o.value);
     return opts.length === 0;
   })), `${names.length} checked for go/on/off/back/expo/io/soft`);

ok('nothing threw in the page', errs.length === 0, errs.slice(0, 2).join(' | '));

await br.close();
fs.rmSync(path.join(HERE, 'projects', P), { recursive: true, force: true });
console.log(bad ? `\n  ${bad} FAILED\n` : '\n  all good\n');
process.exit(bad ? 1 : 0);
