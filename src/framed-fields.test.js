import { describe, it, expect } from 'vitest';
import { framedPart, fieldFramed, fieldShown, splitMenus, menuRest,
         framedIn, menusFor } from './framed-fields.js';

const sec = (id, label) => ({ id, label, type: 'section' });
const sub = (id, label) => ({ id, label, type: 'subsection' });
const f = (id, extra = {}) => ({ id, label: id, type: 'number', ...extra });

describe('framedPart', () => {
  it('answers null when nothing frames the field', () => {
    expect(framedPart(f('a', { framedBy: 'ticks' }), {}, new Set())).toBe(null);
  });

  it('names the part that is in hand', () => {
    expect(framedPart(f('a', { framedBy: 'ticks' }), {}, new Set(['ticks'])))
      .toBe('ticks');
  });

  it('picks the one of several that is in hand', () => {
    const field = f('a', { framedBy: ['gauge_ring', 'pointer'] });
    expect(framedPart(field, {}, new Set(['pointer']))).toBe('pointer');
  });

  it('asks a function of the entry', () => {
    const field = f('a', { framedBy: (cfg) => cfg.solid ? 'paint' : null });
    expect(framedPart(field, { solid: true }, new Set(['paint']))).toBe('paint');
    expect(framedPart(field, { solid: false }, new Set(['paint']))).toBe(null);
  });

  it('survives a missing field and a missing set', () => {
    expect(framedPart(null, {}, new Set())).toBe(null);
    expect(framedPart(f('a', { framedBy: 'x' }), {}, undefined)).toBe(null);
  });
});

describe('fieldFramed', () => {
  it('hides a field whose part is in hand', () => {
    expect(fieldFramed(f('a', { framedBy: 'ticks' }), {}, new Set(['ticks'])))
      .toBe(true);
  });

  it('hides a standing note while its part is NOT in hand', () => {
    const note = { type: 'note', framedWhen: 'ticks' };
    expect(fieldFramed(note, {}, new Set())).toBe(true);
    expect(fieldFramed(note, {}, new Set(['ticks']))).toBe(false);
  });
});

describe('fieldShown', () => {
  it('counts an ordinary field', () => {
    expect(fieldShown(f('a'), {}, {}, new Set())).toBe(true);
  });

  it('does not count headings or standing text', () => {
    expect(fieldShown(sec('_s', '── Ticks'), {}, {}, new Set())).toBe(false);
    expect(fieldShown(sub('_t', '── Sub'), {}, {}, new Set())).toBe(false);
    expect(fieldShown({ type: 'note', framedWhen: 'x' }, {}, {}, new Set(['x'])))
      .toBe(false);
  });

  it('does not count a field its own condition hides', () => {
    const field = f('a', { condition: (cfg) => !!cfg.on });
    expect(fieldShown(field, { on: false }, {}, new Set())).toBe(false);
    expect(fieldShown(field, { on: true }, {}, new Set())).toBe(true);
  });

  it('hands the slot to the condition as its second argument', () => {
    const field = f('a', { condition: (_cfg, slot) => !slot?.canvas });
    expect(fieldShown(field, {}, { canvas: {} }, new Set())).toBe(false);
    expect(fieldShown(field, {}, {}, new Set())).toBe(true);
  });

  it('does not count a field the canvas has taken', () => {
    expect(fieldShown(f('a', { framedBy: 'ticks' }), {}, {}, new Set(['ticks'])))
      .toBe(false);
  });
});

describe('splitMenus', () => {
  it('cuts a flat array at its headings and strips the marker', () => {
    const menus = splitMenus([sec('_a', '── Shape'), f('x'), f('y'),
                              sec('_b', '── Ticks'), f('z')]);
    expect(menus.map(m => m.title)).toEqual(['Shape', 'Ticks']);
    expect(menus[0].items.map(i => i.id)).toEqual(['x', 'y']);
    expect(menus[1].items.map(i => i.id)).toEqual(['z']);
  });

  it('gives a subsection a fold of its own', () => {
    const menus = splitMenus([sec('_a', '── Labels'), f('x'),
                              sub('_b', '── Sub ticks'), f('y')]);
    expect(menus.map(m => m.title)).toEqual(['Labels', 'Sub ticks']);
    expect(menus[1].items.map(i => i.id)).toEqual(['y']);
  });

  it('drops what stands before the first heading - the form has no name', () => {
    expect(splitMenus([f('loose'), sec('_a', '── A'), f('x')]))
      .toEqual([{ id: '_a', title: 'A', items: [f('x')] }]);
  });

  it('answers nothing for nothing', () => {
    expect(splitMenus(undefined)).toEqual([]);
    expect(splitMenus([])).toEqual([]);
  });
});

describe('menuRest', () => {
  it('counts only the rows that are actually drawn', () => {
    const items = [f('a'), f('b', { framedBy: 'ticks' }),
                   f('c', { condition: () => false }),
                   { type: 'note', framedWhen: 'ticks' }];
    expect(menuRest(items, {}, {}, new Set(['ticks']))).toBe(1);
    expect(menuRest(items, {}, {}, new Set())).toBe(2);
  });
});

describe('framedIn', () => {
  it('says nothing about a fold that has lost nothing', () => {
    expect(framedIn([f('a'), f('b')], {}, {}, new Set(['ticks']))).toBe(null);
  });

  it('names the part and counts what is left', () => {
    const items = [f('a'), f('b', { framedBy: 'ticks' }), f('c', { framedBy: 'ticks' })];
    expect(framedIn(items, {}, {}, new Set(['ticks']))).toEqual({ part: 'ticks', rest: 1 });
  });

  it('reports an empty fold as nothing left', () => {
    const items = [f('a', { framedBy: 'ticks' })];
    expect(framedIn(items, {}, {}, new Set(['ticks']))).toEqual({ part: 'ticks', rest: 0 });
  });

  // A row the entry has no use for cannot have moved to the drawing, and a
  // note about a part nobody can see is worse than no note.
  it('ignores a framed field that its own condition hides anyway', () => {
    const items = [f('a'), f('b', { framedBy: 'ticks', condition: () => false })];
    expect(framedIn(items, {}, {}, new Set(['ticks']))).toBe(null);
  });
});

describe('menusFor', () => {
  const fields = [
    sec('_shape', '── Shape & Position'), f('w'), f('h', { framedBy: 'frame_ring' }),
    sec('_ticks', '── Ticks'), f('count', { framedBy: 'ticks' }),
    sec('_look', '── Colour'), f('hue', { framedBy: 'frame_ring' }), f('sat'),
  ];

  it('names the fold a part took from, and what is left in it', () => {
    expect(menusFor(fields, {}, {}, 'ticks'))
      .toEqual([{ id: '_ticks', title: 'Ticks', rest: 0 }]);
  });

  // A part is usually in two folds - its geometry in one, its looks in
  // another - and the first is not the interesting one.
  it('names every fold a part took from, in the form order', () => {
    expect(menusFor(fields, {}, {}, 'frame_ring')).toEqual([
      { id: '_shape', title: 'Shape & Position', rest: 1 },
      { id: '_look', title: 'Colour', rest: 1 },
    ]);
  });

  it('answers nothing for a part no fold gave anything to', () => {
    expect(menusFor(fields, {}, {}, 'hub')).toEqual([]);
  });

  it('answers nothing for a form that is not there', () => {
    expect(menusFor([], {}, {}, 'ticks')).toEqual([]);
  });
});
