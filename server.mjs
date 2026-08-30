/* ============================================================================
   STUDIO — a video editor whose motion graphics are code instead of nodes.

   Everything a cut needs is done with a mouse: import, arrange, trim, order,
   scrub. Everything a composition needs is done in the code pane. The server
   is a static file host for the project tree plus a handful of endpoints; it
   holds no state of its own, because project.json is the project.

     node studio.mjs                 http://localhost:4321
     PORT=5000 node studio.mjs
   ========================================================================== */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { PORT, MIME, WEB, PROJECTS, STUDIO, safeJoin } from './lib/paths.mjs';
import * as P from './lib/project.mjs';
import * as M from './lib/media.mjs';
import * as Fonts from './lib/fonts.mjs';

fs.mkdirSync(PROJECTS, { recursive: true });

/* --------------------------------------------------------------- the shell --
   A code clip is a .js file whose whole content is the BODY of __render. It
   is not an html page and should not have to pretend to be one: the shell —
   doctype, the stage, the runtime, the render wrapper, __ready — is the
   harness's job, and repeating it in every clip is forty lines of ceremony
   guarding three lines of animation.

   So a clip is this, entire:

       duration(2200);
       label('l1', '', { top: 340, fontSize: 268 });
       stagger(words('l1', '3,361 people'), t, 130, { o: on(0,340) });

   t and frame are in scope because the file IS the render body. css() adds a
   stylesheet when the style helpers are not enough. .html clips still work
   untouched — anything you already wrote keeps running. */
/* Fonts a project carries. Installing a font system-wide is not something a
   project can rely on — it may not be installed on the next machine, and even
   locally Windows can register a family that the browser still refuses to
   render. A file in projects/<name>/fonts/ always works, and travels with the
   folder. The family name is read from the file, so what you type in a clip is
   what the font actually calls itself. */
function fontFaces(projectName) {
  const dir = safeJoin(PROJECTS, projectName);
  const fdir = dir && path.join(dir, 'fonts');
  if (!fdir || !fs.existsSync(fdir)) return '';
  let out = '';
  for (const f of fs.readdirSync(fdir)) {
    if (!/\.(ttf|otf|woff2?)$/i.test(f)) continue;
    const info = Fonts.familyOf(path.join(fdir, f));
    if (!info) continue;
    const italic = /italic|oblique/i.test(info.style);
    const url = `/p/${encodeURIComponent(projectName)}/fonts/${encodeURIComponent(f)}`;
    out += `@font-face{font-family:'${info.family}';src:url('${url}');`
         + `font-style:${italic ? 'italic' : 'normal'};font-display:block}
`;
  }
  return out;
}

function shell(js, w, h, faces) {
  return `<!doctype html><meta charset="utf-8">
<style>
${faces || ''}
  html,body{margin:0;background:transparent;overflow:hidden}
  #stage{position:relative;width:${w}px;height:${h}px;overflow:hidden;
         color:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
  #stage>*{position:absolute}
</style>
<div id="stage"></div>
<script src="/web/motion.js"></script>
<script>
window.__stageW = ${w}; window.__stageH = ${h};
var __dur = 3000;
function duration(ms){ __dur = ms; window.__duration = ms; }
function css(text){
  if (document.getElementById('__css')) return;
  var s = document.createElement('style'); s.id = '__css'; s.textContent = text;
  document.head.appendChild(s);
}
function html(markup){
  var st = document.getElementById('stage');
  if (st.__html !== markup) { st.__html = markup; st.insertAdjacentHTML('beforeend', markup); }
}
window.__render = function (t, frame) {
${js}
};
window.__duration = __dur;

/* A clip must not declare itself ready before its fonts are usable. Web fonts
   load lazily, so the first frames would otherwise be measured and drawn in a
   fallback face — and since __render is a pure function of t, that wrong frame
   is exactly what a render would capture. Ask for every declared family, then
   say ready. */
(function () {
  var want = [];
  try {
    for (var i = 0; i < document.styleSheets.length; i++) {
      var rules = document.styleSheets[i].cssRules || [];
      for (var j = 0; j < rules.length; j++)
        if (rules[j].constructor && /FontFace/.test(rules[j].constructor.name))
          want.push(rules[j].style.fontStyle === 'italic'
            ? 'italic 100px ' + rules[j].style.fontFamily
            : '100px ' + rules[j].style.fontFamily);
    }
  } catch (e) { /* a cross-origin sheet is not ours to read */ }
  var go = function () { window.__ready = true; };
  if (!want.length || !document.fonts) return go();
  Promise.all(want.map(function (f) { return document.fonts.load(f); }))
    .then(function () { return document.fonts.ready; })
    .then(go, go);
})();
<\/script>` + tail();
}

