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

/**
 * The config key for where along the side the bow's crest stands.
 *
 * A bow with its crest in the middle is a barrel; one with its crest near a
 * corner is a wave, a fin, a leaf - shapes people draw a surface for and
 * could not ask this card for while the only thing a side could say was how
 * deep it went. Per cent along the side, in the direction the side runs.
 */
export const bendAtKey = (side) => 'bend_' + side + '_at';

/** The crest in the middle, which is where a side that has never been dragged along keeps it. */
export const BEND_AT_MID = 50;

/**
 * How near a corner the crest may be pushed, in per cent along the side.
 *
 * The corners are pinned, so a crest on top of one is a bow of nothing: past
 * this the shape stops changing and only the grip keeps moving, which reads
 * as a control that has broken.
 */
export const BEND_AT_EDGE = 10;

/** How far a side may bow, either way, in per cent of the box across it. */
export const MAX_BEND = 45;

/**
 * How near flat a side may be let go and still be put exactly flat, in
 * pixels on the screen the grip is being dragged across.
 *
 * A side that is straight and one that is bowed by a third of a per cent are
 * different drawings, and only one of them is what anybody meant - but flat
 * is the one value on this range that has to be hit exactly, and a grip
 * sitting on the side it is setting gives no way of telling you are on it.
 *
 * In pixels rather than in per cent of the box, because a hand is in pixels:
 * read as a per cent, the same rule gave a four-hundred-wide surface a
 * six-pixel window on its two sides and a two-pixel one on its top, so the
 * one box snapped differently depending on which of its edges you took hold
 * of, and the wide sides lost the first of their travel.
 *
 * Two pixels is the reach the needle's tail is given at the pivot, and it is
 * there for the same reason: to catch a hand that is already flat, not to
 * pull one towards it.
 */
export const BEND_FLAT_SNAP = 2;

/**
 * The most of the box that window may ever be, in per cent across the side.
 *
 * Only a box small enough for two pixels to be a real bow ever reaches this
 * - on anything of an ordinary size the pixels are the smaller of the two.
 */
export const BEND_FLAT_SNAP_MAX = 1.5;

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

/**
 * How each side of `cfg` is bowed: how deep, and where the crest of it is.
 *
 * @typedef {{ bow: number, at: number }} SideBend
 * @param {any} cfg
 * @returns {Record<string, SideBend>}
 */
export function bendsOf(cfg) {
  /** @type {Record<string, SideBend>} */
  const out = {};
  for (const side of Object.keys(BEND_SIDES)) {
    const v = Number(cfg?.[bendKey(side)]);
    const a = Number(cfg?.[bendAtKey(side)]);
    out[side] = {
      bow: Number.isFinite(v) ? clamp(v, -MAX_BEND, MAX_BEND) : 0,
      at: Number.isFinite(a) ? clamp(a, BEND_AT_EDGE, 100 - BEND_AT_EDGE) : BEND_AT_MID,
    };
  }
  return out;
}

/** A side read from either shape: the record, or the bare depth on its own. */
const sideOf = (b) => (typeof b === 'number'
  ? { bow: clamp(b || 0, -MAX_BEND, MAX_BEND), at: BEND_AT_MID }
  : { bow: b?.bow || 0, at: clamp(b?.at ?? BEND_AT_MID, BEND_AT_EDGE, 100 - BEND_AT_EDGE) });

/** Whether anything is bent at all - a flat box wants no clip path. */
export const isBent = (bends) => Object.values(bends).some((b) => sideOf(b).bow !== 0);

/** Whether any side bows outward, which is when the box has to let it. */
export const bendEscapes = (bends) => Object.values(bends).some((b) => sideOf(b).bow > 0);

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
 * The power that pulls the crest of the parabola to `at`.
 *
 * The bow is the same parabola it always was, read through `u = t ** k`
 * rather than through `t` itself. `k` is chosen so that `u` is a half where
 * `t` is `at`, which is where the parabola is at its peak - so the crest
 * lands exactly on the grip, the two corners stay at nothing because `u` is
 * still 0 and 1 there, and a crest in the middle gives `k = 1` and the plain
 * parabola back, unchanged to the last digit.
 *
 * A warp rather than two half-curves joined at the crest, because two halves
 * meet at an angle and the eye finds the join immediately.
 */
