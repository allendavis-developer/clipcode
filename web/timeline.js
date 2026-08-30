/* ============================================================================
   THE TIMELINE — tracks, clips, and the three gestures that edit them.

   Where it started tells you which gesture it is: an edge is a trim, a body
   that travels is a move (horizontally in time, vertically between tracks),
   a body that does not is a select. Empty space is a scrub.

   Everything snaps to a frame. A clip boundary that lands between frames is a
   clip boundary the render cannot reproduce.

   Transitions add two more to the vocabulary rather than a new gesture: the
   edge of a transition block is a trim like any other edge, and pushing a clip
   into the one before it is a move whose overlap becomes a length. Both run
   inside the same captured drag. See transitions.js for the model.
   ========================================================================== */
import { S, $, clamp, qFrame, qTime, duration, allClips, clipById, clipEnd, save, uid, mediaById } from './state.js';
import { draggable } from './drag.js';
import * as TX from './transitions.js';

let onSeek = () => {}, onSelect = () => {}, onChange = () => {};
export function wire(h) { onSeek = h.seek; onSelect = h.select; onChange = h.change; }

export const pxOf = ms => (ms / 1000) * S.pxPerSec;
export const msOf = px => (px / S.pxPerSec) * 1000;
const snap = ms => qTime(qFrame(ms));

export function draw() {
  const tracksEl = $('#tracks'), ruler = $('#ruler');
  /* only the rows are rebuilt — #tlHead also holds a fixed tools strip,
     and clearing the whole header deletes elements other modules own */
  const headEl = $('#tlHeadRows');
  const total = Math.max(duration(), 10000);
  const width = pxOf(total) + 400;

  ruler.style.width = width + 'px';
  ruler.innerHTML = '';
  const secStep = S.pxPerSec > 60 ? 1 : S.pxPerSec > 24 ? 5 : S.pxPerSec > 8 ? 15 : 60;
  for (let s = 0; s * 1000 <= total + 5000; s += secStep) {
    const d = document.createElement('div');
    d.className = 'tick' + (s % (secStep * 2) === 0 ? ' maj' : '');
    d.style.left = pxOf(s * 1000) + 'px';
    d.textContent = s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : s + 's';
    ruler.appendChild(d);
  }

  tracksEl.style.width = width + 'px';
  tracksEl.innerHTML = '';
  if (headEl) headEl.innerHTML = '';
  /* top of the stack drawn first, so the list reads the way it composites */
  for (let i = S.tracks.length - 1; i >= 0; i--) {
    const tr = S.tracks[i];
    const row = document.createElement('div');
    row.className = 'track'; row.dataset.track = String(i);
    for (const c of tr.clips || []) row.appendChild(clipEl(c, i));
    tracksEl.appendChild(row);

    const h = document.createElement('div');
    h.className = 'thRow';
    h.innerHTML = `<span>${tr.id}</span>`;
    if (headEl) headEl.appendChild(h);
  }
  $('#len').textContent = (duration() / 1000).toFixed(1) + 's';
  drawPlayhead();
}

