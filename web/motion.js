/* ============================================================================
   The editing library. Injected into every code clip, before the clip's own
   script, so everything below is available as a global inside a clip.

   The doc comments in this file are the reference shown by the Help panel
   (F1). web/help.js parses them out of this source, so the reference and the
   code cannot disagree. A block opens with a doc marker, then:

       signature   @group
       Description, one or more lines.
       ex  a runnable example

   Groups are start, type, track, move, make, draw, place, math, easing and
   option, and set which section of the panel an entry appears under.

   The design rests on four things:

     1  A track is [[time, value], [time, value, easing]]. It is sampled at t
        and held outside its range. Every animated value is one of these.

     2  anim(el, t, spec) applies an object of tracks. Properties sharing one
        CSS property are composed into a single string in a fixed order so
        they cannot overwrite each other: the transform, the filter (blur,
        the colour grade, the glow and the shadow), and the gradient fill.

     3  stagger(list, t, gap, spec) applies one spec down a list with an
        increasing delay. The cost of writing it does not grow with the length
        of the list, which is the main advantage over a node-based editor.

     4  Elements are created from code (box, label, img, pill), so a clip is
        one file in one language. Creation is idempotent and safe to call on
        every frame.

   Every function here is a pure function of t: nothing schedules and nothing
   accumulates. That is what keeps scrubbing, playback and export identical.
   ========================================================================== */
