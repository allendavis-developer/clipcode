/* ============================================================================
   WHAT EACH FUNCTION TAKES.

   Shown live as you type, with the argument you are currently filling picked
   out — the thing you miss most from a real editor is not autocomplete, it is
   not having to remember the order of five arguments.

   This table is hand-written rather than derived, because the parameter NAMES
   are the documentation. `change(startMs, endMs, from, to, easing)` tells you
   what to type; `change(a, b, v0, v1, e)` does not.
   ========================================================================== */
export const SIGNATURES = {
  /* the clip itself */
  duration:  ['ms'],
  css:       ['stylesheetText'],
  html:      ['markup'],

  /* type */
  line:      ['id', 'text', 't', 'options'],
  block:     ['id', 'text', 't', 'options'],
  words:     ['id', 'text'],
  chars:     ['id', 'text'],

  /* animating */
  anim:      ['element', 't', 'spec'],
  stagger:   ['list', 't', 'gapMs', 'spec', 'options'],
  camera:    ['plane', 't', 'spec'],
  enter:     ['element', 't', 'atMs', 'options'],
  drift:     ['element', 't', 'startMs', 'endMs', 'options'],

  /* tracks — the value of one property over time */
  change:    ['startMs', 'endMs', 'from', 'to', 'easing'],
  fadeIn:    ['startMs', 'endMs', 'easing'],
  fadeOut:   ['startMs', 'endMs', 'easing'],
  hold:      ['value'],
  bezier:    ['x1', 'y1', 'x2', 'y2'],
  track:     ['keyframes', 't'],

  /* making things */
  box:       ['id', 'style', 'parentId'],
  label:     ['id', 'text', 'style', 'parentId'],
  img:       ['id', 'src', 'style', 'parentId'],
  pill:      ['id', 'text', 'colour', 'style', 'parentId'],

  /* drawing */
  draw:      ['path', 't', 'startMs', 'endMs', 'easing'],
  wipe:      ['element', 't', 'startMs', 'endMs', 'widthPx', 'easing'],

  /* placement and maths */
  ring:      ['i', 'count', 'radiusX', 'radiusY', 'centreX', 'centreY'],
  grid:      ['i', 'columns', 'cellW', 'cellH', 'x0', 'y0'],
  rnd:       ['i', 'seed'],
  seg:       ['t', 'startMs', 'endMs'],
  lp:        ['from', 'to', 'u'],
  cl:        ['x'],

  /* older short names, same shapes */
  go:        ['startMs', 'endMs', 'from', 'to', 'easing'],
  tween:     ['startMs', 'endMs', 'from', 'to', 'easing'],
  on:        ['startMs', 'endMs', 'easing'],
  off:       ['startMs', 'endMs', 'easing']
};

/* The options a line()/block() call understands, listed where you can see
   them rather than in a document you have to go and find. */
export const OPTION_KEYS = {
  line:  'top left right width size color font italic weight align tracking leading '
       + 'shadow background · gap from alt · opacity x y z scale rotation rotateX '
       + 'rotateY blur brightness saturation',
  block: 'same as line, but the motion applies to the whole line at once'
};

export const EASINGS = 'linear easeIn easeOut easeInOut snap overshoot settle hardCut '
                     + '· bezier(x1,y1,x2,y2) for your own';
