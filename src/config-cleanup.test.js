import { describe, it, expect } from 'vitest';
import { stripDeadConfig, migrateSlotKey, withoutElementConfig, DEAD_ENTRY_KEYS, DEAD_PATTERN_TARGETS } from './config-cleanup.js';

describe('stripDeadConfig', () => {
  it('takes the dead keys out of the entry that carries them', () => {
    const slot = { progressbars: [
      { entity: 'sensor.a', position_mode: 'center', offset_x: '10px', offset_y: '0', width: 80 },
    ] };
    const out = stripDeadConfig(slot);
    expect(out.progressbars[0]).toEqual({ entity: 'sensor.a', width: 80 });
  });

  it('takes the dead switch off the slot itself', () => {
    const slot = { hide_tips: true, gauges: [{ entity: 'sensor.a' }] };
    const out = stripDeadConfig(slot);
    expect(out).toEqual({ gauges: slot.gauges });
    expect(slot.hide_tips).toBe(true);
  });

  it('leaves a slot that never carried the dead switch alone', () => {
    const slot = { gauges: [{ entity: 'sensor.a' }] };
    expect(stripDeadConfig(slot)).toBeNull();
  });

  it('strips the glass debug switch but keeps manual adjustments', () => {
    const slot = { fx_glass_patterns: [
      { target: 'elm_gauge_0', enabled: true, blur: 6, manual_override: true, debug_mask: false },
      { target: 'main', enabled: true, blur: 6 },
    ] };
    const out = stripDeadConfig(slot);
    expect(out.fx_glass_patterns[0]).toEqual(
      { target: 'elm_gauge_0', enabled: true, blur: 6, manual_override: true });
    expect(out.fx_glass_patterns[1]).toBe(slot.fx_glass_patterns[1]);
  });

  it('drops a pattern aimed at a target the card will not paint', () => {
    const kept = { target: 'elm_gauge_0', enabled: true, blur: 6 };
    const slot = { fx_glass_patterns: [
      { target: 'elm_name', enabled: true, blur: 6 },
      kept,
      { target: 'elm_state', enabled: false, blur: 6 },
    ] };
    const out = stripDeadConfig(slot);
    expect(out.fx_glass_patterns).toEqual([kept]);
    expect(DEAD_PATTERN_TARGETS).toContain('elm_name');
  });

  it('strips a dead key and a dead entry in the same pass', () => {
    const slot = { fx_glass_patterns: [
      { target: 'elm_name', enabled: true },
      { target: 'main', enabled: true, debug_mask: true },
    ] };
    expect(stripDeadConfig(slot).fx_glass_patterns).toEqual([{ target: 'main', enabled: true }]);
  });

  it('is null when there is nothing to strip', () => {
    expect(stripDeadConfig({ progressbars: [{ entity: 'sensor.a' }] })).toBeNull();
    expect(stripDeadConfig({ gauges: [{ position_mode: 'center' }] })).toBeNull();
    expect(stripDeadConfig({})).toBeNull();
    expect(stripDeadConfig(null)).toBeNull();
  });

  it('leaves the slot it was given alone', () => {
    const slot = { progressbars: [{ entity: 'sensor.a', offset_x: '10px' }] };
    const before = structuredClone(slot);
    stripDeadConfig(slot);
    expect(slot).toEqual(before);
  });

  it('keeps every other key and list untouched, by identity', () => {
    const gauges = [{ entity: 'sensor.g' }];
    const clean = { entity: 'sensor.b' };
    const slot = { canvas: { w: 400, h: 200 }, gauges,
                   progressbars: [clean, { entity: 'sensor.c', offset_y: '4px' }] };
    const out = stripDeadConfig(slot);
    expect(out.canvas).toBe(slot.canvas);
    expect(out.gauges).toBe(gauges);
    // the entry that lost nothing is the same object, not a copy
    expect(out.progressbars[0]).toBe(clean);
    expect(out.progressbars[1]).toEqual({ entity: 'sensor.c' });
  });

  it('strips a key even when its value is falsy', () => {
    // `offset_x: 0` is exactly the leftover most likely to be read as "unset"
    // and skipped by a sloppier check.
    const out = stripDeadConfig({ progressbars: [{ entity: 'sensor.a', offset_x: 0, position_mode: '' }] });
    expect(out.progressbars[0]).toEqual({ entity: 'sensor.a' });
  });

  it('survives a list that is not one, and entries that are not objects', () => {
    expect(stripDeadConfig({ progressbars: 'nonsense' })).toBeNull();
    expect(stripDeadConfig({ progressbars: [null, undefined, 5] })).toBeNull();
    const out = stripDeadConfig({ progressbars: [null, { offset_x: '1px' }] });
    expect(out.progressbars).toEqual([null, {}]);
  });

  it('names only keys nothing reads', () => {
    // A guard on the list itself: adding a key here removes it from people's
    // dashboards, so it has to be one the code genuinely never looks at.
    expect(DEAD_ENTRY_KEYS.progressbars).toEqual(['position_mode', 'offset_x', 'offset_y']);
    expect(DEAD_ENTRY_KEYS.gauges).toEqual(['pivot_offset_x', 'pivot_offset_y']);
  });

  it('takes the pivot offsets off a gauge and leaves the rest of it', () => {
    const out = stripDeadConfig({ gauges: [
      { entity: 'x', pivot_offset_x: 3, pivot_offset_y: -2, pointer_length: 10 },
      { entity: 'y', pointer_length: 8 },
    ] });
    expect(out.gauges[0]).toEqual({ entity: 'x', pointer_length: 10 });
    expect(out.gauges[1]).toEqual({ entity: 'y', pointer_length: 8 });
  });
});

