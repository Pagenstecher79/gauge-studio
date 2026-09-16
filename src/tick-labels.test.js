import { describe, it, expect } from 'vitest';
import { autoStep, staggerRows, labelBox, boxReach,
         EM_WIDTH, LINE_HEIGHT, MIN_GAP } from './tick-labels.js';

/**
 * The demo's largest gauge, read off the running card: 23 ticks over a semi
 * dial, labels 300 to 2500 inside the ring at 2.375 units of type. A person
 * had already thinned it to every second tick by hand, which is the number
 * these rules have to arrive at on their own.
 */
const co2 = () => ({
  count: 23,
  startAngle: 135,
  totalAngle: 270,
  radius: 18.51,
  fontSize: 2.375,
  outward: false,
  texts: Array.from({ length: 23 }, (_, i) => String(300 + i * 100)),
});

describe('labelBox', () => {
  it('is as wide as its digits and a little taller than its type', () => {
    const b = labelBox('1300', 2);
    expect(b.w).toBeCloseTo(4 * EM_WIDTH * 2);
    expect(b.h).toBeCloseTo(2 * LINE_HEIGHT);
  });

  it('gives an empty label a box of one character', () => {
    expect(labelBox('', 2).w).toBeCloseTo(EM_WIDTH * 2);
  });
});

describe('autoStep', () => {
  it('reaches the interval a person chose for the same gauge', () => {
    expect(autoStep(co2())).toBe(2);
  });

  it('leaves a dial with room alone', () => {
    expect(autoStep({ ...co2(), count: 5, texts: ['0', '25', '50', '75', '100'] })).toBe(1);
  });

  it('thins further as the type grows', () => {
    const small = autoStep({ ...co2(), fontSize: 1.2 });
    const large = autoStep({ ...co2(), fontSize: 4 });
    expect(large).toBeGreaterThan(small);
  });

  it('thins further as the labels gain digits', () => {
    // A dial loose enough that the digits are what decides: at 23 ticks the
    // labels crowd down the sides whatever they say, and one character thins
    // as far as four.
    const loose = { ...co2(), count: 9, texts: Array.from({ length: 9 }, (_, i) => String(i)) };
    const wide = { ...loose, texts: Array.from({ length: 9 }, () => '12.345,6') };
    expect(autoStep(loose)).toBe(1);
    expect(autoStep(wide)).toBeGreaterThan(1);
  });

  it('counts the two ends of a full circle as neighbours', () => {
    const round = { ...co2(), totalAngle: 360, count: 8, fontSize: 3,
                    texts: ['1000', '2000', '3000', '4000', '5000', '6000', '7000', '8000'] };
    // With the ends apart the sides decide; with them together the pair that
    // meets at the top has to be counted too, so the answer cannot be smaller.
    expect(autoStep(round)).toBeGreaterThanOrEqual(autoStep({ ...round, totalAngle: 300 }));
  });

  it('answers something usable for a gauge whose labels never fit', () => {
    const step = autoStep({ ...co2(), fontSize: 30 });
    expect(step).toBeGreaterThan(1);
    expect(step).toBeLessThanOrEqual(23);
  });

  it('holds its ground on the degenerate cases', () => {
    expect(autoStep({ ...co2(), count: 0 })).toBe(1);
    expect(autoStep({ ...co2(), count: 1 })).toBe(1);
    expect(autoStep({ ...co2(), fontSize: 0 })).toBe(1);
  });
});

describe('staggerRows', () => {
  it('leaves a dial with room on one row', () => {
    const rows = staggerRows({ ...co2(), count: 5, texts: ['0', '25', '50', '75', '100'] }, 1);
    expect(rows.filter(Boolean)).toHaveLength(0);
  });

  it('puts crowded labels on a second row rather than dropping them', () => {
    const rows = staggerRows(co2(), 1);
    expect(rows.filter(Boolean).length).toBeGreaterThan(0);
  });

  it('never goes past a second row', () => {
    const rows = staggerRows({ ...co2(), fontSize: 4 }, 1);
    for (const r of rows) expect([undefined, 0, 1]).toContain(r);
  });

  it('gives the crowded pairs enough air to count as clear', () => {
    const spec = co2();
    const rows = staggerRows(spec, 1);
    // A row apart is ROW_GAP of type, which is more than the gap asked for.
    expect(MIN_GAP).toBeLessThan(LINE_HEIGHT);
    expect(rows.some(r => r === 1)).toBe(true);
  });
});

describe('boxReach', () => {
  it('reaches half a width sideways and half a height up', () => {
    const box = { w: 6, h: 2 };
    expect(boxReach(box, 1, 0)).toBe(3);
    expect(boxReach(box, 0, 1)).toBe(1);
  });

  it('answers the nearer edge, never the corner past it', () => {
    // A wide, low box at 45 degrees leaves its top edge first, not its side.
    const box = { w: 6, h: 2 };
    const d = Math.SQRT1_2;
    expect(boxReach(box, d, d)).toBeCloseTo(1 / d);
  });

  it('moves with the angle rather than jumping at a threshold', () => {
    const box = { w: 4, h: 1.5 };
    let prev = boxReach(box, Math.cos(0), Math.sin(0));
    for (let deg = 1; deg <= 360; deg++) {
      const a = (deg * Math.PI) / 180;
      const now = boxReach(box, Math.cos(a), Math.sin(a));
      expect(Math.abs(now - prev)).toBeLessThan(0.2);
      prev = now;
    }
  });

  it('puts a long label and a short one the same distance from the ticks', () => {
    // Which is what the switching anchors could not do: the edge facing the
    // ticks is on the circle whatever the number says.
    const r = 20;
    const at = (text, deg) => {
      const a = (deg * Math.PI) / 180;
      const box = labelBox(text, 2);
      return r - boxReach(box, Math.cos(a), Math.sin(a));
    };
    for (const deg of [0, 37, 90, 145, 180, 250]) {
      const edge = (text) => {
        const a = (deg * Math.PI) / 180;
        return at(text, deg) + boxReach(labelBox(text, 2), Math.cos(a), Math.sin(a));
      };
      expect(edge('7')).toBeCloseTo(r);
      expect(edge('12345')).toBeCloseTo(r);
    }
  });
});
