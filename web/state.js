/* The shared model. One object, so every module is looking at the same edit,
   and one save() so nobody invents a second way to persist it. */
export const S = {
  name: null,                 /* project name */
  stage: { w: 1920, h: 1080, fps: 30 },
  media: [],
  tracks: [],                 /* [{id, clips:[{id,kind,src,media,start,in,out,natural}]}] */
  t: 0,                       /* playhead, ms */
  playing: false,
  loop: true,
  sel: null,                  /* selected clip id */
  pxPerSec: 90,
  dirty: false
};

export const $ = s => document.querySelector(s);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const fps = () => S.stage.fps || 30;
export const qFrame = t => Math.round((t / 1000) * fps());
export const qTime = f => (f * 1000) / fps();

export function allClips() {
  return S.tracks.flatMap((tr, ti) => (tr.clips || []).map(c => ({ ...c, _track: ti })));
}
export function clipById(id) {
  for (let ti = 0; ti < S.tracks.length; ti++) {
    const c = (S.tracks[ti].clips || []).find(c => c.id === id);
    if (c) return { clip: c, track: ti };
  }
  return null;
}
export const clipEnd = c => c.start + (c.out - c.in);
export function duration() {
  let end = 0;
  for (const tr of S.tracks) for (const c of tr.clips || []) end = Math.max(end, clipEnd(c));
  return end;
}
export function tc(ms) {
  const f = qFrame(ms), F = fps(), s = Math.floor(f / F), n = ((f % F) + F) % F;
  const p = x => String(Math.max(0, x)).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(n)}`;
}

/* ------------------------------------------------------------------ saving --
   There is no save button and there is not going to be one. Every edit writes
   project.json within a quarter second, and every code change writes its file.

   The only thing a debounce can lose is the last edit before the tab goes
   away, so flush() exists and is called on the two ways that happens: the tab
   being hidden, and the page unloading. keepalive lets that request outlive
   the document, which a plain fetch does not. */
let saveTimer = null;
export function markSaved(ok) {
  const el = $('#saved');
  el.textContent = ok ? 'saved' : 'saving…';
  el.className = 'pill' + (ok ? '' : ' warn');
}
function body() { return JSON.stringify({ tracks: S.tracks, media: S.media }); }

export async function flush(keepalive = false) {
  if (!S.dirty || !S.name) return;
  clearTimeout(saveTimer);
  await fetch('/api/project?name=' + encodeURIComponent(S.name), {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: body(), keepalive
  });
  S.dirty = false;
  markSaved(true);
}

export function save() {
  S.dirty = true;
  markSaved(false);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flush(), 250);
}

addEventListener('visibilitychange', () => { if (document.hidden) flush(true); });
addEventListener('pagehide', () => flush(true));
export const uid = () => 'c' + Math.random().toString(36).slice(2, 9);
export const mediaById = id => S.media.find(m => m.id === id);
export const urlOf = src => `/p/${encodeURIComponent(S.name)}/${src}`;
