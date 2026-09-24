import { describe, it, expect } from 'vitest';
import { cardLight, clampLightAngle, hasCardLight,
         LIGHT_ANGLE, LIGHT_DISTANCE, ARC_MIN, ARC_MAX } from './card-light.js';

describe('clampLightAngle', () => {
  it('leaves the arc alone', () => {
    for (const a of [0, 1, 45, 90, 135, 179, 180]) expect(clampLightAngle(a)).toBe(a);
  });

  it('stops the sun at the horizon it is nearer to', () => {
    expect(clampLightAngle(181)).toBe(ARC_MAX);
    expect(clampLightAngle(200)).toBe(ARC_MAX);
    expect(clampLightAngle(269)).toBe(ARC_MAX);
    expect(clampLightAngle(271)).toBe(ARC_MIN);
    expect(clampLightAngle(359)).toBe(ARC_MIN);
  });

  it('sends a light from straight below the way the angles count', () => {
    expect(clampLightAngle(270)).toBe(ARC_MIN);
  });

  it('folds a turn of the wheel back in first', () => {
    expect(clampLightAngle(450)).toBe(90);
    expect(clampLightAngle(-90)).toBe(ARC_MIN);
    expect(clampLightAngle(-270)).toBe(90);
  });

  it('never leaves the arc, whatever it is handed', () => {
    for (const v of [undefined, null, '', NaN, 'nonsense', Infinity, -Infinity, 1e9, -1e9]) {
      const a = clampLightAngle(/** @type {any} */ (v));
      expect(a).toBeGreaterThanOrEqual(ARC_MIN);
      expect(a).toBeLessThanOrEqual(ARC_MAX);
    }
  });
});

describe('cardLight', () => {
  it('falls back to the part while the card has no light', () => {
    const l = cardLight({}, { angle: 200, distance: 3 });
    expect(l).toEqual({ angle: 200, distance: 3, fromCard: false });
  });

  it('leaves a part\'s own angle off the arc, rather than turning it round', () => {
    expect(cardLight(undefined, { angle: 315 }).angle).toBe(315);
  });

  it('takes the card\'s light over the part\'s', () => {
    const l = cardLight({ light_angle: 30, light_distance: 2 }, { angle: 200, distance: 3 });
    expect(l).toEqual({ angle: 30, distance: 2, fromCard: true });
  });

  it('folds the card\'s own angle onto the arc', () => {
    expect(cardLight({ light_angle: 300 }).angle).toBe(ARC_MIN);
  });

  it('is a whole light as soon as either half of one is set', () => {
    expect(cardLight({ light_angle: 20 })).toEqual({ angle: 20, distance: LIGHT_DISTANCE, fromCard: true });
    expect(cardLight({ light_distance: 4 })).toEqual({ angle: LIGHT_ANGLE, distance: 4, fromCard: true });
  });

  it('reads a light of no distance as a light, not as none', () => {
    expect(cardLight({ light_distance: 0 })).toEqual({ angle: LIGHT_ANGLE, distance: 0, fromCard: true });
  });

  it('answers the sun overhead when nobody has said anything', () => {
    expect(cardLight(undefined)).toEqual({ angle: LIGHT_ANGLE, distance: LIGHT_DISTANCE, fromCard: false });
    expect(cardLight(null, {})).toEqual({ angle: LIGHT_ANGLE, distance: LIGHT_DISTANCE, fromCard: false });
  });

  it('ignores the adversarial values on both sides', () => {
    for (const v of [undefined, null, '', NaN, 'true', 'false', [], {}]) {
      const l = cardLight({ light_angle: v }, { angle: v, distance: v });
      expect(l.angle).toBe(LIGHT_ANGLE);
      expect(l.distance).toBe(LIGHT_DISTANCE);
    }
  });

  it('reads a numeric string, the way every other config value is read', () => {
    expect(cardLight({ light_angle: '45', light_distance: '2.5' }))
      .toEqual({ angle: 45, distance: 2.5, fromCard: true });
  });

  it('never hands back a distance below nothing', () => {
    expect(cardLight({ light_distance: -3 }).distance).toBe(0);
  });
});

describe('hasCardLight', () => {
  it('is what says whether a pattern still draws its own light', () => {
    expect(hasCardLight(undefined)).toBe(false);
    expect(hasCardLight({})).toBe(false);
    expect(hasCardLight({ light_angle: 90 })).toBe(true);
    expect(hasCardLight({ light_distance: 0 })).toBe(true);
  });
});
