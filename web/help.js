/* ============================================================================
   The reference panel, opened with F1.

   Its content is not stored here. Every entry is a doc comment sitting above
   the function it describes in web/motion.js, fetched and parsed at startup,
   so the reference and the library cannot disagree. Changing a function's
   arguments puts its documentation in the same diff.

   A block in motion.js opens with a doc marker and then:

       signature   @group
       Description, one or more lines. Blank lines are kept.
       ex  a runnable example

   The first line gives the signature and the section it belongs to. Lines
   beginning with "ex" are examples; clicking one inserts it at the cursor,
   which is why the reference is in the editor rather than on a website.
   ========================================================================== */
import { $ } from './state.js';

/* Two files, two layers, and the panel says so. The scene layer is what you
   should reach for; motion.js is underneath it for the things it cannot say.
   Group names are scoped to their file, so both layers can have a "make"
   without colliding. */
const SECTIONS = [
  { file: '/web/scene.js', title: 'Writing a clip', groups: [
      ['start',  'Start here'],
      ['make',   'Making things'],
      ['look',   'How it looks'],
      ['motion', 'Motion'],
      ['time',   'Timing'],
      ['group',  'Groups and repetition']
  ] },
  { file: '/web/motion.js', title: 'Underneath', groups: [
      ['start',  'The model'],
      ['type',   'Text on screen'],
      ['track',  'Making a number move'],
      ['move',   'Animating'],
      ['make',   'Making elements'],
      ['draw',   'Drawing'],
      ['place',  'Placement'],
      ['math',   'Small maths'],
      ['easing', 'Easings'],
      ['option', 'Options']
  ] }
];

let host = null, entries = [], insertAt = () => {};

/* ------------------------------------------------------------------ parse -- */
/* One doc block -> one entry. Deliberately forgiving: a block that does not
   fit the shape is skipped rather than throwing, because a broken comment
   should never take the help page down with it. */
