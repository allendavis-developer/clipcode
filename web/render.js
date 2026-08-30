/* ============================================================================
   The render page's driver.

   It exists so that a render is the preview, frame for frame. It loads the
   project into the same S, and paints with the same stage.js, so there is one
   implementation of "what the picture looks like" rather than two that drift.

   This is where the purity rule is cashed in. Because every clip's __render is
   a pure function of t, a render can jump straight to frame 900 and get
   exactly what playback would have shown at frame 900 — no warm-up, no
   catching up, no accumulated state to replay. A clip that broke the rule
   would look right while scrubbing and wrong here, which is what makes the
   rule worth enforcing.

   Everything is driven from render.mjs through the three globals at the
   bottom. Nothing here runs on a clock of its own.
   ========================================================================== */
import { S, $, allClips, clipEnd, qFrame, qTime } from './state.js';
import * as Stage from './stage.js';

const params = new URLSearchParams(location.search);
const name = params.get('project') || '';

/* ------------------------------------------------------------------ load -- */
const api = (u) => fetch(u).then(r => r.json());

let loaded = false;
let loadError = null;

async function load() {
  try {
    const r = await api('/api/project?name=' + encodeURIComponent(name));
    /* the endpoint answers { ok, project } — the same shape the editor reads */
    const p = r && r.project;
    if (!r || !r.ok || !p) throw new Error((r && r.error) || 'no such project');
    S.name = p.name;
    S.stage = p.stage || S.stage;
    S.media = p.media || [];
    S.tracks = p.tracks || [];

    /* One to one, and deliberately NOT through Stage.fit().

       fit() exists to shrink the stage into whatever pane the editor has room
       for, and it leaves a few pixels of padding while doing it. Here there is
       nothing to fit into: the window IS the stage, and a render that came out
       at 0.99 scale would be resampled for no reason. Compositing is what this
       page reuses from stage.js; fitting is the one part it does not want. */
    const w = S.stage.w, h = S.stage.h;
    $('#viewer').style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;background:#000`;
    $('#stageFit').style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px`;
    $('#stageBox').style.cssText = `width:${w}px;height:${h}px;transform:none`;
    loaded = true;
  } catch (e) {
    loadError = String(e && e.message || e);
  }
}
await load();

/* ---------------------------------------------------------------- errors -- */
/* A clip that throws must fail the render rather than quietly export a black
   frame. Collected here and reported to the driver. */
const problems = [];
Stage.setErrorSink((id, msg) => {
  const line = `${id}: ${msg}`;
  if (!problems.includes(line)) problems.push(line);
});

/* ----------------------------------------------------------------- ready -- */
/* Every code clip in the project has to have loaded before the first frame,
   not just the ones under the playhead: a clip that first appears at 0:20
   would otherwise export as black until it woke up. So visit each one. */
async function warmUp() {
  const clips = allClips();
  for (const c of clips) {
    S.t = c.start + 1;
    Stage.invalidate();
    await Stage.paint(true);
    await settle();
  }
  S.t = 0;
  Stage.invalidate();
  await Stage.paint(true);
}

/* Wait until the composite is actually on screen: fonts loaded, every code
   clip ready, and a frame painted. A render that screenshots before this is
   how you export a video whose first second is a fallback typeface. */
function settle(tries = 200) {
  return new Promise(resolve => {
    let n = 0;
    const check = () => {
      const status = Stage.status();
      const waiting = /loading/.test(status);
      if ((!waiting && n > 1) || ++n > tries) return resolve(!waiting);
      requestAnimationFrame(check);
    };
    check();
  });
}

/* ---------------------------------------------------------------- driven -- */
window.__renderInfo = () => ({
  ok: loaded,
  error: loadError,
  project: S.name,
  w: S.stage.w,
  h: S.stage.h,
  fps: S.stage.fps || 30,
  clips: allClips().length,
  /* the end of the last clip: what the timeline is actually long */
  duration: allClips().reduce((m, c) => Math.max(m, clipEnd(c)), 0),
  problems: problems.slice()
});

window.__renderReady = async () => {
  if (!loaded) return false;
  await document.fonts.ready;
  await warmUp();
  return await settle();
};

/* One frame. Time is quantised the same way the transport quantises it, so
   frame 900 here is the frame the playhead calls 900. */
window.__renderSeek = async (ms) => {
  S.t = qTime(qFrame(ms));
  Stage.invalidate();
  await Stage.paint(true);
  /* two frames: one for the clips to draw, one for the compositor to show it */
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { t: S.t, problems: problems.slice() };
};
