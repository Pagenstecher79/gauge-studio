/**
 * Bending the sides of a box.
 *
 * A surface is a rectangle, and a rectangle is a poor shape for a great many
 * of the things people paint one for. Bending gives each of its four sides a
 * bow: outward into a barrel, inward into a waist, each side on its own.
 *
 * The shape is a `clip-path: polygon()` rather than an SVG path, and that is
 * the whole reason this file is short. A polygon's points may be given as per
 * cents, which CSS reads per axis against the box it is clipping - so one
 * string describes the shape at every size the box is ever drawn at, needs no
 * element in the document to point at, and costs nothing to recompute when
 * the canvas is rescaled. Curves cost points instead, and points are cheap.
 *
 * A bend is in per cent of the box across the side it bows: the top and
 * bottom of its height, the left and right of its width - the same per-axis
 * reading the polygon itself gets, so a bend of 20 on the top is a bow of a
 * fifth of the box's height whatever shape the box is.
 *
 * Everything here is pure, and the numbers are the reason - see the tests.
 */

/**
 * The four sides, each with the corner it runs from, the corner it runs to,
 * and which way "outward" is.
 *
 * Corners are in box fractions, so a side is read the same way whichever of
 * the two axes it happens to lie along.
 */
export const BEND_SIDES = Object.freeze({
  top: Object.freeze({ from: [0, 0], to: [1, 0], axis: 'y', out: -1,
                       what: 'the top edge' }),
  right: Object.freeze({ from: [1, 0], to: [1, 1], axis: 'x', out: 1,
                         what: 'the right-hand edge' }),
  bottom: Object.freeze({ from: [1, 1], to: [0, 1], axis: 'y', out: 1,
                          what: 'the bottom edge' }),
  left: Object.freeze({ from: [0, 1], to: [0, 0], axis: 'x', out: -1,
                        what: 'the left-hand edge' }),
});

/** The config key a side's bend is kept under. */
export const bendKey = (side) => 'bend_' + side;

/** How far a side may bow, either way, in per cent of the box across it. */
export const MAX_BEND = 45;

/**
 * How much room the paint needs outside the box, in per cent of it, per side.
 *
 * Always the same number, and always the full one: a clip path can only ever
 * take paint away, so a side that bows outward has to have something out
 * there to keep. The polygon hands every bit of it straight back, so growing
 * the layer is free - what it costs is that the box has to stop clipping it,
 * which is `bendEscapes` below.
 */
export const BEND_ROOM = MAX_BEND;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Normalised away from -0, because a bend of nothing that came through a
// side pointing the other way is still a bend of nothing, and a test that
// says so should not have to know which side it asked about.
const tenth = (v) => (Math.round(v * 10) / 10) || 0;

/** How far each side of `cfg` is bowed, as a plain record of four numbers. */
export function bendsOf(cfg) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const side of Object.keys(BEND_SIDES)) {
    const v = Number(cfg?.[bendKey(side)]);
    out[side] = Number.isFinite(v) ? clamp(v, -MAX_BEND, MAX_BEND) : 0;
  }
  return out;
}

/** Whether anything is bent at all - a flat box wants no clip path. */
export const isBent = (bends) => Object.values(bends).some((v) => v !== 0);

/** Whether any side bows outward, which is when the box has to let it. */
export const bendEscapes = (bends) => Object.values(bends).some((v) => v > 0);

/**
 * How many points a side is drawn with.
 *
 * Eight segments put the worst error on a full bend under a third of a per
 * cent of the box, which no one can see, and the whole shape still comes to
 * 32 points - a string of about 400 characters that the compositor clips
 * with once.
 */
const STEPS = 8;

/**
 * A point on a bent side, in box fractions.
 *
 * The bow is a parabola: nothing at either corner, and the full bend at the
 * middle. The corners are left where they are on purpose - they are shared
 * with the neighbouring side, and a corner that moved would tear the outline
 * apart wherever two bends disagreed.
 */
function onSide(side, bend, t) {
  const s = BEND_SIDES[side];
  const [fx, fy] = s.from;
  const [tx, ty] = s.to;
  const bow = (bend / 100) * s.out * 4 * t * (1 - t);
  const x = fx + (tx - fx) * t + (s.axis === 'x' ? bow : 0);
  const y = fy + (ty - fy) * t + (s.axis === 'y' ? bow : 0);
  return [x, y];
}

/**
 * The outline of a bent box as a `clip-path` value, or null when it is flat.
 *
 * `room` is the per cent the paint layer has been grown by on every side, so
 * the per cents come out in the *layer's* terms rather than the box's: a
 * point at the box's own left edge is `room` of the way into a layer that is
 * `100 + 2 * room` per cent wide.
 */
export function bendClipPath(bends, room = BEND_ROOM) {
  if (!isBent(bends)) return null;
  const span = 100 + 2 * room;
  const at = (f) => tenth((room + f * 100) / span * 100);
  const pts = [];
  for (const side of Object.keys(BEND_SIDES)) {
    // Each side stops one step short of its end: that point is the next
    // side's first, and a polygon that names a corner twice is a polygon a
    // browser has to think about.
    for (let i = 0; i < STEPS; i++) {
      const [x, y] = onSide(side, bends[side], i / STEPS);
      pts.push(at(x) + '% ' + at(y) + '%');
    }
  }
  return 'polygon(' + pts.join(', ') + ')';
}

/**
 * Where a side's grip stands, in per cent of the box.
 *
 * On the middle of the side it sets, bow and all, so the grip is always on
 * the thing it moves - the same rule the corner grips follow.
 */
export function bendGripHome(bend, side) {
  const on = BEND_SIDES[side] ? side : 'top';
  const [x, y] = onSide(on, clamp(bend || 0, -MAX_BEND, MAX_BEND), 0.5);
  return { l: tenth(x * 100), t: tenth(y * 100) };
}

/**
 * The bend a grip dragged to `at` is asking for, in per cent of the box.
 *
 * The parabola is at its full bend in the middle, which is where the grip
 * is, so this is the plain distance from the side - no factor, and the exact
 * inverse of `bendGripHome`.
 */
export function bendFromGrip(at, box, side) {
  const s = BEND_SIDES[side];
  if (!s || !box?.width || !box?.height) return 0;
  const across = s.axis === 'x' ? box.width : box.height;
  const edge = s.axis === 'x'
    ? (s.out > 0 ? box.left + box.width : box.left)
    : (s.out > 0 ? box.top + box.height : box.top);
  const from = (s.axis === 'x' ? at.x : at.y) - edge;
  return tenth(clamp(from * s.out / across * 100, -MAX_BEND, MAX_BEND));
}
