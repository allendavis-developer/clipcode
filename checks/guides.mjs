/* Guides and eye trace, checked by driving the app. */
import { chromium } from 'playwright'; import fs from 'fs'; import path from 'path';
const B = process.env.STUDIO || 'http://localhost:4321', P = '_guides';
const HERE = 'studio';
let bad = 0;
const ok = (n, p, d='') => { if(!p) bad++; console.log(`  ${p?'ok  ':'FAIL'}  ${n.padEnd(40)} ${d}`); };

fs.rmSync(HERE+'/projects/'+P, {recursive:true, force:true});
await fetch(B+'/api/project/new',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:P})});
const dir = HERE+'/projects/'+P; fs.mkdirSync(dir+'/clips',{recursive:true});
/* two clips whose subject sits in opposite corners: a deliberately bad cut */
fs.writeFileSync(dir+'/clips/left.js',
  `duration(1000);\ntext('LEFT').size(200).at(120, 160);`);
fs.writeFileSync(dir+'/clips/right.js',
  `duration(1000);\ntext('RIGHT').size(200).at(1400, 820);`);
/* and one that matches the outgoing position */
/* Its subject sits where the OUTGOING clip left the eye, which is the cut that
   should read as matched. It follows right.js, not left.js — getting that
   backwards is what made this check fail the first time, and the code was
   right about the 88% jump it reported. */
fs.writeFileSync(dir+'/clips/near.js',
  `duration(1000);\ntext('NEAR').size(200).at(1390, 810);`);
const pj = JSON.parse(fs.readFileSync(dir+'/project.json','utf8'));
pj.tracks[0].clips = [
  {id:'l',kind:'code',src:'clips/left.js', start:0,   in:0,out:1000,natural:1000},
  {id:'r',kind:'code',src:'clips/right.js',start:1000,in:0,out:1000,natural:1000},
  {id:'n',kind:'code',src:'clips/near.js', start:2000,in:0,out:1000,natural:1000}];
fs.writeFileSync(dir+'/project.json', JSON.stringify(pj));

const br = await chromium.launch();
const pg = await br.newPage({viewport:{width:1600,height:950}});
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(B); await pg.waitForTimeout(1400);
await pg.selectOption('#project', P); await pg.waitForTimeout(1600);

ok('guides start off', await pg.evaluate(()=>document.querySelector('#guides').classList.contains('hidden')));
await pg.click('#btnGuides'); await pg.waitForTimeout(600);
ok('the button turns them on', !(await pg.evaluate(()=>document.querySelector('#guides').classList.contains('hidden'))));
ok('thirds and safe areas are drawn',
   (await pg.$$eval('#guides .gThird', n=>n.length)) === 4
   && (await pg.$$eval('#guides .gSafe', n=>n.length)) === 2);

const seek = async ms => { const r = await pg.evaluate(()=>{const e=document.querySelector('#ruler').getBoundingClientRect();
  return {left:e.left,y:e.top+e.height/2};}); await pg.mouse.click(r.left+(ms/1000)*90, r.y); await pg.waitForTimeout(700); };
const focus = () => pg.evaluate(()=>{const d=document.querySelector('#guides .gNow');
  return d ? {x:parseFloat(d.style.left), y:parseFloat(d.style.top)} : null;});

await seek(500);
const f1 = await focus();
ok('the eye is marked where the subject is', f1 && f1.x < 40 && f1.y < 40,
   f1 ? `${f1.x.toFixed(0)}%, ${f1.y.toFixed(0)}% for a word at (120, 160)` : 'no marker');
await seek(1500);
const f2 = await focus();
ok('and it follows the subject to the other corner', f2 && f2.x > 60 && f2.y > 60,
   f2 ? `${f2.x.toFixed(0)}%, ${f2.y.toFixed(0)}% for a word at (1400, 820)` : 'no marker');

await seek(1010);
const read1 = await pg.evaluate(()=>{const r=document.querySelector('.gRead'); return r?r.textContent:null;});
ok('a cut shows how far the eye must jump', /eye trace/.test(read1||''), read1||'nothing shown');
const jump1 = Number((/(\d+)% of the frame/.exec(read1||'')||[])[1]);
ok('and calls a corner-to-corner cut a long jump', jump1 > 45 && /long jump/.test(read1),
   `${jump1}% of the frame`);

await seek(2010);
const read2 = await pg.evaluate(()=>{const r=document.querySelector('.gRead'); return r?r.textContent:null;});
const jump2 = Number((/(\d+)% of the frame/.exec(read2||'')||[])[1]);
ok('a matched cut reads as matched', jump2 < 12 && /matched/.test(read2||''),
   `${jump2}% against the ${jump1}% one`);

await pg.locator('#viewer').screenshot({path:'C:/Users/allen/AppData/Local/Temp/claude/C--dev-graphics-channel/ed495a7a-f020-46b1-842d-a9b9efac922b/scratchpad/guides.png'});
await pg.click('#btnGuides'); await pg.waitForTimeout(400);
ok('and they turn off again', await pg.evaluate(()=>document.querySelector('#guides').classList.contains('hidden')));
ok('nothing threw', errs.length === 0, errs.slice(0,2).join(' | '));
await br.close(); fs.rmSync(dir,{recursive:true,force:true});
console.log(bad ? `\n  ${bad} FAILED\n` : '\n  all good\n');
process.exit(bad?1:0);
