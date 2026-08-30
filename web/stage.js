/* ============================================================================
   THE VIEWER — compositing whatever is under the playhead.

   One layer element per visible clip, stacked by track: track 0 at the bottom,
   the last track on top. Layers are kept between frames and reused, because
   creating a <video> or an <iframe> every frame is both slow and a black flash.

   Time inside a clip is  (t - clip.start) + clip.in  — the clip's own clock,
   which is what a code clip's __render(t) is given and what a video element's
   currentTime is set to. Nothing downstream ever sees timeline time.

   TRANSITIONS happen here and only here, which is the point: the render page
   loads this same file, so an export gets them without a second implementation
   of the picture. All they do is keep the outgoing clip's layer alive past its
   own end and set opacity, transform and filter on both — see transitions.js
   for the model and why the window sits after the cut.
   ========================================================================== */
import { S, $, allClips, clipEnd, qFrame, qTime, urlOf } from './state.js';
import * as TX from './transitions.js';

const layers = new Map();      /* clip.id -> {el, kind, src, ready} */
let onError = () => {};
export const setErrorSink = fn => { onError = fn; };

/* A clip written in the scene layer works its own length out from its
   choreography, and only knows it once it has run. */
let onDuration = () => {};
export const setDurationSink = fn => { onDuration = fn; };

/* Not an error: something the clip runs but that will not do what you meant. */
let onNote = () => {};
export const setNoteSink = fn => { onNote = fn; };

/* A clip that throws shows nothing, and nothing is the least informative
   thing a screen can do. Say so on the picture itself — the code pane's
   strip is easy to miss when you are looking at the viewer. */
function banner(msg) {
  let el = $('#stageErr');
  if (!el) {
    el = document.createElement('div');
    el.id = 'stageErr';
    $('#viewer').appendChild(el);
  }
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}
/* A thrown error carries its own stack; the line in it is the line you typed
   once the shell's offset is taken back off. The shell publishes that offset
   itself — reading it from the page beats a constant here that would go stale
   the moment the wrapper changed length. */
function lineOf(e, w) {
  const m = /<anonymous>:(\d+):(\d+)|:(\d+):(\d+)\)?$/m.exec(e && e.stack || '');
  if (!m) return null;
  const line = Number(m[1] || m[3]), col = Number(m[2] || m[4]);
  const off = (w && w.SHELL_OFFSET) || 0;
  return Number.isFinite(line) ? { line: Math.max(1, line - off), col } : null;
}
function fail(id, msg, where) { banner(msg); onError(id, msg, where); }

export function fit() {
  const v = $('#viewer'), fitBox = $('#stageFit'), box = $('#stageBox');
  if (!v || !fitBox) return;
  const pad = 8;
  const aw = Math.max(40, v.clientWidth - pad), ah = Math.max(24, v.clientHeight - pad);
  const k = Math.max(0.02, Math.min(aw / S.stage.w, ah / S.stage.h));
  fitBox.style.width = Math.round(S.stage.w * k) + 'px';
  fitBox.style.height = Math.round(S.stage.h * k) + 'px';
  box.style.width = S.stage.w + 'px';
  box.style.height = S.stage.h + 'px';
  box.style.transform = `scale(${k})`;
}

/* The pane changes size for more reasons than the window does - dragging a
   splitter, opening the log, a scrollbar appearing. Watch the pane itself
   rather than trying to remember every one of them. */
if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => fit());
  const start = () => { const v = $('#viewer'); if (v) ro.observe(v); };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start);
  else start();
}

/* iframes report back when their __render is available, and forward their own
   errors, so a typo in a code clip surfaces in the code pane rather than as a
   blank frame. */
addEventListener('message', ev => {
  const d = ev.data || {};
  if (!d.studio) return;
  for (const [id, L] of layers) {
    /* the iframe src carries a cache-busting query, the message carries the
       bare pathname — compare pathnames or nothing ever matches */
    let mine = false;
    try { mine = new URL(L.el.src, location.href).pathname === d.src; } catch {}
    if (L.kind !== 'code' || !mine) continue;
    if (d.studio === 'ready') {
      L.ready = true;
      L.natural = d.duration;
      /* A clip finishes loading AFTER the frame that asked for it was painted.
         Without this the picture only appears once something else moves the
         playhead — which at a standstill means never. */
      invalidate();
    }
    if (d.studio === 'duration' && d.duration > 0 && L.natural !== d.duration) {
      L.natural = d.duration;
      onDuration(id, d.duration);
    }
    if (d.studio === 'note') onNote(id, d.message);
    if (d.studio === 'error')
      fail(id, d.where ? `${d.where} line ${d.line}: ${d.message}`
                       : `line ${d.line}: ${d.message}`,
           /* a lib file's line is not a line in the open clip, so nothing in
              the code pane should be marked for it */
           d.where ? null : { line: d.line, col: d.col || 0 });
    if (d.studio === 'timeout') fail(id, 'the clip did not finish loading');
  }
});

function makeLayer(c) {
  let el;
  if (c.kind === 'video') { el = document.createElement('video'); el.muted = true; el.playsInline = true; el.preload = 'auto'; }
  else if (c.kind === 'image') el = document.createElement('img');
  else if (c.kind === 'audio') { el = document.createElement('audio'); el.style.display = 'none'; }
  else { el = document.createElement('iframe'); el.setAttribute('scrolling', 'no'); }
  el.className = 'layer';
  if (c.kind === 'code') el.style.background = 'transparent';
  el.src = urlOf(c.src) + (c.kind === 'code' ? '?v=' + Date.now() : '');
  $('#stage').appendChild(el);
  return { el, kind: c.kind, src: c.src, ready: c.kind !== 'code' };
}

