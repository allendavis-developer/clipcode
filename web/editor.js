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
      indentUnit: 2, tabSize: 2, matchBrackets: true, autoCloseBrackets: true,
      styleActiveLine: true,
      extraKeys: {
        'Ctrl-S': apply, 'Cmd-S': apply,
        'Ctrl-=': () => zoom(1), 'Ctrl--': () => zoom(-1), 'Ctrl-0': () => zoom(0),
        'Cmd-=':  () => zoom(1), 'Cmd--':  () => zoom(-1), 'Cmd-0':  () => zoom(0)
      }
    });
    cm.on('change', () => { clearTimeout(idle); idle = setTimeout(apply, IDLE_MS); });
    cm.on('blur', apply);          /* clicking away is finishing a thought */
    cm.on('cursorActivity', showSignature);
    cm.on('cursorActivity', syncCurve);
    Curve.init({ onChange: writeCurve });
    applyZoom();
  }
  initPresets();
  initPickers();
  initZoom();
  addEventListener('visibilitychange', () => { if (document.hidden) apply(); });
  addEventListener('pagehide', apply);
}

const value = () => (cm ? cm.getValue() : $('#code').value);
const setValue = v => { if (cm) cm.setValue(v); else $('#code').value = v; };

export function showError(msg) {
  $('#codeErr').textContent = msg || '';
  $('#codeErr').classList.toggle('hidden', !msg);
}
export const openClip = () => clip;

/* The clip is gone. Drop it WITHOUT writing — a pending idle save or a blur
   would otherwise put the file straight back on disk after it was deleted. */
