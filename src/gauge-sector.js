/**
 * Where a sector stands on its dial, and what a hand dragging it writes.
 *
 * A sector is the one part of a gauge that is a *band of the scale* rather
 * than a ring round it: it has an inside and an outside like the frame, and a
 * beginning and an end on the scale like nothing else does. So it is placed
 * by four numbers - two radii and two per cents - and all four are dragged.
 *
 * Every angle here is the renderer's own unit: degrees clockwise from three
 * o'clock, because that is what the sector paths are built in. Per cents are
 * the scale's, which is what the config stores.
 */

import { clamp } from "./gauge-inner-boxes.js";

/** What a sector is the first time one is added, and what a card that says nothing draws. */
export const SECTOR_DEFAULTS = Object.freeze({
  start_percent: 75, length_percent: 25,
  inner_radius: 12, outer_radius: 22,
  opacity: 0.85, color: '#dc3232',
});

/** The furthest out a sector's own sliders reach. */
export const SECTOR_R_MAX = 50;

/** The shortest a sector may be dragged to and still be a sector, in per cent. */
export const SECTOR_MIN_LENGTH = 0.5;

/**
 * How far past each end of the scale a sector may be carried, in per cent.
 *
 * A band that stops exactly where the scale stops reads as a band that ran out
 * of room. Ten per cent of overhang at either end is what lets one be placed
 * *against* an end rather than inside it, and it is small enough that a sector
 * dragged off the dial altogether is not one of the things that can happen.
 */
export const SECTOR_OVERHANG = 10;

/** One decimal, the step every one of these four fields is set in. */
const tenth = (/** @type {number} */ v) => Math.round(v * 10) / 10;

/** `((n % m) + m) % m`, because `%` keeps the sign of the dividend. */
const wrap = (/** @type {number} */ n, /** @type {number} */ m) => ((n % m) + m) % m;

const num = (/** @type {any} */ v, /** @type {number} */ d) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

/**
 * The sweep the gauge draws its scale along: where nought is and how far it
 * runs, both in degrees clockwise from three o'clock.
 *
 * The same two lines the renderer works from - a semicircle is 270 degrees
 * from the lower left whatever the start angle says, and every other dial is
 * the full turn from wherever it was told to start.
 *
 * @param {any} cfg a gauge's config
 */
export function sectorSweep(cfg) {
  const semi = (cfg?.gauge_type ?? 'full') === 'semi';
  return semi ? { start: 135, total: 270 }
              : { start: num(cfg?.gauge_start_angle, -90), total: 360 };
}

/**
 * Where one sector begins and ends on that sweep, in degrees.
 *
 * @param {any} sec @param {{start: number, total: number}} sweep
 */
export function sectorAt(sec, sweep) {
  const a0 = sweep.start + num(sec?.start_percent, SECTOR_DEFAULTS.start_percent)
                         / 100 * sweep.total;
  const a1 = a0 + num(sec?.length_percent, SECTOR_DEFAULTS.length_percent)
                / 100 * sweep.total;
  return { a0, a1 };
}

/**
 * The two radii it is drawn between, in viewBox units.
 *
 * @param {any} sec @param {number} scale the gauge's own `gauge_scale`
 */
export function sectorRadii(sec, scale) {
  const s = scale || 1;
  return { inner: num(sec?.inner_radius, SECTOR_DEFAULTS.inner_radius) * s,
           outer: num(sec?.outer_radius, SECTOR_DEFAULTS.outer_radius) * s };
}

/**
 * Where on the scale an angle falls, in per cent.
 *
 * Wrapped into the sweep rather than clamped to it: on a full circle the point
 * just anticlockwise of nought is 99 per cent, not nought, and reading it as
 * nought would make the last hundredth of a dial unreachable by hand.
 *
 * @param {number} deg @param {{start: number, total: number}} sweep
 */
export function percentFromDeg(deg, sweep) {
  const total = sweep.total || 360;
  const off = wrap(deg - sweep.start, 360);
  // A semicircle leaves 90 degrees with no scale on them at all. A hand out
  // there is past one end or the other, and which one it is nearer is the
  // only honest answer.
  if (off > total) return off - total < (360 - off) ? 100 : 0;
  return off / total * 100;
}

