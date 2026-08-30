/* ============================================================================
   THE RENDER. A project in, an mp4 out.

     node studio/render.mjs <project>
     node studio/render.mjs <project> out.mp4 --fps 60 --from 0 --to 5000
     node studio/render.mjs <project> --scale 0.5      a fast draft

   It drives the real app in a real browser, at the stage's own size, and
   screenshots one frame at a time into ffmpeg. That is slower than a clever
   approach and it is the only one that is honest: the picture is composited by
   the same stage.js the viewer uses, so what comes out is what you watched.
   Any other render path is a second implementation of the picture, and two
   implementations drift.

   IT SEEKS RATHER THAN PLAYS. Every clip's __render is a pure function of t,
   so frame 900 can be asked for directly and is exactly the frame the playhead
   calls 900 — no warm-up, no replaying from the start, no accumulated state.
   That is what the purity rule buys, and it is why breaking it shows up here
   as a render that disagrees with the preview.

   Playwright is a devDependency and ffmpeg is expected on PATH. Neither is
   needed to RUN the editor — the server still has no runtime dependencies at
   all. Rendering is a separate tool that happens to live in the same folder.
   ========================================================================== */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = process.env.STUDIO_PROJECTS || path.join(HERE, 'projects');
const BASE = process.env.STUDIO || 'http://localhost:4321';

/* --------------------------------------------------------------- arguments */
const argv = process.argv.slice(2);
const flags = {};
const loose = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
  else loose.push(argv[i]);
}
const project = loose[0];
if (!project) {
  console.log(`
  node studio/render.mjs <project> [out.mp4] [options]

    --fps N       frames per second (default: the project's own)
    --from MS     start at this time on the timeline (default 0)
    --to MS       stop here (default the end of the last clip)
    --scale K     render at K times the stage size — 0.5 for a quick draft
    --crf N       quality, lower is better, 18 is visually lossless (default 18)
    --keep-frames leave the png frames on disk next to the mp4
`);
  process.exit(1);
}
const out = path.resolve(loose[1] || path.join(HERE, 'renders', project + '.mp4'));
const scale = Number(flags.scale || 1);
const crf = String(flags.crf || 18);

/* ------------------------------------------------------------------ tools */
function have(cmd) {
  return new Promise(resolve => {
    /* no shell: the argument is fixed, and a shell here only buys a warning */
    const p = spawn(cmd, ['-version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', code => resolve(code === 0));
  });
}

const bar = (done, total, extra = '') => {
  const w = 34, k = Math.round((done / total) * w);
  process.stdout.write('\r  [' + '#'.repeat(k) + '-'.repeat(w - k) + '] '
    + String(done).padStart(String(total).length) + '/' + total + '  ' + extra + '   ');
};

/* ------------------------------------------------------------------- main */
if (!(await have('ffmpeg'))) {
  console.error('\n  ffmpeg is not on PATH. It is what turns the frames into an mp4.\n');
  process.exit(1);
}

let reachable = false;
try { reachable = (await fetch(BASE + '/api/projects')).ok; } catch {}
if (!reachable) {
  console.error(`\n  ${BASE} is not answering. Start the editor first:  npm start\n`);
  process.exit(1);
}

console.log(`\nRENDER  ${project}\n`);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 100, height: 100 },
  deviceScaleFactor: scale
});

const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message)));

await page.goto(`${BASE}/render?project=${encodeURIComponent(project)}`);
await page.waitForFunction(() => typeof window.__renderInfo === 'function', null, { timeout: 15000 });

const info = await page.evaluate(() => window.__renderInfo());
if (!info.ok) {
  console.error(`  cannot open the project: ${info.error}\n`);
  await browser.close();
  process.exit(1);
}

const fps = Number(flags.fps || info.fps || 30);
const from = Number(flags.from || 0);
const to = Number(flags.to || info.duration);
if (!(to > from)) {
  console.error(`  nothing to render: the timeline is ${Math.round(info.duration)}ms long.\n`);
  await browser.close();
  process.exit(1);
}

/* The window is the stage, so a screenshot is a frame. deviceScaleFactor
   multiplies the pixels without changing the layout, which is how --scale
   gives a smaller file of the same composition rather than a different one. */
await page.setViewportSize({ width: info.w, height: info.h });

const frames = Math.max(1, Math.round(((to - from) / 1000) * fps));
console.log(`  ${info.w}x${info.h} @ ${fps}fps${scale !== 1 ? ` x${scale}` : ''}`
  + `   ${(from / 1000).toFixed(2)}s to ${(to / 1000).toFixed(2)}s`
  + `   ${frames} frames   ${info.clips} clip(s)\n`);

process.stdout.write('  waiting for clips and fonts…');
const ready = await page.evaluate(() => window.__renderReady());
process.stdout.write(ready ? ' ready\n\n' : ' TIMED OUT — rendering anyway\n\n');

fs.mkdirSync(path.dirname(out), { recursive: true });

