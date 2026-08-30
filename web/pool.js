/* ============================================================================
   THE MEDIA POOL.

   Importing copies the file into the project's own media/ folder. A pool full
   of paths into someone's Downloads is a project that breaks next week; a
   project folder that contains everything is one you can move to another
   drive or another machine and just open.

   Owns: the pool list, importing, and starting a drag. It does not know what
   a timeline is — dropping is the timeline's business, and all this puts on
   the wire is a media id.
   ========================================================================== */
import { S, $, markSaved, mediaById, urlOf } from './state.js';

export const DRAG_TYPE = 'text/studio-media';
let onImported = () => {};

export function init(handlers = {}) {
  onImported = handlers.onImported || onImported;
  const pane = $('#poolPane');
  pane.addEventListener('dragover', e => { e.preventDefault(); pane.classList.add('dropping'); });
  pane.addEventListener('dragleave', () => pane.classList.remove('dropping'));
  pane.addEventListener('drop', e => {
    e.preventDefault();
    pane.classList.remove('dropping');
    upload([...(e.dataTransfer.files || [])]);
  });
  $('#btnImport').onclick = () => $('#filePick').click();
  $('#filePick').onchange = e => { upload([...e.target.files]); e.target.value = ''; };
}

export function draw() {
  const list = $('#pool');
  list.innerHTML = '';
  $('#poolCount').textContent = S.media.length ? `${S.media.length} items` : '';
  for (const m of S.media) list.appendChild(item(m));
}

function item(m) {
  const el = document.createElement('div');
  el.className = 'pitem';
  el.draggable = true;
  el.title = `${m.name}${m.dur ? '  ·  ' + (m.dur / 1000).toFixed(1) + 's' : ''}`;
  el.innerHTML = thumbnail(m)
    + `<div class="meta"><div class="pn">${escape(m.name)}</div>`
    + `<div class="pd">${m.dur ? (m.dur / 1000).toFixed(1) + 's' : m.kind}</div></div>`;
  el.addEventListener('dragstart', ev => {
    ev.dataTransfer.setData(DRAG_TYPE, m.id);
    ev.dataTransfer.effectAllowed = 'copy';
  });
  return el;
}

/* A pool of filenames tells you nothing. Images show themselves; video shows
   a frame from half a second in, which the browser will decode from a media
   fragment without us having to build a thumbnailer. */
function thumbnail(m) {
  const url = urlOf(m.src);
  if (m.kind === 'image') return `<img class="th" src="${url}" loading="lazy" alt="">`;
  if (m.kind === 'video')
    return `<video class="th" src="${url}#t=0.5" preload="metadata" muted playsinline></video>`;
  return `<div class="th thx">${m.kind}</div>`;
}

/* What a dropped media id becomes on the timeline. Kept here because the
   defaults are facts about media, not about timelines. */
export function clipFor(id, start, makeId) {
  const m = mediaById(id);
  if (!m) return null;
  const natural = m.dur || (m.kind === 'image' ? 4000 : 5000);
  return { id: makeId(), kind: m.kind, media: m.id, src: m.src,
           start, in: 0, out: natural, natural };
}

async function upload(files) {
  if (!files.length || !S.name) return;
  markSaved(false);
  for (const f of files) {
    await fetch(`/api/media/upload?name=${encodeURIComponent(S.name)}`
              + `&file=${encodeURIComponent(f.name)}`,
      { method: 'POST', headers: { 'content-type': 'application/octet-stream' },
        body: await f.arrayBuffer() });
  }
  markSaved(true);
  await onImported();
}

const escape = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
