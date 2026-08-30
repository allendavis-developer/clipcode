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
    scene.js            the chained, choreography-first layer clips are written in
    help.js             the F1 reference, parsed out of scene.js and motion.js
    layout.js           pane sizes, remembered per browser
    curve.js            the easing editor
    drag.js             the one drag primitive
    pool.js             media, and getting it into the project
    motion.js           the lower level scene.js is built on
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

## Writing a clip

A clip is code that runs once per frame. It gets one variable, `t` — the
milliseconds since the clip started — and answers one question: at time `t`,
what does the frame look like?

There are two layers, and you should reach for the first.

### The scene layer — `web/scene.js`

Things are made, described and choreographed in one chained sentence:

```js
text('3361 people')
  .font('Figtree Black', 268)
  .color('#e12392')
  .at(90, 340)
  .enter(340, 'pop');
```

**Timing is relationships, not timestamps.** This is the part that matters:

```js
title.enter(300);
subtitle.enter(250).after(title, 80);
chart.draw(600).after(subtitle, -120);
```

`.after(other, gap)`, `.with(other)`, `.before(other, gap)`, `.alignEnd(other)`
and `.during(other)`; a negative gap overlaps. A clip is therefore a
**dependency graph**, resolved to a timeline on every frame, not a set of
objects with fixed timestamps on them.

Change the title from 300ms to 500ms and the subtitle moves from 380 to 580 and
the chart from 510 to 710 — still 80ms behind and still overlapping by 120 —
because the gap is what was written down and the absolute time was only ever a
consequence of it. That is one edit instead of repairing every number after it.

`window.__scenePlan()` returns the resolved timeline, so what the relationships
came to is inspectable rather than implied.

**A clip is as long as its choreography.** `duration(ms)` is optional now; with
no call to it, the clip on the timeline ends when the last thing does, and
follows when you change a timing. Call it when you want to hold past the end.

**Elements have no ids.** `text('hello')` is enough, because the clip re-runs
from the top every frame and the *order* of the calls is a stable identity. The
rule that comes with it: create unconditionally, animate conditionally. A
create inside an `if` changes what everything after it refers to.

| | |
|---|---|
| `text() image() shape()` | make one thing |
| `group(a, b) items([...]) sequence(a, b, c)` | make several |
| `.font() .size() .color() .at() .style() .layout()` | how it looks |
| `.enter() .exit() .hold() .move() .fade() .scale() .rotate() .draw()` | what it does |
| `.start() .after() .with() .before() .alignEnd() .during()` | when it does it |
| `.stagger(ms)` | children cascade — each starts `ms` after the one before |
| `.alternate()` | every second child reversed. Negates x, y and rotation only, and says so in the pane when a move has none of those |
| `.animate(prop, keyframes)` | the escape hatch |

A spec entry is `property: [from, to]`, using the spec's `ease`, or
`property: [from, to, ease]` to give that one property an easing of its own —
so a fade can be flat while the movement it accompanies overshoots. Anything
that is not a pair is passed through as a raw track.

Entrance presets: `fade pop rise drop slide grow spin`. Three levels of detail,
and you should rarely need the third:

```js
title.enter(300, 'pop');
title.enter(300, { opacity: [0, 1], scale: [.8, 1], ease: 'overshoot' });
title.animate('scale', [[0, .8], [220, 1.08], [300, 1]]);
```

### The editing library

In `web/motion.js`, underneath the scene layer and injected into every clip.
Absolute milliseconds and explicit ids. Reach for it when the scene layer
cannot say what you mean; the two mix freely in one clip.

This is where the speed comes from: in a node editor the cost of a move is
proportional to the number of things it moves, and here it is flat.

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

The earlier names have been removed. `go` `tween` `on` `off` and the easings
`back out into io expo soft step` each raise an error naming their replacement
(`change` `change` `fadeIn` `fadeOut`, `overshoot easeOut easeIn easeInOut snap
settle hardCut`) rather than quietly continuing to work. Two ways to write the
same thing is worse than one rename.

A **track** is `[[time, value], [time, value, easing]]`, sampled at `t` and held
outside its range. Every animated number in the system is one.

---

## Saving

There is no save button. Clip edits write `project.json` within 250 ms; code
writes its file 700 ms after you stop typing, on `Ctrl+S`, and on clicking out
of the editor. Both flush on tab-hide and page-unload with `keepalive`, so the
last keystroke before a close is not lost.

Pane sizes are yours and they stay. Dragging a splitter writes `--pool`,
`--mon` or `--h-timeline` to localStorage, and a small inline script in
`index.html` applies them before the first paint so the page never renders at
the default and then jumps. Double-clicking a gutter resets that one and
forgets it. They live in localStorage rather than `project.json` because they
describe the screen you are sitting at, not the video: the same project on a
laptop and on a 32in monitor wants different panes, and your layout should not
turn up in someone else's checkout.

Not saved, because it is not project data and not a preference either:
playhead, selection, timeline zoom.

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
directly above the function it describes in `web/scene.js` or `web/motion.js`;
`web/help.js` fetches both files and parses them out, and the panel is split
into the two layers. Changing a function's arguments puts its
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