/* Loaded in an iframe and driven by the editor, so it needs to say when it is
   ready and forward its own errors — with the line number offset back to what
   you actually typed, not where it landed inside the shell. */
const SHELL_OFFSET = 22;
function tail(offset) {
  return `
<script>(function(){`
    + `var off=${offset === undefined ? SHELL_OFFSET : offset};`
    + `window.onerror=function(m,f,l){parent.postMessage(`
    + `{studio:'error',message:String(m),line:Math.max(1,l-off),src:location.pathname},'*');};`
    + `var n=0;(function p(){`
    + `if(window.__ready)parent.postMessage({studio:'ready',src:location.pathname,`
    + `duration:window.__duration||0},'*');`
    + `else if(n++<400)setTimeout(p,25);`
    + `else parent.postMessage({studio:'timeout',src:location.pathname},'*');})();})();<\/script>`;
}

/* the old format: a whole html page, used exactly as written */
function inject(htmlSrc) {
  return `<script src="/web/motion.js"></script>
` + htmlSrc + tail(0);
}

/* ------------------------------------------------------------------ watch -- */
const clients = new Set();
const selfWrote = new Map();
const WATCH_EXT = new Set(['.html', '.js', '.css', '.json']);
let pending = null;
try {
  fs.watch(PROJECTS, { recursive: true }, (_e, file) => {
    if (!file) return;
    const f = String(file).replace(/\\/g, '/');
    if (!WATCH_EXT.has(path.extname(f))) return;
    const abs = path.resolve(PROJECTS, f);
    const until = selfWrote.get(abs);
    if (until && Date.now() < until) return;
    if (until) selfWrote.delete(abs);
    clearTimeout(pending);
    pending = setTimeout(() => broadcast({ type: 'changed', file: f }), 120);
  });
} catch (e) { console.warn('  watching unavailable:', e.message); }

function broadcast(msg) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const r of clients) { try { r.write(line); } catch { clients.delete(r); } }
}

/* ---------------------------------------------------------------- helpers -- */
const sendJSON = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': MIME['.json'], 'content-length': Buffer.byteLength(s) });
  res.end(s);
};
const readBody = req => new Promise(r => {
  let b = ''; req.on('data', c => { b += c; });
  req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } });
});
function serveFile(res, file, transform = null) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    const out = transform ? Buffer.from(transform(buf.toString('utf8')), 'utf8') : buf;
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream',
                         'content-length': out.length, 'cache-control': 'no-store',
                         'accept-ranges': 'bytes' });
    res.end(out);
  });
}

