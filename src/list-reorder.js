/**
 * Dragging a row of a list into another place, with a finger as well as a
 * mouse.
 *
 * The lists in this card were reordered with HTML5 drag and drop: a grip that
 * set `draggable` on `mousedown` and took it off again on `mouseup`, and a
 * `dragstart`/`dragover`/`drop` trio on the row. That works with a mouse and
 * with nothing else. A touchscreen fires no `mousedown` until the finger is
 * lifted, and Chromium does not start a drag from a touch at all - so the
 * grip did nothing, the page took the press for a scroll, and the whole
 * editor slid up under the finger. On a tablet, which is what a wall-mounted
 * dashboard is edited on, a list simply could not be reordered.
 *
 * So the pointer does it instead. One press, one capture, one release: the
 * row under the pointer is the place the held row is going, and letting go is
 * the move. Pointer events are the one input model that answers for a mouse,
 * a finger and a pen alike, and pointer capture is what keeps a drag that has
 * wandered off the row - or off the list - still talking to the grip.
 *
 * The arithmetic is `indexAtY`, which is the whole of what a drag decides, and
 * it is pure so it can be tested. The class around it is the bookkeeping: what
 * is held, where it is going, and telling the host to redraw.
 */

/**
 * Which row a pointer at `y` is over.
 *
 * A row's rectangle is not the whole story: a list has gaps between its rows
 * and a finger has to be allowed to sit in one, so a point outside every row
 * belongs to the row it is nearest. That also answers the two ends - a drag
 * dragged off the top of the list means the first row, off the bottom the
 * last - which is what makes a list longer than the screen reorderable at
 * all.
 *
 * Ties go to the earlier row, which only happens exactly halfway down a gap.
 *
 * @param {{top: number, bottom: number}[]} rects the rows, in order
 * @param {number} y
 * @param {number} [fallback] what an empty list answers
 * @returns {number}
 */
export function indexAtY(rects, y, fallback = -1) {
  if (!Array.isArray(rects) || !rects.length) return fallback;
  let best = fallback;
  let bestDist = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (dist < bestDist) { bestDist = dist; best = i; }
    if (dist === 0) break;
  }
  return best;
}

/**
 * One list's grips, for a Lit host that draws them.
 *
 * Made once, in the host's constructor, and asked in every render - a
 * controller made during a render would lose the drag it is holding on the
 * next one.
 *
 * `rows(group)` hands back the row elements in order, and `move(from, to,
 * group)` is the edit. `group` is whatever the host needs to tell one of its
 * lists from another: a gauge editor draws a list of gauges and a list of
 * sectors per gauge, and both go through one controller.
 *
 * @param {object} host a LitElement, or anything with `requestUpdate`
 * @param {{ rows: (group: any) => ArrayLike<Element>,
 *           move: (from: number, to: number, group: any) => void }} opts
 */
export class ListReorder {
  constructor(host, opts) {
    this.host = host;
    this.opts = opts;
    /** @type {{from: number, to: number, id: number, group: any}|null} */
    this.held = null;
    this.down = this.down.bind(this);
    this.over = this.over.bind(this);
    this.up = this.up.bind(this);
    this.swallow = this.swallow.bind(this);
  }

  /**
   * Take a row in hand.
   *
   * The press is stopped where it is: the grip sits inside a `<summary>`, and
   * a press that went on would open the fold under the finger - and, on the
   * canvas, would be one more press the drawing beneath could read as its
   * own.
   */
  down(e, i, group = null) {
    e.preventDefault();
    e.stopPropagation();
    // Capture is what keeps a drag talking to the grip once the pointer has
    // wandered off it. It throws where the pointer is no longer active, which
    // is not a reason to lose the drag.
    try {
      /** @type {any} */ (e.currentTarget).setPointerCapture?.(e.pointerId);
    } catch { /* the drag works without it, it just ends at the edge */ }
    this.held = { from: i, to: i, id: e.pointerId, group };
    this.host.requestUpdate();
  }

  /** Where it would land if it were let go now. */
  over(e) {
    const held = this.held;
    if (!held || e.pointerId !== held.id) return;
    e.preventDefault();
    const rects = Array.from(this.opts.rows(held.group) || [])
      .map(el => el.getBoundingClientRect());
    const to = indexAtY(rects, e.clientY, held.from);
    if (to === held.to || to < 0) return;
    this.held = { ...held, to };
    this.host.requestUpdate();
  }

  /** Let go: the move, or nothing where it landed where it started. */
  up(e) {
    const held = this.held;
    if (!held || e.pointerId !== held.id) return;
    e.preventDefault();
    e.stopPropagation();
    this.held = null;
    this.host.requestUpdate();
    // Cancelled rather than released - a call came in, the browser took the
    // gesture - means the row goes nowhere.
    if (e.type === 'pointercancel') return;
    if (held.to !== held.from && held.to >= 0) {
      this.opts.move(held.from, held.to, held.group);
    }
  }

  /**
   * The click the release leaves behind.
   *
   * A press on the grip is a drag and never a press on the row it is part of,
   * so the click that follows it has to go nowhere - otherwise the fold the
   * grip sits in opens every time a colour is moved.
   */
  swallow(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  /** Whether the row at `i` is the one being carried. */
  lifted(i, group = null) {
    return !!this.held && this.held.from === i && this.held.group === group;
  }

  /** Whether the row at `i` is the place it would land. */
  target(i, group = null) {
    return !!this.held && this.held.to === i && this.held.from !== i
      && this.held.group === group;
  }
}
