/* ============================================================================
   Peaks, for drawing a waveform on the timeline.

   You cut to a voice. Without a waveform you are timing every cut against a
   number in a readout, replaying the same two seconds to find where the
   sentence ends — which is the whole reason an audio track is a blocker rather
   than a nicety.

   ffmpeg decodes the file to raw mono 16-bit at a low rate and the peaks are
   reduced from that here. Downsampling in the decoder rather than in JS keeps
   the pipe small: a ten minute voiceover is about 5MB at 4kHz, not 100MB.

   The result is cached beside the media as <file>.peaks.json, because it never
   changes for a given file and computing it takes a second. A stale cache is
   impossible in practice — media is copied into the project on import and is
   not edited in place — but the file's size and mtime are stored with it so a
   replaced file is noticed rather than trusted.
   ========================================================================== */
import fs from 'fs';
import { spawn, spawnSync } from 'child_process';

const RATE = 4000;          /* samples per second out of the decoder */
export const BUCKETS = 2000; /* peaks per file, whatever its length */

let probed = null;
function haveFfmpeg() {
  if (probed === null) probed = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
  return probed;
}

const cacheFor = file => file + '.peaks.json';

function cached(file) {
  try {
    const st = fs.statSync(file);
    const c = JSON.parse(fs.readFileSync(cacheFor(file), 'utf8'));
    /* the same bytes, or it is not the same audio */
    if (c.size === st.size && c.mtime === Math.round(st.mtimeMs)) return c;
  } catch { /* no cache, or an unreadable one, which is the same thing */ }
  return null;
}

/* Two numbers per bucket, the lowest and highest sample in it, so a waveform
   drawn from this is the real envelope rather than an average that flattens
   every transient into the same grey band. */
export function peaks(file) {
  const hit = cached(file);
  if (hit) return Promise.resolve(hit);
  if (!haveFfmpeg() || !fs.existsSync(file)) {
    return Promise.resolve({ ok: false, why: 'no ffmpeg or no file' });
  }

  return new Promise(resolve => {
    const ff = spawn('ffmpeg', [
      '-v', 'error', '-i', file,
      '-ac', '1', '-ar', String(RATE),
      '-map', '0:a:0', '-f', 's16le', '-'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    const chunks = [];
    let bytes = 0;
    ff.stdout.on('data', d => { chunks.push(d); bytes += d.length; });

    ff.on('error', () => resolve({ ok: false, why: 'ffmpeg would not start' }));
    ff.on('close', () => {
      if (!bytes) return resolve({ ok: false, why: 'no audio stream' });

      const buf = Buffer.concat(chunks, bytes);
      const total = Math.floor(buf.length / 2);
      const per = Math.max(1, Math.floor(total / BUCKETS));
      const lo = new Array(BUCKETS).fill(0);
      const hi = new Array(BUCKETS).fill(0);

      for (let b = 0; b < BUCKETS; b++) {
        const from = b * per, to = Math.min(total, from + per);
        let min = 0, max = 0;
        for (let i = from; i < to; i++) {
          const v = buf.readInt16LE(i * 2);
          if (v < min) min = v;
          if (v > max) max = v;
        }
        lo[b] = Math.round((min / 32768) * 1000) / 1000;
        hi[b] = Math.round((max / 32768) * 1000) / 1000;
      }

      const st = fs.statSync(file);
      const out = {
        ok: true, buckets: BUCKETS, lo, hi,
        durationMs: Math.round((total / RATE) * 1000),
        size: st.size, mtime: Math.round(st.mtimeMs)
      };
      try { fs.writeFileSync(cacheFor(file), JSON.stringify(out)); } catch {}
      resolve(out);
    });
  });
}
