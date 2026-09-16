import { describe, it, expect } from 'vitest';
import { PATTERN_ANIMATIONS, defaultColorPattern, patternList, patternFor,
         patchPattern, patchPatternStops, solidColorOf, solidColorPatch } from './color-pattern.js';

describe('patternList', () => {
  it('answers the list, and an empty one for a slot that has none', () => {
    const list = [{ target: 'main' }];
    expect(patternList({ color_patterns: list })).toBe(list);
    expect(patternList({})).toEqual([]);
    expect(patternList(null)).toEqual([]);
    expect(patternList({ color_patterns: 'nonsense' })).toEqual([]);
  });
});

describe('patternFor', () => {
  it('finds by target, not by position', () => {
    const list = [{ target: 'main' }, { target: 'elm_surface_1' }];
    expect(patternFor(list, 'elm_surface_1')).toBe(list[1]);
  });

  it('answers null when nothing paints that box', () => {
    expect(patternFor([{ target: 'main' }], 'elm_surface_1')).toBe(null);
    expect(patternFor(undefined, 'main')).toBe(null);
  });
});

describe('patchPattern', () => {
  it('makes the pattern on the first write', () => {
    const next = patchPattern([], 'elm_surface_0', { opacity: 40 });
    expect(next).toHaveLength(1);
    expect(next[0].target).toBe('elm_surface_0');
    expect(next[0].opacity).toBe(40);
    // Everything else a pattern needs comes with it.
    expect(next[0].bg_type).toBe('solid');
    expect(next[0].enabled).toBe(true);
  });

  it('leaves the list it was handed alone', () => {
    const list = [{ target: 'main', opacity: 100 }];
    const next = patchPattern(list, 'main', { opacity: 20 });
    expect(list[0].opacity).toBe(100);
    expect(next[0].opacity).toBe(20);
    expect(next).not.toBe(list);
  });

  it('touches only the pattern for that target', () => {
    const list = [{ target: 'main', opacity: 100 }, { target: 'elm_surface_0', opacity: 100 }];
    const next = patchPattern(list, 'elm_surface_0', { opacity: 10 });
    expect(next[0].opacity).toBe(100);
    expect(next[1].opacity).toBe(10);
  });
});

describe('patchPatternStops', () => {
  it('writes the one stop shape and takes the stale arrays out', () => {
    const list = [{ target: 'main', colors: ['#fff'], stops: [50], gradient_stops: [] }];
    const next = patchPatternStops(list, 'main', [{ pos: 100, color: '#123456' }]);
    expect(next[0].gradient_stops).toEqual([{ pos: 100, color: '#123456' }]);
    expect('colors' in next[0]).toBe(false);
    expect('stops' in next[0]).toBe(false);
    // And the list it was handed still has them.
    expect(list[0].colors).toEqual(['#fff']);
  });

  it('makes the pattern when there is none', () => {
    const next = patchPatternStops([], 'elm_surface_2', [{ pos: null, color: '#abcdef' }]);
    expect(next[0].gradient_stops).toEqual([{ pos: null, color: '#abcdef' }]);
  });
});

describe('solidColorOf / solidColorPatch', () => {
  it('reads the one colour through every stop shape a pattern may carry', () => {
    expect(solidColorOf({ gradient_stops: [{ pos: 100, color: '#010203' }] })).toBe('#010203');
    expect(solidColorOf({ colors: ['#040506'], stops: [100] })).toBe('#040506');
    expect(solidColorOf({})).toBe('#ff9800');
    expect(solidColorOf(null)).toBe('#ff9800');
  });

  it('keeps the position, so a gradient finds its stop where it left it', () => {
    const pat = { gradient_stops: [{ pos: 30, color: '#000000' }] };
    expect(solidColorPatch(pat, '#ffffff')).toEqual(
      { gradient_stops: [{ pos: 30, color: '#ffffff' }] });
  });

  it('writes one stop and no more', () => {
    const pat = { gradient_stops: [{ pos: 0, color: '#000' }, { pos: 100, color: '#fff' }] };
    expect(solidColorPatch(pat, '#123456').gradient_stops).toHaveLength(1);
  });
});

describe('PATTERN_ANIMATIONS', () => {
  it('is the one list, and "none" is in it', () => {
    expect(PATTERN_ANIMATIONS.map(a => a.value)).toContain('none');
    expect(PATTERN_ANIMATIONS.map(a => a.value)).toContain('pump_all');
    // Every effect is offered exactly once.
    const seen = PATTERN_ANIMATIONS.map(a => a.value);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('is the list a fresh pattern starts in', () => {
    expect(PATTERN_ANIMATIONS.map(a => a.value)).toContain(defaultColorPattern('main').animation);
  });
});
