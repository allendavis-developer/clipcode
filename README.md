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
    waveform.mjs        peaks for the timeline, cached beside the file
  web/
    index.html          the shell
    studio.css          all of the styling
    app.js              boot and wiring, and nothing else
    state.js            the edit, and writing it to disk
    stage.js            compositing whatever is under the playhead
    timeline.js         arranging clips with a mouse
    transitions.js      what a cut looks like when a cut is not enough
    transport.js        the clock, the playhead, the keyboard
    editor.js           the code pane and a clip's source
    scene.js            the chained, choreography-first layer clips are written in
    help.js             the F1 reference, parsed out of scene.js and motion.js
    layout.js           pane sizes, remembered per browser
    guides.js           composition guides, and the eye-trace readout
    curve.js            the easing editor
    pathedit.js         the shape editor
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
  lib/             code every clip in this project can call
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
| `connect(a, b, {curve, via, glow})` | a line between two things; `via` sends it through waypoints |
| `path([[x,y],...], {smooth, closed, fill})` | a vector shape of your own — curved through the points or cornered |
| `raw('M100 500 C ...')` | the same, as SVG path data |
| `.along(path, ms, {turn})` | travel a path, optionally pointing the way |
| `group(a, b) items([...]) sequence(a, b, c)` | make several |
| `.font() .size() .color() .at() .style() .layout()` | how it looks |
| `.enter() .exit() .hold() .move() .fade() .scale() .rotate() .draw()` | what it does |
| `.start() .after() .with() .before() .alignEnd() .during()` | when it does it |
| `.stagger(ms)` | children cascade — each starts `ms` after the one before |
| `.alternate()` | every second child reversed. Negates x, y and rotation only, and says so in the pane when a move has none of those |
| `.typeOn(ms)` | writes itself on a character at a time, caret and all |
| `.animate(prop, keyframes)` | the escape hatch |

And the camera, which is a thing rather than a set of moves faked on every
element:

| | |
|---|---|
| `camera.to(x) .focus(x, ms, {fill})` | put it in the middle of frame, and frame it |
| `camera.zoom(k) .push(k) .pull(k)` | absolute, and relative |
| `camera.roll() .turn() .tilt()` | around each axis |
| `camera.drift({zoom, x, y}, ms)` | the slow move that never settles |
| `camera.follow(group, ms)` | track sideways as a cascade builds |
| `camera.hold() .reset() .ease()` | |
| `thing.depth(z)` | how far from the lens, which is where parallax comes from |

`captions([...])`, `stack([...])` and `items([...])` cover the three text
registers this kind of edit is made of: a caption channel that changes card by
card at the bottom of frame, an asymmetric word stack with per-line size and
colour, and a plain list.

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

A **shape is a mouse job for the same reason an easing is.** Put the cursor
inside a `path([[x, y], ...])` — or a `raw('M...')`, which is sampled into
points — and the shape editor opens on it, drawn at the stage's own aspect and
in the stage's own coordinates, so a point at (960, 540) is visibly the middle
of the frame. Drag a point and the numbers in your code are rewritten as you
drag; click empty space to add one, right-click one to remove it, and set
`smooth`, `closed`, colour, width and fill from the panel. An option it has no
control for — a `glow`, a `dash`, a colour written as an expression — is handed
back exactly as it was typed. On an empty line the **shape** button writes a
starter call and opens on that, rather than telling you to go and type one.

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

## Code shared between clips

Anything in `projects/<name>/lib/*.js` is loaded into **every clip** in that
project, before the clip's own code, so what it defines is simply in scope.
Loaded in name order, so `01-base.js` can be relied on by `02-graph.js`.

That answers the question a long video asks immediately: *a thing that comes
back — a node map that gets extended, a lower third, a house entrance — should
be written once and called from wherever it appears, not pasted into every clip
that shows it.*

```js
// projects/myvideo/lib/graph.js
function ideaMap(upTo) {
  const spots = [['idea', 180, 240], ['script', 880, 420], ['edit', 1420, 760]];
  ...
  return made;
}
```

```js
// any clip
const m = ideaMap(2);
camera.focus(m[0], 500).hold(200).to(m[1], 600);
```

```js
// a later clip — the same map, extended, no duplicated code
const m = ideaMap(3);
camera.focus(m[2], 500).pull(2.2, 700);
```

There are two ways a thing can persist across a video and they are not the
same:

- **Continuously, underneath** — one long clip on a low track, with cuts
  stacked above it. It never stops and never resumes, because a clip is a pure
  function of `t` and being covered is not a state.
- **Coming back** — a shared function called from each clip that shows it.

---

## Editing something that is already built

