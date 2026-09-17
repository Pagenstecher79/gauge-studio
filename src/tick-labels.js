/**
 * Deciding which ticks get a label, and on which row.
 *
 * A gauge's tick labels used to be placed and then rescued: every tick got
 * one, and a hand-tuned `tick_label_spread` shoved the crowded ones sideways
 * near the top. That number is a constant for a geometry made of four things
 * that move independently - the tick count, the font size, how many digits
 * the range produces, and the size of the card - so it was right for exactly
 * one of them and wrong for the rest. On the demo's largest gauge it was
 * fighting a crowd that was not there and pushed 1300 to within a pixel of
 * 1100 to do it.
 *
 * What actually reads as crowded is not the arc between two labels but the
 * gap between the two boxes of type. Near the top of a dial two labels stand
 * side by side, so only their horizontal distance counts and a 26 degree arc
 * leaves a fifth of what the same arc leaves at the side, where they stand
 * one above the other. So the rule here is about boxes, and the arc is only
 * how the boxes are placed.
 *
 * Everything is in viewBox units, and a label's box is estimated rather than
 * measured: this runs while the SVG is being written, before there is
 * anything to measure. `EM_WIDTH` is the width of a digit in the sans-serif
 * faces Home Assistant ships, which is what these labels are made of.
 */

/** The width of one digit, in ems. */
export const EM_WIDTH = 0.6;

/**
 * The clear air two label boxes want between them, in ems.
 *
 * Calibrated against the demo's largest gauge, where a person had already
 * thinned the labels by hand: every tick leaves its worst pair overlapping by
 * 0.74 em, every second tick leaves 0.23 em, every third 1.29 em - and the
 * hand-picked answer was every second. Anything between those two numbers
 * reproduces that judgement; this sits in the middle of the range with room
 * on both sides.
 */
export const MIN_GAP = 0.2;

/**
 * A line of digits is taller than its font size - measured at 1.18 on the
 * demo's largest gauge, where a 2.375 unit font drew a 2.8 unit box.
 */
export const LINE_HEIGHT = 1.15;

/** How far the second row sits from the first, in ems. */
export const ROW_GAP = 1.15;

/** @param {number} deg */
const rad = (deg) => (deg * Math.PI) / 180;

/**
 * The box a label of this text would take, centred on its point.
 *
 * @param {string} text @param {number} fontSize
 */
export function labelBox(text, fontSize) {
  return {
    w: Math.max(String(text).length, 1) * EM_WIDTH * fontSize,
    h: fontSize * LINE_HEIGHT,
  };
}

/**
 * The box of the widest label in a row.
 *
 * A row of numbers is placed against one circle, so it has to be pushed off
 * that circle by one reach - the widest one. Reaching by its own width
 * instead is what made a dial read as out of round: 9 and 10 sit a degree
 * apart at the side of a face, where the width governs, so the two-digit
 * one went half a digit further in than its neighbour and the row stepped.
 * Flush edges are worth having where the labels are of one length and cost
 * more than they are worth the moment they are not.
 *
 * @param {string[]} texts @param {number} fontSize
 */
export function rowBox(texts, fontSize) {
  let widest = 1;
  for (const t of texts || []) widest = Math.max(widest, String(t ?? '').length);
  return { w: widest * EM_WIDTH * fontSize, h: fontSize * LINE_HEIGHT };
}

/**
 * How far a label's centre stands from the point its box just touches.
 *
 * A label is placed against a circle, and what should lie on that circle is
 * the edge of its box, not its middle - otherwise a long number reaches
 * further in towards the ticks than a short one at the same radius. So the
 * centre is pushed off the circle by the distance from the centre of an
 * axis-aligned box to its own boundary in the radial direction, which is the
 * nearer of the two half-extents once each is divided by how much of that
 * direction it has to cover.
 *
 * This is continuous in the angle, which is the whole point. The placement
 * it replaces switched `text-anchor` and `dominant-baseline` at fixed
 * thresholds, so a label's box jumped a half-width sideways or a half-height
 * downwards the moment its tick crossed one - a kink in a row of numbers
 * that are otherwise on a perfect arc, and the reason the top of a dial read
 * as out of round.
 *
 * @param {{w: number, h: number}} box @param {number} cos @param {number} sin
 */
export function boxReach(box, cos, sin) {
  const ax = Math.abs(cos), ay = Math.abs(sin);
  const tx = ax > 1e-6 ? box.w / 2 / ax : Infinity;
  const ty = ay > 1e-6 ? box.h / 2 / ay : Infinity;
  return Math.min(tx, ty);
}

/**
 * Whether two placed labels leave each other enough air.
 *
 * Two boxes clear each other as soon as they are apart on either axis, which
 * is what makes the side of a dial roomy and the top of one tight: the same
 * arc buys a lot of vertical distance there and very little horizontal.
 */
