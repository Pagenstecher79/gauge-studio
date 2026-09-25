import { describe, it, expect } from 'vitest';
import {
  POINTER_GLASS_EFFECTS, POINTER_LENS_FRACTION,
  isPointerGlass, pointerLensFraction, pointerBlurPx,
  pointerBackdrop, pointerGlassPaint, pointerGlassStyle, pointerGlassBox,
} from './pointer-glass.js';

const ADVERSARIAL = [undefined, null, '', 0, 1, 'true', 'false', NaN, -1];

describe('isPointerGlass', () => {
  it('knows the two effects that draw glass', () => {
    expect(isPointerGlass('glass')).toBe(true);
    expect(isPointerGlass('glass_liquid')).toBe(true);
    expect(isPointerGlass('none')).toBe(false);
  });

  it('says no to anything else', () => {
    for (const v of ADVERSARIAL) expect(isPointerGlass(v)).toBe(false);
  });

  it('agrees with the list of effects', () => {
    expect(POINTER_GLASS_EFFECTS.filter(isPointerGlass)).toEqual(['glass', 'glass_liquid']);
  });
});

describe('pointerLensFraction', () => {
  it('bends only for the liquid effect', () => {
    expect(pointerLensFraction('glass_liquid')).toBe(POINTER_LENS_FRACTION);
    expect(pointerLensFraction('glass')).toBe(0);
    expect(pointerLensFraction('none')).toBe(0);
  });

  it('no longer withholds the lens from a thin needle', () => {
    // The width gate is gone: a rod bends a share of its own width, so a
    // fine needle bends as much of itself as a thick one does of itself.
    expect(pointerLensFraction('glass_liquid')).toBeGreaterThan(0);
  });

  it('is 0 for anything that is not an effect name', () => {
    for (const v of ADVERSARIAL) expect(pointerLensFraction(v)).toBe(0);
  });
});

describe('pointerBlurPx', () => {
  it('is zero at zero, which is the whole point', () => {
    expect(pointerBlurPx(0)).toBe(0);
    expect(pointerBlurPx('0')).toBe(0);
  });

  it('is zero for anything that is not a positive number', () => {
    for (const v of [undefined, null, '', NaN, -3, 'blurry', false]) {
      expect(pointerBlurPx(v)).toBe(0);
    }
  });

  it('passes a real blur through, string or number', () => {
    expect(pointerBlurPx(3)).toBe(3);
    expect(pointerBlurPx('2.5')).toBe(2.5);
  });
});