/**
 * The per cent nearest a value, of the several that name the same point on a
 * dial that comes full circle.
 *
 * A sector ending at 100 per cent and one ending at nought are the same edge
 * *there*, and which of the two a drag should write is whichever is nearer
 * where the edge already was - otherwise a sector nudged past the top jumps
 * right round the dial.
 *
 * On a dial that does not come full circle they are not the same edge at all:
 * they are the two ends of the scale, with the dead space between them, and
 * reading one as the other is what sent a sector dragged towards the end of a
 * semicircle out the other side. So the wrapping is asked for rather than
 * assumed.
 *
 * @param {number} pct @param {number} near @param {boolean} [round] whether
 *   the dial comes full circle
 */
export function nearestPercent(pct, near, round = true) {
  if (!round) return pct;
  let best = pct;
  for (const cand of [pct - 100, pct, pct + 100]) {
    if (Math.abs(cand - near) < Math.abs(best - near)) best = cand;
  }
  return best;
}

/** Whether a sweep comes full circle, where nought and a hundred are one place. */
export const isRound = (/** @type {{total: number}} */ sweep) =>
  Math.abs(sweep.total) >= 360;

/**
 * What dragging one of a sector's two arcs writes.
 *
 * Neither edge may cross the other: a band turned inside out is a drawing
 * nobody asked for, and the field it would write reads as a mistake in the
 * form. So each stops where the other one is.
 *
 * @param {'inner'|'outer'} edge @param {number} r the radius reached, in viewBox units
 * @param {any} sec @param {number} scale
 */
export function sectorRadiusPatch(edge, r, sec, scale) {
  const v = clamp(tenth(r / (scale || 1)), 0, SECTOR_R_MAX);
  const inner = num(sec?.inner_radius, SECTOR_DEFAULTS.inner_radius);
  const outer = num(sec?.outer_radius, SECTOR_DEFAULTS.outer_radius);
  return edge === 'inner' ? { inner_radius: Math.min(v, outer) }
                          : { outer_radius: Math.max(v, inner) };
}

/**
 * What dragging one of its two ends writes.
 *
 * The end that is not in hand stays where it is, which is what makes these two
 * handles a length between them: taking the start back lengthens the sector,
 * and pulling the end round lengthens it too.
 *
 * @param {'start'|'end'} end @param {number} deg where the hand is
 * @param {any} sec @param {{start: number, total: number}} sweep
 */
export function sectorAnglePatch(end, deg, sec, sweep) {
  const start = num(sec?.start_percent, SECTOR_DEFAULTS.start_percent);
  const len = num(sec?.length_percent, SECTOR_DEFAULTS.length_percent);
  const raw = percentFromDeg(deg, sweep);
  const round = isRound(sweep);
  if (end === 'start') {
    const at = clamp(nearestPercent(raw, start, round), 0, 100);
    const stop = start + len;
    const next = Math.min(at, stop - SECTOR_MIN_LENGTH);
    return { start_percent: tenth(next), length_percent: tenth(stop - next) };
  }
  const at = nearestPercent(raw, start + len, round);
  return { length_percent: tenth(clamp(at - start, SECTOR_MIN_LENGTH, 100)) };
}

/**
 * What dragging the sector itself writes: the same reach, further round.
 *
 * Measured on the scale rather than in degrees, and as the travel from where
 * the hand took hold rather than the angle it is at now. Both matter:
 *
 * - The travel, so a sector grabbed by its end does not jump its start to the
 *   pointer.
 * - The scale, because a dial that is not a full circle has degrees on it that
 *   are not scale at all. A hand carried into that dead space is past one end,
 *   and reading its angle as degrees of travel walked the sector straight
 *   through the gap and out the far side - ninety degrees of nothing counted
 *   as a third of the scale. `percentFromDeg` answers the nearer end out
 *   there, so the sector stops at the end of the dial, which is where the hand
 *   has actually gone.
 *
 * The length is left alone, which is the whole of what this gesture is for.
 * The band may hang over either end of the scale by `SECTOR_OVERHANG`, so one
 * can be placed against an end instead of stopping short of it.
 *
 * @param {number} deg where the hand is @param {number} deg0 where it took hold
 * @param {number} from `start_percent` when the drag began
 * @param {any} sec @param {{start: number, total: number}} sweep
 */
