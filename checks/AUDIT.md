# Can ClipCode express the four hand-written clips?

Audited against `web/scene.js` (1876 lines) and `web/motion.js` (909 lines) as they
stood at the start of this pass. **Masks (`.showWhere` / `.hideWhere`) and the whole
effects stack (`.glow .shadow .tint .gradient .outline`) were already in the file** —
they are the in-flight work, and they land on several devices below. Where something
looked like it was mid-flight it is marked *(in flight)* rather than asserted missing.

Sources: `Video1/hook-b/hookf.html.bak-round8`, `sec2.html`, `sec3-held.html`,
`sec3-gauntlet.html`.

---

## 1. Verdict

**52 distinct devices.  A: 31 (60%).  B: 11 (21%).  C: 10 (19%).**

The three registers the library was designed for — staggered kinetic type, a diagram
that draws itself on, and a camera that frames things by relationship — come out at
**A almost without exception**. `line()` reproduces hookf's word cascades exactly,
`.draw()` reproduces every `stroke-dasharray` reveal in all four files, `.typeOn()`
reproduces the terminal verbatim, and the effects stack that just landed reproduces
the grades, the halos and the cast shadows.

The failures are not scattered. They cluster into **four things**:

1. **The camera has no position.** `camera.zoom/push/pull` is `scale()` on `#world`
   under a fixed `perspective:1800px`. It cannot dolly, cannot cross an object's
   plane, and cannot carry a focus plane. `sec3-held` and `sec3-gauntlet` are
   *entirely* built on a camera that can, and both wrote their own projection.
2. **No blend modes.** `sec3-gauntlet` puts `mix-blend-mode` on eight elements
   (lines 35, 38, 52, 58). None of it is reachable with `filter`.
3. **An image source is a fixed string.** Four beats across three files play frame
   sequences off disk (72, 109, 96, 180, 180 frames).
4. **Text is `textContent`.** No styled runs inside a line — no accent word, no
   syntax highlighting.

Nothing else in the C column is large.

---

## 2. Every device found

Class **A** = write it today. **B** = expressible, but many lines or a raw-CSS escape.
**C** = not expressible.

