/**
 * Telling a two-finger scroll from a pinch.
 *
 * A touchscreen has one gesture for zooming and it is two fingers, so the
 * canvas reads two fingers as a pinch - and the midpoint they travel by moves
 * the window, because a pinch is nearly always a little of both. What that
 * left no room for is the gesture people actually reach for most: two fingers
 * that only *scroll*. Two fingers never hold their distance to the pixel, so
 * every such drag came out as a pinch of a per cent or two, and the drawing
 * breathed in and out the whole way across the screen.
 *
 * So the distance is ignored until it has changed by more than a finger's own
 * slop. Under that, two fingers are a scroll and nothing else. Over it, the
 * gesture becomes a pinch for as long as it lasts - and it is rebased at the
 * crossing, so the zoom starts from where it is rather than jumping by the
 * slop the moment it is exceeded.
 */

/**
 * How far apart the fingers have to travel before it is a pinch, in client
 * pixels of *distance between them*, so a spread of six pixels each way.
 * Small enough that a deliberate pinch is never mistaken for a scroll, large
 * enough that a hand carrying the canvas across the screen does not zoom.
 */
export const PINCH_SLOP = 12;

/**
 * @typedef {{dist: number, zoom: number, zooming?: boolean}} PinchStart
 *   `dist` the distance the pinch is measured against, `zoom` the zoom that
 *   goes with it, `zooming` whether the slop has already been crossed.
 */

/**
 * What the zoom should be, now the fingers are `dist` apart.
 *
 * @param {PinchStart} pinch
 * @param {number} dist current distance between the two fingers
 * @param {number} [slop]
 * @returns {{zoom: number} | {rebase: number} | null}
 *   `zoom` to zoom there, `rebase` to measure from here on and leave the zoom
 *   alone this once, `null` while it is still only a scroll.
 */
export function pinchStep(pinch, dist, slop = PINCH_SLOP) {
  if (!pinch.zooming) {
    if (Math.abs(dist - pinch.dist) < slop) return null;
    return { rebase: dist };
  }
  return { zoom: pinch.zoom * (dist / Math.max(pinch.dist, 0.001)) };
}
