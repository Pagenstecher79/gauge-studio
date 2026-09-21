import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  lensField, lensScaleFraction, lensFilterMarkup, lensGeometry, applyLensGeometry,
  bevelShift, BEVEL_MAX_SLOPE, iorBody, iorDispersion, MAX_IOR,
} from './glass-lens.js';

/** The map is square; this reads one pixel out of it. */
const at = (field, size, i, j) => {
  const k = (i + j * size) * 4;
  return { r: field[k], g: field[k + 1], b: field[k + 2], a: field[k + 3] };
};

describe('lensField', () => {
  const SIZE = 64;

  it('leaves the middle of a pane alone, so what is under it stays readable', () => {
    const f = lensField('dome', SIZE);
    const mid = at(f, SIZE, SIZE / 2, SIZE / 2);
    expect(Math.abs(mid.r - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(mid.g - 128)).toBeLessThanOrEqual(1);
  });

  it('points the shift inward, which is what magnifies', () => {
    // A pixel near the left rim has to fetch its backdrop from further right.
    const f = lensField('dome', SIZE);
    expect(at(f, SIZE, 0, SIZE / 2).r).toBeGreaterThan(200);
    expect(at(f, SIZE, SIZE - 1, SIZE / 2).r).toBeLessThan(56);
    expect(at(f, SIZE, SIZE / 2, 0).g).toBeGreaterThan(200);
    expect(at(f, SIZE, SIZE / 2, SIZE - 1).g).toBeLessThan(56);
  });

  it('rises late, the way a thick rim does', () => {
    // Half way out, a sixth power is still almost nothing.
    const f = lensField('dome', SIZE);
    const quarter = at(f, SIZE, SIZE / 4, SIZE / 2);
    expect(Math.abs(quarter.r - 128)).toBeLessThan(6);
  });

  it('keeps a disc flat inside its ring and bends it outside', () => {
    const f = lensField('disc', SIZE);
    expect(Math.abs(at(f, SIZE, SIZE / 2 + 4, SIZE / 2).r - 128)).toBeLessThanOrEqual(1);
    expect(at(f, SIZE, 1, SIZE / 2).r).toBeGreaterThan(180);
  });

  it('samples pixel centres, so the rim itself is in the map', () => {
    // Sampling corners instead would leave the strongest half-pixel unmapped.
    const f = lensField('dome', 2);
    expect(at(f, 2, 0, 0).r).toBeGreaterThan(128);
    expect(at(f, 2, 1, 1).r).toBeLessThan(128);
  });

  it('is opaque, and leaves blue out of it', () => {
    const f = lensField('dome', 8);
    for (let k = 0; k < 8 * 8; k++) {
      expect(f[k * 4 + 2]).toBe(0);
      expect(f[k * 4 + 3]).toBe(255);
    }
  });

  it('fills exactly the buffer it promises', () => {
    expect(lensField('dome', 16).length).toBe(16 * 16 * 4);
    expect(lensField('disc', 16).length).toBe(16 * 16 * 4);
  });

  it('falls back to the pane profile rather than throwing on a name it does not know', () => {
    expect(Array.from(lensField('nonsense', 8))).toEqual(Array.from(lensField('dome', 8)));
  });

  it('differs by profile', () => {
    expect(Array.from(lensField('dome', 16))).not.toEqual(Array.from(lensField('disc', 16)));
  });
});

describe('lensFilterMarkup', () => {
  it('is empty when there is nothing to bend', () => {
    expect(lensFilterMarkup('id', 'dome', 0, 'ha-card')).toBe('');
  });

  it('names a pseudo-element only where the pane is one', () => {
    // The filter itself cannot tell; whoever draws the pane can.
    expect(lensFilterMarkup('id', 'dome', 0.06, '.pill', '')).not.toContain('data-sc-lens-pseudo');
  });

  it('is empty where there is no canvas to draw the map on', () => {
    // Node has none. A filter referencing a map that failed to draw would
    // leave `backdrop-filter: url(#...)` pointing at nothing.
    expect(lensFilterMarkup('id', 'dome', 0.06, 'ha-card')).toBe('');
  });
});

describe('lensGeometry', () => {
  it('takes the share off the short side, so aspect ratio does not change the look', () => {
    expect(lensGeometry(0.12, 492, 69)).toEqual({ width: 492, height: 69, scale: 8.28 });
    expect(lensGeometry(0.12, 54, 54)).toEqual({ width: 54, height: 54, scale: 6.48 });
  });

  it('refuses a pane that has not been laid out', () => {
    for (const [w, h] of [[0, 10], [10, 0], [NaN, 10], [undefined, 10]]) {
      expect(lensGeometry(0.1, w, h)).toBeNull();
    }
  });

  it('pins the maps of a pill that declares its own shift, and leaves it declared', () => {
    expect(lensGeometry(0, 100, 20)).toEqual({ width: 100, height: 20, scale: null });
  });
});

describe('applyLensGeometry', () => {
  const fakeRoot = (selector, w, h, ks = [undefined]) => {
    const img = () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
    const images = [img(), img()];
    const pass = (k) => ({
      attrs: { scale: '0', ...(k === undefined ? {} : { 'data-sc-lens-k': String(k) }) },
      setAttribute(key, v) { this.attrs[key] = v; },
      getAttribute(key) { return this.attrs[key] ?? null; },
    });
    const passes = ks.map(pass);
    const disp = passes[0];
    const filter = {
      getAttribute: (k) => ({ 'data-sc-lens': '0.12', 'data-sc-lens-for': selector, 'data-sc-lens-pseudo': '::after' }[k] ?? null),
      querySelectorAll: (sel) => (sel === 'feDisplacementMap' ? passes : images),
      querySelector: () => disp,
    };
    const host = {};
    return {
      images, disp, passes, host,
      querySelectorAll: (sel) => (sel === 'filter[data-sc-lens-for]' ? [filter] : []),
      querySelector: (sel) => (sel === selector ? host : null),
    };
  };

  it('writes the measured pane onto the maps and the shift', () => {
    const root = fakeRoot('ha-card', 200, 80);
    applyLensGeometry(root, () => ({ width: '200px', height: '80px' }));
    expect(root.images[0].attrs).toEqual({ x: '0', y: '0', width: '200', height: '80' });
    expect(root.disp.attrs.scale).toBe('9.6');
  });

  it('measures the pane, not the element it sits on', () => {
    const root = fakeRoot('ha-card', 0, 0);
    const seen = [];
    applyLensGeometry(root, (el, pseudo) => { seen.push(pseudo); return { width: '10px', height: '10px' }; });
    expect(seen).toEqual(['::after']);
  });

  it('leaves a pane alone that has no box yet', () => {
    const root = fakeRoot('ha-card', 0, 0);
    applyLensGeometry(root, () => ({ width: 'auto', height: 'auto' }));
    expect(root.disp.attrs.scale).toBe('0');
  });

  it('survives a root with nothing in it', () => {
    expect(() => applyLensGeometry(null)).not.toThrow();
    expect(() => applyLensGeometry({})).not.toThrow();
  });
});

describe('bevelShift', () => {
  it('runs from nothing to everything', () => {
    expect(bevelShift(0)).toBe(0);
    expect(bevelShift(1)).toBe(1);
  });

  it('spends its strength at the rim, not across the pane', () => {
    // This is the whole difference from the linear ramp it replaced: half way
    // across the bevel a quarter-round has barely turned, and the last tenth
    // carries more than the first half does.
    expect(bevelShift(0.5)).toBeLessThan(0.5);
    expect(bevelShift(0.9)).toBeGreaterThan(0.9);
    expect(bevelShift(0.9) - bevelShift(0.8))
      .toBeGreaterThan(bevelShift(0.5) - bevelShift(0));
  });

  it('never goes backwards', () => {
    for (let u = 0; u < 1; u += 0.01) {
      expect(bevelShift(u + 0.01)).toBeGreaterThanOrEqual(bevelShift(u));
    }
  });

  it('saturates where the face is steeper than the map can say', () => {
    const atMax = BEVEL_MAX_SLOPE / Math.sqrt(1 + BEVEL_MAX_SLOPE * BEVEL_MAX_SLOPE);
    expect(bevelShift(atMax)).toBeCloseTo(1, 6);
    expect(bevelShift(atMax + 0.001)).toBe(1);
  });

  it('holds still for the values a config can arrive with', () => {
    for (const v of [undefined, null, '', NaN, -1, 2, 'nonsense']) {
      const got = bevelShift(/** @type {any} */ (v));
      expect(got).toBeGreaterThanOrEqual(0);
      expect(got).toBeLessThanOrEqual(1);
    }
  });
});

describe('the direction a bevel faces', () => {
  const SIZE = 64;

  it('bends straight through the middle of an edge, not towards the centre', () => {
    // Two thirds of the way up the left edge, the old field tilted the shift
    // a third of the way into the vertical, and a straight line of backdrop
    // crossing that edge came through with a kink in it. A face that is flat
    // along the edge bends across it and nowhere else.
    const f = lensField('dome', SIZE);
    const up = at(f, SIZE, 0, 48);
    expect(up.r).toBeGreaterThan(240);
    expect(Math.abs(up.g - 128)).toBeLessThan(10);
  });

  it('bends diagonally in a corner, because a corner is where it turns', () => {
    const f = lensField('dome', SIZE);
    const c = at(f, SIZE, 0, 0);
    expect(c.r).toBeGreaterThan(190);
    expect(c.r).toBe(c.g);
  });

  it('reaches full deflection at the rim, so the strength slider means it', () => {
    const f = lensField('dome', SIZE);
    expect(at(f, SIZE, 0, SIZE / 2).r).toBe(255);
    expect(at(f, SIZE, SIZE - 1, SIZE / 2).r).toBeLessThan(2);
  });

  it('bends a disc along its radius', () => {
    const f = lensField('disc', SIZE);
    const diag = at(f, SIZE, 4, 4);
    expect(diag.r).toBe(diag.g);
    expect(diag.r).toBeGreaterThan(190);
  });
});


describe('the refractive index', () => {
  const SIZE = 64;

  it('is off at 1, and at anything that is not a number', () => {
    for (const v of [1, 0, undefined, null, '', 'n', NaN, -3]) {
      expect(iorBody(v)).toBe(0);
      expect(iorDispersion(v)).toBe(0);
    }
  });

  it('leaves the field byte for byte alone at 1', () => {
    expect(Array.from(lensField('dome', SIZE, iorBody(1))))
      .toEqual(Array.from(lensField('dome', SIZE)));
  });

  it('caps, so a hand-written config cannot make a marble of the pane', () => {
    expect(iorBody(9)).toBe(iorBody(MAX_IOR));
    expect(iorDispersion(9)).toBe(iorDispersion(MAX_IOR));
  });

  it('bends the body of the pane, where the bevel alone left it flat', () => {
    const flat = at(lensField('dome', SIZE), SIZE, 20, SIZE / 2);
    const thick = at(lensField('dome', SIZE, iorBody(2)), SIZE, 20, SIZE / 2);
    expect(Math.abs(flat.r - 128)).toBeLessThan(2);
    expect(thick.r - 128).toBeGreaterThan(20);
  });

  it('bends the body more towards the sides than in the middle', () => {
    const f = lensField('dome', SIZE, iorBody(2));
    const near = at(f, SIZE, SIZE / 2 - 4, SIZE / 2).r;
    const far = at(f, SIZE, 8, SIZE / 2).r;
    expect(far).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(128);
  });

  it('still saturates at the rim rather than wrapping round', () => {
    const f = lensField('dome', SIZE, iorBody(2));
    expect(at(f, SIZE, 0, SIZE / 2).r).toBe(255);
    expect(at(f, SIZE, SIZE - 1, SIZE / 2).r).toBeLessThan(2);
  });
});

/**
 * The markup needs a canvas to draw the map on, and there is none in Node.
 * The module is loaded again against a stub that answers with one, so the
 * empty maps the rest of this file gets are not what these tests see.
 */
describe('the filter the index writes', () => {
  /** @type {typeof import('./glass-lens.js')} */
  let lens;
  const markup = (ior) => lens.lensFilterMarkup('f', 'dome', 0.05, '.pane', undefined, ior === undefined ? undefined : { ior });

  beforeAll(async () => {
    globalThis.document = /** @type {any} */ ({
      createElement: () => ({
        getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }),
        toDataURL: () => 'data:image/png;base64,MAP',
      }),
    });
    vi.resetModules();
    lens = await import('./glass-lens.js');
  });
  afterAll(() => { delete globalThis.document; });

  it('draws one displacement pass at 1 and three above it', () => {
    expect(markup()).toBe(markup(1));
    expect(markup(1).match(/feDisplacementMap/g)).toHaveLength(1);
    expect(markup(2).match(/feDisplacementMap/g)).toHaveLength(3);
    expect(markup(2)).toContain('result="cRG"');
  });

  it('keeps every pass opaque, or premultiplied arithmetic eats the fringe', () => {
    expect(markup(2).match(/0 0 0 0 1"/g)).toHaveLength(3);
  });

  it('bends blue further than red, which is which way a prism goes', () => {
    const ks = [...markup(2).matchAll(/data-sc-lens-k="([\d.]+)"/g)].map(m => Number(m[1]));
    expect(ks).toEqual([1 - lens.iorDispersion(2), 1 + lens.iorDispersion(2)]);
  });

  it('draws a different map for a different index', () => {
    expect(markup(1)).not.toBe(markup(2));
  });
});