function crestWarp(at) {
  const a = clamp((at ?? BEND_AT_MID) / 100, BEND_AT_EDGE / 100, 1 - BEND_AT_EDGE / 100);
  return a === 0.5 ? 1 : Math.log(0.5) / Math.log(a);
}

/**
 * A point on a bent side, in box fractions.
 *
 * Nothing at either corner and the full bend at the crest. The corners are
 * left where they are on purpose - they are shared with the neighbouring
 * side, and a corner that moved would tear the outline apart wherever two
 * bends disagreed.
 */
function onSide(side, bend, t, at = BEND_AT_MID) {
  const s = BEND_SIDES[side];
  const [fx, fy] = s.from;
  const [tx, ty] = s.to;
  const u = t ** crestWarp(at);
  const bow = (bend / 100) * s.out * 4 * u * (1 - u);
  const x = fx + (tx - fx) * t + (s.axis === 'x' ? bow : 0);
  const y = fy + (ty - fy) * t + (s.axis === 'y' ? bow : 0);
  return [x, y];
}

/**
 * Where along a side to take its samples.
 *
 * Evenly along the side *and* evenly up and down the bow, merged: neither on
 * its own survives a crest pushed towards a corner. Even steps along the
 * side leave the steep short flank to two points; even steps up the bow
 * crowd them all into that flank and cut the long one off with a chord. With
 * the crest in the middle the two sets are the same eight numbers and the
 * shape is exactly what it was before a side could be dragged along at all.
 */
function sideSteps(at) {
  const k = crestWarp(at);
  const ts = new Set();
  for (let i = 0; i < STEPS; i++) {
    const u = i / STEPS;
    ts.add(u);
    ts.add(u ** (1 / k));
  }
  return [...ts].filter((t) => t < 1).sort((a, b) => a - b);
}

/**
 * The outline of a bent box as a `clip-path` value, or null when it is flat.
 *
 * `room` is the per cent the paint layer has been grown by on every side, so
 * the per cents come out in the *layer's* terms rather than the box's: a
 * point at the box's own left edge is `room` of the way into a layer that is
 * `100 + 2 * room` per cent wide.
 */
export function bendOutlinePoints(bends, room = BEND_ROOM) {
  if (!isBent(bends)) return null;
  const span = 100 + 2 * room;
  const at = (f) => tenth((room + f * 100) / span * 100);
  const pts = [];
  for (const side of Object.keys(BEND_SIDES)) {
    const b = sideOf(bends[side]);
    // Each side stops one step short of its end: that point is the next
    // side's first, and a polygon that names a corner twice is a polygon a
    // browser has to think about.
    for (const t of sideSteps(b.bow ? b.at : BEND_AT_MID)) {
      const [x, y] = onSide(side, b.bow, t, b.at);
      pts.push([at(x), at(y)]);
    }
  }
  return pts;
}

export function bendClipPath(bends, room = BEND_ROOM) {
  const pts = bendOutlinePoints(bends, room);
  return pts && 'polygon(' + pts.map(([x, y]) => x + '% ' + y + '%').join(', ') + ')';
}

/**
 * The same outline as an SVG `points` list, for drawing the edge rather than
 * cutting along it.
 *
 * A clip path has no stroke, so a bent surface kept a straight dashed
 * rectangle round it while its paint bowed out past it - and the rectangle is
 * what the eye reads as the edge. The polygon goes into an SVG laid over the
 * same grown layer the clip works in, with a `0 0 100 100` viewBox and no
 * aspect ratio to preserve, so the per cents above need no conversion.
 *
 * @param {Record<string, number>} bends @param {number} [room]
 * @returns {string | null}
 */
export function bendOutlineSvg(bends, room = BEND_ROOM) {
  const pts = bendOutlinePoints(bends, room);
  return pts && pts.map(([x, y]) => x + ',' + y).join(' ');
}

/**
 * How far past its own box a bent shape actually reaches, in box fractions
 * per side.
 *
 * Only a bow outward counts: a side pulled in takes paint away, and the box
 * is still the box. A bend is in per cent of the box across the side, so the
 * top and the bottom grow it by that much of its height and the two sides by
 * that much of its width - which is why this answers fractions of the box
 * rather than one number.
 *
 * @param {Record<string, number>} bends
 * @returns {{ left: number, top: number, right: number, bottom: number }}
 */
