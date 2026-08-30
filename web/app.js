/* ============================================================================
   BOOT AND WIRING — and nothing else.

   Every module owns one thing and publishes what happened; this file is the
   only place that knows they exist together. If a behaviour needs two modules
   to agree, the joining goes here rather than inside either of them.

     state      the edit, and writing it to disk
     stage      compositing whatever is under the playhead
     timeline   arranging clips with a mouse
     transport  the clock and the playhead
     editor     the code pane, and a clip's source
     pool       media, and getting it into the project
   ========================================================================== */
import { S, $, clamp, save, flush, uid, clipById } from './state.js';
import * as Stage from './stage.js';
import * as TL from './timeline.js';
import * as Transport from './transport.js';
import * as Editor from './editor.js';
import * as Pool from './pool.js';
import * as Help from './help.js';
import * as Curve from './curve.js';
import { draggable, cursorDuring } from './drag.js';
import * as Layout from './layout.js';

async function api(url, method = 'GET', body) {
  const opt = { method };
  if (body !== undefined) {
    opt.headers = { 'content-type': 'application/json' };
    opt.body = JSON.stringify(body);
  }
  return (await fetch(url, opt)).json();
}

/* ----------------------------------------------------------------- project -- */
/* Which project you had open is a per-machine preference, not part of any
   project, so it lives in the browser rather than on disk. */
const LAST = 'studio.lastProject';
const remember = name => { try { localStorage.setItem(LAST, name); } catch {} };
const recall = () => { try { return localStorage.getItem(LAST); } catch { return null; } };

async function listProjects(select) {
  const { projects, root } = await api('/api/projects');
  const sel = $('#project');
  sel.innerHTML = projects.map(p => `<option>${p}</option>`).join('')
    || '<option value="">no projects</option>';
  sel.title = root ? 'projects live in ' + root : '';
  const want = select || recall();
  if (want && projects.includes(want)) sel.value = want;
  return sel.value;
}

async function loadProject(name, keepTime = false) {
  if (!name) return;
  await flush();
  const r = await api('/api/project?name=' + encodeURIComponent(name));
  if (!r.ok) return;
  remember(name);
  const at = S.t;
  Object.assign(S, {
    name,
    stage: r.project.stage,
    media: r.project.media,
    tracks: r.project.tracks,
    sel: null,
    t: keepTime ? at : 0
  });
  Stage.fit();
  Stage.invalidate();
  Pool.draw();
  TL.draw();
  /* Open something. An editor with nothing selected is read-only, and a
     read-only editor that looks exactly like a writable one is a dead end you
     can sit in for a long time wondering why the keyboard does nothing. */
  await Editor.open(clipToOpen());
  /* the font picker lists what THIS project carries, so it follows the project */
  Editor.refreshFonts();
  TL.draw();
}

/* the clip under the playhead, else the first code clip, else nothing */
function clipToOpen() {
  const all = S.tracks.flatMap(tr => tr.clips || []);
  const here = all.find(c => S.t >= c.start && S.t < c.start + (c.out - c.in) && c.kind === 'code');
  const chosen = here || all.find(c => c.kind === 'code') || null;
  if (chosen) S.sel = chosen.id;
  return chosen;
}

/* ------------------------------------------------------------------ wiring -- */
/* Deleting a code clip deletes its file too — unless another clip on the
   timeline still points at it, which happens when you copy one. */
async function deleteClip() {
  const removed = TL.deleteSelected();
  if (!removed) return;
  /* Close it in the editor first. A pending save would otherwise write the
     file back moments after the server deleted it. */
  Editor.forget(removed.id);
  if (removed.kind !== 'code') return;
  const stillUsed = S.tracks.some(tr => (tr.clips || []).some(c => c.src === removed.src));
  if (stillUsed) return;
  await api('/api/clip/delete', 'POST', { name: S.name, src: removed.src });
}

