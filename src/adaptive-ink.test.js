import { describe, it, expect } from 'vitest';
import { markBackdrop, inkOn, adaptiveInk, INK_DARK, INK_LIGHT, SHOWS_THROUGH }
  from './adaptive-ink.js';

describe('markBackdrop', () => {
  it('says the card decides where the gauge paints nothing', () => {
    expect(markBackdrop({ mode: 'none' })).toBe(null);
    expect(markBackdrop()).toBe(null);
  });

  it("says the card decides for the background that is the card's own", () => {
    expect(markBackdrop({ mode: 'adaptive', stops: [[10, 10, 10]] })).toBe(null);
  });

  it('answers with a solid background', () => {
    expect(markBackdrop({ mode: 'solid', stops: [[200, 0, 0]] })).toEqual([200, 0, 0]);
  });

  it('averages a gradient, because the marks are spread across all of it', () => {
    expect(markBackdrop({ mode: 'linear', stops: [[0, 0, 0], [100, 200, 40]] }))
      .toEqual([50, 100, 20]);
    expect(markBackdrop({ mode: 'radial', stops: [[0, 0, 0], [10, 10, 10], [50, 50, 50]] }))
      .toEqual([20, 20, 20]);
  });

  it('lets a painted fill win over the background underneath it', () => {
    expect(markBackdrop({ fill: [255, 50, 50], mode: 'solid', stops: [[20, 20, 20]] }))
      .toEqual([255, 50, 50]);
    // And over a background that would otherwise have answered "the card".
    expect(markBackdrop({ fill: [255, 50, 50], mode: 'none' })).toEqual([255, 50, 50]);
  });

  it('hands the question back once the card shows through', () => {
    expect(markBackdrop({ fill: [255, 50, 50], opacity: SHOWS_THROUGH - 0.01 })).toBe(null);
    expect(markBackdrop({ mode: 'solid', stops: [[200, 0, 0]], opacity: 0.2 })).toBe(null);
    // Exactly at the line the colour still has it.
    expect(markBackdrop({ mode: 'solid', stops: [[200, 0, 0]], opacity: SHOWS_THROUGH }))
      .toEqual([200, 0, 0]);
  });

  it('ignores a colour it cannot read', () => {
    expect(markBackdrop({ mode: 'solid', stops: [null, 'red', [1, 2]] })).toBe(null);
    expect(markBackdrop({ mode: 'solid', stops: [[NaN, 0, 0], [10, 20, 30]] }))
      .toEqual([10, 20, 30]);
  });

  it('reads a missing opacity as fully painted', () => {
    expect(markBackdrop({ mode: 'solid', stops: [[9, 9, 9]], opacity: undefined }))
      .toEqual([9, 9, 9]);
  });
});

describe('inkOn', () => {
  it('leaves the answer alone where there is no backdrop', () => {
    expect(inkOn(null)).toBe(null);
    expect(inkOn(/** @type {any} */ ([1, 2]))).toBe(null);
  });

  it('writes light on a dark field and dark on a light one', () => {
    expect(inkOn([20, 20, 20])).toBe(INK_LIGHT);
    expect(inkOn([240, 240, 240])).toBe(INK_DARK);
  });

  it('writes light on the red a threshold paints, which is the whole point', () => {
    expect(inkOn([255, 50, 50])).toBe(INK_LIGHT);
  });

  it('writes light on a mid field, which is where the ratio would not', () => {
    // #767676 is the grey WCAG calls the crossover; seen lightness says it is
    // still a dark field, and a thin tick on it has to be white.
    expect(inkOn([118, 118, 118])).toBe(INK_LIGHT);
    // A shade lighter and it changes hands.
    expect(inkOn([160, 160, 160])).toBe(INK_DARK);
  });
});

describe('adaptiveInk', () => {
  it('is the two of them in one question', () => {
    expect(adaptiveInk({ fill: [255, 50, 50] })).toBe(INK_LIGHT);
    expect(adaptiveInk({ mode: 'solid', stops: [[255, 240, 200]] })).toBe(INK_DARK);
    expect(adaptiveInk({ mode: 'none' })).toBe(null);
  });
});
