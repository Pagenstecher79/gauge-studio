import { describe, it, expect } from 'vitest';
import { needsRowsCompat, rowsAsCanvas } from './rows-compat.js';
import { migrateLayoutToCanvas, canvasFromBox } from './canvas-model.js';
import fixtures from './__fixtures__/real-layouts.json';

const rows = [
  { cells: [{ content: 'icon' }, { content: 'name' }] },
  { cells: [{ content: 'gauge_0' }] },
];

/** A slot with the layout switched on, which is the only kind that migrates. */
const on = (/** @type {any} */ extra = {}) => ({ layout_active: true, layout_rows: rows, ...extra });

describe('needsRowsCompat', () => {
  it('says yes to a card that has rows and no canvas, switched on or off', () => {
    expect(needsRowsCompat(on())).toBe(true);
    expect(needsRowsCompat({ layout_rows: rows })).toBe(true);
    expect(needsRowsCompat({ layout_rows: rows, layout_active: false })).toBe(true);
  });

  it('says no once a canvas has been written', () => {
    expect(needsRowsCompat(on({ canvas: { w: 400, h: 200, elements: [] } }))).toBe(false);
  });

  it('says no to a card that never had a layout', () => {
    expect(needsRowsCompat({})).toBe(false);
    expect(needsRowsCompat(undefined)).toBe(false);
  });

  it('says no to an empty rows list, which describes no layout at all', () => {
    expect(needsRowsCompat({ layout_rows: [] })).toBe(false);
  });
});

describe('rowsAsCanvas', () => {
  it('returns null before the card has been measured', () => {
    expect(rowsAsCanvas(on(), 0, 0)).toBe(null);
    expect(rowsAsCanvas(on(), 300, undefined)).toBe(null);
  });

  it('returns null when there is nothing to migrate', () => {
    expect(rowsAsCanvas({}, 300, 150)).toBe(null);
  });

  // Both sides are rounded to whole units - they are edited by hand - so the
  // ratio is only as exact as one unit in four hundred allows.
  it('takes its aspect ratio from the measured box, not from the config', () => {
    const { canvas } = rowsAsCanvas(on(), 600, 300);
    expect(canvas.w / canvas.h).toBeCloseTo(2, 2);
    const tall = rowsAsCanvas(on(), 200, 600).canvas;
    expect(tall.w / tall.h).toBeCloseTo(1 / 3, 2);
  });

  it('places the same elements the migration places', () => {
    const shape = canvasFromBox(600, 300);
    const direct = migrateLayoutToCanvas(rows, shape, { targetedCells: [], slot: on() });
    const { canvas } = rowsAsCanvas(on(), 600, 300);
    expect(canvas.elements).toEqual(direct.elements);
  });

  it('leaves layout_active alone rather than switching a layout on', () => {
    expect('layout_active' in rowsAsCanvas(on(), 600, 300)).toBe(false);
  });

  // The case behind backlog 44: a draft row abandoned at `flex: 1` is one per
  // cent of the card, so reproducing it turns two gauges into two specks. The
  // card never drew that row, so there is no picture to be faithful to and the
  // rows share the card instead - which for a single-row draft is the two
  // half-width gauges its cells actually describe.
  const draft = [{ flex: 1, cells: [
    { content: 'gauge_0', width: 50 }, { content: 'gauge_1', width: 50 }] }];

  it('fills the card with a draft layout the card never drew', () => {
    const out = rowsAsCanvas({ layout_rows: draft, layout_active: false }, 348, 184);
    const [a, b] = out.canvas.elements;
    // Half the card each, and square-locked, so the side is whichever of the
    // two the gauge runs out of first - here the half width.
    const side = Math.min(out.canvas.w / 2, out.canvas.h);
    expect(a.h).toBe(side);
    expect(b.h).toBe(side);
    expect(a.x).toBe(0);
    expect(b.x).toBe(out.canvas.w / 2);
  });

  it('reproduces a one-per-cent row that is actually on screen', () => {
    const out = rowsAsCanvas({ layout_rows: draft, layout_active: true }, 348, 184);
    for (const el of out.canvas.elements) expect(el.h).toBeLessThan(5);
  });

  // Only the heights are a draft; the arrangement across the row is the point.
  it('leaves the widths of a draft alone', () => {
    const wide = [{ flex: 1, cells: [
      { content: 'gauge_0', width: 25 }, { content: 'gauge_1', width: 75 }] }];
    const out = rowsAsCanvas({ layout_rows: wide }, 400, 400);
    expect(out.canvas.elements[1].x).toBeCloseTo(out.canvas.w * 0.25, 0);
  });

  it('repoints a cell pattern onto the surface that replaced the cell', () => {
    const slot = on({ color_patterns: [{ id: 1, target: 'r0c0', enabled: true }] });
    const out = rowsAsCanvas(slot, 600, 300);
    const moved = out.color_patterns[0].target;
    expect(moved).not.toBe('r0c0');
    // Whatever it now points at has to be something the canvas actually places.
    expect(out.canvas.elements.some(el => `elm_${el.id}` === moved || el.id === moved)).toBe(true);
  });

  it('survives every real dashboard layout on record', () => {
    for (const f of fixtures) {
      const out = rowsAsCanvas({ layout_active: true, layout_rows: f.layout_rows }, 500, 250);
      // An empty rows list is not a layout; everything else must produce one.
      if (!f.layout_rows.length) { expect(out).toBe(null); continue; }
      expect(Array.isArray(out.canvas.elements)).toBe(true);
      for (const el of out.canvas.elements) {
        expect(Number.isFinite(el.x) && Number.isFinite(el.y)).toBe(true);
        expect(el.w).toBeGreaterThan(0);
        expect(el.h).toBeGreaterThan(0);
      }
    }
  });
});

describe('canvasFromBox', () => {
  it('scales the longer side to 400 and keeps the ratio', () => {
    expect(canvasFromBox(800, 400)).toEqual({ w: 400, h: 200 });
    expect(canvasFromBox(200, 800)).toEqual({ w: 100, h: 400 });
    expect(canvasFromBox(300, 300)).toEqual({ w: 400, h: 400 });
  });

  it('has no ratio to give for a box with no area', () => {
    expect(canvasFromBox(0, 100)).toBe(null);
    expect(canvasFromBox(100, 0)).toBe(null);
    expect(canvasFromBox(undefined, undefined)).toBe(null);
  });
});
