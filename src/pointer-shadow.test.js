import { describe, it, expect } from 'vitest';
import { needleLift, shadowRoom, liftFromLegacy, DARKEST, DROP_PER_WIDTH,
         MAX_HEIGHT, MAX_DIFFUSION } from './pointer-shadow.js';

const W = 17;
const lift = (o) => needleLift({ width: W, ...o });
const dist = (l) => Math.hypot(l.drop.dx, l.drop.dy);

/** Every combination the two sliders can produce. */
const all = [];
for (let h = 0; h <= 1.0001; h += 0.1) {
  for (let d = 0; d <= 1.0001; d += 0.1) all.push({ height: h, diffusion: d });
}

describe('shadowRoom', () => {
  it('is full where the caller cannot say', () => {
    expect(shadowRoom(null)).toBe(1);
    expect(shadowRoom(undefined)).toBe(1);
    expect(shadowRoom(/** @type {any} */ ([0, 0]))).toBe(1);
  });

  it('runs from none on black to all on white', () => {
    expect(shadowRoom([0, 0, 0])).toBe(0);
    expect(shadowRoom([255, 255, 255])).toBeCloseTo(1, 5);
  });

  it('is perceptual, so a mid grey is near the middle', () => {
    const mid = shadowRoom([119, 119, 119]);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });

  it('leaves a dark dashboard almost nothing to show', () => {
    expect(shadowRoom([28, 28, 30])).toBeLessThan(0.15);
  });
});

