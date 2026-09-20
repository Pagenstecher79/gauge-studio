import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CANVAS,
  DEFAULT_GRID,
  getCellItems,
  rowHeights,
  cellWidths,
  migrateLayoutToCanvas,
  paintedCells,
  colouredCells,
  glassedCells,
  soleElementTargets,
  clickedCells,
  deadCellTargets,
  repointPatterns,
  resolveSnap,
  gridToUnits,
  unitsToGrid,
  applyDrag,
  gridRowsToPx,
  reportedRows,
  isHeightPinned,
  isSquareLocked,
  isPinned,
  alignElements,
  restorePatch,
  reorderElement,
  overlaps,
  overlappingElements,
  squareElement,
  squareBarOnCanvas,
  gridColumnsToPx,
  sectionColumns,
  sectionWidthPx,
  markDialogClean,
  dialogHasUnsavedWork,
  editingDialog,
  gridSize,
  canvasFromGrid,
  defaultShapeRows,
  rowsForShape,
  canvasFromCard,
  rescaleCanvas,
  pinnedToShape,
  applyGroupDrag,
  elementsInRect,
  duplicateElements,
  distributeElements,
  roundBox,
  canDuplicate,
  canAddKind,
  addElement,
  newElementPreview,
  NEW_ELEMENT_KINDS,
} from './canvas-model.js';
import fixtures from './__fixtures__/real-layouts.json' with { type: 'json' };

// A canvas whose numbers make the arithmetic readable: 1 unit = 1 % of the
// card on both axes, so an expected value can be checked by eye.
const C = { w: 100, h: 100 };

describe('rowHeights', () => {
  it('gives an explicit flex straight back', () => {
    expect(rowHeights([{ flex: 60 }, { flex: 40 }])).toEqual([60, 40]);
  });

  it('shares what is left equally between the rows without one', () => {
    expect(rowHeights([{ flex: 50 }, {}, {}])).toEqual([50, 25, 25]);
  });

  it('treats flex 0 and a missing flex the same', () => {
    expect(rowHeights([{ flex: 0 }, {}])).toEqual([50, 50]);
  });

  it('does not shrink rows that add up to more than 100', () => {
    // Two rows at 60 % really do occupy 120 % and overflow the card today.
    // Normalising here would move every element on such a card.
    expect(rowHeights([{ flex: 60 }, { flex: 60 }])).toEqual([60, 60]);
  });

  it('gives auto rows nothing once the explicit ones fill the card', () => {
    expect(rowHeights([{ flex: 100 }, {}])).toEqual([100, 0]);
  });

  it('reads a flex written as a string', () => {
    expect(rowHeights([{ flex: '70' }, {}])).toEqual([70, 30]);
  });
});

describe('cellWidths', () => {
  it('defaults a cell without a width to the full row', () => {
    expect(cellWidths({ cells: [{}] })).toEqual([100]);
  });

  it('leaves the remainder empty when the cells do not fill the row', () => {
    // 20 % gap on the right, which the card really shows.
    expect(cellWidths({ cells: [{ width: 50 }, { width: 30 }] })).toEqual([50, 30]);
  });

  it('compresses cells proportionally when they overflow', () => {
    // Unlike rows: cells keep the default flex-shrink: 1.
    expect(cellWidths({ cells: [{ width: 100 }, { width: 100 }] })).toEqual([50, 50]);
    expect(cellWidths({ cells: [{ width: 150 }, { width: 50 }] })).toEqual([75, 25]);
  });

  it('splits evenly under auto_width, ignoring the stated widths', () => {
    expect(cellWidths({ auto_width: true, cells: [{ width: 90 }, { width: 10 }, {}] }))
      .toEqual([100 / 3, 100 / 3, 100 / 3]);
  });

  it('treats width 0 as unset, the way the renderer does', () => {
    // `cell.width || 100` - faithful reproduction, quirk included.
    expect(cellWidths({ cells: [{ width: 0 }] })).toEqual([100]);
  });

  it('survives a row with no cells', () => {
    expect(cellWidths({})).toEqual([]);
    expect(cellWidths({ cells: [] })).toEqual([]);
  });
});

describe('getCellItems', () => {
  it('passes a current item through, filling in the defaults', () => {
    const [item] = getCellItems({ items: [{ id: 'gauge_0', x: 10, y: 20, w: 30, h: 40 }] });
    expect(item).toMatchObject({
      id: 'gauge_0', x: 10, y: 20, w: 30, h: 40,
      inner: 'cc', font_unit: 'px', overflow: true,
    });
  });

  it('converts the legacy 3x3 grid coordinates', () => {
    const [item] = getCellItems({ items: [{ id: 'name', r: 2, c: 3 }] });
    expect(item.x).toBeCloseTo(66.666, 3);
    expect(item.y).toBeCloseTo(33.333, 3);
    expect(item.w).toBeCloseTo(33.333, 3);
  });

  it('spans the legacy grid with r2/c2', () => {
    const [item] = getCellItems({ items: [{ id: 'state', r: 1, c: 1, r2: 2, c2: 3 }] });
    expect(item.w).toBeCloseTo(99.999, 3);
    expect(item.h).toBeCloseTo(66.666, 3);
  });

  it('reads the older font field names', () => {
    const [item] = getCellItems({ items: [{ id: 'name', size_n: 18, weight_v: 700, color_n: '#abc', unit_n: 'pt' }] });
    expect(item).toMatchObject({ font_size: 18, font_weight: 700, font_color: '#abc', font_unit: 'pt' });
  });

  it('expands a legacy cell.content into one item', () => {
    expect(getCellItems({ content: 'gauge_0' })[0]).toMatchObject({ id: 'gauge_0', w: 100, h: 100 });
    // Only a gauge spans the cell by default.
    expect(getCellItems({ content: 'name' })[0].w).toBeCloseTo(33.333, 3);
  });

  it('yields nothing for an empty cell', () => {
    expect(getCellItems({})).toEqual([]);
    expect(getCellItems({ content: 'empty' })).toEqual([]);
    expect(getCellItems({ items: [] })).toEqual([]);
  });

  it('prefers items over a leftover content field', () => {
    expect(getCellItems({ content: 'gauge_0', items: [{ id: 'name', x: 0, y: 0, w: 1, h: 1 }] }))
      .toHaveLength(1);
    expect(getCellItems({ content: 'gauge_0', items: [{ id: 'name', x: 0, y: 0, w: 1, h: 1 }] })[0].id)
      .toBe('name');
  });
});

describe('migrateLayoutToCanvas', () => {
  it('places a single full-cell element over the whole canvas', () => {
    const { elements } = migrateLayoutToCanvas(
      [{ cells: [{ items: [{ id: 'gauge_0', x: 0, y: 0, w: 100, h: 100 }] }] }], C);
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ id: 'gauge_0', x: 0, y: 0, w: 100, h: 100 });
  });

  it('offsets by the row above and the cell to the left', () => {
    const { elements } = migrateLayoutToCanvas([
      { flex: 40, cells: [{ items: [{ id: 'a', x: 0, y: 0, w: 100, h: 100 }] }] },
      { flex: 60, cells: [
        { width: 30, items: [{ id: 'b', x: 0, y: 0, w: 100, h: 100 }] },
        { width: 70, items: [{ id: 'c', x: 0, y: 0, w: 100, h: 100 }] },
      ] },
    ], C);
    expect(elements.map(e => e.id)).toEqual(['a', 'b', 'c']);
    expect(elements[0]).toMatchObject({ x: 0, y: 0, w: 100, h: 40 });
    expect(elements[1]).toMatchObject({ x: 0, y: 40, w: 30, h: 60 });
    expect(elements[2]).toMatchObject({ x: 30, y: 40, w: 70, h: 60 });
  });

  it('nests an item percentage inside its cell', () => {
    // Half-width cell in the right half of the card; the item sits in the
    // middle quarter of that cell.
    const { elements } = migrateLayoutToCanvas([
      { cells: [
        { width: 50, items: [] },
        { width: 50, items: [{ id: 'x', x: 50, y: 50, w: 50, h: 50 }] },
      ] },
    ], C);
    expect(elements[0]).toMatchObject({ x: 75, y: 50, w: 25, h: 50 });
  });

  it('scales into the canvas units rather than percentages', () => {
    const { elements } = migrateLayoutToCanvas(
      [{ cells: [{ items: [{ id: 'g', x: 50, y: 50, w: 50, h: 50 }] }] }],
      { w: 400, h: 200 });
    expect(elements[0]).toMatchObject({ x: 200, y: 100, w: 200, h: 100 });
  });

  it('carries every other field over untouched', () => {
    const { elements } = migrateLayoutToCanvas([{ cells: [{ items: [{
      id: 'label_0', x: 0, y: 0, w: 100, h: 100,
      inner: 'tl', overflow: false, font_size: 18, font_weight: 700,
      font_color: '#f00', font_unit: 'pt', font_adaptive: true,
    }] }] }], C);
    expect(elements[0]).toMatchObject({
      inner: 'tl', overflow: false, font_size: 18, font_weight: 700,
      font_color: '#f00', font_unit: 'pt', font_adaptive: true,
    });
  });

  it('reproduces an over-full row instead of normalising it', () => {
    // Rows overflow, cells compress - the asymmetry that would move
    // everything if it were applied to the wrong axis.
    const { elements } = migrateLayoutToCanvas([
      { flex: 60, cells: [{ items: [{ id: 'a', x: 0, y: 0, w: 100, h: 100 }] }] },
      { flex: 60, cells: [{ items: [{ id: 'b', x: 0, y: 0, w: 100, h: 100 }] }] },
    ], C);
    expect(elements[0]).toMatchObject({ y: 0, h: 60 });
    expect(elements[1]).toMatchObject({ y: 60, h: 60 });   // runs past 100
  });

  it('compresses an over-full row of cells', () => {
    const { elements } = migrateLayoutToCanvas([{ cells: [
      { width: 100, items: [{ id: 'a', x: 0, y: 0, w: 100, h: 100 }] },
      { width: 100, items: [{ id: 'b', x: 0, y: 0, w: 100, h: 100 }] },
    ] }], C);
    expect(elements[0]).toMatchObject({ x: 0, w: 50 });
    expect(elements[1]).toMatchObject({ x: 50, w: 50 });
  });

  it('keeps document order, so stacking survives', () => {
    const { elements } = migrateLayoutToCanvas([{ cells: [{ items: [
      { id: 'under', x: 0, y: 0, w: 100, h: 100 },
      { id: 'over', x: 0, y: 0, w: 100, h: 100 },
    ] }] }], C);
    expect(elements.map(e => e.id)).toEqual(['under', 'over']);
  });

  it('invents no surfaces when nothing targets a cell', () => {
    const { elements, cellTargets, warnings } = migrateLayoutToCanvas([
      { cells: [{ items: [{ id: 'gauge_0', x: 0, y: 0, w: 100, h: 100 }] }] },
    ], C);
    expect(elements.map(e => e.id)).toEqual(['gauge_0']);
    expect(cellTargets).toEqual({});
    expect(warnings).toEqual([]);
  });

  it('turns a targeted cell into a surface with the cell geometry', () => {
    const { elements, cellTargets, warnings } = migrateLayoutToCanvas([
      { flex: 40, cells: [
        { width: 30, items: [{ id: 'a', x: 25, y: 25, w: 50, h: 50 }] },
        { width: 70, items: [] },
      ] },
      { flex: 60, cells: [{ items: [] }] },
    ], C, { targetedCells: ['r0c0'] });
    const surface = elements.find(e => e.surface);
    // The cell's box, not the element's: the pattern painted the whole cell.
    expect(surface).toMatchObject({ id: 'surface_0', x: 0, y: 0, w: 30, h: 40 });
    expect(cellTargets).toEqual({ r0c0: 'elm_surface_0' });
    expect(warnings).toEqual([]);
  });

  it('puts the surface behind the elements of its cell', () => {
    const { elements } = migrateLayoutToCanvas([
      { cells: [{ items: [{ id: 'a', x: 0, y: 0, w: 100, h: 100 }] }] },
    ], C, { targetedCells: ['r0c0'] });
    // Stacking is array order, so the surface has to come first.
    expect(elements.map(e => e.id)).toEqual(['surface_0', 'a']);
  });

  it('gives a cell holding several elements one surface, exactly', () => {
    // The case that used to fall back to the whole card.
    const { elements, cellTargets, warnings } = migrateLayoutToCanvas([
      { cells: [{ items: [
        { id: 'name', x: 0, y: 0, w: 50, h: 100 },
        { id: 'state', x: 50, y: 0, w: 50, h: 100 },
      ] }] },
    ], C, { targetedCells: ['r0c0'] });
    expect(elements.map(e => e.id)).toEqual(['surface_0', 'name', 'state']);
    expect(cellTargets).toEqual({ r0c0: 'elm_surface_0' });
    expect(warnings).toEqual([]);
  });

  it('gives an empty targeted cell a surface too', () => {
    const { elements, cellTargets } = migrateLayoutToCanvas(
      [{ cells: [{}] }], C, { targetedCells: ['r0c0'] });
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ id: 'surface_0', surface: true, w: 100, h: 100 });
    expect(cellTargets).toEqual({ r0c0: 'elm_surface_0' });
  });

  it('numbers surfaces across the whole card', () => {
    const { cellTargets } = migrateLayoutToCanvas([
      { cells: [{}, {}] },
      { cells: [{}] },
    ], C, { targetedCells: ['r0c1', 'r1c0'] });
    expect(cellTargets).toEqual({ r0c1: 'elm_surface_0', r1c0: 'elm_surface_1' });
  });

  it('drops a target naming a cell that does not exist, and says why', () => {
    // Real dashboards carry these: a row was deleted and the pattern kept
    // pointing at it, so it has been doing nothing for a while already.
    const { elements, cellTargets, warnings } = migrateLayoutToCanvas([
      { cells: [{ items: [{ id: 'a', x: 0, y: 0, w: 100, h: 100 }] }] },
    ], C, { targetedCells: ['r2c0'] });
    expect(elements.map(e => e.id)).toEqual(['a']);
    expect(cellTargets).toEqual({});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('r2c0');
  });

  it('survives configurations that are missing or malformed', () => {
    expect(migrateLayoutToCanvas(undefined).elements).toEqual([]);
    expect(migrateLayoutToCanvas([]).elements).toEqual([]);
    expect(migrateLayoutToCanvas([{}]).elements).toEqual([]);
    expect(migrateLayoutToCanvas([{ cells: [] }]).elements).toEqual([]);
  });

  it('defaults to a 400x200 canvas', () => {
    const { elements } = migrateLayoutToCanvas(
      [{ cells: [{ items: [{ id: 'g', x: 0, y: 0, w: 100, h: 100 }] }] }]);
    expect(elements[0]).toMatchObject({ w: DEFAULT_CANVAS.w, h: DEFAULT_CANVAS.h });
  });

  it('migrates a legacy content-only layout', () => {
    const { elements } = migrateLayoutToCanvas([
      { flex: 50, cells: [{ content: 'gauge_0' }] },
      { flex: 50, cells: [{ content: 'name' }, { content: 'empty' }] },
    ], C);
    expect(elements.map(e => e.id)).toEqual(['gauge_0', 'name']);
    // The cell is 100x50; the gauge is inscribed in it and centred, which is
    // where it was already being drawn. See "migration squares gauges".
    expect(elements[0]).toMatchObject({ x: 25, y: 0, w: 50, h: 50 });
    // `name` does not span, so a third of its cell; the cell is a full row
    // because widths default to 100 and the empty one takes the other 100,
    // so both compress to half.
    expect(elements[1].x).toBe(0);
    expect(elements[1].y).toBe(50);
    // 16.6665 of a canvas, rounded: a coordinate is a whole number - see
    // `roundBox`.
    expect(elements[1].w).toBe(17);
  });
});