/* ------------------------------------------------------------------ sound --
   The audio clips on the timeline, each trimmed to its own in/out and delayed
   to where it sits. Only clips of kind 'audio': video plays muted in the
   viewer, so exporting its sound would be exporting something you never heard,
   and the whole contract of this renderer is that the file is what you
   watched. */
const sound = (await (await fetch(BASE + '/api/project?name=' + encodeURIComponent(project))).json());
const audioClips = ((sound && sound.project && sound.project.tracks) || [])
  .flatMap(tr => tr.clips || [])
  .filter(c => c.kind === 'audio')
  .map(c => {
    const m = (sound.project.media || []).find(x => x.id === c.media);
    return m ? { ...c, file: path.join(PROJECTS_DIR, project, m.src) } : null;
  })
  .filter(c => c && fs.existsSync(c.file))
  /* only what falls inside the rendered window */
  .filter(c => c.start + (c.out - c.in) > from && c.start < to);

const silent = audioClips.length ? out.replace(/\.[^.]+$/, '') + '.silent.mp4' : out;

/* Frames go in over stdin as a png stream, so nothing large is ever written
   to disk unless you ask for it. */
const args = [
  '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', crf,
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silent
];
const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
let ffErr = '';
ff.stderr.on('data', d => { ffErr += d.toString(); if (ffErr.length > 8000) ffErr = ffErr.slice(-8000); });

const keepDir = flags['keep-frames'] !== undefined ? out.replace(/\.[^.]+$/, '') + '-frames' : null;
if (keepDir) fs.mkdirSync(keepDir, { recursive: true });

const started = Date.now();
const problems = new Set();

for (let i = 0; i < frames; i++) {
  const t = from + (i * 1000) / fps;
  const r = await page.evaluate(ms => window.__renderSeek(ms), t);
  for (const pr of r.problems) problems.add(pr);

  const png = await page.screenshot({ type: 'png' });
  if (keepDir) fs.writeFileSync(path.join(keepDir, String(i).padStart(6, '0') + '.png'), png);

  if (!ff.stdin.write(png)) await new Promise(res => ff.stdin.once('drain', res));

  if (i % 5 === 0 || i === frames - 1) {
    const per = (Date.now() - started) / (i + 1);
    const left = Math.round((per * (frames - i - 1)) / 1000);
    bar(i + 1, frames, `${(1000 / per).toFixed(1)} fps  ~${left}s left`);
  }
}
ff.stdin.end();

const code = await new Promise(res => ff.on('close', res));
await browser.close();

console.log('\n');
if (problems.size) {
  console.log('  clips reported problems while rendering:');
  for (const p of problems) console.log('    ' + p);
  console.log('');
}
if (pageErrors.length) {
  console.log('  page errors: ' + pageErrors.slice(0, 3).join(' | ') + '\n');
}
if (code !== 0) {
  console.error('  ffmpeg failed:\n' + ffErr.split('\n').slice(-12).join('\n'));
  process.exit(1);
}

/* ------------------------------------------------------------------- mux --
   One input per audio clip, trimmed and delayed onto the timeline, mixed
   together and laid against the picture. adelay wants milliseconds per
   channel, and `all=1` applies the one value to every channel so a stereo
   file does not come out with one side early. */
if (audioClips.length) {
  process.stdout.write(`  adding ${audioClips.length} audio clip(s)…`);
  const inputs = [];
  const filters = [];
  audioClips.forEach((c, i) => {
    inputs.push('-i', c.file);
    const startS = (c.in / 1000).toFixed(4);
    const endS = (c.out / 1000).toFixed(4);
    const delay = Math.max(0, Math.round(c.start - from));
    filters.push(`[${i + 1}:a]atrim=start=${startS}:end=${endS},`
               + `asetpts=PTS-STARTPTS,adelay=${delay}:all=1[a${i}]`);
  });
  const mix = audioClips.map((_, i) => `[a${i}]`).join('')
            + `amix=inputs=${audioClips.length}:normalize=0:dropout_transition=0[mix]`;

  const muxArgs = ['-y', '-v', 'error', '-i', silent, ...inputs,
    '-filter_complex', filters.concat(mix).join(';'),
    '-map', '0:v', '-map', '[mix]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart', out];

  const mux = spawn('ffmpeg', muxArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  let muxErr = '';
  mux.stderr.on('data', d => { muxErr += d.toString(); });
  const mcode = await new Promise(r => mux.on('close', r));
  if (mcode !== 0) {
    console.error('\n  the audio would not mux, so the picture is here without it:');
    console.error('  ' + silent);
    console.error(muxErr.split('\n').slice(-8).join('\n'));
    process.exit(1);
  }
  fs.rmSync(silent, { force: true });
  process.stdout.write(' done\n');
}

const size = fs.statSync(out).size;
console.log(`  ${out}`);
console.log(`  ${(size / 1048576).toFixed(1)} MB   ${(frames / fps).toFixed(2)}s`
  + `   rendered in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