export function forget(id) {
  if (!clip || clip.id !== id) return;
  clearTimeout(idle);
  clip = null;
  loading = false;
  showError('');
  setValue('');
  $('#codeName').textContent = 'no clip selected — click one on the timeline';
  $('#presets').disabled = true;
  $('#btnSaveMove').disabled = true;
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
  $('#codeName').textContent = editable ? next.src.replace(/^clips\//, '')
    : next ? `${next.kind} clip — nothing to write`
    : 'no clip selected — click one on the timeline';
  $('#presets').disabled = !editable;
  $('#btnSaveMove').disabled = !editable;
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
function showSignature() {
  const bar = $('#sig');
  if (!bar || !cm) return;
  const cur = cm.getCursor();
  const line = cm.getLine(cur.line) || '';
  const info = callAt(line, cur.ch);
  if (!info || !SIGNATURES[info.name]) return bar.classList.add('hidden');
  const args = SIGNATURES[info.name];
  bar.classList.remove('hidden');
  bar.innerHTML = `<b>${info.name}</b>(`
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
        const before = line.slice(0, i).match(/([A-Za-z_$][\w$]*)\s*$/);
        return before ? { name: before[1], arg: commas } : null;
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
  const colour = $('#pickColour'), font = $('#pickFont');
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
  for (const m of line.matchAll(/#[0-9a-fA-F]{6}/g))
    if (cur.ch >= m.index - 1 && cur.ch <= m.index + m[0].length + 1) return m[0];
  return null;
}

function replaceColour(hex) {
  if (!cm || !clip) return;
  const cur = cm.getCursor(), line = cm.getLine(cur.line) || '';
  for (const m of line.matchAll(/#[0-9a-fA-F]{6}/g)) {
    if (cur.ch >= m.index - 1 && cur.ch <= m.index + m[0].length + 1) {
      cm.replaceRange(hex, { line: cur.line, ch: m.index },
                            { line: cur.line, ch: m.index + m[0].length });
      clearTimeout(idle); idle = setTimeout(apply, 250);
      return;
    }
  }
  cm.replaceSelection(`'${hex}'`);
  clearTimeout(idle); idle = setTimeout(apply, 250);
}

async function insertFont(family) {
  if (!cm || !clip || !family) return;
  /* A font only reliably renders — and only travels with the project — once
     the project carries the file. Picking one copies it in. */
  const r = await api('/api/font/embed', 'POST', { name: S.name, family });
  if (r && r.ok) refreshFonts();
  /* A font name is only meaningful inside an options object, so put it in one
     rather than wherever the cursor happens to be — dropping `font: 'X'` in
     front of a statement makes a syntax error out of a mouse click. */
  const cur = cm.getCursor();
  const line = cm.getLine(cur.line) || '';

  const existing = line.match(/font:\s*'[^']*'/);
  if (existing) {
    cm.replaceRange(`font: '${family}'`,
      { line: cur.line, ch: existing.index },
      { line: cur.line, ch: existing.index + existing[0].length });
    cm.focus();
    clearTimeout(idle); idle = setTimeout(apply, 250);
    return;
  }

  /* the nearest options object: this line's `{`, else scan up a few lines */
  let ln = cur.line, at = -1;
  for (let i = 0; i < 6 && ln - i >= 0; i++) {
    const l = cm.getLine(ln - i) || '';
    const brace = l.lastIndexOf('{');
    if (brace >= 0) { ln = ln - i; at = brace + 1; break; }
  }
  if (at < 0) {
    showError(`Put the cursor inside a line(...) or block(...) call, then pick a font.`);
    return;
  }
  const rest = (cm.getLine(ln) || '').slice(at);
  const sep = rest.trim().startsWith('}') || rest.trim() === '' ? '' : ' ';
  cm.replaceRange(` font: '${family}',${sep}`, { line: ln, ch: at }, { line: ln, ch: at });
  cm.focus();
  clearTimeout(idle); idle = setTimeout(apply, 250);
}


/* ---------------------------------------------------------------- curve --
   Put the cursor inside a bezier(...) and the editor opens on those numbers;
   dragging rewrites them in place. */
let curveSpot = null;               /* {line, from, to} of what we are editing */

/* Where the cursor is, and what curve that means. Three cases, because all
   three are moments you want the editor:

     bezier(.3, 1.5, .6, 1)   edit those numbers
     bezier()                 empty — open on a default and fill it in
     overshoot                a named easing: show its shape, and dragging
                              turns it into an explicit bezier(...)          */
function curveAt(line, ch) {
  for (const m of line.matchAll(/bezier\s*\(([^)]*)\)/g)) {
    const open = m.index + m[0].indexOf('(') + 1;
    const close = m.index + m[0].length - 1;
    if (ch >= m.index && ch <= close + 1) {
      const raw = m[1].trim();
      const nums = raw ? raw.split(',').map(v => Number(v.trim())) : [];
      const ok = nums.length === 4 && nums.every(n => Number.isFinite(n));
      return { from: open, to: close, fill: !ok,
               values: ok ? nums : Curve.NAMED.overshoot.slice() };
    }
  }
  for (const m of line.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    if (!Curve.NAMED[m[1]]) continue;
    if (ch >= m.index && ch <= m.index + m[0].length)
      return { from: m.index, to: m.index + m[0].length,
               values: Curve.NAMED[m[1]].slice(), named: m[1] };
  }
  return null;
}

function syncCurve() {
  if (!cm) return;
  /* the drag owns the range until it lets go */
  if (Curve.isDragging()) return;
  const cur = cm.getCursor();
  const found = curveAt(cm.getLine(cur.line) || '', cur.ch);
  if (!found) { curveSpot = null; return Curve.hide(); }
  curveSpot = { line: cur.line, from: found.from, to: found.to, named: found.named };
  Curve.show(found.values);
  /* an empty bezier() gets the default written in, so what the panel shows and
     what the clip runs are the same thing from the first frame */
  if (found.fill) writeCurve(found.values);
}

function writeCurve(values) {
  if (!cm || !curveSpot) return;
  /* dragging a NAMED easing replaces the name with the curve it describes */
  const text = curveSpot.named ? 'bezier(' + values.join(', ') + ')' : values.join(', ');
  cm.replaceRange(text, { line: curveSpot.line, ch: curveSpot.from },
                         { line: curveSpot.line, ch: curveSpot.to });
  if (curveSpot.named) {
    curveSpot.from += 'bezier('.length;
    curveSpot.named = null;
    curveSpot.to = curveSpot.from + values.join(', ').length;
  } else {
    curveSpot.to = curveSpot.from + text.length;
  }
  clearTimeout(idle);
  idle = setTimeout(apply, 200);
}
