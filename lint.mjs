/* ============================================================================
   SOURCE HYGIENE. Runs before the browser suite; costs nothing.

   Every one of these checks exists because the thing it looks for actually
   happened in this codebase and cost real time to find:

     CONTROL CHARACTERS   A `\b` written through a shell heredoc arrived as a
                          literal 0x08 backspace byte. `/\bduration\(/` became
                          `/<BS>duration\(/`, which matches nothing, ever. The
                          file parses, the tests run, and one feature is quietly
                          dead. Five of these were sitting in the tree.
     PARSES AT ALL        Cheap, and catches a bad patch before a browser does.
     NO STRAY MARKERS     Conflict markers and debug hooks left behind.

   The lesson generalises: a corrupt byte inside a regex or a string literal is
   invisible to `node --check`, invisible to the eye, and invisible to any test
   that does not exercise that exact path. So look for the bytes directly.
   ========================================================================== */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(['node_modules', 'projects', '.git']);
const EXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.md']);

/* everything below 0x20 except tab and newline, plus DEL */
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const MARKERS = /^(<<<<<<<|>>>>>>>|=======$)/;
const DEBUG = /\bwindow\.__(span|ms|dur|dbg)\b|\bdebugger\b/;

let problems = 0;
const fail = (where, what) => { problems++; console.log(`  FAIL  ${where}  ${what}`); };

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (!EXT.has(path.extname(e.name))) continue;
    check(full);
  }
}

function check(file) {
  const rel = path.relative(HERE, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');

  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(CONTROL)) {
      const code = m[0].charCodeAt(0).toString(16).padStart(2, '0');
      const hint = code === '08' ? '  (a \\b that lost its backslash)' : '';
      fail(`${rel}:${i + 1}:${m.index + 1}`, `control character 0x${code}${hint}`);
    }
    if (MARKERS.test(line)) fail(`${rel}:${i + 1}`, 'conflict marker');
    if (DEBUG.test(line)) fail(`${rel}:${i + 1}`, `debug leftover: ${line.trim().slice(0, 50)}`);
  });
  if (text.charCodeAt(0) === 0xfeff) fail(rel, 'byte order mark');
}

/* Every function the library exports must carry a doc block, because those
   blocks ARE the reference panel. A function with no comment is a function
   that is invisible to anyone reading F1, which is worse than undocumented:
   it looks as though it does not exist. */
function checkDocs() {
  const src = fs.readFileSync(path.join(HERE, 'web/motion.js'), 'utf8');

  const api = /var API = \{([\s\S]*?)\};/.exec(src);
  if (!api) return fail('web/motion.js', 'cannot find the API export list');
  const exported = [...api[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map(m => m[1]);

  const documented = new Set(
    (src.match(/\/\*\*[^\n]*/g) || [])
      .map(l => (/\/\*\*\s+([\w$]+)/.exec(l) || [])[1])
      .filter(Boolean));

  /* E is the easing table, which has a block of its own */
  const skip = new Set(['E']);
  const missing = exported.filter(n => !documented.has(n) && !skip.has(n));
  if (missing.length)
    fail('web/motion.js', `exported but not documented: ${missing.join(', ')}`);

  /* and a doc block whose signature names something that is not exported is a
     rename that only got done on one side */
  const stale = [...documented].filter(n =>
    /^[a-z]/.test(n) && !exported.includes(n) && !skip.has(n));
  if (stale.length)
    fail('web/motion.js', `documented but not exported: ${stale.join(', ')}`);
}

/* The scene layer is documented the same way and the same rule applies: a
   chainable method with no doc block is invisible in F1, which is worse than
   undocumented because it looks as though it does not exist. */
function checkScene() {
  const src = fs.readFileSync(path.join(HERE, 'web/scene.js'), 'utf8');

  const methods = [...src.matchAll(/^  P(?:\.|\[')([\w$]+)/gm)].map(m => m[1]);
  const api = /var API = \{([\s\S]*?)\};/.exec(src);
  const made = api ? [...api[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map(m => m[1]) : [];

  const documented = new Set(
    (src.match(/\/\*\*[^\n]*/g) || [])
      .map(l => (/\/\*\*\s+\.?([\w$]+)/.exec(l) || [])[1])
      .filter(Boolean));

  /* internals: _add is the shared builder, and the three readers are how the
     resolver asks a node about itself. None of them are yours to call. */
  const skip = new Set(['_add', 'length', 'startsAt', 'endsAt']);
  const missing = [...methods, ...made].filter(n => !documented.has(n) && !skip.has(n));
  if (missing.length) fail('web/scene.js', `not documented: ${missing.join(', ')}`);
}

console.log('\nSTUDIO — source hygiene\n');
walk(HERE);
checkDocs();
checkScene();

/* and it must actually parse */
for (const f of ['server.mjs', 'lib/paths.mjs', 'lib/project.mjs', 'lib/media.mjs',
                 'lib/fonts.mjs', 'web/motion.js', 'web/app.js', 'web/editor.js',
                 'web/curve.js', 'web/scene.js', 'web/stage.js', 'web/transport.js', 'web/drag.js',
                 'web/layout.js', 'web/timeline.js', 'web/pool.js', 'web/state.js', 'web/signatures.js']) {
  const full = path.join(HERE, f);
  if (!fs.existsSync(full)) continue;
  try { await import(pathToFileURL(full).href); }
  catch (e) {
    /* a browser module importing browser globals is fine; a SyntaxError is not */
    if (e instanceof SyntaxError) fail(f, e.message);
  }
}

console.log(problems ? `\n  ${problems} problem(s)\n` : '  clean\n');
process.exit(problems ? 1 : 0);
