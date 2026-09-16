import { describe, it, expect } from 'vitest';
import { offsetsFromDrag, fontFromResize, estimateRect, clamp,
         ringRadius, ringPartRadius, offsetFromRadius,
         OFFSET_LIMIT, FONT_MAX, FONT_MIN, GAUGE_CENTER,
         needleEnds, needleFromRadius, needleSlide,
         ringInnerEdge, strokeFromRadius } from './gauge-inner-boxes.js';

describe('offsetsFromDrag', () => {
  it('turns pixels into viewBox units at the measured scale', () => {
    // 4 screen pixels to a viewBox unit, gauge drawn at its full size
    expect(offsetsFromDrag({ x: 0, y: 0 }, 40, -20, 4, 1)).toEqual({ x: 10, y: -5 });
  });

  it('moves twice as far in numbers when the gauge is drawn half size', () => {
    expect(offsetsFromDrag({ x: 0, y: 0 }, 40, 0, 4, 0.5).x).toBe(20);
  });

  it('adds to where the drag began', () => {
    expect(offsetsFromDrag({ x: -3, y: 2 }, 4, 4, 4, 1)).toEqual({ x: -2, y: 3 });
  });

  it('rounds to the tenth the sliders step in', () => {
    expect(offsetsFromDrag({ x: 0, y: 0 }, 1, 0, 3, 1).x).toBe(0.3);
  });

  it('stops where the sliders stop', () => {
    expect(offsetsFromDrag({ x: 20, y: -20 }, 400, -400, 4, 1))
      .toEqual({ x: OFFSET_LIMIT, y: -OFFSET_LIMIT });
  });

  it('survives a scale or a measurement of zero', () => {
    expect(offsetsFromDrag({ x: 1, y: 1 }, 0, 0, 0, 0)).toEqual({ x: 1, y: 1 });
  });
});

describe('fontFromResize', () => {
  it('reads the frame\'s height as the size', () => {
    expect(fontFromResize(8, 8, 4, 1)).toBe(10);
  });

  it('is measured against the gauge\'s own scale', () => {
    expect(fontFromResize(8, 8, 4, 0.5)).toBe(12);
  });

  it('keeps a size the editor would accept', () => {
    expect(fontFromResize(19, 200, 4, 1)).toBe(FONT_MAX);
    expect(fontFromResize(1, -200, 4, 1)).toBe(FONT_MIN);
  });
});

describe('estimateRect', () => {
  it('centres the box on the offset from the gauge\'s centre', () => {
    const r = estimateRect({ x: 0, y: 0, size: 10, chars: 1 }, 1);
    expect(r.x + r.w / 2).toBeCloseTo(GAUGE_CENTER);
    expect(r.y + r.h / 2).toBeCloseTo(GAUGE_CENTER);
    expect(r.h).toBe(10);
  });

  it('grows with the text it stands for', () => {
    const one = estimateRect({ x: 0, y: 0, size: 10, chars: 1 }, 1);
    const five = estimateRect({ x: 0, y: 0, size: 10, chars: 5 }, 1);
    expect(five.w).toBeGreaterThan(one.w);
  });

  it('follows the offsets, scaled the way the gauge draws them', () => {
    const r = estimateRect({ x: 4, y: -4, size: 10, chars: 1 }, 0.5);
    expect(r.x + r.w / 2).toBeCloseTo(GAUGE_CENTER + 2);
    expect(r.y + r.h / 2).toBeCloseTo(GAUGE_CENTER - 2);
  });
});

describe('clamp', () => {
  it('holds a value between its ends', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });
});

describe('the ring', () => {
  it('is the radius the gauge renderer draws on', () => {
    // The renderer's own expression, kept here so the two cannot drift: a
    // frame that is not on the ring is a frame that lies about where a part is.
    const stroke = 4, scale = 0.9;
    expect(ringRadius(stroke, scale)).toBeCloseTo((25 - stroke / 2 - 1) * scale);
  });

  it('shrinks with the gauge', () => {
    expect(ringRadius(4, 0.5)).toBeCloseTo(ringRadius(4, 1) / 2);
  });

  it('holds its ground when a gauge says nothing about itself', () => {
    expect(ringRadius(0, 1)).toBeCloseTo(24);
    expect(ringRadius(undefined, undefined)).toBeCloseTo(24);
  });

  it('puts a part inward for a negative offset and outward for a positive one', () => {
    const ring = ringRadius(4, 1);
    expect(ringPartRadius(ring, -5, 1)).toBeCloseTo(ring - 5);
    expect(ringPartRadius(ring, 5, 1)).toBeCloseTo(ring + 5);
    expect(ringPartRadius(ring, 0, 1)).toBeCloseTo(ring);
  });

  it('scales an offset the way the ring is scaled', () => {
    const ring = ringRadius(4, 0.5);
    expect(ringPartRadius(ring, -6, 0.5)).toBeCloseTo(ring - 3);
  });

  it('reads back the offset a radius was made from', () => {
    const ring = ringRadius(4, 0.9);
    for (const off of [-8, -2.5, 0, 3.4, 11]) {
      expect(offsetFromRadius(ring, ringPartRadius(ring, off, 0.9), 0.9)).toBeCloseTo(off);
    }
  });

  it('rounds to the tenth the fields step in', () => {
    const ring = ringRadius(4, 1);
    expect(offsetFromRadius(ring, ring + 2.04, 1)).toBe(2);
    expect(offsetFromRadius(ring, ring + 2.06, 1)).toBe(2.1);
  });

  it('will not write a number past what the sliders allow', () => {
    const ring = ringRadius(4, 1);
    expect(offsetFromRadius(ring, ring + 500, 1, 15)).toBe(15);
    expect(offsetFromRadius(ring, ring - 500, 1, 15)).toBe(-15);
  });
});

