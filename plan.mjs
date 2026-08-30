/* ============================================================================
   WHAT IS IN THIS VIDEO, RESOLVED.

     node studio/plan.mjs <project>
     node studio/plan.mjs <project> --json
     node studio/plan.mjs <project> --clip 04-people

   Prints the timeline and, for every code clip, the choreography it resolves
   to: what exists, what it is called, when it starts and ends, and what its
   timing was written as a relationship TO.

   It exists for editing something that is already built.

   The expensive part of a video is construction — laying out the scenes, the
   typography, the camera moves, the timing. The cheap part is taste: this
   number twenty pixels higher, that entrance less aggressive, the second
   statistic a beat later. Those should be small edits to a legible file, not
   a regeneration.

   The thing that makes a small edit possible is knowing what is there. Reading
   the source tells you what was WRITTEN; this tells you what it came to, which
   is a different and usually more useful thing when the timings are written as
   relationships. `subtitle.enter(250).after(title, 80)` says one thing in the
   file and another on the timeline, and you need both to change it well.

   So: read this, change one line, and everything downstream follows because
   the relationships are what was written down. That is the same property that
   makes the format good for a person, and it is why an assistant editing these
   files produces a diff rather than a rewrite.
   ========================================================================== */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.STUDIO || 'http://localhost:4321';

const argv = process.argv.slice(2);
const flags = {};
const loose = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    flags[k] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
  } else loose.push(argv[i]);
}

const project = loose[0];
if (!project) {
  console.log(`
  node studio/plan.mjs <project> [options]

    --json        machine-readable, for something editing the files
    --clip NAME   only this clip
`);
  process.exit(1);
}

let reachable = false;
try { reachable = (await fetch(BASE + '/api/projects')).ok; } catch {}
if (!reachable) {
  console.error(`\n  ${BASE} is not answering. Start the editor first:  npm start\n`);
  process.exit(1);
}

const r = await (await fetch(BASE + '/api/project?name=' + encodeURIComponent(project))).json();
if (!r || !r.ok) {
  console.error(`\n  no project called ${project}\n`);
  process.exit(1);
}
const proj = r.project;

const clips = (proj.tracks || [])
  .flatMap((tr, i) => (tr.clips || []).map(c => ({ ...c, track: i })))
  .filter(c => c.kind === 'code')
  .filter(c => !flags.clip || c.src.includes(flags.clip))
  .sort((a, b) => a.start - b.start);

/* Each clip is asked what it resolves to, in the same browser the editor uses,
   because the resolver lives in the clip and there is no second copy of it to
   ask. A plan derived by re-implementing the resolution here would drift from
   the one the picture is drawn from, which is the whole failure this avoids. */
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });

const out = { project, stage: proj.stage, clips: [] };

for (const c of clips) {
  const url = `${BASE}/p/${encodeURIComponent(project)}/${c.src}`;
  let plan = [], error = null, duration = null;
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 8000 });
    const got = await page.evaluate(() => {
      try {
        window.__render(0, 0);
        return { plan: window.__scenePlan ? window.__scenePlan() : [],
                 duration: window.__duration || null };
      } catch (e) { return { error: String(e.message) }; }
    });
    plan = got.plan || [];
    duration = got.duration;
    error = got.error || null;
  } catch (e) {
    error = String(e.message).split('\n')[0];
  }
  out.clips.push({ src: c.src, track: c.track, start: c.start,
                   end: c.start + (c.out - c.in), duration, error, plan });
}

await browser.close();

if (flags.json) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

/* -------------------------------------------------------------- readable -- */
const ms = n => (n === null || n === undefined) ? '—' : String(Math.round(n)) + 'ms';

console.log(`\n${project}   ${proj.stage.w}x${proj.stage.h} @ ${proj.stage.fps}fps`
  + `   ${out.clips.length} code clip(s)\n`);

for (const c of out.clips) {
  const head = `${c.src.replace(/^clips\//, '')}`;
  console.log(`  ${head}`);
  console.log(`  ${'-'.repeat(head.length)}`);
  console.log(`  on the timeline   ${ms(c.start)} to ${ms(c.end)}   (track V${c.track + 1})`);
  console.log(`  its own length    ${ms(c.duration)}`);
  if (c.error) {
    console.log(`  BROKEN            ${c.error}\n`);
    continue;
  }
  if (!c.plan.length) {
    console.log(`  nothing declared  (written in the motion.js layer, or empty)\n`);
    continue;
  }
  const w = Math.max(...c.plan.map(p => (p.name || p.id).length));
  for (const p of c.plan) {
    const who = (p.name || p.id).padEnd(w);
    const what = (p.text || p.kind).slice(0, 22).padEnd(22);
    /* the relationship is the point: it is what you change */
    const rel = p.rel === 'absolute' ? '' : `   <- ${p.rel}`;
    console.log(`    ${who}  ${what} ${String(p.start).padStart(6)} to `
      + `${String(p.end).padStart(6)}${rel}`);
  }
  console.log('');
}

console.log('  a name in the first column is one given with .as(); the rest are\n'
  + '  positional, and shift if something is inserted above them\n');
