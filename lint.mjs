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

console.log('\nSTUDIO — source hygiene\n');
walk(HERE);

/* and it must actually parse */
for (const f of ['server.mjs', 'lib/paths.mjs', 'lib/project.mjs', 'lib/media.mjs',
                 'lib/fonts.mjs', 'web/motion.js', 'web/app.js', 'web/editor.js',
                 'web/curve.js', 'web/stage.js', 'web/transport.js', 'web/drag.js',
                 'web/timeline.js', 'web/pool.js', 'web/state.js', 'web/signatures.js']) {
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
