/* ============================================================================
   Runs every check driver in this folder.

     node studio.mjs            in one terminal
     node studio/checks/run.mjs in another

   A driver here is a standalone script that drives the real app for one
   feature. They live apart from test.mjs because test.mjs is one long session
   through the whole editor — good for catching things that only break in
   combination, bad for anything that needs its own project, its own fixtures,
   or a browser it can throw away.

   The convention: any `<name>.mjs` in this folder is a driver and is run.
   A leading underscore means scratch and is skipped, so a probe left behind
   while chasing something does not become part of the suite by accident.
   Each driver exits non-zero if it failed, which is all this needs to know.
   ========================================================================== */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.STUDIO || 'http://localhost:4321';

let reachable = false;
try { reachable = (await fetch(BASE + '/api/projects')).ok; } catch {}
if (!reachable) {
  console.error(`\n  ${BASE} is not answering. Start the editor first:  npm start\n`);
  process.exit(1);
}

const drivers = fs.readdirSync(HERE)
  .filter(f => f.endsWith('.mjs') && f !== 'run.mjs' && !f.startsWith('_'))
  .sort();

if (!drivers.length) {
  console.log('\n  no check drivers\n');
  process.exit(0);
}

console.log(`\nCHECKS — ${drivers.length} driver(s)\n`);

const failed = [];
for (const d of drivers) {
  process.stdout.write(`  ${d.padEnd(22)} `);
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(HERE, d)], {
    encoding: 'utf8', timeout: 600000, env: { ...process.env, STUDIO: BASE }
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (r.status === 0) {
    console.log(`ok    ${secs}s`);
  } else {
    failed.push(d);
    console.log(`FAIL  ${secs}s`);
    /* the failing lines, not the whole run — a driver prints one line per
       check and only the failures are worth reading here */
    const out = String(r.stdout || '') + String(r.stderr || '');
    for (const line of out.split('\n')) {
      if (/FAIL|Error|error:/i.test(line)) console.log('      ' + line.trim().slice(0, 150));
    }
  }
}

console.log(failed.length
  ? `\n  ${failed.length} failed: ${failed.join(', ')}\n`
  : '\n  all drivers passed\n');
process.exit(failed.length ? 1 : 0);
