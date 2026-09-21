import { describe, it, expect } from 'vitest';
import { pinchStep, PINCH_SLOP } from './pinch-gesture.js';

const start = (dist, zoom = 1) => ({ dist, zoom, zooming: false });

describe('pinchStep', () => {
  it('is a scroll while the fingers hold their distance', () => {
    expect(pinchStep(start(200), 200)).toBe(null);
  });

  it('is still a scroll under the slop, either way', () => {
    expect(pinchStep(start(200), 200 + PINCH_SLOP - 1)).toBe(null);
    expect(pinchStep(start(200), 200 - PINCH_SLOP + 1)).toBe(null);
  });

  it('becomes a pinch at the slop, and rebases rather than jumping', () => {
    const step = pinchStep(start(200), 200 + PINCH_SLOP);
    expect(step).toEqual({ rebase: 200 + PINCH_SLOP });
  });

  it('zooms by the ratio once it is a pinch', () => {
    const p = { dist: 200, zoom: 1.5, zooming: true };
    expect(pinchStep(p, 300)).toEqual({ zoom: 2.25 });
    expect(pinchStep(p, 100)).toEqual({ zoom: 0.75 });
  });

  it('stays a pinch inside the slop once it has begun', () => {
    const p = { dist: 200, zoom: 1, zooming: true };
    expect(pinchStep(p, 201)).toEqual({ zoom: 201 / 200 });
  });

  it('survives two fingers landing on the same spot', () => {
    const p = { dist: 0, zoom: 1, zooming: true };
    expect(Number.isFinite(pinchStep(p, 50).zoom)).toBe(true);
  });
});
