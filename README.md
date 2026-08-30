# Studio

A video editor whose motion graphics are code instead of nodes.

Everything a cut needs is done with a mouse — import, arrange, trim, order,
scrub. Everything a composition needs is done in the code pane. That split is
the whole design: a mouse is better at *where and when*, code is better at
*what and how much*.

```
npm start                             http://localhost:4321
PORT=5000 npm start                   if 4321 is taken
STUDIO_PROJECTS=D:/videos npm start   keep projects somewhere else

npm install                           once, for the tests (playwright)
npm test                              lint, then drive the real app; needs it running
npm run lint                          source hygiene only, no browser needed
```

No build step and no runtime dependencies — Node's own `http`, `fs` and
`child_process`, and nothing else. Playwright is only there for the tests.

---

## The one rule

A clip's render **must be a pure function of `t`**. Same `t` in, same frame out,
every time, with no memory of the last call. No `setTimeout`, no CSS
transitions, no counters that go up.

Break it and playback still looks fine — which is what makes it the nastiest
bug class here. Scrubbing backwards will disagree with scrubbing forwards, and
a render, which walks frames in order from a cold start, will disagree with
both.

Everything else in this document follows from that rule.

---

## Layout

```
server.mjs              http routing, and nothing else
  lib/
    paths.mjs           where things are; safeJoin guards every path from a url
    project.mjs         read/write a project, make clips, the blank clip
    media.mjs           importing and probing media
  web/
    index.html          the shell
    studio.css          all of the styling
    app.js              boot and wiring, and nothing else
    state.js            the edit, and writing it to disk
    stage.js            compositing whatever is under the playhead
    timeline.js         arranging clips with a mouse
    transport.js        the clock, the playhead, the keyboard
    editor.js           the code pane and a clip's source
    help.js             the F1 reference, parsed out of motion.js
    curve.js            the easing editor
    drag.js             the one drag primitive
    pool.js             media, and getting it into the project
    motion.js           the editing library, injected into every clip
    presets.js          built-in moves
projects/<name>/        one folder per video — see below
presets.json            moves you saved
```

Each `web/` module owns one thing and publishes what happened. `app.js` is the
only file that knows they exist together: if a behaviour needs two modules to
agree, the joining goes there, not inside either of them.

---

## A project is a folder

```
projects/my-video/
  project.json     the media pool, the tracks, the clips. the edit.
  media/           what you imported — copied in, never linked
  clips/           one .js per code clip
```

Media is **copied** on import. A pool full of paths into someone's Downloads is
a project that breaks next week; this way the folder is the whole thing and
moving it to another drive or machine is a plain copy.

`project.json` holds the cut. It does **not** hold clip durations — a code clip
declares its own length with `duration(ms)`, and that declaration is the only
copy of the number. Two copies is how a timeline and a render come to disagree.

---

## A clip is the body of `__render`

A code clip is a `.js` file whose entire content is the body of the render
function. The shell — the stage element, the runtime, the render wrapper,
`__ready` — is added by the server when the clip is served.

```js
duration(2200);

label('l1', '', { top: 340, fontSize: 268, color: '#ffb02e' });
stagger(words('l1', '3,361 people'), t, 130, {
  o: on(0, 340), y: go(0, 340, -70, 0, back), s: go(0, 340, .72, 1, back)
}, { alt: true });
```

`t` and `frame` are in scope because the file *is* the render body. Error line
numbers are offset back to what you typed, not where it landed in the shell.

Older `.html` clips — a whole page defining `window.__render` itself — still
work untouched and are served as written.

---

## The editing library

In `web/motion.js`, injected into every clip. This is where the speed comes
from: in a node editor the cost of a move is proportional to the number of
things it moves, and here it is flat.

| | |
|---|---|
| `line(id, text, t, opts)` | label + words + stagger in one flat call — the most common thing you write |
| `anim(el, t, spec)` | keyframe tracks per property; `x y z s r rx ry` compose into one transform, `blur bright sat` into one filter |
| `stagger(list, t, gap, spec, opts)` | the same spec down a list — `{alt}` flips direction, `{from}` delays, `{each}` varies it |
| `words()` `chars()` | split a string into spans once and reuse |
| `box() label() img() pill()` | make elements from code; idempotent, safe every frame |
| `camera(plane, t, spec)` | lay a board out in plane coordinates, then move the camera |
| `draw(path, t, a, b)` `wipe()` | strokes that draw themselves on |
| `ring() grid() rnd(i)` | placement; `rnd` is deterministic, so purity survives |
| `enter() drift()` | the house entrance, and the drift that never stops |
| `fadeIn(a,b)` `fadeOut(a,b)` `change(a,b,v0,v1,e)` `hold(v)` | track shorthands (`on` `off` `go` still work) |
| `css()` `html()` | escape hatches when the helpers are not enough |

