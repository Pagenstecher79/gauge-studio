/**
 * How far to scroll to bring one thing into view without pushing another out.
 *
 * The canvas editor nudges the settings of whatever part was just taken hold
 * of into view. `scrollIntoView` is the obvious way to do that and the wrong
 * one: it scrolls every scrollable ancestor, and in Home Assistant's config
 * dialog the nearest one holds the canvas as well as the form - so reaching
 * the numbers scrolled the drawing off the screen. A frame that cannot be
 * seen cannot be dragged, which is the whole point of the frames.
 *
 * So the scroll is worked out here instead, with a second rectangle that has
 * to survive it. What is free around that rectangle is all the room the
 * nudge gets. On a roomy dialog that is enough to bring a heading up; where
 * the rectangle fills the view there is no room and nothing moves - which is
 * the right answer, because the settings are one flick away and the drawing
 * is what the finger is on.
 */

/**
 * @param {{top: number, bottom: number}} item what should come into view
 * @param {{top: number, bottom: number}} view the scroller's own box
 * @param {{top: number, bottom: number}|null} keep what may not leave it
 * @returns {number} pixels to add to `scrollTop`; 0 to leave it alone
 */
export function revealBy(item, view, keep) {
  // `block: 'nearest'` semantics: the shortest move that puts it inside, and
  // nothing at all when it already is - nor when it is taller than the view
  // and already covers it, where there is no "inside" to move it to.
  const above = item.top < view.top;
  const below = item.bottom > view.bottom;
  if (above === below) return 0;
  // Below and too tall to fit: its top is what a reader is after, so that is
  // the edge to land, and taking the smaller move is how to say so.
  const dy = above ? item.top - view.top
                   : Math.min(item.bottom - view.bottom, item.top - view.top);
  if (!dy || !keep) return dy;
  // `keep` has to stay whole - it is the canvas window - and a frame
  // with its top edge off the screen cannot be dragged by that edge. Adding
  // to `scrollTop` lifts it, so what is free above it is the most that may be
  // added, and what is free below it the most that may be taken.
  const room = dy > 0 ? keep.top - view.top : view.bottom - keep.bottom;
  // Already sticking out: whoever scrolled it there meant to, and a nudge
  // that shoved it further would be answering a tap with a shrug.
  if (room <= 0) return 0;
  return dy > 0 ? Math.min(dy, room) : Math.max(dy, -room);
}

/**
 * The nearest ancestor that actually scrolls, crossing shadow boundaries.
 *
 * Every piece of this is in a shadow root of its own - the fold is the gauge
 * editor's, the editor is the canvas editor's, the canvas editor is the
 * dialog's - so walking `parentNode` alone stops at the first boundary and
 * finds nothing. It has to follow `assignedSlot` too, and that is not a
 * refinement: the scroller that carries Home Assistant's config dialog is
 * reached only that way, because the editor is slotted into it rather than
 * nested in it. A walk that misses it finds no scroller at all and reports
 * that nothing scrolls - on the one layout where something very much does.
 *
 * A scroller has to be one the user could scroll themselves. The document is
 * not: Home Assistant locks it while a dialog is open, and moving it anyway
 * is what dragged the drawing off the screen. So the walk stops at `body`.
 *
 * @param {Element|null} el
 * @returns {Element|null}
 */
export function scrollParent(el) {
  let n = el?.assignedSlot || el?.parentNode;
  while (n) {
    if (n instanceof Element) {
      if (n === document.body || n === document.documentElement) return null;
      const s = getComputedStyle(n);
      if (/(auto|scroll|overlay)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) {
        return n;
      }
      n = n.assignedSlot || n.parentNode;
    } else if (n instanceof ShadowRoot) {
      n = n.host;
    } else {
      n = /** @type {any} */ (n).parentNode || null;
    }
  }
  return null;
}
