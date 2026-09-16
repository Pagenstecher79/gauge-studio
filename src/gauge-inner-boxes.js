/**
 * The arithmetic behind editing a gauge's own parts on the canvas.
 *
 * A gauge draws into a 50 x 50 viewBox whose centre is the pivot, and its
 * label and value sit at an offset from that centre, in viewBox units,
 * multiplied by the gauge's own `gauge_scale`. The canvas editor lets those
 * two be dragged and resized directly, which means turning pointer pixels
 * back into the numbers those fields hold - and that conversion is the only
 * part of the feature worth testing on its own, so it lives here.
 *
 * Pixels reach these functions already divided by the scale between the
 * screen and the viewBox (`pxPerUnit`), which the editor reads from the SVG's
 * own screen matrix rather than working out from the element's box: a gauge
 * is letterboxed inside its box, and the matrix is the one thing that knows
 * where it landed.
 */

/** The gauge's viewBox, and the centre every offset is measured from. */
export const GAUGE_VIEW = 50;
export const GAUGE_CENTER = GAUGE_VIEW / 2;

/** What the editor's own sliders allow, so a drag cannot write past them. */
export const OFFSET_LIMIT = 25;
export const FONT_MIN = 0.5;
export const FONT_MAX = 20;

/** @param {number} v @param {number} lo @param {number} hi */
export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** One decimal, which is the step every one of these fields is set in. */
function tenth(v) {
  return Math.round(v * 10) / 10;
}

/**
 * Three decimals, for the one value a drag may write off that step.
 *
 * Landing exactly on something and stepping in tenths are not always the same
 * wish: the radius a rest is aiming at is built out of other fields, and
 * nothing says their arithmetic comes out on a tenth. Rounding at all is only
 * to keep float noise out of a number a person will read in the form.
 */
function fine(v) {
  return Math.round(v * 1000) / 1000;
}

/**
 * Where a part sits after being dragged `dxPx, dyPx` from where it was.
 *
 * `scale` is the gauge's own, because an offset is multiplied by it before it
 * is drawn: a gauge at 0.5 moves half as far for the same number, so the
 * number has to change twice as much for the part to follow the pointer.
 *
 * @param {{x: number, y: number}} start the offsets the drag began at
 * @param {number} dxPx @param {number} dyPx
 * @param {number} pxPerUnit screen pixels per viewBox unit
 * @param {number} scale the gauge's `gauge_scale`
 */
export function offsetsFromDrag(start, dxPx, dyPx, pxPerUnit, scale) {
  const per = (pxPerUnit || 1) * (scale || 1);
  return {
    x: clamp(tenth(start.x + dxPx / per), -OFFSET_LIMIT, OFFSET_LIMIT),
    y: clamp(tenth(start.y + dyPx / per), -OFFSET_LIMIT, OFFSET_LIMIT),
  };
}

/**
 * The font size a part has after its frame is dragged `dPx` taller.
 *
 * A single line of text is as tall as its font size, so the frame's height is
 * the size - which is what makes the corner handle read as a size and not as
 * a second, secret offset.
 *
 * @param {number} startSize @param {number} dPx
 * @param {number} pxPerUnit @param {number} scale
 */
export function fontFromResize(startSize, dPx, pxPerUnit, scale) {
  const per = (pxPerUnit || 1) * (scale || 1);
  return clamp(tenth(startSize + dPx / per), FONT_MIN, FONT_MAX);
}

/**
 * The frame for a part, in viewBox units, from where it is and how big it is.
 *
 * Only a fallback: the editor measures the text it can see. A gauge drawn
 * with no live preview has no text to measure, and a frame the width of the
 * number of characters is better than no frame at all.
 *
 * @param {{x: number, y: number, size: number, chars: number}} part
 * @param {number} scale
 */