function clipEl(c, trackIndex) {
  const el = document.createElement('div');
  el.className = `clip ${c.kind}` + (S.sel === c.id ? ' sel' : '');
  el.style.left = pxOf(c.start) + 'px';
  el.style.width = Math.max(6, pxOf(c.out - c.in)) + 'px';
  el.dataset.id = c.id;
  el.dataset.track = String(trackIndex);
  const label = c.kind === 'code' ? c.src.replace(/^clips\//, '') : (mediaById(c.media)?.name || c.src);
  el.innerHTML = `<div class="cn">${label}</div>`
    + `<div class="cd">${((c.out - c.in) / 1000).toFixed(2)}s</div>`
    + `<div class="h l"></div><div class="h r"></div>`;
  if (c.kind === 'audio' || c.kind === 'video') drawWave(el, c);
  const tx = txEl(c);
  /* the kind's colour is set on the clip, not the block, so the clip's own
     left edge can carry it too — at a zoom where the block is a sliver that
     edge is the only thing left to see */
  if (tx) { el.classList.add('hasTx', tx.dataset.kindClass); el.appendChild(tx); }
  return el;
}

/* ------------------------------------------------------------ transitions --
   Drawn at the head of the incoming clip, which is exactly where it happens:
   the window opens at the cut and runs into the clip that owns it. So a
   boundary with a transition looks different from one without without needing
   a marker invented for the purpose. */
function txEl(c) {
  /* below a frame it is not a transition yet — which is what dragging its
     edge down to nothing looks like on the way to removing it */
  if (!c.trans || !(Number(c.trans.ms) >= qTime(1))) return null;
  const tx = TX.normalize(c.trans);
  if (!tx) return null;

  const el = document.createElement('div');
  el.className = 'tx tx-' + tx.kind;
  el.dataset.kindClass = 'tx-' + tx.kind;
  const w = pxOf(tx.ms);
  /* A two-frame whip is six pixels wide at the default zoom — too small to
     read and too small to grab. The block has a floor so the boundary is
     visible and the handle reachable; the number written on it is the truth,
     and zooming in makes the width the truth too. */
  el.style.width = Math.max(15, w) + 'px';
  el.title = TX.describe(tx) + ' — drag this edge for its length, '
    + 'double-click it to steer, drag it to nothing to remove';

  /* Three ways to say the same length, in as many characters as there is
     room for. Frames rather than milliseconds when it is down to two
     characters: a whip is two frames long and "2f" is the number that means
     something about it. */
  const label = w > 76 ? `${tx.kind}${TX.steerable(tx.kind) ? ' ' + TX.ARROW[tx.dir] : ''} · ${Math.round(tx.ms)}ms`
              : w > 44 ? `${Math.round(tx.ms)}ms`
              : w > 17 ? `${Math.round(tx.ms / qTime(1))}f` : '';
  el.innerHTML = (label ? `<span class="txn">${label}</span>` : '') + `<i class="txh"></i>`;
  return el;
}

/* The most this boundary can be given: neither clip may be asked for more
   than it has. */
function capOf(id) {
  const all = allClips();
  const b = all.find(c => c.id === id);
  return b ? TX.capFor(all, b) : qTime(1);
}

/* -------------------------------------------------------------- waveform --
   You cut to a voice, so the voice has to be visible. Without this, finding
   the end of a sentence means replaying the same two seconds and watching a
   number, which is the actual reason an audio track was a blocker rather than
   a nicety.

   Peaks come from the server, which caches them beside the file. They are
   fetched once per source and kept here, because the timeline redraws on every
   drag and a fetch per redraw would be a fetch per frame. */
const waves = new Map();          /* src -> peaks, or 'loading', or null */

function drawWave(el, c) {
  const m = mediaById(c.media);
  const src = (m && m.src) || c.src;      /* media/<file>, relative to the project */
  if (!src) return;

  const have = waves.get(src);
  if (have === undefined) {
    waves.set(src, 'loading');
    fetch(`/api/waveform?name=${encodeURIComponent(S.name)}&src=${encodeURIComponent(src)}`)
      .then(r => r.json())
      .then(w => { waves.set(src, w && w.ok ? w : null); draw(); })
      .catch(() => { waves.set(src, null); });
    return;
  }
  if (!have || have === 'loading') return;

  const cv = document.createElement('canvas');
  cv.className = 'cw';
  const w = Math.max(6, Math.round(pxOf(c.out - c.in)));
  const h = 34;
  /* drawn at device resolution so it is not a soft grey smear on a hidpi screen */
  const dpr = Math.min(3, devicePixelRatio || 1);
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.round(h * dpr);
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';

  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = 'rgba(255,255,255,.34)';

  /* Normalised to the loudest peak in the file. Absolute level says more about
     how the mic was set than about the take, and a quiet recording should not
     draw as a flat line. */
  let top = 0.0001;
  for (let i = 0; i < have.hi.length; i++)
    top = Math.max(top, Math.abs(have.hi[i]), Math.abs(have.lo[i]));

  /* the visible span of the source, so a trimmed clip shows its own part */
  const total = have.durationMs || 1;
  const from = c.in / total, to = (c.out) / total;

  for (let x = 0; x < w; x++) {
    const u = from + ((to - from) * x) / w;
    const b = Math.min(have.hi.length - 1, Math.max(0, Math.round(u * (have.hi.length - 1))));
    const hi = Math.abs(have.hi[b]) / top, lo = Math.abs(have.lo[b]) / top;
    const up = Math.max(0.5, (hi * h) / 2), dn = Math.max(0.5, (lo * h) / 2);
    g.fillRect(x, h / 2 - up, 1, up + dn);
  }
  el.appendChild(cv);
}

export function drawPlayhead() {
  $('#playhead').style.left = pxOf(S.t) + 'px';
}

/* ------------------------------------------------------------------ input --
   One press, three possible gestures, told apart by where it started and how
   far it travelled: an edge is a trim, a body that moves is a move, a body
   that does not is a select, and empty space is a scrub. All of it runs inside
   a single captured drag, so releasing the button anywhere ends it. */
draggable($('#tlBody'), {
  start: down => {
    const el = down.target.closest('.clip');
    if (!el) {
      onSeek(msOf(down.clientX - $('#tracks').getBoundingClientRect().left));
      return { kind: 'scrub' };
    }
    const found = clipById(el.dataset.id);
    if (!found) return false;
    const { clip, track } = found;
    S.sel = clip.id;
    onSelect(clip);
    /* Asked before the trim handles: a short transition's edge sits on top of
       the left trim handle, and the one you can see is the one you meant. */
    const onTx = !!down.target.closest('.txh');
    const handle = down.target.classList.contains('h')
      ? (down.target.classList.contains('l') ? 'l' : 'r') : null;
    draw();
    return { kind: onTx ? 'trans' : handle ? 'trim' : 'maybe',
             side: handle, id: clip.id, track,
             x0: down.clientX, y0: down.clientY,
             start0: clip.start, in0: clip.in, out0: clip.out,
             ms0: (clip.trans && Number(clip.trans.ms)) || 0 };
  },

  move: (e, d) => {
    if (d.kind === 'scrub')
      return onSeek(msOf(e.clientX - $('#tracks').getBoundingClientRect().left));

    const dx = e.clientX - d.x0;
    if (d.kind === 'maybe' && (Math.abs(dx) > 4 || Math.abs(e.clientY - d.y0) > 8))
      d.kind = 'move';

    const found = clipById(d.id);
    if (!found) return;
    const clip = found.clip;

    if (d.kind === 'trans') {
      /* Zero is allowed on the way past — that is how you remove one, and a
         floor here would mean there was no way back to no transition. */
      clip.trans = { ...(clip.trans || { kind: 'dissolve' }),
                     ms: clamp(snap(d.ms0 + msOf(dx)), 0, capOf(d.id)) };
      draw();
    }

    if (d.kind === 'move') {
      clip.start = Math.max(0, snap(d.start0 + msOf(dx)));
      const row = [...document.querySelectorAll('.track')].find(r => {
        const b = r.getBoundingClientRect();
        return e.clientY >= b.top && e.clientY <= b.bottom;
      });
      if (row) {
        const to = Number(row.dataset.track);
        if (to !== found.track) { moveToTrack(clip, found.track, to); d.track = to; }
      }
      d.into = overlapped(clip, d.track);
      draw();
      if (d.into) markPending(clip.id, d.into.ms);
    }

    if (d.kind === 'trim') {
      const dt = msOf(dx);
      if (d.side === 'l') {
        const nin = clamp(snap(d.in0 + dt), 0, d.out0 - qTime(2));
        clip.start = Math.max(0, snap(d.start0 + (nin - d.in0)));
        clip.in = nin;
      } else {
        const cap = clip.natural || d.out0;
        clip.out = clamp(snap(d.out0 + dt), clip.in + qTime(2),
                         Math.max(cap, clip.in + qTime(2)));
      }
      draw();
    }
  },

  end: (e, d) => {
    const clip = clipById(d.id)?.clip;

    /* Dragged to nothing means gone. Anything else that survived the clamp is
       a length, and a length is a transition. */
    if (d.kind === 'trans' && clip) {
      if (!(Number(clip.trans && clip.trans.ms) >= qTime(1))) delete clip.trans;
      else clip.trans = TX.normalize(clip.trans);
      draw();
    }

    /* The overlap you made is the length, and then the cut goes back to where
       it was: the model has no geometric overlap, so leaving the clip where
       the mouse dropped it would move everything after it by the length of a
       transition you asked for and not for a cut you asked to move. */
    if (d.kind === 'move' && clip && d.into) {
      clip.start = clipEnd(d.into.a);
      clip.trans = TX.normalize({ kind: (clip.trans && clip.trans.kind) || 'dissolve',
                                  dir: clip.trans && clip.trans.dir,
                                  ms: d.into.ms });
      draw();
    }

    if (d.kind === 'move' || d.kind === 'trim' || d.kind === 'trans') { save(); onChange(); }
  }
});

/* Pushing a clip into the one before it is how you ask for a transition, so
   the gesture that makes one is the gesture you already have. Bounded, because
   a long overlap is someone rearranging the edit, not asking for a two second
   dissolve — past that it stays a plain move. */
const MAX_OVERLAP = 2000;

function overlapped(clip, track) {
  if (clip.kind === 'audio') return null;
  let best = null;
  for (const a of S.tracks[track].clips || []) {
    if (a.id === clip.id || a.kind === 'audio' || a.start >= clip.start) continue;
    const over = snap(clipEnd(a) - clip.start);
    if (over < qTime(1) || over > MAX_OVERLAP) continue;
    if (over > a.out - a.in || over > clip.out - clip.in) continue;
    if (!best || clipEnd(a) > clipEnd(best.a)) best = { a, ms: over };
  }
  return best;
}

/* What the overlap will become, drawn where it will be. Added after draw()
   rather than inside it because it belongs to a drag in progress and not to
   the edit — nothing has been decided until the button comes up. */
function markPending(id, ms) {
  const el = document.querySelector(`.clip[data-id="${id}"]`);
  if (!el) return;
  el.classList.add('txMaking');
  /* the length being proposed replaces the one it already has, so only one
     block is ever drawn */
  for (const old of el.querySelectorAll('.tx')) old.remove();
  const g = document.createElement('div');
  g.className = 'tx tx-pending';
  g.style.width = Math.max(15, pxOf(ms)) + 'px';
  g.innerHTML = `<span class="txn">${Math.round(ms)}ms</span>`;
  el.appendChild(g);
}

/* ------------------------------------------------------------- the palette --
   Drag a kind onto a cut. It goes through draggable() like everything else
   rather than HTML5 drag-and-drop: pointer capture keeps every move on the
   chip, so the drop can be resolved from the coordinates without every
   possible target having to know about a drag it is not part of. */
function boundaryAt(clientX, clientY) {
  const row = [...document.querySelectorAll('.track')].find(r => {
    const b = r.getBoundingClientRect();
    return clientY >= b.top && clientY <= b.bottom;
  });
  if (!row) return null;
  const ms = msOf(clientX - $('#tracks').getBoundingClientRect().left);
  let best = null;
  for (const c of S.tracks[Number(row.dataset.track)].clips || []) {
    if (c.kind === 'audio') continue;
    const px = Math.abs(pxOf(c.start - ms));
    if (px > 44 || (best && px >= best.px)) continue;
    best = { clip: c, px };
  }
  return best ? best.clip : null;
}

function aimAt(clip) {
  for (const el of document.querySelectorAll('.clip.txTarget')) el.classList.remove('txTarget');
  if (!clip) return;
  const el = document.querySelector(`.clip[data-id="${clip.id}"]`);
  if (el) el.classList.add('txTarget');
}

for (const chip of document.querySelectorAll('#txBar .txChip')) {
  const kind = chip.dataset.kind;
  const follow = (g, e) => { g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px'; };
  draggable(chip, {
    start: down => {
      const ghost = document.createElement('div');
      ghost.className = 'txGhost tx-' + kind;
      ghost.textContent = kind;
      document.body.appendChild(ghost);
      follow(ghost, down);
      return { ghost };
    },
    move: (e, c) => { follow(c.ghost, e); aimAt(boundaryAt(e.clientX, e.clientY)); },
    end: (e, c) => {
      c.ghost.remove();
      aimAt(null);
      const b = boundaryAt(e.clientX, e.clientY);
      if (!b) return;
      const had = TX.normalize(b.trans);
      /* Dropping the same kind a second time steers it. It is the next thing
         you want after setting a push, and it needs no second control. */
      const dir = had && had.kind === kind && TX.steerable(kind)
        ? TX.nextDir(had.dir) : (had && had.dir) || 'l';
      b.trans = TX.normalize({ kind, dir,
        ms: Math.min(had ? had.ms : TX.defaultMs(kind), capOf(b.id)) });
      S.sel = b.id;
      save(); draw(); onSelect(b); onChange();
    }
  });
}

/* Direction is the one thing left that a drag cannot say, and the edge is
   already the transition's own control, so it says it. */
$('#tlBody').addEventListener('dblclick', e => {
  const el = e.target.closest('.txh') && e.target.closest('.clip');
  const clip = el && clipById(el.dataset.id)?.clip;
  const tx = clip && TX.normalize(clip.trans);
  if (!tx || !TX.steerable(tx.kind)) return;
  clip.trans = { ...tx, dir: TX.nextDir(tx.dir) };
  save(); draw(); onChange();
});

function moveToTrack(clip, from, to) {
  const src = S.tracks[from].clips;
  const i = src.findIndex(c => c.id === clip.id);
  if (i < 0) return;
  src.splice(i, 1);
  (S.tracks[to].clips = S.tracks[to].clips || []).push(clip);
}

/* ------------------------------------------------------- dropping from pool -- */
export function dropAt(clientX, clientY, make) {
  const rect = $('#tracks').getBoundingClientRect();
  const rows = [...document.querySelectorAll('.track')];
  const row = rows.find(r => {
    const b = r.getBoundingClientRect();
    return clientY >= b.top && clientY <= b.bottom;
  });
  const track = row ? Number(row.dataset.track) : S.tracks.length - 1;
  const start = Math.max(0, snap(msOf(clientX - rect.left)));
  const clip = make(start);
  if (!clip) return null;
  (S.tracks[track].clips = S.tracks[track].clips || []).push(clip);
  S.sel = clip.id;
  save(); draw(); onChange();
  return clip;
}

export function addTrack() {
  S.tracks.push({ id: 'V' + (S.tracks.length + 1), clips: [] });
  save(); draw();
}
/* Returns the clip that was removed, so the caller can decide whether its
   file should go too — that is a project question, not a timeline one. */
export function deleteSelected() {
  if (!S.sel) return null;
  const f = clipById(S.sel);
  if (!f) return null;
  const arr = S.tracks[f.track].clips;
  const [removed] = arr.splice(arr.findIndex(c => c.id === S.sel), 1);
  S.sel = null;
  save(); draw(); onChange();
  return removed || null;
}
export function splitAtPlayhead() {
  const f = S.sel && clipById(S.sel);
  if (!f) return;
  const c = f.clip;
  if (S.t <= c.start || S.t >= clipEnd(c)) return;
  const cut = snap(S.t);
  const right = { ...c, id: uid(), in: c.in + (cut - c.start), start: cut };
  /* A split makes a new cut, and a new cut is a cut. The head transition
     stays on the half that still starts where it always did. */
  delete right.trans;
  c.out = c.in + (cut - c.start);
  S.tracks[f.track].clips.push(right);
  save(); draw(); onChange();
}
