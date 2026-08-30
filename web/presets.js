/* ============================================================================
   PRESETS — the moves, as things you insert rather than things you write.

   Each one is working code, not a snippet with holes in it: insert it, watch
   it move, then change the numbers. Since a clip is now just the body of
   __render, a preset is too — it makes the elements it needs and animates
   them, and there is no markup half to keep in sync.
   ========================================================================== */
export const PRESETS = [

  { name: 'Kinetic line',
    note: 'staggered words, alternating direction — the workhorse',
    code:
`  label('line', '', { top: 420, fontSize: 150 });
  stagger(words('line', 'millions of lines of code'), t, 130, {
    o:    on(0, 300),
    y:    go(0, 300, -70, 0, back),
    s:    go(0, 300, .72, 1, back),
    blur: go(0, 300, 10, 0)
  }, { alt: true });` },

  { name: 'Two-line block',
    note: 'a big line and a small one under it, second line plainer',
    code:
`  label('l1', '', { top: 300, fontSize: 250, color: '#ffb02e' });
  stagger(words('l1', '3,361 people'), t, 130, {
    o: on(0, 340), y: go(0, 340, -70, 0, back),
    s: go(0, 340, .72, 1, back), r: go(0, 340, -5, 0, out),
    blur: go(0, 340, 10, 0)
  }, { from: 90, alt: true });

  /* the small line is deliberately plainer — size does the hierarchy, and
     matching the animation would flatten it */
  label('l2', '', { top: 640, fontSize: 96 });
  stagger(words('l2', '85,957 commits'), t, 90, {
    o: on(0, 300), y: go(0, 300, 34, 0, expo)
  }, { from: 520 });` },

  { name: 'Shot entrance + drift',
    note: 'arrives offset, undersized, blurred; then never stops moving',
    code:
`  img('shot', 'media/your-file.jpg', { left: 0, top: 0, width: 1920 });

  /* the house move: lands square in 620ms with an overshoot */
  enter('shot', t, 0, { x: 520, y: -120, r: 3, ry: -26, scale: .71 });

  /* and keeps travelling for the whole clip, which is what stops a held
     frame reading as a freeze */
  drift('shot', t, 0, 2000, { x: -70, y: 26, r: -0.7, ry: 6 });` },

  { name: 'Typewriter',
    note: 'characters appear one at a time, with a blinking caret',
    code:
`  box('term', { left: 120, top: 460, fontSize: 58,
                fontFamily: 'Consolas, monospace', color: '#e6e9ee' });
  var line = '> how many lines of code?';
  var n = Math.floor(seg(t, 200, 1900) * line.length);
  $('term').textContent = line.slice(0, n)
    + (n < line.length ? (Math.floor(t / 430) % 2 ? ' ' : '\\u2588') : '');` },

  { name: 'Counter',
    note: 'a number counting up, easing to a stop',
    code:
`  label('num', '', { top: 380, fontSize: 300,
                     fontVariantNumeric: 'tabular-nums' });
  $('num').textContent = Math.round(lp(0, 85957, expo(seg(t, 0, 1400)))).toLocaleString();
  anim('num', t, { o: on(0, 120), s: go(0, 1400, 1.15, 1, soft) });` },

  { name: 'Node board',
    note: 'neon pills on a plane the camera travels across',
    code:
`  box('plane', { left: 0, top: 0, width: 2560, height: 1440 });
  camera('plane', t, { x: go(0, 3000, 490, 1280, io), y: 668,
                       s: go(0, 3000, 1.3, .8, io), ry: -9 });

  var NOT = [['a library', '#35d6d6', 200],
             ['a framework', '#a56bff', 990],
             ['a tutorial', '#3ddc84', 1780]];
  NOT.forEach(function (n, i) {
    pill('p' + i, n[0], n[1], { left: n[2], top: 600, width: 580 }, 'plane');
    anim('p' + i, t - i * 900, { o: on(0, 240), s: go(0, 240, 1.1, 1, expo) });
  });` },

  { name: 'Strike through',
    note: 'a bar that wipes across from the left',
    code:
`  box('strike', { left: 640, top: 560, height: 9, width: 0, background: '#ff2d55',
                  borderRadius: 5, boxShadow: '0 0 26px #ff2d55',
                  transform: 'rotate(-1.6deg)', transformOrigin: '0 50%' });
  wipe('strike', t, 300, 520, 640);` },

  { name: 'Hold and fade out',
    note: 'the last 700ms of any clip',
    code:
`  var D = window.__duration;
  anim('stage', t, { o: [[D - 700, 1], [D, 0]] });` }
];
