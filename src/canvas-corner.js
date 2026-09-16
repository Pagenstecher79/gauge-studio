/**
 * The corner radius, set by a grip that slides along the frame's own edge.
 *
 * The way a drawing program does it: the grip lives *on* the border and
 * travels along it, and how far it has come from the corner is the radius. No
 * diagonal, no mean of two numbers - one edge, one distance, and the grip is
 * always standing on the thing it set.
 *
 * Two grips, one value, and each on an edge of its own: the bottom-left one
 * runs along the bottom, the top-right one down the right-hand side. One value
 * because a corner radius is one number; two grips because which of them is
 * free is a question of what the element sits next to and what is drawn over
 * it, and because a flat element has room along its length while a narrow one
 * has room down its side.
 *
 * The two units are the two CSS means. `px` is a length, and it is a length on
 * the screen whatever the canvas is zoomed to, because the browser draws
 * `border-radius: 8px` as eight screen pixels in a box the zoom has made twice
 * as wide - so the grip maps screen pixels to the number one for one and is
 * right at any zoom. A percentage on `border-radius` is of the box's own width
 * across and its height down, which is exactly the axis each grip runs along.
 */

/**
 * Where each grip sits and which way it runs.
 *
 * `x`/`y` are the corner it belongs to, as a fraction of the box; `axis` is
 * the edge it travels along, and `what` names it the way the tooltip does.
 */
export const GRIP_CORNERS = Object.freeze({
  bl: Object.freeze({ x: 0, y: 1, axis: 'x', what: 'along the bottom edge' }),
  tr: Object.freeze({ x: 1, y: 0, axis: 'y', what: 'down the right-hand edge' }),
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
  const along = c.axis === 'x';
  const side = along ? box.width : box.height;
  const from = along ? box.left : box.top;
  const where = along ? at.x : at.y;
  // How far along its edge the grip has come from its own corner. Never back
  // past it: a grip pushed the other way is a radius of nothing, not a
  // negative one, and a negative radius is not a thing CSS draws.
  const gone = Math.max(0, (along ? c.x : c.y) ? from + side - where : where - from);
  if (unit === '%') return tenth(clamp(gone / side * 100, 0, MAX_PERCENT));
  // Half the *short* side, whichever edge the grip runs along: a radius larger
  // than that would have the two corners of the narrow side overlapping, which
  // is where CSS stops drawing what it was asked for.
  return tenth(clamp(gone, 0, Math.min(box.width, box.height) / 2));
}

/**
 * Where the grip stands for a radius that is already set, in per cent of the
 * element's box - on its own edge, at the point the radius reaches.
 *
 * @param {number} radius @param {{width: number, height: number}} box
 * @param {string} corner a key of `GRIP_CORNERS`
 * @param {string} unit `'%'` or `'px'`
 * @returns {{l: number, t: number}}
 */
export function gripHome(radius, box, corner, unit) {
  const c = GRIP_CORNERS[corner] || GRIP_CORNERS.bl;
  const along = c.axis === 'x';
  const side = (along ? box?.width : box?.height) || 1;
  const gone = clamp(unit === '%' ? (radius || 0) : (radius || 0) / side * 100, 0, MAX_PERCENT);
  const on = (along ? c.x : c.y) ? 100 - gone : gone;
  return along ? { l: on, t: c.y * 100 } : { l: c.x * 100, t: on };
}
