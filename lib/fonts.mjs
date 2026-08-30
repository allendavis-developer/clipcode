/* ============================================================================
   WHAT FONTS ARE ACTUALLY INSTALLED.

   The browser cannot enumerate system fonts without a permission prompt, but
   the server can just read the font folders. It matters that this reports the
   name a stylesheet has to use, not the filename: a static weight carries the
   weight in its FAMILY name, so "Fraunces_72pt-BlackItalic.ttf" is
   `font-family: 'Fraunces 72pt Black'; font-style: italic` — and there is no
   "Fraunces" to pick at all. Guessing that from the filename costs an
   afternoon, so it is read out of the file's name table instead.
   ========================================================================== */
import fs from 'fs';
import os from 'os';
import path from 'path';

const DIRS = process.platform === 'win32'
  ? [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'),
     path.join(os.homedir(), 'AppData/Local/Microsoft/Windows/Fonts')]
  : process.platform === 'darwin'
    ? ['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library/Fonts')]
    : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts')];

const READABLE = new Set(['.ttf', '.otf', '.ttc']);

/* The OpenType name table. ID 1 is the family a stylesheet asks for, ID 2 its
   style, ID 16/17 the "typographic" pair when a family has more than the four
   classic styles. Windows platform (3) records are UTF-16BE. */
function nameTable(file) {
  let d;
  try { d = fs.readFileSync(file); } catch { return null; }
  if (d.length < 12) return null;
  try {
    const numTables = d.readUInt16BE(4);
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (d.toString('latin1', rec, rec + 4) !== 'name') continue;
      const off = d.readUInt32BE(rec + 8);
      const count = d.readUInt16BE(off + 2);
      const store = off + d.readUInt16BE(off + 4);
      const out = {};
      for (let j = 0; j < count; j++) {
        const r = off + 6 + j * 12;
        const pid = d.readUInt16BE(r), nid = d.readUInt16BE(r + 6);
        const len = d.readUInt16BE(r + 8), so = d.readUInt16BE(r + 10);
        if (pid !== 3 || ![1, 2, 16, 17].includes(nid)) continue;
        const raw = Buffer.from(d.subarray(store + so, store + so + len));
        if (raw.length % 2) continue;                 /* not UTF-16BE, skip */
        out[nid] = raw.swap16().toString('utf16le');
      }
      return out;
    }
  } catch { /* a malformed font is not worth an exception */ }
  return null;
}

/* Family/style read out of one file, for fonts a project carries itself. */
export function familyOf(file) {
  const n = nameTable(file);
  if (n && n[1]) return { family: (n[1] || '').trim(), style: (n[2] || 'Regular').trim() };

  /* woff and woff2 are compressed, so the name table cannot be read without
     decompressing them, and returning null here meant a project could carry a
     web font and silently not have it — the face was skipped and the clip drew
     in a fallback with no error anywhere.

     It does not actually matter what the file calls itself. An @font-face
     BINDS a file to a family name, and the browser will use it under whatever
     name is declared. So the filename is enough, and a font named the way web
     fonts are named — Figtree-900-normal.woff2 — gives up its family, weight
     and style without being opened. */
  const stem = String(file).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  const parts = stem.split('-');
  const family = camelToWords(parts[0]);
  const weight = parts.find(p => /^\d{3}$/.test(p));
  const italic = /italic|oblique/i.test(stem);
  return {
    family,
    style: (weight ? weight + ' ' : '') + (italic ? 'Italic' : 'Regular'),
    weight: weight ? Number(weight) : null,
    guessed: true
  };
}

/* PlusJakartaSans -> Plus Jakarta Sans. Web font files are named in camel case
   and the family they are meant to be is the spaced version. */
function camelToWords(s) {
  return String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
}

let cache = null;

export function list() {
  if (cache) return cache;
  const byFamily = new Map();
  for (const dir of DIRS) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!READABLE.has(path.extname(f).toLowerCase())) continue;
      const n = nameTable(path.join(dir, f));
      if (!n || !n[1]) continue;
      const family = (n[1] || '').trim();
      const style = (n[2] || 'Regular').trim();
      if (!family) continue;
      if (!byFamily.has(family)) byFamily.set(family, { styles: new Set(), files: [] });
      const e = byFamily.get(family);
      e.styles.add(style);
      e.files.push(path.join(dir, f));
    }
  }
  cache = [...byFamily.entries()]
    .map(([family, e]) => ({ family, styles: [...e.styles].sort(), files: e.files }))
    .sort((a, b) => a.family.localeCompare(b.family));
  return cache;
}

/* Every file that makes up a family — what has to be copied for a project to
   carry it. */
export function filesFor(family) {
  const f = list().find(x => x.family === family);
  return f ? f.files : [];
}