| # | Clip | Device | C | How, or what is missing |
|---|---|---|---|---|
| 1 | all | Beat list — one shot at a time from a table of `{a,b}` | A | That is the timeline. One clip per shot, or one clip with `.start()`/`.exit()`. |
| 2 | hookf, sec2 | Shot entrance: fly in off-screen, overshoot, settle, then a slow drift that keeps going | A | `.enter(620, { x:[520,0], y:[120,0], rotation:[3,0], scale:[1.06,1], blur:[16,0] })` then `.move({x:-70,y:-26}, 5200)`. Sequential tracks concat, which is close enough to hookf's additive entrance+drift. |
| 3 | hookf, sec2 | Entrance smear — `blur = vel²·16` decaying over 620ms | A | `blur: [16, 0]` in the enter spec; `M.enter()` already defaults to it. |
| 4 | all | Fade to/from black, full frame | A | `shape({width:1920,height:1080,background:'#000'}).at(0,0).fade(1,0,600)`. |
| 5 | hookf, sec2 | Screen-recording grade `filter:saturate(1.06) contrast(1.04) brightness(1.03)` (hookf:28) | A | `.tint({ saturation:1.06, contrast:1.04, brightness:1.03 })` — exact. |
| 6 | hookf | Per-word cascade: alternating ±70 y, ±5°, scale .72→1, blur 10→0 (hookf:610-625) | A | `line('bg1', '3,361 people', t, { top:340, size:268, gap:130, alt:true, opacity:fadeIn(0,340), y:change(0,340,70,0,overshoot), rotation:change(0,340,-5,0,easeOut), scale:change(0,340,.72,1,overshoot), blur:change(0,204,10,0,easeOut) })` |
| 7 | hookf | Second line arriving after, 34px rise on `snap` | A | `line(...)` with `from:520, gap:90`. |
| 8 | hookf | Terminal: panel, title bar, three coloured dots, mono body | A | `shape()` + `group().layout('row',{gap:10})` + `.style()`. Verbose, plain. |
| 9 | hookf | Type-on with a blinking block caret (hookf:640-644) | A | `.typeOn(1380, { caret:'▉', blink:430, hold:250 })` — exact, including the purity. |
| 10 | hookf | Node board: dark-glass pills with a coloured rim, label and glow | A | `M.pill(id, text, colour, style)` is literally this object, box-shadow and all. |
| 11 | hookf | Connector curves between pills, drawing themselves on | A | `connect(a, b, { curve:0.3, glow:true }).draw(500)` or `raw('M… C …').draw()`. |
| 12 | hookf | Strike bar growing from its left end (hookf:54-56) | A/B | Width is `.animate('width', [[0,0],[220,610]])`. The **left-end pivot** (`transform-origin:0 50%`) is not — see gap G4. |
| 13 | hookf | Board camera: four framings on a 2560×1440 plane, with a held tilt | A | `camera.focus(n0, 700).focus(n1, 700)…` plus `camera.turn(-9).tilt(2.5)`. |
| 14 | hookf | Far parallax layer: dim ghost pills + stubs, `filter:blur(3.5px);opacity:.44` (hookf:59-60) | A | `group(...).depth(-900).style({ filter:'blur(3.5px)', opacity:.44 })`. Caveat, in the clip and in the library alike: a `filter` flattens `preserve-3d` children, so a blurred group cannot itself contain varying depths. |
| 15 | hookf | Hand-drawn marker arrows — wobbling, double-stroked, bowed, overshooting past the end (`rough()`, hookf:396-419) | **C** | **G6.** `path()` draws a clean bezier. Nothing roughens. |
| 16 | hookf | Arrow heads (`arrowHead()`, hookf:420-425) | **C** | Part of G6 — a `{ arrow:'end' }` option on `path()`/`connect()`. |
| 17 | all | `stroke-dasharray` / `dashoffset` draw-on | A | `.draw(ms)` on `path()`, `raw()`, `connect()`. Every instance in all four files. |
| 18 | hookf | Screen-recording image sequence — `rec/trends/001…072.jpg` indexed by `seg(t)`, `await img.decode()` (hookf:576-582) | **C** | **G3.** `image(src)` takes a fixed string, and the frame apply is synchronous so it cannot await a decode. |
| 19 | hookf | `<canvas>`: rotating wireframe cube, projected by hand (hookf:751-775) | **C** | **G10.** No drawing surface, and no point projection. |
| 20 | hookf | `<canvas>`: scanline raster fill of a triangle (hookf:706-745, currently gated off) | **C** | Same as 19. |
| 21 | hookf | Full-bleed `<img>` with a slow push and a touch of yaw | A | `image().style({width:1920,height:1080,objectFit:'cover'}).animate('scale',…)` + `rotateY`. |
| 22 | hookf | Card cloud: 28 cards on a golden angle, each at its own z with per-card rx/ry/rz | A | Loop of `shape()`/`image()` with `.at()`, `.depth(z)`, `.animate('rotateY'…)`. `rnd(i,s)` is already the same deterministic hash the clip uses. `ring()` places on an ellipse; there is no phyllotaxis helper, but that is three lines. |
| 23 | hookf | Cards back-solved so they land at a chosen **screen** point given their depth (`x = POX+(sx-POX)/k - w/2`, k = 1800/(1800−z), hookf:324-345) | B | `.at()` is world coordinates. The perspective constant is fixed in the shell (`server.mjs:102`) but not published, so the divide has to be re-derived by hand. A `.atScreen(x, y)` would be the primitive. |
| 24 | hookf | Cards dimmed by depth — `brightness(0.15 + 0.85·f(k))` per card | A | `.tint({ brightness })` per node, computed in the loop. |
| 25 | hookf, sec2 | Radial vignettes and scrims: `#cardVig`, `#ueVig`, `#recScrim`, `#glow`, `#spScrim`, `#mdVig`, `#cdScrim` | B | `.gradient()` is linear-only. `shape().style({ background:'radial-gradient(…)' })` works and is one line; only the *stops* cannot animate, and in all seven cases only opacity is animated — which does work. Honestly small; see G8. |
| 26 | hookf | Kinetic type block: rows butted at `line-height:.76`, per-word size, per-row `translateZ`, per-word z fly-in | A | `group()` of rows, `.layout('row')`, `.style({lineHeight:.76})`, per-word `.size()`, per-row `.depth()`, `z:[-260,0]` in the spec. |
| 27 | hookf | The Claude mark: 11 generated SVG arms scaling out one after another **from the hub** | B | Each arm is a `raw(d)` and `.stagger()` gives the cascade, but they all pivot about their own bbox instead of the shared hub — G4. |
| 28 | hookf | Accent word inside a plain sentence (`<em>`, different family, italic, amber — `rich()`, hookf:243-249) | **C** | **G7.** `text()` sets `textContent`. |
| 29 | hookf, sec2 | Posed figure: SVG limbs from keypoints, photo head on top, chin/feet anchored, bob and sway, mirrored by `scale(-1,1)` | B | Mirroring is `scaleX:-1` (A). Bob/sway is `.animate('y', [[0, Math.sin(t/430)*8]])` — a one-keyframe track holding a value computed from `t`, which is legal because the clip re-runs every frame, but reads as a keyframe that is not one. The anchor is G4. The rig itself is application code, not a primitive. |
| 30 | hookf, sec2 | Review caption channel, replaced card by card with no animation | A | `captions([[text, ms], …])` — exactly this, and for the same stated reason. |
| 31 | hookf, sec2 | Per-beat depth travel (`tz` −900→0 on entrance, `dz` after it settles) | A | `z` is animatable in `anim()` and composes into the one transform. |
| 32 | sec2 | Empty editor: chrome, gutter, blinking cursor at 1.06 Hz, "0 lines" | A | Shapes and text; the blink is `Math.floor(t/470)%2` fed into a one-keyframe opacity track. |
| 33 | sec2 | Photo montage — one full-bleed still per card, push + slight roll, grade, scrim | A | One `image()` per card with `.start()` / `.exit()`, `.tint()`, `.animate('scale')`. |
| 34 | sec2 | Strike-through **measured off the rendered glyphs** — `getBoundingClientRect()` of an inline span, then a bowed SVG stroke growing across it (sec2:830-834) | B | `connect(a,b)` already measures two elements every frame, so the machinery exists; there is no way to say "a point on that element's box" as a `path()` coordinate. **G5.** The wobble is **G6**. |
| 35 | sec2 | Full-frame white bloom peaking exactly on a cut (`pow(u,2.1)` up, linear down) | A | Full-bleed `shape` + `.animate('opacity', [[0,0],[170,.66],[310,0]])`. |
| 36 | sec2 | Lit floor plane, hollow sockets, solid plates | A | `shape()` + `.style()`. |
| 37 | sec2 | Contact shadow: wide-and-faint high, tight-and-dark on the frame of contact (sec2:99-101, 943-951) | B | `.shadow()` is a `drop-shadow` filter following the caster's own outline. This is a separate ground element whose **width, height and blur scale independently of the plate**. Needs a spread — see G9's note. |
| 38 | sec2 | Hand-drawn ring round a number: two overlapping sweeps that overshoot, wobble on two sine terms (`ringPath()`, sec2:500-513) | **C** | **G6**, and the clearest case for it: the project's colour language is "red is only ever handwriting". |
| 39 | sec2 | Rings sized as *fractions of the plate* so they survive a size change | B | **G5** — an anchor expressed as a fraction of another element's box. |
| 40 | sec2 | Hairline pin dropping from a plate down to its own year on the timeline | A/B | Height is `.animate('height')`. Its endpoint being another element's position is **G5**. |
| 41 | sec2 | Evidence plate: rise, overshoot, settle; recedes and dims rather than cutting | A | `.enter(620, { y:[120,0], scale:[.94,1] })` + `.exit(340, { y:[0,54], brightness:[1,.45] })`. |
| 42 | sec2 | Timeline: bar, fill growing, ticks, year labels, span labels | A | Shapes and `items()`; the fill is `.animate('width')`. |
| 43 | sec2 | Syntax-highlighted C++ in a `<pre>` — `<b><u><s><q>` runs, `white-space:pre` (sec2:600-660) | **C** | **G7.** The largest single instance of it: three shots of the section are this. |
| 44 | sec2 | Accelerating scroll over the listing, plus a blur that ramps *across* the cuts | A | `.animate('y', [[0,−base],[3400,−base−560]])` with a custom `bezier()`; the cross-shot blur is a track on absolute `t`. |
| 45 | sec2 | 90 bugs: seeded placement, per-bug drop-and-settle, per-bug sine jitter, arrival clustered by `pow(u,0.62)` (sec2:690-700, 1071-1088) | A/B | The loop, the seeded random and the per-item variation are all there (`rnd`, `M.stagger`'s `{each}`). The **non-linear arrival curve** is not: `.stagger(ms)` and `M.stagger(list,t,gap,…)` are a constant gap. **G11.** |
| 46 | sec2 | **Directional blur** — an inline SVG `feGaussianBlur` with `stdDeviation="30 0"`, driven by the velocity of a move (sec2:266-269, 1149-1152) | **C** | **G9.** `blur()` is isotropic and, as the clip's own comment says, "reads as defocus". |
| 47 | sec2 | Whip arrival — 26% of the time covers 60% of the distance, no overshoot | A | `.enter(700, { y:[-198,0], scale:[1.31,1], blur:[11,0] }, bezier(…))` — the custom easing is `bezier()`/`curve()`. |
| 48 | sec2 | Rack focus — 27px resolving to zero on `pow(1-u,1.7)` | A | `blur: change(0, 270, 27, 0, bezier(…))`. |
| 49 | held, gauntlet | **A camera with a position in the space** — `s = F/(z−cz)` per object, cz travelling in depth, passing *through* an object plane at 1.5s (held:342, 624-645); and the matrix camera at gauntlet:167-177 | **C** | **G1.** `camera.zoom/push/pull` writes `scale()` on `#world` (`scene.js:1112-1119`), which changes apparent size uniformly and leaves the parallax ratio between depths untouched. It can never cross a plane. |
| 50 | held | **Per-element depth of field** — `blur = min(26, \|d−focus\|·0.005)`, racked by moving the focus plane, across ~90 objects every frame (held:643) | **C** | **G1.** Per-node blur exists; a *focus plane* the blur is derived from does not. |
| 51 | held | Exposure falloff with depth — `0.26 + 0.74·clamp(1 − (d−focus)/2600)` (held:647) | **C** | **G1.** Same shape of answer: a grade driven by distance from the camera. |
| 52 | held | Camera-velocity smear — `cam(t)` differenced against `cam(t − 1/30)`, converted to a per-element blur and a scaleX stretch (held:622-628) | **C** | **G1** + **G9**. Derivable only because the camera is a pure function of `t` — which the library's is too. |
| 53 | held | The 2×2 revealed by pulling back — nothing arrives, the camera simply retreats | A | `camera.pull()` with everything already placed. Covered today, and worth saying so: it is the clip's own headline argument and it needs no new primitive. |
| 54 | held | Painting order and near-clipping from depth (`zIndex = 24000 − d`, hide when `d < 260`) | A | `preserve-3d` on `#__world` does the ordering for free; `.animate('zIndex', …)` if you want it explicit. |
| 55 | held | Row-wise clear — a hard horizontal edge sweeping top to bottom, 380ms, linear, via `clip-path: inset()` (held:661) | A *(in flight)* | `.showWhere(bar)` with a `shape()` that `.move()`s down. `.animate('clipPath', …)` would **not** work — `track()` interpolates numbers, so a string track holds its first value. |
| 56 | held | Type unrolling from its own baseline — `scaleY(0→1)` about the bottom edge (held:675) | B | `scaleY` is animatable; the bottom-edge pivot is **G4**. |
| 57 | held | Image sequence looped seamlessly — 180 frames, `floor(t/(1000/30)) % 180`, preloaded pool, `await decode()` (held:606-613) | **C** | **G3.** Two of the four panes run for the whole cut on this. |
| 58 | held | Field of ~90 background frames placed on a jittered grid with a 17% dropout | A | `grid(i, 13, …)` + `rnd(i, s)`, both already deterministic. |
| 59 | held | Halo animated on a pane — `box-shadow: 0 0 300px 110px rgba(242,115,26,.20)`, warming as the pane returns (held:667-671) | B | `.glow(300)` is two `drop-shadow`s off the **alpha**. There is no **spread**, so a 110px pad of soft light off a rectangle's edges cannot be matched. See G9's note. |
| 60 | gauntlet | **Blend modes** — `mix-blend-mode:screen` on the chromatic-separation layer, on four per-plate blooms and on `#wash`; `overlay` on the grain (gauntlet:35, 38, 52, 58) | **C** | **G2.** No `filter` chain adds light. |
| 61 | gauntlet | Chromatic aberration — the same still twice, `sepia(1) saturate(6) hue-rotate(∓38°)`, offset ±30px, screened, converging (gauntlet:291-292) | B | The grade is `.tint({ sepia:1, saturation:6, hue:-38, brightness:.85 })` **exactly**, and the offset is `.move()`. Only the `screen` is missing. Worth noting: the effects stack that just landed does most of this device on its own. |
| 62 | gauntlet | Procedural film grain — 180×180 seeded noise on a canvas, `toDataURL()`, scrolled per frame by a hashed offset, `overlay` at .045 (gauntlet:179-183, 288-289) | **C** | **G10** + **G2**, plus animating `background-position` (taken by `gradientShift`). |
| 63 | gauntlet | Screen-space annotations pinned to the **projection of a world point on a tilted plate** (gauntlet:264-273) | **C** | **G5.** The overlay deliberately lives outside `#cam` — unrotated, unblurred — while tracking a 3D point. `centreOf()` (`scene.js:1078`) walks the offset chain *specifically to ignore* the camera, which is the opposite of what this needs. |
| 64 | gauntlet | Leader line: length and angle computed from the delta to its anchor, drawn from its own left end | B | **G5** for the anchor, **G4** for the pivot. |
| 65 | gauntlet | Drawn window chrome whose four edges grow in sequence (`drawEdges`) | A | Four `shape()`s, `.stagger(130)`, `.animate('width'/'height')`. |
| 66 | gauntlet | Keyframed camera path with per-key easing — `[t, x, y, z, ry, rx, rz, focusZ, ease]` | B | `camera.to().turn().tilt().roll()` chains with `camera.ease()` per move, so the x/y/rotation half is A. `z` and `focusZ` are **G1**. |
| 67 | gauntlet | One measured "unit move" (approach / dwell / departure) instanced against all four plates | A | A function in `projects/<name>/lib/*.js` returning the camera chain — the README's shared-code section is this exact case. |
| 68 | gauntlet | Words flying past the camera — z relative to the *camera's own* z, blur ramping on `fly²·20` | B | `z` animates fine; expressing it relative to where the camera is, is **G1**. |
| 69 | all | Halos, four different techniques: `text-shadow` (hookf:92-93), `drop-shadow` on SVG (hookf:271), `box-shadow` with spread + `inset` (hookf:32, 53; held:667), `drop-shadow` cast shadow (hookf:105) | A / B | `.glow()` covers the first two exactly — two stacked `drop-shadow`s at 0.4r and r, off the alpha, so text glows its glyphs and a path glows its stroke. `.shadow()` covers the fourth. **`box-shadow` with a spread, and `inset` (an inner rim), are not reachable** — see G9's note. |

---

## 3. The gap list

Ordered by how much each unlocks. Doc comments in `scene.js` house style.

---

### G1 — A camera that has a position, a focus plane and a velocity

**Unlocks:** all of `sec3-held` (the push through the RENDERING socket at 1.5s, the
pass-*through*, the three swings, the accelerating burst, the pull-back reveal, the
per-element DOF across ~90 objects, the exposure falloff, the speed smear) and all of
`sec3-gauntlet`'s camera path; `hookf`'s and `sec2`'s per-beat `tz`/`dz` depth travel
(which they currently animate on the *subject* because the camera cannot move).

**What is missing.** `camera.zoom/push/pull` writes `scale()` on `#world`
(`scene.js:1112`), under a `perspective:1800px; perspective-origin:50% 45%` fixed in
the shell (`server.mjs:102`). A scale changes apparent size uniformly: it does **not**
change the parallax ratio between two depths, and it can never put the lens past an
object. `sec3-held`'s own D1 note names the two things that forced it to write a
software projection: (a) a `filter` flattens `preserve-3d` children, so per-element
DOF is impossible on a CSS-perspective stage; (b) `perspective-origin` is pinned, so
the camera cannot travel off-axis.

`sec3-gauntlet` shows the cheaper half is reachable in CSS —
`translateZ(PER) rotateZ rotateX rotateY translate3d(-x,-y,-z)` on a container
(gauntlet:202) is a real dolly with off-axis rotation. So this splits: **`camera.dolly()`
in the existing CSS model** covers 49, 66 and 68, and a **`camera.lens()` mode that
projects each node itself** is what 50, 51 and 52 need.

```js
/** camera.dolly(by, durationMs)   @camera
 *  Moves the camera along its own axis, in the same pixels .depth() uses.
 *
 *  This is not .push(). A push is a scale: everything grows by the same
 *  factor and the picture is the same picture, larger. A dolly changes where
 *  the lens IS, so what is near grows faster than what is far, the framing
 *  opens as you approach, and something at .depth(400) will pass behind you
 *  and out of frame rather than filling it.
 *  ex  camera.dolly(900, 1400);
 *  ex  camera.dolly(-2400, 1800).ease('easeInOut');
 */

/** camera.focusAt(depth, durationMs, options)   @camera
 *  Puts the focus plane at this depth. Anything off it is blurred in
 *  proportion to how far off it is, so depth of field falls out of geometry
 *  instead of being a number typed onto each element.
 *
 *    aperture  blur pixels per 1000 units off the plane, default 5
 *    max       the most blur any one thing gets, default 26
 *
 *  Racking is moving this, which is one statement rather than one per object.
 *  ex  camera.focusAt(0, 0, { aperture: 5 }).focusAt(-900, 700);
 */

/** camera.expose(options)   @camera
 *  How light falls off with distance behind the focus plane, so the back of
 *  a deep scene reads as unlit shapes rather than as small copies.
 *
 *    floor  the dimmest anything gets, 0 to 1, default 0.26
 *    over   the distance across which it falls to the floor, default 2600
 *  ex  camera.expose({ floor: 0.26, over: 2600 });
 */
```

`camera.speed(t)` falls out for free: the camera is already a pure function of `t`, so
differencing it by one frame gives the velocity `sec3-held` uses for its smear (see G9).

---

### G2 — Blend modes

**Unlocks:** `sec3-gauntlet`'s chromatic-separation layer, its four per-plate blooms,
`#wash` and `#grain` — eight elements, four of the file's own devices. Also every
"light laid over footage" in the set that is currently faked with an opacity ramp.

**What is missing.** Nothing. `filter` is a per-element pipeline; it cannot combine one
element with what is behind it. `screen` and `overlay` are how added light and film
grain are made, and there is no substitute.

```js
/** .blend(mode)   @look
 *  How this is combined with what is behind it, instead of simply covering
 *  it. 'screen' adds light — a bloom, a wash, a lens flare, the two halves of
 *  a chromatic split. 'multiply' takes it away. 'overlay' is grain and
 *  texture. 'normal', the default, is paint on top.
 *
 *  This is the one thing a filter cannot do: a filter only ever sees the
 *  element itself, and light added to a picture is a fact about two layers.
 *
 *  Note that a blended element reads the layers UNDER it in its own stacking
 *  context, so a full-frame wash blends with the whole frame and a bloom
 *  placed inside a group blends only with that group.
 *  ex  bloom.blend('screen').fade(0, 1, 400);
 *  ex  grain.blend('overlay').style({ opacity: .045 });
 */
```

---

### G3 — An image source that is a function of time

**Unlocks:** `hookf`'s three screen-recording beats (72, 109 and 96 frames off disk,
indexed by progress through the shot); `sec3-held`'s two live-capture panes (180 frames
each, looped seamlessly for the whole 17.6s cut); `sec3-gauntlet`'s spin sequence.
Four beats across three of the four clips.

