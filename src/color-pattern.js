import { normalizeStops } from "./gradient-stops.js";

/**
 * What a colour pattern is, and how one is found and changed in the slot's
 * list.
 *
 * A pattern is a paint job on one box. Two places need to reach the same one:
 * the panel folded into that box's settings, and - on a canvas - the offers
 * drawn on the box itself. Both want the same three answers, so the answers
 * are here rather than twice over.
 *
 * A pattern is found by the target it paints and never by an index: the list
 * is the user's own order, and a caller knows only which box it is for.
 * Making the pattern on the first write is part of the same job - a panel that
 * is opened to look as often as to paint, and a grip on a corner, both have no
 * other moment to make one.
 */

/** The effects a pattern can run, in the order they are offered. */
export const PATTERN_ANIMATIONS = Object.freeze([
  Object.freeze({ value: 'none', label: 'None (background only)' }),
  Object.freeze({ value: 'pulse', label: 'Pulse (opacity)' }),
  Object.freeze({ value: 'pump', label: 'Pump (scale the background)' }),
  Object.freeze({ value: 'pump_all', label: 'Pump (scale everything, content included)' }),
  Object.freeze({ value: 'ripple', label: 'Rings (concentric)' }),
  Object.freeze({ value: 'waves', label: 'Waves (linear traveling)' }),
  Object.freeze({ value: 'wobble_radial', label: 'Water drop (radial fade-out)' }),
  Object.freeze({ value: 'wobble_linear', label: 'Shockwave (linear fade-out)' }),
  Object.freeze({ value: 'fluid', label: 'Liquid (undulating mesh)' }),
]);

/**
 * A pattern nobody has touched yet.
 *
 * @param {string} target
 */
export function defaultColorPattern(target) {
  return {
    id: Date.now(), enabled: true, name: 'New pattern', target,
    bg_condition: [], anim_condition: [], bg_type: 'solid',
    gradient_stops: [{ pos: 100, color: '#ff9800' }], opacity: 100, gradient_angle: 90,
    animation: 'none',
    anim_duration: 3, wave_count: 3, wave_c1: '#03a9f4', wave_c2: 'transparent',
    border_radius: '', border_radius_unit: 'px', wave_invert: false, pump_scale: 1.1,
    radial_x: 50, radial_y: 50, wave_balance: 50,
    wobble_amplitude: 100, wobble_freq: 4, wobble_pause: 2,
  };
}

/** The list, whatever the slot happens to be holding. */
export function patternList(slot) {
  return Array.isArray(slot?.color_patterns) ? slot.color_patterns : [];
}

/** The pattern painting `target`, or null when nothing paints it yet. */
export function patternFor(list, target) {
  const found = (Array.isArray(list) ? list : []).find(p => p?.target === target);
  return found || null;
}

/**
 * The list with `patch` written onto the pattern for `target`, making that
 * pattern first if there is none.
 *
 * @param {any[]} list @param {string} target @param {Record<string, any>} patch
 */
export function patchPattern(list, target, patch) {
  const from = Array.isArray(list) ? list : [];
  const idx = from.findIndex(p => p?.target === target);
  if (idx < 0) return [...from, { ...defaultColorPattern(target), ...patch }];
  const next = structuredClone(from);
  Object.assign(next[idx], patch);
  return next;
}

/**
 * The same, for the colour stops - which are written as the one stop shape,
 * with the parallel `colors`/`stops` arrays a pattern may still carry taken
 * out in the same edit. Leaving them would keep a second, now stale, answer
 * in the config.
 *
 * @param {any[]} list @param {string} target @param {any[]} stops
 */
export function patchPatternStops(list, target, stops) {
  const next = patchPattern(list, target, { gradient_stops: stops });
  const idx = next.findIndex(p => p?.target === target);
  if (idx >= 0) {
    delete next[idx].colors;
    delete next[idx].stops;
  }
  return next;
}

/** The one colour a solid pattern paints, read through the shared stop shape. */
export function solidColorOf(pat) {
  const stops = normalizeStops(
    pat?.gradient_stops ?? { colors: pat?.colors, stops: pat?.stops }, { fill: false });
  return stops[0]?.color || '#ff9800';
}

/**
 * That colour set, as the patch that sets it. The position is kept, because a
 * pattern switched back to a gradient should find its stop where it left it.
 *
 * @param {any} pat @param {string} color
 */
export function solidColorPatch(pat, color) {
  const stops = normalizeStops(
    pat?.gradient_stops ?? { colors: pat?.colors, stops: pat?.stops }, { fill: false });
  return { gradient_stops: [{ pos: stops[0]?.pos ?? null, color }] };
}
