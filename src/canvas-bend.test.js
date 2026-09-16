import { describe, it, expect } from 'vitest';
import {
  BEND_SIDES, MAX_BEND, BEND_ROOM, bendKey, bendsOf, isBent, bendEscapes,
  bendClipPath, bendGripHome, bendFromGrip,
} from './canvas-bend.js';

/** A deliberately non-square box, so an axis mix-up cannot pass. */
const box = { left: 100, top: 200, width: 400, height: 200 };
const flat = { top: 0, right: 0, bottom: 0, left: 0 };

describe('bendsOf', () => {
  it('reads every side, and nothing else', () => {
    expect(bendsOf({ bend_top: 10, bend_left: -5, border_radius: 30 }))
      .toEqual({ top: 10, right: 0, bottom: 0, left: -5 });
  });

  it('treats what is not a number as flat', () => {
    expect(bendsOf({ bend_top: '', bend_right: null, bend_bottom: 'x' }))
      .toEqual(flat);
  });

  it('takes a number written as text', () => {
    expect(bendsOf({ bend_right: '12.5' }).right).toBe(12.5);
  });

  it('clamps what a hand-edited config might carry', () => {
    expect(bendsOf({ bend_top: 999, bend_bottom: -999 }))
      .toMatchObject({ top: MAX_BEND, bottom: -MAX_BEND });
  });

  it('names its keys the way the config does', () => {
    expect(bendKey('bottom')).toBe('bend_bottom');
  });
});

describe('isBent / bendEscapes', () => {
  it('a flat box is neither', () => {
    expect(isBent(flat)).toBe(false);
    expect(bendEscapes(flat)).toBe(false);
  });

  it('a waist is bent but stays inside', () => {
    const bends = { ...flat, left: -20 };
    expect(isBent(bends)).toBe(true);
    expect(bendEscapes(bends)).toBe(false);
  });

  it('a bow outward has to be let out', () => {
    expect(bendEscapes({ ...flat, top: 1 })).toBe(true);
  });
});

describe('bendClipPath', () => {
  it('gives a flat box no clip path at all', () => {
    expect(bendClipPath(flat)).toBe(null);
  });

  it('draws one point per step per side', () => {
    const pts = bendClipPath({ ...flat, top: 20 }).slice(8, -1).split(', ');
    expect(pts).toHaveLength(32);
  });

  it('puts the box corners at the room inset, with room left over', () => {
    const path = bendClipPath({ ...flat, top: 20 }, 50);
    // 50% of room each side makes the layer twice the box, so the box's own
    // top-left corner is a quarter of the way in.
    expect(path.startsWith('polygon(25% 25%,')).toBe(true);
  });

  it('bows the top outward, which is upward, past the box edge', () => {
    const path = bendClipPath({ ...flat, top: 40 }, BEND_ROOM);
    const mid = path.slice(8, -1).split(', ')[4];
    const y = parseFloat(mid.split(' ')[1]);
    const corner = parseFloat(path.slice(8).split(' ')[1]);
    expect(y).toBeLessThan(corner);
  });

  it('bows the top inward the other way', () => {
    const out = bendClipPath({ ...flat, top: 40 }).slice(8, -1).split(', ')[4];
    const inn = bendClipPath({ ...flat, top: -40 }).slice(8, -1).split(', ')[4];
    expect(parseFloat(inn.split(' ')[1]))
      .toBeGreaterThan(parseFloat(out.split(' ')[1]));
  });

  it('leaves the corners alone however hard a side is bent', () => {
    const a = bendClipPath({ ...flat, top: MAX_BEND }).slice(8).split(',')[0];
    const b = bendClipPath({ ...flat, bottom: -MAX_BEND }).slice(8).split(',')[0];
    expect(a).toBe(b);
  });

  it('bends each side on its own axis', () => {
    // The left side runs fourth, so its middle is point 28. A bow there has
    // to move x and leave y exactly where the straight run put it.
    const bent = bendClipPath({ ...flat, left: 30 }).slice(8, -1).split(', ');
    const straight = bendClipPath({ ...flat, top: 30 }).slice(8, -1).split(', ');
    expect(bent[28].split(' ')[0]).not.toBe(straight[28].split(' ')[0]);
    expect(bent[28].split(' ')[1]).toBe(straight[28].split(' ')[1]);
  });
});

describe('bendGripHome', () => {
  it('sits on the middle of a side that is not bent', () => {
    expect(bendGripHome(0, 'top')).toEqual({ l: 50, t: 0 });
    expect(bendGripHome(0, 'right')).toEqual({ l: 100, t: 50 });
    expect(bendGripHome(0, 'bottom')).toEqual({ l: 50, t: 100 });
    expect(bendGripHome(0, 'left')).toEqual({ l: 0, t: 50 });
  });

  it('rides out with the bow it set', () => {
    expect(bendGripHome(20, 'top')).toEqual({ l: 50, t: -20 });
    expect(bendGripHome(20, 'right')).toEqual({ l: 120, t: 50 });
    expect(bendGripHome(-20, 'bottom')).toEqual({ l: 50, t: 80 });
    expect(bendGripHome(20, 'left')).toEqual({ l: -20, t: 50 });
  });

  it('answers for a side it does not know rather than throwing', () => {
    expect(bendGripHome(0, 'nowhere')).toEqual({ l: 50, t: 0 });
  });
});

describe('bendFromGrip', () => {
  it('reads nothing from a grip left on its side', () => {
    expect(bendFromGrip({ x: 300, y: 200 }, box, 'top')).toBe(0);
    expect(bendFromGrip({ x: 500, y: 300 }, box, 'right')).toBe(0);
  });

  it('reads a pull outward as a positive bend, per axis', () => {
    // 40px above a 200px-tall box is a fifth of it.
    expect(bendFromGrip({ x: 300, y: 160 }, box, 'top')).toBe(20);
    // 40px right of a 400px-wide box is a tenth of it.
    expect(bendFromGrip({ x: 540, y: 300 }, box, 'right')).toBe(10);
  });

  it('reads a push inward as a negative one', () => {
    expect(bendFromGrip({ x: 300, y: 240 }, box, 'top')).toBe(-20);
    expect(bendFromGrip({ x: 140, y: 300 }, box, 'left')).toBe(-10);
  });

  it('ignores how far along the side the grip was let go', () => {
    expect(bendFromGrip({ x: 110, y: 160 }, box, 'top'))
      .toBe(bendFromGrip({ x: 490, y: 160 }, box, 'top'));
  });

  it('stops at the most a side may bow', () => {
    expect(bendFromGrip({ x: 300, y: -9999 }, box, 'top')).toBe(MAX_BEND);
    expect(bendFromGrip({ x: 300, y: 9999 }, box, 'top')).toBe(-MAX_BEND);
  });

  it('answers zero for a box that has not been laid out', () => {
    expect(bendFromGrip({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 0 }, 'top'))
      .toBe(0);
    expect(bendFromGrip({ x: 1, y: 1 }, box, 'nowhere')).toBe(0);
  });

  it('is the exact inverse of where the grip stands, on every side', () => {
    for (const side of Object.keys(BEND_SIDES)) {
      for (const bend of [-40, -12.5, 0, 7.5, MAX_BEND]) {
        const home = bendGripHome(bend, side);
        const at = { x: box.left + home.l / 100 * box.width,
                     y: box.top + home.t / 100 * box.height };
        expect(bendFromGrip(at, box, side)).toBe(bend);
      }
    }
  });
});