```
node studio/plan.mjs myvideo            what is in it, resolved
node studio/plan.mjs myvideo --json     the same, for something editing the files
```

The expensive part of a video is construction — laying out the scenes, the
typography, the camera moves, the timing. The cheap part is taste: this number
twenty pixels higher, that entrance less aggressive, the second statistic a
beat later. Those should be small edits to a legible file, never a
regeneration.

Three things make that work, and they were built for a person before they were
useful to an assistant:

**Timings are relationships.** `subtitle.enter(250).after(title, 80)` says one
thing in the file and another on the timeline. "Make the second statistic enter
later" is one number in one line, and everything downstream follows — which is
a diff, not a rewrite.

**`.as('name')` gives a stable handle.** Identity is otherwise the *order* of
the calls, which is right when a person is writing — `text('hello')` is enough,
no bookkeeping — but fragile for anything editing the file later, because
inserting one line renumbers everything below it. Name whatever you expect to
come back and adjust.

**`plan.mjs` says what it resolved to.** Reading the source tells you what was
*written*; this tells you what it *came to*, and with relative timings those
are different and you need both:

```
  stats.js
  on the timeline   0ms to 2600ms   (track V1)
    camera   3 moves                     0 to   1400
    title    3361 people                 0 to    340
    commits  85,957 commits            460 to    760   <- after(title, 120)
    s2t      and counting              840 to   1100   <- after(commits, 80)
```

It asks each clip in the same browser the editor uses, rather than
re-implementing the resolver — a second copy would drift from the one the
picture is drawn from, which is the whole failure it avoids.

---

## Getting a video out

```
npm start                              in one terminal
node studio/render.mjs <project>       in another
node studio/render.mjs myvideo out.mp4 --fps 60 --scale 0.5 --from 0 --to 5000
```

It drives the real app in a real browser at the stage's own size and
screenshots one frame at a time into ffmpeg. Slower than a clever approach, and
the only honest one: the picture is composited by the same `stage.js` the
viewer uses, so what comes out is what you watched. A separate render path
would be a second implementation of the picture, and two implementations drift.

**It seeks rather than plays.** Every clip's `__render` is a pure function of
`t`, so frame 900 can be asked for directly and is exactly the frame the
playhead calls 900 — no warm-up, no replaying from the start. That is what the
purity rule buys, and a clip that breaks it shows up here as a render that
disagrees with the preview.

`--scale 0.5` renders the same composition at half the pixels for a quick
draft.

### Motion blur

```
node studio/render.mjs myvideo --blur 180
node studio/render.mjs myvideo --blur 180 --samples 16
```

Real accumulation blur: each frame is the **average of several renders taken
across the time the shutter would have been open**, which is what a film camera
does and what After Effects means by motion blur. 180° is the film standard —
the shutter open for half of each frame's interval — and the exposure is centred
on the frame's own moment, so the blur straddles it rather than trailing it.

This is the purity rule paying out. Because `__render(t)` is a pure function of
`t`, a sub-sample can simply be *asked for* and it is exactly what the picture
was at that instant. So **everything** gets blurred at once and correctly — the
camera, a stagger, text riding a path, a wire drawing itself on — with no
per-object velocity to estimate and nothing to opt in.

Measured on a box crossing frame in one second, one scanline through it: 1
partially-lit pixel without blur, **35 with**.

The sub-samples are taken by raising the render's frame rate to
`fps × samples`, not by asking for time between frames. Every part of the
pipeline quantises time to a frame — the transport so that what you scrub is
what you render, and the compositor again when it paints — and fighting that
would mean a second definition of "what time is it". Since a blurred frame *is*
several frames averaged, the honest move is to make the sub-samples real
frames. Playwright is a devDependency and ffmpeg is expected on PATH; neither is
needed to *run* the editor, which still has no runtime dependencies at all.

---

## Sound

Audio imports like anything else, and an audio clip draws its **waveform** on
the timeline — normalised to its own loudest peak, so a quiet recording is
still a shape rather than a flat line, and trimmed clips show their own part of
the file. Peaks come from ffmpeg through `/api/waveform` and are cached beside
the media, so the second look at a file costs a millisecond.

That is there because you cut to a voice. Without it, finding the end of a
sentence means replaying the same two seconds and watching a number.

`render.mjs` mixes the audio clips into the export, each trimmed to its own
in/out and delayed to where it sits on the timeline.

**Only clips of kind `audio`.** Video plays muted in the viewer, so exporting
its sound would be exporting something you never heard, and the contract of the
renderer is that the file is what you watched. Unmuting video in the preview,
and then in the export, is the obvious next step.

---

## Guides, and where the eye is

