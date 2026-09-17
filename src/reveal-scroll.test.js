import { describe, it, expect } from 'vitest';
import { revealBy } from './reveal-scroll.js';

const box = (top, bottom) => ({ top, bottom });

describe('nudging a heading into view', () => {
  const view = box(0, 600);

  it('leaves a scroller alone when the thing is already in it', () => {
    expect(revealBy(box(100, 140), view, null)).toBe(0);
    expect(revealBy(box(0, 600), view, null)).toBe(0);
  });

  it('moves by the least that puts it inside', () => {
    expect(revealBy(box(620, 660), view, null)).toBe(60);
    expect(revealBy(box(-30, 10), view, null)).toBe(-30);
  });

  it('leaves one that is taller than the view where it is', () => {
    // It already covers the whole view: there is no inside to move it to.
    expect(revealBy(box(-50, 900), view, null)).toBe(0);
  });

  it('lands the top of one too tall to fit', () => {
    // 700 tall in a 600 view, sitting below: its foot is not what a reader
    // is after, so the move is the one that brings its head to the edge.
    expect(revealBy(box(650, 1350), view, null)).toBe(650);
  });
});

describe('what may not be scrolled away', () => {
  const view = box(0, 600);

  it('spends the room above the element and no more', () => {
    // The element starts 100px down, so 100px may go before its top edge
    // reaches the top of the view.
    expect(revealBy(box(900, 940), view, box(100, 400))).toBe(100);
    // And when the heading needs less than that, it takes less.
    expect(revealBy(box(640, 660), view, box(100, 400))).toBe(60);
  });

  it('does not move at all when the element is against the edge', () => {
    // A phone: the drawing is the screen. Scrolling here is what was
    // reported - a tap on a chip that took the gauge off the screen.
    expect(revealBy(box(900, 940), view, box(0, 600))).toBe(0);
    expect(revealBy(box(900, 940), view, box(-100, 500))).toBe(0);
  });

  it('holds still rather than shove one that is already out', () => {
    expect(revealBy(box(900, 940), view, box(-400, -100))).toBe(0);
  });

  it('is clamped the same way scrolling back up', () => {
    // Room below: the element ends 200px above the bottom edge.
    expect(revealBy(box(-500, -460), view, box(100, 400))).toBe(-200);
    expect(revealBy(box(-30, 10), view, box(100, 400))).toBe(-30);
    expect(revealBy(box(-500, -460), view, box(100, 600))).toBe(0);
  });
});