/* The clock advances time; the timeline draws where time is. Transport does
   not know what a playhead looks like, so the redraw is wired here. */
Transport.init({
  onFrame: TL.drawPlayhead,
  /* every clip boundary, which is what "next edit" means */
  edits: () => S.tracks.flatMap(tr => (tr.clips || [])
    .flatMap(c => [c.start, c.start + (c.out - c.in)]))
});
Transport.bindKeys({
  deleteClip,
  split: () => TL.splitAtPlayhead(),
  zoom: k => { S.pxPerSec = clamp(S.pxPerSec * k, 4, 600); TL.draw(); },
  help: () => Help.toggle(),
  /* one Escape, one thing closed, topmost first */
  escape: () => { if (Help.isOpen()) Help.hide(); else Curve.hide(); }
});

/* The reference reads itself out of motion.js, so an example you click into
   your code is the same text that documents the function. */
Help.init({ insert: text => Editor.insertAtCursor(text) });
$('#btnHelp').onclick = Help.toggle;

TL.wire({
  seek: ms => { Transport.setPlaying(false); Transport.seek(ms); },
  select: clip => {
    $('#sel').textContent = `${clip.kind} · ${((clip.out - clip.in) / 1000).toFixed(2)}s`;
    Editor.open(clip);
  },
  change: () => Stage.invalidate()
});

Pool.init({ onImported: () => loadProject(S.name, true) });

Editor.init({
  /* A clip declares its own length, and that declaration is the only copy of
     the number. If the clip on the timeline was still its full self it follows
     in both directions; a trimmed clip keeps its trim and is only pulled back
     if it now runs past the end. */
  onApplied: (clip, declared) => {
    if (declared) applyDuration(clip.id, declared);
    Stage.reloadClip(clip.id);
    Stage.invalidate();
    /* Your change, from the top, without touching anything.

       Only while playing, which makes it opt-in by a gesture you already have:
       press space once and the clip repeats while you work, and every edit
       starts it again. Stopped, nothing jumps under you mid-thought. */
    if (S.playing) Transport.replay();
  }
});

/* A clip's length comes from one of two places, and they are the same rule:
   duration(ms) when the clip states it, and the end of the choreography when
   it does not. Either way the timeline follows, and a clip you have trimmed by
   hand keeps its trim unless it would now run past the end. */
function applyDuration(id, ms) {
  const found = clipById(id);
  if (!found || !ms) return;
  const c = found.clip;
  if (c.natural === ms) return;
  const untrimmed = c.in === 0 && c.out === c.natural;
  c.natural = ms;
  if (untrimmed || c.out > ms) c.out = ms;
  save();
  TL.draw();
}

Stage.setDurationSink(applyDuration);

/* A note is not an error — the clip runs. It is the tool saying that what you
   wrote will not do what you appear to have meant. */
Stage.setNoteSink((id, msg) => {
  const open = Editor.openClip();
  if (open && open.id === id) Editor.showNote(msg);
});

/* An error inside a clip belongs in the pane where you can fix it — but only
   for the clip you are actually looking at. */
Stage.setErrorSink((id, msg, where) => {
  const open = Editor.openClip();
  if (open && open.id === id) Editor.showError(msg, where);
});

/* Dropping media on the timeline is the one gesture needing both the pool
   (what was dragged) and the timeline (where it landed). */
$('#tlBody').addEventListener('dragover', e => {
  if ([...e.dataTransfer.types].includes(Pool.DRAG_TYPE)) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
});
$('#tlBody').addEventListener('drop', e => {
  const id = e.dataTransfer.getData(Pool.DRAG_TYPE);
  if (!id) return;
  e.preventDefault();
  TL.dropAt(e.clientX, e.clientY, start => Pool.clipFor(id, start, uid));
});

/* ----------------------------------------------------------------- toolbar -- */
$('#project').onchange = e => loadProject(e.target.value);

