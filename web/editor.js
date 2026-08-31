/* ============================================================================
   THE CODE PANE.

   A code clip's file is the BODY of __render and nothing else — the shell
   (stage, runtime, render wrapper, __ready) is added by the server when the
   clip is served. So what you see in this pane is only what you wrote, and
   line numbers here are the line numbers in the error messages.

   Owns: the editor, loading and writing a clip's source, and the preset menu.
   Publishes: onApplied(clip, duration) so the timeline can follow a changed
   duration without this module knowing what a timeline is.
   ========================================================================== */
import { S, $, markSaved } from './state.js';
import { PRESETS } from './presets.js';
import { SIGNATURES } from './signatures.js';
import * as Curve from './curve.js';
import * as Path from './pathedit.js';
import * as Help from './help.js';

const IDLE_MS = 700;

let cm = null;
let clip = null;                 /* the clip whose source is open */
let loading = false;             /* open() in flight — the pane is not yours yet */
let idle = null;
let userPresets = [];
let onApplied = () => {};

export function init(handlers = {}) {
  onApplied = handlers.onApplied || onApplied;
  if (typeof CodeMirror !== 'undefined') {
    cm = CodeMirror.fromTextArea($('#code'), {
      mode: 'javascript', theme: 'material-darker', lineNumbers: true,
      gutters: ['errors', 'CodeMirror-linenumbers'],
      indentUnit: 2, tabSize: 2, matchBrackets: true, autoCloseBrackets: true,
      styleActiveLine: true,
      /* drawn by CodeMirror, not by the OS — see index.html */
      scrollbarStyle: 'simple',
      extraKeys: {
        'Ctrl-S': apply, 'Cmd-S': apply,
        'Ctrl-=': () => zoom(1), 'Ctrl--': () => zoom(-1), 'Ctrl-0': () => zoom(0),
        'Cmd-=':  () => zoom(1), 'Cmd--':  () => zoom(-1), 'Cmd-0':  () => zoom(0)
      }
    });
    cm.on('change', () => { clearTimeout(idle); idle = setTimeout(apply, IDLE_MS); });
    cm.on('blur', apply);          /* clicking away is finishing a thought */
    cm.on('cursorActivity', showSignature);
    cm.on('cursorActivity', syncPanels);
    Curve.init({ onChange: writeCurve });
    Path.init({ onChange: writePath });
    applyZoom();
  }
  initPresets();
  initLib();
  initPickers();
  initZoom();
  addEventListener('visibilitychange', () => { if (document.hidden) apply(); });
  addEventListener('pagehide', apply);
}

const value = () => (cm ? cm.getValue() : $('#code').value);
const setValue = v => { if (cm) cm.setValue(v); else $('#code').value = v; };

/* ---------------------------------------------------------------- errors -- */
/* A missing comma should never read as "the clip did not finish loading".
   It should read the way a code editor reads it: the line goes red, the exact
   character gets a squiggle, and the message says what to do about it. */
let marks = [];

function clearMarks() {
  marks.forEach(m => m.clear());
  marks = [];
  if (!cm) return;
  cm.eachLine(h => {
    cm.removeLineClass(h, 'background', 'errLine');
    cm.removeLineClass(h, 'gutter', 'errGutter');
  });
  cm.clearGutter('errors');
}

/* Turn the engine's wording into something worth reading. Chrome tells you
   what it choked ON; what you want to know is what is MISSING, which is
   almost always on the line before the one it names. */
