import { describe, it, expect } from 'vitest';
import { highlightInk, contrastRatio, HL_INKS } from './highlight-ink.js';

describe('contrastRatio', () => {
  it('is 21 between black and white, and 1 for a colour against itself', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([87, 12, 200], [87, 12, 200])).toBeCloseTo(1, 10);
  });

  it('does not care which way round the two are given', () => {
    expect(contrastRatio([10, 20, 30], [200, 210, 220]))
      .toBeCloseTo(contrastRatio([200, 210, 220], [10, 20, 30]), 10);
  });
});

describe('highlightInk', () => {
  it('picks a light ink on a dark dial and a dark one on a pale dial', () => {
    expect(highlightInk([30, 30, 30])).toBe('#ffea00');
    expect(highlightInk([255, 255, 255])).toBe('#d500f9');
  });

  it('answers with an ink from the set, whatever the backdrop', () => {
    for (let r = 0; r <= 255; r += 51)
      for (let g = 0; g <= 255; g += 51)
        for (let b = 0; b <= 255; b += 51)
          expect(HL_INKS).toContain(highlightInk([r, g, b]));
  });

  it('never picks an ink that another ink beats on this backdrop', () => {
    for (const bg of [[0, 0, 0], [30, 30, 30], [120, 120, 120], [200, 30, 30], [255, 255, 255]]) {
      const picked = highlightInk(/** @type {any} */ (bg));
      const best = Math.max(...HL_INKS.map(ink => contrastRatio(
        [parseInt(ink.slice(1, 3), 16), parseInt(ink.slice(3, 5), 16), parseInt(ink.slice(5, 7), 16)],
        /** @type {any} */ (bg))));
      const got = contrastRatio(
        [parseInt(picked.slice(1, 3), 16), parseInt(picked.slice(3, 5), 16), parseInt(picked.slice(5, 7), 16)],
        /** @type {any} */ (bg));
      expect(got).toBeCloseTo(best, 6);
    }
  });

  // A backdrop nobody could read is not a reason to stop highlighting.
  it('falls back to the first ink when there is no backdrop to read', () => {
    expect(highlightInk(null)).toBe(HL_INKS[0]);
    expect(highlightInk(undefined)).toBe(HL_INKS[0]);
    expect(highlightInk(/** @type {any} */ ([12, 34]))).toBe(HL_INKS[0]);
  });
});
