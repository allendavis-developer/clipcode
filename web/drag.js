/* ============================================================================
   DRAGGING, once, correctly.

   The naive version — add mousemove/mouseup to the window on mousedown, remove
   them on mouseup — leaks. If the pointer is released outside the window, over
   an iframe, or the browser swallows the mouseup for any other reason, the move
   handler stays attached and the element then follows the cursor with no button
   held. That is the "it resizes when I only hover" bug, and no amount of extra
   guards fixes it, because the premise is wrong: a drag is not a pair of
   independent events, it is one interaction owned by one element.

   Pointer capture says exactly that. From pointerdown until release, every
   pointer event for that pointer is delivered to the capturing element —
   outside the window, over an iframe, anywhere — and the browser guarantees a
   final pointerup or pointercancel. Nothing is attached to the window, so
   nothing can be left behind.
   ========================================================================== */

/**
 * @param {Element} el      the thing you press to start the drag
 * @param {object}  h       { start, move, end } — start may return a context
 *                          object, which is handed to move and end
 */
export function draggable(el, h = {}) {
  if (!el) return;
  el.addEventListener('pointerdown', down => {
    if (down.button !== 0) return;
    down.preventDefault();
    el.setPointerCapture(down.pointerId);

    const ctx = h.start ? h.start(down) : {};
    if (ctx === false) { el.releasePointerCapture(down.pointerId); return; }

    const move = e => { if (e.pointerId === down.pointerId) h.move?.(e, ctx); };
    const done = e => {
      if (e.pointerId !== down.pointerId) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', done);
      el.removeEventListener('pointercancel', done);
      try { el.releasePointerCapture(down.pointerId); } catch {}
      h.end?.(e, ctx);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', done);
    el.addEventListener('pointercancel', done);
  });
}

/* While a drag is running the cursor should not flicker between shapes as it
   passes over other elements. */
export function cursorDuring(shape) {
  const prev = document.body.style.cursor;
  document.body.style.cursor = shape;
  return () => { document.body.style.cursor = prev; };
}
