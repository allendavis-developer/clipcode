/* ============================================================================
   THE CLOCK.

   Owns playback, the playhead, and the one animation frame loop everything
   else hangs off. Time is quantised to a frame before it reaches a clip, so
   what you scrub past is exactly what a render would be handed — a preview
   that interpolated between frames would be a different picture and a lie.
   ========================================================================== */
import { S, $, clamp, qFrame, qTime, tc, duration, clipById } from './state.js';
import * as Stage from './stage.js';
import { draggable } from './drag.js';

let onFrame = () => {};
let last = performance.now(), painted = 0, fpsAt = performance.now();

let edits = () => [];          /* where the cuts are, for prev/next edit */

export function init(handlers = {}) {
  onFrame = handlers.onFrame || onFrame;
  edits = handlers.edits || edits;
  $('#play').onclick = () => setPlaying(!S.playing);
  const rp = $('#replay'); if (rp) rp.onclick = replay;
  $('#stepB').onclick = () => step(-1);
  $('#stepF').onclick = () => step(1);
  $('#toStart').onclick = () => { setPlaying(false); seek(0); };
  $('#toEnd').onclick = () => { setPlaying(false); seek(duration()); };
  $('#prevEdit').onclick = () => gotoEdit(-1);
  $('#nextEdit').onclick = () => gotoEdit(1);
  $('#loop').onchange = e => { S.loop = e.target.checked; };
  initScrub();
  requestAnimationFrame(tick);
}

/* Jump to the next cut in either direction — the single most used navigation
   in an edit, and the reason Up/Down exist on a keyboard. */
export function gotoEdit(dir) {
  setPlaying(false);
  const points = [0, ...edits(), duration()].sort((a, b) => a - b);
  const here = S.t;
  const next = dir > 0 ? points.find(p => p > here + 1)
                       : [...points].reverse().find(p => p < here - 1);
  seek(next === undefined ? (dir > 0 ? duration() : 0) : next);
}

/* The monitor's own scrub bar: the whole timeline in one strip under the
   picture, so you can throw the playhead anywhere without aiming at a track. */
function initScrub() {
  const bar = $('#scrub');
  if (!bar) return;
  const to = e => {
    const r = bar.getBoundingClientRect();
    seek(clamp((e.clientX - r.left) / r.width, 0, 1) * duration());
  };
  draggable(bar, { start: e => { setPlaying(false); to(e); return {}; }, move: to });
}
function drawScrub() {
  const bar = $('#scrub'), head = $('#scrubHead');
  if (!bar || !head) return;
  const d = duration();
  head.style.left = (d ? (S.t / d) * bar.clientWidth : 0) + 'px';
}

export function setPlaying(v) {
  S.playing = v;
  if (!v) Stage.pauseAllMedia();
  $('#play').textContent = v ? '❚❚' : '▶';
  $('#play').classList.toggle('on', v);
  last = performance.now();
}
export function seek(ms) {
  S.t = clamp(ms, 0, Math.max(0, duration()));
  Stage.invalidate();
}
export function step(n) { setPlaying(false); seek(qTime(qFrame(S.t) + n)); }

/* THE LOOP MUST NEVER DIE.
   Everything visible is driven from here — the playhead, the picture, the
   readouts. One throw anywhere in the body used to skip the rescheduling line
   at the bottom and stop the whole editor dead, with no error on screen and
   nothing moving. So the body is wrapped, and the reschedule is in a finally.
   A broken readout costs you a readout, not the application. */
const text = (sel, str) => { const el = $(sel); if (el) el.textContent = str; };
let loopErr = null;

/* What playback repeats over.

   Looping the WHOLE timeline is right when you are watching the video and
   useless when you are making one shot: after every edit you sit through
   everything in front of it before seeing the change. So a selected clip is
   what loops, and the timeline only when nothing is selected.

   This is the single biggest cost in the edit-see loop. Everything else in
   the editor costs you once; waiting to see your change costs you on every
   keystroke you stop typing after. */
export function loopSpan() {
  const f = S.sel && clipById(S.sel);
  if (f) {
    const c = f.clip;
    return { from: c.start, to: c.start + (c.out - c.in), clip: c };
  }
  return { from: 0, to: duration(), clip: null };
}

/* Back to the top of whatever is looping, and go. The one gesture you want
   after changing a number. */
export function replay() {
  const span = loopSpan();
  S.t = span.from;
  Stage.invalidate();
  setPlaying(true);
}

function tick(now) {
  try {
    const dt = now - last;
    last = now;
    if (S.playing) {
      S.t += dt;
      const span = loopSpan();
      if (S.t >= span.to) {
        if (S.loop && span.to > span.from) S.t = span.from;
        else { S.t = span.to; setPlaying(false); }
      }
    }
    Stage.paint().then(() => { painted++; }, () => {});

    text('#tc', tc(S.t));
    text('#frameNo', 'f' + qFrame(S.t));
    if (now - fpsAt > 500) {
      text('#fps', (painted / ((now - fpsAt) / 1000)).toFixed(0) + ' fps');
      text('#what', Stage.status());
      painted = 0;
      fpsAt = now;
    }
    drawScrub();
    /* The label says what it repeats, because it is now two different things
       and a checkbox that means one of two things without saying which is a
       checkbox you have to test to understand. */
    const what = $('#loopWhat');
    if (what) {
      const span = loopSpan();
      const want = span.clip ? 'loop clip' : 'loop all';
      if (what.textContent !== want) what.textContent = want;
    }
    onFrame();
  } catch (e) {
    /* report once, then carry on — a loop that logs 60 errors a second is
       just a different way of being unusable */
    if (String(e) !== loopErr) { loopErr = String(e); console.error('tick:', e); }
  } finally {
    requestAnimationFrame(tick);
  }
}

/* --------------------------------------------------------------- keyboard --
   Only when you are not typing. The editor owns its own keys. */
export function bindKeys(actions = {}) {
  addEventListener('keydown', e => {
    const typing = e.target.closest('.CodeMirror')
      || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);

    /* These two work while typing as well. Needing to click out of the code
       before you can look something up defeats the point of the reference
       being in the editor. */
    if (e.key === 'F1') { e.preventDefault(); actions.help?.(); return; }
    if (e.key === 'Escape') { actions.escape?.(); return; }

    if (typing) return;
    if (e.key === '?') { e.preventDefault(); actions.help?.(); return; }
    const shift = e.shiftKey;
    switch (e.key) {
      /* transport, the way an NLE does it */
      case ' ':          e.preventDefault(); setPlaying(!S.playing); break;
      case 'k': case 'K': setPlaying(false); break;
      case 'l': case 'L': setPlaying(true); break;
      case 'j': case 'J': setPlaying(false); step(-1); break;
      case 'ArrowLeft':  e.preventDefault(); step(shift ? -5 : -1); break;
      case 'ArrowRight': e.preventDefault(); step(shift ? 5 : 1); break;
      case 'ArrowUp':    e.preventDefault(); gotoEdit(-1); break;
      case 'ArrowDown':  e.preventDefault(); gotoEdit(1); break;
      case 'r': case 'R': e.preventDefault(); replay(); break;
      case 'Home':       setPlaying(false); seek(loopSpan().from); break;
      case 'End':        setPlaying(false); seek(duration()); break;
      /* editing */
      case 'Delete':
      case 'Backspace':  actions.deleteClip?.(); break;
      case 'c': case 'C':
      case 'b': case 'B': actions.split?.(); break;
      case '+': case '=': actions.zoom?.(1.3); break;
      case '-':           actions.zoom?.(1 / 1.3); break;
      default: break;
    }
  });
}
