import { describe, it, expect } from 'vitest';
import {
  GRADIENT_PRESETS, gradientPreset, gradientPresetPatch, gradientPresetCss,
} from './gradient-presets.js';
import { normalizeStops } from './gradient-stops.js';

describe('the ramps', () => {
  it('gives every preset a unique id, a label and a use', () => {
    const ids = GRADIENT_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of GRADIENT_PRESETS) {
      expect(p.label, p.id).toBeTruthy();
      expect(p.hint, p.id).toBeTruthy();
    }
  });

  it('keeps every stop a per cent in order, with a colour the reader can read', () => {
    for (const p of GRADIENT_PRESETS) {
      expect(p.stops.length, p.id).toBeGreaterThan(1);
      let last = -1;
      for (const s of p.stops) {
        expect(s.pos, p.id).toBeGreaterThanOrEqual(0);
        expect(s.pos, p.id).toBeLessThanOrEqual(100);
        expect(s.pos, p.id).toBeGreaterThanOrEqual(last);
        last = s.pos;
        expect(s.color, p.id).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('is the shape every other reader of a stop list expects', () => {
    for (const p of GRADIENT_PRESETS) {
      const patch = gradientPresetPatch(p.id);
      expect(normalizeStops(patch.manual_stops)).toEqual([...p.stops]);
    }
  });
});

describe('dropping one on a gauge', () => {
  it('writes the whole ramp, in per cent, in manual mode', () => {
    const patch = gradientPresetPatch('traffic');
    expect(patch.gradient_preset).toBe('manual');
    expect(patch.threshold_unit).toBe('percent');
    expect(patch.manual_stops[0]).toEqual({ pos: 0, color: '#4caf50' });
  });

  it('hands over a list that may be edited in place', () => {
    const a = gradientPresetPatch('traffic');
    const b = gradientPresetPatch('traffic');
    a.manual_stops[0].color = '#000000';
    expect(b.manual_stops[0].color).toBe('#4caf50');
    expect(GRADIENT_PRESETS[0].stops[0].color).toBe('#4caf50');
  });

  it('answers nothing for a menu nobody chose from', () => {
    expect(gradientPreset('')).toBe(null);
    expect(gradientPresetPatch('nonesuch')).toBe(null);
  });
});

describe('dropping one on a colour pattern', () => {
  it('writes the list and nothing else - the type is not the ramp\'s to say', () => {
    const patch = gradientPresetPatch('traffic', 'pattern');
    expect(Object.keys(patch)).toEqual(['gradient_stops']);
    expect(normalizeStops(patch.gradient_stops))
      .toEqual([...gradientPreset('traffic').stops]);
  });

  it('hands over a list that may be edited in place', () => {
    const a = gradientPresetPatch('band', 'pattern');
    const b = gradientPresetPatch('band', 'pattern');
    a.gradient_stops[0].color = '#000000';
    expect(b.gradient_stops[0].color).toBe(gradientPreset('band').stops[0].color);
  });

  it('answers nothing for a menu nobody chose from', () => {
    expect(gradientPresetPatch('', 'pattern')).toBe(null);
  });
});

describe('the swatch', () => {
  it('draws the ramp at the positions it actually carries', () => {
    expect(gradientPresetCss(gradientPreset('throughput')))
      .toBe('linear-gradient(90deg, #b51a00 7%, #ffaa00 20%, #4f7a28 47%, #96d35f 70%)');
  });

  it('draws nothing for nothing', () => {
    expect(gradientPresetCss(null)).toBe('none');
  });
});
