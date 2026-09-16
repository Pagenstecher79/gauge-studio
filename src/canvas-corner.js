/**
 * The corner radius, set by a grip sitting in the corner it rounds.
 *
 * A corner radius is a distance along *both* edges from the corner, so what a
 * grip pulled inwards says is the mean of how far it has come along each: a
 * straight diagonal pull then reads as exactly the radius it draws, and a pull
 * along one edge alone still moves it, by half.
 *
 * Two corners rather than one, at the bottom left and the top right. It is one
 * value written from either, so which one is used is only ever a question of
 * which is free - whatever the element sits next to, and whatever is drawn
 * over it, one of the two can be reached.
 *
 * The two units are the two CSS means. `px` is a length, and it is a length on
 * the screen whatever the canvas is zoomed to, because the browser draws
 * `border-radius: 8px` as eight screen pixels in a box the zoom has made twice
 * as wide - so the grip maps screen pixels to the number one for one and is
 * right at any zoom. A percentage on `border-radius` is of the box's own width
 * across and its height down, which is why the mean is taken in the unit's own
 * terms: that is what keeps the grip on the corner it drew, on a box of any
 * shape.
 */

/** Where each grip sits, as a fraction of the box, and what it is called. */
export const GRIP_CORNERS = Object.freeze({
  bl: Object.freeze({ x: 0, y: 1, what: 'bottom left' }),
  tr: Object.freeze({ x: 1, y: 0, what: 'top right' }),
});

/** The most a corner may be rounded: half the box, which is a full round end. */
export const MAX_PERCENT = 50;

const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
  Math.min(hi, Math.max(lo, v));

/** A tenth, which is the step every corner-radius field in the card offers. */
const tenth = (/** @type {number} */ v) => Math.round(v * 10) / 10;

/**
 * The radius the grip has been dragged to.
 *
 * @param {{x: number, y: number}} at the pointer, in client pixels
 * @param {{left: number, top: number, width: number, height: number}} box
 *        the element's box on the screen
 * @param {string} corner a key of `GRIP_CORNERS`
 * @param {string} unit `'%'` or `'px'`
 * @returns {number}
 */
export function radiusFromGrip(at, box, corner, unit) {
  const c = GRIP_CORNERS[corner];
  if (!c || !box?.width || !box?.height) return 0;
  // How far in from the corner the pointer has come, along each edge. Never
  // out: dragging away from the corner is a radius of nothing, not a negative
  // one, and a negative radius is not a thing CSS draws.
  const cx = box.left + box.width * c.x;
  const cy = box.top + box.height * c.y;
  const dx = Math.max(0, c.x ? cx - at.x : at.x - cx);
  const dy = Math.max(0, c.y ? cy - at.y : at.y - cy);
  if (unit === '%') {
    return tenth(clamp((dx / box.width + dy / box.height) * MAX_PERCENT, 0, MAX_PERCENT));
  }
  return tenth(clamp((dx + dy) / 2, 0, Math.min(box.width, box.height) / 2));
}

/**
 * Where the grip stands for a radius that is already set, in per cent of the
 * element's box - which is what puts it on the corner it drew rather than on
 * the corner of the box.
 *
 * @param {number} radius @param {{width: number, height: number}} box
 * @param {string} corner a key of `GRIP_CORNERS`
 * @param {string} unit `'%'` or `'px'`
 * @returns {{l: number, t: number}}
 */
export function gripHome(radius, box, corner, unit) {
  const c = GRIP_CORNERS[corner] || GRIP_CORNERS.bl;
  const r = Math.max(0, radius || 0);
  const x = unit === '%'
    ? clamp(r, 0, MAX_PERCENT)
    : clamp(r / (box?.width || 1) * 100, 0, MAX_PERCENT);
  const y = unit === '%'
    ? clamp(r, 0, MAX_PERCENT)
    : clamp(r / (box?.height || 1) * 100, 0, MAX_PERCENT);
  return { l: c.x ? 100 - x : x, t: c.y ? 100 - y : y };
}