export function parse(source) {
  const out = [];
  const blocks = source.match(/\/\*\*[\s\S]*?\*\//g) || [];
  for (const raw of blocks) {
    /* Strip the comment gutter: leading space, the star, and the two spaces
       that follow it. Exactly two, so that indentation written INSIDE a doc
       block (an indented list, a nested line of an example) survives. */
    const lines = raw.split('\n')
      .map(l => l.replace(/^\s*\/?\*+\/?\s{0,2}/, '').replace(/\s*\*\/\s*$/, ''));
    const head = (lines.shift() || '').trim();
    if (!head) continue;
    const tag = /@(\w+)\s*$/.exec(head);
    const sig = head.replace(/\s*@\w+\s*$/, '').trim();
    if (!sig) continue;
    const name = (/^\.?([\w$]+)/.exec(sig) || [, sig])[1];

    /* An example line is "ex" followed by two spaces, or "ex" alone for a
       blank line inside an example. Indentation after those two spaces is
       part of the example and is kept. */
    const body = [], ex = [];
    for (const l of lines) {
      const m = /^ex(?:  ([\s\S]*))?$/.exec(l.replace(/\s+$/, ''));
      if (m) ex.push(m[1] || '');
      else body.push(l.replace(/\s+$/, ''));
    }
    while (body.length && !body[0].trim()) body.shift();
    while (body.length && !body[body.length - 1].trim()) body.pop();
    out.push({ name, sig, group: tag ? tag[1] : 'other', body, ex });
  }
  return out;
}

/* ------------------------------------------------------------------ build -- */
export async function init(handlers = {}) {
  insertAt = handlers.insert || insertAt;
  host = $('#help');
  if (!host) return;

  entries = [];
  for (let i = 0; i < SECTIONS.length; i++) {
    try {
      const src = await fetch(SECTIONS[i].file).then(r => r.text());
      for (const e of parse(src)) entries.push({ ...e, section: i });
    } catch { /* a layer that will not load should not empty the panel */ }
  }

  host.innerHTML = `
    <div class="helpBox">
      <div class="helpHead">
        <strong>Reference</strong>
        <input id="helpFind" placeholder="search — try stagger, or fade" autocomplete="off">
        <span class="grow"></span>
        <span class="helpTip">click any example to put it in your code</span>
        <button id="helpClose" class="btn mini">close</button>
      </div>
      <div class="helpBody">
        <nav id="helpNav"></nav>
        <div id="helpList"></div>
      </div>
    </div>`;

  host.querySelector('#helpClose').onclick = hide;
  const find = host.querySelector('#helpFind');
  find.addEventListener('input', () => render(find.value));

  /* clicking the backdrop, but not the panel, closes it */
  host.addEventListener('pointerdown', e => { if (e.target === host) hide(); });

  render('');
}

function render(q) {
  const term = (q || '').trim().toLowerCase();
  const hit = e => !term
    || e.name.toLowerCase().includes(term)
    || e.sig.toLowerCase().includes(term)
    || e.body.join(' ').toLowerCase().includes(term)
    || e.ex.join(' ').toLowerCase().includes(term);

  const shown = entries.filter(hit);
  const nav = [], cards = [];
  const seen = new Set();

  SECTIONS.forEach((sec, i) => {
    const here = shown.filter(e => e.section === i);
    if (!here.length) return;
    nav.push(`<div class="helpSec">${sec.title}</div>`);
    for (const [key, title] of sec.groups) {
      const mine = here.filter(e => e.group === key);
      if (!mine.length) continue;
      const id = `hg-${i}-${key}`;
      nav.push(`<a href="#${id}">${title}</a>`);
      cards.push(`<h3 id="${id}">${title}</h3>`);
      for (const e of mine) { cards.push(card(e)); seen.add(e); }
    }
  });
  const rest = shown.filter(e => !seen.has(e));
  if (rest.length) {
    nav.push('<a href="#hg-other">Everything else</a>');
    cards.push('<h3 id="hg-other">Everything else</h3>');
    for (const e of rest) cards.push(card(e));
  }

  host.querySelector('#helpNav').innerHTML = nav.join('');
  host.querySelector('#helpList').innerHTML = cards.length
    ? cards.join('')
    : `<p class="helpNone">Nothing matches “${esc(term)}”.</p>`;

  host.querySelectorAll('.helpEx').forEach(pre => {
    pre.onclick = () => { insertAt(pre.dataset.code); hide(); };
  });
  /* Scroll the LIST, by setting its scrollTop from the heading's offset within
     it. scrollIntoView would work on the element but scrolls whichever
     ancestors it likes, and the headings are sticky, which makes where it
     lands hard to predict. #helpList is position:relative so offsetTop is
     measured against it.

     Instantly, not smoothly: the list is several thousand pixels tall, and a
     smooth scroll across that takes seconds, during which the panel looks as
     though the click did nothing. */
  const list = host.querySelector('#helpList');
  host.querySelectorAll('#helpNav a').forEach(a => {
    a.onclick = ev => {
      ev.preventDefault();
      const target = host.querySelector(a.getAttribute('href'));
      if (target) { list.scrollTo({ top: target.offsetTop, behavior: 'auto' }); markNav(); }
    };
  });
  markNav();
  list.onscroll = markNav;
}

/* Light up the section you are actually looking at, so the nav reports where
   you are rather than only taking you places. */
function markNav() {
  const list = host.querySelector('#helpList');
  if (!list) return;
  const heads = [...list.querySelectorAll('h3')];
  let current = heads[0];
  for (const h of heads) if (h.offsetTop - 8 <= list.scrollTop) current = h;
  host.querySelectorAll('#helpNav a').forEach(a =>
    a.classList.toggle('on', !!current && a.getAttribute('href') === '#' + current.id));
}

/* The docs contain two kinds of text, and they want different treatment.

   Ordinary sentences should re-flow to the width of the panel, so the hard
   line breaks in the source are joined back into paragraphs.

   Lists of names against descriptions are aligned into columns with spaces,
   which only holds in a monospace font. Those are detected by their leading
   indent and rendered as a preformatted block instead. */
function prose(body) {
  const chunks = [];
  let run = [];
  const flush = () => { if (run.length) chunks.push(run); run = []; };
  for (const l of body) { if (l.trim()) run.push(l); else flush(); }
  flush();

  return chunks.map(c => {
    const indented = c.filter(l => /^ {2}/.test(l)).length;
    return indented >= Math.ceil(c.length / 2)
      ? `<pre class="helpDefs">${esc(c.join('\n'))}</pre>`
      : `<p>${esc(c.join(' '))}</p>`;
  }).join('');
}

function card(e) {
  const prosed = e.body.length ? `<div class="helpProse">${prose(e.body)}</div>` : '';
  const ex = e.ex.length
    ? `<pre class="helpEx" title="click to insert" data-code="${esc(e.ex.join('\n'))}">`
      + esc(e.ex.join('\n')) + '</pre>'
    : '';
  return `<article class="helpCard"><code class="helpSig">${esc(e.sig)}</code>${prosed}${ex}</article>`;
}

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------------- open -- */
export const isOpen = () => host && !host.classList.contains('hidden');
export function show() {
  if (!host) return;
  host.classList.remove('hidden');
  const f = host.querySelector('#helpFind');
  if (f) { f.value = ''; render(''); f.focus(); }
}
export function hide() { if (host) host.classList.add('hidden'); }
export function toggle() { isOpen() ? hide() : show(); }