**What is missing.** `image(src)` takes a fixed string (`scene.js:1817`). Two halves:
a source picked from `t`, and — because a source swapped without a decode shows a gap —
**the frame apply has to be able to wait**. All four clips' `__render` are `async` and
every one of them awaits `img.decode()`.

```js
/** .frames(pattern, options)   @make
 *  Plays a numbered image sequence off disk, choosing the frame from t rather
 *  than counting up — so it scrubs backwards exactly and a render can ask for
 *  frame 900 cold.
 *
 *    from   first number, default 1
 *    count  how many
 *    fps    default 30
 *    loop   true to wrap, so a six-second turn runs under a longer shot
 *    pad    digits, default 4 — 'rec/trends/%.jpg' with pad 3 gives 001.jpg
 *
 *  Every frame is preloaded and decoded before the clip reports ready, so the
 *  sequence never shows a gap and never waits mid-shot.
 *  ex  image('rec/trends/%.jpg').frames({ count: 72, pad: 3 }).during(shot);
 *  ex  image('win/w%.jpg').frames({ from: 1, count: 180, fps: 30, loop: true });
 */
```

---

### G4 — A pivot

**Unlocks:** more devices than anything else on the list for the work involved. Every
rotate and every scale in the library turns about the element's own centre. The four
clips pivot about, in order of appearance: the feet (`transform-origin:50% 100%`,
hookf:104), the left end (`0 50%`, hookf:55 and gauntlet:44, 60), the hub of a
generated mark (hookf:88), the bottom edge of a plate (sec2:138), a measured chin
percentage (sec2:1108, 1140), the bottom-left corner (held:261) and the bottom edge
again for held's type unroll (held:675).