Easings: `linear easeIn easeOut easeInOut snap overshoot settle hardCut`, or
`bezier(x1,y1,x2,y2)` / `curve([[x,y],...])` for your own. Put the cursor inside
either and the curve editor opens on it, with a preview you can pause and set to
the length of the move it is attached to.

The earlier names still work: `go` is `change`, `on` is `fadeIn`, `off` is
`fadeOut`, and `back out into io expo soft step` are `overshoot easeOut easeIn
easeInOut snap settle hardCut`.

A **track** is `[[time, value], [time, value, easing]]`, sampled at `t` and held
outside its range. Every animated number in the system is one.

---

## Saving

There is no save button. Clip edits write `project.json` within 250 ms; code
writes its file 700 ms after you stop typing, on `Ctrl+S`, and on clicking out
of the editor. Both flush on tab-hide and page-unload with `keepalive`, so the
last keystroke before a close is not lost.

Not saved, deliberately, because it is not project data: playhead, selection,
pane widths, timeline zoom.

---

## Known gaps

- **No export.** You can build a video and not get an mp4 out. Biggest one.
- **No audio track.** Media imports and plays, but there is no waveform.
- **Cuts only** — no transitions.
- Placing an element means typing coordinates; dragging it in the viewer and
  having that write back into the code is not built yet.
- Errors are reported when the clip runs, not as you type. A syntax error shows
  up about a second after you stop typing, not on the keystroke.

---

## The reference is the source

Press **F1** (or the Help button, or `?`) for the reference. Search it, and
click any example to insert it at the cursor.

Nothing in that panel is written twice. Every entry is a doc comment sitting
directly above the function it describes in `web/motion.js`; `web/help.js`
fetches that file and parses them out. Changing a function's arguments puts its
documentation in the same diff as the change.

A block looks like this, and the first line gives the signature and the section:

```
  /** stagger(list, t, gapMs, spec, options)   @move
   *  Applies the same spec to every element in list, delaying each one by
   *  gapMs more than the previous.
   *  ex  stagger(words('l1', 'a b c'), t, 130, { opacity: fadeIn(0, 300) });
   */
```

Groups are `start type track move make draw place math easing option`. Lines
beginning `ex` are examples. Indented lines are rendered as aligned columns;
everything else re-flows as a paragraph.

`npm run lint` fails if a function is exported without a doc block, or if a
block names something that is no longer exported.

---

## When a clip is broken

Nobody should spend a minute hunting for a missing comma. A broken clip:

- **reddens the line** and puts a dot in the gutter,
- **squiggles the exact character** the parser choked on,
- says **what is missing**, not just what surprised it —
  `line 3 — Unexpected identifier 'size' — looks like a missing comma at the
  end of line 2`,
- suggests the right name for a typo (`lien` → `did you mean line?`),
  by Damerau distance, so two swapped letters count as one mistake,
- shows the same message on the picture itself, since the viewer is where you
  are looking when nothing appears.

Clicking the message jumps the cursor to the character.

Two things make this work, and both were once broken:

**The error handler is installed before your code, not after.** A syntax error
is thrown while the script is being *parsed*, so a handler placed below it is
never reached. That is how a missing comma used to surface as "the clip did not
finish loading", with no line and no hint.

**The wrapper's height is counted, not typed.** A reported line is turned back
into your line by subtracting the wrapper above it. That number was a constant
of `22`; the wrapper is 36 lines, and grows further with every `@font-face` a
project adds — so every error pointed at the wrong line. It is derived from the
head that was actually built, and `SHELL_OFFSET` is published on the page so
the parent uses the same number rather than a second copy of it.

---

## `node studio/lint.mjs`

Runs in a second, before the browser suite. It looks for **control characters
in source**, and it exists because five were found in this tree: a `\b` written
through a shell heredoc arrived as a literal `0x08` backspace byte, so
`/\bduration\(/` became `/<BS>duration\(/` — a regex that matches nothing,
ever. The file parses. `node --check` passes. The eye sees `\b`. One feature is
quietly dead.

The general lesson: a corrupt byte inside a regex or a string literal is
invisible to every check except one that looks at the bytes. So this looks at
the bytes.

---

## Dragging

Every drag in the app — splitters, timeline clips, the scrub bar — goes through
`web/drag.js`. It uses **pointer capture**, not window-level mousemove/mouseup.

The naive pattern leaks: if the pointer is released outside the window, over an
iframe, or the browser swallows the mouseup, the move handler stays attached and
the element then follows the cursor with no button held. That was a real bug
here — panes resizing on hover. Pointer capture guarantees a final `pointerup`
or `pointercancel` and attaches nothing to the window, so nothing can be left
behind.

If you add a new drag, use `draggable(el, { start, move, end })`. Do not attach
listeners to the window.