(function (W, D) {
  'use strict';




  /* ------------------------------------------------------------- easings -- */







  /** Tracks, and the model underneath   @start
   *  Everything in this layer works in absolute milliseconds, and every
   *  animated value is a track: a list of times and values, read at t.
   *
   *      property: change(startMs, endMs, from, to, easing)
   *
   *  For example, scale: change(0, 340, 0.72, 1, overshoot) holds 0.72
   *  until 0ms, moves to 1 by 340ms following the overshoot easing, and
   *  holds 1 afterwards.
   *
   *  The scene layer is built on this, and turns relationships between
   *  objects into these numbers for you. Reach for this layer when you
   *  need something the scene layer cannot say.
   *  ex  line('l1', 'example text', t, {
   *  ex    top: 340, size: 268,
   *  ex    opacity: fadeIn(0, 340),
   *  ex    scale: change(0, 340, 0.72, 1, overshoot),
   *  ex    y: change(0, 340, -70, 0, overshoot)
   *  ex  });
   */

  /** Easings   @easing
   *  An easing controls the rate of a move. It is the last argument of
   *  change(), fadeIn() and fadeOut(), and defaults to linear.
   *
   *    linear      constant rate
   *    easeIn      starts slowly, fastest at the end
   *    easeOut     starts fast, slows to a stop
   *    easeInOut   slow at both ends, fast in the middle
   *    snap        very fast, then stops abruptly
   *    overshoot   passes the target value and returns to it
   *    settle      slows to a stop without passing the target
   *    hardCut     no intermediate values: off, then on
   *
   *  The earlier names back, out, into, io, expo, soft and step have been
   *  removed. Using one raises an error naming its replacement.
   *
   *  For an easing that is not in this list, use bezier() or curve().
   *  ex  scale: change(0, 340, 0.72, 1, overshoot)
   */
  var E = {
    linear:    function (t) { return t; },
    easeOut:   function (t) { return 1 - Math.pow(1 - t, 3); },
    easeIn:    function (t) { return t * t * t; },
    easeInOut: function (t) { return t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2; },
    snap:      function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -9*t); },
    overshoot: function (t) { var c = 1.34, c3 = c + 1;
                              return 1 + c3*Math.pow(t-1,3) + c*Math.pow(t-1,2); },
    /* stops at the target rather than passing it, so scale does not wobble */
    settle:    function (t) { return 1 - Math.pow(1 - t, 5); },
    hardCut:   function (t) { return t >= 1 ? 1 : 0; }
  };


  /** cl(x)   @math
   *  Clamps a number to the range 0 to 1.
   *  ex  cl(1.4)
   */
  var cl  = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
  /** seg(t, startMs, endMs)   @math
   *  Returns progress from 0 to 1 through the given time range, clamped at both ends.
   *  ex  var u = seg(t, 400, 900);
   */
  var seg = function (t, a, b) { return b === a ? (t >= b ? 1 : 0) : cl((t - a) / (b - a)); };
  /** lp(from, to, u)   @math
   *  Linear interpolation. Returns from when u is 0 and to when u is 1.
   *  ex  var size = lp(200, 280, seg(t, 0, 500));
   */
  var lp  = function (a, b, t) { return a + (b - a) * t; };
  var ease = function (e) {
    if (typeof e !== 'string') return e || E.linear;
    if (E[e]) return E[e];
    if (RENAMED[e]) throw renamedError(e);   /* not a silent fall back to linear */
    throw new Error("there is no easing called '" + e + "'");
  };

  /* --------------------------------------------------------------- track -- */
  /** track(keyframes, t)   @track
   *  Reads a list of keyframes at time t. A keyframe is [timeMs, value] or
   *  [timeMs, value, easing], and the list must be in time order. Between
   *  two keyframes the value is interpolated using the easing on the second
   *  one; outside the list the nearest end value is held.
   *
   *  change(), fadeIn(), fadeOut() and hold() are shorthands that build
   *  these lists. Write one directly when a property needs more than two
   *  stops.
   *  ex  opacity: [[0, 0], [200, 1, easeOut], [1800, 1], [2000, 0]]
   */
  function track(kfs, t) {
    if (typeof kfs === 'number') return kfs;
    if (!kfs || !kfs.length) return 0;
    if (kfs.length === 1 || t <= kfs[0][0]) return kfs[0][1];
    for (var i = 1; i < kfs.length; i++) {
      var a = kfs[i - 1], b = kfs[i];
      if (t <= b[0]) return lp(a[1], b[1], ease(b[2])(cl((t - a[0]) / (b[0] - a[0]))));
    }
    return kfs[kfs.length - 1][1];
  }

  /* Track shorthands: change() is the general one, and the rest are a change()
     with the obvious values already filled in. */
  /** change(startMs, endMs, from, to, easing)   @track
   *  Returns a track that moves a property from one value to another between
   *  two times. The value is held at `from` before startMs and at `to` after
   *  endMs.
   *
   *  easing is optional and defaults to linear.
   *
   *  This was previously called go() and tween(). Those names now raise an
   *  error telling you to use change().
   *  ex  scale: change(0, 340, 0.72, 1, overshoot)
   *  ex  y: change(200, 600, -80, 0)
   */
  var change  = function (a, b, v0, v1, e) { return [[a, v0], [b, v1, e]]; };
  /** fadeIn(startMs, endMs, easing)   @track
   *  Returns a track from 0 to 1. Equivalent to change(startMs, endMs, 0, 1,
   *  easing), and normally assigned to opacity.
   *
   *  This was previously called on(), which now raises an error.
   *  ex  opacity: fadeIn(0, 340)
   */
  var fadeIn  = function (a, b, e) { return [[a, 0], [b, 1, e]]; };
  /** fadeOut(startMs, endMs, easing)   @track
   *  Returns a track from 1 to 0.
   *
   *  This was previously called off(), which now raises an error.
   *  ex  opacity: fadeOut(1800, 2200)
   */
  var fadeOut = function (a, b, e) { return [[a, 1], [b, 0, e]]; };
  /** hold(value)   @track
   *  Returns a track with a single constant value.
   *  ex  rotation: hold(-4)
   */
  var hold    = function (v) { return [[0, v]]; };
  /* the old short names still work */
  /* The old names, and what replaced them. They are not aliases any more:
     each one throws and says what to write instead. A name that has moved
     should say so once, not go on quietly working for years and leave two
     ways to write everything. */
  var RENAMED = {
    go: 'change', tween: 'change', on: 'fadeIn', off: 'fadeOut',
    back: 'overshoot', out: 'easeOut', into: 'easeIn', io: 'easeInOut',
    expo: 'snap', soft: 'settle', step: 'hardCut',
    eOut: 'easeOut', eExpo: 'snap', eIO: 'easeInOut'
  };
  function renamedError(from) {
    return new Error(from + ' has been renamed to ' + RENAMED[from]);
  }
  function renamed(from) {
    return function () { throw renamedError(from); };
  }

  /* ------------------------------------------------------------- bezier --
     Your own easing curve, the same four numbers CSS uses. Draw one at
     cubic-bezier.com and paste the numbers straight in:

         y: change(0, 400, -70, 0, bezier(.34, 1.56, .64, 1))

     x1,y1 and x2,y2 are the two control handles. Pull a y past 1 and the
     curve overshoots; pull one below 0 and it winds up first. Solving for
     y given x needs a root find, so results are cached per curve — a clip
     calls this thirty times a second. */
  /** bezier(x1, y1, x2, y2)   @track
   *  Returns a custom easing defined by two control points, using the same
   *  four numbers as the CSS cubic-bezier function.
   *
   *  y values above 1 cause the value to pass its target and return; y
   *  values below 0 cause it to move backwards before moving forwards.
   *
   *  Placing the cursor inside a bezier() call opens the curve editor on it.
   *  Dragging in the editor rewrites these numbers.
   *  ex  scale: change(0, 340, 0.72, 1, bezier(0.34, 1.56, 0.64, 1))
   */
  function bezier(x1, y1, x2, y2) {
    var A = function (a, b) { return 1 - 3*b + 3*a; };
    var B = function (a, b) { return 3*b - 6*a; };
    var C = function (a) { return 3*a; };
    var calc = function (u, a, b) { return ((A(a,b)*u + B(a,b))*u + C(a))*u; };
    var slope = function (u, a, b) { return 3*A(a,b)*u*u + 2*B(a,b)*u + C(a); };
    var cache = {};
    return function (t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      var key = (t * 1000) | 0;
      if (cache[key] !== undefined) return cache[key];
      var u = t;
      for (var i = 0; i < 8; i++) {                 /* Newton-Raphson */
        var d = slope(u, x1, x2);
        if (Math.abs(d) < 1e-6) break;
        u -= (calc(u, x1, x2) - t) / d;
      }
      return (cache[key] = calc(u, y1, y2));
    };
  }

  /* ---------------------------------------------------------------- curve --
     An easing through AS MANY POINTS AS YOU LIKE, where bezier() gives you
     exactly two handles. Pass the points the curve should pass THROUGH:

         y: change(0, 600, -70, 0, curve([[0,0],[0.4,1.15],[0.7,0.92],[1,1]]))

     x is progress 0..1, y is the eased value — above 1 overshoots, below 0
     winds up first. Between points it is a Catmull-Rom spline, so the shape
     is smooth and every point is actually hit rather than approached.

     Cached per curve: a clip asks thirty times a second. */
  /** curve([[x, y], [x, y], ...])   @track
   *  Returns a custom easing that passes through the given points. x is
   *  progress from 0 to 1 and y is the resulting value, where y above 1
   *  passes the target and y below 0 moves backwards first.
   *
   *  Use this instead of bezier() when the shape needs more than two
   *  control points. The curve editor opens on these as well; clicking
   *  empty space in it adds a point and right-clicking one removes it.
   *  ex  y: change(0, 600, 100, 0, curve([[0, 0], [0.4, 1.15], [0.7, 0.94], [1, 1]]))
   */
  function curve(points) {
    var p = (points || []).slice().sort(function (a, b) { return a[0] - b[0]; });
    if (p.length < 2) return E.linear;
    if (p[0][0] > 0) p.unshift([0, p[0][1]]);
    if (p[p.length - 1][0] < 1) p.push([1, p[p.length - 1][1]]);
    var cache = {};
    /* slope at each point, from its neighbours — this is what makes the join
       between two segments smooth instead of a corner */
    var m = p.map(function (_, i) {
      var a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
      return b[0] === a[0] ? 0 : (b[1] - a[1]) / (b[0] - a[0]);
    });
    return function (t) {
      if (t <= 0) return p[0][1];
      if (t >= 1) return p[p.length - 1][1];
      var key = (t * 1000) | 0;
      if (cache[key] !== undefined) return cache[key];
      var i = 0;
      while (i < p.length - 2 && t > p[i + 1][0]) i++;
      var x0 = p[i][0], x1 = p[i + 1][0], h = x1 - x0;
      if (h <= 0) return (cache[key] = p[i + 1][1]);
      var u = (t - x0) / h, u2 = u * u, u3 = u2 * u;
      var y = (2*u3 - 3*u2 + 1) * p[i][1]
            + (u3 - 2*u2 + u) * h * m[i]
            + (-2*u3 + 3*u2) * p[i + 1][1]
            + (u3 - u2) * h * m[i + 1];
      return (cache[key] = y);
    };
  }

  /* ---------------------------------------------------------------- anim -- */
  /* Canonical property names, with the old short ones kept as aliases so
     nothing already written stops working. Anything not listed falls through
     to CSS, so letterSpacing, borderColor and the rest still animate. */
  var ALIAS = { o:'opacity', s:'scale', r:'rotation', sx:'scaleX', sy:'scaleY',
                rx:'rotateX', ry:'rotateY', bright:'brightness', sat:'saturation' };
  var TRANSFORM = { x:1, y:1, z:1, scale:1, scaleX:1, scaleY:1,
                    rotation:1, rotateX:1, rotateY:1 };
  /* Everything that ends up inside the ONE CSS filter string. A property here
     cannot be written to the element on its own — the last writer would win
     and every other effect would vanish — so they are gathered and composed in
     the fixed order in FX_ORDER below. */
  var FILTER    = { blur:1, brightness:1, saturation:1, contrast:1,
                    grayscale:1, sepia:1, invert:1, hue:1,
                    glow:1, shadowX:1, shadowY:1, shadowBlur:1 };
  /* Colours are not numbers, so they cannot be tracks. They ride in the same
     spec as plain strings and are read straight out of it. */
  var FILTER_COLOR = { glowColor:1, shadowColor:1 };
  /* The other two composites: a gradient is colours + angle + offset in one
     background-image, and a text outline is a width and a colour. */
  var GRADIENT  = { gradientColors:1, gradientAngle:1, gradientShift:1 };
  var STROKE    = { textStroke:1, textStrokeColor:1 };
  var PX        = { top:1, left:1, right:1, bottom:1, width:1, height:1,
                    fontSize:1, letterSpacing:1, borderRadius:1, borderWidth:1,
                    gap:1, rowGap:1, columnGap:1, padding:1, margin:1,
                    minWidth:1, minHeight:1, maxWidth:1, maxHeight:1 };
  var el = function (e) { return typeof e === 'string' ? D.getElementById(e) : e; };

  /** anim(element, t, spec)   @move
   *  Applies animated properties to a single element at time t. spec is an
   *  object of property names to tracks.
   *
   *  element may be an id or an element. See Animatable properties for the
   *  list of names accepted in spec.
   *  ex  anim('title', t, { opacity: fadeIn(0, 300), y: change(0, 300, -60, 0, overshoot) });
   */
  function anim(target, t, rawSpec) {
    var n = el(target);
    if (!n || !rawSpec) return n;
    var spec = canonical(rawSpec);
    var k, v, anyT = false, anyF = false, anyG = false, anyS = false;

    for (k in spec) {
      if (!spec.hasOwnProperty(k)) continue;
      if (TRANSFORM[k]) { anyT = true; continue; }
      if (FILTER[k] || FILTER_COLOR[k]) { anyF = true; continue; }
      if (GRADIENT[k])  { anyG = true; continue; }
      if (STROKE[k])    { anyS = true; continue; }
      v = track(spec[k], t);
      if (k === 'opacity') n.style.opacity = (+v).toFixed(4);
      else if (typeof v === 'number' && PX[k]) n.style[k] = v.toFixed(2) + 'px';
      else n.style[k] = v;
    }
    if (anyT) {
      var g = function (key, dflt) { return spec[key] === undefined ? dflt : track(spec[key], t); };
      var x = g('x',0), y = g('y',0), z = g('z',0);
      var r = g('rotation',0), rx = g('rotateX',0), ry = g('rotateY',0);
      var s = g('scale',1), sx = g('scaleX',s), sy = g('scaleY',s);
      n.style.transform =
        'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,' + z.toFixed(2) + 'px)'
        + (rx ? ' rotateX(' + rx.toFixed(3) + 'deg)' : '')
        + (ry ? ' rotateY(' + ry.toFixed(3) + 'deg)' : '')
        + (r  ? ' rotate('  + r.toFixed(3)  + 'deg)' : '')
        + ' scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')';
    }
    /* One filter string, built in a FIXED order, because a CSS filter is a
       pipeline and not a set: each function eats the previous one's output.
       Grade first so a tint changes the colour that the halo is then made of;
       blur before the shadows so a soft thing casts a soft shadow rather than
       a sharp shadow of a soft thing. Written in any other order the same
       numbers give a different picture, so the order is not the caller's to
       vary — it is the one thing that makes these composable at all. */
    if (anyF) {
      var q = function (key, dflt) { return spec[key] === undefined ? dflt : track(spec[key], t); };
      var gy = q('grayscale', 0), se = q('sepia', 0), iv = q('invert', 0), hu = q('hue', 0);
      var sa = q('saturation', 1), co = q('contrast', 1), br = q('brightness', 1);
      var bl = q('blur', 0), gl = q('glow', 0);
      var dx = q('shadowX', 0), dy = q('shadowY', 0), db = q('shadowBlur', 0);
      var gc = spec.glowColor || 'currentColor';
      var sc = spec.shadowColor || 'rgba(0,0,0,.55)';
      var f = '';
      if (gy > 0.002) f += 'grayscale(' + gy.toFixed(3) + ') ';
      if (se > 0.002) f += 'sepia(' + se.toFixed(3) + ') ';
      if (iv > 0.002) f += 'invert(' + iv.toFixed(3) + ') ';
      if (Math.abs(hu) > 0.05) f += 'hue-rotate(' + hu.toFixed(2) + 'deg) ';
      if (Math.abs(sa - 1) > 0.002) f += 'saturate(' + sa.toFixed(3) + ') ';
      if (Math.abs(co - 1) > 0.002) f += 'contrast(' + co.toFixed(3) + ') ';
      if (Math.abs(br - 1) > 0.002) f += 'brightness(' + br.toFixed(3) + ') ';
      if (bl > 0.02) f += 'blur(' + bl.toFixed(2) + 'px) ';
      /* Two haloes, not one. A single drop-shadow reads as a rim drawn around
         the edge; a tight one inside a wide faint one reads as light coming
         off the thing, which is what a bloom is. */
      if (gl > 0.05) f += 'drop-shadow(0 0 ' + (gl * 0.4).toFixed(2) + 'px ' + gc + ') '
                        + 'drop-shadow(0 0 ' + gl.toFixed(2) + 'px ' + gc + ') ';
      if (db > 0.02 || Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02)
        f += 'drop-shadow(' + dx.toFixed(2) + 'px ' + dy.toFixed(2) + 'px '
           + Math.max(0, db).toFixed(2) + 'px ' + sc + ') ';
      n.style.filter = f.trim() || 'none';
    }
    /* Colours, angle and offset are three properties of ONE background-image,
       so they are composed here for the same reason the filter is. The offset
       is what sweeps a highlight across a word: the gradient is wider than the
       element, and this slides it. */
    if (anyG) {
      var cols = spec.gradientColors;
      if (cols && cols.length) {
        var ang = spec.gradientAngle === undefined ? 90 : track(spec.gradientAngle, t);
        n.style.backgroundImage =
          'linear-gradient(' + ang.toFixed(2) + 'deg,' + cols.join(',') + ')';
      }
      if (spec.gradientShift !== undefined)
        n.style.backgroundPosition = track(spec.gradientShift, t).toFixed(2) + '% 50%';
    }
    if (anyS) {
      if (spec.textStroke !== undefined)
        n.style.webkitTextStrokeWidth = Math.max(0, track(spec.textStroke, t)).toFixed(2) + 'px';
      if (typeof spec.textStrokeColor === 'string')
        n.style.webkitTextStrokeColor = spec.textStrokeColor;
    }
    return n;
  }

  /* ------------------------------------------------------------- stagger --
     opts: {from} delay before the first, {alt} flip y/x/r on odd items,
     {each} a function(i, n) returning extra spec for that item. */
  /** stagger(list, t, gapMs, spec, options)   @move
   *  Applies the same spec to every element in list, delaying each one by
   *  gapMs more than the previous.
   *
   *    list     elements, usually from words() or chars()
   *    gapMs    delay added per element
   *    spec     the same object anim() takes
   *    options  alt   reverses the direction of every second element. It
   *                   negates x, y and rotation only, so it does nothing to a
   *                   spec that animates just opacity or scale
   *             from  delays the whole sequence by this many milliseconds
   *             each  function (i, count) returning extra spec for element i
   *
   *  The cost of writing this does not grow with the number of elements,
   *  which is the main difference from a node-based editor, where each
   *  element needs its own node.
   *  ex  stagger(words('l1', 'one two three'), t, 130, {
   *  ex    opacity: fadeIn(0, 340),
   *  ex    y: change(0, 340, -70, 0, overshoot)
   *  ex  }, { alt: true });
   */
  function stagger(list, t, gap, spec, opts) {
    opts = opts || {};
    var from = opts.from || 0;
    for (var i = 0; i < list.length; i++) {
      var s = (opts.alt && i % 2) ? flip(spec) : spec;
      if (opts.each) s = merge(s, opts.each(i, list.length));
      anim(list[i], t - from - i * gap, s);
    }
    return list;
  }
  function flip(spec) {
    var out = {}, k;
    for (k in spec) out[k] = (k === 'y' || k === 'x' || k === 'r' || k === 'rotation')
      && spec[k].map ? spec[k].map(function (f) { return [f[0], -f[1], f[2]]; }) : spec[k];
    return out;
  }
  /* short property names in, canonical ones out */
  function canonical(spec) {
    var out = {}, k;
    for (k in spec) out[ALIAS[k] || k] = spec[k];
    return out;
  }
  /** merge(a, b)   @math
   *  Returns a new object with the properties of a and b, where b takes precedence.
   *  ex  merge(base, { top: 500 })
   */
  function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

  /* --------------------------------------------------------------- words --
     Split once, reuse. Called every frame it rebuilds only when the text
     changed — rebuilding DOM 30 times a second is the slow thing. */
  function split(target, text, mode) {
    var n = el(target);
    if (!n) return [];
    var key = mode + ' ' + text;
    if (n.__k !== key) {
      n.__k = key; n.innerHTML = '';
      var parts = mode === 'chars' ? String(text).split('') : String(text).split(' ');
      n.__p = parts.map(function (p, i) {
        var s = D.createElement('span');
        s.textContent = p;
        s.style.display = 'inline-block';
        s.style.whiteSpace = 'pre';
        if (mode !== 'chars' && i < parts.length - 1) s.style.marginRight = '.26em';
        n.appendChild(s); return s;
      });
    }
    return n.__p;
  }
  /** words(id, text)   @type
   *  Splits text into one element per word inside the element with the given
   *  id, and returns the list. The split is performed once and reused, so it
   *  is safe to call every frame. Pass the result to stagger().
   *  ex  stagger(words('l1', 'one two three'), t, 130, { opacity: fadeIn(0, 300) });
   */
  var words = function (a, b) { return split(a, b, 'words'); };
  /** chars(id, text)   @type
   *  As words(), but one element per character.
   *  ex  stagger(chars('n', '3361'), t, 40, { y: change(0, 300, 40, 0, overshoot) });
   */
  var chars = function (a, b) { return split(a, b, 'chars'); };

  /* ---------------------------------------------------------------- make --
     Elements from code. Idempotent: the first call builds it, later calls
     return the same node and only restyle if the options changed. This is
     what lets a clip be one file with one language in it. */
  function mk(tag, id, css, parentId) {
    var n = D.getElementById(id);
    if (!n) {
      n = D.createElement(tag);
      n.id = id;
      (parentId ? D.getElementById(parentId) : D.getElementById('stage') || D.body).appendChild(n);
    }
    var key = JSON.stringify(css);
    if (n.__css !== key) {
      n.__css = key;
      /* Absolute is the default because a clip places things on a stage. It is
         only a default: a style that names its own position wins, which is
         what lets a group lay its children out in flow. */
      n.style.position = 'absolute';
      for (var k in css) if (css.hasOwnProperty(k)) {
        var v = css[k];
        n.style[k] = (typeof v === 'number' && PX[k]) ? v + 'px' : v;
      }
    }
    return n;
  }
  /** box(id, style, parentId)   @make
   *  Creates an empty div and returns it. The element is created once per
   *  id, so calling this every frame is expected and does not duplicate it.
   *
   *  style is an object of CSS properties. Numbers are treated as pixels.
   *  ex  box('bar', { top: 900, left: 100, width: 400, height: 8, background: '#ffb02e' });
   */
  function box(id, css, parent) { return mk('div', id, css, parent); }
  /** img(id, src, style, parentId)   @make
   *  Creates an image element. src is a path relative to the project folder;
   *  imported files are under media/.
   *  ex  img('shot', 'media/city.jpg', { top: 0, left: 0, width: 1080 });
   */
  function img(id, src, css, parent) {
    var n = mk('img', id, css, parent);
    if (n.getAttribute('src') !== src) n.setAttribute('src', src);
    return n;
  }
  /* a centred line of type, which is most of what a kinetic clip contains */
  /** label(id, text, style, parentId)   @make
   *  Creates a text element without splitting or staggering it. Use line()
   *  instead when the words should animate separately.
   *  ex  label('cap', 'source: ONS', { top: 980, size: 40, opacity: 0.6 });
   */
  function label(id, text, css, parent) {
    css = css || {};
    var n = mk('div', id, merge({ left: 0, right: 0, textAlign: 'center',
      fontWeight: 900, letterSpacing: '-.03em', lineHeight: 1 }, css), parent);
    if (css.__split !== undefined) return n;
    if (n.__k === undefined && n.textContent !== String(text)) n.textContent = text;
    else if (n.__k === undefined) n.textContent = text;
    return n;
  }
  /* the neon pill: dark glass, coloured rim and label, glow. Never a flat fill. */
  /** pill(id, text, colour, style, parentId)   @make
   *  Creates a rounded label with a background colour.
   *  ex  pill('tag', 'LONDON', '#ffb02e', { top: 120, left: 80 });
   */
  function pill(id, text, colour, css, parent) {
    var n = mk('div', id, merge({
      height: 130, borderRadius: 26, display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: 60, fontWeight: 900,
      border: '3px solid ' + colour, color: colour,
      background: 'linear-gradient(180deg,' + colour + '26,#05070c 78%)',
      boxShadow: '0 0 58px ' + colour + '55, inset 0 0 34px ' + colour + '22',
      textShadow: '0 0 26px ' + colour
    }, css || {}), parent);
    if (n.textContent !== String(text)) n.textContent = text;
    return n;
  }

  /* -------------------------------------------------------------- camera --
     Kept as an internal, and no longer exported.

     It predates the scene layer's camera, which is a real one: a position in
     the scene, depth, and parallax that falls out of the perspective. This is
     only anim() on a container under another name, and while it was exported
     it also SHADOWED that camera — scene.js puts the Camera object on
     window.camera every frame, so `camera('plane', t, ...)` in a clip stopped
     being a function call at all and started being an object.

     Two things called camera, one of them winning silently, is worse than one
     of them going away. Use camera.to() for a camera, or anim() on the
     container when the move belongs to the board rather than to the shot. */
  function camera(target, t, spec) {
    var n = el(target);
    if (!n) return n;
    var cx = track(spec.x || 0, t), cy = track(spec.y || 0, t);
    var s  = spec.s === undefined ? 1 : track(spec.s, t);
    var ry = spec.ry === undefined ? 0 : track(spec.ry, t);
    var rx = spec.rx === undefined ? 0 : track(spec.rx, t);
    var z  = spec.z === undefined ? 0 : track(spec.z, t);
    var fw = (W.__stageW || 1920) / 2, fh = (W.__stageH || 1080) / 2;
    n.style.transformOrigin = '50% 50%';
    n.style.transform = 'translate(' + ((fw - cx) * s).toFixed(2) + 'px,'
      + ((fh - cy) * s).toFixed(2) + 'px) translateZ(' + z.toFixed(1) + 'px) scale('
      + s.toFixed(4) + ')' + (ry ? ' rotateY(' + ry.toFixed(2) + 'deg)' : '')
      + (rx ? ' rotateX(' + rx.toFixed(2) + 'deg)' : '');
    return n;
  }

  /* ---------------------------------------------------------------- draw --
     A stroke that draws itself on. Works on any SVG path: give it the element
     and a window, and it reveals along its own length. This is every
     connector, underline, strike and hand-drawn arrow. */
  /** draw(path, t, startMs, endMs, easing)   @draw
   *  Animates an SVG path so that its stroke is drawn on progressively
   *  between two times. path is the id of an SVG path element.
   *  ex  draw('underline', t, 300, 800, easeOut);
   */
  function draw(target, t, a, b, e) {
    var n = el(target);
    if (!n || !n.getTotalLength) return n;
    if (n.__len === undefined) n.__len = n.getTotalLength();
    var u = ease(e || E.out)(seg(t, a, b));
    n.style.strokeDasharray = n.__len;
    n.style.strokeDashoffset = (n.__len * (1 - u)).toFixed(2);
    return n;
  }
  /* a wipe, for things that are not paths */
  /** wipe(element, t, startMs, endMs, widthPx, easing)   @draw
   *  Reveals an element from left to right by animating a clip rectangle
   *  across it. widthPx is the width to reveal.
   *  ex  wipe('headline', t, 0, 500, 900);
   */
  function wipe(target, t, a, b, width, e) {
    var n = el(target);
    if (!n) return n;
    n.style.width = (width * ease(e || E.out)(seg(t, a, b))).toFixed(1) + 'px';
    return n;
  }

  /* ------------------------------------------------------------- placing --
     Where to put the i-th of n things. ring() uses the golden angle, so no
     visible rows and no two runs alike; grid() when you want rows. */
  /** ring(i, count, radiusX, radiusY, centreX, centreY)   @place
   *  Returns { x, y } for item i of count evenly spaced around an ellipse.
   *  ex  var p = ring(i, 8, 300, 300, 540, 540);
   */
  function ring(i, n, rx, ry, cx, cy) {
    var a = i * 2.39996 + 1.15;
    return { x: (cx === undefined ? 960 : cx) + Math.cos(a) * rx,
             y: (cy === undefined ? 540 : cy) + Math.sin(a) * (ry === undefined ? rx : ry) };
  }
  /** grid(i, columns, cellW, cellH, x0, y0)   @place
   *  Returns { x, y } for item i in a grid of the given column count and cell size.
   *  ex  var p = grid(i, 4, 240, 240, 60, 400);
   */
  function grid(i, cols, w, h, x0, y0) {
    return { x: (x0 || 0) + (i % cols) * w, y: (y0 || 0) + Math.floor(i / cols) * h };
  }
  /* deterministic pseudo-random — same i, same answer, every frame and every
     render. Math.random() in a __render is the classic way to break purity. */
  /** rnd(i, seed)   @place
   *  Returns a number between 0 and 1 that varies with i but is the same on
   *  every call for the same i and seed.
   *
   *  Use this instead of Math.random, which would return a different value
   *  on every frame and produce a different result each time the clip is
   *  drawn.
   *  ex  rotation: hold(-6 + rnd(i) * 12)
   */
  function rnd(i, seed) {
    var x = Math.sin(i * 127.1 + (seed || 0) * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /* ----------------------------------------------------------------- line --
     label + words + stagger, which is the three calls you write most often, as
     one. Style keys are a fixed list; gap / from / alt / each are timing; and
     anything else is a track. One flat object, no nesting.

       line('l1', '3,361 people', t, {
         top: 340, size: 268, color: '#ffb02e', font: 'Fraunces 72pt Black',
         italic: true, gap: 130, from: 90, alt: true,
         opacity: fadeIn(0, 340), y: change(0, 340, -70, 0, overshoot)
       });                                                                   */
  var STYLE = { top:1, left:1, right:1, bottom:1, width:1, size:1, color:1,
                font:1, italic:1, weight:1, align:1, tracking:1, leading:1,
                shadow:1, background:1, zIndex:1 };
  var TIMING = { gap:1, from:1, alt:1, each:1, parent:1 };









  /** Appearance options   @option
   *  Accepted by line(), block() and label(). These are fixed values, not
   *  animated tracks.
   *
   *    top, left, right, width   position and width in stage pixels
   *    size                      font size in pixels
   *    color                     any CSS colour, for example '#ffb02e'
   *    font                      font family name. Use the font picker above
   *                              the code to insert the exact name
   *    italic                    true or false
   *    weight                    100 to 900
   *    align                     'left', 'center' or 'right'
   *    tracking                  letter spacing
   *    leading                   line height
   *    shadow                    any CSS text-shadow value
   *    background                any CSS background value
   *    zIndex                    stacking order within the clip
   *  ex  line('l1', 'example text', t, {
   *  ex    top: 340, size: 268, color: '#ffb02e',
   *  ex    font: 'Fraunces 72pt Black', italic: true
   *  ex  });
   */

  /** Animatable properties   @option
   *  Any option that is not an appearance option is treated as an animated
   *  property, and takes a track: change(), fadeIn(), fadeOut(), hold(), or
   *  a list of keyframes.
   *
   *    opacity                       0 to 1
   *    x, y, z                       offset in pixels from the laid-out position
   *    scale, scaleX, scaleY         1 is unscaled
   *    rotation, rotateX, rotateY    degrees
   *    blur                          pixels
   *    brightness, saturation        1 is unmodified
   *    contrast                      1 is unmodified
   *    grayscale, sepia, invert      0 to 1
   *    hue                           degrees around the colour wheel
   *    glow                          halo radius in pixels
   *    shadowX, shadowY, shadowBlur  a cast shadow, in pixels
   *    textStroke                    outline width on text, in pixels
   *    gradientAngle                 degrees, 90 being left to right
   *    gradientShift                 slides the gradient across, in per cent
   *
   *  These four are settings rather than tracks, because a colour is not a
   *  number and cannot be interpolated by track():
   *
   *    glowColor, shadowColor, textStrokeColor   any CSS colour. glowColor
   *                                              defaults to currentColor, so
   *                                              a thing glows its own colour
   *    gradientColors                            a list of CSS colours
   *
   *  The transform properties are combined into one CSS transform, the filter
   *  properties into one CSS filter, and the gradient properties into one
   *  background-image, so setting several of them does not cause one to
   *  overwrite another. Within the filter the order is fixed — grade, then
   *  blur, then glow, then shadow — because a filter is a pipeline and the
   *  same numbers in another order are a different picture.
   *  ex  line('l1', 'example text', t, {
   *  ex    top: 340, size: 268,
   *  ex    opacity: fadeIn(0, 340),
   *  ex    y: change(0, 340, -70, 0, overshoot),
   *  ex    glow: change(0, 340, 0, 26), glowColor: '#ffb02e'
   *  ex  });
   */

  /** Stagger options   @option
   *  Accepted by line() and block() only. They control how the individual
   *  words are offset from each other.
   *
   *    gap     milliseconds between each word starting. 0, the default,
   *            moves them all together
   *    from    delays the whole line by this many milliseconds
   *    alt     reverses the direction of every second word, so they
   *            alternate. It negates x, y and rotation only, and has no
   *            effect on a line that animates just opacity or scale
   *    parent  id of an element to place this inside, for use with camera()
   *
   *  For example, with y: change(0, 600, 100, 0) and alt: true, the first
   *  word rises from below, the second drops from above, the third rises,
   *  and so on.
   *  ex  line('l1', 'three words here', t, {
   *  ex    top: 340, size: 200,
   *  ex    y: change(0, 600, 100, 0),
   *  ex    gap: 130, from: 200, alt: true
   *  ex  });
   */
  function styleInto(css, o) {
    if (o.top !== undefined)   css.top = o.top;
    if (o.left !== undefined)  css.left = o.left;
    if (o.right !== undefined) css.right = o.right;
    if (o.width !== undefined) css.width = o.width;
    if (o.size !== undefined)  css.fontSize = o.size;
    if (o.color)    css.color = o.color;
    if (o.font)     css.fontFamily = "'" + o.font + "', system-ui, sans-serif";
    if (o.italic)   css.fontStyle = 'italic';
    if (o.weight)   css.fontWeight = o.weight;
    if (o.align)    css.textAlign = o.align;
    if (o.tracking !== undefined) css.letterSpacing = o.tracking;
    if (o.leading !== undefined)  css.lineHeight = o.leading;
    if (o.shadow)   css.textShadow = o.shadow;
    if (o.background) css.background = o.background;
    if (o.zIndex !== undefined) css.zIndex = o.zIndex;
    return css;
  }

  /** line(id, text, t, options)   @type
   *  Creates a text element, splits it into words, and animates the words in
   *  sequence. Combines label(), words() and stagger() in one call.
   *
   *    id       a name of your choosing. The same id refers to the same
   *             element, so calling this every frame reuses it rather than
   *             creating a new one
   *    text     the text to display
   *    t        the clip time. Pass the variable t unchanged
   *    options  appearance, animated properties and stagger options
   *
   *  Returns the list of word elements.
   *  ex  line('l1', '3361 people', t, { top: 340, size: 268 });
   */
  function line(id, text, t, o) {
    o = o || {};
    var css = {}, spec = {}, k;
    for (k in o) {
      if (TIMING[k]) continue;
      if (STYLE[k]) continue;
      spec[k] = o[k];
    }
    styleInto(css, o);
    label(id, '', css, o.parent);
    var parts = words(id, text);
    if (Object.keys(spec).length)
      stagger(parts, t, o.gap || 0, spec,     /* no gap unless you ask */
              { from: o.from || 0, alt: !!o.alt, each: o.each });
    return parts;
  }

  /* ---------------------------------------------------------------- block --
     Same call as line(), but the motion applies to the LINE AS ONE THING
     rather than to each word. Use line() when the words should arrive
     separately, block() when the sentence should move as a unit — a scale on
     a block grows the whole line about its centre, where a scale on words
     grows each word about its own and the spacing stays put. */
  /** block(id, text, t, options)   @type
   *  As line(), but animates the text as a single element rather than word
   *  by word. Use it when the line should move as one object.
   *  ex  block('sub', 'every single day', t, { top: 620, size: 90, opacity: fadeIn(0, 300) });
   */
  function block(id, text, t, o) {
    o = o || {};
    var css = {}, spec = {}, k;
    for (k in o) if (!TIMING[k] && !STYLE[k]) spec[k] = o[k];
    styleInto(css, o);
    label(id, '', css, o.parent);
    words(id, text);
    anim(id, t - (o.from || 0), spec);
    return el(id);
  }

  /* ---------------------------------------------------------- house moves -- */
  /** enter(element, t, atMs, options)   @move
   *  Shorthand for a standard entrance at atMs: fades in and scales up with
   *  an overshoot easing.
   *
   *    options  dur    length in milliseconds, default 340
   *             scale  starting scale, default 0.8
   *             x, y   starting offset in pixels
   *  ex  enter('badge', t, 400, { y: 60 });
   */
  function enter(target, t, at, o) {
    o = o || {}; at = at || 0;
    var dur = o.dur || 620;
    var spec = { opacity: fadeIn(at, at + Math.min(120, dur / 5)),
                 scale: change(at, at + dur, o.scale === undefined ? 0.8 : o.scale, 1, E.overshoot) };
    if (o.x)  spec.x        = change(at, at + dur, o.x, 0, E.overshoot);
    if (o.y)  spec.y        = change(at, at + dur, o.y, 0, E.overshoot);
    if (o.r)  spec.rotation = change(at, at + dur, o.r, 0, E.easeOut);
    if (o.ry) spec.rotateY  = change(at, at + dur, o.ry, 0, E.easeOut);
    if (o.blur !== 0) spec.blur = change(at, at + dur * 0.6, o.blur || 16, 0, E.easeOut);
    return anim(target, t, spec);
  }
  /** drift(element, t, startMs, endMs, options)   @move
   *  Applies a slow continuous move between two times, so a static shot is
   *  not completely still. Defaults to scaling up by 3.5%.
   *
   *    options  s   end scale
   *             x, y, r, ry   end offset, rotation and Y rotation
   *  ex  drift('bg', t, 0, 2200, { s: 1.06 });
   */
  function drift(target, t, a, b, o) {
    o = o || {};
    var spec = { scale: change(a, b, 1, o.s === undefined ? 1.035 : o.s) };
    if (o.x)  spec.x        = change(a, b, 0, o.x);
    if (o.y)  spec.y        = change(a, b, 0, o.y);
    if (o.r)  spec.rotation = change(a, b, 0, o.r);
    if (o.ry) spec.rotateY  = change(a, b, 0, o.ry);
    return anim(target, t, spec);
  }

  var API = { E:E, track:track, change:change, bezier:bezier, curve:curve,
              fadeIn:fadeIn, fadeOut:fadeOut, hold:hold, anim:anim,
              stagger:stagger, words:words, chars:chars, box:box, img:img,
              label:label, pill:pill, draw:draw, wipe:wipe,
              ring:ring, grid:grid, rnd:rnd, enter:enter, drift:drift, line:line, block:block,
              cl:cl, seg:seg, lp:lp, merge:merge };
  W.M = API;
  for (var k in API) W[k] = API[k];
  W.linear = E.linear; W.easeIn = E.easeIn; W.easeOut = E.easeOut;
  W.easeInOut = E.easeInOut; W.snap = E.snap; W.overshoot = E.overshoot;
  W.settle = E.settle; W.hardCut = E.hardCut;
  for (var r in RENAMED) W[r] = renamed(r);
  W.$ = function (id) { return D.getElementById(id); };
})(window, document);