export function reloadClip(id) {
  const L = layers.get(id);
  if (!L) return;
  L.ready = false;
  L.el.src = urlOf(L.src) + '?v=' + Date.now();
}

/* clip.id -> how that layer is dressed at t, for the transitions open at t.
   A map rather than a lookup per layer because a layer has to be able to ask
   "am I in one?" and get `undefined`, which is what resets it. */
function looks(all, t) {
  const look = new Map();
  for (const x of TX.activeAt(all, t)) {
    const s = TX.stylesAt(x.tx, x.u);
    if (x.a) look.set(x.a.id, s.going);
    look.set(x.b.id, { ...s.coming, over: true });
  }
  return look;
}

/* How far either side of the playhead a clip's layer is kept loaded. Two
   seconds is long enough for an iframe to be ready before its cut arrives at
   any sane frame rate, and short enough that a fifty-shot timeline is never
   fifty live iframes. */
const WARM = 2000;

let painting = false, lastFrame = -1;
export async function paint(force = false) {
  if (painting) return;
  const f = qFrame(S.t);
  if (f === lastFrame && !force) return;
  lastFrame = f;
  painting = true;
  try {
    const t = qTime(f);
    const all = allClips();
    const look = looks(all, t);
    /* An outgoing clip is under the playhead by the only definition that
       matters — it is on screen — even though the playhead has passed its
       out point. That is the whole mechanism. */
    const visible = all.filter(c => (t >= c.start && t < clipEnd(c)) || look.has(c.id));
    const want = new Set(visible.map(c => c.id));

    /* A LAYER IS BUILT BEFORE IT IS NEEDED, and retired a while after.

       An iframe takes several frames to load, and a render seeks and
       screenshots without waiting for one — so a layer first built at the
       instant of its own cut is a layer that is still blank when the shutter
       goes, and the first frames of every shot but the first export black.
       Tearing it down the moment the playhead leaves is the same mistake at
       the other end, and a transition needs BOTH clips warm at once.

       WARM is a window around the playhead, so this is still a function of t
       and of nothing else. It decides which layers EXIST; it never decides
       what any of them paints. */
    const near = all.filter(c => !want.has(c.id)
      && t >= c.start - WARM && t <= clipEnd(c) + WARM);
    const live = new Set([...want, ...near.map(c => c.id)]);

    for (const [id, L] of layers)
      if (!live.has(id)) { L.el.remove(); layers.delete(id); }

    for (const c of [...visible, ...near]) {
      let L = layers.get(c.id);
      if (!L || L.src !== c.src || L.kind !== c.kind) {
        if (L) L.el.remove();
        L = makeLayer(c);
        layers.set(c.id, L);
      }
      /* Loaded and waiting for its cut. Hidden rather than removed, and
         paused rather than left running, because a video nobody can see is
         still a video decoding frames. */
      if (!want.has(c.id)) {
        L.el.style.visibility = 'hidden';
        if (L.el.pause && !L.el.paused) L.el.pause();
        continue;
      }
      L.el.style.visibility = '';
      const style = look.get(c.id);
      /* Two clips in a transition are on the same track and would otherwise
         stack in whatever order their layers happen to sit in the document.
         Moving an iframe in the DOM reloads it, so the order is decided by
         z-index instead, and each track leaves a slot above itself for it. */
      L.el.style.zIndex = String((c._track + 1) * 2 + (style && style.over ? 1 : 0));
      TX.applyTo(L.el, style);
      const local = t - c.start + c.in;

      if (c.kind === 'video' || c.kind === 'audio') {
        const want = local / 1000;
        if (S.playing) {
          if (L.el.paused) L.el.play().catch(() => {});
          if (Math.abs(L.el.currentTime - want) > 0.12) L.el.currentTime = want;
        } else {
          if (!L.el.paused) L.el.pause();
          if (Math.abs(L.el.currentTime - want) > 0.005) L.el.currentTime = want;
        }
      } else if (c.kind === 'code') {
        const w = L.el.contentWindow;
        if (L.ready && w && w.__render) {
          try { await w.__render(local, qFrame(local)); banner(''); }
          catch (e) { fail(c.id, e.message, lineOf(e, w)); }
        }
      }
    }
  } finally { painting = false; }
}

export function invalidate() { lastFrame = -1; }

/* What the viewer thinks is happening. Guessing at a black screen from the
   outside is how an afternoon disappears; this makes it answerable. */
export function status() {
  const t = qTime(qFrame(S.t));
  const all = allClips();
  const look = looks(all, t);
  const want = all.filter(c => (t >= c.start && t < clipEnd(c)) || look.has(c.id));
  const parts = want.map(c => {
    const L = layers.get(c.id);
    if (!L) return c.kind + ':none';
    if (L.kind !== 'code') return c.kind;
    return 'code:' + (L.ready ? 'ready' : 'loading');
  });
  /* mid-transition is a state you can otherwise only guess at from a picture
     that looks half wrong */
  for (const x of TX.activeAt(all, t))
    parts.push(`${x.tx.kind} ${Math.round(x.u * 100)}%`);
  return want.length ? parts.join(' ') : 'nothing under playhead';
}
export function pauseAllMedia() {
  for (const [, L] of layers) if (L.el.pause) L.el.pause();
}
