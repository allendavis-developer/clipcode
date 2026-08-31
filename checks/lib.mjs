/* Shared code is made and edited in the editor, not in another program.

   The endpoints existed long before any way to reach them, which meant the one
   place you are told to write a reusable move was the one place you had to
   leave the tool to reach. */
import { chromium } from 'playwright'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const B = process.env.STUDIO || 'http://localhost:4321', P = '_lib';
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
const ok = (n,p,d='') => { if(!p) bad++; console.log(`  ${p?'ok  ':'FAIL'}  ${n.padEnd(38)} ${d}`); };

fs.rmSync(path.join(HERE,'projects',P), {recursive:true, force:true});
await fetch(B+'/api/project/new',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:P})});

const br = await chromium.launch();
const pg = await br.newPage({viewport:{width:1600,height:950}});
const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
let asked = null;
pg.on('dialog', async d => { asked = d.message(); await d.accept(d.type()==='prompt' ? 'house' : 'shot'); });

await pg.goto(B); await pg.waitForTimeout(1400);
await pg.selectOption('#project', P); await pg.waitForTimeout(1200);
await pg.click('#btnNewCode'); await pg.waitForTimeout(1600);

ok('the code pane offers shared files', await pg.$('#pickLib') !== null);

await pg.selectOption('#pickLib', '__new'); await pg.waitForTimeout(1800);
ok('it asks what to call it', /shared file/i.test(asked||''), asked||'nothing asked');
ok('and the file exists on disk',
   fs.existsSync(path.join(HERE,'projects',P,'lib','house.js')),
   fs.existsSync(path.join(HERE,'projects',P,'lib')) ? fs.readdirSync(path.join(HERE,'projects',P,'lib')).join(', ') : 'no lib folder');
ok('and it opens for editing', /lib\/house\.js/.test(await pg.textContent('#codeName')),
   await pg.textContent('#codeName'));
ok('and says what it is', /every clip can call/.test(await pg.textContent('#codeName')));

/* write a function into it through the editor, exactly as a person would */
await pg.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.setValue(
  'function houseGreeting() {\n  return text("made in the editor").size(150).center(420);\n}\n'));
await pg.waitForTimeout(2200);
ok('typing into it saves it',
   /houseGreeting/.test(fs.readFileSync(path.join(HERE,'projects',P,'lib','house.js'),'utf8')));

/* and a clip can call it with no import and no reload */
const clip = fs.readdirSync(path.join(HERE,'projects',P,'clips'))[0];
await pg.evaluate(() => {
  const el = [...document.querySelectorAll('.clip')][0];
  el.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
});
await pg.waitForTimeout(400);
await pg.selectOption('#pickLib', ''); await pg.waitForTimeout(200);
/* open the clip again through the timeline, with a real mouse */
const box = await pg.locator('.clip').first().boundingBox();
await pg.mouse.click(box.x + 10, box.y + 10); await pg.waitForTimeout(900);
await pg.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.setValue(
  'duration(1000);\nhouseGreeting().enter(300);'));
await pg.waitForTimeout(2600);
ok('a clip calls it with no import', (await pg.textContent('#codeErr')) === '',
   await pg.textContent('#codeErr'));
ok('and it draws', await pg.evaluate(() => {
  const f = document.querySelector('#stage iframe');
  f.contentWindow.__render(600, 0);
  return [...f.contentDocument.querySelectorAll('#__world > *')]
    .some(e => /made in the editor/.test(e.textContent));
}));

/* it is listed next time, so it can be reopened */
await pg.reload(); await pg.waitForTimeout(1800);
ok('it is listed for reopening',
   (await pg.$$eval('#pickLib option', ns => ns.map(o=>o.value))).includes('lib/house.js'),
   (await pg.$$eval('#pickLib option', ns => ns.map(o=>o.textContent))).join(' / '));

ok('nothing threw', errs.length === 0, errs.slice(0,2).join(' | '));
await br.close();
fs.rmSync(path.join(HERE,'projects',P), {recursive:true, force:true});
console.log(bad ? `\n  ${bad} FAILED\n` : '\n  all good\n');
process.exit(bad?1:0);
