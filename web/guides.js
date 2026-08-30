/* ============================================================================
   GUIDES, AND WHERE THE EYE IS.

   Two jobs behind one toggle, and they answer the same question from opposite
   directions.

   GUIDES YOU PLACE. Double-click the picture to drop a marker where the eye is
   in this shot. It STAYS THERE as you move through the video — across the cut,
   across every clip — so the next shot can be checked against it. That is what
   a guide is for in any design tool, and it is the editor's judgment rather
   than a program's guess about what matters.

   The persistence is the whole point. A marker that vanished when the playhead
   left the clip would tell you nothing, because the question is never "where
   is the subject in this frame", it is "did it move between these two frames".

   THE EYE TRACE READOUT. Alongside that, an estimate: where the frame's weight
   sits now, and at a cut, where it was on the last frame out against where it
   is on the first frame in, with the distance between them.

   That is Walter Murch's eye trace, from In the Blink of an Eye. The audience's
   focus of interest has a position in the frame, and a cut that moves it a long
   way makes the viewer hunt for the subject and feel the edit. Match the
   positions and the cut disappears. It is one of his six criteria for a good
   cut and, unlike the other five, one a tool can measure.

   The estimate is from the ELEMENTS, not pixels: each weighted by area times
   opacity, lifted a little by brightness. Saliency on pixels is the wrong model
   for motion graphics and is also unavailable, since the clip is drawn in an
   iframe this page cannot rasterise. For a frame that is a few big words on
   black, the centroid of the big words IS where you are looking. It is still an
   estimate, and it is the second opinion — the marker you placed is the first.

   Nothing here is exported. It is drawn over the picture, never in it.
   ========================================================================== */
import { S, $, allClips, clipEnd, qTime, qFrame } from './state.js';
import { draggable } from './drag.js';

let on = false;
let host = null;
let marks = [];                   /* the guides you placed, in stage fractions */
let built = false;

export const isOn = () => on;

/* Per project, because a guide is about one video. In localStorage rather than
   project.json because it is a working aid and not part of the output — the
   same reasoning as pane sizes. It survives a reload, which is what matters. */
const key = () => 'studio.guides.' + (S.name || '');
const load = () => {
  try { marks = JSON.parse(localStorage.getItem(key()) || '[]') || []; }
  catch { marks = []; }
};
const save = () => {
  try { localStorage.setItem(key(), JSON.stringify(marks)); } catch {}
};

export function init() {
  host = $('#guides');
  if (!host) return;
  const btn = $('#btnGuides');
  if (btn) btn.onclick = () => set(!on);
  set(false);
}

/* The project changed under us, so the guides for it did too. */
export function reload() {
  trail.length = 0;
  load();
  built = false;
  if (on) draw();
}

function set(v) {
  on = v;
  const btn = $('#btnGuides');
  if (btn) btn.classList.toggle('on', on);
  if (host) host.classList.toggle('hidden', !on);
  if (on) { load(); built = false; draw(); }
}

/* --------------------------------------------------------------- markers --
   Three kinds, because there are two different questions.

     point   a crosshair: where the eye is in this shot
     v / h   a full line across the frame: an edge to align to

   Lines are pulled out from the top and left the way every design tool does
   it, because that gesture is already in everyone's hands. */
function addMark(m) {
  marks.push(m);
  save();
  built = false;
  draw();
}

function removeMark(i) {
  marks.splice(i, 1);
  save();
  built = false;
  draw();
}

/* Rebuilt only when the set of markers changes, never on a frame. Replacing
   the overlay's HTML every frame would delete the element being dragged out
   from under the pointer halfway through the gesture. */
function buildMarks() {
  const layer = host.querySelector('#gMarks');
  if (!layer) return;
  layer.innerHTML = '';

  marks.forEach((m, i) => {
    const el = document.createElement('div');
    el.className = 'gMark ' + (m.k || 'point');
    place(el, m);
    el.title = 'drag to move · right-click to remove';
    layer.appendChild(el);

    el.addEventListener('contextmenu', e => { e.preventDefault(); removeMark(i); });
    dragMark(el, i);
  });
}

function place(el, m) {
  if (m.k === 'v') el.style.left = (m.x * 100) + '%';
  else if (m.k === 'h') el.style.top = (m.y * 100) + '%';
  else { el.style.left = (m.x * 100) + '%'; el.style.top = (m.y * 100) + '%'; }
}

/* Clamped to the frame, because a guide outside the picture is not a guide. */
const frac = (v, lo, size) => Math.max(0, Math.min(1, (v - lo) / size));