$('#btnNewProject').onclick = async () => {
  const name = prompt('Project name');
  if (!name) return;
  const r = await api('/api/project/new', 'POST', { name });
  if (!r.ok) return alert(r.why);
  await listProjects(r.name);
  await loadProject(r.name);
};

$('#btnNewCode').onclick = async () => {
  if (!S.name) return;
  const title = prompt('Name this clip', 'clip');
  if (!title) return;
  const r = await api('/api/clip/new', 'POST', { name: S.name, title });
  if (!r.ok) return alert(r.why);
  const top = S.tracks.length - 1;
  const clip = { id: uid(), kind: 'code', src: r.src,
                 start: Math.round(S.t), in: 0, out: 3000, natural: 3000 };
  (S.tracks[top].clips || (S.tracks[top].clips = [])).push(clip);
  S.sel = clip.id;
  save();
  TL.draw();
  Stage.invalidate();
  Editor.open(clip);
};

/* --------------------------------------------------------------- splitters --
   A vertical gutter sizes the pane to its LEFT; the horizontal one sizes the
   timeline below it. Both go through draggable(), so a missed pointerup cannot
   leave a live move handler behind. */
function vSplit(gutter, pane, cssVar, min, max) {
  draggable(gutter, {
    start: () => ({ originX: pane.getBoundingClientRect().left,
                    restore: cursorDuring('col-resize') }),
    move: (e, c) => {
      const w = clamp(Math.round(e.clientX - c.originX), min, max);
      document.documentElement.style.setProperty(cssVar, w + 'px');
      TL.draw();
    },
    end: (e, c) => {
      c.restore();
      /* on release, not on every move: the layout is where you settled */
      Layout.remember(cssVar, getComputedStyle(document.documentElement)
        .getPropertyValue(cssVar).trim());
    }
  });
  /* double-click puts it back to the stylesheet's default, and forgets the
     override with it — otherwise it would return on the next load */
  gutter.addEventListener('dblclick', () => {
    document.documentElement.style.removeProperty(cssVar);
    Layout.forget(cssVar);
    Stage.fit();
    TL.draw();
  });
}
vSplit($('#gutterL'), $('#poolPane'), '--pool', 140, 460);
vSplit($('#gutterR'), $('#monitor'), '--mon', 320, 1500);

draggable($('#hGutter'), {
  start: () => ({ restore: cursorDuring('row-resize') }),
  move: e => {
    const h = clamp(Math.round(innerHeight - e.clientY), 140, Math.round(innerHeight * 0.75));
    document.documentElement.style.setProperty('--h-timeline', h + 'px');
    TL.draw();
  },
  end: (e, c) => {
    c.restore();
    Layout.remember('--h-timeline', getComputedStyle(document.documentElement)
      .getPropertyValue('--h-timeline').trim());
  }
});
$('#hGutter').addEventListener('dblclick', () => {
  document.documentElement.style.removeProperty('--h-timeline');
  Layout.forget('--h-timeline');
  TL.draw();
});

/* With many tracks the timeline scrolls, and the track labels live in a
   separate column that has no scrollbar of its own. */
$('#tlBody').addEventListener('scroll', () => {
  const rows = $('#tlHeadRows');
  if (rows) rows.style.transform = `translateY(${-$('#tlBody').scrollTop}px)`;
});

addEventListener('resize', () => TL.draw());   /* the stage watches its own pane */

/* -------------------------------------------------------------------- live -- */
new EventSource('/api/events').onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.type !== 'changed') return;
  $('#live').classList.add('hit');
  setTimeout(() => $('#live').classList.remove('hit'), 400);
  const open = Editor.openClip();
  if (open && m.file.endsWith(open.src.split('/').pop())) {
    Stage.reloadClip(open.id);
    Stage.invalidate();
  }
};

/* -------------------------------------------------------------------- boot -- */
(async function boot() {
  const first = await listProjects();
  if (first) await loadProject(first);
  else { Stage.fit(); TL.draw(); }
})();