/* ------------------------------------------------------------------ routes -- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = decodeURIComponent(url.pathname);
  const raw = p === '/api/media/upload';
  const body = (req.method === 'GET' || raw) ? {} : await readBody(req);

  /* ---- the app itself ---- */
  if (p === '/' || p === '/index.html') return serveFile(res, path.join(WEB, 'index.html'));
  if (p.startsWith('/web/')) {
    const f = safeJoin(WEB, p.slice(5));
    return f ? serveFile(res, f) : sendJSON(res, 400, { why: 'bad path' });
  }

  /* ---- projects ---- */
  if (p === '/api/projects')
    return sendJSON(res, 200, { projects: P.list(), root: PROJECTS });

  if (p === '/api/project/new' && req.method === 'POST') {
    const r = P.create(body.name);
    return sendJSON(res, r.ok ? 200 : 400, r);
  }

  if (p === '/api/project') {
    const name = url.searchParams.get('name') || body.name;
    if (req.method === 'GET') {
      const proj = P.read(name);
      if (!proj) return sendJSON(res, 404, { ok: false, why: 'no such project' });
      /* anything dropped into media/ by hand joins the pool on load */
      const found = M.scan(name, proj.media);
      if (found.length) { proj.media = [...proj.media, ...found]; P.write(name, { media: proj.media }); }
      return sendJSON(res, 200, { ok: true, project: proj });
    }
    if (req.method === 'PUT') {
      const { tracks, media, w, h, fps } = body;
      const patch = {};
      if (tracks) patch.tracks = tracks;
      if (media) patch.media = media;
      if (w) patch.w = w; if (h) patch.h = h; if (fps) patch.fps = fps;
      return sendJSON(res, 200, P.write(name, patch));
    }
  }

  /* ---- media ---- */
  if (p === '/api/media/import' && req.method === 'POST') {
    const r = M.importFiles(body.name, body.paths);
    if (r.ok && r.added.length) {
      const proj = P.read(body.name);
      P.write(body.name, { media: [...proj.media, ...r.added] });
    }
    return sendJSON(res, r.ok ? 200 : 400, r);
  }

  if (p === '/api/media/upload' && req.method === 'POST') {
    const name = url.searchParams.get('name');
    const fileName = path.basename(url.searchParams.get('file') || '');
    const dir = safeJoin(PROJECTS, name);
    if (!dir || !fs.existsSync(dir) || !fileName)
      return sendJSON(res, 400, { ok: false, why: 'bad upload' });
    const kind = M.kindOf(fileName);
    if (!kind) return sendJSON(res, 400, { ok: false, why: 'unsupported type' });
    /* a font is not media — it belongs to the project's typography, not its
       pool, and lands where the clip shell looks for @font-face */
    const sub = kind === 'font' ? 'fonts' : 'media';
    const into = path.join(dir, sub);
    fs.mkdirSync(into, { recursive: true });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    fs.writeFileSync(path.join(into, fileName), Buffer.concat(chunks));
    return sendJSON(res, 200, { ok: true, kind, src: sub + '/' + fileName });
  }

  /* What is actually installed, with the family names a stylesheet must use.
     Read from the font files rather than guessed from filenames. */
  if (p === '/api/fonts') {
    const name = url.searchParams.get('name');
    const dir = name && safeJoin(PROJECTS, name);
    const fdir = dir && path.join(dir, 'fonts');
    const project = [];
    if (fdir && fs.existsSync(fdir)) {
      for (const f of fs.readdirSync(fdir)) {
        if (!/\.(ttf|otf|woff2?)$/i.test(f)) continue;
        const info = Fonts.familyOf(path.join(fdir, f));
        if (info && !project.some(p => p.family === info.family)) project.push(info);
      }
    }
    return sendJSON(res, 200, { project, system: Fonts.list() });
  }

  /* Picking a font should not mean going and finding a file. The server can
     already see every installed font, so choosing one copies it into the
     project — which is also the only way it is guaranteed to render, and the
     only way the project still works on another machine. */
  if (p === '/api/font/embed' && req.method === 'POST') {
    const dir = safeJoin(PROJECTS, body.name || '');
    if (!dir || !fs.existsSync(dir)) return sendJSON(res, 404, { ok: false, why: 'no such project' });
    const files = Fonts.filesFor(body.family);
    if (!files.length) return sendJSON(res, 404, { ok: false, why: 'font not found on this machine' });
    const into = path.join(dir, 'fonts');
    fs.mkdirSync(into, { recursive: true });
    const copied = [];
    for (const src of files) {
      const to = path.join(into, path.basename(src));
      try { if (!fs.existsSync(to)) fs.copyFileSync(src, to); copied.push(path.basename(src)); }
      catch (e) { /* a locked system file is not fatal — the others may work */ }
    }
    if (!copied.length) return sendJSON(res, 500, { ok: false, why: 'could not copy any file' });
    return sendJSON(res, 200, { ok: true, family: body.family, files: copied });
  }

  /* ---- code clips ---- */
  if (p === '/api/clip/new' && req.method === 'POST')
    return sendJSON(res, 200, P.newCodeClip(body.name, body.title));

  /* Deleting a clip deletes its file. Anything else means a name you used
     once is taken forever, and a clips/ folder that fills up with things you
     thought you had thrown away. The caller checks nothing else on the
     timeline still points at the file. */
  if (p === '/api/clip/delete' && req.method === 'POST')
    return sendJSON(res, 200, P.deleteCodeClip(body.name, body.src));

  if (p === '/api/source') {
    const name = url.searchParams.get('name') || body.name;
    const rel = url.searchParams.get('src') || body.src;
    const dir = safeJoin(PROJECTS, name);
    const file = dir && safeJoin(dir, rel);
    if (!file) return sendJSON(res, 400, { ok: false, why: 'bad path' });
    if (req.method === 'GET') {
      try { return sendJSON(res, 200, { ok: true, src: fs.readFileSync(file, 'utf8') }); }
      catch (e) { return sendJSON(res, 404, { ok: false, why: e.message }); }
    }
    if (req.method === 'PUT') {
      if (typeof body.text !== 'string') return sendJSON(res, 400, { ok: false, why: 'no text' });
      selfWrote.set(path.resolve(file), Date.now() + 1500);
      try {
        fs.writeFileSync(file, body.text);
        return sendJSON(res, 200, { ok: true, bytes: Buffer.byteLength(body.text) });
      } catch (e) { return sendJSON(res, 500, { ok: false, why: e.message }); }
    }
  }

  /* ---- user presets: moves you made, kept for next time ----
     Studio-wide, not per project — a move you invent is worth having in the
     next video too. Stored as one json file so it is diffable and editable. */
  if (p === '/api/presets') {
    const file = path.join(STUDIO, 'presets.json');
    const NL = String.fromCharCode(10);
    const readAll = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } };
    if (req.method === 'GET') return sendJSON(res, 200, { presets: readAll() });
    if (req.method === 'POST') {
      const { name, note, html, code } = body;
      if (!name || !code) return sendJSON(res, 400, { ok: false, why: 'needs a name and some code' });
      const all = readAll().filter(x => x.name !== name);
      all.push({ name: String(name), note: String(note || ''), html: String(html || ''), code: String(code) });
      fs.writeFileSync(file, JSON.stringify(all, null, 2) + NL);
      return sendJSON(res, 200, { ok: true, presets: all });
    }
    if (req.method === 'DELETE') {
      const all = readAll().filter(x => x.name !== body.name);
      fs.writeFileSync(file, JSON.stringify(all, null, 2) + NL);
      return sendJSON(res, 200, { ok: true, presets: all });
    }
  }

  /* ---- live ---- */
  if (p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache',
                         connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  /* ---- project files: /p/<project>/<path inside it> ---- */
  if (p.startsWith('/p/')) {
    const rest = p.slice(3);
    const slash = rest.indexOf('/');
    if (slash < 0) return sendJSON(res, 400, { why: 'bad project path' });
    const dir = safeJoin(PROJECTS, rest.slice(0, slash));
    const file = dir && safeJoin(dir, rest.slice(slash + 1));
    if (!file) return sendJSON(res, 400, { why: 'bad path' });
    const rel = rest.slice(slash + 1);
    const ext = path.extname(file);

    /* a .js under clips/ is a render body — wrap it in the shell */
    if (ext === '.js' && rel.split('\\').join('/').startsWith('clips/')) {
      const proj = P.read(rest.slice(0, slash));
      const w = proj ? proj.stage.w : 1920, h = proj ? proj.stage.h : 1080;
      let js = '';
      try { js = fs.readFileSync(file, 'utf8'); }
      catch { res.writeHead(404); return res.end('not found'); }
      const out = Buffer.from(shell(js, w, h, fontFaces(rest.slice(0, slash))), 'utf8');
      res.writeHead(200, { 'content-type': MIME['.html'], 'content-length': out.length,
                           'cache-control': 'no-store' });
      return res.end(out);
    }
    return serveFile(res, file, ext === '.html' ? inject : null);
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

/* ------------------------------------------------------------------ listen -- */
function banner(port) {
  const names = P.list();
  console.log(`\n  STUDIO  http://localhost:${port}`);
  console.log(`  projects in ${path.relative(process.cwd(), PROJECTS) || PROJECTS}`);
  if (names.length) for (const n of names) {
    const pr = P.read(n);
    const clips = (pr?.tracks || []).reduce((a, t) => a + (t.clips || []).length, 0);
    console.log(`    ${n.padEnd(20)} ${String(clips).padStart(3)} clips, ${(pr?.media || []).length} media`);
  } else console.log('    (none yet — make one in the app)');
  console.log('');
}
let tries = 0;
server.on('error', async err => {
  if (err.code !== 'EADDRINUSE') throw err;
  const port = PORT + tries;
  if (tries === 0) {
    try {
      const r = await fetch(`http://localhost:${port}/api/projects`, { signal: AbortSignal.timeout(800) });
      if (r.ok) { console.log(`\n  Studio is already running.  http://localhost:${port}\n`); process.exit(0); }
    } catch {}
  }
  if (++tries > 10) { console.error(`\n  ports ${PORT}-${PORT + 10} busy. try PORT=5000\n`); process.exit(1); }
  console.log(`  port ${port} busy, trying ${PORT + tries}…`);
  server.listen(PORT + tries);
});
server.listen(PORT, () => banner(server.address().port));
