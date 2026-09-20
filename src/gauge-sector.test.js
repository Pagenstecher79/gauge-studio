import { describe, it, expect } from 'vitest';
import { sectorSweep, sectorAt, sectorRadii, percentFromDeg, nearestPercent,
         sectorRadiusPatch, sectorAnglePatch, sectorSlidePatch, arcPath, bandPath,
         SECTOR_DEFAULTS, SECTOR_MIN_LENGTH } from './gauge-sector.js';

const FULL = { start: -90, total: 360 };
const SEMI = { start: 135, total: 270 };

describe('sectorSweep', () => {
  it('reads a semicircle as the renderer does, start angle or none', () => {
    expect(sectorSweep({ gauge_type: 'semi' })).toEqual(SEMI);
    expect(sectorSweep({ gauge_type: 'semi', gauge_start_angle: 40 })).toEqual(SEMI);
  });

  it('starts a full dial at the top when the card says nothing', () => {
    expect(sectorSweep({})).toEqual(FULL);
    expect(sectorSweep(undefined)).toEqual(FULL);
    expect(sectorSweep({ gauge_start_angle: '30' })).toEqual({ start: 30, total: 360 });
  });

  it('falls back to the top on anything unreadable', () => {
    for (const bad of [null, '', 'x', undefined, NaN]) {
      expect(sectorSweep({ gauge_start_angle: bad }).start).toBe(-90);
    }
  });
});

describe('sectorAt', () => {
  it('lays the default sector on the last quarter of a full dial', () => {
    expect(sectorAt({}, FULL)).toEqual({ a0: 180, a1: 270 });
  });

  it('measures a semicircle along its own 270 degrees', () => {
    const { a0, a1 } = sectorAt({ start_percent: 0, length_percent: 50 }, SEMI);
    expect([a0, a1]).toEqual([135, 270]);
  });
});

describe('sectorRadii', () => {
  it('multiplies both by the gauge scale', () => {
    expect(sectorRadii({ inner_radius: 10, outer_radius: 20 }, 0.5))
      .toEqual({ inner: 5, outer: 10 });
  });

  it('answers the defaults for a sector that says nothing', () => {
    expect(sectorRadii({}, 1))
      .toEqual({ inner: SECTOR_DEFAULTS.inner_radius, outer: SECTOR_DEFAULTS.outer_radius });
  });
});

describe('percentFromDeg', () => {
  it('reads the two ends and the middle of a full dial', () => {
    expect(percentFromDeg(-90, FULL)).toBe(0);
    expect(percentFromDeg(90, FULL)).toBe(50);
    expect(percentFromDeg(0, FULL)).toBe(25);
  });

  it('keeps the last hundredth of a circle reachable', () => {
    expect(percentFromDeg(-94, FULL)).toBeCloseTo(98.888, 2);
  });

  it('answers the nearer end out in a semicircle dead space', () => {
    expect(percentFromDeg(50, SEMI)).toBe(100);
    expect(percentFromDeg(100, SEMI)).toBe(0);
  });
});

describe('nearestPercent', () => {
  it('leaves a reading that is already the nearest one alone', () => {
    expect(nearestPercent(40, 45)).toBe(40);
  });

  it('reads just short of nought as just short of a hundred', () => {
    expect(nearestPercent(1, 98)).toBe(101);
    expect(nearestPercent(99, 2)).toBe(-1);
  });
});

describe('sectorRadiusPatch', () => {
  const sec = { inner_radius: 12, outer_radius: 22 };

  it('writes the radius the hand reached, in the gauge\'s own units', () => {
    expect(sectorRadiusPatch('outer', 15, sec, 0.5)).toEqual({ outer_radius: 30 });
    expect(sectorRadiusPatch('inner', 5, sec, 0.5)).toEqual({ inner_radius: 10 });
  });

  it('never lets either edge cross the other', () => {
    expect(sectorRadiusPatch('inner', 40, sec, 1)).toEqual({ inner_radius: 22 });
    expect(sectorRadiusPatch('outer', 3, sec, 1)).toEqual({ outer_radius: 12 });
  });

  it('stops where the form\'s own sliders stop', () => {
    expect(sectorRadiusPatch('outer', 400, sec, 1)).toEqual({ outer_radius: 50 });
    expect(sectorRadiusPatch('inner', -8, sec, 1)).toEqual({ inner_radius: 0 });
  });

  it('rounds to the tenth the fields step in', () => {
    expect(sectorRadiusPatch('outer', 23.4567, sec, 1)).toEqual({ outer_radius: 23.5 });
  });
});