function clears(a, b, gap) {
  const dx = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
  const dy = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
  return dx >= gap || dy >= gap;
}

/**
 * Place the labels a step would produce, as boxes in viewBox units.
 *
 * `closed` is a dial that comes full circle: its last tick stands on its
 * first, so the renderer draws only one of them and a plan that placed both
 * would be measuring a label that is not there. `reachTexts` is for the one
 * label that is two - the seam of such a dial, where both readings may be
 * asked for in one box. That box is far wider than any other, and the reach
 * is shared by the whole row, so letting it govern would push every label at
 * the sides of the dial out by the width of a number that is only at the
 * top. It crowds its neighbours with its own width all the same.
 *
 * @param {{count: number, startAngle: number, totalAngle: number,
 *          radius: number, fontSize: number, texts: string[],
 *          outward?: boolean, rows?: number[], closed?: boolean,
 *          reachTexts?: string[]}} spec
 */
function place(spec, step) {
  const { count, startAngle, totalAngle, radius, fontSize, texts } = spec;
  const out = spec.outward;
  const div = count > 1 ? count - 1 : 1;
  const boxes = [];
  const drawn = (/** @type {number} */ i) =>
    i % step === 0 && !(spec.closed && i === count - 1);
  // One reach for the whole row, so the numbers share a circle; each label
  // still crowds its neighbour with its own width.
  const reachBox = rowBox((spec.reachTexts || texts).filter((_, i) => drawn(i)), fontSize);
  for (let i = 0; i < count; i += step) {
    if (!drawn(i)) continue;
    const ang = rad(startAngle + (i / div) * totalAngle);
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const row = spec.rows ? spec.rows[i] || 0 : 0;
    const r = radius + row * (out ? 1 : -1) * ROW_GAP * fontSize;
    const box = labelBox(texts[i] ?? '', fontSize);
    // The same placement the renderer uses: the box stands clear of the label
    // circle by its own reach, so a plan reads the sides of a dial as roomy
    // and the top as tight, which is what they are.
    const rc = r + (out ? 1 : -1) * boxReach(reachBox, cos, sin);
    boxes.push({ i, row, x: rc * cos, y: rc * sin, w: box.w, h: box.h });
  }
  return boxes;
}

/**
 * The smallest interval at which no two labels crowd each other.
 *
 * Walks up from every tick to every tenth; a gauge whose labels will not fit
 * at any interval keeps the last one tried rather than losing its scale
 * altogether.
 *
 * @param {{count: number, startAngle: number, totalAngle: number,
 *          radius: number, fontSize: number, texts: string[],
 *          outward?: boolean, closed?: boolean, reachTexts?: string[]}} spec
 */
export function autoStep(spec) {
  if (!spec.count || spec.count < 2 || !spec.fontSize) return 1;
  const gap = MIN_GAP * spec.fontSize;
  for (let step = 1; step <= Math.max(1, Math.ceil(spec.count / 2)); step++) {
    const placed = place(spec, step);
    let ok = true;
    for (let k = 1; k < placed.length && ok; k++) {
      if (!clears(placed[k - 1], placed[k], gap)) ok = false;
    }
    // A dial that comes full circle brings the row round to where it began,
    // so the first and last of what was placed are neighbours too - and on a
    // closed dial that is the only check there is on that pair, because the
    // walk above never reaches round the seam.
    if (ok && placed.length > 2 && Math.abs(spec.totalAngle) >= 360
        && !clears(placed[0], placed[placed.length - 1], gap)) ok = false;
    if (ok) return step;
  }
  return Math.max(1, Math.ceil(spec.count / 2));
}

/**
 * Which row each label stands on, when the gauge would rather keep every
 * label than drop any.
 *
 * A crowded neighbour steps out one row instead of being shoved sideways,
 * which is the one thing that keeps a label over the tick it belongs to. Only
 * where it is needed: a dial with room stays on one row.
 *
 * @param {{count: number, startAngle: number, totalAngle: number,
 *          radius: number, fontSize: number, texts: string[],
 *          outward?: boolean, closed?: boolean, reachTexts?: string[]}} spec
 */
export function staggerRows(spec, step) {
  /** @type {number[]} */
  const rows = [];
  if (!spec.count) return rows;
  const gap = MIN_GAP * spec.fontSize;
  let placed = place({ ...spec, rows }, step || 1);
  for (let k = 1; k < placed.length; k++) {
    if (clears(placed[k - 1], placed[k], gap)) continue;
    // One row out, and only one: a third row would stand further from its own
    // tick than from the next tick along, which is worse than being close.
    rows[placed[k].i] = placed[k - 1].row === 1 ? 0 : 1;
    placed = place({ ...spec, rows }, step || 1);
  }
  return rows;
}
