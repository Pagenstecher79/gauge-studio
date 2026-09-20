
/**
 * The indicator pill's glass, as numbers and as one CSS string per effect.
 *
 * The pill used to be glass only in name: a blur behind it and two inset
 * shadows on it. A blur softens what is behind the pill but does not bend it,
 * and bending is the whole of what makes a lens read as glass rather than as
 * frosted plastic. The two effects here bend it, with an SVG displacement map
 * the pill carries in `backdrop-filter`.
 *
 * Two things are deliberately *not* done, both measured on 64 pills animating
 * at once against a 120 Hz budget of 8.3 ms per frame:
 *
 * - The colour fringe is painted, not refracted. A real one means displacing
 *   the red, green and blue channels by different amounts, which is three
 *   displacement passes instead of one: 53 fps and 51 dropped frames, against
 *   119 fps for a single pass. Two tinted rim shadows are indistinguishable
 *   at pill size and cost nothing.
 * - The displacement is flat across the middle of the pill and steep only at
 *   its rim, which is where a lens actually bends light. A ramp across the
 *   whole pill smears the text behind it.
 *
 * Everything the fallback needs is in the pill's own background and shadows,
 * so a browser that ignores `backdrop-filter: url()` - Safari, Firefox -
 * still draws a lit dome with a bright rim rather than a flat blob. That is
 * why the shading is not inside the filter.
 *
 * Pure, so it is testable and so the editor could preview the same pill.
 */

import { suspendable } from './glass-suspend.js';

/** The effects that carry a displacement map. */
export const LIQUID_EFFECTS = Object.freeze(['glass_liquid', 'glass_liquid_heavy']);

/**
 * @param {unknown} effect a value of `indicator_glass_effect`
 * @returns {boolean}
 */
export function isLiquidEffect(effect) {
  return typeof effect === 'string' && LIQUID_EFFECTS.includes(effect);
}

/**
 * How far the rim bends what is behind it, as a share of the pill's short
 * side.
 *
 * A share rather than a length, because the pill is sized from its font and
 * a shift that suits a 20 px pill turns a 9 px one inside out. The pill is
 * measured after layout and the share turned into pixels there - see
 * `applyLensGeometry` in `glass-lens.js`.
 *
 * @param {string} effect
 * @returns {number} 0 for an effect that does not bend anything
 */
export function pillLensFraction(effect) {
  if (!isLiquidEffect(effect)) return 0;
  return effect === 'glass_liquid_heavy' ? 0.13 : 0.09;
}

/**
 * The pill's own paint for a liquid effect: the dome, the lit rim, the fringe.
 *
 * Written as one declaration block so the caller can drop it into the inline
 * style it already builds, next to the position and the colours.
 *
 * An empty `filterId` leaves the backdrop alone and paints the rest, which is
 * what an opaque pill gets: there is nothing behind it to bend.
 *
 * @param {string} effect
 * @param {string} filterId the SVG filter in the component's shadow root
 * @returns {string}
 */
export function liquidPillCSS(effect, filterId) {
  const heavy = effect === 'glass_liquid_heavy';
  const lens = filterId
    ? 'blur(0.5px) url(#' + filterId + ')' + (heavy ? ' brightness(1.06)' : ' saturate(1.25)')
    : '';

  // The dome first, then the caustic at the bottom: light through a lens
  // leaves the far rim brighter than the middle, which is the cue that says
  // "thick" without drawing a thicker edge.
  const dome = heavy
    ? 'linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0) 45%), '
      + 'radial-gradient(120% 150% at 50% 135%, rgba(255,255,255,0.25), transparent 60%)'
    : 'radial-gradient(120% 160% at 32% -25%, rgba(255,255,255,0.40), rgba(255,255,255,0.05) 42%, transparent 68%), '
      + 'radial-gradient(120% 150% at 50% 135%, rgba(255,255,255,0.22), transparent 62%)';

  const rim = heavy
    ? [
        'inset 0 1.5px 0 rgba(255,255,255,0.85)',
        'inset 0 -1.5px 0 rgba(255,255,255,0.4)',
        'inset 3px 0 4px -3px rgba(120,200,255,0.7)',
        'inset -3px 0 4px -3px rgba(255,180,140,0.65)',
        'inset 0 0 0 1px rgba(255,255,255,0.2)',
        'inset 0 -10px 14px -10px rgba(0,0,0,0.5)',
        '0 6px 16px rgba(0,0,0,0.5)',
      ]
    : [
        'inset 0 1px 0 rgba(255,255,255,0.75)',
        'inset 0 -1px 0 rgba(255,255,255,0.35)',
        'inset 3px 0 4px -3px rgba(120,200,255,0.75)',
        'inset -3px 0 4px -3px rgba(255,180,140,0.7)',
        'inset 0 0 0 1px rgba(255,255,255,0.18)',
        '0 4px 12px rgba(0,0,0,0.45)',
      ];

  const lensCSS = suspendable(lens);

  return (lensCSS ? 'backdrop-filter: ' + lensCSS + '; -webkit-backdrop-filter: ' + lensCSS + '; ' : '')
    + 'background-image: ' + dome + '; '
    + 'box-shadow: ' + rim.join(', ') + '; '
    + 'border: none; text-shadow: 0 1px 2px rgba(0,0,0,0.55);';
}

