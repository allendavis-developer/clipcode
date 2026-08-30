/* Importing. Media is COPIED into the project so a project folder is a whole
   thing you can move or back up — an editor whose media pool is a list of
   paths into someone's Downloads folder is a project that breaks next week.

   Durations come from ffprobe when it is on PATH. Without it, video still
   imports and gets a placeholder length you can trim; images do not need one. */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { PROJECTS, safeJoin } from './paths.mjs';

const VIDEO = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v']);
const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif']);
const AUDIO = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg']);
const FONT  = new Set(['.ttf', '.otf', '.woff', '.woff2']);

export const kindOf = f => {
  const e = path.extname(f).toLowerCase();
  return VIDEO.has(e) ? 'video' : IMAGE.has(e) ? 'image'
       : AUDIO.has(e) ? 'audio' : FONT.has(e) ? 'font' : null;
};

let probed = null;
function haveFfprobe() {
  if (probed === null) probed = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status === 0;
  return probed;
}
export function durationMs(file) {
  if (!haveFfprobe()) return null;
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  const s = Number(String(r.stdout).trim());
  return Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : null;
}

/* Import from anywhere on disk into projects/<name>/media/. */
export function importFiles(project, absPaths) {
  const dir = safeJoin(PROJECTS, project);
  if (!dir || !fs.existsSync(dir)) return { ok: false, why: 'no such project' };
  const mediaDir = path.join(dir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const added = [], skipped = [];
  for (const src of absPaths || []) {
    try {
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) { skipped.push([src, 'not a file']); continue; }
      const kind = kindOf(src);
      if (!kind) { skipped.push([src, 'unsupported type']); continue; }
      let base = path.basename(src), to = path.join(mediaDir, base), n = 1;
      while (fs.existsSync(to) && fs.statSync(to).size !== fs.statSync(src).size) {
        base = `${path.basename(src, path.extname(src))}-${++n}${path.extname(src)}`;
        to = path.join(mediaDir, base);
      }
      if (!fs.existsSync(to)) fs.copyFileSync(src, to);
      added.push({ id: 'm' + Date.now().toString(36) + added.length, kind,
                   name: base, src: 'media/' + base,
                   dur: kind === 'image' ? null : durationMs(to) });
    } catch (e) { skipped.push([src, e.message]); }
  }
  return { ok: true, added, skipped };
}

/* Whatever is already sitting in the project's media folder but not yet in the
   pool — so copying files in by hand is also a valid way to import. */
export function scan(project, known = []) {
  const dir = safeJoin(PROJECTS, project);
  const mediaDir = dir && path.join(dir, 'media');
  if (!mediaDir || !fs.existsSync(mediaDir)) return [];
  const have = new Set(known.map(m => m.src));
  const out = [];
  for (const f of fs.readdirSync(mediaDir)) {
    const rel = 'media/' + f, kind = kindOf(f);
    if (!kind || have.has(rel)) continue;
    out.push({ id: 'm' + Date.now().toString(36) + out.length, kind, name: f, src: rel,
               dur: kind === 'image' ? null : durationMs(path.join(mediaDir, f)) });
  }
  return out;
}