function dragMark(el, i) {
  draggable(el, {
    start: () => ({ r: host.getBoundingClientRect() }),
    move: (e, c) => {
      const m = marks[i];
      if (m.k !== 'h') m.x = frac(e.clientX, c.r.left, c.r.width);
      if (m.k !== 'v') m.y = frac(e.clientY, c.r.top, c.r.height);
      place(el, m);
    },
    end: () => save()
  });
}

/* The rails you pull a line out of. Thin strips along the top and left inside
   the overlay; dragging off one creates a guide and hands the drag straight to
   it, so it is one continuous gesture rather than click-then-drag. */
function railDrag(rail, kind) {
  draggable(rail, {
    start: e => {
      const r = host.getBoundingClientRect();
      const m = kind === 'v'
        ? { k: 'v', x: frac(e.clientX, r.left, r.width) }
        : { k: 'h', y: frac(e.clientY, r.top, r.height) };
      marks.push(m);
      const el = document.createElement('div');
      el.className = 'gMark ' + kind;
      place(el, m);
      el.addEventListener('contextmenu', ev => {
        ev.preventDefault();
        removeMark(marks.indexOf(m));
      });
      host.querySelector('#gMarks').appendChild(el);
      dragMark(el, marks.length - 1);
      return { el, m, r };
    },
    move: (e, c) => {
      if (c.m.k === 'v') c.m.x = frac(e.clientX, c.r.left, c.r.width);
      else c.m.y = frac(e.clientY, c.r.top, c.r.height);
      place(c.el, c.m);
    },
    end: () => save()
  });
}

/* ------------------------------------------------------------------ focus --
   The centroid of what is on screen, weighted by how much attention each thing
   is likely to take. Area is most of it — a 268px headline dominates a 40px
   caption and should. Opacity multiplies, so something fading out stops
   counting as it goes. Brightness lifts it, because on a black stage a lit
   element is where you look and a dark one is not. */
function focusOf(frameEl) {
  let doc = null;
  try { doc = frameEl && frameEl.contentDocument; } catch { return null; }
  if (!doc) return null;

  const stage = doc.getElementById('stage');
  if (!stage) return null;
  const box = stage.getBoundingClientRect();
  if (!box.width || !box.height) return null;

  let wx = 0, wy = 0, total = 0;
  for (const el of doc.querySelectorAll('#stage *')) {
    if (el.id === '__world' || el.id === '__wires') continue;
    /* a wrapper contributes through its children, not as a block of its own */
    if (el.children.length && !el.textContent.trim()
        && el.tagName !== 'IMG' && el.tagName !== 'path') continue;

    const cs = getComputedStyle(el);
    const o = Number(cs.opacity);
    if (!(o > 0.04) || cs.visibility === 'hidden' || cs.display === 'none') continue;

    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;

    const vw = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left));
    const vh = Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top));
    if (!vw || !vh) continue;                 /* clipped out of frame */

    const w = vw * vh * o * (luma(cs.color) * 0.6 + 0.4);
    wx += (Math.max(r.left, box.left) + vw / 2 - box.left) * w;
    wy += (Math.max(r.top, box.top) + vh / 2 - box.top) * w;
    total += w;
  }
  if (!total) return null;
  return { x: (wx / total) / box.width, y: (wy / total) / box.height };
}

