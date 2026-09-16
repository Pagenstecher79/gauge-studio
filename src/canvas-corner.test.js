import { describe, it, expect } from 'vitest';
import { GRIP_CORNERS, MAX_PERCENT, radiusFromGrip, gripHome } from './canvas-corner.js';

const box = { left: 100, top: 200, width: 400, height: 200 };

describe('radiusFromGrip', () => {
  it('reads a straight diagonal pull as the radius it draws', () => {
    // From the bottom-left corner (100, 400), twenty in along each edge.
    expect(radiusFromGrip({ x: 120, y: 380 }, box, 'bl', 'px')).toBe(20);
    // And from the top-right corner (500, 200), the same twenty.
    expect(radiusFromGrip({ x: 480, y: 220 }, box, 'tr', 'px')).toBe(20);
  });

  it('still moves for a pull along one edge alone, by half', () => {
    expect(radiusFromGrip({ x: 120, y: 400 }, box, 'bl', 'px')).toBe(10);
    expect(radiusFromGrip({ x: 100, y: 380 }, box, 'bl', 'px')).toBe(10);
  });

  it('is nothing when the grip is pulled away from its corner', () => {
    expect(radiusFromGrip({ x: 40, y: 460 }, box, 'bl', 'px')).toBe(0);
    expect(radiusFromGrip({ x: 560, y: 140 }, box, 'tr', 'px')).toBe(0);
  });

  it('stops at half the short side, which is a full round end', () => {
    expect(radiusFromGrip({ x: 400, y: 210 }, box, 'bl', 'px')).toBe(100);
  });

  it('takes a percentage in its own terms, per axis', () => {
    // A tenth of the width across and a tenth of the height down is 10%.
    expect(radiusFromGrip({ x: 140, y: 380 }, box, 'bl', '%')).toBe(10);
    // Half the width across on its own is half of 50%.
    expect(radiusFromGrip({ x: 300, y: 400 }, box, 'bl', '%')).toBe(25);
  });

  it('stops a percentage at half the box', () => {
    expect(radiusFromGrip({ x: 300, y: 300 }, box, 'bl', '%')).toBe(MAX_PERCENT);
  });

  it('answers nothing for a corner nobody has, or a box with no size', () => {
    expect(radiusFromGrip({ x: 0, y: 0 }, box, 'br', 'px')).toBe(0);
    expect(radiusFromGrip({ x: 0, y: 0 }, { left: 0, top: 0, width: 0, height: 0 }, 'bl', 'px'))
      .toBe(0);
  });

  it('rounds to the tenth every corner-radius field offers', () => {
    expect(radiusFromGrip({ x: 100 + 7.77, y: 400 }, box, 'bl', 'px')).toBe(3.9);
  });
});

describe('gripHome', () => {
  it('puts the grip on the corner the radius drew, not on the box corner', () => {
    // Twenty pixels is 5% of a 400-wide box and 10% of a 200-tall one.
    expect(gripHome(20, box, 'bl', 'px')).toEqual({ l: 5, t: 90 });
    expect(gripHome(20, box, 'tr', 'px')).toEqual({ l: 95, t: 10 });
  });

  it('is the box corner for a radius of nothing', () => {
    expect(gripHome(0, box, 'bl', 'px')).toEqual({ l: 0, t: 100 });
    expect(gripHome(undefined, box, 'tr', 'px')).toEqual({ l: 100, t: 0 });
  });

  it('reads a percentage straight off, per axis', () => {
    expect(gripHome(25, box, 'bl', '%')).toEqual({ l: 25, t: 75 });
  });

  it('never leaves the half of the box that is its own', () => {
    expect(gripHome(9999, box, 'bl', 'px')).toEqual({ l: MAX_PERCENT, t: MAX_PERCENT });
  });

  it('comes back for every corner there is', () => {
    for (const corner of Object.keys(GRIP_CORNERS)) {
      const home = gripHome(10, box, corner, 'px');
      expect(Number.isFinite(home.l) && Number.isFinite(home.t)).toBe(true);
    }
  });
});

describe('the grip and where it comes to rest', () => {
  const square = { left: 0, top: 0, width: 300, height: 300 };

  it('lands exactly under the pointer for a percentage, on a box of any shape', () => {
    for (const corner of Object.keys(GRIP_CORNERS)) {
      const c = GRIP_CORNERS[corner];
      const at = { x: box.left + box.width * (c.x ? 0.88 : 0.12),
                   y: box.top + box.height * (c.y ? 0.88 : 0.12) };
      const home = gripHome(radiusFromGrip(at, box, corner, '%'), box, corner, '%');
      expect(home.l).toBeCloseTo(c.x ? 88 : 12, 1);
      expect(home.t).toBeCloseTo(c.y ? 88 : 12, 1);
    }
  });

  it('lands exactly under the pointer for pixels on a square box', () => {
    for (const corner of Object.keys(GRIP_CORNERS)) {
      const c = GRIP_CORNERS[corner];
      const at = { x: square.width * (c.x ? 0.88 : 0.12),
                   y: square.height * (c.y ? 0.88 : 0.12) };
      const home = gripHome(radiusFromGrip(at, square, corner, 'px'), square, corner, 'px');
      expect(home.l).toBeCloseTo(c.x ? 88 : 12, 1);
      expect(home.t).toBeCloseTo(c.y ? 88 : 12, 1);
    }
  });

  it('lands between the pointer\'s two axes for pixels on a box that is not square', () => {
    // A radius in pixels is a circle: it cannot be a tenth of a wide side and
    // a tenth of a narrow one at once, so the grip comes to rest on the mean
    // of the two. Twelve per cent of a 400-wide box is 48px and of a 200-tall
    // one is 24px, so the radius is 36 - which is 9% across and 18% down.
    const home = gripHome(radiusFromGrip({ x: 48, y: 400 - 24 },
                                         { left: 0, top: 200, width: 400, height: 200 },
                                         'bl', 'px'),
                          box, 'bl', 'px');
    expect(home).toEqual({ l: 9, t: 82 });
  });
});