describe('pointerBackdrop', () => {
  it('writes nothing at all when there is neither blur nor lens', () => {
    expect(pointerBackdrop('', 0)).toBe('');
  });

  // The measurement this module exists for: blur(0px) is not a no-op, it
  // still makes the part a backdrop root and pays for the re-sampling.
  it('never writes blur(0px)', () => {
    expect(pointerBackdrop('', 0)).not.toContain('blur');
    expect(pointerBackdrop('f', 0)).not.toContain('blur');
    expect(pointerGlassStyle({
      effect: 'glass', color: '#fff', x: 0, y: 0, w: 10, h: 2, size: 50, blurPx: 0,
    })).not.toContain('blur');
  });

  it('carries the lens alone, the blur alone, and both in that order', () => {
    expect(pointerBackdrop('lens1', 0)).toContain('url(#lens1)');
    expect(pointerBackdrop('lens1', 0)).not.toContain('blur');
    expect(pointerBackdrop('', 3)).toContain('blur(3px)');
    expect(pointerBackdrop('', 3)).not.toContain('url(');
    expect(pointerBackdrop('lens1', 3)).toMatch(/blur\(3px\) url\(#lens1\)/);
  });

  it('goes through the suspend wrapper, so a modal can switch it off', () => {
    expect(pointerBackdrop('lens1', 0)).toMatch(/^var\(--sc-glass-suspend, .+\)$/);
    expect(pointerBackdrop('', 2)).toMatch(/^var\(--sc-glass-suspend, .+\)$/);
  });
});

describe('pointerGlassPaint', () => {
  it('thins the part\'s own colour rather than painting it white', () => {
    expect(pointerGlassPaint('glass', 'rgb(255,0,0)'))
      .toContain('color-mix(in srgb, rgb(255,0,0) 30%, transparent)');
  });

  it('leaves a var() alone, so the colour keeps following the theme', () => {
    const css = pointerGlassPaint('glass', 'var(--primary-color)');
    expect(css).toContain('var(--primary-color)');
    expect(css).toContain('color-mix');
  });

  it('gives the liquid effect the thinner body and the further rim', () => {
    const plain = pointerGlassPaint('glass', '#fff');
    const liquid = pointerGlassPaint('glass_liquid', '#fff');
    expect(plain).toContain('30%');
    expect(liquid).toContain('22%');
    expect(liquid.split(',').length).toBeGreaterThan(plain.split(',').length);
  });

  it('always lights the rim, which is the half that costs nothing', () => {
    for (const e of ['glass', 'glass_liquid']) {
      expect(pointerGlassPaint(e, '#fff')).toContain('inset 0 1px 0 rgba(255,255,255,');
    }
  });
});

describe('pointerGlassStyle', () => {
  const base = { effect: 'glass', color: '#fff', x: 25, y: 24, w: 20, h: 2, size: 50 };

  it('puts the part where the SVG shape would have been, in per cent', () => {
    const css = pointerGlassStyle(base);
    expect(css).toContain('left: 50.0000%');
    expect(css).toContain('top: 48.0000%');
    expect(css).toContain('width: 40.0000%');
    expect(css).toContain('height: 4.0000%');
  });

  it('rounds a needle by its own half-height, so the ends are caps', () => {
    expect(pointerGlassStyle(base)).toContain('border-radius: 2.0000% / 50%');
  });

  it('cuts a triangle and rounds a circle', () => {
    expect(pointerGlassStyle({ ...base, shape: 'triangle' }))
      .toContain('clip-path: polygon(100% 50%, 0 0, 0 100%)');
    expect(pointerGlassStyle({ ...base, shape: 'circle' })).toContain('border-radius: 50%');
  });

  it('writes both vendor spellings when there is a filter, and neither when there is not', () => {
    const withLens = pointerGlassStyle({ ...base, filterId: 'lp' });
    expect(withLens).toContain('backdrop-filter:');
    expect(withLens).toContain('-webkit-backdrop-filter:');
    expect(pointerGlassStyle(base)).not.toContain('backdrop-filter');
  });
});

describe('pointerGlassBox', () => {
  const base = { effect: 'glass', color: '#fff', x: 10, y: 20, w: 40, h: 4, size: 100 };

  it('leaves a rounded shape as one box', () => {
    for (const shape of ['round', 'circle']) {
      const box = pointerGlassBox({ ...base, shape });
      expect(box.inner).toBeNull();
      expect(box.outer).toBe(pointerGlassStyle({ ...base, shape }));
    }
  });

  it('cuts a triangle on an outer box, so the glass inside it is cut too', () => {
    const box = pointerGlassBox({ ...base, shape: 'triangle', blurPx: 2 });
    expect(box.outer).toContain('clip-path: polygon(100% 50%, 0 0, 0 100%)');
    expect(box.outer).not.toContain('backdrop-filter');
    expect(box.inner).toContain('backdrop-filter');
    expect(box.inner).toContain('inset: 0');
  });

  it('gives a cut shape no box-shadow, which would not follow the cut', () => {
    const box = pointerGlassBox({ ...base, shape: 'triangle' });
    expect(box.inner).not.toContain('box-shadow');
    expect(box.outer).not.toContain('box-shadow');
    // What the lost rim said is said by a gradient, which is cut with the rest.
    expect(box.inner).toContain('linear-gradient(0deg, rgba(0,0,0,0.35)');
  });

  it('puts the geometry on the outer box and nowhere else', () => {
    const box = pointerGlassBox({ ...base, shape: 'triangle' });
    expect(box.outer).toContain('left: 10.0000%');
    expect(box.outer).toContain('width: 40.0000%');
    expect(box.inner).not.toContain('left:');
  });
});
