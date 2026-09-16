import { describe, it, expect } from 'vitest';
import { offsetsFromDrag, fontFromResize, estimateRect, clamp,
         ringRadius, ringPartRadius, offsetFromRadius,
         gaugeOuter, frameBand, gaugeScaleOf, migrateGaugeScale,
         OFFSET_LIMIT, FONT_MAX, FONT_MIN, GAUGE_CENTER,
         needleEnds, needleFromRadius, needleSlide, NEEDLE_CENTRE_SNAP,
         ringInnerEdge, strokeFromRadius, alignParts,
         frameInnerEdge, scaleFromRadius, frameWidthFromRadius,
         FRAME_WIDTH_MAX, GAUGE_SCALE_MIN } from './gauge-inner-boxes.js';

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
    expect(ringRadius(stroke, scale)).toBeCloseTo(25 * scale - stroke / 2);
  });

  it('gives the frame ring its room out of the gauge, not beside it', () => {
    // The whole point: a wider frame eats into the dial rather than reaching
    // past the edge of the box.
    expect(ringRadius(3, 1, 0)).toBeCloseTo(23.5);
    expect(ringRadius(3, 1, 6)).toBeCloseTo(17.5);
    expect(25 * 1).toBeGreaterThanOrEqual(ringRadius(3, 1, 6) + 3 / 2 + 6);
  });

  it('shrinks with the gauge', () => {
    expect(gaugeOuter(0.5)).toBeCloseTo(gaugeOuter(1) / 2);
  });

  it('holds its ground when a gauge says nothing about itself', () => {
    expect(ringRadius(0, 1)).toBeCloseTo(25);
    expect(ringRadius(undefined, undefined)).toBeCloseTo(25);
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

  it('rests the tail on the pivot from either side of it', () => {
    // The tip is at 18, so a tail exactly on the pivot is a length of 18.
    for (const at of [NEEDLE_CENTRE_SNAP, 0, -NEEDLE_CENTRE_SNAP]) {
      expect(needleFromRadius('tail', at, 2, 10, 20, 1)).toEqual({ pointer_length: 18 });
    }
  });

  it('lets the tail through the pivot rather than sticking on it', () => {
    const past = NEEDLE_CENTRE_SNAP + 0.5;
    expect(needleFromRadius('tail', -past, 2, 10, 20, 1).pointer_length).toBe(18 + past);
    expect(needleFromRadius('tail', past, 2, 10, 20, 1).pointer_length).toBe(18 - past);
  });

  it('lands the tail on the pivot when the length is not a tenth', () => {
    // A stroke of 0.5 puts the ring on 24.75, which is not a tenth. The rest
    // is meant literally, so this is the one drag written finer.
    const ring = ringRadius(0.5, 1);
    const p = needleFromRadius('tail', 0.2, 0, 10, ring, 1);
    expect(p.pointer_length).toBe(24.75);
    expect(needleEnds(0, p.pointer_length, ring, 1).tail).toBe(0);
  });

  it('keeps the tenth for every length that is not the rest', () => {
    const ring = ringRadius(0.5, 1);
    const p = needleFromRadius('tail', 2, 0, 10, ring, 1);
    expect(p.pointer_length).toBe(22.8);
  });

  it('measures the rest in what is drawn, not in what is written', () => {
    // Half the scale draws the same needle half the size, so the same reach
    // around the pivot is twice as many of the pointer's own units.
    const p = needleFromRadius('tail', NEEDLE_CENTRE_SNAP, 2, 10, 20, 0.5);
    expect(needleEnds(2, p.pointer_length, 20, 0.5).tail).toBe(0);
  });

  it('gives the tip no rest of its own - it has a ring to line up against', () => {
    // The tip cannot reach the pivot anyway, its offset being the smaller
    // field, so what is asserted here is that it lands where it was let go.
    for (const at of [14, 14 + NEEDLE_CENTRE_SNAP, 14 - NEEDLE_CENTRE_SNAP]) {
      const p = needleFromRadius('tip', at, 2, 10, 20, 1);
      expect(needleEnds(p.pointer_offset, p.pointer_length, 20, 1).tip).toBe(at);
    }
  });
});