**Guides** in the top bar puts thirds, action and title safe, and a centre
cross over the picture. None of it is exported.

It also marks **where the viewer is most likely looking** — and at a cut, shows
where the eye was on the last frame of the outgoing clip against where it has
to go on the first frame of the incoming one, with the distance between them:

```
eye trace · 1% of the frame · matched
eye trace · 92% of the frame · a long jump
```

That is Walter Murch's *eye trace*, from *In the Blink of an Eye*: the
audience's focus of interest has a position in the frame, and a cut that moves
it a long way makes the viewer hunt for the subject and feel the edit. Match
the positions and the cut disappears. It is one of his six criteria for a good
cut, and unlike the other five it is something a tool can measure for you.

The focus is estimated from the **elements**, not from pixels — each weighted
by area × opacity, lifted slightly by brightness. For a frame that is a few big
words on black, the centroid of the big words *is* where you are looking, and
it is exact rather than guessed. It is still an estimate and it says so; the
value is not the dot, it is the distance between two dots either side of a cut,
which is a number you can act on and could not otherwise get.

---

## Transitions

A cut is hard in, hard out, and most of an edit should stay that way. What a
cut cannot do is a section change: the short, aggressive smears and dips that
say *and now something else*. So a boundary can carry one.

```
dissolve   320ms    one picture becomes the other
dip        420ms    out to nothing, and in again
push       420ms    the new picture shoves the old one out of frame
whip       2 frames a directional motion-blurred smear
```

**A transition is a property of the incoming clip's head** — `trans:
{kind, ms, dir}` in `project.json`, meaning *this is how I come in*. Not a
free-standing object on the boundary, because a boundary is not a thing you
can hold: move either clip and it stops existing. A head travels with the clip
that owns it, a copy copies it, deleting the clip deletes it, and nothing can
be left dangling. It also gives the no-partner case for free — a head
transition on the first clip of a track is a fade up from black.

**The window sits after the cut, and the outgoing clip overruns into it.** The
two clips never overlap on the timeline: the cut stays where you put it,
nothing ripples, `duration()` is unchanged and *next edit* still lands on the
cut. What happens instead is that for `ms` after the cut the outgoing clip
keeps painting, asked for a time past its own out point, underneath the
incoming one — which plays from its in point, normally.

Centring the window on the cut would need the incoming clip to paint *before*
its in point, and the in point is the frame you chose as the first frame;
showing what comes before it is showing material you rejected. And a code clip
never runs out of handle, because every animated number is a track and a track
holds its last value outside its range — so a clip asked for a time past its
end gives you its final pose rather than nothing.

**It is a pure function of the timeline position,** like everything else here.
At time X the composite is fully determined by X and the four stored numbers.
Nothing fades over wall-clock time and nothing remembers that it started, which
is why a render is the preview: the compositing lives in `stage.js`'s paint
path, and `/render` loads the same file.

### With a mouse

- **Drag a kind from the toolbar onto a cut.** Dropping the same kind a second
  time steers it — `push` again turns it left, right, up, down.
- **Or push one clip into the one before it.** The overlap you make is the
  length; on release the cut goes back to where it was and the overlap becomes
  the window after it. Over two seconds it stays an ordinary move, because that
  is someone rearranging the edit.
- **Drag its edge for the length**, like any other edge, and **to nothing to
  remove it**. **Double-click the edge to steer** a push or a whip.

On the timeline it is a bowtie at the head of the incoming clip, coloured by
kind, with its length written across it — in milliseconds when there is room
and in frames when there is not, because a whip is two frames long and *2f* is
the number that means something about it.

`node studio/checks/transitions.mjs` measures it: pure red against pure blue,
so the middle of a dissolve is measurably purple and neither original can be
mistaken for it, and the exported frame is compared against the previewed one.

---

## The edit-see loop

Every other cost in this editor is paid once. Waiting to see your change is
paid on every edit, so it gets its own design:

- **Loop repeats the clip you are working on**, not the whole timeline. The
  checkbox says which — `loop clip` when one is selected, `loop all` when none
  is. With twenty shots in a video you no longer sit through nineteen of them
  to watch the twentieth.
- **`R` replays** from the top of whatever is looping. `Home` goes there too.
- **An edit restarts it.** While playback is running, applying a change puts
  the playhead back to the start of the clip. Press space once and the shot
  repeats while you work; every change you make plays again by itself. Stopped,
  nothing moves under you mid-thought — so it is opt-in by a gesture you
  already have rather than a setting.

---

## Known gaps

- Placing an element means typing coordinates; dragging it in the viewer and
  having that write back into the code is not built yet. A `path()`'s points
  are draggable — that is the shape editor — but a text or an image is not.
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