```js
/** .pivot(x, y)   @look
 *  The point a rotate or a scale turns about, as a fraction of the thing's
 *  own box: (0, 0) is its top-left, (0.5, 0.5) the centre — the default — and
 *  (0, 1) its bottom-left corner.
 *
 *  This is what separates a bar that grows from its left end from one that
 *  grows from the middle, a figure that leans from the feet from one that
 *  spins about its waist, and a line of type that unrolls from its baseline
 *  from one that swells out of nothing.
 *  ex  rule.pivot(0, 0.5).scale(0, 1, 700);
 *  ex  figure.pivot(0.5, 1).rotate(0, -4, 900);
 */
```

---

### G5 — Anchors: a point on another element, and a world point in screen space

**Unlocks:** `sec2`'s strike measured off the rendered glyphs, its rings sized as
fractions of a plate, its hairline pinned to its own year on the timeline;
`sec3-gauntlet`'s four leader lines and four stamps, which sit in screen space —
unrotated, unblurred — while tracking a point on a tilted plate; `hookf`'s annotation
arrow endpoints.

**What is missing.** Half the machinery is already there: `connect(a, b)` measures both
elements' boxes every frame and re-routes if they move (`scene.js:1500-1510`). What is
missing is that measurement as a **coordinate you can use anywhere** — a `path()` point,
an `.at()`, a `via` waypoint. And the second half is the inverse of `centreOf()`
(`scene.js:1078`), which deliberately walks the offset chain to *ignore* the camera —
right for framing, exactly wrong for pinning an overlay to something in the space.