export function bendReach(bends) {
  const out = (/** @type {any} */ b) => Math.max(0, sideOf(b).bow) / 100;
  return { left: out(bends?.left), top: out(bends?.top),
           right: out(bends?.right), bottom: out(bends?.bottom) };
}

/**
 * A canvas box grown to everything the bends reach, in the canvas' own units.
 *
 * What the editor has to fit in the window when it zooms in on a bent
 * surface: the box alone leaves the bow hanging over the edge of the view,
 * which is exactly the part somebody zooming in on a bent surface is looking
 * at.
 *
 * @param {{x: number, y: number, w: number, h: number}} box
 * @param {Record<string, number>} bends
 */
export function bentBox(box, bends) {
  const r = bendReach(bends);
  const l = r.left * box.w, right = r.right * box.w;
  const t = r.top * box.h, b = r.bottom * box.h;
  return { x: box.x - l, y: box.y - t, w: box.w + l + right, h: box.h + t + b };
}

/**
 * Where a side's grip stands, in per cent of the box.
 *
 * On the crest of the side it sets, bow and all, so the grip is always on
 * the thing it moves - the same rule the corner grips follow. Which is also
 * why it is the one handle here that travels in both directions: across the
 * side it sets how deep the bow is, along it where the crest of that bow is.
 *
 * @param {any} bend the side's record, or its depth alone
 * @param {string} side
 */
export function bendGripHome(bend, side) {
  const on = BEND_SIDES[side] ? side : 'top';
  const b = sideOf(bend);
  const [x, y] = onSide(on, b.bow, b.at / 100, b.at);
  return { l: tenth(x * 100), t: tenth(y * 100) };
}

/**
 * The bend a grip dragged to `at` is asking for: how deep, and where.
 *
 * The parabola is at its full bend on the crest, which is where the grip is,
 * so the depth is the plain distance from the side - no factor, and the
 * exact inverse of `bendGripHome` outside the windows round flat and centre.
 * The position is where along the side the hand is, read in the direction
 * the side runs, so `at` means the same thing on all four.
 *
 * A side with no bow has no crest, so letting one go flat puts its position
 * back in the middle rather than leaving a number in the config that
 * describes nothing.
 *
 * @param {{x: number, y: number}} at
 * @param {{left: number, top: number, width: number, height: number}} box
 * @param {string} side
 * @returns {{ bow: number, at: number }}
 */
export function bendFromGrip(at, box, side) {
  const s = BEND_SIDES[side];
  if (!s || !box?.width || !box?.height) return { bow: 0, at: BEND_AT_MID };
  const snap = (/** @type {number} */ span) =>
    Math.min(BEND_FLAT_SNAP, span * BEND_FLAT_SNAP_MAX / 100);

  const across = s.axis === 'x' ? box.width : box.height;
  const edge = s.axis === 'x'
    ? (s.out > 0 ? box.left + box.width : box.left)
    : (s.out > 0 ? box.top + box.height : box.top);
  const from = (s.axis === 'x' ? at.x : at.y) - edge;
  const bow = Math.abs(from) <= snap(across)
    ? 0 : tenth(clamp(from * s.out / across * 100, -MAX_BEND, MAX_BEND));
  if (!bow) return { bow: 0, at: BEND_AT_MID };

  // The side runs along whichever axis the bow does not, and it runs from
  // its first corner to its second - which on the bottom and the left is
  // the way the box's own axis does not, so the fraction is turned round.
  const along = s.axis === 'x' ? 'y' : 'x';
  const i = along === 'x' ? 0 : 1;
  const span = along === 'x' ? box.width : box.height;
  const origin = along === 'x' ? box.left : box.top;
  const f = ((along === 'x' ? at.x : at.y) - origin) / span;
  const t = s.from[i] > s.to[i] ? 1 - f : f;
  const mid = Math.abs(t - 0.5) * span <= snap(span);
  return { bow, at: mid ? BEND_AT_MID
                        : tenth(clamp(t * 100, BEND_AT_EDGE, 100 - BEND_AT_EDGE)) };
}
