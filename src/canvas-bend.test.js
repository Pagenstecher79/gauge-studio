import { describe, it, expect } from 'vitest';
import {
  BEND_SIDES, MAX_BEND, BEND_ROOM, bendKey, bendAtKey, BEND_AT_MID,
  BEND_AT_EDGE, bendsOf, isBent, bendEscapes,
  bendClipPath, bendGripHome, bendFromGrip, BEND_FLAT_SNAP,
  BEND_FLAT_SNAP_MAX, bendOutlineSvg, bentBox, bendReach,
} from './canvas-bend.js';

/** A deliberately non-square box, so an axis mix-up cannot pass. */
const box = { left: 100, top: 200, width: 400, height: 200 };
const flat = { top: 0, right: 0, bottom: 0, left: 0 };
/** The same, in the shape `bendsOf` answers in. */
const mid = (/** @type {number} */ bow) => ({ bow, at: BEND_AT_MID });
const flatRec = { top: mid(0), right: mid(0), bottom: mid(0), left: mid(0) };

describe('bendsOf', () => {
  it('reads every side, and nothing else', () => {
    expect(bendsOf({ bend_top: 10, bend_left: -5, border_radius: 30 }))
      .toEqual({ ...flatRec, top: mid(10), left: mid(-5) });
  });

  it('treats what is not a number as flat, with its crest in the middle', () => {
    expect(bendsOf({ bend_top: '', bend_right: null, bend_bottom: 'x' }))
      .toEqual(flatRec);
  });

  it('takes a number written as text', () => {
    expect(bendsOf({ bend_right: '12.5' }).right).toEqual(mid(12.5));
  });

  it('reads where the crest of each side stands', () => {
    expect(bendsOf({ bend_top: 10, bend_top_at: 20 }).top).toEqual({ bow: 10, at: 20 });
  });

  it('clamps what a hand-edited config might carry', () => {
    expect(bendsOf({ bend_top: 999, bend_bottom: -999 }))
      .toMatchObject({ top: mid(MAX_BEND), bottom: mid(-MAX_BEND) });
    expect(bendsOf({ bend_top_at: 0, bend_left_at: 1000 })).toMatchObject({
      top: { bow: 0, at: BEND_AT_EDGE }, left: { bow: 0, at: 100 - BEND_AT_EDGE } });
  });

  it('names its keys the way the config does', () => {
    expect(bendKey('bottom')).toBe('bend_bottom');
    expect(bendAtKey('bottom')).toBe('bend_bottom_at');
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
  /** The depth alone, which is what most of these are about. */
  const bow = (/** @type {any} */ at, /** @type {any} */ b, /** @type {string} */ side) =>
    bendFromGrip(at, b || box, side).bow;

  it('reads nothing from a grip left on its side', () => {
    expect(bendFromGrip({ x: 300, y: 200 }, box, 'top')).toEqual(mid(0));
    expect(bendFromGrip({ x: 500, y: 300 }, box, 'right')).toEqual(mid(0));
  });

  it('reads a pull outward as a positive bend, per axis', () => {
    // 40px above a 200px-tall box is a fifth of it.
    expect(bow({ x: 300, y: 160 }, box, 'top')).toBe(20);
    // 40px right of a 400px-wide box is a tenth of it.
    expect(bow({ x: 540, y: 300 }, box, 'right')).toBe(10);
  });

  it('reads a push inward as a negative one', () => {
    expect(bow({ x: 300, y: 240 }, box, 'top')).toBe(-20);
    expect(bow({ x: 140, y: 300 }, box, 'left')).toBe(-10);
  });

  it('reads how far along the side the grip was let go as the crest', () => {
    // A quarter of the way across a box 400 wide, and the same point read
    // from the other end for a side that runs the other way.
    expect(bendFromGrip({ x: 200, y: 160 }, box, 'top')).toEqual({ bow: 20, at: 25 });
    expect(bendFromGrip({ x: 200, y: 440 }, box, 'bottom')).toEqual({ bow: 20, at: 75 });
    expect(bendFromGrip({ x: 540, y: 250 }, box, 'right')).toEqual({ bow: 10, at: 25 });
    expect(bendFromGrip({ x: 60, y: 250 }, box, 'left')).toEqual({ bow: 10, at: 75 });
  });

  it('keeps the depth whatever the crest is doing', () => {
    expect(bow({ x: 110, y: 160 }, box, 'top')).toBe(bow({ x: 490, y: 160 }, box, 'top'));
  });

  it('keeps the crest off the corners, where a bow would be nothing', () => {
    expect(bendFromGrip({ x: -9999, y: 160 }, box, 'top').at).toBe(BEND_AT_EDGE);
    expect(bendFromGrip({ x: 9999, y: 160 }, box, 'top').at).toBe(100 - BEND_AT_EDGE);
  });

  it('puts the crest of a side let go flat back in the middle', () => {
    // Nothing to be the crest of, so nothing is written about where it is.
    expect(bendFromGrip({ x: 110, y: 200 }, box, 'top')).toEqual(mid(0));
  });

  it('stops at the most a side may bow', () => {
    expect(bow({ x: 300, y: -9999 }, box, 'top')).toBe(MAX_BEND);
    expect(bow({ x: 300, y: 9999 }, box, 'top')).toBe(-MAX_BEND);
  });

  it('puts a side let go near flat exactly flat', () => {
    expect(bow({ x: 300, y: 200 - BEND_FLAT_SNAP }, box, 'top')).toBe(0);
    expect(bow({ x: 300, y: 200 + BEND_FLAT_SNAP }, box, 'top')).toBe(0);
    // And a hair outside it is still the bend it asks for: three pixels of a
    // 200px-tall box is one and a half per cent.
    expect(bow({ x: 300, y: 197 }, box, 'top')).toBe(1.5);
  });

  it('puts a crest let go near the middle exactly in the middle', () => {
    // The same window, read along the side instead of across it.
    expect(bendFromGrip({ x: 300 + BEND_FLAT_SNAP - 0.5, y: 160 }, box, 'top').at)
      .toBe(BEND_AT_MID);
    expect(bendFromGrip({ x: 300 + BEND_FLAT_SNAP + 1, y: 160 }, box, 'top').at)
      .not.toBe(BEND_AT_MID);
  });

  it('reaches the same few pixels on every side of a box of any shape', () => {
    // The whole point of counting in pixels: this box is twice as wide as it
    // is tall, and a hand two pixels off the edge means flat on all four.
    for (const side of Object.keys(BEND_SIDES)) {
      const s = BEND_SIDES[side];
      const across = s.axis === 'x' ? box.width : box.height;
      const edge = s.axis === 'x'
        ? (s.out > 0 ? box.left + box.width : box.left)
        : (s.out > 0 ? box.top + box.height : box.top);
      const at = (/** @type {number} */ away) => {
        const p = { x: 300, y: 300 };
        p[s.axis] = edge + away;
        return p;
      };
      for (const away of [-BEND_FLAT_SNAP, 0, BEND_FLAT_SNAP])
        expect(bow(at(away), box, side)).toBe(0);
      // A pixel further out and the side answers the hand again, with the
      // bow those pixels are worth on this axis.
      for (const away of [-(BEND_FLAT_SNAP + 1), BEND_FLAT_SNAP + 1])
        expect(Math.abs(bow(at(away), box, side)))
          .toBeCloseTo((BEND_FLAT_SNAP + 1) / across * 100, 0.9);
    }
  });

  it('catches a hand already flat rather than pulling one towards it', () => {
    for (const side of Object.keys(BEND_SIDES)) {
      for (const want of [-MAX_BEND, -20, -3, 3, 20, MAX_BEND]) {
        const home = bendGripHome(want, side);
        const at = { x: box.left + home.l / 100 * box.width,
                     y: box.top + home.t / 100 * box.height };
        expect(bendFromGrip(at, box, side)).toEqual(mid(want));
      }
    }
  });

  it('never lets the window be more than a sliver of a small box', () => {
    // 20px across, so the per cent is the smaller of the two and the window
    // is 0.3px rather than the 2px a hand would otherwise get.
    const tiny = { left: 0, top: 0, width: 20, height: 20 };
    expect(bow({ x: 10, y: -1 }, tiny, 'top')).toBe(5);
    expect(bow({ x: 10, y: -0.2 }, tiny, 'top')).toBe(0);
    expect(tiny.height * BEND_FLAT_SNAP_MAX / 100).toBeLessThan(BEND_FLAT_SNAP);
  });

  it('answers zero for a box that has not been laid out', () => {
    expect(bendFromGrip({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 0 }, 'top'))
      .toEqual(mid(0));
    expect(bendFromGrip({ x: 1, y: 1 }, box, 'nowhere')).toEqual(mid(0));
  });

  it('is the exact inverse of where the grip stands, on every side', () => {
    for (const side of Object.keys(BEND_SIDES)) {
      for (const bend of [-40, -12.5, 0, 7.5, MAX_BEND]) {
        for (const crest of [BEND_AT_MID, 20, 80]) {
          const home = bendGripHome({ bow: bend, at: crest }, side);
          const at = { x: box.left + home.l / 100 * box.width,
                       y: box.top + home.t / 100 * box.height };
          // A side with no bow has no crest to put back.
          expect(bendFromGrip(at, box, side))
            .toEqual(bend ? { bow: bend, at: crest } : mid(0));
        }
      }
    }
  });
});

describe('bentBox', () => {
  const box = { x: 10, y: 20, w: 40, h: 20 };

  it('leaves a flat box exactly as it is', () => {
    expect(bentBox(box, flat)).toEqual(box);
  });

  it('grows a side by that per cent of the box across it', () => {
    // The top is a fifth of a 20-unit height; the right a tenth of a 40-unit
    // width - the same per-axis reading the polygon gets.
    expect(bentBox(box, { ...flat, top: 20, right: 10 }))
      .toEqual({ x: 10, y: 16, w: 44, h: 24 });
  });

  it('counts nothing for a side pulled inward', () => {
    expect(bentBox(box, { ...flat, top: -45, left: -45 })).toEqual(box);
  });

  it('reaches furthest on every side at once', () => {
    const all = { top: MAX_BEND, right: MAX_BEND, bottom: MAX_BEND, left: MAX_BEND };
    expect(bentBox(box, all)).toEqual({ x: -8, y: 11, w: 76, h: 38 });
    expect(bendReach(all)).toEqual({ top: 0.45, right: 0.45, bottom: 0.45, left: 0.45 });
  });

  it('never reaches past the room the paint layer is given', () => {
    const grown = bentBox(box, { top: MAX_BEND, right: MAX_BEND,
                                 bottom: MAX_BEND, left: MAX_BEND });
    expect(grown.x).toBeGreaterThanOrEqual(box.x - BEND_ROOM / 100 * box.w);
    expect(grown.y).toBeGreaterThanOrEqual(box.y - BEND_ROOM / 100 * box.h);
  });
});

describe('bendOutlineSvg', () => {
  it('is nothing at all for a flat box', () => {
    expect(bendOutlineSvg(flat)).toBe(null);
  });

  it('names the same points the clip path cuts along', () => {
    const bends = { ...flat, top: 20, left: -10 };
    const pts = bendOutlineSvg(bends).split(' ').map(p => p.split(',').join('% ') + '%');
    expect(bendClipPath(bends)).toBe('polygon(' + pts.join(', ') + ')');
  });
});
