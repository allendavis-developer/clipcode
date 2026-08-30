/* ============================================================================
   THE EDITING LIBRARY — injected into every code clip, before its own script.

   This is where the speed comes from. Not from presets, and not from typing
   being faster than clicking: from the fact that in a node editor the cost of
   a move is proportional to the number of things it moves, and here it is
   flat. Twelve words staggered costs exactly what one word costs.

   Four ideas, and everything else is built on them:

     1  A TRACK is [[time, value], [time, value, easing]] — sampled at t,
        held outside its range. Every animated number in this system is one.

     2  anim(el, t, spec) applies a spec of tracks. Properties that share a
        transform (x y z s r rx ry) compose into one string in a fixed order,
        so they cannot fight. blur / bright / sat compose into one filter.

     3  stagger(list, t, gap, spec) is the same spec down a list, each later
        than the last. That is what kinetic type IS.

     4  Elements can be MADE from code — box, label, img, pill — so a clip is
        one file with one language in it, not markup over here and animation
        over there. Making is idempotent: safe to call every frame.

   Everything is a pure function of t. Nothing schedules, nothing accumulates.
   That is what keeps scrubbing, playback and the render identical.
   ========================================================================== */
(function (W, D) {
  'use strict';

  /* ------------------------------------------------------------- easings -- */
  var E = {
    /* steady all the way — no acceleration */
    linear:    function (t) { return t; },
    /* quick off the mark, coasting to a stop. the everyday one */
    easeOut:   function (t) { return 1 - Math.pow(1 - t, 3); },
    /* slow to start, still moving at the end */
    easeIn:    function (t) { return t * t * t; },
    /* slow at both ends, quick through the middle. camera moves */
    easeInOut: function (t) { return t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2; },
    /* very fast, then a hard stop. reads as impact */
    snap:      function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -9*t); },
    /* goes PAST the target and comes back. this is the one with weight */
    overshoot: function (t) { var c = 1.34, c3 = c + 1;
                              return 1 + c3*Math.pow(t-1,3) + c*Math.pow(t-1,2); },
    /* eases to a stop but never past the target — for scale, where going past
       1 reads as a wobble rather than as weight */
    settle:    function (t) { return 1 - Math.pow(1 - t, 5); },
    /* no in-between: off, then on */
    hardCut:   function (t) { return t >= 1 ? 1 : 0; }
  };
  /* the old short names still work */
  E.out = E.easeOut; E.into = E.easeIn; E.io = E.easeInOut;
  E.expo = E.snap;   E.back = E.overshoot; E.soft = E.settle; E.step = E.hardCut;

  var cl  = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
  var seg = function (t, a, b) { return b === a ? (t >= b ? 1 : 0) : cl((t - a) / (b - a)); };
  var lp  = function (a, b, t) { return a + (b - a) * t; };
  var ease = function (e) { return typeof e === 'string' ? (E[e] || E.linear) : (e || E.linear); };

  /* --------------------------------------------------------------- track -- */
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

  /* Track shorthands. `o: on(0,300)` beats `o: [[0,0],[300,1]]` once you have
     written the second one fifty times. */
  /* change(startMs, endMs, from, to, easing) — the general one. Everything
     else here is a change() with the obvious values already filled in. */
  var change  = function (a, b, v0, v1, e) { return [[a, v0], [b, v1, e]]; };
  var fadeIn  = function (a, b, e) { return [[a, 0], [b, 1, e]]; };
  var fadeOut = function (a, b, e) { return [[a, 1], [b, 0, e]]; };
  var hold    = function (v) { return [[0, v]]; };
  /* the old short names still work */
  var tween = change, go = change, on = fadeIn, off = fadeOut;

  /* ------------------------------------------------------------- bezier --
     Your own easing curve, the same four numbers CSS uses. Draw one at
     cubic-bezier.com and paste the numbers straight in:

         y: change(0, 400, -70, 0, bezier(.34, 1.56, .64, 1))

     x1,y1 and x2,y2 are the two control handles. Pull a y past 1 and the
     curve overshoots; pull one below 0 and it winds up first. Solving for
     y given x needs a root find, so results are cached per curve — a clip
     calls this thirty times a second. */
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
  var FILTER    = { blur:1, brightness:1, saturation:1 };
  var PX        = { top:1, left:1, right:1, bottom:1, width:1, height:1,
                    fontSize:1, letterSpacing:1, borderRadius:1, borderWidth:1 };
  var el = function (e) { return typeof e === 'string' ? D.getElementById(e) : e; };

  function anim(target, t, rawSpec) {
    var n = el(target);
    if (!n || !rawSpec) return n;
    var spec = canonical(rawSpec);
    var k, v, anyT = false, anyF = false;

    for (k in spec) {
      if (!spec.hasOwnProperty(k)) continue;
      if (TRANSFORM[k]) { anyT = true; continue; }
      if (FILTER[k])    { anyF = true; continue; }
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
    if (anyF) {
      var bl = spec.blur       ? track(spec.blur, t)       : 0;
      var br = spec.brightness ? track(spec.brightness, t) : 1;
      var sa = spec.saturation ? track(spec.saturation, t) : 1;
      var f = (bl > 0.02 ? 'blur(' + bl.toFixed(2) + 'px) ' : '')
            + (Math.abs(br - 1) > 0.002 ? 'brightness(' + br.toFixed(3) + ') ' : '')
            + (Math.abs(sa - 1) > 0.002 ? 'saturate(' + sa.toFixed(3) + ')' : '');
      n.style.filter = f.trim() || 'none';
    }
    return n;
  }

  /* ------------------------------------------------------------- stagger --
     opts: {from} delay before the first, {alt} flip y/x/r on odd items,
     {each} a function(i, n) returning extra spec for that item. */
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
  var words = function (a, b) { return split(a, b, 'words'); };
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
      n.style.position = 'absolute';
      for (var k in css) if (css.hasOwnProperty(k)) {
        var v = css[k];
        n.style[k] = (typeof v === 'number' && PX[k]) ? v + 'px' : v;
      }
    }
    return n;
  }
  function box(id, css, parent) { return mk('div', id, css, parent); }
  function img(id, src, css, parent) {
    var n = mk('img', id, css, parent);
    if (n.getAttribute('src') !== src) n.setAttribute('src', src);
    return n;
  }
  /* a centred line of type, which is most of what a kinetic clip contains */
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
     A plane bigger than the frame, and a camera parked somewhere on it. You
     give the point you want centred and how close you are; it works out the
     transform. This is how a board or a pipeline beat is built: lay it out in
     plane coordinates once, then move the camera. */
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
  function wipe(target, t, a, b, width, e) {
    var n = el(target);
    if (!n) return n;
    n.style.width = (width * ease(e || E.out)(seg(t, a, b))).toFixed(1) + 'px';
    return n;
  }

  /* ------------------------------------------------------------- placing --
     Where to put the i-th of n things. ring() uses the golden angle, so no
     visible rows and no two runs alike; grid() when you want rows. */
  function ring(i, n, rx, ry, cx, cy) {
    var a = i * 2.39996 + 1.15;
    return { x: (cx === undefined ? 960 : cx) + Math.cos(a) * rx,
             y: (cy === undefined ? 540 : cy) + Math.sin(a) * (ry === undefined ? rx : ry) };
  }
  function grid(i, cols, w, h, x0, y0) {
    return { x: (x0 || 0) + (i % cols) * w, y: (y0 || 0) + Math.floor(i / cols) * h };
  }
  /* deterministic pseudo-random — same i, same answer, every frame and every
     render. Math.random() in a __render is the classic way to break purity. */
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
         o: on(0, 340), y: go(0, 340, -70, 0, back)
       });                                                                   */
  var STYLE = { top:1, left:1, right:1, bottom:1, width:1, size:1, color:1,
                font:1, italic:1, weight:1, align:1, tracking:1, leading:1,
                shadow:1, background:1, zIndex:1 };
  var TIMING = { gap:1, from:1, alt:1, each:1, parent:1 };

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

  function line(id, text, t, o) {
    o = o || {};
    var css = {}, spec = {}, k;
    for (k in o) {
      if (TIMING[k]) continue;
      if (STYLE[k]) continue;
      spec[k] = o[k];
    }
    styleInto(css, o);
    if (false) {
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
    }

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
              /* older short names, still supported */
              tween:tween, on:on, off:off, go:go,
              stagger:stagger, words:words, chars:chars, box:box, img:img,
              label:label, pill:pill, camera:camera, draw:draw, wipe:wipe,
              ring:ring, grid:grid, rnd:rnd, enter:enter, drift:drift, line:line, block:block,
              cl:cl, seg:seg, lp:lp, merge:merge };
  W.M = API;
  for (var k in API) W[k] = API[k];
  W.linear = E.linear; W.easeIn = E.easeIn; W.easeOut = E.easeOut;
  W.easeInOut = E.easeInOut; W.snap = E.snap; W.overshoot = E.overshoot;
  W.settle = E.settle; W.hardCut = E.hardCut;
  W.back = E.back; W.out = E.out; W.expo = E.expo; W.io = E.io;
  W.soft = E.soft; W.into = E.into; W.eOut = E.out; W.eExpo = E.expo; W.eIO = E.io;
  W.$ = function (id) { return D.getElementById(id); };
})(window, document);
