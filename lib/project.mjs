/* ============================================================================
   THE PROJECT — the thing a video editor edits.

     projects/<name>/
       project.json    media pool, tracks, clips. the edit.
       media/          what you imported
       clips/          the code clips: one html file per generated clip

   A CLIP is a span of time on a track. There are three kinds and the timeline
   does not care which is which:

     video   a file, played or seeked to (t - start + in)
     image   a file, held
     code    an html file that answers "what do you look like at time t?" —
             this is the Fusion replacement, and the only kind you write

   Tracks stack: later track = on top. Same as any editor.
   ========================================================================== */
import fs from 'fs';
import path from 'path';
import { PROJECTS, safeJoin } from './paths.mjs';

const DEFAULT = { w: 1920, h: 1080, fps: 30 };
const dirOf = name => safeJoin(PROJECTS, String(name || ''));
const cfgOf = name => path.join(dirOf(name) || '', 'project.json');

export function list() {
  try {
    return fs.readdirSync(PROJECTS, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort();
  } catch { return []; }
}

export function read(name) {
  const dir = dirOf(name);
  if (!dir || !fs.existsSync(dir)) return null;
  let p;
  try { p = JSON.parse(fs.readFileSync(cfgOf(name), 'utf8')); } catch { return null; }
  p = { ...DEFAULT, ...p, name };
  /* the client thinks in a stage, the file stores w/h/fps flat */
  p.stage = { w: p.w, h: p.h, fps: p.fps };
  p.media = p.media || [];
  p.tracks = (p.tracks && p.tracks.length ? p.tracks : [{ id: 'V1', clips: [] }]);

  /* A code clip's natural length is declared once, inside the clip. Read it
     back rather than storing a second copy that can drift. */
  for (const tr of p.tracks) for (const c of tr.clips || []) {
    if (c.kind === 'code') c.natural = naturalOf(dir, c.src);
    if (c.kind !== 'code') {
      const m = p.media.find(m => m.id === c.media);
      c.src = m ? m.src : c.src;
      c.natural = m && m.dur ? m.dur : c.natural;
    }
  }
  return p;
}

function naturalOf(dir, rel) {
  try {
    const s = fs.readFileSync(path.join(dir, rel), 'utf8');
    const m = s.match(/duration\s*\(\s*(\d+(?:\.\d+)?)/)
           || s.match(/__duration\s*=\s*(\d+(?:\.\d+)?)/);
    return m ? Math.round(Number(m[1])) : 3000;
  } catch { return 5000; }
}

export function write(name, patch) {
  const file = cfgOf(name);
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const next = { ...cur, ...patch };
  /* `natural` is derived, never stored — see read() */
  for (const tr of next.tracks || []) for (const c of tr.clips || []) delete c.natural;
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return { ok: true };
}

export function create(rawName) {
  const name = String(rawName || '').trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!name) return { ok: false, why: 'name it something' };
  const dir = dirOf(name);
  if (!dir) return { ok: false, why: 'bad name' };
  if (fs.existsSync(dir)) return { ok: false, why: `"${name}" already exists` };
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'clips'), { recursive: true });
  fs.writeFileSync(cfgOf(name), JSON.stringify({
    ...DEFAULT, name, media: [],
    tracks: [{ id: 'V1', clips: [] }, { id: 'V2', clips: [] }]
  }, null, 2) + '\n');
  return { ok: true, name };
}

/* ------------------------------------------------------------- code clips --
   A new code clip is a blank composition. Short on purpose: the contract, the
   easing primitives, one element. It is the equivalent of dropping a Fusion
   node on the timeline, and like that, it starts empty. */
export function newCodeClip(project, rawName) {
  const dir = dirOf(project);
  if (!dir || !fs.existsSync(dir)) return { ok: false, why: 'no such project' };
  const base = String(rawName || 'clip').trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'clip';
  fs.mkdirSync(path.join(dir, 'clips'), { recursive: true });
  let file = base + '.js', n = 1;
  while (fs.existsSync(path.join(dir, 'clips', file))) file = `${base}-${++n}.js`;
  fs.writeFileSync(path.join(dir, 'clips', file), BLANK(path.basename(file, '.js')));
  return { ok: true, src: 'clips/' + file };
}

/* Deletion means deletion. The only guard is the one the caller cannot make
   for itself: stay inside the project's clips folder. */
export function deleteCodeClip(project, src) {
  const dir = dirOf(project);
  if (!dir) return { ok: false, why: 'no such project' };
  const file = safeJoin(dir, src || '');
  if (!file || !/[\\/]clips[\\/]/.test(file)) return { ok: false, why: 'not a clip' };
  if (!fs.existsSync(file)) return { ok: true, already: true };
  try { fs.unlinkSync(file); return { ok: true }; }
  catch (e) { return { ok: false, why: e.message }; }
}

/* Clip files nothing on the timeline points at. Not deleted automatically —
   an unused file is not the same as an unwanted one — but worth being able
   to see and clear out. */
export function orphans(project) {
  const dir = dirOf(project);
  const proj = read(project);
  if (!dir || !proj) return [];
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'clips')); } catch { return []; }
  const used = new Set();
  for (const tr of proj.tracks) for (const c of tr.clips || []) if (c.src) used.add(c.src);
  return files.filter(f => !used.has('clips/' + f)).map(f => 'clips/' + f);
}

export const BLANK = () => `duration(3000);

`;
