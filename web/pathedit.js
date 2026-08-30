/* ============================================================================
   THE SHAPE EDITOR.

   A shape is a mouse job for exactly the reason an easing is. Put the cursor
   inside a path([[x, y], ...]) — or a raw('M...') — and this opens on it.
   Drag, and the numbers in your code are rewritten as you drag.

   Where the curve editor is TALL because everything an easing says is
   vertical, this one is the shape of the FRAME, at the stage's own aspect and
   in the stage's own coordinates. That is not decoration: the only question
   being asked here is "where on the picture is this", and a point typed as
   (960, 540) has to LOOK like the middle of the picture or the panel is lying.

   Thirds and a centre cross, because that is how you place something by eye.

   It edits the code and stores nothing of its own — every cursor move re-seeds
   it from the text, so the file stays the only source of truth and what it
   wrote is right there to keep editing.
   ========================================================================== */
import { draggable } from './drag.js';

let host = null, onChange = () => {};
let mode = 'path';                 /* 'path' — points we own. 'raw' — path data */
let points = [];
let opts = { smooth: false, closed: false, color: null, width: null, fill: null };
let stage = { w: 1920, h: 1080 };
let dragging = false;
let snapping = false;
let gridKey = '';

const SNAP = 20;
const DEFAULT_WIDTH = 6;           /* what scene.js draws when you say nothing */
const DEFAULT_COLOR = '#ffb02e';

export const isDragging = () => dragging;
export const isOpen = () => !!host && !host.classList.contains('hidden');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const round = n => Math.round(n);

/* ------------------------------------------------------------------- build -- */
export function init(handlers = {}) {
  onChange = handlers.onChange || onChange;
  host = document.querySelector('#pathedit');
  if (!host) return;

  host.innerHTML = `
    <div class="pathHead">
      <span id="pathMode">shape</span>
      <span id="pathNums" class="mono"></span>
      <span class="grow"></span>
      <button id="pathClose" class="btn mini">close</button>
    </div>

    <div class="pathBody">
      <svg id="pathSvg" preserveAspectRatio="xMidYMid meet">
        <g id="pathGrid"></g>
        <path id="pathShape" class="pathShape"/>
        <path id="pathProbe" class="pathProbe"/>
        <g id="pathDots"></g>
      </svg>
    </div>

    <div class="pathTools">
      <button id="pathSmooth" class="chip" title="curve through the points instead of cornering">smooth</button>
      <button id="pathClosed" class="chip" title="join the last point back to the first">closed</button>
      <button id="pathSnap" class="chip" title="snap to a ${SNAP}px grid">snap</button>
      <span class="sep"></span>
      <span class="pathLabel">stroke</span>
      <input id="pathColour" class="mini swatch" type="color" value="${DEFAULT_COLOR}">
      <input id="pathWidth" type="range" min="1" max="40" step="1">
      <span id="pathWidthVal" class="mono"></span>
      <span class="sep"></span>
      <button id="pathFill" class="chip" title="fill the shape as well as stroking it">fill</button>
      <input id="pathFillColour" class="mini swatch" type="color" value="#4a90c4">
    </div>

    <div class="pathHint" id="pathHint"></div>`;

  const q = s => host.querySelector(s);

  q('#pathClose').onclick = hide;
  q('#pathSmooth').onclick = () => set({ smooth: !opts.smooth });
  q('#pathClosed').onclick = () => set({ closed: !opts.closed });
  q('#pathSnap').onclick = () => {
    snapping = !snapping;
    q('#pathSnap').classList.toggle('on', snapping);
  };
  q('#pathColour').addEventListener('input', e => set({ color: e.target.value }));
  q('#pathWidth').addEventListener('input', e => set({ width: Number(e.target.value) }));
  q('#pathFill').onclick = () =>
    set({ fill: opts.fill ? null : q('#pathFillColour').value });
  q('#pathFillColour').addEventListener('input', e => {
    if (opts.fill) set({ fill: e.target.value });
  });

  bindSurface();
}

/* Every control lands here, so there is one path from "the user did something"
   to "the code now reads". */
function set(changes) {
  opts = { ...opts, ...changes };
  emit();
  draw();
}

/* Editing a raw('M...') at all turns it into the points it was sampled into —
   the same trade the curve editor makes with a named easing. You cannot drag
   an arc command, and pretending otherwise would rewrite it into something
   that is not what you had. */
const emit = () => onChange({ mode: 'path', points: points.map(p => p.slice()), opts: { ...opts } });