export function estimateRect(part, scale) {
  const s = (part.size || 0) * (scale || 1);
  // 0.6em is the width of a digit in the sans-serif faces Home Assistant
  // ships; a label of letters is near enough for a box nobody measures by.
  const w = Math.max(s * 0.6 * Math.max(part.chars || 1, 1), s * 0.6);
  return {
    x: GAUGE_CENTER + (part.x || 0) * (scale || 1) - w / 2,
    y: GAUGE_CENTER + (part.y || 0) * (scale || 1) - s / 2,
    w, h: s,
  };
}

/**
 * The ring the gauge is drawn on, in viewBox units.
 *
 * Half the stroke, because the ring is stroked about this radius rather than
 * inside it, and one unit of air so a thick ring does not touch the edge of
 * the box. The whole thing scales, so a gauge at 0.5 draws a ring half as far
 * from the centre.
 *
 * @param {number} stroke the gauge's `stroke_width`
 * @param {number} scale the gauge's `gauge_scale`
 */
export function ringRadius(stroke, scale) {
  return (GAUGE_CENTER - (stroke || 0) / 2 - 1) * (scale || 1);
}

/**
 * Where one of the parts that stand on that ring is drawn.
 *
 * Ticks, sub-ticks and tick labels are each an offset from the ring, and each
 * offset is scaled the same way the ring is. Negative is inward, which is
 * where a label usually goes.
 *
 * @param {number} ring @param {number} offset @param {number} scale
 */
export function ringPartRadius(ring, offset, scale) {
  return ring + (offset || 0) * (scale || 1);
}

/**
 * The offset that would put a part at this radius - `ringPartRadius` read
 * backwards, which is what dragging a ring frame has to do.
 *
 * Clamped to what the editor's own sliders allow, so a drag cannot write a
 * number the form would refuse, and rounded to the tenth they step in.
 *
 * @param {number} ring @param {number} radius @param {number} scale
 * @param {number} [limit] the furthest the field may go, either way
 */
export function offsetFromRadius(ring, radius, scale, limit = OFFSET_LIMIT) {
  return clamp(tenth((radius - ring) / (scale || 1)), -limit, limit);
}

/** What the pointer's own two sliders allow, which a drag may not step past. */
export const POINTER_LENGTH_MAX = 50;
export const POINTER_OFFSET_LIMIT = 10;

/**
 * How near the pivot the needle's tail may be let go and still be put exactly
 * on it, in the gauge's own units.
 *
 * A needle that begins at the centre and one that begins a hair off it are
 * different drawings, and only one of them is what anybody meant. The centre
 * is the one radius on that line worth landing on exactly, and it is the one
 * a hand cannot hit: it is behind the hub, where the tail is hidden by the
 * very thing it is being lined up with.
 *
 * A few pixels at any ordinary size, and no more. The rest is there to catch
 * a hand that is already on the pivot, not to pull one towards it: at a
 * reach wide enough to feel like help it takes the last of the travel away,
 * and the tail stops answering the hand over the stretch where it matters
 * most. It also has to be pulled straight through - a tail dragged past the
 * pivot and out the far side is a dial people draw on purpose.
 */
export const NEEDLE_CENTRE_SNAP = 0.4;

/**
 * Where the needle's two ends stand, as radii from the pivot.
 *
 * The tip is the ring less the pointer's offset; the tail is a length back
 * along the same line, and that one is free to be negative - a needle longer
 * than its tip's radius has a tail out the other side of the pivot, which is
 * a dial people draw on purpose.
 *
 * @param {number} offset `pointer_offset` @param {number} length `pointer_length`
 * @param {number} ring @param {number} scale
 */
export function needleEnds(offset, length, ring, scale) {
  const tip = ring - (offset || 0) * (scale || 1);
  return { tip, tail: tip - (length || 0) * (scale || 1) };
}