function explain(raw, line, col) {
  const text = String(raw).replace(/^Uncaught\s+/, '');
  const prev = (cm && line > 1 ? cm.getLine(line - 2) : '') || '';
  const here = (cm ? cm.getLine(line - 1) : '') || '';

  if (/Unexpected identifier|Unexpected string|Unexpected number/.test(text)) {
    if (/[^,{([\s]$/.test(prev.replace(/\/\/.*$/, '').trimEnd()))
      return `${text} — looks like a missing comma at the end of line ${line - 1}.`;
    return `${text} — a comma or an operator is probably missing just before it.`;
  }
  if (/Unexpected end of input/.test(text)) {
    const open = count(here || '', '({[') - count(here || '', ')}]');
    return `Unexpected end of input — a bracket is never closed`
         + (open > 0 ? `, ${open} still open on this line.` : ' somewhere above.');
  }
  if (/Unexpected token '\}'|Unexpected token '\)'/.test(text))
    return `${text} — either an extra comma before it, or a missing value after the last :`;
  if (/Invalid or unexpected token/.test(text))
    return `${text} — usually a quote that is never closed, or a smart quote pasted in.`;
  if (/Unexpected token ':'/.test(text))
    return `${text} — { } is needed around a list of name: value options.`;

  const undef = /^(?:ReferenceError: )?(\w+) is not defined/.exec(text);
  if (undef) {
    const near = closest(undef[1]);
    return `${undef[1]} is not defined`
         + (near ? ` — did you mean ${near}?` : ' — check the spelling.');
  }
  const nofn = /(\w+) is not a function/.exec(text);
  if (nofn) {
    const near = closest(nofn[1]);
    return `${nofn[1]} is not a function`
         + (near ? ` — did you mean ${near}?` : '.');
  }
  if (/Cannot read propert/.test(text))
    return `${text} — something that should be an element or an object is missing.`;
  return text;
}

const count = (s, set) => [...s].filter(c => set.includes(c)).length;

/* Nearest known name, by edit distance. "lien" -> "line" is the single most
   common thing that goes wrong and it should not cost you a minute. */
function closest(word) {
  const names = Object.keys(SIGNATURES);
  let best = null, score = 99;
  for (const n of names) {
    const d = distance(word.toLowerCase(), n.toLowerCase());
    if (d < score) { score = d; best = n; }
  }
  /* One mistake in a short name, two in a long one. Looser than that and it
     starts offering "wipe" for "nope", which is worse than saying nothing. */
  return score <= (word.length > 4 ? 2 : 1) ? best : null;
}

/* Damerau, not plain Levenshtein: two letters swapped is ONE mistake, and
   "lien" for "line" is the single most common typo there is. Plain edit
   distance scores that as 2 and would refuse to suggest anything. */
function distance(a, b) {
  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

export function showError(msg, where) {
  clearMarks();
  const strip = $('#codeErr');
  if (!msg) { strip.textContent = ''; strip.classList.add('hidden'); return; }

  /* the line the engine named, or the one already in the message */
  let line = where && where.line, col = (where && where.col) || 0;
  if (!line) { const m = /^line (\d+):/.exec(msg); if (m) line = Number(m[1]); }
  const body = msg.replace(/^line \d+:\s*/, '');
  const total = cm ? cm.lineCount() : 0;
  if (line > total) line = total;              /* the shell's own tail */

  const said = line ? explain(body, line, col) : body;
  strip.textContent = line ? `line ${line} — ${said}` : said;
  strip.classList.remove('hidden');
  strip.onclick = () => {
    if (!line || !cm) return;
    cm.setCursor({ line: line - 1, ch: Math.max(0, col - 1) });
    cm.focus();
  };

  if (!cm || !line || line < 1 || line > total) return;
  const i = line - 1;
  const handle = cm.getLineHandle(i);
  cm.addLineClass(handle, 'background', 'errLine');
  cm.addLineClass(handle, 'gutter', 'errGutter');

  const dot = document.createElement('span');
  dot.className = 'errDot';
  dot.title = said;
  dot.textContent = '\u25cf';
  cm.setGutterMarker(i, 'errors', dot);

  /* the squiggle: the token at the column, or the whole line if we have none */
  const src = cm.getLine(i) || '';
  let from = Math.max(0, Math.min(col ? col - 1 : 0, src.length - 1));
  let to = from + 1;
  if (col) {
    while (from > 0 && /[\w$.]/.test(src[from - 1])) from--;
    while (to < src.length && /[\w$.]/.test(src[to])) to++;
  } else {
    from = src.length - src.trimStart().length;
    to = src.trimEnd().length;
  }
  if (to > from)
    marks.push(cm.markText({ line: i, ch: from }, { line: i, ch: to },
                           { className: 'errTok', title: said }));
}
/* ------------------------------------------------------------------ lib --
   A project's shared code is edited here, like everything else.

   The endpoints for it existed before this did, which meant the one place you
   were told to write a reusable move was also the one place you had to leave
   the editor to reach. A tool that sends you to a text editor to use its own
   best feature has not shipped that feature.

   A lib file is not on the timeline and has no duration — it is a library, not
   a shot — so it is opened as a clip-shaped thing whose id belongs to no clip.
   Everything downstream of that already copes: applyDuration finds no clip and
   does nothing, and reloadClip finds no layer and does nothing. */
async function initLib() {
  const sel = $('#pickLib');
  if (!sel) return;
  await refreshLib();
  sel.addEventListener('change', async () => {
    const v = sel.value;
    sel.selectedIndex = 0;
    if (!v) return;
    if (v === '__new') {
      const name = prompt('Name for the shared file', 'shared');
      if (!name) return;
      const r = await api('/api/lib/new', 'POST', { name: S.name, file: name });
      if (!r || !r.ok) return showError(r && r.why ? r.why : 'could not make it');
      await refreshLib();
      return open({ id: 'lib:' + r.src, kind: 'code', src: r.src });
    }
    open({ id: 'lib:' + v, kind: 'code', src: v });
  });
}

export async function refreshLib() {
  const sel = $('#pickLib');
  if (!sel || !S.name) return;
  let files = [];
  try {
    const r = await api('/api/lib?name=' + enc(S.name));
    files = (r && r.files) || [];
  } catch {}
  sel.innerHTML = '<option value="">shared…</option>'
    + (files.length
        ? `<optgroup label="loaded into every clip">${files.map(f =>
            `<option value="${esc(f.src)}">${esc(f.name)}</option>`).join('')}</optgroup>`
        : '')
    + '<option value="__new">new shared file…</option>';
}

export const openClip = () => clip;

/* A note is not an error. The clip runs; this is the tool saying that what you
   wrote will not do what you appear to have meant, which is the case an error
   message never covers and silence covers worst of all. Amber, below the code,
   and it never displaces a real error. */
export function showNote(msg) {
  const strip = $('#codeNote');
  if (!strip) return;
  strip.textContent = msg || '';
  strip.classList.toggle('hidden', !msg);
}

/* Put text in as whole lines, indented to match where the cursor is. Used by
   the reference: clicking an example lands it in the code rather than making
   you retype it.

   Whole lines, never mid-line, because an example is a statement. Dropping
   one into the middle of an existing line only ever produces a syntax error. */
export function insertAtCursor(text) {
  if (!cm || !text) return;
  cm.focus();
  const cur = cm.getCursor();
  const here = cm.getLine(cur.line) || '';
  const pad = (here.match(/^\s*/) || [''])[0];
  const body = String(text).split('\n')
    .map(l => (l ? pad + l : '')).join('\n');

  /* an empty line is replaced; a line with code on it is inserted after */
  const blank = !here.trim();
  const from = blank ? { line: cur.line, ch: 0 } : { line: cur.line, ch: here.length };
  const to = blank ? { line: cur.line, ch: here.length } : from;
  cm.replaceRange(blank ? body : '\n' + body, from, to);
  cm.setCursor({ line: cur.line + body.split('\n').length - (blank ? 1 : 0), ch: 0 });
  apply();
}

/* The clip is gone. Drop it WITHOUT writing — a pending idle save or a blur
   would otherwise put the file straight back on disk after it was deleted. */
export function forget(id) {
  if (!clip || clip.id !== id) return;
  clearTimeout(idle);
  clip = null;
  loading = false;
  showError('');
  showNote('');
  setValue('');
  $('#codeName').textContent = 'no clip selected — click one on the timeline';
  $('#presets').disabled = true;
  $('#btnSaveMove').disabled = true;
  $('#pickShape').disabled = true;
  $('#codePane').classList.add('locked');
  if (cm) cm.setOption('readOnly', true);
}

/* ------------------------------------------------------------------ open -- */
export async function open(next) {
  await apply();
  loading = true;                                   /* never lose the last edit */
  clip = next;
  showError('');
  const editable = !!next && next.kind === 'code';
  const shared = !!next && /^lib\//.test(next.src || '');
  $('#codeName').textContent = editable
    ? (shared ? next.src + '  ·  every clip can call this'
              : next.src.replace(/^clips\//, ''))
    : next ? `${next.kind} clip — nothing to write`
    : 'no clip selected — click one on the timeline';
  $('#presets').disabled = !editable;
  $('#btnSaveMove').disabled = !editable;
  $('#pickShape').disabled = !editable;
  /* Locked until the source is actually in the pane. Unlocking first means you
     can type into a document that is about to be replaced by the fetch landing
     — the keystrokes go in and vanish, which looks exactly like a keyboard
     that does not work. A read-only pane must also LOOK read-only. */
  $('#codePane').classList.add('locked');
  if (cm) cm.setOption('readOnly', true);

  if (!editable) { loading = false; return setValue(''); }

  const r = await api(`/api/source?name=${enc(S.name)}&src=${enc(next.src)}`);
  /* another open() may have started while this fetch was in the air — that one
     owns the pane now, so drop this result rather than stamping it over theirs */
  if (clip !== next) return;
  setValue(r.ok ? r.src : '');
  loading = false;
  $('#codePane').classList.remove('locked');
  if (cm) { cm.setOption('readOnly', false); cm.refresh(); }
}

/* ----------------------------------------------------------------- apply --
   Write the file, then reload the clip. The duration a clip declares is the
   only copy of that number, so it is read back out and published. */
export async function apply() {
  clearTimeout(idle);
  if (!clip || clip.kind !== 'code') return;
  /* Between choosing a clip and its source arriving, the pane still holds the
     last clip's text. Writing then would stamp one clip's code over another —
     which is how an empty file appears in a project. */
  if (loading) return;
  const text = value();
  markSaved(false);
  const r = await api('/api/source', 'PUT', { name: S.name, src: clip.src, text });
  markSaved(true);
  if (!r.ok) return showError(r.why);
  showError('');
  onApplied(clip, declaredDuration(text));
}

/* `duration(2200)` in the new format, `__duration = 2200` in the old one. */
export function declaredDuration(text) {
  const m = text.match(/\bduration\s*\(\s*(\d+(?:\.\d+)?)/)
         || text.match(/__duration\s*=\s*(\d+(?:\.\d+)?)/);
  return m ? Math.round(Number(m[1])) : null;
}

/* --------------------------------------------------------------- presets -- */
function initPresets() {
  const sel = $('#presets');
  sel.onchange = () => { insert(pick(sel.value)); sel.value = ''; };
  $('#btnSaveMove').onclick = saveMove;
  refreshPresets();
}
const pick = key => key.startsWith('u') ? userPresets[+key.slice(1)] : PRESETS[+key.slice(1)];

async function refreshPresets() {
  const r = await api('/api/presets').catch(() => ({}));
  userPresets = r.presets || [];
  const option = (p, key) => `<option value="${key}" title="${esc(p.note || '')}">${esc(p.name)}</option>`;
  $('#presets').innerHTML = '<option value="">insert a move…</option>'
    + PRESETS.map((p, i) => option(p, 'b' + i)).join('')
    + (userPresets.length
        ? `<optgroup label="your moves">${userPresets.map((p, i) => option(p, 'u' + i)).join('')}</optgroup>`
        : '');
}

function insert(preset) {
  if (!preset || !clip || clip.kind !== 'code') return;
  if (cm) {
    const at = cm.getCursor();
    cm.replaceRange('\n' + preset.code + '\n', { line: at.line, ch: 0 });
    cm.focus();
  } else {
    $('#code').value += '\n' + preset.code + '\n';
  }
  apply();
}

/* Selection, or the whole file if nothing is selected. A move you invented is
   worth having in the next video, so the store is studio-wide. */
async function saveMove() {
  if (!clip || clip.kind !== 'code') return;
  const code = (cm && cm.getSelection()) || value();
  if (!code.trim()) return alert('Write something first, or select the lines to keep.');
  const name = prompt('Name this move');
  if (!name) return;
  const r = await api('/api/presets', 'POST', { name, note: 'yours', code });
  if (!r.ok) return alert(r.why);
  userPresets = r.presets;
  refreshPresets();
}

/* ---------------------------------------------------------------- helpers -- */
const enc = encodeURIComponent;
const esc = s => String(s).replace(/[<>&"]/g, c =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
async function api(url, method = 'GET', body) {
  const opt = { method };
  if (body !== undefined) {
    opt.headers = { 'content-type': 'application/json' };
    opt.body = JSON.stringify(body);
  }
  return (await fetch(url, opt)).json();
}


/* ------------------------------------------------------------------- zoom --
   The code pane has its own text size, independent of the rest of the app,
   and it is remembered — it is the surface you stare at. */
const ZOOM_KEY = 'studio.codeZoom';
let zoomPt = Number(localStorage.getItem(ZOOM_KEY) || 12.5);
function applyZoom() {
  document.documentElement.style.setProperty('--codeSize', zoomPt + 'px');
  if (cm) cm.refresh();
}
function zoom(dir) {
  zoomPt = dir === 0 ? 12.5 : Math.max(9, Math.min(28, zoomPt + dir));
  try { localStorage.setItem(ZOOM_KEY, String(zoomPt)); } catch {}
  applyZoom();
}

/* Buttons, because a shortcut nobody told you about is not a feature, and
   Ctrl+wheel because that is what the hand reaches for. */
function initZoom() {
  const inb = $('#zoomIn'), out = $('#zoomOut');
  if (inb) inb.onclick = () => zoom(1);
  if (out) out.onclick = () => zoom(-1);
  const pane = $('#codePane');
  if (pane) pane.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
}

/* -------------------------------------------------------------- signature --
   What the call under the cursor wants next. Scans back from the cursor for an
   unclosed bracket, takes the name in front of it, and counts the commas at
   depth 1 to know which argument you are on. Strings and nested calls are
   skipped so a comma inside them does not advance the highlight. */
/* Which parameter names to show. A chained .enter(ms, how) and motion.js's
   enter(element, t, atMs, options) are different functions that happen to
   share a name, so the dot decides. Built from the reference, once. */
let sceneSigs = null;
function paramsFor(name, dotted) {
  if (!sceneSigs) { try { sceneSigs = Help.signatures(); } catch { sceneSigs = null; } }
  if (sceneSigs) {
    const hit = dotted ? sceneSigs.dotted[name] : sceneSigs.plain[name];
    if (hit) return hit;
  }
  return dotted ? null : SIGNATURES[name] || null;
}

function showSignature() {
  const bar = $('#sig');
  if (!bar || !cm) return;
  const cur = cm.getCursor();
  const line = cm.getLine(cur.line) || '';
  const info = callAt(line, cur.ch);
  const args = info && paramsFor(info.name, info.dotted);
  if (!args) return bar.classList.add('hidden');
  bar.classList.remove('hidden');
  bar.innerHTML = `<b>${info.dotted ? '.' : ''}${info.name}</b>(`
    + args.map((a, i) => i === info.arg ? `<span class="now">${a}</span>` : a).join(', ')
    + ')' + (args.length <= info.arg ? '<span class="note">extra argument</span>' : '');
}

export function callAt(line, ch) {
  let depth = 0, commas = 0, quote = null;
  for (let i = ch - 1; i >= 0; i--) {
    const c = line[i];
    if (quote) { if (c === quote && line[i - 1] !== '\\') quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === ')' || c === ']' || c === '}') depth++;
    else if (c === '(') {
      if (depth === 0) {
        const before = line.slice(0, i).match(/(\.?)([A-Za-z_$][\w$]*)\s*$/);
        return before ? { name: before[2], dotted: !!before[1], arg: commas } : null;
      }
      depth--;
    } else if (c === ',' && depth === 0) commas++;
  }
  return null;
}

/* ---------------------------------------------------------------- pickers --
   A colour and a font are things you choose by looking, not by typing a hex
   from memory. Both write into the code — the file stays the source of truth
   and what they wrote is right there to keep editing. */
function initPickers() {
  const colour = $('#pickColour'), font = $('#pickFont'), shape = $('#pickShape');
  if (shape) shape.onclick = newShape;
  if (colour) {
    colour.addEventListener('input', () => replaceColour(colour.value));
    if (cm) cm.on('cursorActivity', () => {
      const hex = hexNearCursor();
      if (hex) colour.value = hex;
    });
  }
  if (font) {
    font.addEventListener('change', () => { insertFont(font.value); font.selectedIndex = 0; });
    loadFonts();
  }
}

async function loadFonts() {
  const sel = $('#pickFont');
  if (!sel) return;
  let r = { project: [], system: [] };
  try { r = await api('/api/fonts?name=' + enc(S.name || '')); } catch {}
  const opt = f => `<option value="${esc(f.family)}">${esc(f.family)}</option>`;
  sel.innerHTML = '<option value="">font…</option>'
    + (r.project.length
        ? `<optgroup label="in this project (always render)">${r.project.map(opt).join('')}</optgroup>` : '')
    + `<optgroup label="installed on this machine">${(r.system || []).map(opt).join('')}</optgroup>`;
}
export const refreshFonts = loadFonts;

function hexNearCursor() {
  if (!cm) return null;
  const cur = cm.getCursor(), line = cm.getLine(cur.line) || '';
  for (const m of line.matchAll(/#[0-9a-fA-F]{6}\b/g))
    if (cur.ch >= m.index - 1 && cur.ch <= m.index + m[0].length + 1) return m[0];
  return null;
}

/* A colour under the cursor is replaced; failing that, the one colour in this
   statement is, wherever in the chain it sits; failing that the hex is simply
   typed in. Same rule as the font picker: never answer a click with an
   instruction. */
function replaceColour(hex) {
  if (!cm || !clip) return;
  const cur = cm.getCursor();
  const put = (ln, m) => {
    cm.replaceRange(hex, { line: ln, ch: m.index },
                          { line: ln, ch: m.index + m[0].length });
    clearTimeout(idle); idle = setTimeout(apply, 250);
  };

  for (const m of (cm.getLine(cur.line) || '').matchAll(/#[0-9a-fA-F]{6}\b/g))
    if (cur.ch >= m.index - 1 && cur.ch <= m.index + m[0].length + 1) return put(cur.line, m);

  const stmt = statementAround(cur.line);
  for (let ln = stmt.from; ln <= stmt.to; ln++) {
    const m = (cm.getLine(ln) || '').match(/#[0-9a-fA-F]{6}\b/);
    if (m) return put(ln, m);
  }

  cm.replaceSelection(`'${hex}'`);
  clearTimeout(idle); idle = setTimeout(apply, 250);
}

/* The whole statement the cursor is in, not just its line. A scene chain is
   spread over as many lines as it has methods, so "where am I" has to mean the
   statement, or picking a font would depend on which line of the chain you
   happened to be sitting on. */
function statementAround(line) {
  const last = cm.lineCount() - 1;
  const done = n => /;\s*(\/\/.*)?$/.test(cm.getLine(n) || '');
  const blank = n => !(cm.getLine(n) || '').trim();
  let from = line;
  while (from > 0 && !done(from - 1) && !blank(from - 1)) from--;
  let to = line;
  while (to < last && !done(to) && !blank(to)) to++;
  return { from, to };
}

/* Picking a font should work wherever you are in the thing you are styling,
   and should never come back with an instruction instead of a font. Five
   cases, tried in order, and the last one always succeeds. */
async function insertFont(family) {
  if (!cm || !clip || !family) return;
  /* A font only reliably renders — and only travels with the project — once
     the project carries the file. Picking one copies it in. */
  const r = await api('/api/font/embed', 'POST', { name: S.name, family });
  if (r && r.ok) refreshFonts();

  const cur = cm.getCursor();
  const stmt = statementAround(cur.line);
  const swap = (ln, m, text) => {
    cm.replaceRange(text, { line: ln, ch: m.index },
                          { line: ln, ch: m.index + m[0].length });
    cm.focus();
    clearTimeout(idle); idle = setTimeout(apply, 250);
  };

  /* 1. a .font('Old') or .font('Old', 268) already here — swap the family and
        keep the size, which is the common case once a clip is under way */
  for (let ln = stmt.from; ln <= stmt.to; ln++) {
    const m = (cm.getLine(ln) || '').match(/\.font\(\s*'[^']*'/);
    if (m) return swap(ln, m, `.font('${family}'`);
  }

  /* 2. the same thing written as an option: font: 'Old' */
  for (let ln = stmt.from; ln <= stmt.to; ln++) {
    const m = (cm.getLine(ln) || '').match(/font:\s*'[^']*'/);
    if (m) return swap(ln, m, `font: '${family}'`);
  }

  /* 3. a scene chain with no font yet — add one as its own line, indented to
        match the methods around it */
  let chain = '';
  for (let ln = stmt.from; ln <= stmt.to; ln++) chain += (cm.getLine(ln) || '') + '\n';
  if (/\b(text|group|items|image|shape)\s*\(/.test(chain)) {
    const after = cm.getLine(cur.line) || '';
    const next = cm.getLine(cur.line + 1) || '';
    const dotted = /^(\s*)\./.exec(next) || /^(\s*)\./.exec(after);
    const pad = dotted ? dotted[1] : (after.match(/^\s*/) || [''])[0] + '  ';
    cm.replaceRange(`\n${pad}.font('${family}')`,
                    { line: cur.line, ch: after.length });
    cm.focus();
    clearTimeout(idle); idle = setTimeout(apply, 250);
    return;
  }

  /* 4. an options object: this line's `{`, else a few lines up */
  let ln = cur.line, at = -1;
  for (let i = 0; i < 6 && ln - i >= 0; i++) {
    const l = cm.getLine(ln - i) || '';
    const brace = l.lastIndexOf('{');
    if (brace >= 0) { ln = ln - i; at = brace + 1; break; }
  }
  if (at >= 0) {
    const rest = (cm.getLine(ln) || '').slice(at);
    const sep = rest.trim().startsWith('}') || rest.trim() === '' ? '' : ' ';
    cm.replaceRange(` font: '${family}',${sep}`, { line: ln, ch: at }, { line: ln, ch: at });
    cm.focus();
    clearTimeout(idle); idle = setTimeout(apply, 250);
    return;
  }

  /* 5. nowhere obvious to put it. Give the name, quoted and spelled exactly —
        the reason to reach for this picker is that the name is fiddly, and
        refusing to hand it over helps nobody. */
  cm.replaceSelection(`'${family}'`);
  cm.focus();
  clearTimeout(idle); idle = setTimeout(apply, 250);
}


/* ---------------------------------------------------------------- curve --
   Put the cursor inside a bezier(...) and the editor opens on those numbers;
   dragging rewrites them in place. */
let curveSpot = null;               /* {line, from, to} of what we are editing */

/* Where the cursor is, and what curve that means. Four cases, because all
   four are moments you want the editor:

     bezier(.3, 1.5, .6, 1)      edit those two handles
     bezier()                    empty — open on a default and fill it in
     curve([[0,0],[.5,1.2],...]) edit the points
     overshoot                   a named easing: show its shape, and dragging
                                 turns it into an explicit bezier(...)       */
function curveAt(line, ch) {
  /* Two spans matter: the WHOLE call, and just its arguments. Staying in the
     same kind rewrites the arguments; switching kind rewrites the whole call —
     replacing only the arguments is how you end up with bezier(curve([...])). */
  for (const m of line.matchAll(/curve\s*\(\s*\[[\s\S]*?\]\s*\)/g)) {
    const outerTo = m.index + m[0].length;
    if (ch < m.index || ch > outerTo) continue;
    const pts = [...m[0].matchAll(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)]
      .map(q => [Number(q[1]), Number(q[2])]);
    if (pts.length < 2) continue;
    return { kind: 'curve', points: pts,
             outerFrom: m.index, outerTo,
             innerFrom: m.index + m[0].indexOf('['),
             innerTo: m.index + m[0].lastIndexOf(']') + 1 };
  }
  for (const m of line.matchAll(/bezier\s*\(([^)]*)\)/g)) {
    const outerTo = m.index + m[0].length;
    if (ch < m.index || ch > outerTo) continue;
    const raw = m[1].trim();
    const nums = raw ? raw.split(',').map(v => Number(v.trim())) : [];
    const ok = nums.length === 4 && nums.every(n => Number.isFinite(n));
    return { kind: 'bezier', fill: !ok,
             values: ok ? nums : Curve.NAMED.overshoot.slice(),
             outerFrom: m.index, outerTo,
             innerFrom: m.index + m[0].indexOf('(') + 1,
             innerTo: outerTo - 1 };
  }
  for (const m of line.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    if (!Curve.NAMED[m[1]]) continue;
    const to = m.index + m[0].length;
    if (ch >= m.index && ch <= to)
      return { kind: 'named', values: Curve.NAMED[m[1]].slice(),
               outerFrom: m.index, outerTo: to, innerFrom: m.index, innerTo: to };
  }
  return null;
}

/* How long the change this easing sits inside actually runs. Watching a 340ms
   move at 340ms is the question you are actually asking; a generic one second
   is not. Returns null when it is not inside one. */
function enclosingSpan(line, at) {
  const calls = /\b(change|go|tween|fadeIn|fadeOut|on|off)\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g;
  let best = null;
  for (const m of line.matchAll(calls)) {
    if (m.index > at) continue;             /* opens after us: not ours */
    const a = Number(m[2]), b = Number(m[3]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    best = Math.round(b - a);                /* the innermost one that opened before */
  }
  return best;
}

function syncCurve() {
  if (!cm) return;
  if (Curve.isDragging()) return;        /* the drag owns the range until it lets go */
  const cur = cm.getCursor();
  const found = curveAt(cm.getLine(cur.line) || '', cur.ch);
  if (!found) { curveSpot = null; return Curve.hide(); }
  curveSpot = { line: cur.line, ...found };
  const ms = enclosingSpan(cm.getLine(cur.line) || '', found.outerFrom);
  Curve.show(found.kind === 'curve'
    ? { points: found.points, ms }
    : { values: found.values, ms });
  /* an empty bezier() gets its default written in, so what the panel shows and
     what the clip runs are the same thing from the first frame */
  if (found.fill) writeCurve({ mode: 'bezier', values: found.values });
}

/* The panel hands back whichever shape it is editing; this turns that into the
   exact text the code should now read, and remembers the new spans. */
function writeCurve(out) {
  if (!cm || !curveSpot) return;
  const same = out.mode === curveSpot.kind;
  const inner = out.mode === 'curve'
    ? '[' + out.points.map(q => `[${q[0]}, ${q[1]}]`).join(', ') + ']'
    : out.values.join(', ');
  const call = out.mode === 'curve' ? `curve(${inner})` : `bezier(${inner})`;

  const from = same ? curveSpot.innerFrom : curveSpot.outerFrom;
  const to   = same ? curveSpot.innerTo   : curveSpot.outerTo;
  const text = same ? inner : call;

  cm.replaceRange(text, { line: curveSpot.line, ch: from },
                         { line: curveSpot.line, ch: to });

  curveSpot.kind = out.mode;
  curveSpot.outerFrom = same ? curveSpot.outerFrom : from;
  curveSpot.innerFrom = curveSpot.outerFrom + (out.mode === 'curve' ? 6 : 7);
  curveSpot.innerTo   = curveSpot.innerFrom + inner.length;
  curveSpot.outerTo   = curveSpot.innerTo + 1;

  clearTimeout(idle);
  idle = setTimeout(apply, 200);
}


/* ---------------------------------------------------------------- shapes --
   Put the cursor inside a path([[x, y], ...]) and the shape editor opens on
   those points; dragging one rewrites them in place. A raw('M...') opens too,
   sampled into points, and editing it converts the call — which is why two
   spans are tracked here, exactly as they are for curves. */
let pathSpot = null;

/* One handler, because the two panels share one cursor: a path() call is not
   an easing, and only one of them should answer for where you are. */
function syncPanels() {
  if (syncPath()) return Curve.hide();
  syncCurve();
}

/* Bracket matching rather than a regex, because a shape is the one call in a
   clip that is routinely spread over several lines and full of nested
   brackets, and a lazy [\s\S]*? gives up on the first ) inside a string. */
function matchClose(text, i) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const open = text[i], close = pairs[open];
  if (!close) return -1;
  let depth = 0, quote = null;
  for (let k = i; k < text.length; k++) {
    const c = text[k];
    if (quote) {
      if (c === '\\') k++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return k;
  }
  return -1;
}

/* The first { that is not inside anything else — the options object, rather
   than a brace that happens to sit inside the first argument. */
function topLevelBrace(text) {
  let depth = 0, quote = null;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (quote) {
      if (c === '\\') k++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '{' && depth === 0) return k;
  }
  return -1;
}

function splitTop(body) {
  const out = [];
  let depth = 0, quote = null, start = 0;
  for (let k = 0; k <= body.length; k++) {
    if (k === body.length) { out.push(body.slice(start, k)); break; }
    const c = body[k];
    if (quote) {
      if (c === '\\') k++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if ('(['.includes(c) || c === '{') depth++;
    else if (')]'.includes(c) || c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(body.slice(start, k)); start = k + 1; }
  }
  return out.map(s => s.trim()).filter(Boolean);
}

const OWNED = ['smooth', 'closed', 'color', 'width', 'fill'];

function asLiteral(src) {
  const s = src.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  const q = /^(['"`])([\s\S]*)\1$/.exec(s);
  if (q) return q[2];
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/* The options object, as an ordered list of key and SOURCE TEXT — not values.
   That is what stops dragging a point from quietly deleting a glow, a dash or
   a colour written as an expression: the panel rewrites the five options it
   has controls for and hands every other one back exactly as it was typed. */
function readOptions(inner) {
  const at = topLevelBrace(inner);
  const close = at < 0 ? -1 : matchClose(inner, at);
  if (close < 0) return { known: {}, entries: null, opaque: [] };
  const entries = [], known = {}, opaque = [];
  for (const part of splitTop(inner.slice(at + 1, close))) {
    const m = /^([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*:\s*([\s\S]+)$/.exec(part);
    if (!m) { entries.push([null, part]); continue; }
    const key = m[1].replace(/^['"]|['"]$/g, '');
    entries.push([key, m[2].trim()]);
    if (!OWNED.includes(key)) continue;
    const v = asLiteral(m[2]);
    if (v === undefined) opaque.push(key);       /* an expression: not ours to rewrite */
    else known[key] = v;
  }
  return { known, entries, opaque };
}

/* Where the cursor is, and what shape that means. The whole call and its
   arguments are both remembered: staying a path() rewrites the arguments,
   turning a raw() into one rewrites the whole call, and replacing only the
   arguments in that second case is how you end up with raw(path([...])). */
function pathAt(text, at) {
  let hit = null;
  for (const m of text.matchAll(/\b(path|raw)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(text, open);
    if (close < 0 || at < m.index || at > close + 1) continue;
    hit = { name: m[1], outerFrom: m.index, outerTo: close + 1,
            innerFrom: open + 1, innerTo: close };
  }
  if (!hit) return null;

  const inner = text.slice(hit.innerFrom, hit.innerTo);
  const o = readOptions(inner);
  const spot = { kind: hit.name === 'raw' ? 'raw' : 'path',
                 outerFrom: hit.outerFrom, outerTo: hit.outerTo,
                 innerFrom: hit.innerFrom, innerTo: hit.innerTo,
                 optSrc: o.entries, opaque: o.opaque };

  if (hit.name === 'raw') {
    const q = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/.exec(inner);
    if (!q) return null;                     /* data built at runtime is not ours */
    const d = q[2];
    return { ...spot, d, opts: {
      /* what the data already IS, so opening on it does not change the picture */
      smooth: o.known.smooth !== undefined ? o.known.smooth : /[csqta]/i.test(d),
      closed: o.known.closed !== undefined ? o.known.closed : /z\s*$/i.test(d),
      color: o.known.color, width: o.known.width, fill: o.known.fill } };
  }

  const ob = inner.indexOf('[');
  const brace = topLevelBrace(inner);
  /* Points that come from a variable are not ours to drag — and an array
     inside the options object is not the points list either. */
  if (ob < 0 || (brace >= 0 && ob > brace)) return null;
  const cb = matchClose(inner, ob);
  if (cb < 0) return null;
  const pts = [...inner.slice(ob, cb + 1)
    .matchAll(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)]
    .map(q => [Number(q[1]), Number(q[2])]);
  if (pts.length < 2) return null;
  return { ...spot, points: pts, opts: o.known };
}

/* True when the shape editor has taken the cursor, so the curve editor knows
   to stay out of the way. */
function syncPath() {
  if (!cm) return false;
  if (Path.isDragging()) return true;   /* the drag owns the range until it lets go */
  const found = pathAt(cm.getValue(), cm.indexFromPos(cm.getCursor()));
  if (!found) { pathSpot = null; Path.hide(); return false; }
  pathSpot = found;
  Path.show({ kind: found.kind, points: found.points, d: found.d,
              opts: found.opts, stage: S.stage });
  return true;
}

/* A shape has as many points as it has corners, so long enough to wrap is the
   normal case — and one 300-character line is not code anybody can read. */
function pointsText(points, indent) {
  const each = points.map(p => `[${p[0]}, ${p[1]}]`);
  const one = '[' + each.join(', ') + ']';
  if (indent.length + one.length <= 78) return one;
  const rows = [];
  for (let i = 0; i < each.length; i += 4) rows.push(each.slice(i, i + 4).join(', '));
  return '[' + rows.join(',\n' + indent + ' ') + ']';
}

function optionsText(o, src, opaque) {
  const entries = (src || []).map(e => e.slice());
  const put = (k, v) => {
    if (opaque && opaque.includes(k)) return;    /* written as an expression: leave it */
    const i = entries.findIndex(e => e[0] === k);
    if (v === null) { if (i >= 0) entries.splice(i, 1); return; }
    if (i >= 0) entries[i][1] = v; else entries.push([k, v]);
  };
  put('smooth', o.smooth ? 'true' : null);
  put('closed', o.closed ? 'true' : null);
  put('color', o.color ? `'${o.color}'` : null);
  put('width', o.width == null ? null : String(o.width));
  put('fill', o.fill ? `'${o.fill}'` : null);
  const body = entries.map(([k, v]) => (k === null ? v : `${k}: ${v}`)).join(', ');
  return { text: body ? `{ ${body} }` : '', entries };
}

/* The panel hands back the shape it is editing; this turns that into the exact
   text the code should now read, and remembers the new spans. */
function writePath(out) {
  if (!cm || !pathSpot) return;
  const same = pathSpot.kind === 'path';
  const head = cm.posFromIndex(pathSpot.outerFrom);
  const indent = ((cm.getLine(head.line) || '').match(/^\s*/) || [''])[0] + '  ';

  const o = optionsText(out.opts, pathSpot.optSrc, pathSpot.opaque);
  const inner = pointsText(out.points, indent) + (o.text ? ', ' + o.text : '');
  const text = same ? inner : `path(${inner})`;
  const from = same ? pathSpot.innerFrom : pathSpot.outerFrom;
  const to   = same ? pathSpot.innerTo   : pathSpot.outerTo;

  cm.replaceRange(text, cm.posFromIndex(from), cm.posFromIndex(to));

  if (!same) { pathSpot.kind = 'path'; pathSpot.outerFrom = from; pathSpot.innerFrom = from + 5; }
  pathSpot.innerTo = pathSpot.innerFrom + inner.length;
  pathSpot.outerTo = pathSpot.innerTo + 1;
  pathSpot.optSrc = o.entries;

  clearTimeout(idle);
  idle = setTimeout(apply, 200);
}

/* Never answer a click with an instruction. The button opens the editor on the
   shape at the cursor; when there is not one it writes a starter — in this
   stage's own coordinates, so it lands in the middle of the picture — and
   opens on that. */
function newShape() {
  if (!cm || !clip || clip.kind !== 'code') return;
  cm.focus();
  if (syncPath()) return;

  const w = S.stage.w || 1920, h = S.stage.h || 1080;
  const r = n => Math.round(n / 10) * 10;
  const pts = [[r(w * .28), r(h * .62)], [r(w * .5), r(h * .3)], [r(w * .72), r(h * .62)]];
  const code = `path([${pts.map(p => `[${p[0]}, ${p[1]}]`).join(', ')}], `
             + `{ smooth: true, width: 8, color: '#ffb02e' });`;

  const cur = cm.getCursor();
  const here = cm.getLine(cur.line) || '';
  const pad = (here.match(/^\s*/) || [''])[0];
  const blank = !here.trim();
  if (blank) cm.replaceRange(pad + code, { line: cur.line, ch: 0 },
                                         { line: cur.line, ch: here.length });
  else cm.replaceRange('\n' + pad + code, { line: cur.line, ch: here.length });

  /* land inside the points, which is what opens the panel on them */
  cm.setCursor({ line: blank ? cur.line : cur.line + 1, ch: pad.length + 6 });
  clearTimeout(idle);
  idle = setTimeout(apply, 250);
}