describe('the editor fold state saved cards carry', () => {
  it('leaves a gauge, its stops, ticks and sectors without _isOpen', () => {
    const slot = { gauges: [{
      entity: 'x', manual_stops: [{ value: 0, color: '#f00', _isOpen: true }],
      custom_ticks: [{ value: 5, _isOpen: false }],
      sectors: [{ start_percent: 75, _isOpen: true, manual_stops: [{ value: 1, _isOpen: false }] }],
    }] };
    const out = stripDeadConfig(slot);
    expect(out.gauges[0].manual_stops[0]).toEqual({ pos: 0, color: '#f00' });
    expect(out.gauges[0].custom_ticks[0]).toEqual({ value: 5 });
    expect(out.gauges[0].sectors[0].manual_stops[0]).toEqual({ pos: 1 });
    expect('_isOpen' in out.gauges[0].sectors[0]).toBe(false);
  });

  it('is nothing to do for a gauge that never carried one', () => {
    expect(stripDeadConfig({ gauges: [{ entity: 'x', manual_stops: [{ pos: 0 }] }] })).toBe(null);
  });

  it('does not touch the gauges it did not have to rebuild', () => {
    const clean = { entity: 'clean' };
    const slot = { gauges: [clean, { entity: 'dirty', custom_ticks: [{ _isOpen: true }] }] };
    expect(stripDeadConfig(slot).gauges[0]).toBe(clean);
  });

  it('is for the gauge list only', () => {
    expect(stripDeadConfig({ progressbars: [{ _isOpen: true }] })).toBe(null);
  });
});

describe('migrateSlotKey', () => {
  it('moves a pre-rename slot onto the new key', () => {
    const slot = { gauges: [{ entity: 'sensor.a' }] };
    const out = migrateSlotKey({ type: 'custom:gauge-studio-core', entity: '', supercard: slot });
    expect(out).toEqual({ type: 'custom:gauge-studio-core', entity: '', gauge_studio: slot });
    expect(out.gauge_studio).toBe(slot);
  });

  it('leaves a config that already uses the new key alone', () => {
    const config = { gauge_studio: { gauges: [] } };
    expect(migrateSlotKey(config)).toBe(config);
  });

  it('keeps both when a hand-edited config carries both keys', () => {
    const config = { supercard: { gauges: [{ entity: 'old' }] }, gauge_studio: { gauges: [] } };
    expect(migrateSlotKey(config)).toBe(config);
  });

  it('does not modify the config it is given', () => {
    const config = { supercard: { gauges: [] } };
    migrateSlotKey(config);
    expect(config).toEqual({ supercard: { gauges: [] } });
  });

  it('passes anything that is not a config straight through', () => {
    expect(migrateSlotKey(undefined)).toBe(undefined);
    expect(migrateSlotKey(null)).toBe(null);
  });

  it('is nothing to do for a card that has no slot at all', () => {
    const config = { type: 'custom:gauge-studio-core' };
    expect(migrateSlotKey(config)).toBe(config);
  });
});

