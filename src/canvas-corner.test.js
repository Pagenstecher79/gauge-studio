import { describe, it, expect } from 'vitest';
import { GRIP_CORNERS, MAX_PERCENT, radiusFromGrip, gripHome } from './canvas-corner.js';

// 400 across, 200 down, so the two axes are told apart by the numbers alone.
const box = { left: 100, top: 200, width: 400, height: 200 };

describe('radiusFromGrip', () => {
  it('reads how far the grip has come along its own edge', () => {
    // The bottom-left grip runs right along the bottom, from x = 100.
    expect(radiusFromGrip({ x: 120, y: 400 }, box, 'bl', 'px')).toBe(20);
    // The top-right grip runs down the right-hand side, from y = 200.
    expect(radiusFromGrip({ x: 500, y: 230 }, box, 'tr', 'px')).toBe(30);
  });

  it('ignores the axis its edge does not run along', () => {
    // Off the bottom edge entirely, but the same distance along it.
    expect(radiusFromGrip({ x: 120, y: 260 }, box, 'bl', 'px')).toBe(20);
    expect(radiusFromGrip({ x: 180, y: 230 }, box, 'tr', 'px')).toBe(30);
  });

  it('is nothing when the grip is pushed back past its corner', () => {
    expect(radiusFromGrip({ x: 40, y: 400 }, box, 'bl', 'px')).toBe(0);
    expect(radiusFromGrip({ x: 500, y: 140 }, box, 'tr', 'px')).toBe(0);
  });

  it('stops at half the short side, which is a full round end', () => {
    // The short side is the 200 down, so 100 whichever edge is being used.
    expect(radiusFromGrip({ x: 460, y: 400 }, box, 'bl', 'px')).toBe(100);
    expect(radiusFromGrip({ x: 500, y: 390 }, box, 'tr', 'px')).toBe(100);
  });

  it('takes a percentage of the side its own edge is', () => {
    // A tenth of the way along the 400-wide bottom edge.
    expect(radiusFromGrip({ x: 140, y: 400 }, box, 'bl', '%')).toBe(10);
    // A tenth of the way down the 200-tall right edge is 20px, not 40.
    expect(radiusFromGrip({ x: 500, y: 220 }, box, 'tr', '%')).toBe(10);
  });

  it('stops a percentage at half the box', () => {
    expect(radiusFromGrip({ x: 420, y: 400 }, box, 'bl', '%')).toBe(MAX_PERCENT);
  });

  it('answers nothing for a corner nobody has, or a box with no size', () => {
    expect(radiusFromGrip({ x: 0, y: 0 }, box, 'br', 'px')).toBe(0);
    expect(radiusFromGrip({ x: 0, y: 0 }, { left: 0, top: 0, width: 0, height: 0 }, 'bl', 'px'))
      .toBe(0);
  });

  it('rounds to the tenth every corner-radius field offers', () => {
    expect(radiusFromGrip({ x: 100 + 7.77, y: 400 }, box, 'bl', 'px')).toBe(7.8);
  });
});

describe('gripHome', () => {
  it('stands on its own edge, at the point the radius reaches', () => {
    // 20px along a 400-wide bottom edge is 5% across, and the bottom is 100%.
    expect(gripHome(20, box, 'bl', 'px')).toEqual({ l: 5, t: 100 });
    // 20px down a 200-tall right edge is 10% down, and the right is 100%.
    expect(gripHome(20, box, 'tr', 'px')).toEqual({ l: 100, t: 10 });
  });

  it('is the corner itself for a radius of nothing', () => {
    expect(gripHome(0, box, 'bl', 'px')).toEqual({ l: 0, t: 100 });
    expect(gripHome(undefined, box, 'tr', 'px')).toEqual({ l: 100, t: 0 });
  });

  it('reads a percentage straight off its own axis', () => {
    expect(gripHome(25, box, 'bl', '%')).toEqual({ l: 25, t: 100 });
    expect(gripHome(25, box, 'tr', '%')).toEqual({ l: 100, t: 25 });
  });

  it('never leaves the half of the edge that is its own', () => {
    expect(gripHome(9999, box, 'bl', 'px')).toEqual({ l: MAX_PERCENT, t: 100 });
    expect(gripHome(9999, box, 'tr', 'px')).toEqual({ l: 100, t: MAX_PERCENT });
  });

  it('never leaves the edge it runs along', () => {
    for (const [corner, c] of Object.entries(GRIP_CORNERS)) {
      for (const r of [0, 3, 40, 500]) {
        const home = gripHome(r, box, corner, 'px');
        // The axis it does not run along is pinned to its own corner's side.
        if (c.axis === 'x') expect(home.t).toBe(c.y * 100);
        else expect(home.l).toBe(c.x * 100);
      }
    }
  });
});

describe('the grip comes to rest where it was let go', () => {
  it('reads back exactly, on either edge and in either unit', () => {
    for (const unit of ['px', '%']) {
      for (const [corner, c] of Object.entries(GRIP_CORNERS)) {
        const along = c.axis === 'x';
        // A point a fifth of the way along that grip's own edge.
        const at = { x: box.left + box.width * (along ? (c.x ? 0.8 : 0.2) : c.x),
                     y: box.top + box.height * (along ? c.y : (c.y ? 0.8 : 0.2)) };
        const home = gripHome(radiusFromGrip(at, box, corner, unit), box, corner, unit);
        expect(along ? home.l : home.t).toBeCloseTo(20, 1);
      }
    }
  });
});
