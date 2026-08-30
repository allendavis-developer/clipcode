/* ============================================================================
   TRANSITIONS — what a cut looks like when a cut is not enough.

   THE MODEL, and why.

   A transition is a property of a clip's HEAD: `clip.trans = {kind, ms, dir}`,
   meaning "this is how I come in". The clip before it on the same track, the
   one whose end is exactly this clip's start, is the other half.

   Head, rather than a free-standing object sitting on the boundary, because a
   boundary is not a thing you can hold: move either clip and it stops
   existing. A head travels with the clip that owns it, a copy of the clip
   copies it, and deleting the clip deletes it. Nothing can be left dangling.
   Store it on the outgoing clip's TAIL instead and dragging the incoming clip
   away leaves a transition pointing at nothing.

   It also gives the no-partner case for free: a head transition on the first
   clip of a track is a fade up from black, which is the same operation with
   one side missing rather than a second feature.

   THE WINDOW IS AFTER THE CUT, and the outgoing clip overruns into it.

   The two clips do NOT overlap on the timeline. The cut stays exactly where
   you put it, nothing ripples, duration() is unchanged, and "next edit" still
   lands on the cut. What happens instead is that for `ms` after the cut the
   outgoing clip keeps painting — asked for a time past its own out point —
   underneath the incoming one, which is playing from its in point normally.

   The alternative, centring the window on the cut, would need the INCOMING
   clip to paint before its in point. That is a lie about your trim: the in
   point is the frame you chose as the first frame, and showing what came
   before it is showing material you rejected. Overrunning the outgoing clip
   is the honest direction, and it is what a handle is for.

   And a code clip never runs out of handle. Every animated number here is a
   track, and a track holds its last value outside its range, so a code clip
   asked for a time past its end returns its final pose rather than nothing.
   That property is what makes the overrun free.

   PURITY. Everything below is a function of the timeline position and the
   stored numbers. `u` is (t - cut) / ms and nothing else: at time X the
   composite is fully determined, so scrubbing backwards, scrubbing forwards
   and a cold render all agree. There is no elapsed-time fade anywhere in this
   file and there must never be one.
   ========================================================================== */
import { S, qFrame, qTime, clipEnd } from './state.js';

export const KINDS = ['dissolve', 'dip', 'push', 'whip'];
export const DIRS = ['l', 'r', 'u', 'd'];
export const ARROW = { l: '←', r: '→', u: '↑', d: '↓' };

const snap = ms => qTime(qFrame(ms));
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
/* the S a slide wants: it leaves and arrives without a corner on it */
const smooth = u => u * u * (3 - 2 * u);

/* A dissolve is a length of TIME — a third of a second reads as a third of a
   second at any frame rate. A whip is a length in FRAMES: the whole effect is
   that it is over in two of them, and two frames at 60fps is not four. So the
   two are declared in the units they actually mean. */
const MS = { dissolve: 320, dip: 420, push: 420 };
export const defaultMs = kind =>
  Math.max(qTime(1), snap(kind === 'whip' ? qTime(2) : MS[kind] || 320));

/* Anything read off disk has been through a text editor at some point. One
   place decides what a transition is allowed to be, and it is this one — which
   is also why lib/project.mjs stores the field without knowing what is in it. */
export function normalize(tx) {
  if (!tx || !KINDS.includes(tx.kind)) return null;
  const want = Number(tx.ms);
  const ms = Math.max(qTime(1), snap(want > 0 ? want : defaultMs(tx.kind)));
  return { kind: tx.kind, ms, dir: DIRS.includes(tx.dir) ? tx.dir : 'l' };
}

const len = c => c.out - c.in;
/* Sound has no picture to dissolve and no gain control here to fade, so a
   transition on an audio clip would be a thing you can draw and not hear. */
const visual = c => c && c.kind !== 'audio';