describe('the needle', () => {
  it('puts the tail a length back from the tip', () => {
    const e = needleEnds(2, 10, 20, 1);
    expect(e.tip).toBe(18);
    expect(e.tail).toBe(8);
  });

  it('lets a long needle put its tail past the pivot', () => {
    expect(needleEnds(2, 25, 20, 1).tail).toBe(-7);
  });

  it('scales both ends with the gauge', () => {
    const e = needleEnds(2, 10, 18, 0.9);
    expect(e.tip).toBeCloseTo(16.2, 6);
    expect(e.tail).toBeCloseTo(7.2, 6);
  });

  it('reads a dragged tail back as a length, tip untouched', () => {
    expect(needleFromRadius('tail', 8, 2, 10, 20, 1)).toEqual({ pointer_length: 10 });
    expect(needleFromRadius('tail', 4, 2, 10, 20, 1)).toEqual({ pointer_length: 14 });
  });

  it('keeps counting when the tail is dragged through the pivot', () => {
    expect(needleFromRadius('tail', -6, 2, 10, 20, 1)).toEqual({ pointer_length: 24 });
  });

  it('holds the tail still when the tip is dragged', () => {
    const p = needleFromRadius('tip', 22, 2, 10, 20, 1);
    expect(p.pointer_offset).toBe(-2);
    expect(p.pointer_length).toBe(14);
    expect(needleEnds(p.pointer_offset, p.pointer_length, 20, 1).tail).toBe(8);
  });

  it('never writes a length its own slider would refuse', () => {
    expect(needleFromRadius('tail', 999, 2, 10, 20, 1).pointer_length).toBe(0);
    expect(needleFromRadius('tail', -999, 2, 10, 20, 1).pointer_length).toBe(50);
    expect(needleFromRadius('tip', -999, 2, 10, 20, 1).pointer_offset).toBe(10);
    expect(needleFromRadius('tip', 999, 2, 10, 20, 1).pointer_offset).toBe(-10);
  });

  it('rounds to the tenth the sliders step in', () => {
    expect(needleFromRadius('tail', 3.33, 2, 10, 20, 0.9).pointer_length).toBe(16.5);
  });
});

describe('the ring thickness', () => {
  it('grows inward from an outer edge that stands still', () => {
    expect(ringInnerEdge(3, 1)).toBe(21);
    expect(ringInnerEdge(5, 1)).toBe(19);
    expect(ringRadius(3, 1) + 3 / 2).toBe(24);
    expect(ringRadius(5, 1) + 5 / 2).toBe(24);
  });

  it('scales with the gauge', () => {
    expect(ringInnerEdge(3, 0.9)).toBeCloseTo(18.9, 6);
  });

  it('reads an edge back as the thickness that drew it', () => {
    expect(strokeFromRadius(21, 1)).toBe(3);
    expect(strokeFromRadius(18.9, 0.9)).toBe(3);
  });

  it('never writes a thickness its own slider would refuse', () => {
    expect(strokeFromRadius(-99, 1)).toBe(5);
    expect(strokeFromRadius(99, 1)).toBe(0);
  });
});

describe('needleSlide', () => {
  it('moves the offset by how far the grab travelled, not to where it landed', () => {
    // Grabbed at 15, dragged out to 18: three units further out, wherever on
    // the line the hand happened to take hold of it.
    expect(needleSlide(18, 15, 2, 1)).toEqual({ pointer_offset: -1 });
    // The same three units, grabbed somewhere else entirely.
    expect(needleSlide(8, 5, 2, 1)).toEqual({ pointer_offset: -1 });
  });

  it('pulls the offset up when the needle is pushed inward', () => {
    expect(needleSlide(12, 15, 2, 1)).toEqual({ pointer_offset: 5 });
  });

  it('stands still for a grab that has not moved', () => {
    expect(needleSlide(15, 15, 2, 1)).toEqual({ pointer_offset: 2 });
  });

  it('changes the number twice as fast on a gauge drawn half size', () => {
    expect(needleSlide(18, 15, 2, 0.5)).toEqual({ pointer_offset: -4 });
  });

  it('keeps the needle as long as it was', () => {
    const ring = 20, scale = 1;
    const was = needleEnds(2, 10, ring, scale);
    const p = needleSlide(18, 15, 2, scale);
    const now = needleEnds(p.pointer_offset, 10, ring, scale);
    expect(now.tip - now.tail).toBeCloseTo(was.tip - was.tail, 6);
    expect(now.tip).toBeCloseTo(was.tip + 3, 6);
  });

  it('never writes an offset its own slider would refuse', () => {
    expect(needleSlide(999, 0, 2, 1).pointer_offset).toBe(-10);
    expect(needleSlide(-999, 0, 2, 1).pointer_offset).toBe(10);
  });
});
