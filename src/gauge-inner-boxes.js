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
 * @param {number} scale
 * @param {number|{x: number, y: number}} [limit] how far a part may travel,
 *   in its own unit
 * @param {number} scale the gauge's `gauge_scale`
 */
export function offsetsFromDrag(start, dxPx, dyPx, pxPerUnit, scale, limit = OFFSET_LIMIT) {
  const per = (pxPerUnit || 1) * (scale || 1);
  // One number, or one per axis. A gauge's parts travel in viewBox units and
  // the same 25 bounds both; a bar's travel in whatever unit that bar
  // measures in, where the sensible bound is the box itself - and a box is
  // rarely as tall as it is wide.
  const lx = typeof limit === 'number' ? limit : limit.x;
  const ly = typeof limit === 'number' ? limit : limit.y;
  return {
    x: clamp(tenth(start.x + dxPx / per), -lx, lx),
    y: clamp(tenth(start.y + dyPx / per), -ly, ly),
  };
}

/**
 * How near the middle axis a part has to come before the axis takes it.
 *
 * In screen pixels rather than in viewBox units, so the pull feels the same
 * on a gauge drawn at 80 pixels and one drawn at 500: a unit is worth ten
 * times as much on the second, and a tolerance in units would be a grab of
 * half the dial there and nothing at all on the first.
 */
export const CENTRE_PULL_PX = 7;

/**
 * An offset, taken by the middle axis where it comes near enough to it.
 *
 * A gauge's parts are offset from the centre of its viewBox, so the axis a
 * label is centred on is simply `x = 0` - there is no line to look up and no
 * arithmetic to do. What the guide adds is the pull: landing exactly on zero
 * by hand means reading a number while dragging a text, and a tenth either
 * way is visible on a big gauge.
 *
 * Off by default, and not because it is expensive: a part deliberately set a
 * hair off the axis - a value nudged left to make room for a unit - would be
 * pulled back onto it by an editor that always snapped, and there would be no
 * way to say no.
 *
 * @param {number} x the offset the drag arrived at, in viewBox units
 * @param {number} per screen pixels one of those units is worth
 * @param {boolean} [on] whether the guide is switched on
 * @param {number} [pull] how near, in screen pixels
 * @returns {number}
 */
