/* ============================================================================
   THE CURVE EDITOR.

   An easing is a shape, and a shape is a mouse job. Put the cursor inside a
   bezier(...) call and this opens on it: drag the two handles, watch the
   picture change, and the four numbers in your code are rewritten as you drag.
   No second website, no copying numbers back.

   It edits the code rather than storing anything of its own — the file stays
   the only source of truth, and what it wrote is right there to keep editing.
   ========================================================================== */
import { draggable } from './drag.js';

const W = 168, H = 168, PAD = 22;          /* drawing box, with room to overshoot */
let host = null, onChange = () => {};
let dragging = false;

/* While a drag is running the code is being rewritten under the cursor, so
   whoever is watching the cursor must not re-derive the edit range from the
   text — it would race the write and truncate it. */
export const isDragging = () => dragging;
let pts = [0.34, 1.56, 0.64, 1];

/* the curve box maps 0..1 to the inner square, and allows y outside 0..1 so an
   overshoot is visible rather than clipped */
const YMIN = -0.6, YMAX = 1.9;
const px = u => PAD + u * (W - PAD * 2);
const py = v => H - PAD - ((v - YMIN) / (YMAX - YMIN)) * (H - PAD * 2);
const ux = x => (x - PAD) / (W - PAD * 2);
const uy = y => YMIN + ((H - PAD - y) / (H - PAD * 2)) * (YMAX - YMIN);
const round2 = n => Math.round(n * 100) / 100;

export function init(handlers = {}) {
  onChange = handlers.onChange || onChange;
  host = document.querySelector('#curve');
  if (!host) return;
  host.innerHTML = `
    <div class="curveHead"><span>easing</span>
      <span id="curveNums" class="mono"></span>
      <span class="grow"></span>
      <span id="curvePresets"></span>
      <button id="curveClose" class="btn mini">close</button></div>
    <svg id="curveSvg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <rect x="${PAD}" y="${py(1)}" width="${W - PAD * 2}" height="${py(0) - py(1)}"
            fill="none" stroke="#2f2f2f"/>
      <text x="${PAD - 5}" y="${py(1) + 4}" class="curveTick" text-anchor="end">1</text>
      <text x="${PAD - 5}" y="${py(0) + 4}" class="curveTick" text-anchor="end">0</text>
      <line id="h1" stroke="#5a5a5a"/><line id="h2" stroke="#5a5a5a"/>
      <path id="curvePath" fill="none" stroke="#e8912d" stroke-width="2"/>
      <circle id="p1" r="7" fill="#e8912d"/><circle id="p2" r="7" fill="#4a90c4"/>
    </svg>
    <div class="curveHint">drag anywhere &mdash; above the box overshoots</div>`;

  host.querySelector('#curvePresets').innerHTML = Object.keys(NAMED)
    .map(n => `<button class="chip" data-c="${n}">${n}</button>`).join('');
  host.querySelectorAll('.chip').forEach(b => {
    b.onclick = () => { pts = NAMED[b.dataset.c].slice(); draw(); onChange(pts.slice()); };
  });

  /* The dots are small targets. Pressing anywhere in the box grabs whichever
     handle is nearer and drags it — you aim at the shape, not at a 7px dot. */
  bindSurface();
  host.querySelector('#curveClose').onclick = () => hide();
  draw();
}

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

function bindSurface() {
  const svg = host.querySelector('#curveSvg');
  const at = (e, box) => ({
    x: (e.clientX - box.left) / box.width * W,
    y: (e.clientY - box.top) / box.height * H
  });
  const move = (e, c) => {
    const q = at(e, c.box);
    pts[c.i]     = round2(Math.max(0, Math.min(1, ux(q.x))));
    pts[c.i + 1] = round2(Math.max(YMIN, Math.min(YMAX, uy(q.y))));
    draw();
    onChange(pts.slice());
  };
  draggable(svg, {
    start: e => {
      const box = svg.getBoundingClientRect();
      const q = at(e, box);
      const d1 = Math.hypot(q.x - px(pts[0]), q.y - py(pts[1]));
      const d2 = Math.hypot(q.x - px(pts[2]), q.y - py(pts[3]));
      const ctx = { box: box, i: d1 <= d2 ? 0 : 2 };
      dragging = true;
      move(e, ctx);
      return ctx;
    },
    move: move,
    end: () => { dragging = false; }
  });
}

function draw() {
  if (!host) return;
  const [x1, y1, x2, y2] = pts;
  const q = (a, b) => `${px(a)},${py(b)}`;
  host.querySelector('#curvePath').setAttribute('d',
    `M ${q(0, 0)} C ${q(x1, y1)} ${q(x2, y2)} ${q(1, 1)}`);
  set('#h1', px(0), py(0), px(x1), py(y1));
  set('#h2', px(1), py(1), px(x2), py(y2));
  place('#p1', px(x1), py(y1));
  place('#p2', px(x2), py(y2));
  host.querySelector('#curveNums').textContent = pts.join(', ');
}
function set(sel, a, b, c, d) {
  const e = host.querySelector(sel);
  e.setAttribute('x1', a); e.setAttribute('y1', b);
  e.setAttribute('x2', c); e.setAttribute('y2', d);
}
function place(sel, x, y) {
  const e = host.querySelector(sel);
  e.setAttribute('cx', x); e.setAttribute('cy', y);
}

export function show(values) {
  if (!host) return;
  if (values && values.length === 4) pts = values.map(Number);
  host.classList.remove('hidden');
  draw();
}
export function hide() { if (host) host.classList.add('hidden'); }
export const isOpen = () => host && !host.classList.contains('hidden');