describe('the ring thickness', () => {
  it('grows inward from an outer edge that stands still', () => {
    expect(ringInnerEdge(3, 1)).toBe(22);
    expect(ringInnerEdge(5, 1)).toBe(20);
    expect(ringRadius(3, 1) + 3 / 2).toBe(25);
    expect(ringRadius(5, 1) + 5 / 2).toBe(25);
  });

  it('scales with the gauge', () => {
    expect(ringInnerEdge(3, 0.9)).toBeCloseTo(25 * 0.9 - 3, 6);
  });

  it('reads an edge back as the thickness that drew it', () => {
    expect(strokeFromRadius(22, 1)).toBe(3);
    expect(strokeFromRadius(25 * 0.9 - 3, 0.9)).toBe(3);
    expect(strokeFromRadius(ringInnerEdge(3, 1, 6), 1, 6)).toBe(3);
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

describe('alignParts', () => {
  const item = (name, box, from, per = 10) => ({
    keys: { x: `${name}_offset_x`, y: `${name}_offset_y` }, box, from, per,
  });

  it('moves every box to the leftmost one’s left edge', () => {
    const out = alignParts([
      item('value', { l: 100, t: 0, w: 40, h: 10 }, { x: 0, y: 0 }),
      item('label', { l: 130, t: 0, w: 20, h: 10 }, { x: 3, y: 0 }),
    ], 'left');
    // 30px back at 10px per unit is three units off the label's own offset.
    expect(out).toEqual({ label_offset_x: 0 });
  });

  it('lines the right-hand edges up, which is not the same as the offsets', () => {
    const out = alignParts([
      item('value', { l: 100, t: 0, w: 40, h: 10 }, { x: 0, y: 0 }),
      item('label', { l: 100, t: 0, w: 20, h: 10 }, { x: 0, y: 0 }),
    ], 'right');
    expect(out).toEqual({ label_offset_x: 2 });
  });

  it('leaves the outermost part where it is', () => {
    const out = alignParts([
      item('value', { l: 100, t: 0, w: 40, h: 10 }, { x: 0, y: 0 }),
      item('label', { l: 160, t: 0, w: 20, h: 10 }, { x: 6, y: 0 }),
    ], 'left');
    expect(out).not.toHaveProperty('value_offset_x');
  });

  it('works down the other axis, baseline or no baseline', () => {
    // The value's offset is a baseline and the label's is a middle; the
    // travel is the same question for both.
    const out = alignParts([
      item('value', { l: 0, t: 50, w: 10, h: 10 }, { x: 0, y: 20 }),
      item('label', { l: 0, t: 90, w: 10, h: 10 }, { x: 0, y: 10 }),
    ], 'top');
    expect(out).toEqual({ label_offset_y: 6 });
  });

  it('reads the gauge’s own scale through `per`', () => {
    const out = alignParts([
      item('value', { l: 100, t: 0, w: 10, h: 10 }, { x: 0, y: 0 }, 5),
      item('label', { l: 120, t: 0, w: 10, h: 10 }, { x: 4, y: 0 }, 5),
    ], 'left');
    expect(out).toEqual({ label_offset_x: 0 });
  });

  it('writes nothing when everything already lines up', () => {
    expect(alignParts([
      item('value', { l: 100, t: 0, w: 10, h: 10 }, { x: 0, y: 0 }),
      item('label', { l: 100, t: 0, w: 10, h: 10 }, { x: 2, y: 0 }),
    ], 'left')).toBe(null);
  });

  it('needs two parts, and an edge it knows', () => {
    const one = [item('value', { l: 0, t: 0, w: 10, h: 10 }, { x: 0, y: 0 })];
    expect(alignParts(one, 'left')).toBe(null);
    expect(alignParts([...one, item('label', { l: 40, t: 0, w: 10, h: 10 }, { x: 0, y: 0 })],
                      /** @type {any} */ ('hcenter'))).toBe(null);
  });

  it('never places a part past the offset limit', () => {
    const out = alignParts([
      item('value', { l: 0, t: 0, w: 10, h: 10 }, { x: 0, y: 0 }),
      item('label', { l: 1000, t: 0, w: 10, h: 10 }, { x: 0, y: 0 }),
    ], 'left');
    expect(out.label_offset_x).toBe(-25);
  });
});


describe('what gauge_scale means', () => {
  it('is the gauge\'s reach, so a frame ring cannot push past the box', () => {
    const cfg = { gauge_scale: 1, stroke_width: 3, scale_from_outer: true,
                  frame_ring_active: true, frame_ring_width: 8, frame_ring_gap: 1.5 };
    const s = gaugeScaleOf(cfg);
    const band = frameBand(cfg, s);
    expect(ringRadius(3, s, band) + 3 / 2 + band).toBeCloseTo(gaugeOuter(s));
    expect(gaugeOuter(s)).toBeLessThanOrEqual(25);
  });

  it('shrinks the dial when the frame is widened', () => {
    const thin = { gauge_scale: 1, stroke_width: 3, scale_from_outer: true,
                   frame_ring_active: true, frame_ring_width: 1.5, frame_ring_gap: 1.5 };
    const fat = { ...thin, frame_ring_width: 6 };
    const r = (c) => ringRadius(3, gaugeScaleOf(c), frameBand(c, gaugeScaleOf(c)));
    expect(r(fat)).toBeLessThan(r(thin));
  });

  it('takes nothing off for a frame ring that is switched off', () => {
    expect(frameBand({ frame_ring_width: 8, frame_ring_gap: 4 }, 1)).toBe(0);
    expect(frameBand(null, 1)).toBe(0);
  });
});

describe('a card written against the older reading', () => {
  const old = (stroke, scale) => (25 - stroke / 2 - 1) * scale;

  it('keeps the room it took, to the unit', () => {
    for (const cfg of [{ gauge_scale: 0.9, stroke_width: 3 },
                       { gauge_scale: 0.5, stroke_width: 5 },
                       { gauge_scale: 1, stroke_width: 0 }]) {
      const wasOuter = (25 - cfg.stroke_width / 2 - 1) * cfg.gauge_scale + cfg.stroke_width / 2;
      expect(gaugeOuter(gaugeScaleOf(cfg))).toBeCloseTo(wasOuter, 6);
    }
  });

  it('draws a framed gauge\'s value ring exactly where it was', () => {
    // The frame band is scaled too, so a migration that only divided the old
    // outer reach by 25 widened the band and pulled the ring inwards.
    for (const cfg of [{ gauge_scale: 0.8, stroke_width: 3, frame_ring_active: true,
                         frame_ring_width: 1.5, frame_ring_gap: 1.5 },
                       { gauge_scale: 0.6, stroke_width: 4, frame_ring_active: true,
                         frame_ring_width: 4, frame_ring_gap: 2 }]) {
      const s = gaugeScaleOf(cfg);
      expect(ringRadius(cfg.stroke_width, s, frameBand(cfg, s)))
        .toBeCloseTo(old(cfg.stroke_width, cfg.gauge_scale), 6);
    }
  });

  it('keeps the dial where it was when no frame ring is on', () => {
    const cfg = { gauge_scale: 0.9, stroke_width: 3 };
    expect(ringRadius(3, gaugeScaleOf(cfg))).toBeCloseTo(old(3, 0.9), 6);
  });

  it('is clamped to the edge where it used to reach outside', () => {
    const cfg = { gauge_scale: 0.9, stroke_width: 3, frame_ring_active: true,
                  frame_ring_width: 5, frame_ring_gap: 1.5 };
    expect(gaugeScaleOf(cfg)).toBe(1);
    const band = frameBand(cfg, 1);
    expect(ringRadius(3, 1, band) + 1.5 + band).toBeCloseTo(25);
  });

  it('is left alone once the card says which reading it means', () => {
    expect(migrateGaugeScale({ gauge_scale: 0.7, scale_from_outer: true })).toBe(null);
    expect(gaugeScaleOf({ gauge_scale: 0.7, scale_from_outer: true })).toBe(0.7);
  });

  it('answers the template default for a card that says nothing at all', () => {
    expect(gaugeScaleOf({ scale_from_outer: true })).toBe(0.9);
  });
});

describe("the frame ring's two edges", () => {
  const framed = (w) => ({ frame_ring_active: true, frame_ring_width: w, frame_ring_gap: 1.5 });

  it('puts the outside where the gauge reaches to, whatever the frame is', () => {
    for (const w of [0, 1.5, 8]) expect(gaugeOuter(1)).toBe(25);
    expect(frameInnerEdge(framed(1.5), 1)).toBe(23.5);
    expect(frameInnerEdge(framed(8), 1)).toBe(17);
  });

  it('has no width to speak of while no frame is drawn', () => {
    // Both edges are the same circle then, which is what lets the editor
    // draw one ghost band instead of two handles nobody can tell apart.
    expect(frameInnerEdge({ frame_ring_width: 4 }, 1)).toBe(gaugeOuter(1));
  });

  it('measures the inside in the gauge\'s own units, not the screen\'s', () => {
    // A gauge at half size draws a 4-wide frame 2 units wide, so an edge two
    // units in from the outside is a width of 4 and not of 2.
    expect(frameWidthFromRadius(gaugeOuter(0.5) - 2, 0.5)).toEqual({ frame_ring_width: 4 });
  });

  it('says which reading it means every time it writes a scale', () => {
    expect(scaleFromRadius(20)).toEqual({ gauge_scale: 0.8, scale_from_outer: true });
  });

  it('cannot be dragged out of the card or down to nothing', () => {
    expect(scaleFromRadius(40).gauge_scale).toBe(1);
    expect(scaleFromRadius(0).gauge_scale).toBe(GAUGE_SCALE_MIN);
    expect(frameWidthFromRadius(-50, 1).frame_ring_width).toBe(FRAME_WIDTH_MAX);
    expect(frameWidthFromRadius(30, 1).frame_ring_width).toBe(0);
  });

  it('widens the frame by exactly what the hand covered', () => {
    // The two edges are each other's arithmetic: putting the inner edge where
    // a width would draw it gives that width back.
    for (const w of [0.4, 1.5, 6]) {
      for (const s of [1, 0.8, 0.5]) {
        expect(frameWidthFromRadius(frameInnerEdge(framed(w), s), s))
          .toEqual({ frame_ring_width: w });
      }
    }
  });
});