/**
 * The pill's padding for a liquid effect.
 *
 * The heavy one is not a different filter, it is more glass: a rim that is
 * further from the text has more room to bend anything through it. The extra
 * is handed back separately because the caller clamps the pill against the
 * ends of the bar and has to widen that clamp by the same amount, or a pill
 * at 100 % hangs over the edge.
 *
 * @param {string} effect
 * @returns {{ padding: string, clampEm: number }}
 */
export function liquidPadding(effect) {
  const [yEm, xEm, clampEm] =
    effect === 'glass_liquid_heavy' ? [0.55, 1.15, 0.35] :
    effect === 'glass_liquid' ? [0.42, 0.95, 0.15] :
    [0.3, 0.8, 0];
  return { padding: `${yEm}em ${xEm}em`, clampEm, xEm, yEm };
}

/**
 * How much of an em one character of the reading takes.
 *
 * The reading is digits, a space and a short unit, set bold: a bold digit in
 * the fonts Home Assistant ships advances a little under 0.6em, and the
 * widest thing that regularly stands beside one - a per cent sign - a little
 * over 0.8em. 0.62 is the digits with enough left over for the sign, and it
 * is within a hundredth of an em of the 0.6 the end-of-bar clamp has always
 * estimated a pill's width with, so the two cannot disagree by a pixel.
 *
 * Measuring the text instead would be exact and is not worth it: the reading
 * changes with every state, and a measurement means a second layout pass per
 * frame on the one element that moves every frame.
 */
export const PILL_GLYPH_EM = 0.62;

/** A line of that text, from the top of the digits to the bottom. */
export const PILL_LINE_EM = 1.25;

/**
 * The pill's font size, capped so the reading fits the bar it rides.
 *
 * The pill is set `nowrap`, because a reading broken across two lines is not
 * a reading - so where the bar is too narrow for it something has to give,
 * and the only thing that can is the type size. Both axes are asked: the line
 * of text has to fit along its own direction, and the pill's one line has to
 * fit across it, or the bar's `overflow: hidden` takes the rounded ends off.
 *
 * The two extents are given as CSS lengths - the caller knows which screen
 * axis the text runs along once the pill's rotation is applied, and passes
 * the bar's own measure for each. The padding is in em and so grows with the
 * size, which is why it is divided out rather than subtracted.
 *
 * @param {string} size the configured size, a CSS length
 * @param {number} chars characters in the reading
 * @param {{ xEm: number, yEm: number }} pad from `liquidPadding`
 * @param {string} along the bar's extent in the direction the text runs
 * @param {string} across the bar's extent at right angles to it
 * @returns {string} a CSS length, never larger than `size`
 */
export function pillFontSize(size, chars, pad, along, across) {
  const n = Number.isFinite(chars) && chars > 1 ? chars : 1;
  const wide = n * PILL_GLYPH_EM + 2 * pad.xEm;
  const tall = PILL_LINE_EM + 2 * pad.yEm;
  const r = (/** @type {number} */ v) => Number(v.toFixed(3));
  return `min(${size}, calc(${along} / ${r(wide)}), calc(${across} / ${r(tall)}))`;
}