describe('sectorAnglePatch', () => {
  const sec = { start_percent: 40, length_percent: 20 };

  it('holds the far end still while the start moves', () => {
    const p = sectorAnglePatch('start', percentAsDeg(30), sec, FULL);
    expect(p).toEqual({ start_percent: 30, length_percent: 30 });
  });

  it('lengthens from the end without moving the start', () => {
    expect(sectorAnglePatch('end', percentAsDeg(80), sec, FULL))
      .toEqual({ length_percent: 40 });
  });

  it('will not let the start pass the end', () => {
    const p = sectorAnglePatch('start', percentAsDeg(90), sec, FULL);
    expect(p.start_percent).toBe(60 - SECTOR_MIN_LENGTH);
    expect(p.length_percent).toBe(SECTOR_MIN_LENGTH);
  });

  it('will not let the end pass the start', () => {
    expect(sectorAnglePatch('end', percentAsDeg(10), sec, FULL).length_percent)
      .toBe(SECTOR_MIN_LENGTH);
  });

  it('reads an end dragged past the top as the far side rather than round the dial', () => {
    const wrapping = { start_percent: 90, length_percent: 8 };
    expect(sectorAnglePatch('end', percentAsDeg(2), wrapping, FULL).length_percent)
      .toBe(12);
  });
});

describe('sectorSlidePatch', () => {
  const sec = { start_percent: 40, length_percent: 20 };

  it('carries the sector round by the travel, not to the pointer', () => {
    expect(sectorSlidePatch(percentAsDeg(60), percentAsDeg(50), 40, sec, FULL))
      .toEqual({ start_percent: 50 });
  });

  it('keeps the whole sector on the scale', () => {
    expect(sectorSlidePatch(percentAsDeg(45), percentAsDeg(0), 40, sec, FULL))
      .toEqual({ start_percent: 80 });
    expect(sectorSlidePatch(percentAsDeg(0), percentAsDeg(45), 40, sec, FULL))
      .toEqual({ start_percent: 0 });
  });

  it('never shortens what it moves', () => {
    const p = sectorSlidePatch(percentAsDeg(70), percentAsDeg(10), 40, sec, FULL);
    expect(p.length_percent).toBeUndefined();
  });

  it('measures the travel the short way round the dial', () => {
    // Two degrees anticlockwise of nought is two degrees, not 358 of them.
    expect(sectorSlidePatch(-92, -90, 40, sec, FULL).start_percent).toBe(39.4);
  });
});

describe('arcPath', () => {
  it('draws one arc and closes nothing', () => {
    const d = arcPath(25, 25, 10, 0, 90);
    expect(d.startsWith('M35.000,25.000 A10.000,10.000,0,0,1,25.000,35.000')).toBe(true);
    expect(d.includes('Z')).toBe(false);
  });

  it('sets the large-arc flag past a half turn and not before', () => {
    expect(arcPath(0, 0, 1, 0, 200)).toContain(',0,1,1,');
    expect(arcPath(0, 0, 1, 0, 100)).toContain(',0,0,1,');
  });

  it('turns the other way for a sector drawn backwards', () => {
    expect(arcPath(0, 0, 1, 0, -100)).toContain(',0,0,0,');
  });

  it('never closes a full circle onto itself', () => {
    expect(arcPath(0, 0, 1, 0, 360)).not.toContain('NaN');
  });
});

describe('bandPath', () => {
  it('goes out along one arc and back along the other, and closes', () => {
    const d = bandPath(0, 0, 1, 2, 0, 90);
    expect(d).toBe('M2.000,0.000 A2.000,2.000,0,0,1,0.000,2.000 '
                 + 'L0.000,1.000 A1.000,1.000,0,0,0,1.000,0.000 Z');
  });

  it('turns both arcs the other way for a sector drawn backwards', () => {
    const d = bandPath(0, 0, 1, 2, 0, -90);
    expect(d).toContain('A2.000,2.000,0,0,0,');
    expect(d).toContain('A1.000,1.000,0,0,1,');
  });

  it('never draws a whole turn onto its own start', () => {
    expect(bandPath(0, 0, 1, 2, 0, 400)).not.toContain('NaN');
  });
});

/** A per cent of the default full dial, as the angle the hand would be at. */
function percentAsDeg(pct) {
  return FULL.start + pct / 100 * FULL.total;
}