/**
 * One end dragged to a radius, read back as the fields that would put it
 * there - `needleEnds` backwards, which is what a needle handle has to do.
 *
 * The radius is signed along the needle's own line, so an end dragged through
 * the pivot and out the far side keeps counting rather than folding back.
 * Each end moves only itself: the tail is a length against a tip that stays,
 * and the tip carries an offset while the tail stays, which is why the tip
 * writes both fields.
 *
 * The tail rests on the pivot, within `NEEDLE_CENTRE_SNAP` of it. The tip has
 * no such point: it is being lined up with a ring that is drawn, and where it
 * should sit is something you can see.
 *
 * @param {'tip' | 'tail'} end
 * @param {number} at the radius the end has been dragged to
 * @param {number} offset @param {number} length @param {number} ring @param {number} scale
 */
export function needleFromRadius(end, at, offset, length, ring, scale) {
  const s = scale || 1;
  const ends = needleEnds(offset, length, ring, s);
  if (end === 'tail') {
    // The pivot is the one place on this line worth landing on exactly, and
    // the tail is hidden behind the hub just as it gets there. Exactly is
    // meant literally, so this is the one drag that may write off the tenth
    // the slider steps in: the length that puts the tail on the pivot is the
    // ring's radius over the scale, and the ring is half a stroke in from the
    // edge - a stroke of 0.5 leaves it on a quarter, not a tenth. Rounding
    // to the nearest tenth there would land beside the very thing the rest is
    // for, by as much as the rest is wide.
    if (Math.abs(at) <= NEEDLE_CENTRE_SNAP) {
      return { pointer_length: clamp(fine(ends.tip / s), 0, POINTER_LENGTH_MAX) };
    }
    return { pointer_length: clamp(tenth((ends.tip - at) / s), 0, POINTER_LENGTH_MAX) };
  }
  const off = clamp(tenth((ring - at) / s), -POINTER_OFFSET_LIMIT, POINTER_OFFSET_LIMIT);
  return {
    pointer_offset: off,
    pointer_length: clamp(tenth((ring - off * s - ends.tail) / s), 0, POINTER_LENGTH_MAX),
  };
}

/**
 * The whole needle slid in or out, from a grab that began at `at0` and has
 * reached `at` - both signed radii along the needle's own line.
 *
 * Only the offset moves. The length is what the two end handles are for, and
 * a line taken hold of bodily is asking for the other thing: keep the needle
 * as long as it is and put it somewhere else on its own line. So the tail
 * follows the tip and nothing but where it sits changes.
 *
 * Relative rather than absolute, unlike the ends: a handle is a point and can
 * simply be dragged to where the pointer is, but a line is grabbed somewhere
 * along its length, and jumping its tip to the pointer would throw the needle
 * by however far from the tip it was taken hold of.
 *
 * The tip's radius is the ring less the offset, so a needle pulled outward -
 * a growing radius - is one whose offset falls.
 *
 * @param {number} at the radius the grab has reached
 * @param {number} at0 the radius it began at
 * @param {number} offset `pointer_offset` when the grab began
 * @param {number} scale the gauge's `gauge_scale`
 */
export function needleSlide(at, at0, offset, scale) {
  return {
    pointer_offset: clamp(tenth(offset - (at - at0) / (scale || 1)),
                          -POINTER_OFFSET_LIMIT, POINTER_OFFSET_LIMIT),
  };
}

/** The thickest the ring's own slider allows. */
export const STROKE_MAX = 5;

/**
 * The ring's inner edge, which is the edge of it that moves.
 *
 * A gauge's ring is centred on `ringRadius`, and that radius already carries
 * half the stroke: the outer edge therefore stands still at `(25 - 1) * scale`
 * however thick the ring is drawn, and all the thickness grows inward. So the
 * inner edge is the one thing a thickness can be dragged by.
 *
 * @param {number} stroke @param {number} scale
 */
export function ringInnerEdge(stroke, scale) {
  return (GAUGE_CENTER - 1 - (stroke || 0)) * (scale || 1);
}

/**
 * The thickness that would put that edge here - `ringInnerEdge` backwards.
 *
 * @param {number} radius @param {number} scale
 */
export function strokeFromRadius(radius, scale) {
  return clamp(tenth(GAUGE_CENTER - 1 - radius / (scale || 1)), 0, STROKE_MAX);
}