```js
/** on(thing, at)   @place
 *  A point on another element's box, as a coordinate. `at` is a pair of
 *  fractions — [0, 0] its top-left, [0.5, 0.5] its centre, [1, 0.5] the middle
 *  of its right edge — or one of 'left' 'right' 'top' 'bottom' 'centre'.
 *
 *  It is measured every frame, so whatever it is attached to can move, grow
 *  or be re-typed and the thing hanging off it follows. That is what lets a
 *  strike be the width of the WORD rather than of the line it sits on.
 *  ex  path([on(word, [0, .54]), on(word, [1, .54])], { width: 11 }).draw(300);
 *  ex  pin.at(on(plate, [.42, 1]));
 */

/** screen(thing, at)   @place
 *  The same point, but where it lands ON SCREEN after the camera has had its
 *  way with it — including depth, rotation and the perspective divide.
 *
 *  Use it to hang something that must NOT travel with the space — a stamp, a
 *  leader line, a callout that has to stay level and sharp — off something
 *  that does.
 *  ex  stamp.at(screen(plate, [1, .5])).style({ position: 'fixed' });
 */
```

---

### G6 — Roughening: a hand-drawn quality as an option on any path

**Unlocks:** `hookf`'s four annotation arrows (`rough()`, hookf:396-419) and their
heads; `sec2`'s twice-round wobbling rings round the numbers being spoken
(`ringPath()`, sec2:500-513) and its bowed strike stroke. Three of the four clips, and
the project's stated colour rule — red is *only ever* handwriting — depends on there
being a visible difference between a drawn mark and a vector one.