/* The clip this one comes in from: same track, ending where this one starts.
   Half a frame of tolerance because a boundary is snapped to a frame and a
   frame boundary is not a round number of milliseconds. */
export function partnerOf(clips, b) {
  if (!visual(b)) return null;
  for (const a of clips)
    if (a.id !== b.id && a._track === b._track && visual(a)
        && Math.abs(clipEnd(a) - b.start) <= qTime(0.5)) return a;
  return null;
}

/* Every transition open at t. Length is clamped to what the two clips can
   actually give, so a hand-edited project.json cannot make a clip paint past
   the end of its own span. */
export function activeAt(clips, t) {
  const open = [];
  for (const b of clips) {
    const tx = normalize(b.trans);
    if (!tx || !visual(b)) continue;
    const a = partnerOf(clips, b);
    const ms = Math.min(tx.ms, len(b), a ? len(a) : tx.ms);
    if (ms < qTime(1) || t < b.start || t >= b.start + ms) continue;
    open.push({ a, b, tx: { ...tx, ms }, u: (t - b.start) / ms });
  }
  return open;
}

/* -------------------------------------------------------------- the looks --
   Each returns what the two layers look like at u: an opacity, a transform,
   and a directional smear. The layers are stacked with the incoming one on
   top, which is why the numbers are not symmetric — see dissolve. */
export function stylesAt(tx, u) {
  const n = Math.max(1, Math.round(tx.ms / qTime(1)));   /* frames in the window */
  const f = (tx.kind === 'whip' ? whip : tx.kind === 'push' ? push
           : tx.kind === 'dip' ? dip : dissolve);
  return f(clamp01(u), tx, n);
}

/* THE CROSSFADE THAT DOES NOT DIP.

   The layers are alpha-composited, incoming over outgoing, so the incoming's
   own opacity already removes exactly as much of the outgoing as it adds of
   itself: hold the outgoing at 1 and the result is u·B + (1−u)·A, a true
   linear crossfade. Fading BOTH — the obvious thing, and what every naive web
   crossfade does — double-counts and leaves (1−u)²·A in the middle, which is
   the 25% luminance dip you can see on any amateur dissolve.

   The outgoing is then taken to zero over the last quarter, when the incoming
   is already at 75% and hiding it anyway. That costs nothing visible and buys
   the case the maths above ignores: a code clip is often a key over black, and
   where the incoming paints nothing the outgoing would otherwise still be at
   full opacity one frame before it vanishes, and pop. */
function dissolve(u) {
  const tail = 0.75;
  return {
    going: { opacity: u < tail ? 1 : 1 - (u - tail) / (1 - tail) },
    coming: { opacity: u }
  };
}

/* Out to nothing, hold nothing, in from nothing. Black comes from the stage
   itself, so a dip on an upper track dips to whatever is under it — which is
   what a layer going away actually looks like, and the only answer that does
   not involve painting over tracks this transition was never about. */
function dip(u) {
  return {
    going: { opacity: clamp01(1 - u * 2.2) },
    coming: { opacity: clamp01(u * 2.2 - 1.2) }
  };
}

/* dir is where the picture TRAVELS, so 'l' means the new material arrives
   from the right — the same sense as a swipe. */
const AXIS = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };

function push(u, tx) {
  const [dx, dy] = AXIS[tx.dir] || AXIS.l;
  const k = smooth(u);
  const at = (x, y) => `translate(${x}%, ${y}%)`;
  return {
    going: { opacity: 1, transform: at(dx * k * 100, dy * k * 100) },
    coming: { opacity: 1, transform: at(-dx * (1 - k) * 100, -dy * (1 - k) * 100) }
  };
}

/* A whip is two frames, and two frames is four samples of nothing if the
   curve is anchored at the window's edges: at u=0 a sin() smear is zero, so
   the first of the two frames would be a clean cut and the whole effect would
   be one frame long. The frames sit at the START of their own intervals, so
   the curve is read half an interval in — which for n=2 puts both frames at
   sin(45°) and sin(135°), equally smeared, symmetric, and neither of them
   wasted. */
