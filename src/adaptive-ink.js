/**
 * What "adaptive" means for a mark drawn on a gauge.
 *
 * It used to mean `var(--primary-text-color)`: the colour the dashboard
 * writes its text in. That is the right answer for a mark standing on the
 * card, and the wrong one the moment the gauge paints a background of its
 * own - a light theme writes near-black, and near-black on the red a
 * threshold turns the dial is a tick nobody can read. The mark does not sit
 * on the card there; it sits on the red.
 *
 * So the question is what the mark is actually drawn *on*, and the answer is
 * black or white against it, the way any label on a coloured field is chosen.
 * Where the gauge paints nothing - or so little that the card shows through -
 * there is no better answer than the theme's own, and the theme's own is what
 * it keeps: the point is to fix the case that cannot be read, not to take the
 * dashboard's colour away from everybody.
 *
 * The arithmetic is here rather than in the renderer because it is
 * arithmetic, and a wrong number is a dial full of invisible marks.
 */

import { luminance } from './highlight-ink.js';

/** The two inks to choose between - Home Assistant's own text colours. */
export const INK_DARK = '#212121';
export const INK_LIGHT = '#ffffff';

/**
 * Below this, the card behind shows through more than the colour does, so
 * what the mark stands on is the card and not the gauge.
 *
 * Half is not a measurement, it is where the majority changes hands: at 0.5
 * the blend is equal parts, and one step either way says which of the two the
 * eye is actually reading the mark against.
 */
export const SHOWS_THROUGH = 0.5;

/**
 * The colour a gauge's marks are drawn on, or null for "the card decides".
 *
 * `fill` wins over everything, because it is what a threshold or a pulse
 * paints over the background the config asks for - and it is exactly the case
 * this is here for. A gradient is averaged: the marks are spread across the
 * whole dial rather than standing on one stop, so the one number that answers
 * for all of them is the middle. Averaging in sRGB is not how light mixes,
 * but it is how the two ends of a dial's gradient look side by side, and the
 * only thing the answer is used for is which side of the middle it falls.
 *
 * @param {object} bg
 * @param {[number, number, number]|null} [bg.fill] a colour painted over the
 *   background - a threshold's, a pulse's
 * @param {string} [bg.mode] `bg_mode`: none, adaptive, solid, linear, radial
 * @param {Array<[number, number, number]>} [bg.stops] the background's own
 *   colours, already parsed - one for solid, two or more for a gradient
 * @param {number} [bg.opacity] what the background is drawn at, 0 to 1
 * @returns {[number, number, number]|null}
 */
export function markBackdrop({ fill = null, mode = 'none', stops = [], opacity = 1 } = {}) {
  const seen = Number.isFinite(opacity) ? opacity : 1;
  if (seen < SHOWS_THROUGH) return null;
  if (fill) return fill;
  // `adaptive` is the card's own background, and `none` is nothing at all:
  // either way the mark stands on the card, which is where the theme's text
  // colour is the right answer and this has nothing to add.
  if (mode !== 'solid' && mode !== 'linear' && mode !== 'radial') return null;
  const good = stops.filter(s => Array.isArray(s) && s.length === 3
    && s.every(v => Number.isFinite(v)));
  if (!good.length) return null;
  return /** @type {[number, number, number]} */ ([0, 1, 2].map(i =>
    Math.round(good.reduce((sum, s) => sum + s[i], 0) / good.length)));
}

/**
 * Where a field stops being dark and starts being light, in L*.
 *
 * Not the WCAG contrast ratio, which is the obvious thing to reach for and
 * gives the wrong answer here: against the red a threshold paints
 * (`#ff3232`) near-black scores 4.5 and white 3.7, so the ratio would keep
 * the very colour the complaint is about. The ratio is built for text, where
 * a stroke is a stem several pixels wide; a tick is two pixels of a thin line
 * on a saturated hue, and there the eye goes by lightness. L* is lightness as
 * it is seen, 60 is the middle of it by long convention, and it puts white on
 * that red - which is what anybody would have drawn by hand.
 */
export const LIGHT_FIELD = 60;

/**
 * The ink to draw a mark in, given what it stands on.
 *
 * Null backdrop - the card decides - gives back null, and the caller keeps
 * whatever it used before.
 *
 * @param {[number, number, number]|null} backdrop
 * @returns {string|null} a `#rrggbb`, or null to leave the answer alone
 */
export function inkOn(backdrop) {
  if (!Array.isArray(backdrop) || backdrop.length !== 3) return null;
  const y = luminance(/** @type {[number, number, number]} */ (backdrop));
  // The CIE lightness of that luminance, linear at the very bottom where the
  // cube root is not defined well enough to use.
  const lstar = y <= 0.008856 ? y * 903.3 : 116 * Math.cbrt(y) - 16;
  return lstar >= LIGHT_FIELD ? INK_DARK : INK_LIGHT;
}

/**
 * The two put together: what a gauge's adaptive marks should be drawn in.
 *
 * @param {Parameters<typeof markBackdrop>[0]} bg
 * @returns {string|null}
 */
export function adaptiveInk(bg) {
  return inkOn(markBackdrop(bg));
}