// --- Against real configurations -----------------------------------------
// 23 distinct layouts taken from a live dashboard (they stand for 30 cards;
// duplicates collapsed). Structural only - the file contains no entity ids.
// The geometry these produce was compared against the boxes the current
// renderer actually draws in a browser: worst deviation 0.0023 percentage
// points over 55 element boxes. These tests keep that from regressing.
describe('real dashboard layouts', () => {
  const all = fixtures.map(f => ({
    ...f,
    result: migrateLayoutToCanvas(f.layout_rows, DEFAULT_CANVAS,
      { targetedCells: f.targets }),
  }));

  it('covers the shapes worth having a fixture for', () => {
    const cells = fixtures.flatMap(f => f.layout_rows.flatMap(r => r.cells || []));
    expect(fixtures.length).toBe(23);
    // The legacy `content` form is the majority case in the wild, not a relic.
    expect(cells.filter(c => c.content && c.content !== 'empty').length)
      .toBeGreaterThan(cells.filter(c => (c.items || []).length).length);
    expect(fixtures.some(f => f.layout_rows.some(r => r.auto_width))).toBe(true);
    expect(fixtures.some(f => f.layout_rows.some(r => (r.cells || []).some(c => (c.items || []).some(i => i.r !== undefined))))).toBe(true);
    expect(fixtures.filter(f => f.targets.length).length).toBeGreaterThan(0);
  });

  it('produces usable geometry for every one of them', () => {
    for (const { i, result } of all) {
      for (const e of result.elements) {
        expect(Number.isFinite(e.x), `card ${i} / ${e.id} x`).toBe(true);
        expect(Number.isFinite(e.y), `card ${i} / ${e.id} y`).toBe(true);
        expect(e.w, `card ${i} / ${e.id} w`).toBeGreaterThan(0);
        expect(e.h, `card ${i} / ${e.id} h`).toBeGreaterThan(0);
        expect(e.x, `card ${i} / ${e.id} x`).toBeGreaterThanOrEqual(0);
        expect(e.y, `card ${i} / ${e.id} y`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps every element these cards already had', () => {
    for (const { i, layout_rows, result } of all) {
      const expected = layout_rows.reduce(
        (a, r) => a + (r.cells || []).reduce((b, c) => b + getCellItems(c).length, 0), 0);
      const surfaces = result.elements.filter(e => e.surface).length;
      expect(result.elements.length - surfaces, `card ${i}`).toBe(expected);
    }
  });

  it('resolves every cell target that still points at something', () => {
    let surfaced = 0, dropped = 0;
    for (const { layout_rows, targets, result } of all) {
      for (const t of targets) {
        const [, ri, ci] = /^r(\d+)c(\d+)$/.exec(t);
        const exists = !!((layout_rows[+ri] || {}).cells || [])[+ci];
        if (exists) { expect(result.cellTargets[t]).toMatch(/^elm_surface_\d+$/); surfaced++; }
        else { expect(result.cellTargets[t]).toBeUndefined(); dropped++; }
      }
    }
    // Every live target becomes a surface; the dead ones are dropped, and
    // they are the majority - these are stale references to deleted rows.
    expect(surfaced).toBe(7);
    expect(dropped).toBe(6);
  });

  it('says something about each target it dropped', () => {
    for (const { targets, result } of all) {
      const dead = targets.filter(t => result.cellTargets[t] === undefined);
      expect(result.warnings).toHaveLength(dead.length);
      for (const t of dead) expect(result.warnings.join(' ')).toContain(t);
    }
  });
});

describe('paintedCells / clickedCells', () => {
  it('collects paint targets out of the two paint lists only', () => {
    expect(paintedCells({
      color_patterns: [{ target: 'r0c0' }, { target: 'main' }],
      fx_glass_patterns: [{ target: 'r1c1' }],
      interactions: [{ target: 'r2c2' }],
    }).sort()).toEqual(['r0c0', 'r1c1']);
  });

  it('keeps interaction targets apart, since a surface cannot take a click', () => {
    expect(clickedCells({
      color_patterns: [{ target: 'r0c0' }],
      interactions: [{ target: 'elm_gauge_0' }, { target: 'r2c2' }, { target: 'r2c2' }],
    })).toEqual(['r2c2']);
  });

  it('is quiet about a configuration with no patterns at all', () => {
    expect(paintedCells({})).toEqual([]);
    expect(paintedCells(undefined)).toEqual([]);
    expect(clickedCells(undefined)).toEqual([]);
  });
});

describe('deadCellTargets', () => {
  const rows = [{ cells: [{}, {}] }, { cells: [{}] }];

  it('finds the targets naming a cell the layout does not have', () => {
    expect(deadCellTargets({
      layout_rows: rows,
      color_patterns: [{ target: 'r0c1' }, { target: 'r1c1' }, { target: 'r2c0' }],
      interactions: [{ target: 'r9c9' }],
    }).sort()).toEqual(['r1c1', 'r2c0', 'r9c9']);
  });

  it('calls every cell target dead when there is no layout at all', () => {
    expect(deadCellTargets({ color_patterns: [{ target: 'r0c0' }] })).toEqual(['r0c0']);
  });

  it('says nothing about a card with no cell targets', () => {
    expect(deadCellTargets({ layout_rows: rows, color_patterns: [{ target: 'main' }] })).toEqual([]);
  });
});

describe('repointPatterns', () => {
  const cellTargets = { r0c0: 'elm_surface_0', r1c0: 'elm_surface_1' };

  it('points a mapped cell target at its surface and counts the change', () => {
    const slot = {
      color_patterns: [{ id: 1, target: 'r0c0', colors: ['#f00'] }, { id: 2, target: 'main' }],
      fx_glass_patterns: [{ id: 3, target: 'r1c0' }],
    };
    const { lists, changed } = repointPatterns(slot, cellTargets);
    expect(changed).toBe(2);
    expect(lists.color_patterns[0]).toEqual({ id: 1, target: 'elm_surface_0', colors: ['#f00'] });
    expect(lists.color_patterns[1]).toEqual({ id: 2, target: 'main' });
    expect(lists.fx_glass_patterns[0]).toEqual({ id: 3, target: 'elm_surface_1' });
  });

  it('never mutates the lists it was given', () => {
    const slot = { color_patterns: [{ id: 1, target: 'r0c0' }] };
    repointPatterns(slot, cellTargets);
    expect(slot.color_patterns[0].target).toBe('r0c0');
  });

  it('leaves an unmapped target exactly as it is', () => {
    const slot = { color_patterns: [{ id: 1, target: 'r7c7', colors: ['#0f0'] }] };
    const { lists, changed } = repointPatterns(slot, cellTargets);
    expect(changed).toBe(0);
    expect(lists).toEqual({});
  });

  it('returns only the lists that changed, so the merge stays small', () => {
    const slot = {
      color_patterns: [{ id: 1, target: 'r0c0' }],
      fx_glass_patterns: [{ id: 2, target: 'main' }],
    };
    expect(Object.keys(repointPatterns(slot, cellTargets).lists)).toEqual(['color_patterns']);
  });

  it('does not touch interactions, which cannot use a surface', () => {
    const slot = { interactions: [{ id: 1, target: 'r0c0' }] };
    expect(repointPatterns(slot, cellTargets).lists).toEqual({});
  });

  it('survives a missing list and an empty map', () => {
    expect(repointPatterns({}, cellTargets).lists).toEqual({});
    expect(repointPatterns({ color_patterns: [{ target: 'r0c0' }] }, {}).lists).toEqual({});
    expect(repointPatterns(undefined, cellTargets).changed).toBe(0);
  });
});

describe('canvasFromCard', () => {
  const card = { grid_options: { columns: 6, rows: 4 } };

  it('arranges the card own three the way the content row does', () => {
    const canvas = canvasFromCard(card, {});
    expect(canvas.elements.map(e => e.id)).toEqual(['icon', 'name', 'state']);
    const [icon, name, state] = canvas.elements;
    // icon at the left, the two lines stacked beside it
    expect(icon.x).toBeLessThan(name.x);
    expect(name.x).toBe(state.x);
    expect(name.y).toBeLessThan(state.y);
    expect(icon.w).toBe(icon.h);
    // the icon centres against the two lines, as it does in the content row
    const mid = el => el.y + el.h / 2;
    expect(Math.abs(mid(icon) - (name.y + (state.y + state.h - name.y) / 2))).toBeLessThanOrEqual(1);
  });

  it('keeps the header a row on a tall card, not a block', () => {
    const canvas = canvasFromCard({ grid_options: { columns: 3, rows: 6 } }, {});
    const top = Math.min(...canvas.elements.map(e => e.y));
    const bottom = Math.max(...canvas.elements.map(e => e.y + e.h));
    expect(bottom - top).toBeLessThanOrEqual(canvas.h * 0.25);
  });

  it('centres a header that has nothing under it', () => {
    const canvas = canvasFromCard({ grid_options: { columns: 3, rows: 6 } }, {});
    const top = Math.min(...canvas.elements.map(e => e.y));
    const bottom = Math.max(...canvas.elements.map(e => e.y + e.h));
    // The cap has nothing to make room for here, so the space is shared.
    expect(Math.abs(top - (canvas.h - bottom))).toBeLessThanOrEqual(1);
  });

  it('leaves the header at the top when something is under it', () => {
    const canvas = canvasFromCard({ grid_options: { columns: 3, rows: 6 } },
      { gauge_active: true, gauges: [{}] });
    const gauge = canvas.elements.find(e => e.id === 'gauge_0');
    const header = canvas.elements.filter(e => e.id !== 'gauge_0');
    expect(Math.max(...header.map(e => e.y + e.h))).toBeLessThanOrEqual(gauge.y);
    expect(Math.min(...header.map(e => e.y))).toBeLessThan(canvas.h * 0.1);
  });

  it('gives the two lines the whole band when the icon is hidden', () => {
    const canvas = canvasFromCard(card, { hide_icon: true });
    const [name, state] = canvas.elements;
    expect(name.x).toBe(state.x);
    expect(name.w).toBeGreaterThan(canvas.w * 0.8);
  });

  it('fills the band rather than taking a default box', () => {
    const canvas = canvasFromCard(card, {
      hide_icon: true, hide_entity_name: true, hide_entity_state: true,
      progressbar_active: true, progressbars: [{}],
    });
    const [bar] = canvas.elements;
    expect(bar.w).toBeGreaterThan(canvas.w * 0.8);
    expect(bar.h).toBeGreaterThan(canvas.h * 0.5);
  });

  it('keeps a gauge square and centred in its band', () => {
    const canvas = canvasFromCard(card, {
      hide_icon: true, hide_entity_name: true, hide_entity_state: true,
      gauge_active: true, gauges: [{}],
    });
    const [g] = canvas.elements;
    expect(g.w).toBe(g.h);
    expect(Math.abs((g.x + g.w / 2) - canvas.w / 2)).toBeLessThanOrEqual(1);
  });

  it('leaves out what the card has switched off', () => {
    const canvas = canvasFromCard(card, { hide_icon: true, hide_entity_state: true });
    expect(canvas.elements.map(e => e.id)).toEqual(['name']);
  });

  it('gives every drawn gauge, bar and label a band of its own below', () => {
    const canvas = canvasFromCard(card, {
      hide_icon: true, hide_entity_name: true, hide_entity_state: true,
      gauge_active: true, gauges: [{}, {}],
      progressbar_active: true, progressbars: [{}],
      labels_list: [{ enabled: true }],
    });
    expect(canvas.elements.map(e => e.id))
      .toEqual(['gauge_0', 'gauge_1', 'progressbar_0', 'label_0']);
    const ys = canvas.elements.map(e => e.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it('never resurrects what a module switch has switched off', () => {
    const canvas = canvasFromCard(card, {
      hide_icon: true, hide_entity_name: true, hide_entity_state: true,
      gauges: [{}], progressbars: [{}], gauge_active: false, progressbar_active: false,
    });
    expect(canvas.elements).toEqual([]);
  });

  it('honours a bar switched off on its own, and a label not enabled', () => {
    const canvas = canvasFromCard(card, {
      hide_icon: true, hide_entity_name: true, hide_entity_state: true,
      progressbar_active: true, progressbars: [{ active: false }, {}],
      labels_list: [{ enabled: false }, { enabled: true }],
    });
    expect(canvas.elements.map(e => e.id)).toEqual(['progressbar_1', 'label_1']);
  });

  it('carries the legacy single gauge over', () => {
    const canvas = canvasFromCard(card, { gauge_active: true, entity: 'sensor.a' });
    expect(canvas.elements.map(e => e.id)).toContain('gauge_0');
  });

  it('takes the shape of the card box, not a default', () => {
    const wide = canvasFromCard({ grid_options: { columns: 12, rows: 2 } }, {});
    const tall = canvasFromCard({ grid_options: { columns: 3, rows: 8 } }, {});
    expect(wide.w / wide.h).toBeGreaterThan(tall.w / tall.h);
  });

  it('keeps every box on the canvas', () => {
    const canvas = canvasFromCard(card, {
      gauge_active: true, gauges: [{}, {}], labels_list: [{ enabled: true }, { enabled: true }],
    });
    for (const el of canvas.elements) {
      expect(el.x).toBeGreaterThanOrEqual(0);
      expect(el.y).toBeGreaterThanOrEqual(0);
      expect(el.x + el.w).toBeLessThanOrEqual(canvas.w);
      expect(el.y + el.h).toBeLessThanOrEqual(canvas.h);
    }
  });

  it('never returns an empty canvas for a card that draws something', () => {
    expect(canvasFromCard(card, {}).elements.length).toBeGreaterThan(0);
  });

  it('shapes a full-width card to the section it is in', () => {
    // The same trap Convert had: a card filling a section two columns wide is
    // 968px, not 480, and given one section's worth it would take the ratio of
    // a card half its width and letterbox everything on it.
    const full = { grid_options: { columns: 'full', rows: 4 } };
    expect(canvasFromCard(full, {}, 24).h).toBeLessThan(canvasFromCard(full, {}).h);
    expect(canvasFromCard(full, {}, 24)).toMatchObject(
      { w: canvasFromGrid(full, {}, 400, 24).w, h: canvasFromGrid(full, {}, 400, 24).h });
  });

  it('leaves a card narrower than one section alone', () => {
    const six = { grid_options: { columns: 6, rows: 4 } };
    expect(canvasFromCard(six, {}, 24).h).toBe(canvasFromCard(six, {}).h);
  });
});

describe('resolveSnap', () => {
  it('snaps to the visible grid when snap is unset', () => {
    expect(resolveSnap({ grid: 20 })).toBe(20);
  });
  it('reads snap 0 as free placement, one unit at a time', () => {
    expect(resolveSnap({ grid: 20, snap: 0 })).toBe(1);
  });
  it('prefers an explicit step over the grid', () => {
    expect(resolveSnap({ grid: 20, snap: 5 })).toBe(5);
  });
  it('falls back to the default grid with nothing configured', () => {
    expect(resolveSnap({})).toBe(DEFAULT_GRID);
    expect(resolveSnap(undefined)).toBe(DEFAULT_GRID);
  });
  it('keeps free placement distinct from the default grid', () => {
    // The two used to resolve to the same step, so "Free" and "Snap to grid"
    // were one behaviour offered as two.
    expect(resolveSnap({ snap: 0 })).not.toBe(resolveSnap({}));
  });
  it('reads the grid as per cent of the width when the unit says so', () => {
    expect(resolveSnap({ w: 400, h: 200, grid: 2.5, grid_unit: 'pct' })).toBe(10);
    expect(resolveSnap({ w: 320, h: 320, grid: 10, grid_unit: 'pct' })).toBe(32);
  });
  it('reads an explicit step in that unit too', () => {
    expect(resolveSnap({ w: 400, h: 200, grid: 2.5, snap: 5, grid_unit: 'pct' })).toBe(20);
  });
  it('leaves free placement alone whatever the unit', () => {
    expect(resolveSnap({ w: 400, grid: 2.5, snap: 0, grid_unit: 'pct' })).toBe(1);
  });
  it('falls back to the default grid in units, not per cent', () => {
    // The fallback stands in for a canvas nobody configured, so there is no
    // percentage to honour - 10 per cent of a 400 canvas would be a 40 step.
    expect(resolveSnap({ w: 400, grid_unit: 'pct' })).toBe(DEFAULT_GRID);
  });
});

describe('gridToUnits / unitsToGrid', () => {
  it('leaves a number alone without the per cent unit', () => {
    expect(gridToUnits({ w: 400 }, 10)).toBe(10);
    expect(gridToUnits({ w: 400, grid_unit: 'px' }, 10)).toBe(10);
  });
  it('resolves per cent against the width', () => {
    expect(gridToUnits({ w: 400, h: 100, grid_unit: 'pct' }, 25)).toBe(100);
  });
  it('rounds to whole units, and never below one', () => {
    // Coordinates are typed and read in the editor's number fields, so the
    // step that produces them has to be whole - and a step of zero would
    // divide the drag by nothing.
    expect(gridToUnits({ w: 350, grid_unit: 'pct' }, 3)).toBe(11);
    expect(gridToUnits({ w: 400, grid_unit: 'pct' }, 0.1)).toBe(1);
  });
  it('treats nothing, zero and negatives as no step', () => {
    expect(gridToUnits({ w: 400, grid_unit: 'pct' }, 0)).toBe(0);
    expect(gridToUnits({ w: 400 }, -5)).toBe(0);
    expect(gridToUnits({ w: 400 }, undefined)).toBe(0);
  });
  it('falls back to the default width when the canvas has none', () => {
    expect(gridToUnits({ grid_unit: 'pct' }, 10)).toBe(DEFAULT_CANVAS.w / 10);
  });
  it('round-trips a step through the unit switch', () => {
    for (const w of [400, 350, 320, 1000]) {
      for (const units of [1, 2, 5, 10, 25, 50]) {
        expect(gridToUnits({ w, grid_unit: 'pct' }, unitsToGrid({ w }, units))).toBe(units);
      }
    }
  });
  it('reports no percentage for a step that is not one', () => {
    expect(unitsToGrid({ w: 400 }, 0)).toBe(0);
    expect(unitsToGrid({ w: 400 }, undefined)).toBe(0);
  });
});

describe('isPinned', () => {
  it('is true only for locked: true', () => {
    expect(isPinned({ locked: true })).toBe(true);
    for (const v of [false, undefined, null, 0, '', 'true', 1, 'yes'])
      expect(isPinned({ locked: v })).toBe(false);
    expect(isPinned({})).toBe(false);
    expect(isPinned(undefined)).toBe(false);
  });

  it('is not the shape lock', () => {
    expect(isPinned({ id: 'gauge_0' })).toBe(false);
    expect(isSquareLocked({ id: 'name', locked: true })).toBe(false);
  });
});

describe('applyDrag', () => {
  const canvas = { w: 400, h: 200, grid: 10 };
  const el = { x: 100, y: 50, w: 80, h: 40 };

  it('moves by the delta, snapped to the grid', () => {
    // 113 -> 110 and 43 -> 40: both snapped, neither merely rounded toward
    // where the pointer was.
    expect(applyDrag(canvas, el, 'move', { dx: 13, dy: -7 }))
      .toEqual({ x: 110, y: 40, w: 80, h: 40 });
  });

  it('keeps a moved element inside the canvas', () => {
    expect(applyDrag(canvas, el, 'move', { dx: 9999, dy: 9999 }))
      .toEqual({ x: 320, y: 160, w: 80, h: 40 });
    expect(applyDrag(canvas, el, 'move', { dx: -9999, dy: -9999 }))
      .toEqual({ x: 0, y: 0, w: 80, h: 40 });
  });

  it('will not move or resize a pinned element, however far the pointer went', () => {
    const pinned = { ...el, locked: true };
    for (const mode of ['move', 'resize']) {
      for (const delta of [{ dx: 13, dy: -7 }, { dx: 9999, dy: 9999 }, { dx: -9999, dy: -9999 }]) {
        expect(applyDrag(canvas, pinned, mode, delta)).toEqual({ x: 100, y: 50, w: 80, h: 40 });
      }
    }
  });

  it('pins a square-locked element just as firmly', () => {
    // The two locks are unrelated, and the shape one must not swallow the
    // other: a gauge's resize branch has its own return, reached first.
    const gauge = { id: 'gauge_0', x: 100, y: 50, w: 80, h: 80, locked: true };
    expect(applyDrag(canvas, gauge, 'resize', { dx: 40, dy: 40 }))
      .toEqual({ x: 100, y: 50, w: 80, h: 80 });
  });

  it('moves an element that only says locked: false', () => {
    // Everything that is not exactly true is unpinned, so a leftover key
    // cannot silently freeze an element someone can still drag.
    for (const v of [false, undefined, null, 0, '', 'true', 1]) {
      expect(applyDrag(canvas, { ...el, locked: v }, 'move', { dx: 13, dy: -7 }))
        .toEqual({ x: 110, y: 40, w: 80, h: 40 });
    }
  });

  it('resizes without moving the origin', () => {
    expect(applyDrag(canvas, el, 'resize', { dx: 24, dy: 11 }))
      .toEqual({ x: 100, y: 50, w: 100, h: 50 });
  });

  it('never resizes past the canvas edge, or below one step', () => {
    expect(applyDrag(canvas, el, 'resize', { dx: 9999, dy: 9999 }))
      .toEqual({ x: 100, y: 50, w: 300, h: 150 });
    expect(applyDrag(canvas, el, 'resize', { dx: -9999, dy: -9999 }))
      .toEqual({ x: 100, y: 50, w: 10, h: 10 });
  });

  it('places freely when snapping is off', () => {
    expect(applyDrag({ ...canvas, snap: 0 }, el, 'move', { dx: 13, dy: -7 }))
      .toEqual({ x: 113, y: 43, w: 80, h: 40 });
  });
});


describe('gridRowsToPx', () => {
  it('matches hui-grid-section: rows * (56 + 8) - 8', () => {
    expect(gridRowsToPx(1)).toBe(56);
    expect(gridRowsToPx(2)).toBe(120);
    expect(gridRowsToPx(4)).toBe(248);
  });

  it('never returns less than one row', () => {
    expect(gridRowsToPx(0)).toBe(56);
    expect(gridRowsToPx(-3)).toBe(56);
    expect(gridRowsToPx(undefined)).toBe(56);
    expect(gridRowsToPx('nonsense')).toBe(56);
  });
});

describe('reportedRows', () => {
  it('lets a canvas card size itself', () => {
    expect(reportedRows({ canvas: { w: 400, h: 200, elements: [] } })).toBe('auto');
  });

  it('keeps the fixed default for a row/cell card, whose rows are percentages', () => {
    expect(reportedRows({})).toBe(3);
    expect(reportedRows(undefined)).toBe(3);
    expect(reportedRows({ layout_rows: [] })).toBe(3);
  });

  it('honours an explicit grid_rows on a row/cell card', () => {
    expect(reportedRows({ grid_rows: 6 })).toBe(6);
    expect(reportedRows({ grid_rows: 0 })).toBe(3);
  });
});

describe('isHeightPinned', () => {
  it('is pinned by a row count from the layout tab', () => {
    expect(isHeightPinned({ grid_options: { rows: 4 } })).toBe(true);
    expect(isHeightPinned({ grid_options: { rows: 1, columns: 6 } })).toBe(true);
  });

  it('is not pinned by auto height, or by no grid_options at all', () => {
    expect(isHeightPinned({ grid_options: { rows: 'auto' } })).toBe(false);
    expect(isHeightPinned({ grid_options: { columns: 6 } })).toBe(false);
    expect(isHeightPinned({ grid_options: {} })).toBe(false);
    expect(isHeightPinned({})).toBe(false);
    expect(isHeightPinned(undefined)).toBe(false);
  });
});

describe('isSquareLocked', () => {
  const bars = slotBars => ({ progressbars: slotBars });

  it('locks gauges, and nothing else it can answer for alone', () => {
    expect(isSquareLocked({ id: 'gauge_0' })).toBe(true);
    expect(isSquareLocked({ id: 'gauge_11' })).toBe(true);
    expect(isSquareLocked({ id: 'progressbar_0' })).toBe(false);
    expect(isSquareLocked({ id: 'label_0' })).toBe(false);
    expect(isSquareLocked({ id: 'icon' })).toBe(false);
  });

  it('locks a bar that is drawn as a ring', () => {
    for (const orientation of ['circular', 'circular_donut', 'circular_speedo', 'circular_half']) {
      expect(isSquareLocked({ id: 'progressbar_0' }, bars([{ orientation }])),
             orientation).toBe(true);
    }
  });

  it('leaves a straight bar alone', () => {
    for (const orientation of ['horizontal', 'vertical', undefined]) {
      expect(isSquareLocked({ id: 'progressbar_0' }, bars([{ orientation }]))).toBe(false);
    }
    expect(isSquareLocked({ id: 'progressbar_0' }, bars([{}]))).toBe(false);
  });

  it('reads the bar at the index its id names', () => {
    const slot = bars([{ orientation: 'horizontal' }, { orientation: 'circular_donut' }]);
    expect(isSquareLocked({ id: 'progressbar_0' }, slot)).toBe(false);
    expect(isSquareLocked({ id: 'progressbar_1' }, slot)).toBe(true);
    // An id past the end of the list is not a ring, and not a crash either.
    expect(isSquareLocked({ id: 'progressbar_9' }, slot)).toBe(false);
  });

  it('survives a slot that is not one', () => {
    for (const slot of [null, undefined, {}, { progressbars: null }, { progressbars: 'no' }]) {
      expect(isSquareLocked({ id: 'progressbar_0' }, /** @type {any} */ (slot))).toBe(false);
    }
  });

  it('never asks the slot about a gauge', () => {
    expect(isSquareLocked({ id: 'gauge_0' }, bars([{ orientation: 'horizontal' }]))).toBe(true);
  });

  it('never locks a surface, even one sitting over a gauge', () => {
    expect(isSquareLocked({ id: 'gauge_0', surface: true })).toBe(false);
    expect(isSquareLocked({ id: 'surface_0' })).toBe(false);
  });

  it('survives an element with no id', () => {
    expect(isSquareLocked({})).toBe(false);
    expect(isSquareLocked(undefined)).toBe(false);
  });
});

describe('squareElement', () => {
  it('centres the square by default, so the picture does not move', () => {
    expect(squareElement({ id: 'gauge_0', x: 0, y: 0, w: 200, h: 100 }))
      .toMatchObject({ x: 50, y: 0, w: 100, h: 100 });
    expect(squareElement({ id: 'gauge_0', x: 10, y: 20, w: 40, h: 100 }))
      .toMatchObject({ x: 10, y: 50, w: 40, h: 40 });
  });

  it('anchors the square the way inner aligns the content', () => {
    const box = { id: 'gauge_0', x: 0, y: 0, w: 200, h: 100 };
    expect(squareElement({ ...box, inner: 'tl' })).toMatchObject({ x: 0, y: 0 });
    expect(squareElement({ ...box, inner: 'br' })).toMatchObject({ x: 100, y: 0 });
    expect(squareElement({ ...box, inner: 'cr' })).toMatchObject({ x: 100, y: 0 });
    expect(squareElement({ id: 'gauge_0', x: 0, y: 0, w: 100, h: 200, inner: 'bl' }))
      .toMatchObject({ x: 0, y: 100, w: 100, h: 100 });
  });

  it('leaves an already square element exactly where it is', () => {
    const el = { id: 'gauge_0', x: 7, y: 9, w: 40, h: 40, inner: 'tl' };
    expect(squareElement(el)).toEqual(el);
  });

  it('carries every other field over untouched', () => {
    const out = squareElement({ id: 'gauge_0', x: 0, y: 0, w: 200, h: 100, overflow: false, font_size: 12 });
    expect(out.overflow).toBe(false);
    expect(out.font_size).toBe(12);
  });
});

describe('squareBarOnCanvas', () => {
  const canvas = () => ({ w: 400, h: 300, elements: [
    { id: 'progressbar_0', x: 0,  y: 0,  w: 220, h: 40 },
    { id: 'progressbar_1', x: 10, y: 50, w: 200, h: 100, inner: 'tl' },
    { id: 'gauge_0',       x: 0,  y: 0,  w: 80,  h: 80 },
  ] });

  it('squares the bar that turned into a ring', () => {
    const out = squareBarOnCanvas(canvas(), 1, 'circular_donut');
    expect(out.elements[1]).toMatchObject({ x: 10, y: 50, w: 100, h: 100 });
  });

  it('squares for every circular orientation', () => {
    for (const o of ['circular_donut', 'circular_speedo', 'circular_half']) {
      expect(squareBarOnCanvas(canvas(), 1, o).elements[1]).toMatchObject({ w: 100, h: 100 });
    }
  });

  it('touches no other element', () => {
    const out = squareBarOnCanvas(canvas(), 1, 'circular_donut');
    expect(out.elements[0]).toEqual(canvas().elements[0]);
    expect(out.elements[2]).toEqual(canvas().elements[2]);
  });

  it('leaves a straight orientation alone', () => {
    // Going back to a straight bar keeps the square: it is a size like any
    // other once it exists, and nobody asked for the old box back.
    for (const o of ['horizontal', 'vertical', '', undefined]) {
      const c = canvas();
      expect(squareBarOnCanvas(c, 1, /** @type {any} */ (o))).toBe(c);
    }
  });

  it('hands back the very same canvas when there was nothing to square', () => {
    // The editor commits only when this changes something, so identity is the
    // signal and not merely an optimisation.
    const c = canvas();
    expect(squareBarOnCanvas(c, 0, 'horizontal')).toBe(c);
    expect(squareBarOnCanvas(c, 2, 'circular_donut')).toBe(c);
    const square = { w: 400, h: 300, elements: [{ id: 'progressbar_0', x: 0, y: 0, w: 60, h: 60 }] };
    expect(squareBarOnCanvas(square, 0, 'circular_donut')).toBe(square);
  });

  it('does not mutate the canvas it was given', () => {
    const c = canvas();
    squareBarOnCanvas(c, 1, 'circular_donut');
    expect(c.elements[1]).toMatchObject({ w: 200, h: 100 });
  });

  it('leaves whole numbers behind', () => {
    const c = { w: 400, h: 300, elements: [{ id: 'progressbar_0', x: 0, y: 0, w: 101, h: 40.4 }] };
    expect(squareBarOnCanvas(c, 0, 'circular_donut').elements[0])
      .toMatchObject({ x: 30, y: 0, w: 40, h: 40 });
  });

  it('survives a canvas that is not one', () => {
    for (const c of [undefined, null, {}, { elements: null }]) {
      expect(squareBarOnCanvas(/** @type {any} */ (c), 0, 'circular_donut')).toBe(c);
    }
  });
});

describe('applyDrag with a square-locked element', () => {
  const c = { w: 100, h: 100, grid: 10 };

  it('resizes to one side, taken from the axis dragged further', () => {
    const el = { id: 'gauge_0', x: 0, y: 0, w: 20, h: 20 };
    expect(applyDrag(c, el, 'resize', { dx: 30, dy: 2 })).toEqual({ x: 0, y: 0, w: 50, h: 50 });
    expect(applyDrag(c, el, 'resize', { dx: 2, dy: 30 })).toEqual({ x: 0, y: 0, w: 50, h: 50 });
  });

  it('squares an element that was not square as soon as it is resized', () => {
    const el = { id: 'gauge_0', x: 0, y: 0, w: 60, h: 20 };
    const out = applyDrag(c, el, 'resize', { dx: 0, dy: 0 });
    expect(out.w).toBe(out.h);
    expect(out).toEqual({ x: 0, y: 0, w: 60, h: 60 });
  });

  it('stays inside the canvas on both axes at once', () => {
    const el = { id: 'gauge_0', x: 40, y: 70, w: 20, h: 20 };
    expect(applyDrag(c, el, 'resize', { dx: 500, dy: 500 })).toEqual({ x: 40, y: 70, w: 30, h: 30 });
  });

  it('never resizes below one step', () => {
    const el = { id: 'gauge_0', x: 0, y: 0, w: 20, h: 20 };
    expect(applyDrag(c, el, 'resize', { dx: -500, dy: -500 })).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it('leaves moving alone - a move cannot change the shape', () => {
    const el = { id: 'gauge_0', x: 0, y: 0, w: 60, h: 20 };
    expect(applyDrag(c, el, 'move', { dx: 10, dy: 10 })).toEqual({ x: 10, y: 10, w: 60, h: 20 });
  });

  it('leaves a progressbar free to be any shape', () => {
    const el = { id: 'progressbar_0', x: 0, y: 0, w: 20, h: 20 };
    expect(applyDrag(c, el, 'resize', { dx: 30, dy: 0 })).toEqual({ x: 0, y: 0, w: 50, h: 20 });
  });

  it('holds a round bar square once the slot says it is one', () => {
    const el = { id: 'progressbar_0', x: 0, y: 0, w: 20, h: 20 };
    const round = { progressbars: [{ orientation: 'circular_donut' }] };
    expect(applyDrag(c, el, 'resize', { dx: 30, dy: 0 }, round))
      .toEqual({ x: 0, y: 0, w: 50, h: 50 });
    // The same bar, still straight, is still free.
    expect(applyDrag(c, el, 'resize', { dx: 30, dy: 0 }, { progressbars: [{ orientation: 'horizontal' }] }))
      .toEqual({ x: 0, y: 0, w: 50, h: 20 });
  });

  it('squares a round bar that was drawn wide before the lock existed', () => {
    const el = { id: 'progressbar_0', x: 0, y: 0, w: 60, h: 20 };
    const round = { progressbars: [{ orientation: 'circular_speedo' }] };
    expect(applyDrag(c, el, 'resize', { dx: 0, dy: 0 }, round))
      .toEqual({ x: 0, y: 0, w: 60, h: 60 });
  });
});

describe('migration squares gauges', () => {
  it('inscribes the gauge in the cell it came from, centred', () => {
    const rows = [{ cells: [{ width: 100, content: 'gauge_0' }] }];
    const { elements } = migrateLayoutToCanvas(rows, { w: 400, h: 200 });
    expect(elements[0]).toMatchObject({ id: 'gauge_0', x: 100, y: 0, w: 200, h: 200 });
  });

  it('leaves a progressbar filling its cell', () => {
    const rows = [{ cells: [{ width: 100, content: 'progressbar_0' }] }];
    const { elements } = migrateLayoutToCanvas(rows, { w: 400, h: 200 });
    // 133.332 x 66.666 of the cell, as whole canvas units.
    expect(elements[0]).toMatchObject({ w: 133, h: 67 });
  });

  it('leaves surfaces alone, so a pattern still paints the whole cell', () => {
    const rows = [{ cells: [{ width: 100, content: 'gauge_0' }] }];
    const { elements } = migrateLayoutToCanvas(rows, { w: 400, h: 200 }, { targetedCells: ['r0c0'] });
    expect(elements[0]).toMatchObject({ id: 'surface_0', x: 0, y: 0, w: 400, h: 200 });
  });

  it('every migrated gauge in a real layout comes out square', () => {
    for (const fx of fixtures) {
      const { elements } = migrateLayoutToCanvas(fx.layout_rows ?? fx.slot?.layout_rows ?? []);
      for (const el of elements) {
        if (isSquareLocked(el)) expect(el.w).toBeCloseTo(el.h, 9);
      }
    }
  });
});

describe('gridColumnsToPx', () => {
  // Measured on a real dashboard, which is where the reference width comes
  // from: a full-width card was 480px and a six-column one 236.
  it('reproduces the widths a real section gives', () => {
    expect(gridColumnsToPx(12)).toBeCloseTo(480, 6);
    expect(gridColumnsToPx(6)).toBeCloseTo(236, 6);
    expect(gridColumnsToPx(3)).toBeCloseTo(114, 6);
  });

  it('treats a full-width card as the whole section', () => {
    expect(gridColumnsToPx('full')).toBeCloseTo(gridColumnsToPx(12), 6);
  });

  it('clamps nonsense into the grid rather than inventing a width', () => {
    expect(gridColumnsToPx(0)).toBeCloseTo(gridColumnsToPx(1), 6);
    expect(gridColumnsToPx(99)).toBeCloseTo(gridColumnsToPx(12), 6);
    expect(gridColumnsToPx(undefined)).toBeCloseTo(gridColumnsToPx(1), 6);
  });
});

describe('gridSize', () => {
  it('prefers what the layout tab set', () => {
    expect(gridSize({ grid_options: { columns: 6, rows: 4 } }, { grid_columns: 9 }))
      .toEqual({ columns: 6, rows: 4 });
  });

  it('falls back to the defaults the card reports', () => {
    expect(gridSize({}, { grid_columns: 9, grid_rows: 5 })).toEqual({ columns: 9, rows: 5 });
    expect(gridSize({}, {})).toEqual({ columns: 3, rows: 3 });
    expect(gridSize(undefined, undefined)).toEqual({ columns: 3, rows: 3 });
  });

  it('does not mistake auto height for a row count', () => {
    expect(gridSize({ grid_options: { rows: 'auto' } }, { grid_rows: 5 }).rows).toBe(5);
  });
});

describe('canvasFromGrid', () => {
  it('gives the six-by-four card the shape worked out by hand', () => {
    // 236 x 248 px, scaled so the longer side is 400.
    expect(canvasFromGrid({ grid_options: { columns: 6, rows: 4 } }, {}))
      .toEqual({ w: 381, h: 400 });
  });

  it('keeps the ratio of the box it came from', () => {
    for (const [columns, rows] of [[12, 4], [3, 2], [6, 8], [1, 1]]) {
      const c = canvasFromGrid({ grid_options: { columns, rows } }, {});
      expect(c.w / c.h).toBeCloseTo(gridColumnsToPx(columns) / gridRowsToPx(rows), 2);
      expect(Math.max(c.w, c.h)).toBe(400);
    }
  });
});

describe('applyGroupDrag', () => {
  const c = { w: 400, h: 400, grid: 10, snap: 10 };
  const els = () => ([
    { id: 'a', x: 10, y: 10, w: 40, h: 40 },
    { id: 'b', x: 95, y: 60, w: 40, h: 40 },
    { id: 'c', x: 200, y: 200, w: 60, h: 30 },
  ]);

  it('moves everything by the one delta, so the arrangement survives', () => {
    const out = applyGroupDrag(c, els(), { dx: 33, dy: 27 }, 'a');
    // snapped against the anchor: 10 + 33 -> 40, so +30 for all three
    expect(out.a).toEqual({ x: 40, y: 40, w: 40, h: 40 });
    expect(out.b).toEqual({ x: 125, y: 90, w: 40, h: 40 });
    expect(out.c).toEqual({ x: 230, y: 230, w: 60, h: 30 });
  });

  it('snaps against the element under the pointer, not each on its own', () => {
    // `b` sits at 95, off the grid. Dragged by it, it lands on the grid at
    // 110 and the others follow by that same 15 - so `a` lands off the grid,
    // which is the point: the group kept its arrangement.
    const out = applyGroupDrag(c, els(), { dx: 12, dy: 0 }, 'b');
    expect(out.b.x).toBe(110);
    expect(out.a.x).toBe(25);
  });

  it('stops the group at the canvas edge, not each element at its own wall', () => {
    const out = applyGroupDrag(c, els(), { dx: 900, dy: 0 }, 'a');
    expect(out.c.x + out.c.w).toBe(400);
    // and the one behind it kept its distance rather than piling up
    expect(out.c.x - out.a.x).toBe(190);
  });

  it('holds a pinned element still and lets the rest go', () => {
    const list = els();
    list[1].locked = true;
    const out = applyGroupDrag(c, list, { dx: 30, dy: 30 }, 'a');
    expect(out.b).toMatchObject({ x: 95, y: 60 });
    expect(out.a).toMatchObject({ x: 40, y: 40 });
    expect(out.c).toMatchObject({ x: 230, y: 230 });
  });

  it('does not let a pinned element hold the group back at the wall', () => {
    const list = [{ id: 'p', x: 380, y: 0, w: 20, h: 20, locked: true },
                  { id: 'a', x: 10, y: 10, w: 40, h: 40 }];
    const out = applyGroupDrag(c, list, { dx: 100, dy: 0 }, 'a');
    expect(out.a.x).toBe(110);
    expect(out.p.x).toBe(380);
  });

  it('moves nothing when everything in the selection is pinned', () => {
    const list = els().map(el => ({ ...el, locked: true }));
    const out = applyGroupDrag(c, list, { dx: 90, dy: 90 }, 'a');
    expect(out.a).toMatchObject({ x: 10, y: 10 });
    expect(out.c).toMatchObject({ x: 200, y: 200 });
  });
});

describe('distributeElements', () => {
  const canvas = (elements) => ({ w: 400, h: 400, grid: 10, snap: 10, elements });

  it('makes the gaps equal and leaves the outermost two where they are', () => {
    const c = canvas([
      { id: 'a', x: 0,   y: 0, w: 40, h: 20 },
      { id: 'b', x: 50,  y: 0, w: 40, h: 20 },
      { id: 'c', x: 300, y: 0, w: 40, h: 20 },
    ]);
    const out = distributeElements(c, ['a', 'b', 'c'], 'x');
    expect(out.elements.map(e => e.x)).toEqual([0, 150, 300]);
  });

  it('measures the gaps between edges, so a wide box does not crowd its neighbour', () => {
    const c = canvas([
      { id: 'a', x: 0,   y: 0, w: 20,  h: 20 },
      { id: 'b', x: 40,  y: 0, w: 120, h: 20 },
      { id: 'c', x: 300, y: 0, w: 20,  h: 20 },
    ]);
    const out = distributeElements(c, ['a', 'b', 'c'], 'x');
    const [a, b, cc] = out.elements;
    expect(b.x - (a.x + a.w)).toBe(cc.x - (b.x + b.w));
  });

  it('does the same down the other axis', () => {
    const c = canvas([
      { id: 'a', x: 0, y: 0,   w: 20, h: 40 },
      { id: 'b', x: 0, y: 60,  w: 20, h: 40 },
      { id: 'c', x: 0, y: 300, w: 20, h: 40 },
    ]);
    expect(distributeElements(c, ['a', 'b', 'c'], 'y').elements.map(e => e.y))
      .toEqual([0, 150, 300]);
  });

  it('takes them in the order they sit, not the order they were selected', () => {
    const c = canvas([
      { id: 'a', x: 300, y: 0, w: 40, h: 20 },
      { id: 'b', x: 0,   y: 0, w: 40, h: 20 },
      { id: 'c', x: 50,  y: 0, w: 40, h: 20 },
    ]);
    const out = distributeElements(c, ['a', 'b', 'c'], 'x');
    expect(out.elements.find(e => e.id === 'b').x).toBe(0);
    expect(out.elements.find(e => e.id === 'c').x).toBe(150);
    expect(out.elements.find(e => e.id === 'a').x).toBe(300);
  });

  it('overlaps them evenly when they do not fit, rather than refusing', () => {
    const c = canvas([
      { id: 'a', x: 0,  y: 0, w: 60, h: 20 },
      { id: 'b', x: 10, y: 0, w: 60, h: 20 },
      { id: 'c', x: 40, y: 0, w: 60, h: 20 },
    ]);
    const out = distributeElements(c, ['a', 'b', 'c'], 'x');
    const [a, b, cc] = out.elements;
    expect(b.x - (a.x + a.w)).toBe(cc.x - (b.x + b.w));
    expect(a.x).toBe(0);
    expect(cc.x).toBe(40);
  });

  it('is null when there is nothing to do', () => {
    const even = canvas([
      { id: 'a', x: 0,   y: 0, w: 40, h: 20 },
      { id: 'b', x: 150, y: 0, w: 40, h: 20 },
      { id: 'c', x: 300, y: 0, w: 40, h: 20 },
    ]);
    expect(distributeElements(even, ['a', 'b', 'c'], 'x')).toBe(null);
    expect(distributeElements(even, ['a', 'b'], 'x')).toBe(null);
    expect(distributeElements(even, [], 'x')).toBe(null);
  });

  it('leaves a pinned element out of it entirely', () => {
    const c = canvas([
      { id: 'a', x: 0,   y: 0, w: 40, h: 20 },
      { id: 'p', x: 60,  y: 0, w: 40, h: 20, locked: true },
      { id: 'b', x: 100, y: 0, w: 40, h: 20 },
      { id: 'c', x: 300, y: 0, w: 40, h: 20 },
    ]);
    const out = distributeElements(c, ['a', 'p', 'b', 'c'], 'x');
    expect(out.elements.find(e => e.id === 'p').x).toBe(60);
    expect(out.elements.map(e => e.x)).toEqual([0, 60, 150, 300]);
    // and with the lock leaving too few to distribute, nothing happens at all
    const two = canvas([
      { id: 'a', x: 0,  y: 0, w: 40, h: 20 },
      { id: 'p', x: 60, y: 0, w: 40, h: 20, locked: true },
      { id: 'b', x: 300, y: 0, w: 40, h: 20 },
    ]);
    expect(distributeElements(two, ['a', 'p', 'b'], 'x')).toBe(null);
  });

  it('touches neither the canvas it was given nor the elements it leaves alone', () => {
    const before = canvas([
      { id: 'a', x: 0,   y: 0, w: 40, h: 20 },
      { id: 'b', x: 50,  y: 0, w: 40, h: 20 },
      { id: 'c', x: 300, y: 0, w: 40, h: 20 },
      { id: 'd', x: 7,   y: 9, w: 10, h: 10, inner: 'tl' },
    ]);
    const copy = structuredClone(before);
    const out = distributeElements(before, ['a', 'b', 'c'], 'x');
    expect(before).toEqual(copy);
    expect(out.elements[3]).toBe(before.elements[3]);
    expect(out.w).toBe(400);
  });
});

describe('rescaleCanvas', () => {
  it('carries the layout across as the same proportions', () => {
    const canvas = { w: 400, h: 200, elements: [
      { id: 'progressbar_0', x: 100, y: 50, w: 200, h: 100 },
    ] };
    const out = rescaleCanvas(canvas, { w: 200, h: 400 });
    expect(out).toMatchObject({ w: 200, h: 400 });
    expect(out.elements[0]).toMatchObject({ x: 50, y: 100, w: 100, h: 200 });
  });

  it('scales a gauge like everything else, letterbox and all', () => {
    const canvas = { w: 400, h: 200, elements: [{ id: 'gauge_0', x: 0, y: 0, w: 100, h: 100 }] };
    const out = rescaleCanvas(canvas, { w: 200, h: 400 });
    expect(out.elements[0]).toMatchObject({ w: 50, h: 200 });
  });

  it('comes back to where it started, which squaring made impossible', () => {
    // Sixteen gauges in a 4x4, the card taken to four rows and back. Squaring
    // brought them home at 52x52 in a grid with holes in it.
    const canvas = { w: 400, h: 400, elements: Array.from({ length: 16 }, (_, i) => ({
      id: `gauge_${i}`, x: (i % 4) * 100, y: Math.floor(i / 4) * 100, w: 100, h: 100 })) };
    const there = rescaleCanvas(canvas, { w: 400, h: 207 });
    const back = rescaleCanvas(there, { w: 400, h: 400 });
    expect(back).toMatchObject({ w: 400, h: 400 });
    // Whole units are what the trip costs, and all it costs: a canvas is 400
    // units across, so one of them is a quarter of a percent.
    back.elements.forEach((el, i) => {
      for (const k of ['x', 'y', 'w', 'h']) {
        expect(Math.abs(el[k] - canvas.elements[i][k])).toBeLessThanOrEqual(1);
      }
    });
  });

  it('leaves everything but the geometry alone', () => {
    const canvas = { w: 400, h: 200, grid: 10, snap: 5,
      elements: [{ id: 'label_0', x: 0, y: 0, w: 10, h: 10, overflow: false }] };
    const out = rescaleCanvas(canvas, { w: 800, h: 400 });
    expect(out.grid).toBe(10);
    expect(out.snap).toBe(5);
    expect(out.elements[0].overflow).toBe(false);
  });

  it('is a no-op when the shape has not changed', () => {
    const canvas = { w: 400, h: 200, elements: [{ id: 'x', x: 1, y: 2, w: 3, h: 4 }] };
    expect(rescaleCanvas(canvas, { w: 400, h: 200 })).toEqual(canvas);
  });

  it('leaves whole numbers behind, whatever the factors were', () => {
    const canvas = { w: 248, h: 200, elements: [
      { id: 'icon', x: 10, y: 10, w: 60, h: 60 },
      { id: 'name', x: 80, y: 10, w: 150, h: 40 },
      { id: 'surface_0', surface: true, x: 7, y: 33, w: 111, h: 29 },
    ]};
    const out = rescaleCanvas(canvas, { w: 381, h: 400 });
    for (const el of out.elements) {
      for (const k of ['x', 'y', 'w', 'h']) expect(Number.isInteger(el[k])).toBe(true);
    }
  });


  it('never rounds an element away to nothing', () => {
    const canvas = { w: 400, h: 400, elements: [{ id: 'label_0', x: 0, y: 0, w: 1, h: 1 }] };
    const out = rescaleCanvas(canvas, { w: 20, h: 20 });
    expect(out.elements[0]).toMatchObject({ w: 1, h: 1 });
  });
});

describe('pinnedToShape', () => {
  const square = () => ({ w: 400, h: 400, elements: [
    { id: 'gauge_0', x: 0, y: 0, w: 100, h: 100 },
    { id: 'gauge_1', x: 300, y: 300, w: 100, h: 100 },
  ] });

  it('reshapes to the card box and remembers what it left', () => {
    const out = pinnedToShape(square(), { w: 400, h: 207 });
    expect(out).toMatchObject({ w: 400, h: 207, free: { w: 400, h: 400 } });
    expect(out.elements[1]).toMatchObject({ x: 300, y: 155 });
  });

  it('is null when the canvas is that shape already', () => {
    expect(pinnedToShape(square(), { w: 400, h: 400 })).toBe(null);
  });

  it('keeps the first remembered shape when reshaped a second time', () => {
    const once = pinnedToShape(square(), { w: 400, h: 207 });
    const twice = pinnedToShape(once, { w: 400, h: 310 });
    expect(twice.free).toEqual({ w: 400, h: 400 });
  });

  it('does not touch the canvas it was given', () => {
    const c = square();
    pinnedToShape(c, { w: 400, h: 207 });
    expect(c).toEqual(square());
  });
});

describe('roundBox', () => {
  it('rounds the box and leaves everything else alone', () => {
    expect(roundBox({ id: 'a', surface: true, inner: 'tl',
                      x: 15.362903225806452, y: 3.825, w: 252.4, h: 68.85 }))
      .toEqual({ id: 'a', surface: true, inner: 'tl', x: 15, y: 4, w: 252, h: 69 });
  });

  it('clears floating point noise', () => {
    expect(roundBox({ x: 14.000000000000002, y: 0, w: 10, h: 10 }).x).toBe(14);
  });

  it('holds a box at one unit rather than letting it vanish', () => {
    expect(roundBox({ x: 0, y: 0, w: 0.2, h: 0 })).toMatchObject({ w: 1, h: 1 });
  });
});

describe('addElement', () => {
  const slot = () => ({
    gauges: [{ entity: 'sensor.a' }],
    progressbars: [{ entity: 'sensor.b' }, { entity: 'sensor.c' }],
    labels_list: [{ label_text: 'one' }],
    gauge_active: true,
  });
  const canvas = () => ({ w: 400, h: 400, grid: 25, elements: [
    { id: 'gauge_0', x: 0, y: 0, w: 100, h: 100 },
    { id: 'surface_0', surface: true, x: 200, y: 200, w: 100, h: 50 },
  ]});

  it('appends the entry and names the element after its index', () => {
    const made = addElement(slot(), canvas(), 'progressbar', { entity: '' });
    expect(made.id).toBe('progressbar_2');
    expect(made.patch.progressbars).toHaveLength(3);
    expect(made.canvas.elements.at(-1).id).toBe('progressbar_2');
  });

  describe('the shape a template asks for', () => {
    const box = aspect =>
      addElement(slot(), canvas(), 'progressbar', {}, { x: 200, y: 200 }, aspect)
        .canvas.elements.at(-1);

    it('is the usual strip when nothing asks', () => {
      const plain = box(undefined);
      expect(plain.w).toBe(box(3).w);
      expect(plain.h).toBe(box(3).h);
    });

    it('turns the strip on its side for a vertical bar', () => {
      const b = box(1 / 3);
      expect(b.w).toBe(box(3).h);
      expect(b.h).toBe(box(3).w);
    });

    it('is square for a ring', () => {
      const b = box(1);
      expect(b.w).toBe(b.h);
    });

    // The entry is the only thing that knows this is a ring, and it is not in
    // the slot yet - `addElement` has not committed. A box taken from the old
    // slot would be the strip.
    it('is square for a circular entry even when no aspect asks', () => {
      const made = addElement(slot(), canvas(), 'progressbar',
                              { orientation: 'circular_donut' }, { x: 200, y: 200 });
      const b = made.canvas.elements.at(-1);
      expect(b.w).toBe(b.h);
    });

    it('leaves a straight entry the strip it has always been', () => {
      const made = addElement(slot(), canvas(), 'progressbar',
                              { orientation: 'horizontal' }, { x: 200, y: 200 });
      const b = made.canvas.elements.at(-1);
      expect(b.w).toBeGreaterThan(b.h);
    });

    // A canvas the box would not fit on, and a ratio steep enough to round an
    // edge to nothing, are both places a template could otherwise place an
    // element nobody can grab again.
    it('stays on the canvas and never has an edge of zero', () => {
      for (const c of [{ w: 400, h: 400, grid: 25, elements: [] },
                       { w: 40, h: 20, grid: 10, elements: [] },
                       { w: 12, h: 9, elements: [] }]) {
        for (const aspect of [1 / 3, 1, 3, 0.01, 100]) {
          const made = addElement({}, c, 'progressbar', {}, { x: c.w, y: c.h }, aspect);
          const el = made.canvas.elements.at(-1);
          expect(el.w, `${c.w}x${c.h} @ ${aspect}`).toBeGreaterThan(0);
          expect(el.h, `${c.w}x${c.h} @ ${aspect}`).toBeGreaterThan(0);
          expect(el.x).toBeGreaterThanOrEqual(0);
          expect(el.y).toBeGreaterThanOrEqual(0);
          expect(el.x + el.w).toBeLessThanOrEqual(c.w);
          expect(el.y + el.h).toBeLessThanOrEqual(c.h);
        }
      }
    });

    // The square is a lock - a gauge that is not square draws outside its box
    // - so it is not a default a template is allowed to talk out of.
    it('cannot unsquare a gauge', () => {
      for (const aspect of [1 / 3, 3, 100]) {
        const el = addElement({}, canvas(), 'gauge', {}, { x: 200, y: 200 }, aspect)
          .canvas.elements.at(-1);
        expect(el.w, String(aspect)).toBe(el.h);
      }
    });
  });

  it('starts a list the card does not have yet', () => {
    const made = addElement({}, canvas(), 'label', { label_text: '' });
    expect(made.id).toBe('label_0');
    expect(made.patch.labels_list).toEqual([{ label_text: '' }]);
  });

  it('turns the module on, and leaves one that is already on alone', () => {
    expect(addElement({}, canvas(), 'progressbar', {}).patch.progressbar_active).toBe(true);
    expect(addElement(slot(), canvas(), 'gauge', {}).patch)
      .not.toHaveProperty('gauge_active');
  });

  it('gives a surface a free id and no definition', () => {
    const made = addElement(slot(), canvas(), 'surface');
    expect(made.id).toBe('surface_1');
    expect(made.patch).toEqual({});
    expect(made.canvas.elements.at(-1).surface).toBe(true);
  });

  it('centres the box on the point it is placed at, snapped', () => {
    const made = addElement(slot(), canvas(), 'gauge', {}, { x: 210, y: 190 });
    const el = made.canvas.elements.at(-1);
    expect({ w: el.w, h: el.h }).toEqual({ w: 75, h: 75 });   // a fifth of 400, snapped
    expect({ x: el.x, y: el.y }).toEqual({ x: 175, y: 150 }); // 210-37.5 -> 175
  });

  it('keeps the box on the canvas whatever it is aimed at', () => {
    const c = canvas();
    for (const at of [{ x: 0, y: 0 }, { x: 400, y: 400 }, { x: -80, y: 600 }]) {
      const el = addElement(slot(), c, 'surface', undefined, at).canvas.elements.at(-1);
      expect(el.x).toBeGreaterThanOrEqual(0);
      expect(el.y).toBeGreaterThanOrEqual(0);
      expect(el.x + el.w).toBeLessThanOrEqual(c.w);
      expect(el.y + el.h).toBeLessThanOrEqual(c.h);
    }
  });

  it('puts an unplaced element of the card itself on the canvas', () => {
    const made = addElement(slot(), canvas(), 'icon');
    expect(made.id).toBe('icon');
    expect(made.patch).toEqual({});
    expect(made.canvas.elements).toHaveLength(3);
  });

  it('is square for a gauge and an icon, and a flat strip for everything else', () => {
    const c = canvas();
    const box = what => { const e = addElement(slot(), c, what, {}).canvas.elements.at(-1);
                          return [e.w, e.h]; };
    expect(box('gauge')).toEqual([75, 75]);
    // The glyph is drawn across the shorter side of the box, so a strip would
    // be an icon the size of its height with the rest of the box empty.
    expect(box('icon')).toEqual([75, 75]);
    expect(box('surface')).toEqual([150, 75]);
    expect(box('progressbar')).toEqual([125, 50]);
    expect(box('name')).toEqual([125, 50]);
  });

  it('never returns a box smaller than one step, on any canvas', () => {
    for (const c of [{ w: 40, h: 20, snap: 0 }, { w: 400, h: 200 }, { w: 30, h: 30, grid: 25 }]) {
      for (const k of NEW_ELEMENT_KINDS) {
        const el = addElement({}, { ...c, elements: [] }, k.kind, {}).canvas.elements.at(-1);
        expect(el.w).toBeGreaterThan(0);
        expect(el.h).toBeGreaterThan(0);
        expect(el.x + el.w).toBeLessThanOrEqual(c.w);
        expect(el.y + el.h).toBeLessThanOrEqual(c.h);
      }
    }
  });

  it('refuses an unknown kind, and an element the canvas already shows', () => {
    expect(addElement(slot(), canvas(), 'sausage')).toBe(null);
    expect(addElement(slot(), canvas(), 'gauge_0')).toBe(null);
    expect(addElement(slot(), canvas(), '')).toBe(null);
  });

  it('places only ids the card actually backs', () => {
    const s = slot(), c = canvas();
    for (const id of ['icon', 'name', 'state', 'progressbar_1', 'label_0', 'label_0_icon']) {
      expect(addElement(s, c, id)?.id).toBe(id);
    }
    for (const id of ['progressbar_2', 'label_1', 'label_1_value', 'gauge_1', 'surface_9']) {
      expect(addElement(s, c, id)).toBe(null);
    }
    // the single gauge of a slot that never grew an array is still an element
    expect(addElement({ gauge_active: true }, { ...c, elements: [] }, 'gauge_0')?.id).toBe('gauge_0');
  });

  it('refuses a gauge on a slot that is itself the gauge', () => {
    const legacy = { gauge_active: true };
    expect(canAddKind(legacy, 'gauge')).toBe(false);
    expect(addElement(legacy, canvas(), 'gauge', {})).toBe(null);
    // with the module off there is no gauge to lose, so the array may start
    expect(canAddKind({}, 'gauge')).toBe(true);
    expect(addElement({}, canvas(), 'gauge', {}).id).toBe('gauge_0');
  });

  it('leaves the original canvas and slot alone', () => {
    const s = slot(), c = canvas();
    for (const k of NEW_ELEMENT_KINDS) addElement(s, c, k.kind, { entity: '' });
    expect(s).toEqual(slot());
    expect(c).toEqual(canvas());
  });

  it('canAddKind agrees with it', () => {
    for (const s of [slot(), {}, { gauge_active: true }]) {
      for (const k of NEW_ELEMENT_KINDS) {
        expect(canAddKind(s, k.kind)).toBe(addElement(s, canvas(), k.kind, {}) !== null);
      }
    }
  });
});

describe('newElementPreview', () => {
  const slot = () => ({
    gauges: [{ entity: 'sensor.a' }],
    progressbars: [{ entity: 'sensor.b' }, { entity: 'sensor.c' }],
    labels_list: [{ label_text: 'one' }],
    gauge_active: true,
  });
  const canvas = () => ({ w: 400, h: 400, grid: 25, elements: [
    { id: 'gauge_0', x: 0, y: 0, w: 100, h: 100 },
    { id: 'surface_0', surface: true, x: 200, y: 200, w: 100, h: 50 },
  ]});

  // The whole point of the function: the ghost the editor draws under the
  // crosshair has to be the element the click then makes. Asserted against
  // `addElement` itself rather than against numbers, so the day the sizing
  // rule changes the two still have to agree.
  it('is the element addElement would add, over every kind and every corner', () => {
    const s = slot(), c = canvas();
    const wheres = [undefined, { x: 0, y: 0 }, { x: 400, y: 400 }, { x: 210, y: 190 },
                    { x: -80, y: 600 }, { x: 200, y: 200 }];
    const whats = [...NEW_ELEMENT_KINDS.map(k => k.kind),
                   'icon', 'name', 'state', 'progressbar_1', 'label_0', 'label_0_icon'];
    for (const what of whats) {
      for (const at of wheres) {
        const made = addElement(s, c, what, {}, at);
        const el = made.canvas.elements.at(-1);
        expect(newElementPreview(s, c, what, at))
          .toEqual({ id: made.id, surface: el.surface === true,
                     x: el.x, y: el.y, w: el.w, h: el.h });
      }
    }
  });

  // The ghost has to follow the aspect too, or the box under the crosshair is
  // a strip and the one the click makes is a square.
  it('is the element addElement would add for a template that wants a shape', () => {
    const s = slot(), c = canvas();
    for (const aspect of [undefined, 1, 3, 1 / 3, 0.2, 5]) {
      const made = addElement(s, c, 'progressbar', {}, { x: 200, y: 200 }, aspect);
      const el = made.canvas.elements.at(-1);
      expect(newElementPreview(s, c, 'progressbar', { x: 200, y: 200 }, aspect), String(aspect))
        .toEqual({ id: made.id, surface: false, x: el.x, y: el.y, w: el.w, h: el.h });
    }
  });

  it('is null wherever addElement refuses, so nothing is promised', () => {
    for (const s of [slot(), {}, { gauge_active: true }]) {
      for (const what of ['sausage', '', 'gauge_0', 'gauge_1', 'surface_9', 'label_1',
                          ...NEW_ELEMENT_KINDS.map(k => k.kind)]) {
        expect(newElementPreview(s, canvas(), what) === null)
          .toBe(addElement(s, canvas(), what, {}) === null);
      }
    }
  });

  it('changes nothing it is shown', () => {
    const s = slot(), c = canvas();
    for (const k of NEW_ELEMENT_KINDS) newElementPreview(s, c, k.kind, { x: 10, y: 10 });
    expect(s).toEqual(slot());
    expect(c).toEqual(canvas());
  });
});

describe('soleElementTargets', () => {
  const cell = (content, extra = {}) => ({ id: 'c', content, width: 100, ...extra });

  it('names the one element a cell holds, in the form the pattern lists use', () => {
    const rows = [{ id: 'r', cells: [cell('gauge_0'), cell('label_1')] }];
    expect(soleElementTargets(rows)).toEqual({ r0c0: 'elm_gauge_0', r0c1: 'elm_label_1' });
  });

  it('skips a cell with nothing in it', () => {
    const rows = [{ id: 'r', cells: [cell('empty'), cell(undefined), { id: 'c', items: [] }] }];
    expect(soleElementTargets(rows)).toEqual({});
  });

  it('skips a cell holding more than one element - there is nothing single to follow', () => {
    const rows = [{ id: 'r', cells: [{ id: 'c', items: [{ id: 'name' }, { id: 'state' }] }] }];
    expect(soleElementTargets(rows)).toEqual({});
  });

  it('takes the single item of an items cell', () => {
    const rows = [{ id: 'r', cells: [{ id: 'c', items: [{ id: 'progressbar_2' }] }] }];
    expect(soleElementTargets(rows)).toEqual({ r0c0: 'elm_progressbar_2' });
  });

  it('counts rows and cells from zero, like every other cell key', () => {
    const rows = [
      { id: 'a', cells: [cell('empty'), cell('icon')] },
      { id: 'b', cells: [cell('gauge_0')] },
    ];
    expect(soleElementTargets(rows)).toEqual({ r0c1: 'elm_icon', r1c0: 'elm_gauge_0' });
  });

  it('is empty for anything that is not a list of rows', () => {
    expect(soleElementTargets(undefined)).toEqual({});
    expect(soleElementTargets(/** @type {any} */ ({}))).toEqual({});
    expect(soleElementTargets([{ id: 'r' }])).toEqual({});
  });
});

describe('colouredCells and glassedCells', () => {
  const slot = {
    color_patterns: [{ target: 'r0c0' }, { target: 'main' }],
    fx_glass_patterns: [{ target: 'r1c1' }, { target: 'r0c0' }, { target: 'elm_gauge_0' }],
  };

  it('separates the two lists paintedCells unions', () => {
    expect(colouredCells(slot)).toEqual(['r0c0']);
    expect(glassedCells(slot)).toEqual(['r1c1', 'r0c0']);
  });

  it('leaves paintedCells the union of the two, each cell once', () => {
    expect(paintedCells(slot).sort()).toEqual(['r0c0', 'r1c1']);
  });
});

describe('repointPatterns with glass following the element', () => {
  const cellTargets = { r0c0: 'elm_surface_0', r1c0: 'elm_surface_1' };
  const follows = { r0c0: 'elm_gauge_0', r1c0: 'elm_label_0' };

  it('sends the glass to the element and the colour to the surface', () => {
    const slot = {
      color_patterns: [{ id: 1, target: 'r0c0' }],
      fx_glass_patterns: [{ id: 2, target: 'r0c0' }],
    };
    const { lists, changed } = repointPatterns(slot, cellTargets, follows);
    expect(changed).toBe(2);
    expect(lists.color_patterns[0].target).toBe('elm_surface_0');
    expect(lists.fx_glass_patterns[0].target).toBe('elm_gauge_0');
  });

  it('sends the glass to the element even where no surface was made', () => {
    const slot = { fx_glass_patterns: [{ id: 2, target: 'r1c0' }] };
    const { lists } = repointPatterns(slot, {}, follows);
    expect(lists.fx_glass_patterns[0].target).toBe('elm_label_0');
  });

  it('falls back to the surface for a cell with nothing single to follow', () => {
    const slot = { fx_glass_patterns: [{ id: 2, target: 'r1c0' }] };
    const { lists } = repointPatterns(slot, cellTargets, {});
    expect(lists.fx_glass_patterns[0].target).toBe('elm_surface_1');
  });

  it('behaves exactly as before when no glass map is given', () => {
    const slot = {
      color_patterns: [{ id: 1, target: 'r0c0' }],
      fx_glass_patterns: [{ id: 2, target: 'r1c0' }],
    };
    expect(repointPatterns(slot, cellTargets)).toEqual(repointPatterns(slot, cellTargets, {}));
  });

  it('never mutates the lists it was given', () => {
    const slot = { fx_glass_patterns: [{ id: 2, target: 'r0c0' }] };
    repointPatterns(slot, cellTargets, follows);
    expect(slot.fx_glass_patterns[0].target).toBe('r0c0');
  });
});

describe('markDialogClean', () => {
  const nest = (tags) => {
    const nodes = tags.map(t => ({ ...t, getRootNode: () => ({ host: null }) }));
    for (let i = nodes.length - 1; i > 0; i--) nodes[i].getRootNode = () => ({ host: nodes[i - 1] });
    return nodes[nodes.length - 1];
  };

  it('tells the dialog it found, however deep the editor sits', () => {
    let called = 0;
    const editor = nest([{ _dirtyStateContext: { markClean: () => { called++; } } }, {}, {}]);
    expect(markDialogClean(editor)).toBe(true);
    expect(called).toBe(1);
  });

  // The element that commits is gone by the time the task runs, so the caller
  // looks the dialog up first and hands that over: it has to be accepted as
  // the node, not only as something above one.
  it('accepts the dialog itself, which is what the caller keeps hold of', () => {
    let called = 0;
    const editor = nest([{ _dirtyStateContext: { markClean: () => { called++; } } }, {}, {}]);
    const dialog = editingDialog(editor);
    expect(dialog).not.toBe(null);
    expect(markDialogClean(dialog)).toBe(true);
    expect(called).toBe(1);
  });

  // It reaches into Home Assistant's own bookkeeping, so the version that
  // renames it has to cost a dialog that closes differently, not an editor
  // that throws on open.
  it('says no and does nothing when there is no dialog to tell', () => {
    expect(markDialogClean(nest([{}, {}]))).toBe(false);
    expect(markDialogClean(nest([{ _dirtyStateContext: {} }, {}]))).toBe(false);
    expect(markDialogClean(nest([{ _dirtyStateContext: { markClean: 'yes' } }, {}]))).toBe(false);
    expect(markDialogClean(null)).toBe(false);
    expect(markDialogClean({})).toBe(false);
  });
});

describe('dialogHasUnsavedWork', () => {
  const nest = (tags) => {
    const nodes = tags.map(t => ({ ...t, getRootNode: () => ({ host: null }) }));
    for (let i = nodes.length - 1; i > 0; i--) nodes[i].getRootNode = () => ({ host: nodes[i - 1] });
    return nodes[nodes.length - 1];
  };
  const dialog = (ctx) => nest([{ _dirtyStateContext: { markClean() {}, ...ctx } }, {}, {}]);

  it('answers the dialog it found, however deep the editor sits', () => {
    expect(dialogHasUnsavedWork(dialog({ isEffectiveDirty: true }))).toBe(true);
    expect(dialogHasUnsavedWork(dialog({ isEffectiveDirty: false }))).toBe(false);
  });

  // It is the one Home Assistant gates its own light dismiss on, and it
  // accounts for a nested editor's state as well as this one's.
  it('prefers the effective flag where both are there', () => {
    expect(dialogHasUnsavedWork(dialog({ isEffectiveDirty: true, isDirty: false }))).toBe(true);
    expect(dialogHasUnsavedWork(dialog({ isEffectiveDirty: false, isDirty: true }))).toBe(false);
  });

  it('falls back to isDirty where there is no effective flag', () => {
    expect(dialogHasUnsavedWork(dialog({ isDirty: true }))).toBe(true);
    expect(dialogHasUnsavedWork(dialog({ isDirty: false }))).toBe(false);
  });

  // A grey button explains nothing; the click explains itself. So anything
  // this cannot read leaves Apply alone.
  it('leaves the button live when there is nothing to read', () => {
    expect(dialogHasUnsavedWork(dialog({}))).toBe(true);
    expect(dialogHasUnsavedWork(dialog({ isEffectiveDirty: 'yes' }))).toBe(true);
    expect(dialogHasUnsavedWork(nest([{}, {}]))).toBe(true);
    expect(dialogHasUnsavedWork(null)).toBe(true);
    expect(dialogHasUnsavedWork({})).toBe(true);
  });
});

describe('sectionColumns', () => {
  // A stand-in for the shadow-root chain the editor sits in: each level is a
  // host whose getRootNode() hands back the next one up.
  const chain = (...hosts) => {
    let child = null;
    for (const host of hosts) {
      const node = { host, _child: child };
      host._root = node;
      child = host;
      host.getRootNode = () => node._parentRoot || { host: null };
    }
    return child;
  };
  const nest = (tags) => {
    let inner = null;
    const nodes = tags.map(t => ({ ...t, getRootNode: () => ({ host: null }) }));
    for (let i = nodes.length - 1; i > 0; i--) nodes[i].getRootNode = () => ({ host: nodes[i - 1] });
    inner = nodes[nodes.length - 1];
    return inner;
  };

  it('takes twelve columns per column the section spans', () => {
    const editor = nest([{ _params: { sectionConfig: { column_span: 2 } } }, {}, {}]);
    expect(sectionColumns(editor)).toBe(24);
  });

  it('reads a section that spans one as twelve', () => {
    const editor = nest([{ _params: { sectionConfig: { type: 'grid' } } }, {}]);
    expect(sectionColumns(editor)).toBe(12);
  });

  it('falls back to one section when nothing up the chain knows', () => {
    expect(sectionColumns(nest([{}, {}, {}]))).toBe(12);
    expect(sectionColumns(null)).toBe(12);
    expect(sectionColumns({})).toBe(12);
  });

  it('ignores a span that is not a positive number', () => {
    for (const column_span of [0, -3, 'wide', null, undefined, NaN]) {
      expect(sectionColumns(nest([{ _params: { sectionConfig: { column_span } } }, {}]))).toBe(12);
    }
  });

  it('stops climbing rather than looping on a cycle', () => {
    const a = {}; const b = {};
    a.getRootNode = () => ({ host: b });
    b.getRootNode = () => ({ host: a });
    expect(sectionColumns(a)).toBe(12);
  });

  it('climbs plain parents too, where there is no shadow boundary', () => {
    const top = { _params: { sectionConfig: { column_span: 3 } }, getRootNode: () => ({ host: null }) };
    const mid = { parentElement: top, getRootNode: () => ({}) };
    const leaf = { parentElement: mid, getRootNode: () => ({}) };
    expect(sectionColumns(leaf)).toBe(36);
  });
});

describe('sectionWidthPx', () => {
  // The same shadow-root chain the sectionColumns tests climb, plus a stand-in
  // for the dashboard still rendered behind the dialog.
  const nest = (tags) => {
    const nodes = tags.map(t => ({ ...t, getRootNode: () => ({ host: null }) }));
    for (let i = nodes.length - 1; i > 0; i--) nodes[i].getRootNode = () => ({ host: nodes[i - 1] });
    return nodes[nodes.length - 1];
  };
  // A root whose querySelectorAll('*') hands back these elements, shadow roots
  // and all, the way findByConfig walks a page.
  const page = (...els) => ({ querySelectorAll: () => els, defaultView: { getComputedStyle: el => el._style || {} } });
  const section = (config, width, style) => ({
    tagName: 'HUI-SECTION', config, _style: style,
    getBoundingClientRect: () => ({ width }),
  });

  const editor = (sectionConfig) => nest([{ _params: { sectionConfig } }, {}, {}]);

  it('measures the section whose config is the one being edited', () => {
    const mine = { type: 'grid' }, other = { type: 'grid' };
    const root = page(section(other, 999), section(mine, 307));
    expect(sectionWidthPx(editor(mine), root)).toBe(307);
  });

  // Two sections can hold configurations that compare equal, so the match has
  // to be the object itself and not one that looks like it.
  it('matches by identity, not by shape', () => {
    const mine = { type: 'grid' };
    const root = page(section({ type: 'grid' }, 999));
    expect(sectionWidthPx(editor(mine), root)).toBe(0);
  });

  it('takes the content box, not the border box', () => {
    const mine = {};
    const root = page(section(mine, 508, { paddingLeft: '4px', paddingRight: '4px' }));
    expect(sectionWidthPx(editor(mine), root)).toBe(500);
  });

  it('answers nothing rather than a number nobody can use', () => {
    const mine = {};
    expect(sectionWidthPx(editor(mine), page())).toBe(0);
    expect(sectionWidthPx(editor(mine), page(section(mine, 0)))).toBe(0);
    expect(sectionWidthPx(nest([{}, {}]), page(section({}, 480)))).toBe(0);
    expect(sectionWidthPx(null, page())).toBe(0);
  });

  it('finds a section nested inside another element\'s shadow root', () => {
    const mine = {};
    const inner = section(mine, 307);
    const host = { tagName: 'HUI-SECTIONS-VIEW', shadowRoot: { querySelectorAll: () => [inner] } };
    expect(sectionWidthPx(editor(mine), page(host))).toBe(307);
  });
});

describe('gridColumnsToPx with a measured section', () => {
  // The user's own dashboard: three sections side by side, so twelve columns
  // came out at 307px rather than the 480 the fallback assumes.
  it('scales the column unit to the width it was given', () => {
    expect(Math.round(gridColumnsToPx(12, 12, 307))).toBe(307);
    expect(Math.round(gridColumnsToPx(12, 12, 500))).toBe(500);
    expect(Math.round(gridColumnsToPx(6, 12, 307))).toBe(150);
  });

  it('falls back to the reference for a width it cannot use', () => {
    for (const w of [0, -1, undefined, null, NaN, 'wide']) {
      expect(Math.round(gridColumnsToPx(12, 12, /** @type {any} */ (w))), String(w)).toBe(480);
    }
  });

  // A wide section is wide because it has more columns, not wider ones, so the
  // measured width still counts as one section's worth.
  it('keeps a column the same width in a section that spans two', () => {
    expect(Math.round(gridColumnsToPx(12, 24, 307))).toBe(307);
    expect(Math.round(gridColumnsToPx(24, 24, 307))).toBe(622);
  });

  it('carries through to the shape a card matches', () => {
    const card = { grid_options: { columns: 12, rows: 4 } };
    // 307 wide against four rows' 248: the ratio the card really has.
    const measured = canvasFromGrid(card, {}, 400, 12, 307);
    expect(measured.w / measured.h).toBeCloseTo(307 / 248, 2);
    const fallback = canvasFromGrid(card, {}, 400, 12);
    expect(fallback.w / fallback.h).toBeCloseTo(480 / 248, 2);
  });
});

describe('gridColumnsToPx across sections', () => {
  it('is unchanged for a section of the default width', () => {
    expect(Math.round(gridColumnsToPx(6))).toBe(236);
    expect(Math.round(gridColumnsToPx(12))).toBe(480);
    expect(Math.round(gridColumnsToPx('full'))).toBe(480);
  });

  it('keeps the column the same width in a wider section', () => {
    expect(Math.round(gridColumnsToPx(6, 24))).toBe(236);
    expect(Math.round(gridColumnsToPx(24, 24))).toBe(968);
  });

  it('lets a full-width card have the whole of a wide section', () => {
    expect(Math.round(gridColumnsToPx('full', 24))).toBe(968);
    expect(Math.round(gridColumnsToPx('full', 36))).toBe(1456);
  });

  it('still clamps to the columns the section has', () => {
    expect(gridColumnsToPx(99, 24)).toBe(gridColumnsToPx(24, 24));
    expect(gridColumnsToPx(0, 24)).toBe(gridColumnsToPx(1, 24));
  });

  it('treats a nonsense total as one section', () => {
    for (const total of [0, -1, NaN, undefined, null, 'wide']) {
      expect(gridColumnsToPx(99, /** @type {any} */ (total))).toBe(gridColumnsToPx(12));
    }
  });
});

describe('canvasFromGrid in a wide section', () => {
  const slot = { canvas: { w: 400, h: 200, elements: [] } };

  it('shapes a full-width card to the whole wide section', () => {
    // 12 columns are 480px wide and 4 rows 248 tall; 24 columns are 968.
    expect(canvasFromGrid({ grid_options: { columns: 'full', rows: 4 } }, slot))
      .toEqual({ w: 400, h: Math.round(248 * 400 / 480) });
    expect(canvasFromGrid({ grid_options: { columns: 'full', rows: 4 } }, slot, 400, 24))
      .toEqual({ w: 400, h: Math.round(248 * 400 / 968) });
  });

  it('leaves a card narrower than one section alone', () => {
    expect(canvasFromGrid({ grid_options: { columns: 6, rows: 4 } }, slot, 400, 24))
      .toEqual(canvasFromGrid({ grid_options: { columns: 6, rows: 4 } }, slot));
  });
});

describe('elementsInRect', () => {
  const canvas = {
    w: 400, h: 400, grid: 10, snap: 10,
    elements: [
      { id: 'bg', surface: true, x: 0, y: 0, w: 400, h: 400 },
      { id: 'a', x: 20, y: 20, w: 40, h: 40 },
      { id: 'b', x: 100, y: 20, w: 40, h: 40 },
      { id: 'c', x: 300, y: 300, w: 40, h: 40 },
      { id: 'locked', x: 30, y: 100, w: 40, h: 40, locked: true },
    ],
  };

  it('takes what the frame holds whole', () => {
    expect(elementsInRect(canvas, { x0: 10, y0: 10, x1: 150, y1: 70 })).toEqual(['a', 'b']);
  });

  it('leaves what it only touches', () => {
    // the frame cuts through `b`
    expect(elementsInRect(canvas, { x0: 10, y0: 10, x1: 120, y1: 70 })).toEqual(['a']);
  });

  it('does not sweep up the background surface it is drawn over', () => {
    expect(elementsInRect(canvas, { x0: 0, y0: 0, x1: 200, y1: 200 })).not.toContain('bg');
  });

  it('takes the background surface when the frame really does hold it', () => {
    expect(elementsInRect(canvas, { x0: 0, y0: 0, x1: 400, y1: 400 })).toContain('bg');
  });

  it('skips pinned elements', () => {
    const out = elementsInRect(canvas, { x0: 0, y0: 0, x1: 400, y1: 400 });
    expect(out).not.toContain('locked');
  });

  it('reads a frame dragged up and to the left the same way', () => {
    expect(elementsInRect(canvas, { x0: 150, y0: 70, x1: 10, y1: 10 })).toEqual(['a', 'b']);
  });

  it('is empty for a frame that holds nothing', () => {
    expect(elementsInRect(canvas, { x0: 200, y0: 200, x1: 220, y1: 220 })).toEqual([]);
  });
});

describe('duplicateElements', () => {
  const slot = () => ({
    gauges: [{ entity: 'sensor.a' }, { entity: 'sensor.b' }],
    progressbars: [{ entity: 'sensor.c' }],
  });
  const canvas = () => ({
    w: 400, h: 400, grid: 10, snap: 10,
    elements: [
      { id: 'surface_0', surface: true, x: 10, y: 10, w: 60, h: 60 },
      { id: 'gauge_0', x: 100, y: 100, w: 50, h: 50 },
      { id: 'gauge_1', x: 200, y: 100, w: 50, h: 50 },
      { id: 'progressbar_0', x: 10, y: 300, w: 200, h: 40 },
    ],
  });

  it('copies each of them once, offset by one step', () => {
    const out = duplicateElements(slot(), canvas(), ['surface_0', 'gauge_0']);
    expect(out.ids).toEqual(['surface_1', 'gauge_2']);
    const made = out.canvas.elements.slice(4);
    expect(made[0]).toMatchObject({ id: 'surface_1', surface: true, x: 20, y: 20, w: 60, h: 60 });
    expect(made[1]).toMatchObject({ id: 'gauge_2', x: 110, y: 110, w: 50, h: 50 });
  });

  it('gives two copies of the same kind two ids and two entries', () => {
    const out = duplicateElements(slot(), canvas(), ['gauge_0', 'gauge_1']);
    expect(out.ids).toEqual(['gauge_2', 'gauge_3']);
    expect(out.patch.gauges).toHaveLength(4);
    // ...and each copy carries its own original's definition
    expect(out.patch.gauges[2]).toEqual({ entity: 'sensor.a' });
    expect(out.patch.gauges[3]).toEqual({ entity: 'sensor.b' });
  });

  it('copies the definition rather than sharing it', () => {
    const from = slot();
    const out = duplicateElements(from, canvas(), ['gauge_0']);
    out.patch.gauges[2].entity = 'sensor.changed';
    expect(from.gauges[0].entity).toBe('sensor.a');
  });

  it('offsets the group as one, so the copies keep the arrangement', () => {
    const c = canvas();
    // `b` is flush against the right edge, so nothing shifts sideways
    c.elements = [
      { id: 'surface_0', surface: true, x: 100, y: 100, w: 40, h: 40 },
      { id: 'surface_9', surface: true, x: 360, y: 100, w: 40, h: 40 },
    ];
    const out = duplicateElements(slot(), c, ['surface_0', 'surface_9']);
    const made = out.canvas.elements.slice(2);
    expect(made[0]).toMatchObject({ x: 100, y: 110 });
    expect(made[1]).toMatchObject({ x: 360, y: 110 });
    expect(made[1].x - made[0].x).toBe(260);
  });

  it('passes over what cannot be copied and copies the rest', () => {
    const c = canvas();
    c.elements.push({ id: 'icon', x: 0, y: 0, w: 20, h: 20 });
    const out = duplicateElements(slot(), c, ['icon', 'surface_0']);
    expect(out.ids).toEqual(['surface_1']);
  });

  it('is null when nothing in the selection can be copied', () => {
    const c = canvas();
    c.elements = [{ id: 'icon', x: 0, y: 0, w: 20, h: 20 }];
    expect(duplicateElements(slot(), c, ['icon'])).toBeNull();
    expect(duplicateElements(slot(), canvas(), [])).toBeNull();
  });

  it('leaves the canvas it was given alone', () => {
    const c = canvas();
    const before = structuredClone(c);
    duplicateElements(slot(), c, ['surface_0', 'gauge_0']);
    expect(c).toEqual(before);
  });

  it('carries a label sub-target across to the copy', () => {
    const sl = { ...slot(), labels_list: [{ label_text: 'one' }] };
    const c = canvas();
    c.elements.push({ id: 'label_0_value', x: 10, y: 10, w: 50, h: 20 });
    const out = duplicateElements(sl, c, ['label_0_value']);
    expect(out.ids).toEqual(['label_1_value']);
    expect(out.patch.labels_list).toHaveLength(2);
  });

  it('is what canDuplicate answers for, element by element', () => {
    const s = slot(), c = canvas();
    c.elements.push({ id: 'icon', x: 0, y: 0, w: 20, h: 20 });
    for (const el of c.elements) {
      expect(canDuplicate(s, el)).toBe(duplicateElements(s, c, [el.id]) !== null);
    }
    expect(canDuplicate({}, { id: 'gauge_0' })).toBe(false);
    expect(canDuplicate(s, { id: 'gauge_9' })).toBe(false);
  });

  it('keeps the copy of a locked element locked', () => {
    const c = canvas();
    c.elements[0].locked = true;
    const out = duplicateElements(slot(), c, ['surface_0']);
    expect(out.canvas.elements.at(-1).locked).toBe(true);
  });
});

describe('reorderElement', () => {
  const canvas = () => ({ w: 400, h: 200, elements: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
  const ids = c => c.elements.map(e => e.id);

  it('moves one element to the front, which is the end of the list', () => {
    expect(ids(reorderElement(canvas(), 0, 'front'))).toEqual(['b', 'c', 'a']);
  });

  it('moves one to the back', () => {
    expect(ids(reorderElement(canvas(), 2, 'back'))).toEqual(['c', 'a', 'b']);
  });

  it('moves one to a place named by number', () => {
    expect(ids(reorderElement(canvas(), 0, 1))).toEqual(['b', 'a', 'c']);
  });

  it('is nothing to do when it is already there', () => {
    expect(reorderElement(canvas(), 2, 'front')).toBe(null);
    expect(reorderElement(canvas(), 0, 'back')).toBe(null);
    expect(reorderElement(canvas(), 1, 1)).toBe(null);
  });

  it('holds a target inside the list rather than losing the element', () => {
    expect(ids(reorderElement(canvas(), 0, 99))).toEqual(['b', 'c', 'a']);
    expect(ids(reorderElement(canvas(), 2, -5))).toEqual(['c', 'a', 'b']);
  });

  it('answers null for an element that is not there', () => {
    expect(reorderElement(canvas(), 7, 'front')).toBe(null);
    expect(reorderElement(canvas(), -1, 0)).toBe(null);
    expect(reorderElement({}, 0, 'front')).toBe(null);
  });

  it('leaves the canvas it was given alone', () => {
    const c = canvas();
    reorderElement(c, 0, 'front');
    expect(ids(c)).toEqual(['a', 'b', 'c']);
  });
});

describe('overlaps', () => {
  const box = (x, y, w, h) => ({ x, y, w, h });

  it('is true for boxes that share any area', () => {
    expect(overlaps(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(true);
    expect(overlaps(box(0, 0, 10, 10), box(2, 2, 3, 3))).toBe(true);
  });

  it('is false for boxes that only touch', () => {
    expect(overlaps(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBe(false);
    expect(overlaps(box(0, 0, 10, 10), box(0, 10, 10, 10))).toBe(false);
  });

  it('is false for boxes apart, and for nothing at all', () => {
    expect(overlaps(box(0, 0, 5, 5), box(20, 20, 5, 5))).toBe(false);
    expect(overlaps(null, box(0, 0, 5, 5))).toBe(false);
    expect(overlaps(box(0, 0, 5, 5), undefined)).toBe(false);
  });
});

describe('overlappingElements', () => {
  const canvas = {
    w: 100, h: 100, elements: [
      { id: 'a', x: 0, y: 0, w: 40, h: 40 },
      { id: 'b', x: 20, y: 20, w: 40, h: 40 },
      { id: 'c', x: 80, y: 80, w: 10, h: 10 },
    ],
  };

  it('names what lies over or under one element', () => {
    expect(overlappingElements(canvas, 'a')).toEqual(['b']);
    expect(overlappingElements(canvas, 'b')).toEqual(['a']);
  });

  it('is empty for one that stands alone, or is not there', () => {
    expect(overlappingElements(canvas, 'c')).toEqual([]);
    expect(overlappingElements(canvas, 'nope')).toEqual([]);
    expect(overlappingElements({}, 'a')).toEqual([]);
  });
});

describe('alignElements', () => {
  const canvas = () => ({ w: 400, h: 400, elements: [
    { id: 'a', x: 10, y: 10, w: 40, h: 20 },
    { id: 'b', x: 100, y: 60, w: 80, h: 40 },
    { id: 'c', x: 250, y: 200, w: 20, h: 100 },
  ]});
  const at = (out, id, axis) => out.elements.find(e => e.id === id)[axis];

  it('lines them up on the leftmost of them', () => {
    const out = alignElements(canvas(), ['a', 'b', 'c'], 'left');
    expect([at(out,'a','x'), at(out,'b','x'), at(out,'c','x')]).toEqual([10, 10, 10]);
  });

  it('lines them up on the rightmost edge, box by box', () => {
    const out = alignElements(canvas(), ['a', 'b', 'c'], 'right');
    // the group's right edge is c's, at 270
    expect([at(out,'a','x'), at(out,'b','x'), at(out,'c','x')]).toEqual([230, 190, 250]);
  });

  it('centres them on the middle of the box they occupy', () => {
    const out = alignElements(canvas(), ['a', 'c'], 'hcenter');
    // 10..270, middle 140
    expect(at(out,'a','x')).toBe(120);
    expect(at(out,'c','x')).toBe(130);
  });

  it('does the same three the other way round', () => {
    expect(at(alignElements(canvas(), ['a','b','c'], 'top'), 'c', 'y')).toBe(10);
    expect(at(alignElements(canvas(), ['a','b','c'], 'bottom'), 'a', 'y')).toBe(280);
    const mid = alignElements(canvas(), ['a','c'], 'vcenter');
    expect(at(mid,'a','y')).toBe(145);   // 10..300, middle 155
    expect(at(mid,'c','y')).toBe(105);
  });

  it('leaves the other axis alone', () => {
    const out = alignElements(canvas(), ['a','b'], 'left');
    expect(at(out,'b','y')).toBe(60);
  });

  it('rounds to whole units', () => {
    const c = { w: 400, h: 400, elements: [
      { id: 'a', x: 0, y: 0, w: 41, h: 10 },
      { id: 'b', x: 0, y: 0, w: 10, h: 10 },
    ]};
    const out = alignElements(c, ['a','b'], 'hcenter');
    expect(Number.isInteger(at(out,'b','x'))).toBe(true);
  });

  it('needs two that may move, and passes over the locked', () => {
    const c = canvas();
    c.elements[1].locked = true;
    expect(alignElements(c, ['a','b'], 'left')).toBe(null);
    expect(alignElements(canvas(), ['a'], 'left')).toBe(null);
    expect(alignElements(canvas(), [], 'left')).toBe(null);
    // a locked one neither moves nor sets the line
    const out = alignElements(c, ['a','b','c'], 'left');
    expect(at(out,'b','x')).toBe(100);
    expect(at(out,'c','x')).toBe(10);
  });

  it('is nothing to do when they are already lined up', () => {
    const c = { w: 400, h: 400, elements: [
      { id: 'a', x: 20, y: 0, w: 10, h: 10 },
      { id: 'b', x: 20, y: 50, w: 10, h: 10 },
    ]};
    expect(alignElements(c, ['a','b'], 'left')).toBe(null);
  });

  it('leaves the canvas it was given alone', () => {
    const c = canvas();
    alignElements(c, ['a','b','c'], 'left');
    expect(c).toEqual(canvas());
  });
});

describe('restorePatch', () => {
  const KEYS = ['canvas', 'gauges'];

  it('names the keys that differ, with the values they had', () => {
    const patch = restorePatch({ canvas: { w: 2 }, gauges: [1] }, { canvas: { w: 1 }, gauges: [1] }, KEYS);
    expect(patch).toEqual({ canvas: { w: 1 } });
  });

  it('deletes a key the undone state had created', () => {
    const patch = restorePatch({ canvas: { w: 1 }, gauges: [1] }, { canvas: { w: 1 } }, KEYS);
    expect(patch).toHaveProperty('gauges', undefined);
    expect(Object.keys(patch)).toEqual(['gauges']);
  });

  it('copies rather than handing back the snapshot', () => {
    const previous = { canvas: { w: 1, elements: [] } };
    const patch = restorePatch({ canvas: { w: 2 } }, previous, KEYS);
    expect(patch.canvas).not.toBe(previous.canvas);
    expect(patch.canvas).toEqual(previous.canvas);
  });

  it('ignores what is not its business', () => {
    expect(restorePatch({ colors: 1 }, { colors: 2 }, KEYS)).toBe(null);
  });

  it('is null when nothing differs', () => {
    const slot = { canvas: { w: 1 }, gauges: [] };
    expect(restorePatch(slot, structuredClone(slot), KEYS)).toBe(null);
  });
});

describe('defaultShapeRows', () => {
  it('is the row count that comes nearest a square', () => {
    expect(defaultShapeRows('full')).toBe(8);
    expect(defaultShapeRows(12)).toBe(8);
    expect(defaultShapeRows(9)).toBe(6);
    expect(defaultShapeRows(6)).toBe(4);
    expect(defaultShapeRows(3)).toBe(2);
  });

  it('rounds to the nearer whole row', () => {
    expect(defaultShapeRows(4)).toBe(3);
    expect(defaultShapeRows(5)).toBe(3);
    expect(defaultShapeRows(7)).toBe(4);
    expect(defaultShapeRows(11)).toBe(7);
  });

  it('never returns less than one row, however narrow the card', () => {
    expect(defaultShapeRows(1)).toBe(1);
    expect(defaultShapeRows(0)).toBe(1);
    expect(defaultShapeRows(undefined)).toBe(1);
  });

  it('reads `full` against the section it is given, not against twelve', () => {
    expect(defaultShapeRows('full', 24)).toBe(15);
  });

  // The point of the rule: near enough a square to hold a gauge, at any width
  // wide enough for the rows to land on one.
  it('comes within a few per cent of square at every multiple of three', () => {
    for (const columns of [3, 6, 9, 12]) {
      const shape = canvasFromGrid({ grid_options: { columns, rows: defaultShapeRows(columns) } }, {});
      expect(shape.w / shape.h).toBeGreaterThan(0.93);
      expect(shape.w / shape.h).toBeLessThan(1.07);
    }
  });
});

describe('rowsForShape', () => {
  it('inverts the shape a row count produced', () => {
    for (const columns of [3, 6, 9, 12]) {
      for (const rows of [1, 2, 3, 4, 6]) {
        const shape = canvasFromGrid({ grid_options: { columns, rows } }, {});
        expect(rowsForShape(shape, columns)).toBe(rows);
      }
    }
  });

  it('answers with the nearest whole row for a shape nobody derived', () => {
    expect(rowsForShape({ w: 400, h: 200 }, 'full')).toBe(4);
    expect(rowsForShape({ w: 400, h: 400 }, 'full')).toBe(8);
  });

  it('has no shape to read from a canvas with no area', () => {
    expect(rowsForShape({ w: 0, h: 0 }, 'full')).toBe(1);
    expect(rowsForShape(undefined, 'full')).toBe(1);
  });
});
