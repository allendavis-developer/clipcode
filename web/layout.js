/* ============================================================================
   Where you put the panes.

   The whole layout is three CSS custom properties — --pool, --mon and
   --h-timeline — so persisting it is persisting three strings. Dragging a
   splitter writes one; the next load reads it back.

   In localStorage rather than project.json, because this is a property of the
   screen you are sitting at, not of the video. The same project opened on a
   laptop and on a 32in monitor wants different pane sizes, and a layout you
   set here should not turn up in a collaborator's checkout.

   A tiny inline script in index.html applies these before the first paint, so
   the page does not render at the default size and then jump. It knows only
   the key below and applies whatever it finds, so adding a fourth variable
   here needs no change there.
   ========================================================================== */
const KEY = 'studio.layout';

function all() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
  catch { return {}; }
}
function write(o) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* private window */ }
}

/* Called when a drag ends, not while it moves: the layout is what you settled
   on, and writing on every pointermove would be a write per frame. */
export function remember(name, value) {
  const o = all();
  o[name] = value;
  write(o);
}

/* Double-clicking a gutter puts it back to the stylesheet's default, so the
   stored override has to go with it or it would return on the next load. */
export function forget(name) {
  const o = all();
  delete o[name];
  write(o);
}

/* Applied by the inline script at boot. Here too, so a reset is complete and
   so the behaviour is testable without reloading the page. */
export function apply() {
  const o = all();
  for (const k in o) document.documentElement.style.setProperty(k, o[k]);
  return o;
}

export function reset() {
  for (const k in all()) document.documentElement.style.removeProperty(k);
  write({});
}