/* ------------------------------------------------------------------ input -- */
function bindSurface() {
  const svg = host.querySelector('#pathSvg');

  /* client pixels to STAGE coordinates — the numbers that are in the code */
  const at = (e, box) => ({
    x: clamp((e.clientX - box.left) / box.width * stage.w, -stage.w, stage.w * 2),
    y: clamp((e.clientY - box.top) / box.height * stage.h, -stage.h, stage.h * 2)
  });
  const fix = v => (snapping ? Math.round(v / SNAP) * SNAP : round(v));

  const move = (e, c) => {
    if (c.i == null) return;
    const p = at(e, c.box);
    points[c.i] = [fix(p.x), fix(p.y)];
    draw();
    emit();
  };

  draggable(svg, {
    start: e => {
      const box = svg.getBoundingClientRect();
      const p = at(e, box);
      /* a grab radius in SCREEN pixels, not stage units, so it feels the same
         whatever size the pane has been dragged to */
      const near = 13 * (stage.w / (box.width || 1));

      let i = null, best = Infinity;
      points.forEach((q, k) => {
        const d = Math.hypot(p.x - q[0], p.y - q[1]);
        if (d < best) { best = d; i = k; }
      });

      if (best > near) {                    /* far from every point: a new one */
        i = insertAt(p);
        points[i] = [fix(p.x), fix(p.y)];
      }
      dragging = true;
      const ctx = { box, i };
      move(e, ctx);
      return ctx;
    },
    move,
    end: () => { dragging = false; }
  });

  /* Right-click to remove, never double-click: a drag must preventDefault() on
     pointerdown to stop the browser starting a text selection, and that
     suppresses the click pair a dblclick is built from. */
  svg.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (points.length <= 2) return;
    const box = svg.getBoundingClientRect();
    const p = at(e, box);
    let i = -1, best = Infinity;
    points.forEach((q, k) => {
      const d = Math.hypot(p.x - q[0], p.y - q[1]);
      if (d < best) { best = d; i = k; }
    });
    if (best > 22 * (stage.w / (box.width || 1))) return;
    points.splice(i, 1);
    draw();
    emit();
  });
}

/* A new point belongs on the segment you clicked near, not on the end of the
   list — clicking the middle of a shape and having the line jump back across
   the frame to reach the new point is not what anybody meant by "add a point". */
function insertAt(p) {
  let best = Infinity, seg = points.length - 1;
  const last = opts.closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    const d = distToSeg(p, points[i], points[(i + 1) % points.length]);
    if (d < best) { best = d; seg = i; }
  }
  points.splice(seg + 1, 0, [round(p.x), round(p.y)]);
  return seg + 1;
}

function distToSeg(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const len = vx * vx + vy * vy;
  const u = len ? clamp(((p.x - a[0]) * vx + (p.y - a[1]) * vy) / len, 0, 1) : 0;
  return Math.hypot(p.x - (a[0] + u * vx), p.y - (a[1] + u * vy));
}

/* -------------------------------------------------------------- geometry --
   The same Catmull-Rom as scene.js's pathData, so what the panel draws IS what
   the frame draws. Two implementations of one shape drift, and the drift shows
   up as a shape that moves when you stop dragging it. */
function shapeData(pts, smooth, closed) {
  if (!pts || pts.length < 2) return '';
  const p = pts.map(q => ({ x: q[0], y: q[1] }));
  if (!smooth) {
    return 'M' + p.map(q => q.x + ' ' + q.y).join(' L ') + (closed ? ' Z' : '');
  }
  const wrap = i => (closed ? p[(i + p.length) % p.length]
                            : p[clamp(i, 0, p.length - 1)]);
  let d = 'M' + p[0].x + ' ' + p[0].y;
  const last = closed ? p.length : p.length - 1;
  for (let i = 0; i < last; i++) {
    const p0 = wrap(i - 1), p1 = wrap(i), p2 = wrap(i + 1), p3 = wrap(i + 2);
    d += ' C ' + (p1.x + (p2.x - p0.x) / 6) + ' ' + (p1.y + (p2.y - p0.y) / 6)
       + ', ' + (p2.x - (p3.x - p1.x) / 6) + ' ' + (p2.y - (p3.y - p1.y) / 6)
       + ', ' + p2.x + ' ' + p2.y;
  }
  return d + (closed ? ' Z' : '');
}

/* Path data the panel cannot express as points is measured rather than parsed:
   the browser already knows where every command in it goes, and asking it is
   the only reading that agrees with what gets drawn. */
