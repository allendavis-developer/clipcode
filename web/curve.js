/* ============================================================================
   THE CURVE EDITOR.

   An easing is a shape, and a shape is a mouse job. Put the cursor inside a
   bezier(...) or curve([...]) — or on a named easing — and this opens on it.
   Drag, and the numbers in your code are rewritten as you drag.

   Laid out the way cubic-bezier.com is, because that layout is right and the
   reasons are worth stating:

     TALL, not wide.   All the information in an easing is vertical — how far
                       along the value is at each moment. A short wide box
                       throws that resolution away.
     A LINEAR GHOST.   The grey diagonal is what no easing at all looks like.
                       You read a curve by how far it departs from that, so
                       the thing you compare against belongs on the screen.
     BANDED GRID.      So you can see 0.25, 0.5, 0.75 without a ruler.
     PRESETS YOU SEE.  A picture of a curve says what "settle" means; the word
                       does not.
     A MOVING DOT.     The only true test of an easing is watching something
                       move, so something moves.

   Two modes, because there are two honest ways to describe a curve:

     bezier   exactly two control handles — that is what a cubic bezier IS
     curve    as many points as you like, which the shape passes THROUGH.
              Click empty space to add one, right-click one to remove it.

   It edits the code and stores nothing of its own: the file stays the only
   source of truth, and what it wrote is right there to keep editing.
   ========================================================================== */
import { draggable } from './drag.js';

/* graph coordinates. Portrait on purpose — see the note above. */
const W = 300, H = 360, PADX = 34, PADY = 64;
const YMIN = -0.55, YMAX = 1.75;         /* room to overshoot and to wind up */

let host = null, onChange = () => {};
let mode = 'bezier';
let pts = [0.34, 1.56, 0.64, 1];
let pointList = [[0, 0], [0.4, 1.15], [0.7, 0.94], [1, 1]];
let dragging = false;
let previewRAF = null;

/* The preview runs at the length of the change it is attached to when we can
   tell — watching a 340ms move at 340ms is the actual question you are asking,
   and a generic one second is not. The slider overrides it. */
const DUR_KEY = 'studio.curvePreviewMs';
let previewMs = Number(localStorage.getItem(DUR_KEY) || 0) || 1000;
let previewOn = true;
let attachedMs = null;

export const isDragging = () => dragging;
export const getMode = () => mode;

const px = u => PADX + u * (W - PADX * 2);
const py = v => H - PADY - ((v - YMIN) / (YMAX - YMIN)) * (H - PADY * 2);
const ux = x => (x - PADX) / (W - PADX * 2);
const uy = y => YMIN + ((H - PADY - y) / (H - PADY * 2)) * (YMAX - YMIN);
const r2 = n => Math.round(n * 100) / 100;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const NAMED = {
  linear:    [0, 0, 1, 1],
  easeIn:    [0.55, 0.06, 0.68, 0.19],
  easeOut:   [0.22, 0.61, 0.36, 1],
  easeInOut: [0.65, 0, 0.35, 1],
  snap:      [0.16, 1, 0.3, 1],
  settle:    [0.22, 1, 0.36, 1],
  overshoot: [0.34, 1.56, 0.64, 1]
};

