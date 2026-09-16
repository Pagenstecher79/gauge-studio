import { normalizeStops, stopsToCss } from "./gradient-stops.js";

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

/**
 * The effects a pattern can run, in the order they are offered.
 *
 * Two names each: the one the menu says, which has room to explain what the
 * effect does, and the one a select standing on the drawing itself says, where
 * the whole cluster is a couple of centimetres across and a parenthesis would
 * push the element out from under it.
 */
export const PATTERN_ANIMATIONS = Object.freeze([
  Object.freeze({ value: 'none', label: 'None (background only)', short: 'None' }),
  Object.freeze({ value: 'pulse', label: 'Pulse (opacity)', short: 'Pulse' }),
  Object.freeze({ value: 'pump', label: 'Pump (scale the background)', short: 'Pump' }),
  Object.freeze({ value: 'pump_all', label: 'Pump (scale everything, content included)',
                  short: 'Pump all' }),
  Object.freeze({ value: 'ripple', label: 'Rings (concentric)', short: 'Rings' }),
  Object.freeze({ value: 'waves', label: 'Waves (linear traveling)', short: 'Waves' }),
  Object.freeze({ value: 'wobble_radial', label: 'Water drop (radial fade-out)',
                  short: 'Water drop' }),
  Object.freeze({ value: 'wobble_linear', label: 'Shockwave (linear fade-out)',
                  short: 'Shockwave' }),
  Object.freeze({ value: 'fluid', label: 'Liquid (undulating mesh)', short: 'Liquid' }),
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

/**
 * What a pattern paints, as one CSS background value.
 *
 * The gradient it actually paints - its own angle, or the radial's centre -
 * rather than a left-to-right stand-in, so a preview of it is a preview and
 * not an impression. A solid pattern is the one colour; the fluid mesh is a
 * moving thing built in the renderer and has no still picture, so it answers
 * with nothing and a caller shows whatever it shows for a pattern with no
 * background.
 *
 * @param {any} pat
 * @returns {string}
 */
export function patternPreviewCss(pat) {
  if (!pat || pat.animation === 'fluid') return '';
  if ((pat.bg_type || 'solid') === 'solid') return solidColorOf(pat);
  const stops = stopsToCss(normalizeStops(
    pat.gradient_stops ?? { colors: pat.colors, stops: pat.stops }, { fill: false }));
  return pat.bg_type === 'radial'
    ? `radial-gradient(circle at ${pat.radial_x ?? 50}% ${pat.radial_y ?? 50}%, ${stops})`
    : `linear-gradient(${pat.gradient_angle ?? 90}deg, ${stops})`;
}

/**
 * The corner radius a pattern rounds its box to, as a CSS length, or null
 * where it follows the box it paints. A radius written before the unit existed
 * is a pixel one, which is what the renderer has always read it as.
 *
 * @param {any} pat
 * @returns {string | null}
 */
export function patternRadiusCss(pat) {
  const auto = pat?.border_radius_auto === undefined
    ? pat?.target === 'main' : pat.border_radius_auto;
  if (auto || pat?.border_radius === undefined || pat?.border_radius === '') return null;
  return `${pat.border_radius}${pat.border_radius_unit || 'px'}`;
}