**What is missing.** `path()` and `raw()` draw a clean bezier. The clips' `rough()` is
a specific, reusable recipe: two offset passes, a bow along the run, a sine wobble
seeded per mark, and an overshoot past the end "like a real marker".

```js
/** path(points, options) — rough   @make
 *  options.rough turns a clean stroke into a drawn one. true for the house
 *  hand; an object to tune it.
 *
 *    wobble     how far the line wanders off true, as a fraction of its own
 *               length, default .04
 *    bow        how much it arcs rather than running straight, default .17
 *    passes     how many times the pen goes over it, default 2 — one pass
 *               reads as a shaky vector, two as a marker
 *    overshoot  pixels past the end, default 13
 *    seed       the same seed always draws the same mark, so it is still a
 *               pure function of t
 *    arrow      'end', 'start' or 'both' to put a head on it
 *
 *  Chain .draw(ms) and it writes on the way a hand does, because it IS the
 *  path — nothing about the roughening is a second code path.
 *  ex  path([[340, 452], [400, 560]], { rough: true, arrow: 'end', color: '#35d6d6' }).draw(420);
 *  ex  ring.path({ closed: true, rough: { passes: 2, wobble: .035 } });
 */
```

A `ring()`-shaped convenience — an ellipse of points closed on itself — makes the
sec2 case one line rather than a loop.

