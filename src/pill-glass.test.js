import { describe, it, expect } from 'vitest';
import { isLiquidEffect, pillLensFraction, liquidPillCSS, liquidPadding, pillFontSize,
         PILL_GLYPH_EM, PILL_LINE_EM, LIQUID_EFFECTS } from './pill-glass.js';

describe('isLiquidEffect', () => {
  it('knows the two effects that carry a displacement map', () => {
    expect(LIQUID_EFFECTS.map(isLiquidEffect)).toEqual([true, true]);
  });

  it('is false for every other glass effect, and for nothing at all', () => {
    for (const e of ['none', 'glass_lens', 'glass_gooey', 'glass_clean', 'glass_clear', 'glass_dark'])
      expect(isLiquidEffect(e)).toBe(false);
    expect(isLiquidEffect(undefined)).toBe(false);
    expect(isLiquidEffect(null)).toBe(false);
    expect(isLiquidEffect(12)).toBe(false);
  });
});

describe('pillLensFraction', () => {
  it('is a share of the pill, not a length, so the font size cannot blow it up', () => {
    expect(pillLensFraction('glass_liquid')).toBe(0.09);
  });

  it('bends further for the thick variant', () => {
    expect(pillLensFraction('glass_liquid_heavy')).toBeGreaterThan(pillLensFraction('glass_liquid'));
  });

  it('is nothing for an effect that does not bend anything', () => {
    for (const e of ['none', 'glass_dark', undefined, null, 12]) expect(pillLensFraction(e)).toBe(0);
  });
});

describe('liquidPillCSS', () => {
  it('references the filter it is given', () => {
    expect(liquidPillCSS('glass_liquid', 'sc-pill-lens')).toContain('url(#sc-pill-lens)');
  });

  it('leaves the backdrop alone when there is no filter, and still paints the glass', () => {
    const css = liquidPillCSS('glass_liquid', '');
    expect(css).not.toContain('backdrop-filter');
    expect(css).toContain('box-shadow');
    expect(css).toContain('background-image');
  });

  it('paints the colour fringe rather than refracting it', () => {
    // Two tinted rim shadows, cool on one side and warm on the other: the
    // three-pass version that would refract it costs 2.2x the frame time.
    const css = liquidPillCSS('glass_liquid', 'f');
    expect(css).toContain('rgba(120,200,255');
    expect(css).toContain('rgba(255,180,140');
  });

  it('gives the thick variant a deeper rim than the plain one', () => {
    const plain = liquidPillCSS('glass_liquid', 'f');
    const heavy = liquidPillCSS('glass_liquid_heavy', 'f');
    expect(heavy).not.toEqual(plain);
    expect(heavy.split('inset').length).toBeGreaterThan(plain.split('inset').length);
  });
});

describe('liquidPadding', () => {
  it('keeps the flat pill exactly as it was', () => {
    expect(liquidPadding('glass_lens'))
      .toEqual({ padding: '0.3em 0.8em', clampEm: 0, xEm: 0.8, yEm: 0.3 });
    expect(liquidPadding('none'))
      .toEqual({ padding: '0.3em 0.8em', clampEm: 0, xEm: 0.8, yEm: 0.3 });
  });

  it('widens the end-of-bar clamp by whatever it added to the padding', () => {
    for (const e of LIQUID_EFFECTS) expect(liquidPadding(e).clampEm).toBeGreaterThan(0);
    expect(liquidPadding('glass_liquid_heavy').clampEm)
      .toBeGreaterThan(liquidPadding('glass_liquid').clampEm);
  });
});

describe('pillFontSize', () => {
  const flat = liquidPadding('none');

  it('never asks for more than the size the card set', () => {
    expect(pillFontSize('10px', 3, flat, '100cqw', '100cqh'))
      .toMatch(/^min\(10px, /);
  });

  it('divides each extent by the pill it has to hold, in em', () => {
    // Three characters: 3 x 0.62 across the glyphs, plus 0.8em of padding on
    // each side; one line of 1.25em, plus 0.3em above and below.
    const wide = 3 * PILL_GLYPH_EM + 2 * flat.xEm;
    const tall = PILL_LINE_EM + 2 * flat.yEm;
    expect(pillFontSize('10px', 3, flat, '40px', '20px'))
      .toBe(`min(10px, calc(40px / ${Number(wide.toFixed(3))}), calc(20px / ${Number(tall.toFixed(3))}))`);
  });

  it('gives a wider pill a smaller cap, character by character', () => {
    const cap = (/** @type {number} */ n) =>
      Number(/calc\(100px \/ ([\d.]+)\)/.exec(pillFontSize('10px', n, flat, '100px', '100px'))[1]);
    expect(cap(6)).toBeGreaterThan(cap(3));
    expect(cap(6) - cap(3)).toBeCloseTo(3 * PILL_GLYPH_EM, 3);
  });

  it('asks for room for one character when the reading has none to count', () => {
    const one = pillFontSize('10px', 1, flat, '100px', '100px');
    for (const n of [0, -2, NaN, undefined])
      expect(pillFontSize('10px', /** @type {any} */ (n), flat, '100px', '100px')).toBe(one);
  });

  it('carries the extra padding of a liquid rim into the fit', () => {
    const heavy = liquidPadding('glass_liquid_heavy');
    const capOf = (/** @type {any} */ pad) =>
      Number(/calc\(100px \/ ([\d.]+)\)/.exec(pillFontSize('10px', 4, pad, '100px', '100px'))[1]);
    expect(capOf(heavy)).toBeGreaterThan(capOf(flat));
  });
});
