/**
 * What the dial's scale is, once the three switches that move it have spoken.
 *
 * Three settings change the numbers a gauge is drawn against, and they used to
 * be worked out inline, sharing one piece of state between two different
 * meanings of the word "tier". The arithmetic is here so it can be read and
 * tested on its own; the element keeps the state and passes it back in.
 *
 * - **Auto-range** picks the range: the value decides which decade of the
 *   user's own maximum the dial shows, so a figure that spends its day at 30
 *   is not read off a scale that runs to a million.
 * - **Dynamic max** lets the maximum follow a value that has gone past it,
 *   rather than pinning the needle at the end stop. It is the maximum only:
 *   where the scale starts is the user's.
 * - **Auto-scale** does not touch the range at all. It divides everything by
 *   a thousand as often as it has to and hands back the prefix - k, M, G -
 *   so the figures on the face stay short.
 *
 * Each of the first two has its own hysteresis, and each needs its own memory
 * of where it was: one counts steps up a ladder of ceilings, the other counts
 * powers of a thousand, and a number that means one of those means nothing at
 * all as the other.
 */

/** Neither tier has been decided yet. */
export const NO_TIER_STATE = Object.freeze({ range: null, scale: null });

const PREFIXES = Object.freeze(['', 'k', 'M', 'G', 'T', 'P']);

/**
 * The mantissas a round number is made of: 1, 2 or 5 times a power of ten.
 *
 * These are the numbers a scale can be divided into whole parts by, which is
 * the only property that matters here - a dial that ends on 5000 puts a tick
 * every 500 and labels them 0 to 10, where one that ends on 5500 labels the
 * same eleven ticks 0, 0.55, 1.1 and has to round two of them to the same
 * digit.
 */
const ROUND_STEPS = Object.freeze([1, 2, 5]);

/**
 * The next round number strictly above `t`.
 *
 * @param {number} t
 */
function nextRound(t) {
  const k = Math.floor(Math.log10(t) + 1e-12);
  const decade = Math.pow(10, k);
  for (const d of ROUND_STEPS) {
    const c = d * decade;
    if (c > t * (1 + 1e-9)) return c;
  }
  return decade * 10;
}

/**
 * What the tick labels should be divided by, so that they read short.
 *
 * The divisor is the largest power of ten the *step between two ticks* still
 * contains, which is what makes the labels whole: a step of 50M under a
 * divisor of 10M reads 0, 5, 10 - under the 100M that the range alone would
 * suggest it reads 0, 0.5, 1 and, at no decimals, 0, 1, 1.
 *
 * It used to be taken from a fifth of the range, which is the step of a
 * six-tick dial and of no other. On the common eleven-tick dial it was right
 * whenever the range was a plain power of ten and half a decade out whenever
 * it was not, so a dial ending on 500M labelled two ticks 1, two 2, two 3.
 *
 * @param {number} range @param {number} tickCount
 */
export function tickMultiplier(range, tickCount) {
  const div = tickCount > 1 ? tickCount - 1 : 1;
  const step = Math.abs(range) / div;
  if (!Number.isFinite(step) || step <= 0) return 1;
  return Math.pow(10, Math.floor(Math.log10(Math.max(step, 0.000001))));
}

/**
 * The ladder auto-range climbs: every decade up to the user's maximum, and
 * that maximum on top.
 *
 * Each rung is a *ceiling* - the largest value the dial would show at that
 * rung - which is what makes the hysteresis on the way down read the way it
 * does. Where the value has gone past the top of the ladder and the dial is
 * allowed to grow, the ladder grows by decades with it; otherwise the user's
 * maximum is the top and the needle sits at the end stop, which is what a
 * maximum is for.
 */
export function rangeTiers(absMax, absVal = 0, grow = false) {
  const top = Math.abs(absMax) || 1;
  const tiers = [];
  for (let t = 10; t < top; t *= 10) tiers.push(t);
  tiers.push(top);
  if (grow) {
    // By round numbers, not by decades. Ten times the user's own maximum is
    // a rung the value has almost no chance of standing near: a dial of 300M
    // that has to show 614M was drawn to 3G, which left the needle at a
    // fifth of the arc and the face labelled 0 to 30. The 1-2-5 ladder puts
    // the next rung close above the value instead, and every rung on it
    // divides into whole labels.
    let t = top;
    while (t < absVal) { t = nextRound(t); tiers.push(t); }
  }
  return tiers;
}

