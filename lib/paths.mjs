/* Where everything is. The studio owns its own tree and knows nothing about
   any particular video — Video1, or anything you make later, is just a
   project folder like any other. */
import path from 'path';
import { fileURLToPath } from 'url';

export const LIB      = path.dirname(fileURLToPath(import.meta.url));
export const STUDIO   = path.resolve(LIB, '..');
export const WEB      = path.join(STUDIO, 'web');
/* Where projects live. A project is a self-contained folder — media, clips
   and the edit — so relocating the lot is a matter of pointing this
   somewhere else and moving the folders:

     STUDIO_PROJECTS=D:/videos node studio.mjs

   Nothing outside a project folder is ever written, which is what makes
   moving one to another drive, or another machine, a plain copy. */
export const PROJECTS = process.env.STUDIO_PROJECTS
  ? path.resolve(process.env.STUDIO_PROJECTS)
  : path.join(STUDIO, 'projects');
export const PORT     = Number(process.env.PORT || 4321);

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8'
};

/* Every path that arrives from the browser goes through this. A studio is a
   local tool, but "local" is not a reason to let a url address the whole
   disk. */
export function safeJoin(base, rel) {
  const p = path.resolve(base, '.' + path.sep + String(rel || '').replace(/^[/\\]+/, ''));
  if (p !== base && !p.startsWith(base + path.sep)) return null;
  return p;
}