describe('stripDeadConfig: the one stop shape', () => {
  it('renames a gauge stop written as a value', () => {
    const slot = { gauges: [{ manual_stops: [{ value: 0, color: '#fff' }, { value: 50, color: '#000' }] }] };
    expect(stripDeadConfig(slot).gauges[0].manual_stops)
      .toEqual([{ pos: 0, color: '#fff' }, { pos: 50, color: '#000' }]);
  });

  it("reaches a sector's own stops, three levels down", () => {
    const slot = { gauges: [{ sectors: [{ manual_stops: [{ value: 10, color: '#abc' }] }] }] };
    expect(stripDeadConfig(slot).gauges[0].sectors[0].manual_stops)
      .toEqual([{ pos: 10, color: '#abc' }]);
  });

  it('leaves a stop that already reads as a position', () => {
    const slot = { progressbars: [{ gradient_stops: [{ pos: 0, color: '#fff' }] }] };
    expect(stripDeadConfig(slot)).toBe(null);
  });

  it("folds a colour pattern's parallel arrays into one list", () => {
    const slot = { color_patterns: [{ bg_type: 'linear', colors: ['#111', '#222'], stops: [0, 100] }] };
    expect(stripDeadConfig(slot).color_patterns[0])
      .toEqual({ bg_type: 'linear', gradient_stops: [{ pos: 0, color: '#111' }, { pos: 100, color: '#222' }] });
  });

  it('keeps a colour nobody positioned unpositioned', () => {
    const slot = { color_patterns: [{ bg_type: 'solid', colors: ['#111'] }] };
    expect(stripDeadConfig(slot).color_patterns[0].gradient_stops).toEqual([{ pos: null, color: '#111' }]);
  });

  it('does not touch a colours list that is not a pattern', () => {
    const slot = { gauges: [{ colors: ['#111'] }] };
    expect(stripDeadConfig(slot)).toBe(null);
  });

  it('does not modify the slot it is given', () => {
    const slot = { gauges: [{ manual_stops: [{ value: 0, color: '#fff' }] }] };
    stripDeadConfig(slot);
    expect(slot.gauges[0].manual_stops).toEqual([{ value: 0, color: '#fff' }]);
  });
});

describe('withoutElementConfig', () => {
  const slot = () => ({
    color_patterns: [{ id: 1, target: 'elm_surface_0' }, { id: 2, target: 'elm_gauge_0' }],
    fx_glass_patterns: [{ id: 3, target: 'elm_surface_0' }],
    // The push list writes the bare id, the other two the `elm_` form.
    interactions: [{ id: 4, target: 'surface_0' }, { id: 5, target: 'surface_1' }],
    canvas: { elements: [] },
  });

  it('takes every list entry that acts on the id, in either spelling', () => {
    expect(withoutElementConfig(slot(), ['surface_0'])).toEqual({
      color_patterns: [{ id: 2, target: 'elm_gauge_0' }],
      fx_glass_patterns: [],
      interactions: [{ id: 5, target: 'surface_1' }],
    });
  });

  it('leaves alone the lists that lose nothing', () => {
    expect(Object.keys(withoutElementConfig(slot(), ['surface_1'])))
      .toEqual(['interactions']);
  });

  it('answers null when there is nothing to take', () => {
    expect(withoutElementConfig(slot(), ['surface_9'])).toBe(null);
    expect(withoutElementConfig(slot(), [])).toBe(null);
    expect(withoutElementConfig(null, ['surface_0'])).toBe(null);
  });

  it('does not touch the slot it is given', () => {
    const before = slot();
    const copy = JSON.parse(JSON.stringify(before));
    withoutElementConfig(before, ['surface_0']);
    expect(before).toEqual(copy);
  });

  it('takes several ids at once', () => {
    const out = withoutElementConfig(slot(), ['surface_0', 'surface_1']);
    expect(out.interactions).toEqual([]);
  });
});

describe("stripDeadConfig: the bar label's weight", () => {
  it('turns a bold checkbox into the weight it drew', () => {
    const out = stripDeadConfig({ progressbars: [{ entity: 'sensor.a', label_bold: true }] });
    expect(out.progressbars[0]).toEqual({ entity: 'sensor.a', label_font_weight: '700' });
  });

  it('turns an unticked one into normal, so the label is not left weightless', () => {
    const out = stripDeadConfig({ progressbars: [{ label_bold: false }] });
    expect(out.progressbars[0]).toEqual({ label_font_weight: '400' });
  });

  it('leaves a weight that is already there and drops the checkbox', () => {
    const out = stripDeadConfig({ progressbars: [{ label_bold: true, label_font_weight: '500' }] });
    expect(out.progressbars[0]).toEqual({ label_font_weight: '500' });
  });

  it('says nothing changed where no bar carries one', () => {
    expect(stripDeadConfig({ progressbars: [{ label_font_weight: '400' }] })).toBe(null);
    expect(stripDeadConfig({ progressbars: [null, 5, 'x'] })).toBe(null);
  });

  it('rewrites the bars the dead-key pass already rebuilt', () => {
    const out = stripDeadConfig({ progressbars: [{ label_bold: true, offset_x: 3 }] });
    expect(out.progressbars[0]).toEqual({ label_font_weight: '700' });
  });

  it('leaves the other lists alone', () => {
    const out = stripDeadConfig({ gauges: [{ label_bold: true }], progressbars: [{ label_bold: true }] });
    expect(out.gauges[0]).toEqual({ label_bold: true });
  });
});
