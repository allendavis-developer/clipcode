/* ============================================================================
   The scene layer: motion described as choreography.

   This sits on top of motion.js and is what most clips should be written in.
   motion.js is still there underneath, unchanged, for the cases this cannot
   say. Nothing here is required; the two can be mixed in one clip.

   The difference is what a clip IS. In motion.js a clip is a set of objects
   with absolute timestamps on them. Here a clip is a DEPENDENCY GRAPH: an
   object's start can be given as a relationship to another object's, and the
   timeline is resolved from those relationships every frame.

       title.enter(300);
       subtitle.enter(250).after(title, 80);
       chart.draw(600).after(subtitle, -120);

   That is the sentence a person actually has in their head. It also survives
   editing: change the title to 500ms and everything downstream moves with it,
   still 80ms behind, because the 80 is what was written down and the 380 was
   only ever a consequence of it. In a timeline of absolute timestamps that
   same change means repairing every number after it by hand.

   ------------------------------------------------------------------ identity

   Elements have no ids here. text('hello') is enough.

   That works because a clip is re-run from the top on every single frame, so
   the ORDER of the calls is a stable identity: the third text() call is the
   same element on every frame, forever. A counter is reset at the start of
   each frame and handed out in order.

   The rule that comes with it: creation calls must happen in the same order
   every frame. A create inside an `if (t > 500)` breaks that, and everything
   after it changes identity halfway through the clip. Create unconditionally
   and animate conditionally, which is what you want anyway — see the note on
   purity in the reference.

   -------------------------------------------------------------- three layers

   Common motion is one chained sentence:      title.enter(300, 'pop');
   With detail, when the preset is not it:     title.enter(300, { scale: [.8, 1] });
   And raw keyframes as the escape hatch:      title.animate('scale', [[0,.8],[220,1.08],[300,1]]);

   You should almost never need the third.
   ========================================================================== */