---

### G7 — Styled runs inside one line of text

**Unlocks:** `hookf`'s accent word (`<em>` — different family, italic, amber, inside an
otherwise plain sentence, hookf:243-249 and CSS line 17) and its per-word `<i>` spans;
`sec2`'s syntax-highlighted C++, which is three whole shots of the section
(`<b>` keyword, `<u>` type, `<s>` comment, `<q>` number, sec2:169-172, 600-660);
`sec3-held`'s log lines, where a step label and a quotation share one line at different
sizes and colours (held:271-274).

**What is missing.** `text()` sets `textContent` (`M.label`, `motion.js:554-562`).
`stack()` gives per-**line** styling and `items()` per-**item**, but neither flows
inline, so a word cannot be emphasised mid-sentence and code cannot be coloured.

```js
/** text([...parts])   @make
 *  Given a list instead of a string, the parts flow as one line and each may
 *  carry its own look. A part is a string, or [string, { ...style }].
 *
 *  This is what an emphasised word is: not a second element positioned next
 *  to the sentence, but a run inside it that wraps and re-flows with the
 *  rest. It is also what syntax highlighting is, and what a label-plus-quote
 *  on one line is.
 *
 *  Every part is still addressable — .stagger() cascades them, and .mark()
 *  restyles the ones that match.
 *  ex  text(['or whether it can build anything ',
 *  ex        ['reasonable', { font: 'Fraunces 72pt Black', italic: true, color: '#ffb02e' }],
 *  ex        ' at all']).size(88).center(462);
 */

/** .mark(pattern, style)   @look
 *  Restyles every run of this text that matches, without splitting it by
 *  hand. pattern is a string or a regular expression.
 *  ex  headline.mark('reasonable', { color: '#ffb02e', italic: true });
 *  ex  listing.mark(/^\s*\/\/.*$/m, { color: '#5c6470' });
 */
```