/* ------------------------------------------------------------------- build -- */
export function init(handlers = {}) {
  onChange = handlers.onChange || onChange;
  host = document.querySelector('#curve');
  if (!host) return;

  const bands = [0, 0.25, 0.5, 0.75, 1]
    .map(v => `<line class="curveBand" x1="${PADX}" y1="${py(v)}" x2="${W - PADX}" y2="${py(v)}"/>`)
    .join('');

  host.innerHTML = `
    <div class="curveHead">
      <span id="curveMode">easing</span>
      <span id="curveNums" class="mono"></span>
      <span class="grow"></span>
      <button id="curveToPoints" class="chip">+ points</button>
      <button id="curveClose" class="btn mini">close</button>
    </div>

    <div class="curveBody">
      <svg id="curveSvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${bands}
        <line class="curveGhost" x1="${px(0)}" y1="${py(0)}" x2="${px(1)}" y2="${py(1)}"/>
        <text class="curveTick" x="${PADX - 7}" y="${py(1) + 4}" text-anchor="end">1</text>
        <text class="curveTick" x="${PADX - 7}" y="${py(0) + 4}" text-anchor="end">0</text>
        <text class="curveAxis" x="${W / 2}" y="${H - 12}" text-anchor="middle">TIME</text>
        <text class="curveAxis" x="12" y="${H / 2}" text-anchor="middle"
              transform="rotate(-90 12 ${H / 2})">VALUE</text>
        <g id="curveHandles"></g>
        <path id="curvePath" class="curveLine"/>
        <circle class="curveEnd" cx="${px(0)}" cy="${py(0)}" r="5"/>
        <circle class="curveEnd" cx="${px(1)}" cy="${py(1)}" r="5"/>
        <g id="curveDots"></g>
      </svg>

      <div class="curveSide">
        <div class="curvePrev">
          <div class="curveRow">
            <span class="curveLabel">preview</span>
            <button id="curvePlay" class="chip">pause</button>
            <input id="curveDur" type="range" min="100" max="3000" step="50">
            <span id="curveDurVal" class="mono"></span>
            <button id="curveMatch" class="chip" title="match the change this easing is on">match</button>
          </div>
          <div class="curveTrack"><div id="curveBall"></div></div>
        </div>
        <div class="curveLabel">library</div>
        <div id="curveLib" class="curveLib"></div>
      </div>
    </div>

    <div class="curveHint" id="curveHint"></div>`;

  host.querySelector('#curveLib').innerHTML = Object.entries(NAMED)
    .map(([name, v]) => `
      <button class="libItem" data-c="${name}" title="${name}">
        <svg viewBox="0 0 60 60"><path d="${thumb(v)}"/></svg>
        <span>${name}</span>
      </button>`).join('');
  host.querySelectorAll('.libItem').forEach(b => {
    b.onclick = () => {
      mode = 'bezier';
      pts = NAMED[b.dataset.c].slice();
      draw();
      onChange(payload());
    };
  });

  host.querySelector('#curveToPoints').onclick = toPoints;
  host.querySelector('#curveClose').onclick = hide;

  const dur = host.querySelector('#curveDur');
  dur.value = String(previewMs);
  dur.addEventListener('input', () => {
    previewMs = Number(dur.value);
    try { localStorage.setItem(DUR_KEY, String(previewMs)); } catch {}
    showDur();
  });
  host.querySelector('#curvePlay').onclick = () => {
    previewOn = !previewOn;
    host.querySelector('#curvePlay').textContent = previewOn ? 'pause' : 'play';
  };
  host.querySelector('#curveMatch').onclick = () => {
    if (!attachedMs) return;
    previewMs = Math.max(100, Math.min(3000, attachedMs));
    dur.value = String(previewMs);
    showDur();
  };
  showDur();
  bindSurface();
  draw();
  startPreview();
}

/* a 60x60 sketch of a curve, for the library buttons */
function thumb(v) {
  const X = u => 6 + u * 48, Y = w => 54 - w * 48;
  return `M ${X(0)} ${Y(0)} C ${X(v[0])} ${Y(v[1])} ${X(v[2])} ${Y(v[3])} ${X(1)} ${Y(1)}`;
}

/* ------------------------------------------------------------------ modes -- */
function toPoints() {
  if (mode === 'curve') return;
  const f = sampleBezier();
  pointList = [0, 0.25, 0.5, 0.75, 1].map(x => [x, r2(f(x))]);
  mode = 'curve';
  draw();
  onChange(payload());
}

function sampleBezier() {
  const [x1, y1, x2, y2] = pts;
  const A = (a, b) => 1 - 3 * b + 3 * a, B = (a, b) => 3 * b - 6 * a, C = a => 3 * a;
  const calc = (u, a, b) => ((A(a, b) * u + B(a, b)) * u + C(a)) * u;
  const slope = (u, a, b) => 3 * A(a, b) * u * u + 2 * B(a, b) * u + C(a);
  return t => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const d = slope(u, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      u -= (calc(u, x1, x2) - t) / d;
    }
    return calc(u, y1, y2);
  };
}

