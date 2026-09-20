/**
 * How a ring's edges are taken hold of: where each one's hit zone lies, and
 * which way the arrow over it points.
 *
 * Both answers are arithmetic about a circle and nothing else, so they live
 * here rather than inside the canvas editor - see the module's own note on
 * what belongs in a helper.
 */

/**
 * How far a hit zone reaches past the band it belongs to, in SVG user units.
 *
 * The transparent stroke used to be 2.4 wide on every band, centred on it.
 * That is the right size to reach for and the wrong one for two bands that
 * are nearly the same circle: the zones overlapped, and the one drawn last -
 * the frame's inner edge - took every press, so the outer edge, which is the
 * only handle a gauge's size has, could not be grabbed at all.
 */
export const GRAB_REACH = 1.2;

/**
 * The hit zones for a set of band radii: one per band, never overlapping.
 *
 * Two bands share the ground between them at the midpoint, and each keeps
 * `reach` on its open side. So the outer edge is always grabbed from outside
 * and the inner one from inside, however thin the frame between them has
 * become - at a width of nothing the two zones still meet back to back rather
 * than lying on top of one another, and which one the hand gets is which side
 * it came from, which is also what the two of them mean.
 *
 * Answers in the shape a circle wants: the radius to draw the transparent
 * stroke at, and how wide that stroke is.
 *
 * Worked out from the outside in, and that is not only an order: where two
 * bands are the very same circle there is no radius to tell them apart, and
 * the one named first is then given the outward side. An edge is declared
 * outside in - the frame's outer edge before its inner one - so the first of
 * two that have met is the one whose meaning lies outwards, and a hand coming
 * from outside the gauge still finds the handle that sizes it.
 *
 * @param {readonly number[]} radii the bands' radii, outermost first where
 *   two of them coincide
 * @param {number} [reach] how far a zone reaches past its band
 * @returns {{ r: number, w: number }[]} one per input radius, in that order
 */
export function hitZones(radii, reach = GRAB_REACH) {
  const sorted = [...radii].map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r);
  /** @type {{ r: number, w: number }[]} */
  const out = new Array(radii.length);
  sorted.forEach(({ r, i }, n) => {
    const above = n > 0 ? (r + sorted[n - 1].r) / 2 : r + reach;
    const below = n < sorted.length - 1 ? (r + sorted[n + 1].r) / 2 : r - reach;
    // Only ever inwards from the band's own reach: a neighbour further off
    // than the reach does not make the zone bigger than one band on its own.
    const lo = Math.max(below, r - reach);
    const hi = Math.min(above, r + reach);
    out[i] = { r: (lo + hi) / 2, w: Math.max(hi - lo, 0) };
  });
  return out;
}

/**
 * The angle from a centre to a point, in degrees clockwise from three
 * o'clock - the same way round as everything else the gauge measures, because
 * y runs downwards on a screen.
 *
 * @param {number} cx @param {number} cy @param {number} x @param {number} y
 * @returns {number} -180 to 180
 */
export function radialDeg(cx, cy, x, y) {
  return Math.atan2(y - cy, x - cx) * 180 / Math.PI;
}

/**
 * How many directions the arrow is drawn in.
 *
 * A cursor is a picture, and a picture per pixel of travel would be a new
 * image decoded on every pointer event. Sixteen is past the angle a hand can
 * tell apart on a shape this small, and because a double-headed arrow reads
 * the same turned by half a turn, eight images cover all sixteen.
 */
export const CURSOR_SECTORS = 16;

/**
 * Which of `n` sectors an angle falls in, counted from three o'clock.
 *
 * @param {number} deg @param {number} [n]
 * @returns {number} 0 to n-1
 */
export function sectorOf(deg, n = CURSOR_SECTORS) {
  const step = 360 / n;
  return ((Math.round(deg / step) % n) + n) % n;
}

/** The angle at the middle of sector `i`. @param {number} i @param {number} [n] */
export function sectorDeg(i, n = CURSOR_SECTORS) {
  return i * (360 / n);
}

/**
 * A double-headed arrow lying along `deg`, as an SVG document.
 *
 * White with a dark outline under it, the way the needle's own handles are
 * drawn: a cursor has to be seen against a pale dashboard and a dark one, and
 * over the gauge's own colours in between.
 *
 * @param {number} deg
 * @returns {string}
 */
export function arrowSvg(deg) {
  const body = '<path d="M6 12H18M8.5 8.5L5 12L8.5 15.5M15.5 8.5L19 12L15.5 15.5"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">'
    + `<g transform="rotate(${+deg.toFixed(2)} 12 12)" fill="none"`
    + ' stroke-linecap="round" stroke-linejoin="round">'
    + `<g stroke="rgba(0,0,0,0.85)" stroke-width="4.5">${body}</g>`
    + `<g stroke="#ffffff" stroke-width="2">${body}</g>`
    + '</g></svg>';
}

/** @type {Map<number, string>} */
const CURSORS = new Map();

/**
 * The CSS `cursor` for a point at `deg` on a ring: an arrow pointing the way
 * the drag actually goes.
 *
 * `ns-resize` was the cursor on every band, and it is the truth only at the
 * top and the bottom of the circle: at three o'clock a ring is dragged
 * sideways, and the arrow said otherwise. The fallback stays `ns-resize` for
 * a browser that will not take an image.
 *
 * Memoised per sector, so a drag right round a ring decodes eight images once
 * and none after that.
 *
 * @param {number} deg
 * @returns {string}
 */
export function radialCursor(deg) {
  // Half a turn: the arrow has a head at both ends, so the far half of the
  // circle is the near half's picture turned over.
  const i = sectorOf(deg) % (CURSOR_SECTORS / 2);
  let css = CURSORS.get(i);
  if (css === undefined) {
    css = `url("data:image/svg+xml,${encodeURIComponent(arrowSvg(sectorDeg(i)))}") 12 12, ns-resize`;
    CURSORS.set(i, css);
  }
  return css;
}

/**
 * Where the word naming an edge goes, and how it is anchored there.
 *
 * Inside the band rather than outside it: outside the outermost ring is off
 * the gauge, and a caption that is sometimes clipped is worse than one that
 * is always in the same relation to the circle it names. It stands at the
 * angle the hand is at, so it is read where the eye already is.
 *
 * @param {number} cx @param {number} cy @param {number} r @param {number} deg
 * @param {number} gap how far inside the band the text sits
 * @returns {{ x: number, y: number, anchor: string }}
 */
export function captionSpot(cx, cy, r, deg, gap) {
  const rad = deg * Math.PI / 180;
  const rr = Math.max(r - gap, 0);
  const cos = Math.cos(rad);
  return {
    x: cx + rr * cos,
    y: cy + rr * Math.sin(rad),
    // Away from the band, so the word does not lie along it: on the right of
    // the circle the text runs back towards the middle, and the other way on
    // the left. Near the top and the bottom it is centred, where neither
    // direction is the one leading away.
    anchor: cos > 0.2 ? 'end' : cos < -0.2 ? 'start' : 'middle',
  };
}
