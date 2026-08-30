/* ============================================================================
   THE TIMELINE — tracks, clips, and the three gestures that edit them.

   Where it started tells you which gesture it is: an edge is a trim, a body
   that travels is a move (horizontally in time, vertically between tracks),
   a body that does not is a select. Empty space is a scrub.

   Everything snaps to a frame. A clip boundary that lands between frames is a
   clip boundary the render cannot reproduce.
   ========================================================================== */
import { S, $, clamp, qFrame, qTime, duration, clipById, clipEnd, save, uid, mediaById } from './state.js';
import { draggable } from './drag.js';

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
  return el;
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
    const handle = down.target.classList.contains('h')
      ? (down.target.classList.contains('l') ? 'l' : 'r') : null;
    draw();
    return { kind: handle ? 'trim' : 'maybe', side: handle, id: clip.id, track,
             x0: down.clientX, y0: down.clientY,
             start0: clip.start, in0: clip.in, out0: clip.out };
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
      draw();
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
    if (d.kind === 'move' || d.kind === 'trim') { save(); onChange(); }
  }
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
  c.out = c.in + (cut - c.start);
  S.tracks[f.track].clips.push(right);
  save(); draw(); onChange();
}