/* the same Catmull-Rom the runtime uses, so the drawing IS the motion */
function samplePoints() {
  const p = pointList;
  const m = p.map((_, i) => {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    return b[0] === a[0] ? 0 : (b[1] - a[1]) / (b[0] - a[0]);
  });
  return t => {
    if (t <= 0) return p[0][1];
    if (t >= 1) return p[p.length - 1][1];
    let i = 0;
    while (i < p.length - 2 && t > p[i + 1][0]) i++;
    const h = p[i + 1][0] - p[i][0];
    if (h <= 0) return p[i + 1][1];
    const u = (t - p[i][0]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p[i][1] + (u3 - 2 * u2 + u) * h * m[i]
         + (-2 * u3 + 3 * u2) * p[i + 1][1] + (u3 - u2) * h * m[i + 1];
  };
}
const sampler = () => (mode === 'bezier' ? sampleBezier() : samplePoints());

const payload = () => (mode === 'bezier'
  ? { mode, values: pts.slice() }
  : { mode, points: pointList.map(p => [r2(p[0]), r2(p[1])]) });

/* ------------------------------------------------------------------ input -- */
function bindSurface() {
  const svg = host.querySelector('#curveSvg');
  const at = (e, box) => ({
    x: (e.clientX - box.left) / box.width * W,
    y: (e.clientY - box.top) / box.height * H
  });

  const move = (e, c) => {
    if (c.i == null) return;
    const q = at(e, c.box);
    if (mode === 'bezier') {
      pts[c.i]     = r2(clamp(ux(q.x), 0, 1));
      pts[c.i + 1] = r2(clamp(uy(q.y), YMIN, YMAX));
    } else {
      /* the ends stay at the ends — an easing that does not start at the
         start is not an easing, it is a mystery */
      const first = c.i === 0, last = c.i === pointList.length - 1;
      const x = first ? 0 : last ? 1 : clamp(ux(q.x), 0.02, 0.98);
      pointList[c.i] = [r2(x), r2(clamp(uy(q.y), YMIN, YMAX))];
    }
    draw();
    onChange(payload());
  };

  draggable(svg, {
    start: e => {
      const box = svg.getBoundingClientRect();
      const q = at(e, box);
      let i = null, best = Infinity;
      const cands = mode === 'bezier'
        ? [[px(pts[0]), py(pts[1]), 0], [px(pts[2]), py(pts[3]), 2]]
        : pointList.map((p, k) => [px(p[0]), py(p[1]), k]);
      for (const [cx, cy, k] of cands) {
        const d = Math.hypot(q.x - cx, q.y - cy);
        if (d < best) { best = d; i = k; }
      }
      if (mode === 'curve' && best > 22) {          /* far from all: a new point */
        const nx = r2(clamp(ux(q.x), 0.02, 0.98));
        const ny = r2(clamp(uy(q.y), YMIN, YMAX));
        pointList.push([nx, ny]);
        pointList.sort((a, b) => a[0] - b[0]);
        i = pointList.findIndex(p => p[0] === nx && p[1] === ny);
      }
      dragging = true;
      const ctx = { box, i };
      move(e, ctx);
      return ctx;
    },
    move,
    end: () => {
      dragging = false;
      if (mode === 'curve') { pointList.sort((a, b) => a[0] - b[0]); draw(); }
    }
  });

  /* Right-click a point to remove it — never the two ends. Not double-click:
     a drag must preventDefault() on pointerdown to stop the browser starting a
     text selection, and that suppresses the click pair a dblclick is built
     from, so the gesture would simply never arrive. */
  svg.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (mode !== 'curve' || pointList.length <= 2) return;
    const box = svg.getBoundingClientRect();
    const q = at(e, box);
    let i = -1, best = Infinity;
    pointList.forEach((p, k) => {
      const d = Math.hypot(q.x - px(p[0]), q.y - py(p[1]));
      if (d < best) { best = d; i = k; }
    });
    if (best > 26 || i <= 0 || i >= pointList.length - 1) return;
    pointList.splice(i, 1);
    draw();
    onChange(payload());
  });
}

