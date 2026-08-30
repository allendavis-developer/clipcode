/* ============================================================================
   THE CURVE EDITOR.

   An easing is a shape, and a shape is a mouse job. Put the cursor inside a
   bezier(...) or curve([...]) and this opens on it: drag, watch the picture
   change, and the numbers in your code are rewritten as you drag.

   Two modes, because there are two honest ways to describe a curve:

     bezier   exactly two control handles — that is what a cubic bezier IS,
              and what CSS and every design tool means by an easing curve
     curve    as many points as you like, which the shape passes THROUGH.
              Click empty space to add one, double-click a point to remove it.

   It edits the code rather than storing anything of its own: the file stays
   the only source of truth, and what it wrote is right there to keep editing.
   ========================================================================== */
import { draggable } from './drag.js';

/* The drawing box in its own coordinates — it scales to whatever width the
   pane has, so only this aspect is fixed. */
const W = 520, H = 300, PADX = 46, PADY = 54;
const YMIN = -0.75, YMAX = 2.0;          /* room to overshoot, visibly */

let host = null, onChange = () => {};
let mode = 'bezier';                     /* 'bezier' | 'curve' */
let pts = [0.34, 1.56, 0.64, 1];         /* bezier: x1, y1, x2, y2 */
let pointList = [[0, 0], [0.4, 1.15], [0.7, 0.94], [1, 1]];
let dragging = false;

export const isDragging = () => dragging;
export const getMode = () => mode;

const px = u => PADX + u * (W - PADX * 2);
const py = v => H - PADY - ((v - YMIN) / (YMAX - YMIN)) * (H - PADY * 2);
const ux = x => (x - PADX) / (W - PADX * 2);
const uy = y => YMIN + ((H - PADY - y) / (H - PADY * 2)) * (YMAX - YMIN);
const r2 = n => Math.round(n * 100) / 100;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* The curves a person actually reaches for, one click each. */
export const NAMED = {
  linear:    [0, 0, 1, 1],
  easeIn:    [0.55, 0.06, 0.68, 0.19],
  easeOut:   [0.22, 0.61, 0.36, 1],
  easeInOut: [0.65, 0, 0.35, 1],
  snap:      [0.16, 1, 0.3, 1],
  settle:    [0.22, 1, 0.36, 1],
  overshoot: [0.34, 1.56, 0.64, 1]
};

export function init(handlers = {}) {
  onChange = handlers.onChange || onChange;
  host = document.querySelector('#curve');
  if (!host) return;
  host.innerHTML = `
    <div class="curveHead">
      <span id="curveMode">easing</span>
      <span id="curveNums" class="mono"></span>
      <span class="grow"></span>
      <span id="curvePresets"></span>
      <button id="curveToPoints" class="chip">+ points</button>
      <button id="curveClose" class="btn mini">close</button>
    </div>
    <svg id="curveSvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <rect class="curveBox" x="${PADX}" y="${py(1)}"
            width="${W - PADX * 2}" height="${py(0) - py(1)}"/>
      <text class="curveTick" x="${PADX - 8}" y="${py(1) + 4}" text-anchor="end">1</text>
      <text class="curveTick" x="${PADX - 8}" y="${py(0) + 4}" text-anchor="end">0</text>
      <text class="curveTick" x="${PADX}" y="${H - 16}" text-anchor="middle">start</text>
      <text class="curveTick" x="${W - PADX}" y="${H - 16}" text-anchor="middle">end</text>
      <g id="curveHandles"></g>
      <path id="curvePath" class="curveLine"/>
      <g id="curveDots"></g>
    </svg>
    <div class="curveHint" id="curveHint"></div>`;

  host.querySelector('#curvePresets').innerHTML = Object.keys(NAMED)
    .map(n => `<button class="chip" data-c="${n}">${n}</button>`).join('');
  host.querySelectorAll('#curvePresets .chip').forEach(b => {
    b.onclick = () => {
      mode = 'bezier';
      pts = NAMED[b.dataset.c].slice();
      draw();
      onChange(payload());
    };
  });
  host.querySelector('#curveToPoints').onclick = toPoints;
  host.querySelector('#curveClose').onclick = hide;
  bindSurface();
  draw();
}

/* bezier -> a point curve, sampled off the shape you already have, so
   switching keeps the motion you were just looking at. */
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

const payload = () => (mode === 'bezier'
  ? { mode, values: pts.slice() }
  : { mode, points: pointList.map(p => [r2(p[0]), r2(p[1])]) });

/* ------------------------------------------------------------------- input -- */
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
      /* the ends stay at the ends — a curve that does not start at the start
         is not an easing, it is a mystery */
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
      /* far from every point, in point mode: that is a new point */
      if (mode === 'curve' && best > 26) {
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

  /* Right-click a point to remove it — never the two ends.

     Not double-click: a drag has to preventDefault() on pointerdown to stop
     the browser starting a text selection, and that suppresses the click pair
     a dblclick is built from. The gesture would simply never arrive. */
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
    if (best > 30 || i <= 0 || i >= pointList.length - 1) return;
    pointList.splice(i, 1);
    draw();
    onChange(payload());
  });
}

/* -------------------------------------------------------------------- draw -- */
function draw() {
  if (!host) return;
  const dots = host.querySelector('#curveDots');
  const handles = host.querySelector('#curveHandles');
  host.querySelector('#curveMode').textContent = mode === 'bezier' ? 'easing' : 'easing · points';
  host.querySelector('#curveToPoints').classList.toggle('hidden', mode === 'curve');
  host.querySelector('#curveHint').textContent = mode === 'bezier'
    ? 'drag a handle · above the box overshoots · "+ points" for more control'
    : 'drag a point · click empty space to add one · right-click one to remove it';

  if (mode === 'bezier') {
    const [x1, y1, x2, y2] = pts;
    host.querySelector('#curvePath').setAttribute('d',
      `M ${px(0)},${py(0)} C ${px(x1)},${py(y1)} ${px(x2)},${py(y2)} ${px(1)},${py(1)}`);
    handles.innerHTML =
      `<line class="curveHandle" x1="${px(0)}" y1="${py(0)}" x2="${px(x1)}" y2="${py(y1)}"/>`
    + `<line class="curveHandle" x1="${px(1)}" y1="${py(1)}" x2="${px(x2)}" y2="${py(y2)}"/>`;
    dots.innerHTML =
      `<circle class="curveDot a" cx="${px(x1)}" cy="${py(y1)}" r="9"/>`
    + `<circle class="curveDot b" cx="${px(x2)}" cy="${py(y2)}" r="9"/>`;
    host.querySelector('#curveNums').textContent = pts.join(', ');
  } else {
    host.querySelector('#curvePath').setAttribute('d', splinePath(pointList));
    handles.innerHTML = '';
    dots.innerHTML = pointList.map(p =>
      `<circle class="curveDot a" cx="${px(p[0])}" cy="${py(p[1])}" r="8"/>`).join('');
    host.querySelector('#curveNums').textContent = `${pointList.length} points`;
  }
}

/* the same Catmull-Rom the runtime uses, so the drawing IS the motion */
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

/* --------------------------------------------------------------- show/hide -- */
export function show(spec) {
  if (!host) return;
  if (spec && spec.points) { mode = 'curve'; pointList = spec.points.map(p => p.slice()); }
  else if (spec && spec.values) { mode = 'bezier'; pts = spec.values.slice(); }
  host.classList.remove('hidden');
  draw();
}
export function hide() { if (host) host.classList.add('hidden'); }
export const isOpen = () => host && !host.classList.contains('hidden');