/**
 * Hold the old rung until the value has cleared the boundary by the margin.
 *
 * `boundary(i)` is the value at which rung `i` gives way to the one above it,
 * so going up is a question about the rung being left and coming down is a
 * question about the rung being entered - the same boundary from either side,
 * which is the whole point of a hysteresis and the thing the auto-scale tier
 * got wrong.
 */
function hold(ideal, was, absVal, hys, boundary) {
  if (was === null || ideal === was) return ideal;
  const margin = hys / 100;
  if (ideal > was) return absVal <= boundary(was) * (1 + margin) ? was : ideal;
  return absVal > boundary(ideal) * (1 - margin) ? was : ideal;
}

/**
 * The factor and the prefix a multiplier caption should be written with.
 *
 * The caption carries the auto-scale prefix because the numbers it explains
 * are in those units - but the factor is worked out from the scale, and the
 * two do not have to land on the same power of a thousand. A dial of 2000 W
 * under a k prefix divides its labels by a tenth of a thousand and used to be
 * captioned "x0.1k", which is arithmetic rather than a caption. Where the
 * factor is below one, the prefix steps down until it is not.
 *
 * @param {number} factor @param {number} tier
 */
export function multiplierParts(factor, tier) {
  let f = factor, t = Math.max(0, Math.min(tier | 0, PREFIXES.length - 1));
  while (f < 1 && t > 0 && Number.isFinite(f) && f > 0) { f *= 1000; t -= 1; }
  return { factor: f, prefix: PREFIXES[t] };
}

/**
 * The range, the value and the unit prefix the gauge should be drawn with.
 *
 * `state` is the previous call's `state`, or `NO_TIER_STATE` on the first
 * render. Nothing here reads the clock or the config: the same arguments
 * always give the same answer.
 *
 * @param {{ value: number, min: number, max: number, autoRange?: boolean,
 *           autoScale?: boolean, dynamicMax?: boolean, hysteresis?: number,
 *           state?: { range: number | null, scale: number | null } }} input
 */
export function gaugeScale(input) {
  const { value, autoRange = false, autoScale = false, dynamicMax = false } = input;
  const state = input.state || NO_TIER_STATE;
  // A blank or unreadable hysteresis is the default one, not NaN - every
  // comparison against NaN is false, which would leave the thing switched on
  // in one direction and off in the other.
  const hys = Number.isFinite(input.hysteresis) ? Number(input.hysteresis) : 10;
  const userMin = Number.isFinite(input.min) ? input.min : 0;
  const userMax = Number.isFinite(input.max) ? input.max : 100;
  const absVal = Number.isFinite(value) ? Math.abs(value) : 0;

  let min = userMin, max = userMax;
  let rangeTier = state.range, scaleTier = state.scale;

  if (autoRange) {
    const tiers = rangeTiers(userMax, absVal, dynamicMax);
    let ideal = tiers.findIndex(tier => absVal <= tier);
    if (ideal === -1) ideal = tiers.length - 1;
    rangeTier = hold(ideal, state.range, absVal, hys, i => tiers[i]);
    rangeTier = Math.min(rangeTier, tiers.length - 1);
    // An auto-ranged dial counts from zero, or symmetrically about it where
    // the user's own range reaches below zero.
    min = userMin < 0 ? -tiers[rangeTier] : 0;
    max = tiers[rangeTier];
  } else if (dynamicMax) {
    // Only the maximum moves. Where the scale starts is the user's answer -
    // a dial of 300 to 2500 that is allowed to grow is still a dial that
    // starts at 300.
    const grown = Math.max(absVal, Math.abs(userMax));
    max = userMin < 0 ? grown : Math.max(userMin, grown);
    if (userMin < 0) min = -grown;
    rangeTier = null;
  } else {
    rangeTier = null;
  }

  let unitPrefix = '', tierBase = 1;
  if (autoScale) {
    const ideal = absVal >= 1000 ? Math.floor(Math.log10(absVal) / 3) : 0;
    // The boundary between tier i and tier i+1 is a thousand to the i+1 -
    // the *floor* of the tier above, where auto-range's rungs are ceilings.
    scaleTier = Math.min(hold(ideal, state.scale, absVal, hys, i => Math.pow(1000, i + 1)),
                         PREFIXES.length - 1);
    tierBase = Math.pow(1000, scaleTier);
    min /= tierBase;
    max /= tierBase;
    unitPrefix = PREFIXES[scaleTier];
  } else {
    scaleTier = null;
  }

  return { min, max, val: Number.isFinite(value) ? value / tierBase : value,
           unitPrefix, tierBase, resultTier: scaleTier ?? 0,
           state: { range: rangeTier, scale: scaleTier } };
}