function luma(css) {
  const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(css || '');
  if (!m) return 1;
  return Math.min(1, (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255);
}

/* The frame that is on screen right now. Only the clips under the playhead are
   mounted — the compositor removes the rest — so this can answer for NOW and
   for nothing else. Everything about the past is remembered, not re-derived. */
function liveFrame() {
  /* The topmost VISIBLE layer. Clips near the playhead are kept loaded and
     hidden so a transition has both sides warm, so "the last iframe" is now
     often one that is not on screen. */
  let best = null, top = -Infinity;
  for (const f of document.querySelectorAll('#stage iframe')) {
    if (f.style.visibility === 'hidden') continue;
    const z = Number(f.style.zIndex) || 0;
    if (z >= top) { top = z; best = f; }
  }
  return best;
}

/* ------------------------------------------------------------- the trail --
   Where the eye has been, sampled as the playhead passes.

   The first version of this asked the compositor for the frame a few
   milliseconds before a cut and the frame a few after, and compared them. It
   could not work: the outgoing clip is unmounted the moment the playhead
   leaves it, so both questions were answered by whichever iframe happened to
   still be in the DOM. Sometimes that was the right one and the number was
   right, which is worse than it never working.

   So the focus is recorded as it goes past, with the time it was at. At a cut,
   the last sample before the edge and the first after are both real
   measurements of what was actually on screen. If you have not been across the
   cut yet there is nothing to compare, and it says so rather than inventing a
   number. */
const trail = [];
const TRAIL = 240;

function record(t, f) {
  if (!f) return;
  const last = trail[trail.length - 1];
  if (last && Math.abs(last.t - t) < 8) { last.x = f.x; last.y = f.y; return; }
  trail.push({ t, x: f.x, y: f.y });
  if (trail.length > TRAIL) trail.shift();
}

/* the newest sample before the edge, and the oldest after it */
function across(edge) {
  let before = null, after = null;
  for (const s of trail) {
    if (s.t < edge - 1 && (!before || s.t > before.t)) before = s;
    if (s.t > edge + 1 && (!after || s.t < after.t)) after = s;
  }
  return before && after ? { before, after } : null;
}

/* -------------------------------------------------------------- the draw -- */
export function draw() {
  if (!on || !host) return;
  const fit = $('#stageFit'), viewer = $('#viewer');
  if (!fit || !viewer) return;

  const r = fit.getBoundingClientRect(), v = viewer.getBoundingClientRect();
  host.style.left = (r.left - v.left) + 'px';
  host.style.top = (r.top - v.top) + 'px';
  host.style.width = r.width + 'px';
  host.style.height = r.height + 'px';

  if (!built) {
    host.innerHTML =
      `<svg class="gFixed" viewBox="0 0 100 100" preserveAspectRatio="none">
         <line class="gThird" x1="33.33" y1="0" x2="33.33" y2="100"/>
         <line class="gThird" x1="66.66" y1="0" x2="66.66" y2="100"/>
         <line class="gThird" x1="0" y1="33.33" x2="100" y2="33.33"/>
         <line class="gThird" x1="0" y1="66.66" x2="100" y2="66.66"/>
         <rect class="gSafe" x="5" y="5" width="90" height="90"/>
         <rect class="gSafe title" x="10" y="10" width="80" height="80"/>
         <line class="gMid" x1="50" y1="47" x2="50" y2="53"/>
         <line class="gMid" x1="47" y1="50" x2="53" y2="50"/>
       </svg>
       <div class="gRail v" id="gRailV"></div>
       <div class="gRail h" id="gRailH"></div>
       <div id="gMarks"></div>
       <div id="gLive"></div>
       <div class="gHint">drag from the top or left edge for a line &middot; double-click for a point
         &middot; they stay put across every clip</div>`;
    buildMarks();
    railDrag(host.querySelector('#gRailV'), 'v');
    railDrag(host.querySelector('#gRailH'), 'h');
    built = true;

    /* Double-click, not click: a single click on the picture should stay free
       for whatever the viewer wants it for later. */
    host.addEventListener('dblclick', e => {
      if (e.target.classList.contains('gMark')) return;
      const b = host.getBoundingClientRect();
      addMark({ k: 'point',
                x: (e.clientX - b.left) / b.width,
                y: (e.clientY - b.top) / b.height });
    });
  }

  /* only this part changes with the playhead */
  const live = host.querySelector('#gLive');
  if (!live) return;
  const here = focusOf(liveFrame());
  record(S.t, here);
  const cut = nearestCut(S.t);
  live.innerHTML = (here ? dot(here, 'gNow') : '') + (cut ? eyeTrace(cut) : '');
}

const dot = (p, cls) =>
  `<div class="gDot ${cls}" style="left:${(p.x * 100).toFixed(2)}%;`
  + `top:${(p.y * 100).toFixed(2)}%"></div>`;

function nearestCut(t) {
  const edges = allClips().map(c => c.start).concat(allClips().map(c => clipEnd(c)));
  let best = null;
  for (const e of edges) {
    if (e <= 0) continue;
    const d = Math.abs(e - t);
    if (d < 400 && (!best || d < Math.abs(best - t))) best = e;
  }
  return best;
}

function eyeTrace(edge) {
  const pair = across(edge);
  if (!pair) return `<div class="gRead dim">eye trace &middot; `
                  + `scrub across the cut to measure it</div>`;
  const { before, after } = pair;

  const jump = Math.round(Math.hypot((after.x - before.x) * 100, (after.y - before.y) * 100));
  /* A band, said as a suggestion rather than a rule: under about a tenth of the
     frame the eye does not have to travel; past a third it is a hunt. */
  const verdict = jump < 10 ? 'matched' : jump < 33 ? 'a short move' : 'a long jump';

  return `<svg class="gTrace" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line x1="${before.x * 100}" y1="${before.y * 100}"
                  x2="${after.x * 100}" y2="${after.y * 100}"/>
          </svg>`
    + dot(before, 'gWas') + dot(after, 'gNext')
    + `<div class="gRead">eye trace &middot; ${jump}% of the frame &middot; ${verdict}</div>`;
}
