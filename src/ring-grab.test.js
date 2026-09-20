import { describe, it, expect } from 'vitest';
import { hitZones, radialDeg, sectorOf, sectorDeg, arrowSvg, radialCursor,
         captionSpot, GRAB_REACH, CURSOR_SECTORS } from './ring-grab.js';

/** The two ends of a zone, which is what the arithmetic is really about. */
const span = (z) => [z.r - z.w / 2, z.r + z.w / 2];

describe('hitZones', () => {
  it('gives a lone band the full reach either way', () => {
    const [z] = hitZones([20]);
    expect(span(z)).toEqual([20 - GRAB_REACH, 20 + GRAB_REACH]);
  });

  it('leaves two bands that are far apart untouched', () => {
    const [a, b] = hitZones([10, 30]);
    expect(span(a)).toEqual([10 - GRAB_REACH, 10 + GRAB_REACH]);
    expect(span(b)).toEqual([30 - GRAB_REACH, 30 + GRAB_REACH]);
  });

  it('shares the ground at the midpoint where they are close', () => {
    const [inner, outer] = hitZones([19, 20]);
    expect(span(inner)[1]).toBeCloseTo(19.5);
    expect(span(outer)[0]).toBeCloseTo(19.5);
  });

  it('never overlaps, however thin the frame', () => {
    for (const gap of [2.4, 1, 0.4, 0.05, 0]) {
      const [outer, inner] = hitZones([20, 20 - gap]);
      expect(span(inner)[1]).toBeLessThanOrEqual(span(outer)[0] + 1e-9);
    }
  });

  it('keeps a side to aim from even where the two are one circle', () => {
    // Outermost first: the frame's outer edge is declared before its inner
    // one, and where the two have met that is what says which is which.
    const [outer, inner] = hitZones([20, 20]);
    expect(span(inner)[0]).toBeCloseTo(20 - GRAB_REACH);
    expect(span(inner)[1]).toBeCloseTo(20);
    expect(span(outer)[0]).toBeCloseTo(20);
    expect(span(outer)[1]).toBeCloseTo(20 + GRAB_REACH);
  });

  it('answers in the order it was asked, not in radius order', () => {
    const [outer, inner] = hitZones([30, 10]);
    expect(outer.r).toBeGreaterThan(inner.r);
  });

  it('gives the outward side to the one named first where they coincide', () => {
    const [first, second] = hitZones([20, 20]);
    expect(first.r).toBeGreaterThan(second.r);
  });

  it('is empty for no bands', () => {
    expect(hitZones([])).toEqual([]);
  });
});

describe('radialDeg', () => {
  it('counts clockwise from three o\'clock, the way the screen does', () => {
    expect(radialDeg(0, 0, 10, 0)).toBe(0);
    expect(radialDeg(0, 0, 0, 10)).toBe(90);
    expect(radialDeg(0, 0, -10, 0)).toBe(180);
    expect(radialDeg(0, 0, 0, -10)).toBe(-90);
  });
});

describe('sectorOf', () => {
  it('rounds to the nearest of the sixteen', () => {
    expect(sectorOf(0)).toBe(0);
    expect(sectorOf(10)).toBe(0);
    expect(sectorOf(14)).toBe(1);
    expect(sectorOf(22.5)).toBe(1);
  });

  it('wraps rather than running off either end', () => {
    expect(sectorOf(360)).toBe(0);
    expect(sectorOf(-22.5)).toBe(CURSOR_SECTORS - 1);
    expect(sectorOf(-180)).toBe(CURSOR_SECTORS / 2);
  });

  it('agrees with the angle it names', () => {
    for (let i = 0; i < CURSOR_SECTORS; i++) expect(sectorOf(sectorDeg(i))).toBe(i);
  });
});

describe('radialCursor', () => {
  it('is a cursor image with a hotspot in the middle and a fallback', () => {
    expect(radialCursor(0)).toMatch(/^url\("data:image\/svg\+xml,.*"\) 12 12, ns-resize$/);
  });

  it('gives the same picture to the two ends of one line', () => {
    expect(radialCursor(30)).toBe(radialCursor(210));
    expect(radialCursor(0)).toBe(radialCursor(180));
  });

  it('turns with the angle', () => {
    expect(radialCursor(0)).not.toBe(radialCursor(90));
  });

  it('hands back the very same string, so nothing is decoded twice', () => {
    expect(radialCursor(45)).toBe(radialCursor(45));
  });

  it('draws eight pictures and no more', () => {
    const seen = new Set();
    for (let d = -360; d <= 360; d += 1) seen.add(radialCursor(d));
    expect(seen.size).toBe(CURSOR_SECTORS / 2);
  });
});

describe('arrowSvg', () => {
  it('turns the arrow about the middle of the image', () => {
    expect(arrowSvg(45)).toContain('rotate(45 12 12)');
  });

  it('carries the dark outline under the white arrow', () => {
    const svg = arrowSvg(0);
    expect(svg.indexOf('rgba(0,0,0,0.85)')).toBeLessThan(svg.indexOf('#ffffff'));
  });
});

describe('captionSpot', () => {
  it('stands inside the band, at the angle it was asked for', () => {
    const s = captionSpot(50, 50, 20, 0, 4);
    expect([s.x, s.y]).toEqual([66, 50]);
  });

  it('reads away from the band on either side, and is centred top and bottom', () => {
    expect(captionSpot(0, 0, 20, 0, 4).anchor).toBe('end');
    expect(captionSpot(0, 0, 20, 180, 4).anchor).toBe('start');
    expect(captionSpot(0, 0, 20, 90, 4).anchor).toBe('middle');
    expect(captionSpot(0, 0, 20, -90, 4).anchor).toBe('middle');
  });

  it('does not fall through the centre on a band smaller than the gap', () => {
    expect(captionSpot(50, 50, 2, 0, 4)).toMatchObject({ x: 50, y: 50 });
  });
});
