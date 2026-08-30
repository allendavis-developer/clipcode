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
    spin:  { opacity: [0, 1], scale: [0.7, 1], rotation: [-12, 0], ease: 'overshoot' }
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
    this.kind = kind;                 /* text | image | shape | group | items */
    this.id = idFor(kind);
    this.opts = opts || {};
    this.css = {};                    /* fixed appearance */
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

  /** .size(px)   @look
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

  /** .center(y)   @look
   *  Centres it across the stage, rather than placing its left edge. Give a y
   *  to set the vertical position at the same time.
   *  ex  text('3361 people').center(340)
   */
  P.center = function (y) {
    this.css.left = 0;
    this.css.right = 0;
    this.css.textAlign = 'center';
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
    return this;
  };

  /** .style({ ... })   @look
   *  Any CSS, for the things the named methods do not cover. Numbers are
   *  treated as pixels.
   *  ex  text('heads up').style({ letterSpacing: -4, textShadow: '0 6px 30px #000' })
   */
  P.style = function (o) { for (var k in o) this.css[k] = o[k]; return this; };

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

  /** .start(ms)   @time
   *  Start at an absolute time. Most of the time a relationship reads better;
   *  see .after().
   *  ex  title.enter(300).start(600)
   */
  P.start = function (ms) { this._rel = null; this._start = ms || 0; return this; };

  /** .after(other, gap)   @time
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

  /** .before(other, gap)   @time
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

  /** .enter(ms, how)   @motion
   *  Bring it on. `how` is either the name of a preset or a spec of your own.
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

  /** .exit(ms, how)   @motion
   *  Take it off. Same presets and the same spec shape as .enter().
   *
   *  With no time of its own it follows whatever came before it, which is
   *  usually what you want: enter, hold, leave.
   *  ex  title.enter(300).hold(1200).exit(250);
   */
  P.exit = function (ms, how) {
    return this._add(ms === undefined ? 250 : ms, specOf(EXIT, how, 'fade'));
  };

  /** .hold(ms)   @motion
   *  Do nothing for a while. Only useful between two other moves.
   *  ex  title.enter(300).hold(1200).exit(250)
   */
  P.hold = function (ms) { return this._add(ms || 0, {}); };

  /** .move(to, ms, ease)   @motion
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

  /** .fade(from, to, ms, ease)   @motion
   *  Opacity, from one value to another.
   *  ex  caption.fade(1, 0.3, 400)
   */
  P.fade = function (from, to, ms, ease) {
    return this._add(ms === undefined ? 300 : ms,
                     { opacity: [from === undefined ? 0 : from,
                                 to === undefined ? 1 : to], ease: ease });
  };

  /** .scale(from, to, ms, ease)   @motion
   *  ex  logo.scale(1, 1.15, 600, 'easeInOut')
   */
  P.scale = function (from, to, ms, ease) {
    return this._add(ms === undefined ? 400 : ms,
                     { scale: [from === undefined ? 1 : from,
                               to === undefined ? 1 : to], ease: ease });
  };

  /** .rotate(from, to, ms, ease)   @motion
   *  Degrees.
   *  ex  arrow.rotate(0, 90, 400, 'overshoot')
   */
  P.rotate = function (from, to, ms, ease) {
    return this._add(ms === undefined ? 400 : ms,
                     { rotation: [from || 0, to || 0], ease: ease });
  };

  /** .draw(ms, ease)   @motion
   *  Draws an SVG path on, as if written by hand. For shape() paths.
   *  ex  chart.draw(600).after(subtitle, -120)
   */
  P.draw = function (ms, ease) {
    return this._add(ms === undefined ? 600 : ms, { __draw: true, ease: ease });
  };

  /** .stagger(ms)   @group
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

  function elementOf(n) {
    var parentId = n.parent ? n.parent.id : undefined;
    /* A child of a laid-out group flows; a child of a plain group is still
       placed by hand with .at(). Everything on the stage itself is absolute. */
    if (n.parent && n.parent.css.display === 'flex' && n.css.position === undefined)
      n.css.position = 'static';
    if (n.kind === 'text')  return M.label(n.id, n.opts.text, n.css, parentId);
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
    var el = elementOf(n);
    var local = t - n._start - (extraDelay || 0);
    var spec = specOfNode(n, el, local);
    var perChild = n.children.length && (n.gapMs || n.alt);
    var i, kid, kidSpec;

    if (!perChild && Object.keys(spec).length)
      M.anim(el, local, reverse ? flip(spec) : spec);

    for (i = 0; i < n.children.length; i++) {
      kid = n.children[i];
      var flipped = n.alt && (i % 2) ? !reverse : reverse;
      if (perChild && Object.keys(spec).length) {
        kidSpec = flipped ? flip(spec) : spec;
        M.anim(elementOf(kid), local - i * n.gapMs, kidSpec);
      }
      applyNode(kid, t, (extraDelay || 0) + n._start + i * n.gapMs - kid._start, flipped);
    }
    return el;
  }

  /* ---------------------------------------------------------- the frame -- */
  /* Called by the shell around the clip's own code. Everything the clip
     declared is thrown away and rebuilt, which is what makes the render a pure
     function of t no matter what the clip did. */
  W.__sceneBegin = function () { nodes = []; counter = 0; };

  /* The resolved timeline, after the relationships have been worked out. The
     relationships are what you wrote; this is what they came to. Exposed
     because a dependency graph you cannot see the result of is worse than
     timestamps, and because it is the honest thing to assert against. */
  W.__scenePlan = function () {
    resolve();
    return nodes.map(function (n) {
      return { id: n.id, kind: n.kind,
               text: (n.opts.text || '').slice(0, 24),
               start: Math.round(n.startsAt()),
               end: Math.round(n.endsAt()),
               rel: n._rel ? n._rel.how + '(' + n._rel.of.id
                             + (n._rel.gap ? ', ' + n._rel.gap : '') + ')' : 'absolute' };
    });
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
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].parent) continue;            /* children are drawn by their group */
      applyNode(nodes[i], t, 0);
    }
    for (i = 0; i < nodes.length; i++) end = Math.max(end, nodes[i].endsAt());
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

  /* ------------------------------------------------------------- making -- */

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
              group: group, items: items, sequence: sequence };
  W.SCENE = API;
  for (var k in API) W[k] = API[k];
})(window, document);