/* ------------------------------------------------------------------- draw -- */
function draw() {
  if (!host) return;
  const dots = host.querySelector('#curveDots');
  const handles = host.querySelector('#curveHandles');
  host.querySelector('#curveMode').textContent = mode === 'bezier' ? 'easing' : 'easing · points';
  host.querySelector('#curveToPoints').classList.toggle('hidden', mode === 'curve');
  host.querySelector('#curveHint').textContent = mode === 'bezier'
    ? 'drag a handle · grey line is no easing at all · "+ points" for more control'
    : 'drag a point · click empty space to add one · right-click one to remove it';

  if (mode === 'bezier') {
    const [x1, y1, x2, y2] = pts;
    host.querySelector('#curvePath').setAttribute('d',
      `M ${px(0)},${py(0)} C ${px(x1)},${py(y1)} ${px(x2)},${py(y2)} ${px(1)},${py(1)}`);
    handles.innerHTML =
      `<line class="curveHandle" x1="${px(0)}" y1="${py(0)}" x2="${px(x1)}" y2="${py(y1)}"/>`
    + `<line class="curveHandle" x1="${px(1)}" y1="${py(1)}" x2="${px(x2)}" y2="${py(y2)}"/>`;
    dots.innerHTML =
      `<circle class="curveDot a" cx="${px(x1)}" cy="${py(y1)}" r="10"/>`
    + `<circle class="curveDot b" cx="${px(x2)}" cy="${py(y2)}" r="10"/>`;
    host.querySelector('#curveNums').textContent = pts.join(', ');
  } else {
    host.querySelector('#curvePath').setAttribute('d', splinePath(pointList));
    handles.innerHTML = '';
    dots.innerHTML = pointList.map(p =>
      `<circle class="curveDot a" cx="${px(p[0])}" cy="${py(p[1])}" r="9"/>`).join('');
    host.querySelector('#curveNums').textContent = `${pointList.length} points`;
  }
}

function splinePath(p) {
  if (p.length < 2) return '';
  const m = p.map((_, i) => {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    return b[0] === a[0] ? 0 : (b[1] - a[1]) / (b[0] - a[0]);
  });
  let d = `M ${px(p[0][0])},${py(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const h = p[i + 1][0] - p[i][0];
    d += ` C ${px(p[i][0] + h / 3)},${py(p[i][1] + m[i] * h / 3)}`
      +  ` ${px(p[i + 1][0] - h / 3)},${py(p[i + 1][1] - m[i + 1] * h / 3)}`
      +  ` ${px(p[i + 1][0])},${py(p[i + 1][1])}`;
  }
  return d;
}

/* ---------------------------------------------------------------- preview --
   The only honest test of an easing is watching something move with it, so a
   dot runs the curve on a loop, with a beat of stillness at each end. */
function showDur() {
  const el = host && host.querySelector('#curveDurVal');
  if (!el) return;
  el.textContent = (previewMs / 1000).toFixed(2) + 's'
    + (attachedMs ? '' : '');
  const match = host.querySelector('#curveMatch');
  if (match) {
    match.classList.toggle('hidden', !attachedMs);
    match.textContent = attachedMs ? `match ${attachedMs}ms` : 'match';
  }
}

/* One clock, its own, so pausing the preview does not pause anything else. */
function startPreview() {
  const ball = host.querySelector('#curveBall');
  if (!ball) return;
  const REST = 420;
  let elapsed = 0, last = 0;
  const step = now => {
    const dt = last ? now - last : 0;
    last = now;
    if (isOpen() && previewOn) {
      elapsed = (elapsed + dt) % (previewMs + REST);
      const u = elapsed >= previewMs ? 1 : sampler()(elapsed / previewMs);
      /* travel the track's width MINUS the ball, so it sits inside at both
         ends; overshoot past 1 is allowed to poke out, which is the point */
      ball.style.left = 'calc(' + (u * 100) + '% - ' + (u * 16) + 'px)';
    }
    previewRAF = requestAnimationFrame(step);
  };
  if (!previewRAF) previewRAF = requestAnimationFrame(step);
}

/* -------------------------------------------------------------- show/hide -- */
export function show(spec) {
  if (!host) return;
  if (spec && spec.points) { mode = 'curve'; pointList = spec.points.map(p => p.slice()); }
  else if (spec && spec.values) { mode = 'bezier'; pts = spec.values.slice(); }
  if (spec && spec.ms !== undefined) attachedMs = spec.ms;
  host.classList.remove('hidden');
  draw();
  showDur();
}
export function hide() { if (host) host.classList.add('hidden'); }
export const isOpen = () => host && !host.classList.contains('hidden');