describe('the envelope', () => {
  it('never throws the shadow further than a needle width', () => {
    for (const o of all) expect(dist(lift(o))).toBeLessThanOrEqual(W * DROP_PER_WIDTH + 1e-9);
  });

  it('never darkens past a needle lying on its dial under a hard light', () => {
    for (const o of all) expect(lift(o).drop.opacity).toBeLessThanOrEqual(DARKEST + 1e-9);
  });

  it('keeps every opacity a real opacity', () => {
    for (const o of all) {
      const l = lift(o);
      for (const v of [l.drop.opacity, l.contact.opacity, l.rim.opacity]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('holds when the sliders are driven past their ends or fed rubbish', () => {
    const wild = [{ height: 9, diffusion: 9 }, { height: -4, diffusion: -4 },
                  { height: NaN, diffusion: NaN },
                  { height: /** @type {any} */ ('x'), diffusion: /** @type {any} */ (null) }];
    for (const o of wild) {
      const l = lift(o);
      expect(dist(l)).toBeLessThanOrEqual(W * DROP_PER_WIDTH + 1e-9);
      expect(l.drop.opacity).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(l.drop.blur)).toBe(true);
      expect(Number.isFinite(l.rim.opacity)).toBe(true);
    }
  });

  it('draws nothing at all from a needle with no width', () => {
    const l = needleLift({ height: 1, diffusion: 0.5, width: 0 });
    expect(dist(l)).toBe(0);
    expect(l.drop.blur).toBe(0);
    expect(Math.abs(l.rim.dx)).toBe(0);
  });
});

describe('height', () => {
  it('is what moves the shadow out', () => {
    let last = -1;
    for (let h = 0; h <= 1.0001; h += 0.1) {
      const d = dist(lift({ height: h }));
      expect(d).toBeGreaterThan(last);
      last = d;
    }
  });

  it('lightens the core as it spreads it - the pair that used to be free', () => {
    const low = lift({ height: 0.1 });
    const high = lift({ height: 1 });
    expect(high.drop.blur).toBeGreaterThan(low.drop.blur);
    expect(high.drop.opacity).toBeLessThan(low.drop.opacity);
  });

  it('trades the contact dark for the cast shadow', () => {
    expect(lift({ height: 0 }).contact.opacity)
      .toBeGreaterThan(lift({ height: 1 }).contact.opacity);
  });

  it('is the only thing that lights the rim', () => {
    expect(lift({ height: 0 }).rim.opacity).toBe(0);
    expect(lift({ height: 1 }).rim.opacity).toBeGreaterThan(0);
  });

  it('puts the rim on the lit side, opposite the shadow', () => {
    const l = lift({ height: 1, angle: 90 });
    expect(l.drop.dy).toBeGreaterThan(0);
    expect(l.rim.dy).toBeLessThan(0);
  });
});

describe('diffusion', () => {
  it('softens and lightens, and pulls the shadow back underneath', () => {
    const hard = lift({ height: 1, diffusion: 0 });
    const soft = lift({ height: 1, diffusion: 1 });
    expect(soft.drop.blur).toBeGreaterThan(hard.drop.blur);
    expect(soft.drop.opacity).toBeLessThan(hard.drop.opacity);
    expect(dist(soft)).toBeLessThan(dist(hard));
  });

  it('takes the bright edge away, soft light having none to give', () => {
    expect(lift({ height: 1, diffusion: 1 }).rim.opacity)
      .toBeLessThan(lift({ height: 1, diffusion: 0 }).rim.opacity);
  });
});

describe('the backdrop', () => {
  const dark = /** @type {[number,number,number]} */ ([18, 18, 20]);
  const light = /** @type {[number,number,number]} */ ([245, 245, 245]);

  it('takes the cast shadow away where there is no light to block', () => {
    const onDark = lift({ height: 0.6, backdrop: dark });
    const onLight = lift({ height: 0.6, backdrop: light });
    expect(onDark.drop.opacity).toBeLessThan(onLight.drop.opacity * 0.25);
  });

  it('hands what the shadow cannot say to the lit edge instead', () => {
    expect(lift({ height: 0.6, backdrop: dark }).rim.opacity)
      .toBeGreaterThan(lift({ height: 0.6, backdrop: light }).rim.opacity);
  });

  it('leaves the contact dark alone, it being sheen and not light', () => {
    expect(lift({ height: 0.6, backdrop: dark }).contact.opacity)
      .toBe(lift({ height: 0.6, backdrop: light }).contact.opacity);
  });

  it('still says something about height on pure black', () => {
    const l = lift({ height: 1, backdrop: [0, 0, 0] });
    expect(l.drop.opacity).toBe(0);
    expect(l.rim.opacity).toBeGreaterThan(0.1);
  });
});

describe('the needle width', () => {
  it('is what every length is measured in, so two widths read alike', () => {
    const thin = needleLift({ height: 0.7, diffusion: 0.3, width: 4 });
    const fat = needleLift({ height: 0.7, diffusion: 0.3, width: 20 });
    expect(dist(fat) / dist(thin)).toBeCloseTo(5, 6);
    expect(fat.drop.blur / thin.drop.blur).toBeCloseTo(5, 6);
    expect(fat.drop.opacity).toBeCloseTo(thin.drop.opacity, 12);
  });
});

describe('the two ends', () => {
  it('names them, so a slider cannot be given a wider range by accident', () => {
    expect(MAX_HEIGHT).toBe(1);
    expect(MAX_DIFFUSION).toBe(1);
  });
});

describe('liftFromLegacy', () => {
  it('answers the height that reproduces the old offset', () => {
    const h = liftFromLegacy({ distance: W * DROP_PER_WIDTH * 0.4, width: W });
    expect(h).toBeCloseTo(0.4, 10);
    expect(dist(lift({ height: h }))).toBeCloseTo(W * DROP_PER_WIDTH * 0.4, 10);
  });

  it('reads a shadow thrown the other way as the same height', () => {
    expect(liftFromLegacy({ distance: -2, width: W }))
      .toBe(liftFromLegacy({ distance: 2, width: W }));
  });

  it('never leaves the slider\'s range', () => {
    expect(liftFromLegacy({ distance: 5, width: 1 })).toBe(MAX_HEIGHT);
    expect(liftFromLegacy({ distance: 0, width: W })).toBe(0);
  });

  it('answers nothing where there is nothing to read', () => {
    for (const v of [undefined, null, '', NaN, 'true', 'false', [], {}]) {
      expect(liftFromLegacy({ distance: /** @type {any} */ (v), width: W })).toBe(0);
      expect(liftFromLegacy({ distance: 1, width: /** @type {any} */ (v) })).toBe(0);
    }
  });

  it('reads a numeric string, which is what a text field commits', () => {
    expect(liftFromLegacy({ distance: '2', width: W }))
      .toBe(liftFromLegacy({ distance: 2, width: W }));
  });
});

describe('the card light\'s distance', () => {
  it('is 1 by default, so a card that never set one draws what it drew', () => {
    expect(lift({ height: 0.5 })).toEqual(lift({ height: 0.5, distance: 1 }));
  });

  it('throws the shadow further, in proportion', () => {
    const near = lift({ height: 0.5, distance: 1 });
    const far = lift({ height: 0.5, distance: 3 });
    expect(dist(far)).toBeCloseTo(dist(near) * 3, 10);
  });

  it('at nothing puts the shadow straight under the needle', () => {
    const l = lift({ height: 0.5, distance: 0 });
    expect(dist(l)).toBe(0);
    expect(l.drop.opacity).toBeGreaterThan(0);
  });

  it('moves neither the lit edge nor the blur, which are the needle\'s own', () => {
    const near = lift({ height: 0.6, distance: 1 });
    const far = lift({ height: 0.6, distance: 4 });
    expect(far.rim).toEqual(near.rim);
    expect(far.drop.blur).toBe(near.drop.blur);
    expect(far.contact).toEqual(near.contact);
  });

  it('reads a value that is no distance at all as the default', () => {
    for (const v of [undefined, NaN, -1, Infinity]) {
      expect(dist(lift({ height: 0.5, distance: /** @type {any} */ (v) })))
        .toBeCloseTo(dist(lift({ height: 0.5 })), 10);
    }
  });
});