(function (W, D) {
  'use strict';

  var M = W.M;                      /* motion.js, the layer underneath */
  if (!M) return;

  /** How a clip works   @start
   *  A clip is code that runs once for every frame. It is given one variable,
   *  t, the number of milliseconds since the clip started.
   *
   *  The code does not advance time and does not wait. It answers one
   *  question: at time t, what does the frame look like? The editor calls it
   *  again with a different t for the next frame.
   *
   *  So there is no play, no wait and no then. You describe what things do
   *  across a span of time, and the editor asks for whichever moment it needs.
   *  ex  text('3361 people')
   *  ex    .font('Figtree Black', 268)
   *  ex    .color('#e12392')
   *  ex    .at(90, 340)
   *  ex    .enter(340, 'pop');
   */

  /** Timing is relationships, not timestamps   @start
   *  You can give a start time directly with .start(600), but it is usually
   *  better to say what a thing happens relative to.
   *
   *    .after(other, gap)   when other finishes, plus a gap
   *    .with(other)         at the same moment as other
   *    .before(other, gap)  gap milliseconds before other starts
   *    .alignEnd(other)     finishing when other finishes
   *    .during(other)       covering other's whole span
   *
   *  A negative gap overlaps two things.
   *
   *  This is worth the habit. Written this way, changing the title from 300ms
   *  to 500ms moves everything after it and keeps the choreography, because
   *  the gap is what you wrote down and the absolute time was only ever a
   *  consequence of it. Written as timestamps, the same change means fixing
   *  every number after it by hand.
   *  ex  title.enter(300);
   *  ex  subtitle.enter(250).after(title, 80);
   *  ex  chart.draw(600).after(subtitle, -120);
   */

  /** How long a clip is   @start
   *  If the clip never calls duration(ms), it is exactly as long as its
   *  choreography: the end of the last thing that happens. Change a timing
   *  and the clip on the timeline changes with it.
   *
   *  Call duration(ms) when you want to fix the length yourself, for instance
   *  to hold on the last frame after everything has arrived.
   *  ex  duration(2200);
   */

  /** Rendering must be repeatable   @start
   *  The same t must always produce the same frame.
   *
   *  Do not use setTimeout, CSS transitions, Math.random, or any value that
   *  accumulates between calls. If a frame depends on the frames drawn before
   *  it, scrubbing backwards will not match scrubbing forwards and an export
   *  will match neither. Playback still looks correct while this is broken,
   *  which is what makes it hard to notice.
   *
   *  The same rule is why things are created unconditionally. Identity here
   *  comes from the order of the calls, so a create inside an `if` changes
   *  what everything after it refers to. Create always, animate conditionally.
   *
   *  For values that should look random, use rnd(i), which returns the same
   *  number every time for the same i.
   *  ex  text('one');            // always created
   *  ex  text('two');
   */

  /* Everything declared this frame. Rebuilt from nothing on every frame, which
     is what keeps the render a pure function of t. */
  var nodes = [];
  var counter = 0;
  /* Latched for the life of the page, not the frame: it is what says whether
     the matte pass has anything to clean up. A clip that never masks anything
     never pays for the pass, and one that stops masking still gets the mask
     taken off the element it was on. */
  var everMasked = false;
  var camera = null;                /* the one camera, rebuilt each frame */
  var W_ = W.__stageW, H_ = W.__stageH;
  var idFor = function (kind) { return 's' + (counter++) + kind.charAt(0); };

  /* ------------------------------------------------------------- presets -- */
  /* Named entrances. A preset is only a spec with the numbers already chosen,
     so anything a preset does you can also write out by hand. */
  var ENTER = {
    fade:  { opacity: [0, 1], ease: 'easeOut' },
    pop:   { opacity: [0, 1], scale: [0.72, 1], ease: 'overshoot' },
    rise:  { opacity: [0, 1], y: [70, 0], ease: 'overshoot' },
    drop:  { opacity: [0, 1], y: [-70, 0], ease: 'overshoot' },
    slide: { opacity: [0, 1], x: [-90, 0], ease: 'easeOut' },
    grow:  { opacity: [0, 1], scale: [0.4, 1], ease: 'settle' },
    spin:  { opacity: [0, 1], scale: [0.7, 1], rotation: [-12, 0], ease: 'overshoot' },
    /* arrives out of focus and resolves — an entrance, not a look: everything
       is sharp once it has landed */
    focus: { opacity: [0, 1], blur: [14, 0], scale: [1.06, 1], ease: 'easeOut' },
    /* comes at you from behind the lens and stops in the plane of the stage */
    fly:   { opacity: [0, 1], z: [-1400, 0], ease: 'easeOut' }
  };
  var EXIT = {
    fade:  { opacity: [1, 0], ease: 'easeIn' },
    pop:   { opacity: [1, 0], scale: [1, 0.8], ease: 'easeIn' },
    rise:  { opacity: [1, 0], y: [0, -70], ease: 'easeIn' },
    drop:  { opacity: [1, 0], y: [0, 70], ease: 'easeIn' },
    slide: { opacity: [1, 0], x: [0, 90], ease: 'easeIn' }
  };

  /* which spec keys are motion rather than settings */
  var NOT_A_PROPERTY = { ease: 1, from: 1 };

  /* the properties that have a direction, and so can be reversed. scale and
     opacity have a size but not a side, which is why .alternate() cannot do
     anything with them. */
  var DIRECTIONAL = { x: 1, y: 1, rotation: 1, rotateX: 1, rotateY: 1 };

  /* -------------------------------------------------------------- a node -- */
  function Node(kind, opts) {
    this.alt = false;                 /* every second child reversed */
    this.z = 0;                       /* depth, in pixels from the stage plane */
    this.kind = kind;                 /* text | image | shape | group | items */
    this.id = idFor(kind);
    this.opts = opts || {};
    this.css = {};                    /* fixed appearance */
    /* Effects set once rather than animated. They are held as TRACKS, not as
       CSS, so that a look and a move of the same name meet in one spec and
       compose instead of one of them writing style.filter last and winning. */
    this.fx = {};
    this.mask = null;                 /* {of, invert, feather, show} */
    this.moves = [];                  /* {at, dur, spec} in node-local time */
    this.children = [];               /* for group and items */
    this.gapMs = 0;                   /* stagger between children */
    this._start = 0;
    this._rel = null;                 /* how this node's start is defined */
    this._cursor = 0;                 /* where the next un-timed move goes */
    nodes.push(this);
  }

  var P = Node.prototype;

  /* ------------------------------------------------------------ the look -- */

  /** .font(family, size)   @look
   *  Sets the typeface, and the size in pixels if you give one. Use the font
   *  picker above the code to get an exact family name.
   *  ex  text('3361 people').font('Figtree Black', 268)
   */
  P.font = function (family, size) {
    if (family) this.css.fontFamily = "'" + family + "', system-ui, sans-serif";
    if (size !== undefined) this.css.fontSize = size;
    return this;
  };

  /** .size(fontSizePx)   @look
   *  Font size in pixels, when you are not also setting the family.
   *  ex  text('a note').size(90)
   */
  P.size = function (px) { this.css.fontSize = px; return this; };

  /** .color(value)   @look
   *  Any CSS colour.
   *  ex  text('3361 people').color('#e12392')
   */
  P.color = function (c) { this.css.color = c; return this; };

  /** .italic()   @look
   *  ex  text('3361 people').font('Fraunces 72pt Black', 268).italic()
   */
  P.italic = function () { this.css.fontStyle = 'italic'; return this; };

  /** .weight(n)   @look
   *  100 to 900. Only has an effect if the family has that weight; most of the
   *  fonts worth using ship one file per weight, so the family name usually
   *  carries it instead ('Figtree Black').
   *  ex  text('a note').weight(700)
   */
  P.weight = function (n) { this.css.fontWeight = n; return this; };

  /** .center(topPx)   @look
   *  Centres it across the stage, rather than placing its left edge. Give a y
   *  to set the vertical position at the same time.
   *  ex  text('3361 people').center(340)
   */
  P.center = function (y) {
    this.css.left = 0;
    this.css.right = 0;
    this.css.textAlign = 'center';
    this.css.justifyContent = 'center';
    this.css.justifyContent = 'center';
    if (y !== undefined) this.css.top = y;
    return this;
  };

  /** .at(x, y)   @look
   *  Where it sits, in stage pixels from the top-left. This is position, not
   *  time; for time use .start(), .after(), .with() or .before().
   *  ex  text('3361 people').at(90, 340)
   */
  P.at = function (x, y) {
    if (x !== undefined) this.css.left = x;
    if (y !== undefined) this.css.top = y;
    /* Placed by its left edge, so it is as wide as its content. Text defaults
       to a full-width centred line underneath, and leaving that `right: 0` in
       place would make a four-letter word measure most of the stage — which
       reads fine until the camera tries to frame it. */
    if (x !== undefined && this.css.right === undefined) {
      this.css.right = 'auto';
      if (this.css.textAlign === undefined) this.css.textAlign = 'left';
    }
    return this;
  };

  /** .depth(z)   @look
   *  How far from the lens it sits, in pixels. 0 is the plane of the stage,
   *  negative is further away, positive is closer to you.
   *
   *  This is what makes a camera move read as space rather than as zoom.
   *  Something at -800 draws smaller and shifts LESS than something at 0 when
   *  the camera moves, and when the camera pushes in, the near thing leaves
   *  frame long before the far one does. None of that is animated — it falls
   *  out of the stage's perspective, so you get it by saying where things are
   *  rather than by keyframing what they do.
   *  ex  headline.depth(0);
   *  ex  chart.depth(-200);
   *  ex  backdrop.depth(-900);
   */
  P.depth = function (z) { this.z = z || 0; return this; };

  /** .style({ ... })   @look
   *  Any CSS, for the things the named methods do not cover. Numbers are
   *  treated as pixels.
   *  ex  text('heads up').style({ letterSpacing: -4, textShadow: '0 6px 30px #000' })
   */
  P.style = function (o) { for (var k in o) this.css[k] = o[k]; return this; };

  /* ---------------------------------------------------------- the effects --

     Six primitives, not a shelf of named looks. Each one is a small set of
     numbers that go into the same spec as x, y and opacity, so every one of
     them animates by writing a pair instead of a value:

         badge.glow(24);                        a standing look
         badge.enter(300, { glow: [0, 24] });   the same thing, arriving

     That is the whole reason these are properties rather than CSS: a look you
     can only set is a look you cannot choreograph, and choreography is what
     this editor is. They compose because motion.js gathers everything that
     shares one CSS property — the filter, the background-image, the text
     stroke — and writes it once in a fixed order. */

  /** .glow(radiusPx, colour)   @look
   *  A halo of light around the thing, in its own colour unless you name one.
   *
   *  It is two stacked haloes rather than one, a tight one inside a wide faint
   *  one, because a single shadow reads as a rim drawn on the edge and two
   *  read as light coming off the object.
   *
   *  Animate it with glow: [from, to] in any spec, which is where it earns its
   *  keep — a number that lights up as it lands.
   *  ex  text('3361').color('#ffb02e').glow(30);
   *  ex  text('3361').color('#ffb02e').enter(400, { opacity: [0, 1], glow: [0, 40] });
   */
  P.glow = function (px, colour) {
    this.fx.glow = M.hold(px === undefined ? 24 : px);
    if (colour) this.fx.glowColor = colour;
    return this;
  };

  /** .shadow(offsetX, offsetY, blurPx, colour)   @look
   *  A cast shadow. It follows the shape's own outline rather than its box, so
   *  text throws a shadow of the letters and a path throws one of the line.
   *
   *  Animate it with shadowX, shadowY or shadowBlur: a shadow that grows and
   *  slides as something rises is what makes it read as lifting off the page
   *  rather than as getting bigger.
   *  ex  card.shadow(0, 24, 60, 'rgba(0,0,0,.6)');
   *  ex  card.enter(400, { y: [40, 0], shadowY: [4, 30], shadowBlur: [10, 70] });
   */
  P.shadow = function (x, y, blur, colour) {
    this.fx.shadowX = M.hold(x || 0);
    this.fx.shadowY = M.hold(y === undefined ? 14 : y);
    this.fx.shadowBlur = M.hold(blur === undefined ? 30 : blur);
    if (colour) this.fx.shadowColor = colour;
    return this;
  };

  /** .tint(options)   @look
   *  A colour grade: the whole thing pushed around the colour wheel or drained
   *  of colour, rather than recoloured element by element.
   *
   *    hue         degrees around the wheel
   *    saturation  1 is unchanged, 0 is grey, 2 is twice as strong
   *    brightness  1 is unchanged
   *    contrast    1 is unchanged
   *    grayscale   0 to 1
   *    sepia       0 to 1
   *    invert      0 to 1
   *
   *  All seven animate under those names, so a shot can drain to grey as it
   *  leaves or a photograph can arrive already graded and resolve.
   *  ex  photo.tint({ saturation: 0.2, contrast: 1.3 });
   *  ex  photo.enter(600, { opacity: [0, 1], grayscale: [1, 0], contrast: [1.6, 1] });
   */
  P.tint = function (o) {
    o = o || {};
    var K = ['hue', 'saturation', 'brightness', 'contrast',
             'grayscale', 'sepia', 'invert'], i;
    for (i = 0; i < K.length; i++)
      if (o[K[i]] !== undefined) this.fx[K[i]] = M.hold(o[K[i]]);
    return this;
  };

  /** .gradient([colours], options)   @look
   *  Fills the thing with a gradient instead of a flat colour. On text the
   *  gradient is painted THROUGH the letters, which is the only way CSS has to
   *  fill type with anything but one colour.
   *
   *    angle  degrees, 90 being left to right and 0 bottom to top
   *    sweep  true makes the gradient wider than the thing, so gradientShift
   *           has somewhere to slide it — a highlight crossing a word is that
   *           and nothing else
   *
   *  gradientAngle and gradientShift both animate.
   *  ex  text('SOLD OUT').size(200).gradient(['#ffb02e', '#e12392']);
   *  ex  text('SOLD OUT').size(200)
   *  ex    .gradient(['#333', '#fff', '#333'], { sweep: true })
   *  ex    .enter(900, { gradientShift: [0, 100] });
   */
  P.gradient = function (colours, o) {
    o = o || {};
    var list = (colours && colours.length) ? colours : ['#fff', '#fff'];
    this.fx.gradientColors = list;
    this.fx.gradientAngle = M.hold(o.angle === undefined ? 90 : o.angle);
    /* Type has to become transparent for a background to show through it;
       there is no other way to put a gradient inside a letterform. */
    if (this.kind === 'text' || this.kind === 'group' || this.kind === 'items') {
      this.css.webkitBackgroundClip = 'text';
      this.css.backgroundClip = 'text';
      this.css.color = 'transparent';
    }
    this.css.backgroundRepeat = 'no-repeat';
    this.css.backgroundSize = o.sweep ? '300% 100%' : '100% 100%';
    return this;
  };

  /** .outline(widthPx, colour)   @look
   *  A stroke around the letters. With .color('transparent') under it you get
   *  hollow type, which is the other half of every headline that fills in.
   *
   *  Animate the width with textStroke.
   *  ex  text('EVERY DAY').size(180).color('transparent').outline(3, '#fff');
   *  ex  headline.enter(500, { textStroke: [8, 0], opacity: [0, 1] });
   */
  P.outline = function (px, colour) {
    this.fx.textStroke = M.hold(px === undefined ? 2 : px);
    if (colour) this.fx.textStrokeColor = colour;
    return this;
  };

  /* Both masks are the same declaration with the sense flipped, so they are
     one function. Nothing is drawn here: the matte is rebuilt at the end of
     the frame, once everything it measures has been laid out and moved. */
  function matte(n, of, invert, o) {
    o = o || {};
    n.mask = { of: of, invert: invert, feather: o.feather || 0, show: !!o.show };
    everMasked = true;
    return n;
  }

  /** .showWhere(shape, options)   @look
   *  Show this only where `shape` is. Everywhere else it is not drawn.
   *
   *  This is a matte, and its whole value is that the shape may be MOVING: a
   *  bar sweeping across reveals what is under it as it passes, and a path()
   *  part way through a .draw() reveals along the stroke it has written so
   *  far. Nothing extra is written for that — the matte is read back off the
   *  shape every frame, so whatever the shape does, the reveal does.
   *
   *  The shape is taken out of the picture, the way switching a layer to a
   *  matte takes it out of one; pass { show: true } to keep drawing it too.
   *
   *    feather  soften the edge by this many pixels
   *    show     also draw the shape itself
   *
   *  A path() mattes by what it PAINTS, fill and stroke both. Anything else —
   *  shape(), image(), text() — mattes by its box, with its corner radius, so
   *  a round shape() cuts a round hole.
   *  ex  const wipe = shape({ width: 700, height: 300, background: '#fff' }).at(-700, 300);
   *  ex  const head = text('REVEALED').size(200).at(200, 340);
   *  ex  wipe.move({ x: 1800 }, 900);
   *  ex  head.showWhere(wipe);
   */
  P.showWhere = function (of, o) { return matte(this, of, false, o); };

  /** .hideWhere(shape, options)   @look
   *  The other half: show this everywhere EXCEPT where `shape` is, so the
   *  shape punches a hole rather than cutting one out.
   *
   *  Same options as .showWhere(). The pair is named this way round because
   *  the inverse of a matte is not a thing you can name after either object —
   *  "the headline is the inverse of the wipe" is not what is happening. What
   *  is happening is that the shape says where to show and where to hide, and
   *  these two say which.
   *  ex  const hole = shape({ width: 300, height: 300, borderRadius: 150 }).at(500, 300);
   *  ex  hole.move({ x: 900 }, 1200);
   *  ex  backdrop.hideWhere(hole);
   */
  P.hideWhere = function (of, o) { return matte(this, of, true, o); };

  /** .layout(direction, options)   @group
   *  Arranges a group's children in a row or a column, with a gap between
   *  them. Only meaningful on group() and items().
   *
   *    direction  'row' or 'column'
   *    options    gap    pixels between children
   *               align  'start', 'center' or 'end'
   *  ex  group(text('11'), text('3361 people')).layout('row', { gap: 130 })
   */
  P.layout = function (dir, o) {
    o = o || {};
    this.css.display = 'flex';
    this.css.flexDirection = dir === 'column' ? 'column' : 'row';
    this.css.gap = o.gap === undefined ? 0 : o.gap;
    this.css.alignItems = o.align === 'center' ? 'center'
                        : o.align === 'end' ? 'flex-end' : 'flex-start';
    return this;
  };

  /* ------------------------------------------------------------ the time -- */

  /** .start(atMs)   @time
   *  Start at an absolute time. Most of the time a relationship reads better;
   *  see .after().
   *  ex  title.enter(300).start(600)
   */
  P.start = function (ms) { this._rel = null; this._start = ms || 0; return this; };

  /** .after(other, gapMs)   @time
   *  Start when `other` finishes, plus a gap in milliseconds. A negative gap
   *  overlaps them.
   *
   *  This is the point of the whole layer. Change the thing in front and
   *  everything behind it moves with it, still the same gap behind, because
   *  the gap is what was written down and the absolute time was only ever a
   *  consequence of it.
   *  ex  title.enter(300);
   *  ex  subtitle.enter(250).after(title, 80);
   *  ex  chart.draw(600).after(subtitle, -120);
   */
  P.after = function (other, gap) {
    this._rel = { how: 'after', of: other, gap: gap || 0 };
    return this;
  };

  /** .with(other)   @time
   *  Start at the same moment as `other`.
   *  ex  badge.enter(300).with(title)
   */
  P['with'] = function (other) {
    this._rel = { how: 'with', of: other, gap: 0 };
    return this;
  };

  /** .before(other, gapMs)   @time
   *  Start `gap` milliseconds before `other` starts.
   *  ex  glow.enter(400).before(title, 120)
   */
  P.before = function (other, gap) {
    this._rel = { how: 'before', of: other, gap: gap || 0 };
    return this;
  };

  /** .alignEnd(other)   @time
   *  Finish at the same moment as `other`, whatever length this one is.
   *  ex  underline.draw(500).alignEnd(title)
   */
  P.alignEnd = function (other) {
    this._rel = { how: 'alignEnd', of: other, gap: 0 };
    return this;
  };

  /** .during(other)   @time
   *  Start with `other` and, if this has no length of its own yet, take
   *  `other`'s. For things that should cover another's whole span.
   *  ex  shake.animate('rotation', [[0, -2], [1, 2]]).during(title)
   */
  P.during = function (other) {
    this._rel = { how: 'during', of: other, gap: 0 };
    return this;
  };

  /* ---------------------------------------------------------- the motion -- */
  /* Every one of these ends up as a move: a window of local time and a spec of
     from/to pairs. Moves stack end to end unless you place one yourself. */
  P._add = function (dur, spec, at) {
    var start = at === undefined ? this._cursor : at;
    this.moves.push({ at: start, dur: dur || 0, spec: spec || {} });
    this._cursor = Math.max(this._cursor, start + (dur || 0));
    return this;
  };

  function specOf(table, given, dflt) {
    if (typeof given === 'string') return table[given] || table[dflt];
    if (given && typeof given === 'object') return given;
    return table[dflt];
  }

  /** .enter(durationMs, how)   @motion
   *  Bring it on. The first argument is HOW LONG the entrance takes, not when
   *  it starts — when it starts is .start(), .after(), .with() or .before(),
   *  and with none of those it starts at 0.
   *
   *  `how` is either the name of a preset or a spec of your own.
   *
   *    presets  fade  pop  rise  drop  slide  grow  spin
   *
   *  A spec is a list of property: [from, to] pairs, plus an optional ease
   *  for all of them. A third element on any pair gives that one property an
   *  easing of its own, so the fade can be flat while the movement overshoots.
   *  ex  title.enter(300);
   *  ex  title.enter(300, 'pop');
   *  ex  title.enter(340, { opacity: [0, 1], scale: [.72, 1], rotation: [-5, 0], ease: 'easeOut' });
   *  ex  title.enter(340, { opacity: [0, 1, 'linear'], y: [70, 0, 'overshoot'] });
   */
  P.enter = function (ms, how) {
    return this._add(ms === undefined ? 340 : ms, specOf(ENTER, how, 'pop'));
  };

  /** .exit(durationMs, how)   @motion
   *  Take it off. Same presets and the same spec shape as .enter().
   *
   *  With no time of its own it follows whatever came before it, which is
   *  usually what you want: enter, hold, leave.
   *  ex  title.enter(300).hold(1200).exit(250);
   */
  P.exit = function (ms, how) {
    return this._add(ms === undefined ? 250 : ms, specOf(EXIT, how, 'fade'));
  };

  /** .hold(durationMs)   @motion
   *  Do nothing for a while. Only useful between two other moves.
   *  ex  title.enter(300).hold(1200).exit(250)
   */
  P.hold = function (ms) { return this._add(ms || 0, {}); };

  /** .move(to, durationMs, ease)   @motion
   *  Shift it. `to` is { x, y } in pixels, relative to where it sits.
   *  ex  card.move({ x: 240, y: -60 }, 500, 'easeInOut')
   */
  P.move = function (to, ms, ease) {
    to = to || {};
    var spec = { ease: ease };
    if (to.x !== undefined) spec.x = [0, to.x];
    if (to.y !== undefined) spec.y = [0, to.y];
    return this._add(ms === undefined ? 400 : ms, spec);
  };

  /** .fade(from, to, durationMs, ease)   @motion
   *  Opacity, from one value to another.
   *  ex  caption.fade(1, 0.3, 400)
   */
  P.fade = function (from, to, ms, ease) {
    return this._add(ms === undefined ? 300 : ms,
                     { opacity: [from === undefined ? 0 : from,
                                 to === undefined ? 1 : to], ease: ease });
  };

  /** .scale(from, to, durationMs, ease)   @motion
   *  ex  logo.scale(1, 1.15, 600, 'easeInOut')
   */
  P.scale = function (from, to, ms, ease) {
    return this._add(ms === undefined ? 400 : ms,
                     { scale: [from === undefined ? 1 : from,
                               to === undefined ? 1 : to], ease: ease });
  };

  /** .rotate(from, to, durationMs, ease)   @motion
   *  Degrees.
   *  ex  arrow.rotate(0, 90, 400, 'overshoot')
   */
  P.rotate = function (from, to, ms, ease) {
    return this._add(ms === undefined ? 400 : ms,
                     { rotation: [from || 0, to || 0], ease: ease });
  };

  /** .draw(durationMs, ease)   @motion
   *  Draws an SVG path on, as if written by hand. For shape() paths.
   *  ex  chart.draw(600).after(subtitle, -120)
   */
  P.draw = function (ms, ease) {
    return this._add(ms === undefined ? 600 : ms, { __draw: true, ease: ease });
  };

  /** .typeOn(durationMs, options)   @motion
   *  Write the text on one character at a time.
   *
   *    options  caret  a character to blink at the cursor, default the block
   *                    '▉'. Pass '' for none.
   *             blink  the blink period in ms, default 430
   *             hold   keep the caret this long after the last character,
   *                    default 400. 0 removes it the moment typing ends
   *
   *  Still a pure function of t — the number of characters is worked out from
   *  the time, not counted up frame by frame, so scrubbing backwards untypes
   *  it exactly.
   *  ex  text('> how do I write a hook?').size(64).at(120, 400).typeOn(1400);
   */
  P.typeOn = function (ms, o) {
    o = o || {};
    var full = String(this.opts.text || '');
    var dur = ms === undefined ? 1200 : ms;
    var caret = o.caret === undefined ? '▉' : o.caret;
    var blink = o.blink || 430;
    var hold = o.hold === undefined ? 400 : o.hold;

    this.opts.textAt = function (t) {
      if (t < 0) return '';
      var n = Math.floor(M.cl(t / (dur || 1)) * full.length);
      var done = n >= full.length;
      var showCaret = caret && (!done || t < dur + hold) && Math.floor(t / blink) % 2 === 0;
      return full.slice(0, n) + (showCaret ? caret : '');
    };
    return this._add(dur + hold, {});
  };

  /** .along(path, durationMs, options)   @motion
   *  Travel along a path() from one end to the other.
   *
   *    options  ease    default easeInOut
   *             turn    true to point along the path as it goes
   *             from    where on the path to start, 0 to 1, default 0
   *             to      where to finish, default 1
   *
   *  The position is read off the real curve at every frame, so the thing
   *  follows the shape exactly rather than approximating it, and reshaping the
   *  path reroutes whatever travels on it.
   *  ex  const route = path([[100, 800], [700, 300], [1500, 700]], { smooth: true });
   *  ex  const dot = shape({ width: 40, height: 40, borderRadius: 20, background: '#ffb02e' });
   *  ex  dot.along(route, 1400, { turn: true });
   */
  P.along = function (route, ms, o) {
    o = o || {};
    this.moves.push({ at: this._cursor, dur: ms === undefined ? 1000 : ms,
                      ride: route, ease: o.ease || 'easeInOut',
                      turn: !!o.turn, u0: o.from || 0,
                      u1: o.to === undefined ? 1 : o.to });
    this._cursor += (ms === undefined ? 1000 : ms);
    return this;
  };

  /** .stagger(gapMs)   @group
   *  Delay each child of a group by this much more than the one before, so
   *  they cascade instead of arriving together.
   *  ex  items(['1M views', '50K likes', '12K comments']).stagger(80).enter(300, 'rise')
   */
  P.stagger = function (ms) { this.gapMs = ms || 0; return this; };

  /** .alternate()   @group
   *  Reverses the direction of every second child, so instead of all arriving
   *  from the same side they cross. It negates x, y and rotation, so it does
   *  nothing to a move that only changes opacity or scale.
   *  ex  group(text('3361'), text('people'))
   *  ex    .stagger(130)
   *  ex    .alternate()
   *  ex    .enter(340, { opacity: [0, 1], y: [70, 0], rotation: [-5, 0] });
   */
  P.alternate = function (on) { this.alt = on === undefined ? true : !!on; return this; };

  /** .animate(property, keyframes, options)   @motion
   *  The escape hatch, for a shape no method above can describe. keyframes is
   *  a list of [timeMs, value] pairs in node-local time, where 0 is when this
   *  node starts.
   *
   *  Reach for this last. If you find yourself using it often, the thing you
   *  are describing probably wants a method.
   *  ex  title.animate('scale', [[0, .8], [220, 1.08], [300, 1]], { ease: 'easeOut' });
   */
  P.animate = function (prop, keys, o) {
    o = o || {};
    var last = keys && keys.length ? keys[keys.length - 1][0] : 0;
    this.moves.push({ at: 0, dur: last, raw: prop, keys: keys, ease: o.ease });
    this._cursor = Math.max(this._cursor, last);
    return this;
  };

  /* the resolved window of this node, in clip time */
  P.length = function () {
    var end = 0;
    for (var i = 0; i < this.moves.length; i++)
      end = Math.max(end, this.moves[i].at + this.moves[i].dur);
    if (this.children.length) end += this.gapMs * (this.children.length - 1);
    return end;
  };
  P.startsAt = function () { return this._start; };
  P.endsAt = function () { return this._start + this.length(); };

  /* ------------------------------------------------------------- resolve -- */
  /* Turn the relationships into absolute starts. Repeated passes rather than a
     topological sort, because the graphs are tiny and this reports a cycle in
     plain words instead of silently picking an order. */
  function resolve() {
    var settled = {}, i, n, pending = [];
    for (i = 0; i < nodes.length; i++) {
      if (!nodes[i]._rel) { nodes[i]._start = nodes[i]._start || 0; settled[i] = 1; }
      else pending.push(i);
    }
    var guard = nodes.length + 2;
    while (pending.length && guard--) {
      var again = [];
      for (i = 0; i < pending.length; i++) {
        n = nodes[pending[i]];
        var of = n._rel.of, k = nodes.indexOf(of);
        if (k < 0 || !settled[k]) { again.push(pending[i]); continue; }
        var how = n._rel.how, gap = n._rel.gap;
        if (how === 'after')         n._start = of.endsAt() + gap;
        else if (how === 'with')     n._start = of.startsAt();
        else if (how === 'before')   n._start = of.startsAt() - gap;
        else if (how === 'alignEnd') n._start = of.endsAt() - n.length();
        else if (how === 'during') {
          n._start = of.startsAt();
          if (!n.moves.length) n._add(of.length(), {});
        }
        settled[pending[i]] = 1;
      }
      if (again.length === pending.length)
        throw new Error('the timing refers back to itself: '
          + 'one of these depends on something that depends on it');
      pending = again;
    }
  }

  /* --------------------------------------------------------------- apply -- */
  /* A spec of [from, to] pairs becomes motion.js tracks over one window. */
  /* A spec entry is one of three things:

       [from, to]         moves over the whole window, using the spec's ease
       [from, to, ease]   the same, with an easing of its own
       a track            passed straight through, for anything else

     The third element is what lets one property overshoot while another fades
     flat. Without it the spec would have one easing for everything, which is
     less than the layer underneath can say, and a layer that takes something
     away is not a simplification. */
  function pair(v) {
    return v && (v.length === 2 || v.length === 3)
      && typeof v[0] === 'number' && typeof v[1] === 'number';
  }

  function tracks(spec, at, dur) {
    var out = {}, k, v;
    for (k in spec) {
      if (NOT_A_PROPERTY[k] || k === '__draw') continue;
      v = spec[k];
      out[k] = pair(v)
        ? M.change(at, at + dur, v[0], v[1], v[2] === undefined ? spec.ease : v[2])
        : v;                                   /* already a track, pass through */
    }
    return out;
  }

  function elementOf(n, local) {
    var parentId = n.parent ? n.parent.id : (worldEl() ? WORLD : undefined);
    /* A child of a laid-out group flows; a child of a plain group is still
       placed by hand with .at(). Everything on the stage itself is absolute. */
    if (n.parent && n.parent.css.display === 'flex' && n.css.position === undefined)
      n.css.position = 'static';
    if (n.kind === 'text') {
      /* Some text is a function of time rather than a fixed string — a caption
         channel changing card, a line typing itself on. It is still a pure
         function of t: the same moment always gives the same characters. */
      var str = n.opts.textAt ? n.opts.textAt(local === undefined ? 0 : local) : n.opts.text;
      return M.label(n.id, str, n.css, parentId);
    }
    if (n.kind === 'wire')  return wireEl(n, local);
    if (n.kind === 'path')
      return pathEl(n, n.opts.d !== undefined ? n.opts.d
        : pathData(n.opts.pts, n.opts.o.smooth, n.opts.o.closed));
    if (n.kind === 'image') return M.img(n.id, n.opts.src, n.css, parentId);
    if (n.kind === 'shape') return M.box(n.id, n.css, parentId);
    return M.box(n.id, n.css, parentId);       /* group and items */
  }

  /* Reverse the sense of a directional move. */
  function flip(spec) {
    var out = {}, k;
    for (k in spec) {
      out[k] = (DIRECTIONAL[k] && spec[k] && spec[k].map)
        ? spec[k].map(function (f) { return [f[0], -f[1], f[2]]; })
        : spec[k];
    }
    return out;
  }

  /* Turn a node's declared moves into one spec of tracks in its local time. */
  function specOfNode(n, el, local) {
    var spec = {}, i, m, k;
    for (i = 0; i < n.moves.length; i++) {
      m = n.moves[i];
      if (m.ride) {                             /* .along() */
        var road = D.getElementById(m.ride.id);
        if (road && road.getTotalLength) {
          var len = road.getTotalLength();
          var u = M.cl(M.seg(local, m.at, m.at + m.dur));
          var eased = (typeof m.ease === 'string' ? (M.E[m.ease] || M.E.linear) : m.ease)(u);
          var at = (m.u0 + (m.u1 - m.u0) * eased) * len;
          var pt = road.getPointAtLength(at);
          /* Positioned by its own centre, so a dot sits ON the line rather
             than hanging below and to the right of it. */
          var box = el.getBoundingClientRect();
          spec.x = M.hold(pt.x - (n.css.left || 0) - (el.offsetWidth || 0) / 2);
          spec.y = M.hold(pt.y - (n.css.top || 0) - (el.offsetHeight || 0) / 2);
          if (m.turn) {
            var ahead = road.getPointAtLength(Math.min(len, at + 1));
            spec.rotation = M.hold(Math.atan2(ahead.y - pt.y, ahead.x - pt.x) * 180 / Math.PI);
          }
        }
        continue;
      }
      if (m.raw) {                              /* .animate() */
        spec[m.raw] = m.keys.map(function (f) { return [f[0], f[1], m.ease]; });
        continue;
      }
      if (m.spec.__draw) { M.draw(el, local, m.at, m.at + m.dur, m.spec.ease); continue; }
      var part = tracks(m.spec, m.at, m.dur);
      for (k in part) spec[k] = spec[k] ? spec[k].concat(part[k].slice(1)) : part[k];
    }
    return spec;
  }

  /* Where a group's motion lands.

     By default the group moves as ONE THING: a scale grows the whole row about
     its own centre and the spacing goes with it.

     Given .stagger() or .alternate() there is nothing for that to mean — a
     cascade is per child by definition — so the same moves are applied to each
     child instead, delayed down the list. A scale then grows each word about
     its own centre and the spacing stays put.

     That is the same distinction as line() against block() underneath, decided
     by whether you asked for a cascade rather than by picking a function. */
  function applyNode(n, t, extraDelay, reverse) {
    var local = t - n._start - (extraDelay || 0);
    var el = elementOf(n, local);
    var spec = specOfNode(n, el, local);
    var perChild = n.children.length && (n.gapMs || n.alt);
    var i, kid, kidSpec;

    /* Depth is a standing fact about where the thing is, not a move, so it
       goes into the spec as a constant rather than being animated. */
    if (n.z) spec.z = spec.z || M.hold(n.z);

    /* An effect set with .glow() or .tint() is the same kind of standing fact,
       and joins the spec the same way. A move that animates the same name wins
       outright rather than fighting it, so .glow(30) and a spec that says
       glow: [0, 40] do not produce two writers of one CSS property. */
    for (var fk in n.fx) if (spec[fk] === undefined) spec[fk] = n.fx[fk];

    if (!perChild && Object.keys(spec).length)
      M.anim(el, local, reverse ? flip(spec) : spec);
    else if (!perChild && n.z) M.anim(el, local, { z: M.hold(n.z) });

    for (i = 0; i < n.children.length; i++) {
      kid = n.children[i];
      var flipped = n.alt && (i % 2) ? !reverse : reverse;
      if (perChild && Object.keys(spec).length) {
        kidSpec = flipped ? flip(spec) : spec;
        M.anim(elementOf(kid, local - i * n.gapMs), local - i * n.gapMs, kidSpec);
      }
      applyNode(kid, t, (extraDelay || 0) + n._start + i * n.gapMs - kid._start, flipped);
    }
    return el;
  }

  /* ---------------------------------------------------------- the frame -- */
  /* Called by the shell around the clip's own code. Everything the clip
     declared is thrown away and rebuilt, which is what makes the render a pure
     function of t no matter what the clip did. */
  W.__sceneBegin = function () {
    nodes = [];
    counter = 0;
    camera = new Camera();
    W.camera = camera;
    W_ = W.__stageW || W_; H_ = W.__stageH || H_;
  };

  /* The resolved timeline, after the relationships have been worked out. The
     relationships are what you wrote; this is what they came to. Exposed
     because a dependency graph you cannot see the result of is worse than
     timestamps, and because it is the honest thing to assert against. */
  W.__scenePlan = function () {
    resolve();
    var out = camera && camera.moves.length
      ? [{ id: 'camera', kind: 'camera', text: camera.moves.length + ' moves',
           start: 0, end: Math.round(camera.length()), rel: 'absolute' }] : [];
    return out.concat(nodes.map(function (n) {
      return { id: n.id, kind: n.kind,
               text: (n.opts.text || '').slice(0, 24),
               start: Math.round(n.startsAt()),
               end: Math.round(n.endsAt()),
               rel: n._rel ? n._rel.how + '(' + n._rel.of.id
                             + (n._rel.gap ? ', ' + n._rel.gap : '') + ')' : 'absolute' };
    }));
  };

  /* A control that does nothing and says nothing is worse than one that is not
     there. .alternate() reverses x, y and rotation, so on a move that only
     changes opacity or scale it is a no-op — and looks like a bug in the tool
     rather than a gap in the spec. Say so. */
  /* undefined, not null, so the FIRST frame always reports — including
     reporting that there is nothing to say, which is how a note clears
     after you fix what it was about. */
  var lastNote;
  function noteFor() {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.alt || !n.children.length) continue;
      var directional = false;
      for (var j = 0; j < n.moves.length; j++)
        for (var k in (n.moves[j].spec || {}))
          if (DIRECTIONAL[k]) directional = true;
      if (!directional)
        return '.alternate() has nothing to reverse here — it flips x, y and '
             + 'rotation, and this move only changes '
             + Object.keys(n.moves.reduce(function (a, m) {
                 for (var k in (m.spec || {})) if (!NOT_A_PROPERTY[k]) a[k] = 1;
                 return a;
               }, {})).join(' and ') + '.';
    }
    return null;
  }

  W.__sceneEnd = function (t) {
    if (camera) applyCamera(camera, t);
    if (!nodes.length) return;
    resolve();

    var note = noteFor();
    if (note !== lastNote) {
      lastNote = note;
      try {
        parent.postMessage({ studio: 'note', src: location.pathname, message: note }, '*');
      } catch (e) { /* not in a frame */ }
    }
    var end = 0;
    /* Things first, then wires. A wire measures the boxes it joins, and a box
       that has not been laid out yet measures as nothing — so the order here
       is not a detail, it is the difference between a diagram and a pile of
       lines at the origin. */
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].parent || nodes[i].kind === 'wire'
          || nodes[i].kind === 'path') continue;
      applyNode(nodes[i], t, 0);
    }
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].parent) continue;
      if (nodes[i].kind !== 'wire' && nodes[i].kind !== 'path') continue;
      applyNode(nodes[i], t, 0);
    }
    /* Last, and for the same reason wires come after boxes: a matte is
       measured off a shape, and a shape that has not been placed yet measures
       as nothing. */
    applyMasks();
    for (i = 0; i < nodes.length; i++) end = Math.max(end, nodes[i].endsAt());
    if (camera) end = Math.max(end, camera.length());
    /* A clip with no duration() of its own is as long as its choreography.
       Say so when it changes, so the timeline follows theedit rather than
       holding a number nobody wrote. */
    if (!W.__durationSet) {
      var ms = Math.max(1, Math.round(end));
      if (ms !== W.__duration) {
        W.__duration = ms;
        try {
          parent.postMessage({ studio: 'duration', src: location.pathname, duration: ms }, '*');
        } catch (e) { /* not in a frame; nothing to tell */ }
      }
    }
  };

  /* ------------------------------------------------------------- camera -- */
  /* The camera is a thing, not a set of moves you fake on every element.

     Without it, "push into the number while the background falls away" means
     animating the number, the background, and everything else in frame, each
     with its own numbers, and keeping them consistent by hand. With it, that
     sentence is one statement, and the background falls away because it is
     further away — not because you animated it to.

     The model is a window into a space. The stage carries the perspective and
     #world carries everything in it, so moving the camera is transforming
     #world once:

         scale(s) rotateX(rx) rotateY(ry) rotate(roll)
         translate(-(fx - W/2), -(fy - H/2))

     fx, fy is the point in the scene that sits at the centre of frame. At
     fx,fy = the stage centre and s = 1 this is the identity, so a clip that
     never mentions the camera is unaffected.

     The scale comes before the translate on purpose: panning while zoomed in
     covers more screen for the same distance in the scene, which is what a
     real camera does.

     Depth is what makes it read as space rather than as zoom. An element at
     .depth(-800) is genuinely further from the lens: it draws smaller, and it
     shifts less than a nearer one when the camera moves, because the browser
     is doing the perspective divide. Nothing about parallax is animated. */

  var WORLD = '__world';
  var CAM0 = { fx: null, fy: null, s: 1, roll: 0, rx: 0, ry: 0 };

  function worldEl() {
    var st = D.getElementById('stage');
    var w = D.getElementById(WORLD);
    if (!w && st) {
      w = D.createElement('div');
      w.id = WORLD;
      st.appendChild(w);
    }
    return w;
  }

  /* An element's centre in scene coordinates. Walks up the offset chain rather
     than reading a bounding box, because a bounding box is in screen pixels
     and already has the camera's own transform baked into it — focusing on
     that would chase its own tail every frame. */
  function centreOf(el) {
    var x = 0, y = 0, n = el;
    while (n && n.id !== WORLD) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent;
    }
    return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2,
             w: el.offsetWidth, h: el.offsetHeight };
  }

  function Camera() {
    this.moves = [];       /* {at, dur, to: partial, ref, fill, ease} */
    this._cursor = 0;
    this._ease = 'easeInOut';
  }
  var C = Camera.prototype;

  C._add = function (dur, to, extra) {
    var m = { at: this._cursor, dur: dur || 0, to: to || {}, ease: this._ease };
    if (extra) for (var k in extra) m[k] = extra[k];
    this.moves.push(m);
    this._cursor += (dur || 0);
    return this;
  };

  /** camera.ease(name)   @camera
   *  The easing every camera move after this one uses, unless it names its
   *  own. Defaults to easeInOut, which is what a camera on a tripod does.
   *  ex  camera.ease('easeOut').to(chart, 500);
   */
  C.ease = function (e) { this._ease = e; return this; };

  /** camera.to(thing, durationMs)   @camera
   *  Move so that `thing` is in the middle of frame. Give it an element or a
   *  { x, y } point in scene coordinates.
   *  ex  camera.to(chart, 500);
   *  ex  camera.to({ x: 1400, y: 300 }, 700);
   */
  C.to = function (thing, ms) {
    return this._add(ms === undefined ? 500 : ms, {}, { ref: thing });
  };

  /** camera.focus(thing, durationMs, options)   @camera
   *  Move to it AND frame it: the camera zooms so the thing fills the frame.
   *
   *    options  fill  how much of the width it should take, 0 to 1.
   *                   Default 0.72, which leaves it room to breathe.
   *  ex  camera.focus(stat, 400);
   *  ex  camera.focus(chart, 600, { fill: 0.9 });
   */
  C.focus = function (thing, ms, o) {
    return this._add(ms === undefined ? 500 : ms, {},
                     { ref: thing, fill: (o && o.fill) || 0.72 });
  };

  /** camera.zoom(scale, durationMs)   @camera
   *  An absolute zoom. 1 is the whole stage, 2 is twice as close.
   *  ex  camera.zoom(1.8, 400);
   */
  C.zoom = function (k, ms) {
    return this._add(ms === undefined ? 400 : ms, { s: k });
  };

  /** camera.push(by, durationMs)   @camera
   *  Zoom RELATIVE to wherever it already is, so .push(1.4) is forty per cent
   *  closer than now whatever that was. This is the one you want in a chain.
   *  ex  camera.focus(stat, 400).hold(200).push(1.7, 350);
   */
  C.push = function (k, ms) {
    return this._add(ms === undefined ? 400 : ms, { sBy: k });
  };

  /** camera.pull(by, durationMs)   @camera
   *  The other way: .pull(2) ends up half as close.
   *  ex  camera.pull(1.6, 500);
   */
  C.pull = function (k, ms) {
    return this._add(ms === undefined ? 400 : ms, { sBy: 1 / (k || 1) });
  };

  /** camera.roll(degrees, durationMs)   @camera
   *  Tilt the horizon. A degree or two is a lot.
   *  ex  camera.roll(-3, 250);
   */
  C.roll = function (deg, ms) {
    return this._add(ms === undefined ? 300 : ms, { roll: deg });
  };

  /** camera.turn(degrees, durationMs)   @camera
   *  Swing around the vertical axis, so one side of the scene comes towards
   *  you and the other goes away. Needs depth in the scene to read.
   *  ex  camera.turn(-14, 600);
   */
  C.turn = function (deg, ms) {
    return this._add(ms === undefined ? 500 : ms, { ry: deg });
  };

  /** camera.tilt(degrees, durationMs)   @camera
   *  The same about the horizontal axis: looking down at the scene or up at it.
   *  ex  camera.tilt(8, 500);
   */
  C.tilt = function (deg, ms) {
    return this._add(ms === undefined ? 500 : ms, { rx: deg });
  };

  /** camera.drift(spec, durationMs)   @camera
   *  The slow move that never settles. This is the default state of a shot in
   *  this kind of edit: almost every frame is imperceptibly growing or sliding,
   *  and the shot is still moving when it cuts.
   *
   *    spec  zoom  scale to grow BY over the span, e.g. 1.08 for eight per cent
   *          x, y  pixels to slide by
   *          turn  degrees of yaw
   *
   *  Linear, on purpose. An eased drift decelerates into the cut and reads as
   *  the shot running out rather than as the edit moving on. Use .push() or
   *  .to() when you want a move that arrives somewhere.
   *  ex  camera.drift({ zoom: 1.08, x: 30 }, 5000);
   */
  C.drift = function (o, ms) {
    o = o || {};
    var m = { sBy: o.zoom === undefined ? 1.06 : o.zoom };
    if (o.turn !== undefined) m.ry = o.turn;
    var was = this._ease;
    this._ease = 'linear';
    this._add(ms === undefined ? 4000 : ms, m, { by: { x: o.x || 0, y: o.y || 0 } });
    this._ease = was;
    return this;
  };

  /** camera.follow(group, durationMs, options)   @camera
   *  Track sideways as a group's children arrive, so the newest one stays in
   *  frame and the older ones slide off behind it. The cascade builds to the
   *  right; the camera goes with it.
   *
   *    options  fill  how much of the width the newest item should take
   *
   *  Give it the same span as the group's own stagger and the two stay locked:
   *  one item lands, the camera moves one item, the next lands.
   *  ex  const row = items(['Socrates', 'Newton', 'Curie']).stagger(400);
   *  ex  row.at(200, 400).layout('row', { gap: 60 }).enter(300, 'rise');
   *  ex  camera.follow(row, 1200);
   */
  C.follow = function (g, ms, o) {
    return this._add(ms === undefined ? 1000 : ms, {},
                     { trail: g, fill: (o && o.fill) || 0 });
  };

  /** camera.hold(durationMs)   @camera
   *  Sit still. Between two moves, which is where the rhythm comes from.
   *  ex  camera.focus(stat, 400).hold(300).to(chart, 500);
   */
  C.hold = function (ms) { return this._add(ms || 0, {}); };

  /** camera.reset(durationMs)   @camera
   *  Back to the whole stage, straight on.
   *  ex  camera.reset(600);
   */
  C.reset = function (ms) {
    return this._add(ms === undefined ? 500 : ms,
                     { s: 1, roll: 0, rx: 0, ry: 0, home: true });
  };

  C.length = function () {
    var end = 0;
    for (var i = 0; i < this.moves.length; i++)
      end = Math.max(end, this.moves[i].at + this.moves[i].dur);
    return end;
  };

  /* Walk the moves in order, turning each into concrete numbers. A move is
     relative to where the one before it finished, which is what lets a chain
     read as directions rather than as absolute framings. */
  function cameraTracks(cam) {
    var W = W_ || 1920, H = H_ || 1080;
    var st = { fx: W / 2, fy: H / 2, s: 1, roll: 0, rx: 0, ry: 0 };
    var keys = { fx: [[0, st.fx]], fy: [[0, st.fy]], s: [[0, 1]],
                 roll: [[0, 0]], rx: [[0, 0]], ry: [[0, 0]] };

    for (var i = 0; i < cam.moves.length; i++) {
      var m = cam.moves[i], to = m.to, next = {
        fx: st.fx, fy: st.fy, s: st.s, roll: st.roll, rx: st.rx, ry: st.ry
      };
      if (m.ref) {
        var pt = m.ref;
        if (pt instanceof Node) {
          var el = D.getElementById(pt.id);
          pt = el ? centreOf(el) : { x: W / 2, y: H / 2, w: W, h: H };
        }
        next.fx = pt.x === undefined ? st.fx : pt.x;
        next.fy = pt.y === undefined ? st.fy : pt.y;
        if (m.fill && pt.w) next.s = Math.max(0.05, (W * m.fill) / pt.w);
      }
      /* a drift is relative to wherever the camera already is */
      if (m.by) { next.fx = st.fx + (m.by.x || 0); next.fy = st.fy + (m.by.y || 0); }

      /* follow: end framed on the LAST child, having passed through the others,
         so the pan is one item per beat rather than one jump at the end */
      if (m.trail && m.trail.children && m.trail.children.length) {
        var kids = m.trail.children, last = kids[kids.length - 1];
        var lel = D.getElementById(last.id);
        if (lel) {
          var c2 = centreOf(lel);
          next.fx = c2.x;
          next.fy = c2.y;
          if (m.fill && c2.w) next.s = Math.max(0.05, (W * m.fill) / c2.w);
        }
      }

      if (to.home) { next.fx = W / 2; next.fy = H / 2; }
      if (to.s !== undefined) next.s = to.s;
      if (to.sBy !== undefined) next.s = st.s * to.sBy;
      if (to.roll !== undefined) next.roll = to.roll;
      if (to.rx !== undefined) next.rx = to.rx;
      if (to.ry !== undefined) next.ry = to.ry;

      var end = m.at + m.dur;
      for (var k in keys) {
        /* hold the old value until the move starts, so a chain of moves does
           not smear one into the next across a hold */
        if (m.at > 0) keys[k].push([m.at, st[k]]);
        keys[k].push([end, next[k], m.ease]);
      }
      st = next;
    }
    return keys;
  }

  function applyCamera(cam, t) {
    var el = worldEl();
    if (!el || !cam.moves.length) return;
    var W = W_ || 1920, H = H_ || 1080;
    var k = cameraTracks(cam);
    var fx = M.track(k.fx, t), fy = M.track(k.fy, t), s = M.track(k.s, t);
    el.style.transform =
      'scale(' + s.toFixed(4) + ') ' +
      'rotateX(' + M.track(k.rx, t).toFixed(3) + 'deg) ' +
      'rotateY(' + M.track(k.ry, t).toFixed(3) + 'deg) ' +
      'rotate(' + M.track(k.roll, t).toFixed(3) + 'deg) ' +
      'translate(' + (-(fx - W / 2)).toFixed(2) + 'px,' +
                     (-(fy - H / 2)).toFixed(2) + 'px)';
  }

  /* ------------------------------------------------------------- making -- */

  /* ---------------------------------------------------------------- wire -- */
  /* One SVG plane inside the world holds every wire, so they share a
     coordinate system with the things they join and travel with the camera. */
  var WIRES = '__wires';
  var SVGNS = 'http://www.w3.org/2000/svg';

  function wirePlane() {
    var w = worldEl();
    if (!w) return null;
    var svg = D.getElementById(WIRES);
    if (!svg) {
      svg = D.createElementNS(SVGNS, 'svg');
      svg.id = WIRES;
      svg.setAttribute('width', W_ || 1920);
      svg.setAttribute('height', H_ || 1080);
      svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none';
      /* first child, so wires sit behind the things they join */
      w.insertBefore(svg, w.firstChild);
    }
    return svg;
  }

  /* Where a line from one box to another should leave and arrive: the point on
     each box's edge facing the other, so a wire touches its endpoints instead
     of starting in the middle of the text. */
  function edgePoint(box, towards) {
    var dx = towards.x - box.x, dy = towards.y - box.y;
    if (!dx && !dy) return { x: box.x, y: box.y };
    var hw = box.w / 2 + 8, hh = box.h / 2 + 8;
    var sx = dx ? hw / Math.abs(dx) : Infinity;
    var sy = dy ? hh / Math.abs(dy) : Infinity;
    var k = Math.min(sx, sy);
    return { x: box.x + dx * k, y: box.y + dy * k };
  }

  /* Points to SVG path data. Straight through them, or a Catmull-Rom spline
     converted to cubic beziers, which is the curve that passes THROUGH its
     control points rather than near them — the one a person means when they
     say "curve it through here". */
  function pathData(pts, smooth, closed) {
    if (!pts || pts.length < 2) return '';
    var p = pts.map(function (q) { return { x: q[0], y: q[1] }; });
    if (!smooth) {
      return 'M' + p.map(function (q) { return q.x + ' ' + q.y; }).join(' L ')
           + (closed ? ' Z' : '');
    }
    var wrap = function (i) {
      return closed ? p[(i + p.length) % p.length]
                    : p[Math.max(0, Math.min(p.length - 1, i))];
    };
    var d = 'M' + p[0].x + ' ' + p[0].y;
    var last = closed ? p.length : p.length - 1;
    for (var i = 0; i < last; i++) {
      var p0 = wrap(i - 1), p1 = wrap(i), p2 = wrap(i + 1), p3 = wrap(i + 2);
      d += ' C ' + (p1.x + (p2.x - p0.x) / 6) + ' ' + (p1.y + (p2.y - p0.y) / 6)
         + ', ' + (p2.x - (p3.x - p1.x) / 6) + ' ' + (p2.y - (p3.y - p1.y) / 6)
         + ', ' + p2.x + ' ' + p2.y;
    }
    return d + (closed ? ' Z' : '');
  }

  /** path(points, options)   @make
   *  A vector shape of your own: a list of [x, y] points, straight through
   *  them or curved through them. This is the free-form one — an underline, an
   *  arrow, a chart line, a blob, a route for something to travel along.
   *
   *    options  smooth  true curves THROUGH the points rather than cornering
   *             closed  true joins the last point back to the first
   *             color   stroke colour, default the current text colour
   *             width   stroke width, default 6
   *             fill    a fill colour; default none, so it is a line
   *             glow    true for a halo in the stroke colour
   *             dash    true, or a CSS dash array like '18 14'
   *             cap     'round' (default), 'butt' or 'square'
   *
   *  Chain .draw(ms) and it writes itself on end to end, which is the same
   *  trim-path move a vector app gives you.
   *  ex  path([[200, 800], [600, 500], [1000, 620], [1500, 300]], { smooth: true })
   *  ex    .draw(900);
   *  ex  path([[100, 100], [300, 100], [300, 300], [100, 300]], { closed: true, fill: '#ffb02e' });
   */
  function path(points, o) {
    o = o || {};
    var n = new Node('path', { pts: points || [], o: o });
    return n;
  }

  /** raw(d, options)   @make
   *  The same thing, given as SVG path data, for when you already have the
   *  curve or want commands points cannot express. Same options as path().
   *  ex  raw('M100 500 C 400 200, 800 800, 1200 400', { width: 8 }).draw(700);
   */
  function raw(d, o) {
    var n = new Node('path', { d: d, o: o || {} });
    return n;
  }

  /* One builder for both, and for wires, since all three are a styled path on
     the wire plane. */
  function pathEl(n, geometry) {
    var svg = wirePlane();
    if (!svg) return null;
    var el = D.getElementById(n.id);
    if (!el) {
      el = D.createElementNS(SVGNS, 'path');
      el.id = n.id;
      svg.appendChild(el);
    }
    var o = n.opts.o || {};
    if (geometry && el.getAttribute('d') !== geometry) {
      el.setAttribute('d', geometry);
      el.__len = undefined;              /* the length changed with the shape */
    }
    el.setAttribute('fill', o.fill || 'none');
    el.setAttribute('stroke', n.css.color || o.color || 'currentColor');
    el.setAttribute('stroke-width', o.width === undefined ? 6 : o.width);
    el.setAttribute('stroke-linecap', o.cap || 'round');
    el.setAttribute('stroke-linejoin', 'round');
    if (o.dash) el.setAttribute('stroke-dasharray', o.dash === true ? '18 14' : o.dash);
    /* A path's glow goes through the same filter stack as everything else's,
       rather than writing style.filter here. Two writers of one CSS property
       is exactly the bug the effects stack exists to prevent, and it would
       have been this one: a .glow() or an animated glow on the same path. */
    if (o.glow && n.fx.glow === undefined) {
      n.fx.glow = M.hold(o.glow === true ? 20 : o.glow);
      n.fx.glowColor = n.fx.glowColor || n.css.color || o.color || '#fff';
    }
    for (var k in n.css) {
      var v = n.css[k];
      el.style[k] = (typeof v === 'number' && k !== 'opacity') ? v + 'px' : v;
    }
    return el;
  }

  /** connect(from, to, options)   @make
   *  A line between two things, which is how a set of elements becomes a
   *  diagram. Chain .draw(ms) and it writes itself on from one end to the
   *  other.
   *
   *    options  color   any CSS colour, default the current text colour
   *             width   stroke width in px, default 6
   *             curve   0 is straight; 0.4 bows it out, -0.4 bows it back
   *             glow    true for a soft halo in the same colour
   *             dash    true for a dashed line
   *
   *  It measures its two ends every frame, so the wire follows them if they
   *  move, and it lives in the same plane as they do, so the camera carries it
   *  along with everything else.
   *  ex  const a = text('idea').size(70).at(200, 300);
   *  ex  const b = text('script').size(70).at(900, 500);
   *  ex  connect(a, b, { curve: 0.3, glow: true }).draw(500).after(a, 120);
   */
  function connect(from, to, o) {
    o = o || {};
    var n = new Node('wire', { from: from, to: to, o: o });
    return n;
  }

  function wireEl(n, local) {
    var o = n.opts.o || {};
    var a = D.getElementById(n.opts.from && n.opts.from.id);
    var b = D.getElementById(n.opts.to && n.opts.to.id);
    if (!a || !b) return pathEl(n, null);

    var ca = centreOf(a), cb = centreOf(b);
    var p1 = edgePoint(ca, cb), p2 = edgePoint(cb, ca);
    var d;
    /* Waypoints: the free-form case. The wire still finds its own ends on the
       two boxes, and goes wherever you send it in between. */
    if (o.via && o.via.length) {
      d = pathData([[p1.x, p1.y]].concat(o.via).concat([[p2.x, p2.y]]),
                   o.smooth !== false, false);
    } else if (o.curve) {
      /* bow it out perpendicular to the run, so the amount is a proportion of
         the distance rather than a number you have to retune per pair */
      var mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      var vx = p2.x - p1.x, vy = p2.y - p1.y;
      d = 'M' + p1.x + ' ' + p1.y + ' Q ' + (mx - vy * o.curve) + ' '
        + (my + vx * o.curve) + ' ' + p2.x + ' ' + p2.y;
    } else {
      d = 'M' + p1.x + ' ' + p1.y + ' L ' + p2.x + ' ' + p2.y;
    }
    return pathEl(n, d);
  }

  /* -------------------------------------------------------------- mattes --

     "Show this only where that is." Three ways were open:

       clip-path        a hard edge and nothing else. It cannot express a
                        stroke, so a path() drawing itself on could not be a
                        matte — which is the one case worth having.
       SVG <clipPath>   the same shape of answer: it uses the FILL of its
                        children and throws the stroke away.
       CSS mask         reads the mask as it is PAINTED. Fill, stroke, dash
                        offset, opacity and a blurred edge all mean something,
                        so an animated shape is an animated matte for free.

     So: mask. The matte is a live redraw of the shape into an SVG <mask>,
     painted flat white to show and flat black to hide, because a mask is a
     stencil and a magenta wipe must cut the same hole as a white one.

     ------------------------------------------------------------ coordinates

     A mask is interpreted in the element's own UNTRANSFORMED box, which was
     measured rather than assumed. Two consequences, both handled below:

       the shape's world coordinates have to be shifted into that box, and
       the element's own transform has to be UNDONE inside the mask, or the
       matte rides along with whatever the masked thing is doing — a headline
       that pops in would drag its own reveal in with it.

     What is deliberately not undone is the camera. #__world's transform is
     applied to the masked element after the mask, so a matte pans, zooms and
     turns with everything else, which is what a matte in a composition does.
     The svg holding the masks is therefore kept OUT of the world: a <mask> is
     a resource and is never drawn where it sits, and putting it inside would
     apply the camera to it a second time. */

  var MASKS = '__masks';

  function maskPlane() {
    var st = D.getElementById('stage');
    if (!st) return null;
    var svg = D.getElementById(MASKS);
    if (!svg) {
      svg = D.createElementNS(SVGNS, 'svg');
      svg.id = MASKS;
      svg.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;'
                        + 'overflow:hidden;pointer-events:none';
      st.appendChild(svg);
    }
    return svg;
  }

  function svgNode(tag) { return D.createElementNS(SVGNS, tag); }
  function mat(m) {
    return 'matrix(' + [m.a, m.b, m.c, m.d, m.e, m.f]
      .map(function (v) { return (+v).toFixed(4); }).join(',') + ')';
  }

  /* An element's top-left in scene coordinates, by the same walk centreOf
     does and for the same reason: a bounding box is in screen pixels and
     already has the camera's transform baked into it. */
  function topLeftOf(el) {
    var x = 0, y = 0, n = el;
    while (n && n.id !== WORLD) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x: x, y: y };
  }

  /* The element's own transform as it is actually applied — about its centre,
     which is what transform-origin defaults to — optionally inverted. Returns
     null when there is nothing to apply, or when the matrix cannot be
     inverted, which is what a scale of 0 gives. */
  function ownMatrix(el, cx, cy, invert) {
    var tx = el.style.transform;
    if (!tx || !W.DOMMatrix) return null;
    var m;
    try {
      m = new W.DOMMatrix('translate(' + cx + 'px,' + cy + 'px) ' + tx
                        + ' translate(' + (-cx) + 'px,' + (-cy) + 'px)');
    } catch (e) { return null; }          /* a transform we cannot read is not fatal */
    if (invert) m = m.inverse();
    return isFinite(m.a) && isFinite(m.f) ? m : null;
  }

  /* The shape, redrawn into the mask in scene coordinates and painted flat.
     Its colour is thrown away; everything about its GEOMETRY is kept — the
     dash offset a .draw() is part way through, its transform, its opacity —
     which is the whole trick. Nothing here knows about time. */
  function matteShape(src, paint) {
    var keep = function (a) { var v = src.getAttribute(a); return v && v !== 'none'; };
    var alpha = src.style.opacity === '' ? 1 : src.style.opacity;
    var m, out;

    if (src.tagName && String(src.tagName).toLowerCase() === 'path') {
      out = svgNode('path');
      out.setAttribute('d', src.getAttribute('d') || '');
      out.setAttribute('fill', keep('fill') ? paint : 'none');
      out.setAttribute('stroke', keep('stroke') ? paint : 'none');
      out.setAttribute('stroke-width', src.getAttribute('stroke-width') || 0);
      out.setAttribute('stroke-linecap', src.getAttribute('stroke-linecap') || 'round');
      out.setAttribute('stroke-linejoin', 'round');
      if (keep('stroke-dasharray'))
        out.setAttribute('stroke-dasharray', src.getAttribute('stroke-dasharray'));
      /* draw() writes the dash on the STYLE rather than the attribute, and it
         is the only reason a path makes a good matte, so it is copied last and
         wins. */
      if (src.style.strokeDasharray)  out.style.strokeDasharray  = src.style.strokeDasharray;
      if (src.style.strokeDashoffset) out.style.strokeDashoffset = src.style.strokeDashoffset;
      var b = { x: 0, y: 0, width: 0, height: 0 };
      try { b = src.getBBox(); } catch (e) { /* an empty path has no box */ }
      m = ownMatrix(src, b.x + b.width / 2, b.y + b.height / 2, false);
    } else {
      /* Anything that is not a path mattes by its BOX. Exact for shape() and
         image(); the bounding box for text, which is the honest limit of doing
         this without re-rendering the glyphs into the mask. */
      var tl = topLeftOf(src), w = src.offsetWidth, h = src.offsetHeight;
      out = svgNode('rect');
      out.setAttribute('x', tl.x); out.setAttribute('y', tl.y);
      out.setAttribute('width', w); out.setAttribute('height', h);
      var r = src.style.borderRadius;
      if (r) {
        var pc = /%/.test(r) ? parseFloat(r) / 100 : 0;
        out.setAttribute('rx', pc ? w * pc : parseFloat(r) || 0);
        out.setAttribute('ry', pc ? h * pc : parseFloat(r) || 0);
      }
      out.setAttribute('fill', paint);
      m = ownMatrix(src, tl.x + w / 2, tl.y + h / 2, false);
    }
    out.setAttribute('opacity', alpha);
    if (m) out.setAttribute('transform', mat(m));
    return out;
  }

  /* Rebuilt from nothing at the end of every frame, after everything has been
     laid out and moved — a matte measures the shape, and a shape that has not
     been placed yet measures as nothing. */
  function applyMasks() {
    if (!everMasked) return;
    var Wd = W_ || 1920, Ht = H_ || 1080;
    var svg = null, hidden = {}, i, n, el, src;

    for (i = 0; i < nodes.length; i++)
      if (nodes[i].mask && nodes[i].mask.of && !nodes[i].mask.show)
        hidden[nodes[i].mask.of.id] = 1;

    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      el = D.getElementById(n.id);
      if (!el) continue;
      /* A shape used as a matte is not part of the picture, the same switch a
         compositor flips when a layer becomes a track matte. visibility rather
         than display, because a thing with no box cannot be measured and the
         matte is measured from it. */
      var vis = hidden[n.id] ? 'hidden' : '';
      if (el.style.visibility !== vis) el.style.visibility = vis;

      if (!n.mask) {
        /* Cleared, not merely not-set. A mask left over from a frame that had
           one is exactly the kind of memory the purity rule is about. */
        if (el.style.maskImage || el.style.webkitMaskImage)
          el.style.maskImage = el.style.webkitMaskImage = '';
        continue;
      }
      src = n.mask.of && D.getElementById(n.mask.of.id);
      if (!src) continue;
      svg = svg || maskPlane();
      if (!svg) return;

      var id = n.id + '_matte';
      var m = D.getElementById(id);
      if (!m) {
        m = svgNode('mask');
        m.id = id;
        /* A region in the element's own pixels rather than a share of its box,
           so a matte that starts off the side of the thing is still there when
           it arrives. */
        m.setAttribute('maskUnits', 'userSpaceOnUse');
        m.setAttribute('x', -Wd); m.setAttribute('y', -Ht);
        m.setAttribute('width', Wd * 3); m.setAttribute('height', Ht * 3);
        svg.appendChild(m);
      }
      m.textContent = '';

      var soft = svgNode('g');
      if (n.mask.feather) soft.style.filter = 'blur(' + n.mask.feather + 'px)';
      /* A mask is read as LUMINANCE: white shows, black hides, and nothing at
         all hides. So the inverse is the same stencil cut out of a white
         field, which is one extra rectangle rather than a second mechanism. */
      if (n.mask.invert) {
        var back = svgNode('rect');
        back.setAttribute('x', -Wd * 2); back.setAttribute('y', -Ht * 2);
        back.setAttribute('width', Wd * 6); back.setAttribute('height', Ht * 6);
        back.setAttribute('fill', '#fff');
        soft.appendChild(back);
      }
      var into = svgNode('g');
      var tl = topLeftOf(el);
      var un = ownMatrix(el, el.offsetWidth / 2, el.offsetHeight / 2, true);
      into.setAttribute('transform',
        (un ? mat(un) + ' ' : '') + 'translate(' + (-tl.x) + ',' + (-tl.y) + ')');
      into.appendChild(matteShape(src, n.mask.invert ? '#000' : '#fff'));
      soft.appendChild(into);
      m.appendChild(soft);

      el.style.maskImage = 'url(#' + id + ')';
      el.style.webkitMaskImage = 'url(#' + id + ')';
    }
  }

  /** captions([[text, ms], ...])   @make
   *  The subtitle channel: small text at the bottom of frame that changes card
   *  by card and runs independently of everything else.
   *
   *  It is one element, not one per card. Cards replace each other instantly
   *  with no animation, which is what reads as speech rather than as motion
   *  graphics — a caption that fades is a caption you are looking at instead
   *  of listening past.
   *
   *  Give a plain string instead of a pair to use the default 1200ms, and
   *  chain .size() .color() .at() to move the whole channel.
   *  ex  captions([
   *  ex    ['most beginners write', 1100],
   *  ex    ['the same sentence length', 1200],
   *  ex    ['over and over again', 1000]
   *  ex  ]);
   */
  function captions(list) {
    var cards = (list || []).map(function (c) {
      return typeof c === 'string' ? { text: c, ms: 1200 }
                                   : { text: c[0], ms: c[1] === undefined ? 1200 : c[1] };
    });
    var total = cards.reduce(function (a, c) { return a + c.ms; }, 0);

    var n = new Node('text', {});
    n.opts.textAt = function (t) {
      var acc = 0;
      for (var i = 0; i < cards.length; i++) {
        if (t < acc + cards[i].ms) return t < 0 ? '' : cards[i].text;
        acc += cards[i].ms;
      }
      return '';
    };
    /* bottom-centre and small, the way a caption sits. All of it overridable. */
    n.css.left = 0; n.css.right = 0; n.css.textAlign = 'center';
    n.css.top = Math.round((H_ || 1080) * 0.80);
    n.css.fontSize = Math.round((H_ || 1080) * 0.042);
    n.css.fontWeight = 700;
    n._add(total, {});                    /* so the clip is as long as the words */
    return n;
  }

  /** stack([...])   @make
   *  A column of words that builds one below the last — the emphasis block
   *  this style is full of. Each line can carry its own size, colour and
   *  weight, which is the point: a phrase reads as an asymmetric object rather
   *  than as a paragraph.
   *
   *  A line is a string, or [text, size], or [text, size, colour], or
   *  [text, size, colour, weight].
   *  ex  stack([
   *  ex    ['and', 70],
   *  ex    ['tweak', 130, '#ffb02e'],
   *  ex    ['the sentences', 80],
   *  ex    ['to make them flow', 96, '#fff', 900]
   *  ex  ])
   *  ex    .at(220, 240)
   *  ex    .stagger(170)
   *  ex    .enter(240, 'rise');
   */
  function stack(list) {
    var made = (list || []).map(function (row) {
      var r = typeof row === 'string' ? [row] : row;
      var node = text(r[0]);
      if (r[1] !== undefined) node.css.fontSize = r[1];
      if (r[2] !== undefined) node.css.color = r[2];
      if (r[3] !== undefined) node.css.fontWeight = r[3];
      return node;
    });
    var g = group.apply(null, made);
    return g.layout('column', { gap: 6 });
  }

  /** text(string)   @make
   *  Words on screen. Chain on to it to say how they look and what they do.
   *  ex  text('3361 people')
   *  ex    .font('Figtree Black', 268)
   *  ex    .color('#e12392')
   *  ex    .at(90, 340)
   *  ex    .enter(340, { opacity: [0, 1], scale: [.72, 1], rotation: [-5, 0] });
   */
  function text(str) { return new Node('text', { text: str }); }

  /** image(src)   @make
   *  A picture. src is a path inside the project; imported files are under
   *  media/, and dragging one in from the media pool gives you the name.
   *  ex  image('media/city.jpg').at(0, 0).style({ width: 1080 }).enter(500, 'fade')
   */
  function image(src) { return new Node('image', { src: src }); }

  /** shape(style)   @make
   *  A plain box you can size, colour and move. Give it a background to see it.
   *  ex  shape({ width: 400, height: 8, background: '#e12392' }).at(90, 700).enter(400, 'slide')
   */
  function shape(css) { var n = new Node('shape', {}); return css ? n.style(css) : n; }

  /** group(a, b, ...)   @group
   *  Treats several things as one. Style and motion applied to the group reach
   *  every child, and .layout() arranges them.
   *  ex  const stat = group(text('11'), text('3361 people'));
   *  ex  stat.layout('row', { gap: 130 })
   *  ex      .font('Figtree Black', 268)
   *  ex      .color('#e12392')
   *  ex      .enter(340, 'pop');
   */
  function group() {
    var n = new Node('group', {}), i;
    for (i = 0; i < arguments.length; i++) {
      arguments[i].parent = n;
      n.children.push(arguments[i]);
    }
    return n;
  }

  /** items([a, b, c])   @group
   *  A group made from a list of strings, for the very common case of several
   *  lines that do the same thing one after another.
   *  ex  items(['1M views', '50K likes', '12K comments'])
   *  ex    .layout('column', { gap: 30 })
   *  ex    .size(90)
   *  ex    .stagger(80)
   *  ex    .enter(300, 'rise');
   */
  function items(list) {
    var made = [], i;
    for (i = 0; i < (list || []).length; i++) made.push(text(list[i]));
    return group.apply(null, made);
  }

  /** sequence(a, b, c, options)   @group
   *  Runs things one after another, each starting when the last finishes.
   *  A gap in the options is inserted between them, and may be negative.
   *  ex  sequence(title, subtitle, chart, { gap: 80 });
   */
  function sequence() {
    var list = [].slice.call(arguments), o = {};
    if (list.length && !(list[list.length - 1] instanceof Node)) o = list.pop();
    for (var i = 1; i < list.length; i++) list[i].after(list[i - 1], o.gap || 0);
    return list;
  }

  var API = { text: text, image: image, shape: shape,
              group: group, items: items, sequence: sequence,
              captions: captions, stack: stack, connect: connect,
              path: path, raw: raw };
  W.SCENE = API;
  for (var k in API) W[k] = API[k];
})(window, document);
