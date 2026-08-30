/* ============================================================================
   GUIDES, AND WHERE THE EYE IS.

   Two different jobs behind one toggle.

   COMPOSITION. Thirds, a centre cross, and title/action safe. Ordinary, and
   worth having because "is that centred" is otherwise answered by squinting.

   EYE TRACE. Where the viewer is most likely looking, marked on the picture,
   and — at a cut — where it was on the last frame of the outgoing clip against
   where it is on the first frame of the incoming one.

   That second one is the point. It is Walter Murch's term, from In the Blink
   of an Eye: the audience's focus of interest has a position in the frame, and
   a cut that moves it a long way makes the viewer hunt for the subject and
   feel the edit. Match the positions and the cut disappears. It is one of his
   six criteria for a good cut, and unlike the other five it is a thing a tool
   can actually measure for you.

   HOW THE FOCUS IS ESTIMATED. Not by saliency on pixels — for motion graphics
   that is the wrong model and it is also unavailable, since the clip is drawn
   in an iframe this page cannot rasterise. Instead the elements themselves are
   weighted: area x opacity, with a lift for anything bright or moving. For a
   frame that is a few big words on black, the centroid of the big words IS
   where you are looking, and it is exact rather than estimated.

   It is an estimate and it is labelled as one. The value is not the dot; it is
   the DISTANCE between two dots either side of a cut, which is a number you
   can act on and could not otherwise get.
   ========================================================================== */
import { S, $, allClips, clipEnd, qTime, qFrame } from './state.js';

let on = false;
let host = null;

export const isOn = () => on;

export function init() {
  host = $('#guides');
  if (!host) return;
  const btn = $('#btnGuides');
  if (btn) btn.onclick = () => set(!on);
  set(false);
}

function set(v) {
  on = v;
  const btn = $('#btnGuides');
  if (btn) btn.classList.toggle('on', on);
  if (host) host.classList.toggle('hidden', !on);
  if (on) draw();
}

/* ------------------------------------------------------------------ focus --
   The centroid of what is on screen, weighted by how much of your attention
   each thing is likely to take.

   Area is most of it: a 268px headline dominates a 40px caption and should.
   Opacity multiplies, so something fading out stops counting as it goes.
   Brightness lifts it a little, because on a black stage a lit element is
   where you look and a dark one is not.

   Reads the clip's own DOM through the iframe. Same origin, so this is allowed
   and cheap; it is also exact, where anything pixel-based would be a guess. */
function focusOf(frameEl) {
  let doc = null;
  try { doc = frameEl && frameEl.contentDocument; } catch { return null; }
  if (!doc) return null;

  const stage = doc.getElementById('stage');
  if (!stage) return null;
  const box = stage.getBoundingClientRect();
  if (!box.width || !box.height) return null;

  let wx = 0, wy = 0, total = 0;
  const seen = doc.querySelectorAll('#stage *');
  for (const el of seen) {
    /* only things that draw: a wrapper contributes its children, not itself */
    if (el.id === '__world' || el.id === '__wires') continue;
    if (el.children.length && !el.textContent.trim() && el.tagName !== 'IMG'
        && el.tagName !== 'path') continue;

    const cs = getComputedStyle(el);
    const o = Number(cs.opacity);
    if (!(o > 0.04) || cs.visibility === 'hidden' || cs.display === 'none') continue;

    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;

    /* clipped out of frame counts for nothing */
    const vw = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left));
    const vh = Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top));
    if (!vw || !vh) continue;

    const bright = luma(cs.color) * 0.6 + 0.4;
    const w = vw * vh * o * bright;
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

/* the layer showing whatever is under a given moment */
function frameAt(ms) {
  const t = qTime(qFrame(ms));
  const under = allClips().filter(c => c.kind === 'code' && t >= c.start && t < clipEnd(c));
  if (!under.length) return null;
  const top = under.sort((a, b) => (a._track || 0) - (b._track || 0)).pop();
  const frames = document.querySelectorAll('#stage iframe');
  for (const f of frames) {
    try {
      if (f.src.includes(encodeURIComponent(top.src)) || f.src.includes(top.src)) return f;
    } catch {}
  }
  return frames[frames.length - 1] || null;
}

/* -------------------------------------------------------------- the draw -- */
export function draw() {
  if (!on || !host) return;
  const fit = $('#stageFit');
  if (!fit) return;
  const r = fit.getBoundingClientRect();
  const v = $('#viewer').getBoundingClientRect();
  host.style.left = (r.left - v.left) + 'px';
  host.style.top = (r.top - v.top) + 'px';
  host.style.width = r.width + 'px';
  host.style.height = r.height + 'px';

  const here = focusOf(frameAt(S.t));
  const cut = nearestCut(S.t);

  host.innerHTML =
    `<svg viewBox="0 0 100 100" preserveAspectRatio="none">
       <line class="gThird" x1="33.33" y1="0" x2="33.33" y2="100"/>
       <line class="gThird" x1="66.66" y1="0" x2="66.66" y2="100"/>
       <line class="gThird" x1="0" y1="33.33" x2="100" y2="33.33"/>
       <line class="gThird" x1="0" y1="66.66" x2="100" y2="66.66"/>
       <rect class="gSafe" x="5" y="5" width="90" height="90"/>
       <rect class="gSafe title" x="10" y="10" width="80" height="80"/>
       <line class="gMid" x1="50" y1="47" x2="50" y2="53"/>
       <line class="gMid" x1="47" y1="50" x2="53" y2="50"/>
     </svg>`
    + (here ? dot(here, 'gNow') : '')
    + (cut ? eyeTrace(cut) : '');
}

const dot = (p, cls) =>
  `<div class="gDot ${cls}" style="left:${(p.x * 100).toFixed(2)}%;`
  + `top:${(p.y * 100).toFixed(2)}%"></div>`;

/* ---------------------------------------------------------------- a cut --
   Within a few frames of a boundary, show both sides of it: where the eye was
   on the way out and where it has to go on the way in. The line between them
   is the jump the viewer has to make. */
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
  const step = 1000 / (S.stage.fps || 30);
  const before = focusOf(frameAt(edge - step));
  const after = focusOf(frameAt(edge + step));
  if (!before || !after) return '';

  const dx = (after.x - before.x) * 100, dy = (after.y - before.y) * 100;
  const jump = Math.round(Math.hypot(dx, dy));

  /* A rough band, and said as a suggestion rather than a rule: under about a
     tenth of the frame the eye does not have to travel and the cut is
     invisible; past a third it is a hunt. */
  const verdict = jump < 10 ? 'matched' : jump < 33 ? 'a short move' : 'a long jump';

  return `<svg class="gTrace" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line x1="${before.x * 100}" y1="${before.y * 100}"
                  x2="${after.x * 100}" y2="${after.y * 100}"/>
          </svg>`
    + dot(before, 'gWas') + dot(after, 'gNext')
    + `<div class="gRead">eye trace &middot; ${jump}% of the frame &middot; ${verdict}</div>`;
}
