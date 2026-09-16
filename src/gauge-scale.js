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
    let t = top;
    while (t < absVal) { t *= 10; tiers.push(t); }
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