function sampleD(d) {
  const probe = host.querySelector('#pathProbe');
  try {
    probe.setAttribute('d', d);
    const len = probe.getTotalLength();
    if (!len) return [];
    const n = clamp(Math.round(len / 140), 2, 16);
    const out = [];
    for (let i = 0; i <= n; i++) {
      const q = probe.getPointAtLength((i / n) * len);
      out.push([round(q.x), round(q.y)]);
    }
    return out;
  } catch { return []; }
  finally { probe.removeAttribute('d'); }
}

/* ------------------------------------------------------------------- draw -- */
function draw() {
  if (!host) return;
  const svg = host.querySelector('#pathSvg');
  svg.setAttribute('viewBox', `0 0 ${stage.w} ${stage.h}`);

  /* one screen pixel, in stage units — dots and rules are sized in what the
     eye sees, the stroke in what the frame will actually draw */
  const box = svg.getBoundingClientRect();
  const k = stage.w / (box.width || 420);

  if (gridKey !== `${stage.w}x${stage.h}`) {
    gridKey = `${stage.w}x${stage.h}`;
    host.querySelector('#pathGrid').innerHTML = grid();
  }

  const width = opts.width == null ? DEFAULT_WIDTH : opts.width;
  const shape = host.querySelector('#pathShape');
  shape.setAttribute('d', shapeData(points, opts.smooth, opts.closed));
  shape.setAttribute('stroke', opts.color || DEFAULT_COLOR);
  shape.setAttribute('stroke-width', width);
  shape.setAttribute('fill', opts.fill || 'none');

  host.querySelector('#pathDots').innerHTML = points.map((p, i) =>
    `<circle class="pathDot${i === 0 ? ' first' : ''}" cx="${p[0]}" cy="${p[1]}"`
    + ` r="${(6 * k).toFixed(1)}" stroke-width="${(2 * k).toFixed(1)}"/>`).join('');

  host.querySelector('#pathMode').textContent = mode === 'raw' ? 'shape · path data' : 'shape';
  host.querySelector('#pathNums').textContent =
    `${points.length} points` + (points.length ? ` · ${points[0][0]}, ${points[0][1]}` : '');
  host.querySelector('#pathHint').textContent = mode === 'raw'
    ? 'svg path data, sampled — drag anything and it becomes path() points you can keep editing'
    : 'drag a point · click empty space to add one · right-click one to remove it';

  host.querySelector('#pathSmooth').classList.toggle('on', !!opts.smooth);
  host.querySelector('#pathClosed').classList.toggle('on', !!opts.closed);
  host.querySelector('#pathSnap').classList.toggle('on', snapping);
  host.querySelector('#pathFill').classList.toggle('on', !!opts.fill);
  host.querySelector('#pathFillColour').classList.toggle('hidden', !opts.fill);
  host.querySelector('#pathColour').value = opts.color || DEFAULT_COLOR;
  host.querySelector('#pathWidth').value = String(width);
  host.querySelector('#pathWidthVal').textContent = width + 'px';
}

/* Thirds and a centre cross — where you place things by eye — plus the frame
   itself, so a point outside it reads as outside it. */
function grid() {
  const { w, h } = stage;
  const line = (x1, y1, x2, y2, cls) =>
    `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  let g = `<rect class="pathFrame" x="0" y="0" width="${w}" height="${h}"/>`;
  for (const u of [1 / 3, 2 / 3]) {
    g += line(w * u, 0, w * u, h, 'pathThird');
    g += line(0, h * u, w, h * u, 'pathThird');
  }
  g += line(w / 2 - w * 0.02, h / 2, w / 2 + w * 0.02, h / 2, 'pathCentre');
  g += line(w / 2, h / 2 - h * 0.035, w / 2, h / 2 + h * 0.035, 'pathCentre');
  return g;
}

/* -------------------------------------------------------------- show/hide -- */
export function show(spec) {
  if (!host) return;
  if (spec.stage && spec.stage.w && spec.stage.h) stage = { w: spec.stage.w, h: spec.stage.h };
  opts = {
    smooth: !!(spec.opts && spec.opts.smooth),
    closed: !!(spec.opts && spec.opts.closed),
    color: (spec.opts && spec.opts.color) || null,
    width: spec.opts && spec.opts.width != null ? spec.opts.width : null,
    fill: (spec.opts && spec.opts.fill) || null
  };
  mode = spec.kind === 'raw' ? 'raw' : 'path';
  host.classList.remove('hidden');
  /* un-hidden first: a path with no box has no length to sample along */
  points = mode === 'raw' ? sampleD(spec.d || '')
                          : (spec.points || []).map(p => [round(p[0]), round(p[1])]);
  draw();
}

export function hide() { if (host) host.classList.add('hidden'); }