---

### G8 — Radial and conic gradients (small)

**Unlocks:** the seventeen vignettes, scrims, floors, washes and soft fields across the
four files. Listed **last of the real gaps and deliberately small**, because
`shape().style({ background: 'radial-gradient(…)' })` already does every one of them in
one line, and in all seventeen the only thing animated is opacity, which works today.
What is not reachable is animating a **stop position** or the gradient's centre —
which none of the four clips does. Add `shape: 'radial' | 'conic'`, `at` and `size` to
`.gradient()` when it is cheap; do not build it before G1-G7.

---

### Two one-property additions, not gaps

**G9 — directional blur.** `sec2` writes an inline SVG `feGaussianBlur` with
`stdDeviation="30 0"` (sec2:266-269) specifically because, in its own words, "CSS
`filter:blur()` is isotropic and reads as defocus; a smear has to be on the axis of
travel". `sec3-held` fakes the same thing with a `scaleX` stretch (held:627). The
filter machinery in `anim()` already composes a fixed pipeline; this is `blurX` and
`blurY` in the animatable set, backed by one SVG filter def. It also completes G1's
velocity smear.

**Glow spread and inner glow.** `.glow()` is two stacked `drop-shadow`s off the alpha
— right for text and for a stroke, and it matches `text-shadow: 0 0 34px …` (hookf:92)
and `drop-shadow(0 0 26px …)` (hookf:271) exactly. It cannot express
`box-shadow: 0 0 58px #ffb02e55, inset 0 0 34px #ffb02e22` (hookf:53, and `M.pill()`
hard-codes it) or `0 0 300px 110px rgba(242,115,26,.20)` (held:667, animated). Two
options on the existing method: `spread` and `inset`. Same for `.shadow()`'s
`shadowSpread`, which is what `sec2`'s contact shadow needs.

**G11 — stagger by a curve.** `sec2` arrives 90 bugs on `pow(u, 0.62)` so the swarm
clusters at the end, and says why: an earlier linear ramp "left the last second and a
half with nothing new happening in it". `.stagger(ms)` and `M.stagger(list, t, gap, …)`
are a constant gap; `{each}` varies the spec, not the delay. `.stagger(ms, { curve })`,
where `curve` reshapes `i/n` before it becomes a delay.

---

## 4. Things that look like gaps and are not

Worth stating plainly so they do not get built.

- **The reveal-by-pull-back**, `sec3-held`'s headline argument, needs nothing new:
  place everything, `camera.pull()`.
- **Deterministic randomness.** `rnd(i, seed)` is the same `sin·43758.5453` hash all
  four clips wrote for themselves.
- **Custom easings.** `bezier()` and `curve()` cover every one of the fourteen easings
  across the four files, including `sec3-held`'s Newton-solved `cubic-bezier(.42,.02,.22,1)`.
- **Colour grading.** `.tint()` matches `sepia(1) saturate(6) hue-rotate(-38deg)
  brightness(.85)` (gauntlet:291) term for term.
- **A repeated, measured camera move instanced against several objects** —
  `sec3-gauntlet`'s `UNIT`: a function in `projects/<name>/lib/*.js`.
- **A caption channel that cuts card to card** — `captions()`, for the same reason.
- **Procedural motion** (a sine bob, a blinking cursor, a jitter): the clip body
  re-runs every frame with `t` in scope, so `.animate('y', [[0, Math.sin(t/430)*8]])`
  is correct and pure. It reads oddly — a keyframe that is not one — and a `.set(prop,
  value)` would say it better, but nothing is blocked.

## 5. One documentation defect noticed in passing

`README.md` lists `css()` and `html()` as escape hatches (the editing-library table,
and the `A shape is a mouse job` section). Neither is in `motion.js`'s exported API
(`motion.js:896-901`). The escape hatch that actually exists is `box(id, { …css })`
plus `$(id)`. Given how many of the B rows above resolve to "drop to raw CSS", that
gap between the documented and the real matters more than its size suggests.