function whip(u, tx, n) {
  const p = clamp01(u + 0.5 / n);
  const [dx, dy] = AXIS[tx.dir] || AXIS.l;
  /* A smear is a fraction of the frame, not a number of pixels: 70px reads as
     a whip across 1920 and as a fog across 640. */
  const px = Math.round(0.036 * (S.stage.w || 1920) * Math.sin(Math.PI * p));
  const axis = dy ? 'y' : 'x';
  const at = (x, y) => `translate(${x}%, ${y}%)`;
  return {
    going: { opacity: 1, transform: at(dx * p * 22, dy * p * 22), smear: { axis, px } },
    /* the swap happens under the heaviest part of the blur, where the eye
       cannot follow it — that is the whole trick */
    coming: { opacity: clamp01((p - 0.35) / 0.3),
              transform: at(-dx * (1 - p) * 22, -dy * (1 - p) * 22),
              smear: { axis, px } }
  };
}

/* ------------------------------------------------------------ the smear --
   CSS blur() is round, and a round blur is a soft picture, not a smear. A
   directional one needs an SVG filter with a one-axis stdDeviation, so there
   is a filter element per axis and per rounded pixel amount — at most a
   couple of hundred over a session, each built once and then only referenced.

   Built from script rather than written into the page because there are two
   pages that composite (the editor and the render), and a picture that only
   smears in one of them is exactly the drift stage.js exists to prevent. */
const smears = new Map();
let defs = null;

function smearId(axis, px) {
  const key = axis + px;
  const had = smears.get(key);
  if (had) return had;
  if (!defs) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.appendChild(defs);
    document.body.appendChild(svg);
  }
  const id = `txSmear-${axis}-${px}`;
  const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  f.setAttribute('id', id);
  /* the default -10%/120% region would clip the smear off at the frame edge */
  f.setAttribute('x', '-25%'); f.setAttribute('y', '-25%');
  f.setAttribute('width', '150%'); f.setAttribute('height', '150%');
  f.setAttribute('color-interpolation-filters', 'sRGB');
  const b = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
  b.setAttribute('stdDeviation', axis === 'y' ? `0 ${px}` : `${px} 0`);
  f.appendChild(b);
  defs.appendChild(f);
  smears.set(key, id);
  return id;
}

/* Called for EVERY layer every frame, transition or not. A style left behind
   from the frame before is state, and state is the one thing a pure paint
   cannot have — a layer that kept last frame's blur would look different
   depending on where you scrubbed from. */
export function applyTo(el, style) {
  const s = style || null;
  el.style.opacity = s && s.opacity !== undefined ? String(s.opacity) : '';
  el.style.transform = (s && s.transform) || '';
  el.style.filter = s && s.smear && s.smear.px >= 1
    ? `url(#${smearId(s.smear.axis, s.smear.px)})` : '';
}

/* What the transition bar and the timeline block call it. */
export function describe(tx) {
  const t = normalize(tx);
  if (!t) return '';
  const arrow = (t.kind === 'push' || t.kind === 'whip') ? ' ' + ARROW[t.dir] : '';
  return `${t.kind}${arrow} · ${Math.round(t.ms)}ms · ${Math.round(t.ms / qTime(1))}f`;
}

/* Direction only means something for the two that travel; cycling it on a
   dissolve would be a control that does nothing. */
export const steerable = kind => kind === 'push' || kind === 'whip';
export const nextDir = dir => DIRS[(DIRS.indexOf(dir) + 1) % DIRS.length] || 'l';

/* The longest this boundary can be given: neither clip may be asked for more
   than it has, and the fps is the floor. */
export function capFor(clips, b) {
  const a = partnerOf(clips, b);
  return Math.max(qTime(1), Math.min(len(b), a ? len(a) : len(b)));
}