export function snapToCentre(x, per, on = true, pull = CENTRE_PULL_PX) {
  if (!on) return x;
  return Math.abs(x) * (Math.abs(per) || 1) <= pull ? 0 : x;
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
 * @param {number} [min] @param {number} [max] the range this part's type is
 *   set in - a gauge's is viewBox units, a bar's its own base unit
 */
export function fontFromResize(startSize, dPx, pxPerUnit, scale,
                               min = FONT_MIN, max = FONT_MAX) {
  const per = (pxPerUnit || 1) * (scale || 1);
  return clamp(tenth(startSize + dPx / per), min, max);
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
 * How far out the gauge reaches, in viewBox units.
 *
 * This is what `gauge_scale` means: the radius of the outermost thing the
 * gauge draws, so a gauge at 1 fills its box and a gauge at 0.5 takes up half
 * of it. Everything the gauge is made of is subtracted from here inwards.
 *
 * It used to mean the radius of the value ring alone, with the gap and the
 * frame ring added on *top* - so a gauge grew out of its own measure, and a
 * frame 5 units wide reached to 27.6 in a box that ends at 25. There was a
 * unit of air to stop a thick ring touching the edge, which is the thing this
 * reading makes impossible rather than merely unlikely.
 *
 * @param {number} scale the gauge's `gauge_scale`
 */
export function gaugeOuter(scale) {
  return GAUGE_CENTER * (scale ?? 1);
}

/**
 * What the frame ring takes off the outside, at this scale.
 *
 * Its own width and the air it leaves between itself and the value ring. A
 * frame that is switched off takes nothing, which is why a gauge grows when
 * it is switched off and shrinks when it is switched on - the box it has to
 * live in did not change.
 *
 * @param {{frame_ring_active?: boolean, frame_ring_width?: number|string,
 *          frame_ring_gap?: number|string}} cfg @param {number} scale
 */
export function frameBand(cfg, scale) {
  if (!cfg || cfg.frame_ring_active !== true) return 0;
  const w = Number.isFinite(Number(cfg.frame_ring_width)) ? Number(cfg.frame_ring_width) : 1.5;
  const g = Number.isFinite(Number(cfg.frame_ring_gap)) ? Number(cfg.frame_ring_gap) : 1.5;
  return (w + g) * (scale ?? 1);
}

/**
 * The ring the gauge is drawn on, in viewBox units.
 *
 * Half the stroke, because the ring is stroked about this radius rather than
 * inside it, and whatever the frame ring has taken off the outside.
 *
 * @param {number} stroke the gauge's `stroke_width`
 * @param {number} scale the gauge's `gauge_scale`
 * @param {number} [band] what `frameBand` answered for this gauge
 */
export function ringRadius(stroke, scale, band = 0) {
  return gaugeOuter(scale) - (band || 0) - (stroke || 0) / 2;
}

/**
 * The scale a card written against the old reading has to be given to keep
 * the picture it has, or `null` where it is already written against this one.
 *
 * What is reproduced exactly is the outermost radius, so a gauge keeps the
 * room it took. Its value ring can still move by a fraction of a per cent,
 * because the frame ring is scaled by this new number and was scaled by the
 * old one - and a gauge that was reaching outside its box is clamped to the
 * edge, which is the whole point of the change and the one case where the
 * picture is meant to move.
 *
 * @param {any} cfg
 */
export function migrateGaugeScale(cfg) {
  if (!cfg || cfg.scale_from_outer === true) return null;
  const scale = Number.isFinite(Number(cfg.gauge_scale)) ? Number(cfg.gauge_scale) : 0.9;
  const stroke = Number.isFinite(Number(cfg.stroke_width)) ? Number(cfg.stroke_width) : 3;
  // The reading this replaces, written out: the value ring, then the gap and
  // the frame stacked on the outside of it.
  const wasRing = (GAUGE_CENTER - stroke / 2 - 1) * scale;
  // What the card drew is the value ring, so that is what the translation
  // keeps. Solving `ringRadius` for the new number rather than just dividing
  // the old outer reach by 25 is not pedantry: the frame band is scaled too,
  // so a larger scale widens the band, which would push the ring back in.
  const band = frameBand(cfg, 1);
  const reach = GAUGE_CENTER - band;
  if (!(reach > 0)) return 1;
  return Math.min(1, Math.max(0, (wasRing + stroke / 2) / reach));
}

/**
 * The scale to draw this gauge at, whichever reading its card was written
 * against. One read path, so the renderer and the editor cannot disagree.
 *
 * @param {any} cfg
 */
export function gaugeScaleOf(cfg) {
  const migrated = migrateGaugeScale(cfg);
  if (migrated !== null) return migrated;
  return Number.isFinite(Number(cfg?.gauge_scale)) ? Number(cfg.gauge_scale) : 0.9;
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
 * Where the ring's outer edge stands is not the ring's business: it is the
 * gauge's reach less whatever the frame ring has taken off the outside, and
 * it stays there however thick the ring is drawn. All the thickness grows
 * inward, so the inner edge is the one thing a thickness can be dragged by.
 *
 * @param {number} stroke @param {number} scale @param {number} [band]
 */
/**
 * What the frame ring's own two edges are, and the fields that would put an
 * edge where the hand let go of it.
 *
 * The frame ring is the one band on a gauge with a thickness worth grabbing:
 * every other ring is a circle at a radius, so one handle says all there is
 * to say about it. This one has an outside, which is the gauge's outermost
 * reach and therefore its size, and an inside, which is how wide the frame
 * itself is drawn. Two edges, two numbers, and neither of them is the other.
 *
 * A gauge with no frame ring still has the outer edge - it is `scale * 25`
 * whether anything is drawn on it or not - which is what lets the editor
 * offer a ring that is not there.
 */
export const FRAME_WIDTH_MAX = 8;
export const GAUGE_SCALE_MIN = 0.2;

/** @param {any} cfg @param {number} scale */
export function frameInnerEdge(cfg, scale) {
  const w = cfg?.frame_ring_active === true
    ? (Number.isFinite(Number(cfg.frame_ring_width)) ? Number(cfg.frame_ring_width) : 1.5) : 0;
  return gaugeOuter(scale) - w * (scale ?? 1);
}

/**
 * The outer edge dragged to `radius`, as a scale.
 *
 * `scale_from_outer` rides along because a drag is an edit, and an edit is
 * the moment an old card stops being read the old way: the number written
 * here is the new reading, and saying so in the same patch is what keeps the
 * two from being mixed.
 *
 * @param {number} radius
 */
export function scaleFromRadius(radius) {
  return { gauge_scale: Math.round(clamp(radius / GAUGE_CENTER, GAUGE_SCALE_MIN, 1) * 100) / 100,
           scale_from_outer: true };
}

/**
 * The inner edge dragged to `radius`, as a frame width.
 *
 * Divided by the scale, because the width is drawn multiplied by it: on a
 * gauge at 0.5 the hand travels half as far as the number it is setting.
 *
 * @param {number} radius @param {number} scale
 */
export function frameWidthFromRadius(radius, scale) {
  const s = scale || 1;
  return { frame_ring_width: clamp(tenth((gaugeOuter(s) - radius) / s), 0, FRAME_WIDTH_MAX) };
}

export function ringInnerEdge(stroke, scale, band = 0) {
  return gaugeOuter(scale) - (band || 0) - (stroke || 0);
}

/**
 * The thickness that would put that edge here - `ringInnerEdge` backwards.
 *
 * @param {number} radius @param {number} scale @param {number} [band]
 */
export function strokeFromRadius(radius, scale, band = 0) {
  return clamp(tenth(gaugeOuter(scale) - (band || 0) - radius), 0, STROKE_MAX);
}

/**
 * Which axis an edge is about, and how a box is measured along it.
 *
 * The six edges are the ones the canvas already lines elements up by, and a
 * part is lined up by the same words: it is the same thing asked of something
 * smaller.
 */
const EDGE_AXIS = Object.freeze({
  left:   { axis: 'x', pos: 'l', size: 'w', at: 'near' },
  right:  { axis: 'x', pos: 'l', size: 'w', at: 'far' },
  top:    { axis: 'y', pos: 't', size: 'h', at: 'near' },
  bottom: { axis: 'y', pos: 't', size: 'h', at: 'far' },
});

/**
 * Line several of a gauge's texts up on one edge.
 *
 * Measured rather than worked out. A part's offset says where its *anchor*
 * goes - the middle of the text for one, the baseline for the next - so two
 * parts sharing an offset do not share an edge, and the edge is the thing
 * being lined up. The boxes come in as they were measured off the drawing, in
 * screen pixels; what goes back is each part's own offset field, moved by as
 * far as its box has to travel.
 *
 * Because it is a travel rather than a position, the anchor each part uses
 * cancels out and a baseline needs no special case.
 *
 * The outermost part stays where it is - it is what defines the edge - and a
 * part whose offset does not actually change is left out of the patch, so a
 * second press on the same button writes nothing.
 *
 * @param {{keys: {x: string, y: string}, box: {l: number, t: number, w: number, h: number},
 *          from: {x: number, y: number}, per: number}[]} items
 * @param {'left'|'right'|'top'|'bottom'} edge
 * @returns {Record<string, number> | null}
 */
export function alignParts(items, edge) {
  const how = EDGE_AXIS[edge];
  const movers = (items || []).filter(i => i && i.box && i.per);
  if (!how || movers.length < 2) return null;
  const { axis, pos, size } = how;
  const at = how.at === 'near'
    ? Math.min(...movers.map(i => i.box[pos]))
    : Math.max(...movers.map(i => i.box[pos] + i.box[size]));
  /** @type {Record<string, number>} */
  const patch = {};
  for (const i of movers) {
    const want = how.at === 'near' ? at : at - i.box[size];
    const to = clamp(tenth(i.from[axis] + (want - i.box[pos]) / i.per),
                     -OFFSET_LIMIT, OFFSET_LIMIT);
    if (to !== i.from[axis]) patch[i.keys[axis]] = to;
  }
  return Object.keys(patch).length ? patch : null;
}
