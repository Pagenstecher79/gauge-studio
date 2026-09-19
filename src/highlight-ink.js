/**
 * The colour the part in hand is drawn in while it is in hand.
 *
 * The pulse says *something* is selected; the ink says *which*. A tick two
 * pixels wide in the same grey as the twenty beside it is not found by
 * dimming it by half - it is found by it being the orange one.
 *
 * It is a loan, not a setting: nothing here is written to the config, the
 * part goes back to its own colour the moment the hand moves on, and while a
 * colour is actually being chosen the editor takes the highlight off
 * altogether so the drawing answers the colour picker and not this.
 */

/**
 * The five inks to choose between.
 *
 * Saturated, far apart in hue, and none of them a colour a dial is usually
 * drawn in - the point is to be recognisably *not* the part's own colour.
 * Ordered so that an exact tie goes to the warmer one, which reads as a
 * marking rather than as part of the picture.
 */
export const HL_INKS = ['#ff9100', '#ffea00', '#ff1744', '#00e5ff', '#d500f9'];

/**
 * WCAG relative luminance.
 *
 * @param {[number, number, number]} rgb
 * @returns {number}
 */
function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    const c = Math.min(255, Math.max(0, Number(v) || 0)) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The WCAG contrast ratio between two colours, 1 to 21.
 *
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @returns {number}
 */
export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** @param {string} hex @returns {[number, number, number]} */
function hexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/**
 * The ink that stands out most against this backdrop.
 *
 * Contrast against what the part is drawn *on*, because that is what decides
 * whether it can be seen at all - a yellow tick is unmissable on a dark dial
 * and invisible on a pale one. A backdrop that cannot be read leaves the
 * first ink, which is the one that survives both ends of the range best.
 *
 * @param {[number, number, number] | null | undefined} backdrop
 * @returns {string} a `#rrggbb`
 */
export function highlightInk(backdrop) {
  if (!Array.isArray(backdrop) || backdrop.length !== 3) return HL_INKS[0];
  let best = HL_INKS[0], score = -1;
  for (const ink of HL_INKS) {
    const c = contrastRatio(hexRgb(ink), /** @type {[number, number, number]} */ (backdrop));
    if (c > score + 0.0001) { best = ink; score = c; }
  }
  return best;
}