export function sectorSlidePatch(deg, deg0, from, sec, sweep) {
  const len = num(sec?.length_percent, SECTOR_DEFAULTS.length_percent);
  const round = isRound(sweep);
  const at0 = percentFromDeg(deg0, sweep);
  const by = nearestPercent(percentFromDeg(deg, sweep), at0, round) - at0;
  const next = clamp(tenth(from + by), -SECTOR_OVERHANG,
                     Math.max(-SECTOR_OVERHANG, 100 + SECTOR_OVERHANG - len));
  return { start_percent: next };
}

/**
 * What dragging the ring between its two arcs writes: the same band, nearer
 * the centre or further from it.
 *
 * How far out a sector sits is the one thing about it that has two numbers and
 * one meaning - move either radius and the band changes width instead. So it
 * has a ring of its own, the way every other round part of a gauge is set by
 * the ring it stands on, and the width rides along untouched.
 *
 * It stops at the centre rather than folding through it: a band whose inner
 * edge has passed the pivot is drawn inside out.
 *
 * @param {number} r the radius the middle of the band has reached, in viewBox units
 * @param {any} sec @param {number} scale
 */
export function sectorReachPatch(r, sec, scale) {
  const inner = num(sec?.inner_radius, SECTOR_DEFAULTS.inner_radius);
  const outer = num(sec?.outer_radius, SECTOR_DEFAULTS.outer_radius);
  const width = outer - inner;
  const mid = clamp(r / (scale || 1), width / 2, SECTOR_R_MAX - width / 2);
  return { inner_radius: tenth(mid - width / 2), outer_radius: tenth(mid + width / 2) };
}

/**
 * The path of one arc of a sector - the shape its frame is drawn as.
 *
 * Not a closed band: each arc is one of the edges being offered, and a filled
 * shape over the sector would swallow every press on what is drawn under it.
 *
 * @param {number} cx @param {number} cy @param {number} r
 * @param {number} a0 @param {number} a1 both in degrees
 */
export function arcPath(cx, cy, r, a0, a1) {
  const span = clamp(a1 - a0, -359.99, 359.99);
  const on = (/** @type {number} */ a) => {
    const t = a * Math.PI / 180;
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
  };
  const p0 = on(a0), p1 = on(a0 + span);
  const large = Math.abs(span) > 180 ? 1 : 0;
  const sweepFlag = span < 0 ? 0 : 1;
  return `M${p0.x.toFixed(3)},${p0.y.toFixed(3)} `
       + `A${r.toFixed(3)},${r.toFixed(3)},0,${large},${sweepFlag},`
       + `${p1.x.toFixed(3)},${p1.y.toFixed(3)}`;
}

/**
 * The closed band a sector fills - what the hand takes hold of to move it.
 *
 * The same shape the renderer paints: out along one arc, across, back along
 * the other. Drawn transparent and only for the sector in hand, because a
 * filled shape over a dial takes every press meant for what is under it.
 *
 * @param {number} cx @param {number} cy
 * @param {number} inner @param {number} outer
 * @param {number} a0 @param {number} a1
 */
export function bandPath(cx, cy, inner, outer, a0, a1) {
  const span = clamp(a1 - a0, -359.99, 359.99);
  const large = Math.abs(span) > 180 ? 1 : 0;
  const fwd = span < 0 ? 0 : 1;
  const p = (/** @type {number} */ r, /** @type {number} */ a) => {
    const t = a * Math.PI / 180;
    return `${(cx + r * Math.cos(t)).toFixed(3)},${(cy + r * Math.sin(t)).toFixed(3)}`;
  };
  return `M${p(outer, a0)} A${outer.toFixed(3)},${outer.toFixed(3)},0,${large},${fwd},${p(outer, a0 + span)} `
       + `L${p(inner, a0 + span)} A${inner.toFixed(3)},${inner.toFixed(3)},0,${large},${1 - fwd},${p(inner, a0)} Z`;
}
