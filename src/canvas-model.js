// The canvas layout model, and the migration into it from layout_rows.
//
// Pure: no imports, no side effects, nothing touched at load. That is what
// lets it be unit-tested in Node, which matters more here than anywhere else
// in this codebase - a wrong number in this file moves every element on
// someone's dashboard, quietly, on a version bump they did not read.
//
// See docs/canvas-layout.md for the model and the reasoning.

/** Canvas dimensions used when a configuration has none to convert. */
export const DEFAULT_CANVAS = Object.freeze({ w: 400, h: 200 });

/**
 * The grid a canvas without an explicit one snaps to, in virtual units.
 *
 * Nothing that creates a canvas writes `grid`, so this is the value in force
 * on nearly every card. It has to be one number: the editor draws the grid
 * from it, `resolveSnap` snaps to it, and the field shows it - and a canvas
 * whose lines are a unit apart is a haze that no drag ever lands on.
 */
export const DEFAULT_GRID = 10;

/**
 * The items of a cell, in the current shape, with three generations of older
 * field names resolved.
 *
 * Moved here verbatim from supercard-04-layout.js so there is one definition:
 * the renderer reads it, and the migration consumes its output rather than
 * the raw config, so the old field names are understood in exactly one place
 * - the one already proven against real configurations.
 *
 * @param {any} cell
 * @returns {any[]}
 */
export function getCellItems(cell) {
  if (Array.isArray(cell.items)) {
    return cell.items.map(item => {
      let x = item.x !== undefined ? item.x : (item.c ? (item.c - 1) * 33.333 : 0);
      let y = item.y !== undefined ? item.y : (item.r ? (item.r - 1) * 33.333 : 0);
      let w = item.w !== undefined ? item.w : (item.c2 && item.c ? (item.c2 - item.c + 1) * 33.333 : 33.333);
      let h = item.h !== undefined ? item.h : (item.r2 && item.r ? (item.r2 - item.r + 1) * 33.333 : 33.333);

      return { ...item, x, y, w, h,
        inner: item.inner || 'cc',
        font_size: item.size_n || item.size_v || item.font_size || null,
        font_weight: item.weight_n || item.weight_v || item.font_weight || null,
        font_color: item.color_n || item.color_v || item.font_color || null,
        font_unit: item.unit_n || item.font_unit || 'px',
        overflow: item.overflow !== false
      };
    });
  }

  if (cell.content && cell.content !== 'empty') {
    const span_c = cell.span_c ?? cell.content.startsWith('gauge_');
    return [{
      id: cell.content,
      x: 0, y: 0, w: span_c ? 100 : 33.333, h: span_c ? 100 : 33.333,
      inner: cell.inner_c || 'cc',
      font_size: cell.size_n || cell.size_v || cell.font_size || null,
      font_weight: cell.weight_n || cell.weight_v || cell.font_weight || null,
      font_color: cell.color_n || cell.color_v || cell.color || null,
      font_unit: cell.unit_n || cell.font_unit || 'px',
      overflow: cell.overflow !== false
    }];
  }
  return [];
}

/**
 * Height of every row, as a percentage of the card.
 *
 * Reproduces what the renderer writes as `flex: 0 0 <pct>%`. Rows do **not**
 * shrink: rows adding up to more than 100 really do overflow the card today,
 * and a configuration may be relying on that, so the numbers are reproduced
 * rather than normalised.
 *
 * @param {any[]} rows
 * @returns {number[]}
 */
export function rowHeights(rows) {
  const explicitSum = Math.min(100, rows.reduce((s, r) => s + (parseFloat(r.flex) || 0), 0));
  const autoRows = rows.filter(r => !(parseFloat(r.flex) > 0)).length;
  return rows.map(r => {
    const flexVal = parseFloat(r.flex) || 0;
    if (flexVal > 0) return flexVal;
    return autoRows > 0 ? (100 - explicitSum) / autoRows : 0;
  });
}

/**
 * The same rows, with their heights scaled to fill the card.
 *
 * For a layout that is switched on, `rowHeights` is the truth and must stay
 * untouched: rows adding up to more than 100 really do overflow the card, and
 * a configuration may be relying on it.
 *
 * A layout that is switched off is a different thing. Its row heights have
 * never been on screen - `layout_active` gates the renderer - so they are not
 * a picture to preserve but a draft, and a draft is routinely abandoned at the
 * editor's starting value. `flex: 1` means one per cent of the card, so the
 * two gauges in such a row migrate into boxes two units across on a
 * four-hundred-unit canvas: a card converted out of existence. Sharing the
 * card between the rows instead is the one reading that cannot do that, and
 * for a single-row draft - which is what these are - it gives back exactly the
 * arrangement the cells describe.
 *
 * Only the heights are touched. The widths across a row are the arrangement,
 * and the arrangement is what the draft is actually saying.
 *
 * @param {any[]} rows
 * @returns {any[]}
 */
export function filledRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const heights = rowHeights(list);
  const sum = heights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return list;
  return list.map((row, i) => ({ ...row, flex: heights[i] / sum * 100 }));
}

/**
 * Width of every cell in a row, as a percentage of the card.
 *
 * Cells, unlike rows, carry only a `flex-basis` and keep the default
 * `flex-shrink: 1`. So they behave differently when they overflow:
 * - basis sums to more than 100 -> they compress proportionally
 * - basis sums to less than 100 -> the remainder stays empty on the right
 *
 * Getting this backwards moves every element in an over-full row, which is
 * why it is a function of its own with tests against both branches.
 *
 * @param {any} row
 * @returns {number[]}
 */
export function cellWidths(row) {
  const cells = Array.isArray(row.cells) ? row.cells : [];
  if (cells.length === 0) return [];
  const basis = cells.map(cell => row.auto_width ? 100 / cells.length : (cell.width || 100));
  const sum = basis.reduce((s, b) => s + b, 0);
  return sum > 100 ? basis.map(b => b / sum * 100) : basis;
}

/**
 * Whether an element has to stay square.
 *
 * A gauge is drawn into a square viewBox whatever its type - a semi gauge is
 * a 270 degree arc in the same box, not half of one - so a non-square slot can
 * only ever letterbox it: `100cqmin` shrinks the gauge to the smaller side and
 * leaves the rest empty. Locking the element to a square instead makes the
 * element's size *be* the gauge's size, which is the one thing a canvas should
 * mean, and removes the only way to draw a box a gauge cannot fill.
 *
 * A circular progressbar is the same picture for the same reason: the ring is
 * an SVG with a square viewBox and the segmented one is sized in `cqmin`, so
 * both centre themselves on the shorter side and leave the rest empty. Worse
 * than empty, in fact - the track behind them takes its corner radius as a
 * percentage, so a wide box draws a stadium around a circle.
 *
 * Which orientation a bar has is not on the canvas element, so this needs the
 * slot to answer for one. Called without it the question is only about the id,
 * and a bar answers no - that is what every caller that has no slot to give
 * wants, since the alternative is guessing a shape from a name.
 *
 * The main icon is the third: `ha-state-icon` draws a glyph on a square em
 * box and centres it, so a wide box is a glyph with air either side of it and
 * the box stops saying how big the icon is. It was already placed square -
 * `newBox` said so on its own - and only the corner grip could pull it out of
 * shape, which is the one place a shape should not be decided.
 *
 * Surfaces are plain boxes for a pattern to paint and are never locked.
 *
 * @param {any} el
 * @param {any} [slot] the card's own config, for a bar's orientation
 * @returns {boolean}
 */
export function isSquareLocked(el, slot) {
  if (el?.surface || typeof el?.id !== 'string') return false;
  if (el.id.startsWith('gauge_') || el.id === 'icon') return true;
  const m = /^progressbar_(\d+)$/.exec(el.id);
  if (!m) return false;
  return barIsCircular(slot?.progressbars?.[Number(m[1])]);
}

/**
 * Whether a bar is drawn as a ring rather than as a line.
 *
 * Half of what a bar offers depends on this - ticks, subticks and the pill are
 * a line's, and the two radius keys are different keys - so the test is worth
 * having in one place rather than spelled out at each of them. Written to read
 * an *entry*, because that is what every caller has.
 *
 * @param {any} cfg a progressbar entry
 * @returns {boolean}
 */
export function barIsCircular(cfg) {
  return String(cfg?.orientation ?? '').startsWith('circular');
}

/**
 * Whether the element has been pinned where it is.
 *
 * Nothing to do with `isSquareLocked` above, which is about shape and is the
 * element's nature rather than anyone's choice: a gauge is square because it
 * has to be, and this is set by hand on the element that must not move.
 *
 * It guards the pointer, which is what slips. Typing a coordinate, squaring a
 * gauge or reshaping the canvas are all deliberate and go on working - a lock
 * that also blocked those would mostly be a thing to keep switching off.
 *
 * @param {any} el
 * @returns {boolean}
 */
export function isPinned(el) {
  return el?.locked === true;
}

/**
 * The largest square inside an element, anchored the way its content already
 * sits inside it.
 *
 * `inner` is a two-character code - vertical then horizontal - that the
 * renderer turns into flex alignment. Reusing it here is what makes squaring
 * an element a no-op on screen: the gauge was already being drawn as a
 * centred (or corner-aligned) square of exactly this side length, so only the
 * box around it changes.
 *
 * @param {any} el
 * @returns {any} the element with square geometry
 */
/**
 * Whole numbers for a box.
 *
 * Canvas coordinates are meant to be read and typed - the editor puts them in
 * number fields - and `15.362903225806452` is not a number anyone adjusts.
 * Both producers of geometry make them: scaling a canvas to a new shape, and
 * turning percentages of a cell into units of a canvas, which adds floating
 * point noise of its own on top (`14.000000000000002`). A canvas is 400 units
 * across, so half a unit is an eighth of a percent - under what a screen can
 * show, and far under the step the grid snaps to.
 *
 * Never smaller than one unit. An element rounded away to nothing would be
 * invisible and unselectable, and that is not a rounding error anyone can
 * undo.
 *
 * @template {{x: number, y: number, w: number, h: number}} T
 * @param {T} box
 * @returns {T}
 */
export function roundBox(box) {
  return { ...box,
    x: Math.round(box.x), y: Math.round(box.y),
    w: Math.max(1, Math.round(box.w)), h: Math.max(1, Math.round(box.h)) };
}

export function squareElement(el) {
  const side = Math.min(el.w, el.h);
  const inner = typeof el.inner === 'string' ? el.inner : 'cc';
  const fy = { t: 0, c: 0.5, b: 1 }[inner[0]] ?? 0.5;
  const fx = { l: 0, c: 0.5, r: 1 }[inner[1]] ?? 0.5;
  return { ...el,
    x: el.x + (el.w - side) * fx,
    y: el.y + (el.h - side) * fy,
    w: side, h: side };
}

/**
 * The canvas after a bar was switched to a different orientation.
 *
 * Turning a bar into a ring makes it square-locked, and the canvas squares a
 * box only when someone edits it - never on render. Choosing the orientation
 * *is* that edit, so the box follows here rather than waiting for the next
 * drag, which would leave a ring letterboxed in a wide box until then.
 *
 * It squares and never un-squares. The square a ring leaves behind is a size
 * like any other once it exists, and widening it again on the way back to a
 * straight bar would undo a box the user never asked to lose.
 *
 * @param {any} canvas
 * @param {number} idx which progressbar changed
 * @param {string} orientation the orientation it changed to
 * @returns {any} the same canvas unless there was a box to square
 */
export function squareBarOnCanvas(canvas, idx, orientation) {
  if (!Array.isArray(canvas?.elements)) return canvas;
  if (!String(orientation).startsWith('circular')) return canvas;
  const id = `progressbar_${idx}`;
  let squared = false;
  const elements = canvas.elements.map(el => {
    if (el?.id !== id || el.w === el.h) return el;
    squared = true;
    return roundBox(squareElement(el));
  });
  return squared ? { ...canvas, elements } : canvas;
}

/**
 * Flatten layout_rows into absolutely placed canvas elements.
 *
 * Rows top to bottom, cells left to right, items in array order - the same
 * order the renderer emits them in today, so anything that depended on
 * stacking keeps its stacking.
 *
 * Every item field is carried over untouched except the geometry. `font_size`
 * carries over unchanged in *number*, but its meaning shifts from px to
 * virtual units; see docs/canvas-layout.md.
 *
 * A colour, fx-glass or interaction pattern can point at a cell as `r0c0`,
 * which resolves to a shadow part that stops existing once cells do. Pass the
 * cell keys that are actually targeted as `targetedCells` and each one becomes
 * a **surface**: a plain box with the cell's exact geometry and no entity
 * behind it, emitted before that cell's own elements so it sits underneath
 * them. The pattern then targets the surface and paints exactly the region it
 * used to. A target naming a cell that does not exist is reported and left
 * unmapped - it was already inert.
 *
 * Surfaces are only created for cells that are targeted. Migration does not
 * invent elements nobody asked for.
 *
 * @param {any[]} layoutRows
 * @param {{ w: number, h: number }} [canvas]
 * @param {{ targetedCells?: string[], slot?: any }} [opts]
 * @returns {{ elements: any[], cellTargets: Record<string, string>, warnings: string[] }}
 */
export function migrateLayoutToCanvas(layoutRows, canvas = DEFAULT_CANVAS, opts = {}) {
  const rows = Array.isArray(layoutRows) ? layoutRows : [];
  const targeted = new Set(opts.targetedCells || []);
  const elements = [];
  const cellTargets = /** @type {Record<string, string>} */ ({});
  const warnings = [];
  let surfaceCount = 0;

  const heights = rowHeights(rows);
  let topPct = 0;

  rows.forEach((row, rIdx) => {
    const rowPct = heights[rIdx];
    const widths = cellWidths(row);
    const cells = Array.isArray(row.cells) ? row.cells : [];
    let leftPct = 0;

    cells.forEach((cell, cIdx) => {
      const cellPct = widths[cIdx];
      const key = `r${rIdx}c${cIdx}`;

      if (targeted.has(key)) {
        const id = `surface_${surfaceCount++}`;
        elements.push(roundBox({
          id, surface: true,
          x: leftPct / 100 * canvas.w,
          y: topPct / 100 * canvas.h,
          w: cellPct / 100 * canvas.w,
          h: rowPct / 100 * canvas.h,
        }));
        cellTargets[key] = `elm_${id}`;
      }

      for (const item of getCellItems(cell)) {
        const { x, y, w, h, ...rest } = item;
        const placed = {
          ...rest,
          x: (leftPct + x / 100 * cellPct) / 100 * canvas.w,
          y: (topPct + y / 100 * rowPct) / 100 * canvas.h,
          w: (w / 100 * cellPct) / 100 * canvas.w,
          h: (h / 100 * rowPct) / 100 * canvas.h,
        };
        // Squaring a gauge here changes the box, not the picture: the gauge
        // was already drawn as an aligned square of the smaller side. What it
        // buys is that the element the editor hands you afterwards is the
        // gauge, so dragging it bigger makes the gauge bigger.
        elements.push(roundBox(isSquareLocked(placed, opts.slot) ? squareElement(placed) : placed));
      }

      leftPct += cellPct;
    });

    topPct += rowPct;
  });

  for (const key of targeted) {
    if (!(key in cellTargets)) {
      warnings.push(
        `${key} does not exist in this layout, so the pattern targeting it was already ` +
        `doing nothing; it keeps that target rather than being repointed.`,
      );
    }
  }

  return { elements, cellTargets, warnings };
}

/**
 * Every cell a colour or fx-glass pattern paints.
 *
 * These are the cells migration turns into surfaces, because painting a region
 * is the whole of what a surface is for. Interactions are deliberately absent
 * here all the same: a surface can carry one now - the interaction module
 * turns its pointer events back on for exactly that case - but a migration
 * that hands a decorative box the clicks meant for what is drawn over it is
 * not a migration anyone asked for. `clickedCells` collects those separately,
 * to be reported instead.
 *
 * @param {any} slot
 * @returns {string[]}
 */
export function paintedCells(slot) {
  return [...new Set([...colouredCells(slot), ...glassedCells(slot)])];
}

/** The cells a colour pattern paints. @param {any} slot @returns {string[]} */
export function colouredCells(slot) {
  return cellTargetsIn([slot?.color_patterns]);
}

/** The cells an fx-glass pattern paints. @param {any} slot @returns {string[]} */
export function glassedCells(slot) {
  return cellTargetsIn([slot?.fx_glass_patterns]);
}

/**
 * The element an fx-glass pattern on a cell should follow, per cell key, in
 * the `elm_<id>` form the pattern lists store.
 *
 * Glass on a cell paints *over* what is in it - the cell part's `::after` is
 * above the element - and that is the look someone picked. Repointed at the
 * surface underneath, the very same pattern comes out *behind* the element,
 * and the card looks converted. So where a cell holds exactly one element the
 * glass follows that element and stays in front of it. The box it paints
 * becomes the element's rather than the whole cell's; a cell with no element,
 * or with several, has nothing single to follow and keeps its surface.
 *
 * Colour is the opposite case and deliberately absent: it paints the ground
 * *behind* things, which is the whole of what a surface is.
 *
 * @param {any[]} layoutRows
 * @returns {Record<string, string>}
 */
export function soleElementTargets(layoutRows) {
  const rows = Array.isArray(layoutRows) ? layoutRows : [];
  const out = /** @type {Record<string, string>} */ ({});
  rows.forEach((row, rIdx) => {
    const cells = Array.isArray(row?.cells) ? row.cells : [];
    cells.forEach((cell, cIdx) => {
      const items = getCellItems(cell);
      const id = items.length === 1 ? items[0]?.id : undefined;
      if (typeof id === 'string' && id && id !== 'empty') out[`r${rIdx}c${cIdx}`] = `elm_${id}`;
    });
  });
  return out;
}

/**
 * Every cell an interaction points at - the ones conversion cannot carry over.
 *
 * @param {any} slot
 * @returns {string[]}
 */
export function clickedCells(slot) {
  return cellTargetsIn([slot?.interactions]);
}

/** @param {any[]} lists @returns {string[]} */
function cellTargetsIn(lists) {
  const keys = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const p of list) if (/^r\d+c\d+$/.test(String(p?.target))) keys.add(p.target);
  }
  return [...keys];
}

/**
 * The cell targets that name a cell this layout does not have.
 *
 * Conversion reports these before it runs, so the offer can say what will
 * happen instead of leaving someone to find out. They are the same set
 * `migrateLayoutToCanvas` describes in its `warnings`, answered from the rows
 * directly because the offer is rendered long before any migration runs.
 *
 * @param {any} slot
 * @returns {string[]}
 */
export function deadCellTargets(slot) {
  const rows = Array.isArray(slot?.layout_rows) ? slot.layout_rows : [];
  const missing = (/** @type {string} */ key) => {
    const m = /^r(\d+)c(\d+)$/.exec(key);
    if (!m) return true;
    const row = rows[Number(m[1])];
    return !row || !Array.isArray(row.cells) || Number(m[2]) >= row.cells.length;
  };
  return [...paintedCells(slot), ...clickedCells(slot)].filter(missing);
}

/**
 * The pattern lists, with every mapped cell target pointed at the surface that
 * replaced it.
 *
 * This has to travel in the same commit as the canvas. `_commit` clones the
 * card config and Home Assistant writes it back asynchronously, so a second
 * commit in the same tick silently loses the first - and a card that got its
 * canvas but not its repointed patterns is exactly the card whose background
 * vanished.
 *
 * Colour and fx-glass both store an element target as `elm_<id>`, which is the
 * form `cellTargets` already carries, so one map serves both. A target naming
 * a cell that does not exist is left untouched: it was inert on the rows card
 * too, and an entry can carry a whole palette, so dropping it would throw away
 * work to tidy something that costs nothing.
 *
 * `glassTargets` wins over `cellTargets` for fx-glass only - see
 * `soleElementTargets` for why glass follows the element and colour does not.
 * A cell can be in both maps: one that is coloured *and* glassed keeps its
 * surface for the colour while the glass moves onto the element.
 *
 * Only the lists that actually changed come back, so the merge payload stays
 * as small as the edit.
 *
 * @param {any} slot
 * @param {Record<string, string>} cellTargets
 * @param {Record<string, string>} [glassTargets]
 * @returns {{ lists: Record<string, any[]>, changed: number }}
 */
export function repointPatterns(slot, cellTargets, glassTargets = {}) {
  const lists = /** @type {Record<string, any[]>} */ ({});
  let changed = 0;
  for (const key of ['color_patterns', 'fx_glass_patterns']) {
    const map = key === 'fx_glass_patterns' ? { ...cellTargets, ...glassTargets } : cellTargets;
    const list = slot?.[key];
    if (!Array.isArray(list)) continue;
    let hit = false;
    const next = list.map(p => {
      const to = map?.[p?.target];
      if (!to) return p;
      hit = true;
      changed++;
      return { ...p, target: to };
    });
    if (hit) lists[key] = next;
  }
  return { lists, changed };
}

/**
 * A `grid` or `snap` number in virtual units, whatever unit it was written in.
 *
 * `grid_unit: 'pct'` reads both numbers as a percentage of the canvas *width*
 * - one axis, because the step is one number and a grid of squares is what a
 * canvas of squares wants. A percentage survives a reshape: `rescaleCanvas`
 * carries the elements to the new shape, and a grid written this way goes
 * with them instead of turning into a haze or a handful of lines.
 *
 * The result is whole units, because the coordinates it produces are typed
 * and read in the editor's number fields - see `roundBox`. Never below one,
 * for the same reason free placement is not zero.
 *
 * @param {{ w?: number, grid_unit?: string }} canvas
 * @param {number} value
 * @returns {number}
 */
export function gridToUnits(canvas, value) {
  const n = Number(value);
  if (!(n > 0)) return 0;
  if (canvas?.grid_unit !== 'pct') return n;
  const w = typeof canvas?.w === 'number' && canvas.w > 0 ? canvas.w : DEFAULT_CANVAS.w;
  return Math.max(1, Math.round(w * n / 100));
}

/**
 * The inverse, for the editor's unit switch: a step in units as a percentage.
 *
 * Two decimals, so the number in the field stays one a person can read and
 * the round trip back through `gridToUnits` lands on the step it came from.
 *
 * @param {{ w?: number }} canvas
 * @param {number} units
 * @returns {number}
 */
export function unitsToGrid(canvas, units) {
  const n = Number(units);
  if (!(n > 0)) return 0;
  const w = typeof canvas?.w === 'number' && canvas.w > 0 ? canvas.w : DEFAULT_CANVAS.w;
  return Math.round(n / w * 10000) / 100;
}

/**
 * The step placement snaps to, in virtual units.
 *
 * Tri-state, so one field cannot contradict another: `snap` unset means snap
 * to the visible grid, `0` means free placement, a positive number is its own
 * step. Free placement still returns a step - 1 unit - because a canvas is a
 * grid of integers underneath and half a unit is not a position anyone means.
 *
 * An unset `grid` is the default grid, not one unit: a canvas nobody has
 * configured is the common case, and reading it as free placement made two of
 * the three states the same thing while the editor still offered both.
 *
 * The default is units even under `grid_unit: 'pct'`: it stands in for a
 * canvas nobody has configured, so there is no percentage to honour.
 *
 * @param {{ w?: number, grid?: number, snap?: number, grid_unit?: string }} canvas
 * @returns {number}
 */
export function resolveSnap(canvas) {
  const snap = canvas?.snap;
  if (snap === 0) return 1;
  if (typeof snap === 'number' && snap > 0) return gridToUnits(canvas, snap);
  const grid = canvas?.grid;
  if (typeof grid === 'number' && grid > 0) return gridToUnits(canvas, grid);
  return DEFAULT_GRID;
}

/**
 * Move or resize one element, snapped and kept inside the canvas.
 *
 * Pure, so the drag maths can be tested without a pointer: the editor turns
 * pointer positions into a delta in virtual units and this decides where the
 * element actually lands.
 *
 * @param {{ w: number, h: number, grid?: number, snap?: number }} canvas
 * @param {{ x: number, y: number, w: number, h: number, id?: string, surface?: boolean, locked?: boolean }} start
 *   element as the drag began; `id` is what decides whether it is square-locked
 * @param {'move'|'resize'} mode
 * @param {{ dx: number, dy: number }} delta in virtual units
 * @param {any} [slot] the card's own config, for a bar's orientation
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function applyDrag(canvas, start, mode, delta, slot) {
  // The editor does not start a drag on a pinned element, so this is the
  // second answer to the same question - deliberately. A drag that got through
  // anyway, from a path added later, would move something whose whole point is
  // that it does not, and there is no delta worth that.
  if (isPinned(start)) return { x: start.x, y: start.y, w: start.w, h: start.h };

  const step = resolveSnap(canvas);
  const snap = v => Math.round(v / step) * step;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  if (mode === 'resize') {
    if (isSquareLocked(start, slot)) {
      // One side length, taken from whichever axis was dragged further, so a
      // corner drag follows the pointer in both. Units are isotropic on the
      // canvas - the box carries the same w/h ratio the coordinates do, so it
      // cancels - which is why a square on screen is simply w === h, and why
      // both sides can snap to the grid without the shape drifting.
      const side = clamp(
        Math.max(snap(start.w + delta.dx), snap(start.h + delta.dy)),
        step,
        Math.min(canvas.w - start.x, canvas.h - start.y),
      );
      return { x: start.x, y: start.y, w: side, h: side };
    }
    return {
      x: start.x,
      y: start.y,
      w: clamp(snap(start.w + delta.dx), step, canvas.w - start.x),
      h: clamp(snap(start.h + delta.dy), step, canvas.h - start.y),
    };
  }
  return {
    x: clamp(snap(start.x + delta.dx), 0, canvas.w - start.w),
    y: clamp(snap(start.y + delta.dy), 0, canvas.h - start.h),
    w: start.w,
    h: start.h,
  };
}

/**
 * One drag, several elements.
 *
 * The delta is snapped once, against the element under the pointer, and every
 * element in the selection then moves by exactly that - so a group keeps its
 * arrangement instead of each box snapping to the grid on its own and the
 * spacing quietly changing with every drag.
 *
 * Clamped as one box too: the group stops when its outermost edge reaches the
 * canvas, rather than the elements piling up against the wall one at a time.
 * Snap first and clamp second, the same order `applyDrag` uses, so a group
 * pushed into a corner sits flush against it.
 *
 * A pinned element in the selection stays where it is and does not hold the
 * others back - that is what the lock says, and an element that cannot move
 * cannot leave the canvas either.
 *
 * @param {{w: number, h: number, grid?: number, snap?: number}} canvas
 * @param {any[]} starts elements as the drag began; `anchor` is the one pressed
 * @param {{ dx: number, dy: number }} delta in virtual units
 * @param {string} anchorId
 * @returns {Record<string, {x: number, y: number, w: number, h: number}>} by id
 */
export function applyGroupDrag(canvas, starts, delta, anchorId) {
  const step = resolveSnap(canvas);
  const snap = v => Math.round(v / step) * step;
  const list = (Array.isArray(starts) ? starts : []).filter(Boolean);
  const movers = list.filter(el => !isPinned(el));

  /** @type {Record<string, {x: number, y: number, w: number, h: number}>} */
  const out = {};
  for (const el of list) out[el.id] = { x: el.x, y: el.y, w: el.w, h: el.h };
  if (!movers.length) return out;

  const anchor = movers.find(el => el.id === anchorId) || movers[0];
  let dx = snap(anchor.x + delta.dx) - anchor.x;
  let dy = snap(anchor.y + delta.dy) - anchor.y;

  const minX = Math.min(...movers.map(el => el.x));
  const minY = Math.min(...movers.map(el => el.y));
  const maxX = Math.max(...movers.map(el => el.x + el.w));
  const maxY = Math.max(...movers.map(el => el.y + el.h));
  dx = Math.min(Math.max(dx, -minX), canvas.w - maxX);
  dy = Math.min(Math.max(dy, -minY), canvas.h - maxY);

  for (const el of movers) out[el.id] = { x: el.x + dx, y: el.y + dy, w: el.w, h: el.h };
  return out;
}

/**
 * The patch that puts the named keys of a slot back the way they were.
 *
 * A `__merge__` writes the keys it is given and leaves the rest, so putting
 * a config back means naming every key that has to change - including the
 * ones the state being undone created, which are restored as `undefined`
 * because that is how a merge deletes.
 *
 * Only the named keys are touched. An editor's undo has a scope, and a card
 * has settings that were not part of what it undoes.
 *
 * @param {any} current the slot as it is now
 * @param {any} previous the slot as it should be again
 * @param {readonly string[]} keys the keys this undo is responsible for
 * @returns {Record<string, any> | null} null when nothing differs
 */
export function restorePatch(current, previous, keys) {
  /** @type {Record<string, any>} */
  const patch = {};
  for (const key of keys) {
    const was = previous?.[key];
    const now = current?.[key];
    if (JSON.stringify(was ?? null) === JSON.stringify(now ?? null)) continue;
    patch[key] = was === undefined ? undefined : structuredClone(was);
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * The edges an alignment can line elements up on.
 *
 * @typedef {'left'|'hcenter'|'right'|'top'|'vcenter'|'bottom'} AlignEdge
 */

/**
 * Line the named elements up on one edge, or through one middle.
 *
 * What they line up *to* is the outermost of them - the leftmost element for
 * a left alignment, the topmost for a top one - so an alignment never moves
 * the group somewhere new, it only closes the gap between its members. A
 * centring lines them up on the middle of the box the group occupies, for
 * the same reason.
 *
 * Pinned elements are left out and do not count: they neither move nor set
 * the line, because a lock that only sometimes holds is worse than none.
 *
 * Null when there is nothing to do - fewer than two elements that may move,
 * or they are already lined up - so the editor can offer the button and
 * commit nothing for a press that would change nothing.
 *
 * @param {any} canvas
 * @param {string[]} ids
 * @param {AlignEdge} edge
 * @returns {any | null} a new canvas
 */
export function alignElements(canvas, ids, edge) {
  const elements = Array.isArray(canvas?.elements) ? canvas.elements : [];
  const named = new Set(Array.isArray(ids) ? ids : []);
  const movers = elements.filter(el => named.has(el.id) && !isPinned(el));
  if (movers.length < 2) return null;

  const axis = edge === 'top' || edge === 'vcenter' || edge === 'bottom' ? 'y' : 'x';
  const size = axis === 'y' ? 'h' : 'w';

  /** @param {any} el */
  let place;
  if (edge === 'left' || edge === 'top') {
    const at = Math.min(...movers.map(el => el[axis]));
    place = () => at;
  } else if (edge === 'right' || edge === 'bottom') {
    const at = Math.max(...movers.map(el => el[axis] + el[size]));
    place = (el) => at - el[size];
  } else {
    const lo = Math.min(...movers.map(el => el[axis]));
    const hi = Math.max(...movers.map(el => el[axis] + el[size]));
    const mid = (lo + hi) / 2;
    place = (el) => mid - el[size] / 2;
  }

  /** @type {Record<string, number>} */
  const at = {};
  for (const el of movers) at[el.id] = Math.round(place(el));
  if (movers.every(el => at[el.id] === el[axis])) return null;

  return { ...canvas, elements: elements.map(el =>
    at[el.id] === undefined || at[el.id] === el[axis] ? el : { ...el, [axis]: at[el.id] }) };
}

/**
 * Even gaps between the named elements, along one axis.
 *
 * The gaps are what is made equal, not the centres: the elements on a canvas
 * are different sizes, and equal centres would leave a wide box crowding its
 * neighbours while a narrow one floats. The outermost two keep their places -
 * they are what defines the span - and everything between them is laid out at
 * equal distances inside it. A negative gap, where the boxes together are
 * wider than the span, overlaps them evenly rather than refusing.
 *
 * Pinned elements are left out of it entirely: they neither move nor count as
 * one of the two that stay, because a lock that only sometimes holds is worse
 * than none.
 *
 * Null when there is nothing to do - fewer than three elements that may move,
 * or the arrangement is already even - so the editor can offer the button and
 * commit nothing for a press that would change nothing.
 *
 * @param {any} canvas
 * @param {string[]} ids
 * @param {'x'|'y'} axis
 * @returns {any | null} a new canvas
 */
export function distributeElements(canvas, ids, axis) {
  const size = axis === 'y' ? 'h' : 'w';
  const elements = Array.isArray(canvas?.elements) ? canvas.elements : [];
  const named = new Set(Array.isArray(ids) ? ids : []);
  const movers = elements.filter(el => named.has(el.id) && !isPinned(el));
  if (movers.length < 3) return null;

  const order = [...movers].sort((a, b) => a[axis] - b[axis]);
  const first = order[0], last = order[order.length - 1];
  const span = (last[axis] + last[size]) - first[axis];
  const taken = order.reduce((sum, el) => sum + el[size], 0);
  const gap = (span - taken) / (order.length - 1);

  /** @type {Record<string, number>} */
  const at = {};
  let run = first[axis];
  for (const el of order) {
    at[el.id] = Math.round(run);
    run += el[size] + gap;
  }
  if (order.every(el => at[el.id] === el[axis])) return null;

  return { ...canvas, elements: elements.map(el =>
    at[el.id] === undefined || at[el.id] === el[axis] ? el : { ...el, [axis]: at[el.id] }) };
}

/**
 * Where an element sits in the paint order, and how to move it.
 *
 * The elements array *is* the stacking: the card draws them in order, so the
 * last one is on top. That makes a layer panel a view of the same array read
 * the other way round, and every layer move a move inside it - which is why
 * there is no z-index anywhere near an element.
 *
 * @param {any} canvas
 * @param {number} from the element's index
 * @param {number|'front'|'back'} to where it should end up
 * @returns {any | null} a new canvas, or null when nothing would move
 */
export function reorderElement(canvas, from, to) {
  const elements = Array.isArray(canvas?.elements) ? canvas.elements : [];
  if (!Number.isInteger(from) || from < 0 || from >= elements.length) return null;

  const last = elements.length - 1;
  const target = to === 'front' ? last
    : to === 'back' ? 0
    : Math.max(0, Math.min(last, Math.trunc(Number(to))));
  if (!Number.isFinite(target) || target === from) return null;

  const next = [...elements];
  const [el] = next.splice(from, 1);
  next.splice(target, 0, el);
  return { ...canvas, elements: next };
}

/**
 * Whether two placed elements cover any of the same canvas.
 *
 * Touching edges are not an overlap: two boxes laid side by side share a line
 * and nothing else, and calling that a stack would mark half a tidy layout as
 * one.
 *
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
export function overlaps(a, b) {
  if (!a || !b) return false;
  return a.x < b.x + b.w && b.x < a.x + a.w
      && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The ids of the elements that lie over or under the named one.
 *
 * What a layer panel is for: when two things are in the same place, the list
 * is where you find out which, and which of them is on top.
 *
 * @param {any} canvas
 * @param {string} id
 * @returns {string[]}
 */
export function overlappingElements(canvas, id) {
  const elements = Array.isArray(canvas?.elements) ? canvas.elements : [];
  const el = elements.find(e => e.id === id);
  if (!el) return [];
  return elements.filter(e => e !== el && e.id !== id && overlaps(el, e)).map(e => e.id);
}

/**
 * Home Assistant's sections grid, in pixels.
 *
 * A card that reports `rows: N` is given exactly this height by
 * hui-grid-section: `grid-row: span N`, plus an explicit
 * `N * (row-height + row-gap) - row-gap`. Both figures are themable
 * (`--ha-section-grid-row-height`, `--ha-section-grid-row-gap`); these are the
 * defaults. Nothing renders from them - they only turn a row count into the
 * pixel figure the editor prints beside it, so the number means something.
 */
export const HA_ROW_HEIGHT = 56;
export const HA_ROW_GAP = 8;

/**
 * @param {number} rows
 * @returns {number} the card height Home Assistant gives that many rows
 */
export function gridRowsToPx(rows) {
  const n = Math.max(1, Math.round(Number(rows) || 0));
  return n * (HA_ROW_HEIGHT + HA_ROW_GAP) - HA_ROW_GAP;
}

/**
 * The height a Supercard reports to Home Assistant's sections grid.
 *
 * A canvas card has an intrinsic height - its aspect ratio times whatever
 * width the column hands it - and that width is not knowable from inside the
 * card, so no row count can be right. `auto` is what HA has for exactly this
 * case: the card is as tall as it renders, and the layout tab's height
 * control follows it instead of fighting it.
 *
 * A row/cell card has no intrinsic height at all - its rows are percentages
 * of one - so it keeps reporting the fixed default it always has. Reporting
 * `auto` there would collapse every existing card to nothing.
 *
 * @param {any} slot config.gauge_studio
 * @returns {number | 'auto'}
 */
export function reportedRows(slot) {
  if (slot?.canvas) return 'auto';
  const rows = Number(slot?.grid_rows);
  return rows > 0 ? rows : 3;
}

/**
 * The other axis of Home Assistant's sections grid.
 *
 * A section is `HA_COLUMN_COUNT` equal columns with a gap between them, and a
 * card spanning `n` of them is `n` columns plus the `n-1` gaps they close up.
 * The section's own width is a layout result and varies with the viewport, so
 * `HA_SECTION_WIDTH` is a *fallback* - measured on a real dashboard, where a
 * full-width card came out at exactly 480px and a six-column one at 236. Where
 * the real section can be read instead it is: see `sectionWidthPx`.
 *
 * Only the ratio against `gridRowsToPx` is ever used, so the reference width
 * decides how wide a column counts relative to a row and nothing else. On a
 * narrower section the card is narrower and the canvas letterboxes, which is
 * the same trade a fixed aspect ratio makes everywhere else.
 */
export const HA_COLUMN_COUNT = 12;
export const HA_COLUMN_GAP = 8;
export const HA_SECTION_WIDTH = 480;

/**
 * How many columns the section holding this card actually offers.
 *
 * `HA_COLUMN_COUNT` is one section's worth, and a section can be several wide:
 * Home Assistant's own layout tab sizes its width control as
 * `12 * (column_span ?? 1)`, so a card in a section two columns wide goes up
 * to 24. Ours has to arrive at the same number or one of the two is lying
 * about the same setting.
 *
 * The card config does not carry it - `column_span` belongs to the section,
 * not to the card - and the only thing that knows which section is being
 * edited is the edit dialog, which puts it on `_params.sectionConfig` for its
 * own layout tab. So it is read by walking out of the editor's shadow roots
 * until that turns up. Anywhere else - a masonry view, YAML mode, a card
 * rendered outside a dialog - there is nothing to find and one section's
 * worth is the honest answer.
 *
 * @param {any} node the editor element to start from
 * @returns {number}
 */
export function sectionColumns(node) {
  const section = editedSection(node);
  if (!section) return HA_COLUMN_COUNT;
  const span = Number(section.column_span);
  return HA_COLUMN_COUNT * (span > 0 ? Math.round(span) : 1);
}

/**
 * The config of the section being edited, or null outside a card dialog.
 *
 * Both readers below start from the same walk, so it is written once. See
 * `sectionColumns` for why the edit dialog is the only thing that knows.
 *
 * @param {any} node the editor element to start from
 * @returns {any}
 */
function editedSection(node) {
  for (let n = node, hops = 0; n && hops < 20; hops++) {
    const root = typeof n.getRootNode === 'function' ? n.getRootNode() : null;
    n = root && root.host ? root.host : n.parentElement;
    const section = n && n._params && n._params.sectionConfig;
    if (section) return section;
  }
  return null;
}

/**
 * Tells the card edit dialog that what the editor has just committed is not
 * the user's unsaved work.
 *
 * Home Assistant compares the dialog's working copy against the config it
 * opened with, and a difference makes the dialog dirty: it then passes
 * `prevent-scrim-close` to its `ha-dialog`, which turns the light dismiss off,
 * and a click on the dashboard beside the dialog does nothing at all - no
 * close, and no confirmation either, so the card reads as stuck. That is the
 * right behaviour for an edit somebody made. It is the wrong behaviour for a
 * migration the editor stages on its own while it is opening, before anyone
 * has touched a control.
 *
 * So the one place that commits without being asked says so afterwards. The
 * dialog is found the way everything else in here finds it, by walking out
 * through the shadow roots, and the whole thing is feature-detected: this is
 * Home Assistant's own bookkeeping, and a release that renames it should cost
 * a dialog that closes one way rather than an editor that throws.
 *
 * It has to run after the commit has been through Home Assistant, which is why
 * the caller schedules it rather than calling it in the same tick - and why
 * the caller looks the dialog up with `editingDialog` *before* committing and
 * hands it over. The commit is what replaces the element that made it, so by
 * the time the task runs there is no longer a path from that element to
 * anything: an editor that walked up then would find a detached root and
 * silently do nothing.
 *
 * @param {any} node the dialog itself, or an element inside it
 * @returns {boolean} whether there was a dialog that understood
 */
export function markDialogClean(node) {
  const dialog = editingDialog(node);
  if (!dialog) return false;
  dialog._dirtyStateContext.markClean();
  return true;
}

/**
 * The card edit dialog this node is in, if it keeps dirty state the way this
 * version of Home Assistant does. The node itself counts, so the answer can be
 * passed straight back to `markDialogClean`.
 *
 * @param {any} node
 * @returns {any} the dialog element, or null
 */
export function editingDialog(node) {
  for (let n = node, hops = 0; n && hops < 20; hops++) {
    if (typeof n._dirtyStateContext?.markClean === 'function') return n;
    const root = typeof n.getRootNode === 'function' ? n.getRootNode() : null;
    n = root && root.host ? root.host : n.parentElement;
  }
  return null;
}

/**
 * Whether the card edit dialog is holding work that is not on the dashboard.
 *
 * The other side of `markDialogClean`: the same bookkeeping, read rather than
 * written. Apply writes the dialog's config to the dashboard, so a dialog that
 * has nothing the dashboard does not already have has nothing for Apply to do,
 * and the button says so by going grey.
 *
 * `isEffectiveDirty` is the one to ask - it is what Home Assistant itself
 * gates the light dismiss on, and it accounts for a nested editor's own state
 * as well as this one's. `isDirty` stands in where a version does not have it.
 *
 * Not finding a dialog answers `true`, which looks like the wrong way round
 * and is not: no dialog means Apply cannot work at all, and the click already
 * explains that in place (`APPLY_UNAVAILABLE`). A grey button explains
 * nothing. Not knowing is not a reason to take a button away.
 *
 * @param {any} node the dialog itself, or an element inside it
 * @returns {boolean}
 */
export function dialogHasUnsavedWork(node) {
  const ctx = editingDialog(node)?._dirtyStateContext;
  if (!ctx) return true;
  const dirty = ctx.isEffectiveDirty ?? ctx.isDirty;
  return typeof dirty === 'boolean' ? dirty : true;
}

/**
 * The first element of this tag whose `config` is that very object.
 *
 * Identity, not equality: two cards can carry configurations that compare
 * equal, and Home Assistant hands the dialog the same object it rendered,
 * so `===` is both cheaper and the only one of the two that is unambiguous.
 * Bounded, because this crosses every shadow root on the page and a dashboard
 * is not a small tree - a section that cannot be found in twenty thousand
 * nodes is a section this was never going to find.
 *
 * @param {any} root a document or shadow root to search from
 * @param {string} tag the tag name, upper case
 * @param {any} config the config object to match by identity
 * @returns {any} the element, or null
 */
function findByConfig(root, tag, config) {
  const queue = [root];
  let seen = 0;
  while (queue.length) {
    const next = queue.shift();
    const all = next && typeof next.querySelectorAll === 'function' ? next.querySelectorAll('*') : [];
    for (const el of all) {
      if (++seen > 20000) return null;
      if (el.tagName === tag && el.config === config) return el;
      if (el.shadowRoot) queue.push(el.shadowRoot);
    }
  }
  return null;
}

/**
 * How wide the section holding this card really is, in pixels.
 *
 * `HA_SECTION_WIDTH` is a measurement from one dashboard, and a section is as
 * wide as the viewport makes it: on a screen showing three sections side by
 * side the same twelve columns came out at 307px, so a canvas matched against
 * 480 letterboxes by a third of the card's height. The dashboard is still
 * rendered behind the dialog, so at the moment someone asks for a match the
 * real number is there to be read.
 *
 * It is right for the viewport it was read on and no other, which is the same
 * trade as every other fixed aspect ratio: a card pinned to a row count has a
 * ratio that can only suit one width. A canvas card left on `auto` needs none
 * of this and is right everywhere.
 *
 * The content box, not the border box - a section carries padding of its own
 * and the columns are laid out inside it.
 *
 * @param {any} node the editor element to start from
 * @param {any} [root] where to search, for tests; the document by default
 * @returns {number} 0 when there is nothing to measure
 */
export function sectionWidthPx(node, root) {
  const section = editedSection(node);
  const doc = root || (typeof document !== 'undefined' ? document : null);
  if (!section || !doc) return 0;
  const el = findByConfig(doc, 'HUI-SECTION', section);
  const box = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
  if (!box || !(box.width > 0)) return 0;
  const view = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  const style = view && typeof view.getComputedStyle === 'function' ? view.getComputedStyle(el) : null;
  const pad = style ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) : 0;
  return box.width - pad > 0 ? box.width - pad : 0;
}

/**
 * @param {number | 'full'} columns
 * @param {number} [total] the section's column count, from `sectionColumns`
 * @param {number} [sectionPx] the section's measured width, from
 *   `sectionWidthPx`; the reference is used when there is none
 * @returns {number} the card width that many grid columns give
 */
export function gridColumnsToPx(columns, total = HA_COLUMN_COUNT, sectionPx = 0) {
  const asked = Math.round(Number(total));
  const max = asked > 0 ? asked : HA_COLUMN_COUNT;
  const raw = columns === 'full' ? max : Math.round(Number(columns) || 0);
  const n = Math.max(1, Math.min(max, raw));
  // A column is the same width in a wide section as in a narrow one - the
  // section is wider because it has more of them - so the unit stays one
  // section's worth however many columns the card may span.
  const width = Number(sectionPx) > 0 ? Number(sectionPx) : HA_SECTION_WIDTH;
  const unit = (width - (HA_COLUMN_COUNT - 1) * HA_COLUMN_GAP) / HA_COLUMN_COUNT;
  return n * unit + (n - 1) * HA_COLUMN_GAP;
}

/**
 * The grid box a card currently occupies, from both places it can be set.
 *
 * `grid_options` is Home Assistant's, written by the layout tab and by our own
 * controls; the `grid_*` keys on the slot are the defaults `getGridOptions`
 * reports when it is not. Reading the same chain here is what makes a derived
 * canvas match the card that is actually on the dashboard rather than a
 * hypothetical one.
 *
 * @param {any} cardConfig the Lovelace card config
 * @param {any} slot config.gauge_studio
 * @returns {{ columns: number | 'full', rows: number }}
 */
export function gridSize(cardConfig, slot) {
  const g = cardConfig?.grid_options || {};
  const columns = (typeof g.columns === 'number' || g.columns === 'full')
    ? g.columns
    : (Number(slot?.grid_columns) > 0 ? Number(slot.grid_columns) : 3);
  const rows = typeof g.rows === 'number'
    ? g.rows
    : (Number(slot?.grid_rows) > 0 ? Number(slot.grid_rows) : 3);
  return { columns, rows };
}

/**
 * A canvas shaped like the card's grid box.
 *
 * Scaled so the longer side is `scale`, because the numbers are edited by
 * hand: only the ratio carries meaning, and 400 x 420 reads better than
 * 236 x 248. Element coordinates are fractions of these, and font sizes in
 * the wild are container units, so the scale itself is free.
 *
 * @param {any} cardConfig
 * @param {any} slot
 * @param {number} [scale]
 * @param {number} [total] the section's column count, from `sectionColumns`
 * @param {number} [sectionPx] the section's measured width, from `sectionWidthPx`
 * @returns {{ w: number, h: number }}
 */
export function canvasFromGrid(cardConfig, slot, scale = 400, total = HA_COLUMN_COUNT, sectionPx = 0) {
  const { columns, rows } = gridSize(cardConfig, slot);
  const w = gridColumnsToPx(columns, total, sectionPx);
  const h = gridRowsToPx(rows);
  const k = scale / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * The row count a card of this many columns starts at.
 *
 * As near a square as whole rows allow, at whatever width the card has. A
 * card starts out empty, and what is put on it first is a gauge or a ring -
 * both square - so a wide band is the one shape a new canvas cannot hold a
 * single object in. The rule used to be a third of the columns, which is 2:1
 * at every width and reads as a strip.
 *
 * Square *here* means square against the reference width, so the same card is
 * the same shape on every viewport - the rest of this file makes that trade
 * everywhere, see `gridColumnsToPx`.
 *
 * It is a starting point, not a constraint: the shape is the user's from the
 * first drag onwards.
 *
 * @param {number|'full'} columns
 * @param {number} [total] the section's column count, from `sectionColumns`
 * @returns {number}
 */
export function defaultShapeRows(columns, total = HA_COLUMN_COUNT) {
  return rowsForShape({ w: 1, h: 1 }, columns, total);
}

/**
 * How many rows a canvas of this shape is worth, in a card of this width.
 *
 * The inverse of building the shape from a row count, so the editor can show
 * the number that produced a shape - including for a card whose canvas was
 * typed in as two numbers before this control existed, where it is the
 * nearest whole row rather than an exact answer.
 *
 * @param {{w:number,h:number}} canvas
 * @param {number|'full'} columns
 * @param {number} [total] the section's column count
 * @param {number} [sectionPx] the section's measured width
 * @returns {number}
 */
export function rowsForShape(canvas, columns, total = HA_COLUMN_COUNT, sectionPx = 0) {
  if (!(canvas?.w > 0) || !(canvas?.h > 0)) return 1;
  const px = gridColumnsToPx(columns, total, sectionPx) * (canvas.h / canvas.w);
  return Math.max(1, Math.round((px + HA_ROW_GAP) / (HA_ROW_HEIGHT + HA_ROW_GAP)));
}

/**
 * A canvas shaped like the box the card actually occupies.
 *
 * `canvasFromGrid` infers that box from `grid_options` because Convert runs in
 * the edit dialog, where the card itself is not on screen to be measured. The
 * rows compatibility path has the real thing - the card's own resize observer
 * has already published its width and height - so it uses them and infers
 * nothing. Same scaling convention as `canvasFromGrid`: the longer side
 * becomes `scale`, since only the ratio carries meaning.
 *
 * A box with no area yet (the first render, before the observer has fired) has
 * no ratio to give, so the caller is told so rather than handed a square.
 *
 * @param {number} w measured width in px
 * @param {number} h measured height in px
 * @param {number} [scale]
 * @returns {{ w: number, h: number } | null}
 */
export function canvasFromBox(w, h, scale = 400) {
  if (!(w > 0) || !(h > 0)) return null;
  const k = scale / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * A first canvas for a card that has no layout to migrate.
 *
 * Reaching the canvas used to mean building a rows layout first and converting
 * it - switch the section on, add a row, add a cell, assign content, convert.
 * Four steps in the model the canvas replaces, which is a strange thing to ask
 * of someone who has just added a card.
 *
 * What lands on it is exactly what the card draws today, so switching models
 * changes the arrangement and not the contents. That means honouring every gate
 * the modules apply: `hide_icon` and its two siblings, the gauge and bar module
 * switches, a bar's own `active`, a label's `enabled`. Nothing here turns
 * anything on - an element someone switched off must not reappear because they
 * tried the canvas - and nothing is dropped either, because an element the
 * canvas does not name is not drawn at all, so a canvas that started empty
 * would blank the card.
 *
 * The arrangement is bands: the card's own three across the top the way the
 * content row has them, icon at the left with name over state beside it, then
 * one band each for every gauge, bar and label. Boxes fill their band rather
 * than taking `newBox`'s default size, which is tuned for dropping a single
 * element onto an existing canvas - a default box on the card's own default
 * shape, three columns wide, leaves a name in a 75-pixel strip.
 *
 * The section's column count is carried in for the same reason Convert carries
 * it: `gridColumnsToPx` counts a card's columns against the section it sits in,
 * and a full-width card in a wide section given one section's worth would take
 * the ratio of a card half its width.
 *
 * @param {any} cardConfig
 * @param {any} slot
 * @param {number} [total] the section's column count, from `sectionColumns`
 * @param {number} [sectionPx] the section's measured width, from `sectionWidthPx`
 * @returns {any} a canvas
 */
export function canvasFromCard(cardConfig, slot, total = HA_COLUMN_COUNT, sectionPx = 0) {
  const shape = canvasFromGrid(cardConfig, slot, 400, total, sectionPx);
  const icon = !slot?.hide_icon;
  const name = !slot?.hide_entity_name;
  const state = !slot?.hide_entity_state;

  const gauges = !slot?.gauge_active ? []
    : Array.isArray(slot.gauges) ? slot.gauges.map((_, i) => `gauge_${i}`)
    : ['gauge_0'];  // the legacy single gauge: the slot is the gauge
  const bars = !slot?.progressbar_active || !Array.isArray(slot.progressbars) ? []
    : slot.progressbars.map((b, i) => b?.active !== false ? `progressbar_${i}` : '').filter(Boolean);
  const labels = !Array.isArray(slot?.labels_list) ? []
    : slot.labels_list.map((l, i) => l?.enabled ? `label_${i}` : '').filter(Boolean);
  const stacked = [...gauges, ...bars, ...labels];

  const header = icon || name || state;
  const bands = stacked.length + (header ? 1 : 0);
  const elements = [];
  let band = 0;

  if (header) {
    // A row, not a block. Text does not grow with the box it is in, so a
    // header stretched down a tall card is a small icon and two small lines
    // adrift in empty space - on the card's own default shape, three columns
    // by three rows, that is most of the card.
    const b = bandRect(shape, band++, bands, shape.h * 0.25);
    // With nothing under it the cap has nothing to make room for, and a header
    // pinned to the top of an otherwise empty card reads as unfinished. The
    // content row centres it, and a card that has just been switched over
    // should look like the card it was.
    if (bands === 1) b.y = (shape.h - b.h) / 2;
    // The icon takes a square at the left and the two lines share the rest,
    // which is the content row's own arrangement. Without the icon the lines
    // have the whole band, which is also what the content row does.
    const iconW = icon ? Math.min(b.h, b.w / 3) : 0;
    // Square and centred in the band: the icon is round, so a tall box would
    // just be empty space that the editor still hands you as the element.
    if (icon) elements.push(el('icon',
      { x: b.x, y: b.y + (b.h - iconW) / 2, w: iconW, h: iconW }));
    const textX = b.x + (icon ? iconW + shape.w * 0.02 : 0);
    const textW = b.x + b.w - textX;
    const lines = [name && 'name', state && 'state'].filter(Boolean);
    lines.forEach((id, i) => elements.push(el(String(id), {
      x: textX, y: b.y + b.h * i / lines.length, w: textW, h: b.h / lines.length,
    })));
  }

  for (const id of stacked) {
    // One object and no header is not an arrangement, so it gets no band. The
    // content row draws such a card edge to edge - a lone gauge is its own
    // card - and the margins exist to keep an arrangement off the edges. Kept
    // here rather than fixed up by the caller, because this is the canvas the
    // editor writes down without asking for exactly this case, and it has to
    // be the card the person was already looking at.
    const b = bands === 1 ? { x: 0, y: 0, w: shape.w, h: shape.h }
                          : bandRect(shape, band++, bands);
    // A gauge, and a circular bar, is drawn as the largest square that fits
    // its box, so a wide box would be mostly empty space that still counts as
    // the element.
    const side = Math.min(b.w, b.h);
    elements.push(el(id, isSquareLocked({ id }, slot)
      // Centred both ways when it has the whole card: a band is a strip and
      // its square only has room to slide sideways, but a square in a card
      // that is taller than it is wide has to come down from the top too.
      ? { x: b.x + (b.w - side) / 2, y: b.y + (b.h - side) / 2, w: side, h: side }
      : b));
  }

  return { ...shape, elements };
}

/**
 * Whether turning this card's content row into a canvas would *arrange*
 * anything.
 *
 * This is the whole reason the switch is an offer rather than something the
 * editor does on opening. A rows layout migrates position for position: it
 * says where things go, and the canvas repeats it. A content row does not -
 * it stacks whatever the card shows, and `canvasFromCard` has to invent bands
 * to put that in. Inventing a layout and writing it into somebody's dashboard
 * unasked is not a migration, so it gets a button and a sentence saying what
 * the button will do.
 *
 * None of that applies to a card holding one object, or none. There are no
 * bands to invent, the single element fills the card exactly as the content
 * row drew it, and the offer is a button that changes nothing anybody can
 * see - in the way of the editor it is standing in front of. So the line is
 * drawn at the count, not at whether a layout key happens to exist.
 *
 * Counted off the canvas that would actually be written rather than off the
 * slot, because what becomes an element is `canvasFromCard`'s answer: which
 * gauges are active, which bars are switched on, which labels are enabled,
 * and whether the header is showing at all. The shape it is asked for makes
 * no difference to the count, so the defaults will do.
 *
 * @param {any} cardConfig
 * @param {any} slot
 * @returns {boolean}
 */
export function contentRowArranges(cardConfig, slot) {
  return canvasFromCard(cardConfig, slot).elements.length > 1;
}

/**
 * The usable rectangle of one band, inset from the card's edges.
 *
 * @param {{w: number, h: number}} shape
 * @param {number} idx
 * @param {number} of
 * @returns {{x: number, y: number, w: number, h: number}}
 */
function bandRect(shape, idx, of, maxH) {
  const bands = Math.max(1, of);
  const bandH = shape.h / bands;
  // `maxH` caps a band that would otherwise be the whole card. The vertical
  // margin comes off the capped height rather than the band, or a header
  // asked to be a quarter of the card would still start a sixth of the way
  // down it.
  const h = Math.min(bandH, maxH ?? bandH);
  // A margin all round, and a gap between bands: an arrangement that touches
  // the card's edges reads as a mistake rather than as a starting point.
  const mx = shape.w * 0.06, my = h * 0.15;
  return { x: mx, y: bandH * idx + my, w: shape.w - 2 * mx, h: h - 2 * my };
}

/** @param {string} id @param {{x: number, y: number, w: number, h: number}} box */
function el(id, box) {
  return { id, inner: 'cc', ...roundBox(box) };
}

/**
 * The same picture in a differently shaped coordinate space.
 *
 * Every element is a fraction of `w` and `h`, so scaling both the canvas and
 * the coordinates by the same factors leaves the layout where it was - as a
 * proportion of a card that has itself changed shape.
 *
 * Nothing is re-squared here, and that is the point. A gauge is drawn as
 * `100cqmin` inside its box, so it is already the largest square that fits,
 * sitting where `inner` puts it: the box around it can be a letterbox without
 * anything on screen looking any different. Squaring it here took
 * `min(w, h)`, which threw the longer side away - and threw it away for good,
 * because the way back squared again instead of restoring it. A card taken to
 * four rows and back came home with every gauge half the size it had been and
 * a hole where the arrangement used to be. Two factors are exactly
 * invertible; a minimum is not.
 *
 * Squaring stays where it belongs, on a user's edit: a drag, a typed size, a
 * bar turned into a ring.
 *
 * @param {any} canvas
 * @param {{ w: number, h: number }} shape
 * @returns {any} a new canvas
 */
export function rescaleCanvas(canvas, shape) {
  const kx = shape.w / canvas.w, ky = shape.h / canvas.h;
  const elements = (Array.isArray(canvas.elements) ? canvas.elements : []).map(el =>
    roundBox({ ...el, x: el.x * kx, y: el.y * ky, w: el.w * kx, h: el.h * ky }));
  return { ...canvas, w: shape.w, h: shape.h, elements };
}

/**
 * The canvas reshaped to a card whose height has just been fixed, remembering
 * the shape it is leaving.
 *
 * Under `rows: auto` the canvas decides how tall the card is, so its shape is
 * whatever the user drew. A row count takes that decision away, and matching
 * the new box is what keeps the arrangement filling the card instead of
 * letterboxing inside it.
 *
 * The shape being left is kept in `free` because nothing else knows it: when
 * the row count goes away again the card has no height of its own to go back
 * to, and the canvas would simply stay in whatever shape the last row count
 * left it in. It is written once - a second row count reshapes from wherever
 * the canvas is now and still comes home to the shape the user drew.
 *
 * @param {any} canvas
 * @param {{ w: number, h: number }} shape
 * @returns {any|null} null when the canvas is that shape already
 */
export function pinnedToShape(canvas, shape) {
  if (!canvas || (canvas.w === shape.w && canvas.h === shape.h)) return null;
  const free = canvas.free || { w: canvas.w, h: canvas.h };
  return { ...rescaleCanvas(canvas, shape), free };
}

/**
 * Whether something outside the canvas has fixed the card's height, so the
 * canvas has to fit inside a box it did not choose rather than define one.
 *
 * A row count from Home Assistant's layout tab is the only thing that does.
 * The card's own `card_height` looks like a second one and is not: it is
 * published as `--sc-explicit-height` on #main-container while `:host` is
 * what reads it, and a custom property does not travel back up to the host,
 * so the field has never had any effect. Treating it as a pin here would
 * shrink every canvas card that happens to carry a stale value.
 *
 * @param {any} cardConfig the Lovelace card config
 * @returns {boolean}
 */
export function isHeightPinned(cardConfig) {
  return typeof cardConfig?.grid_options?.rows === 'number';
}

/**
 * What a canvas element's id names, and the list it lives in.
 *
 * A canvas element is a *reference*, not a definition: the card fills
 * `<slot name="gauge_0">` with the one gauge of that index, so a second box
 * carrying the same id would draw nothing at all. Copying an element
 * therefore means copying whatever its id names and pointing the copy at the
 * new index.
 *
 * Null for everything that has no list to grow: `icon`, `name` and `state`
 * are parts of the card itself, and a gauge on a slot that never grew a
 * `gauges` array is the card's own config - materialising one here would
 * rewrite the gauge rather than copy it.
 *
 * @param {any} slot
 * @param {any} el a canvas element
 * @returns {{ key: string, list: any[], from: number, id: (n: number) => string } | null}
 */
function copySpec(slot, el) {
  const id = String(el?.id || '');
  /** @type {[RegExp, string, (n: number, m: RegExpMatchArray) => string][]} */
  const kinds = [
    [/^progressbar_(\d+)$/, 'progressbars', n => `progressbar_${n}`],
    [/^gauge_(\d+)$/, 'gauges', n => `gauge_${n}`],
    [/^label_(\d+)(_(?:icon|name|value))?$/, 'labels_list', (n, m) => `label_${n}${m[2] || ''}`],
  ];
  for (const [re, key, name] of kinds) {
    const m = id.match(re);
    if (!m) continue;
    const list = slot?.[key];
    const from = Number(m[1]);
    if (!Array.isArray(list) || !list[from]) return null;
    return { key, list, from, id: n => name(n, m) };
  }
  return null;
}

/**
 * Whether an element can be duplicated: a surface, or something with a list
 * behind it. See `copySpec`.
 *
 * @param {any} slot
 * @param {any} el a canvas element
 * @returns {boolean}
 */
export function canDuplicate(slot, el) {
  return !!el?.surface || !!copySpec(slot, el);
}

/**
 * The ids a selection frame dragged over the canvas catches.
 *
 * Wholly inside, not merely touched. Almost every canvas has a background
 * surface spanning the whole of it, and under a touches-it rule every frame
 * anywhere would sweep that up - so a frame would be useless for exactly the
 * layouts it is most wanted on. Wholly-inside also means the frame can be
 * drawn *over* a big element without catching it.
 *
 * Pinned elements are skipped: a lock is there so a stray gesture cannot
 * touch the element, and a frame dragged across the canvas is the stray
 * gesture it was locked against.
 *
 * The frame is given in canvas units and may be dragged in any direction, so
 * its corners are sorted rather than assumed.
 *
 * @param {any} canvas
 * @param {{x0: number, y0: number, x1: number, y1: number}} frame
 * @returns {string[]} ids, in the order the elements are stacked
 */
export function elementsInRect(canvas, frame) {
  const elements = Array.isArray(canvas?.elements) ? canvas.elements : [];
  const x0 = Math.min(frame.x0, frame.x1), x1 = Math.max(frame.x0, frame.x1);
  const y0 = Math.min(frame.y0, frame.y1), y1 = Math.max(frame.y0, frame.y1);
  return elements
    .filter(el => !isPinned(el)
                && el.x >= x0 && el.y >= y0
                && el.x + el.w <= x1 && el.y + el.h <= y1)
    .map(el => el.id);
}

/**
 * The canvas and the slot fields that result from copying several elements.
 *
 * One offset for all of them, clamped against the group's bounding box the
 * way a group drag is: copies that each clamped on their own would come out
 * in a different arrangement from the originals, which is the one thing a
 * copy must not do.
 *
 * Elements that cannot be duplicated - the card's single icon, name or state
 * - are passed over rather than refusing the whole copy, and null comes back
 * only when nothing in the selection could be copied at all.
 *
 * Pure: mutates neither argument. One element is a selection of one - there
 * is no second helper for that case, and a copy must behave the same whether
 * it was made alone or among others.
 *
 * @param {any} slot
 * @param {any} canvas
 * @param {string[]} ids
 * @returns {{ canvas: any, patch: Record<string, any[]>, ids: string[] } | null}
 */
export function duplicateElements(slot, canvas, ids) {
  const elements = Array.isArray(canvas?.elements) ? canvas.elements : [];
  const named = new Set(Array.isArray(ids) ? ids : []);
  const list = elements.filter(el => named.has(el.id) && canDuplicate(slot, el));
  if (!list.length) return null;

  const step = resolveSnap(canvas);
  const maxX = Math.max(...list.map(el => el.x + el.w));
  const maxY = Math.max(...list.map(el => el.y + el.h));
  const dx = Math.max(0, Math.min(step, canvas.w - maxX));
  const dy = Math.max(0, Math.min(step, canvas.h - maxY));

  /** @type {Record<string, any[]>} */
  const patch = {};
  const taken = new Set(elements.map(el => el.id));
  const copies = [];
  for (const el of list) {
    let id;
    if (el.surface) {
      let n = 0;
      while (taken.has(`surface_${n}`)) n++;
      id = `surface_${n}`;
    } else {
      // Against the slot the copies so far have already grown, or a second
      // gauge would be given the id the first one just took and append its
      // entry over the same index.
      const spec = copySpec({ ...slot, ...patch }, el);
      if (!spec) continue;
      id = spec.id(spec.list.length);
      patch[spec.key] = [...spec.list, structuredClone(spec.list[spec.from])];
    }
    taken.add(id);
    copies.push({ ...el, id, x: el.x + dx, y: el.y + dy });
  }
  if (!copies.length) return null;
  return { canvas: { ...canvas, elements: [...elements, ...copies] }, patch,
           ids: copies.map(c => c.id) };
}

/**
 * The kinds of element the canvas can create, in the order the menu offers
 * them.
 *
 * `module` names the `SupercardModules` entry whose `newEntry` supplies a
 * fresh definition - what a new gauge or label contains belongs to the module
 * that renders it - `key` the slot list the definition is appended to, and
 * `active` the module switch that has to be on before it draws anything. A
 * surface has none of the three: it exists only on the canvas.
 */
export const NEW_ELEMENT_KINDS = Object.freeze([
  Object.freeze({ kind: 'gauge', label: 'Gauge', module: 'gauge',
                  key: 'gauges', active: 'gauge_active', legacySingle: true }),
  Object.freeze({ kind: 'progressbar', label: 'Progressbar', module: 'progressbar',
                  key: 'progressbars', active: 'progressbar_active' }),
  // Named for what the element actually draws: a label box carries an icon, a
  // name and a value, and "Label" alone had people looking elsewhere for them.
  Object.freeze({ kind: 'label', label: 'Label, Icon & Values', module: 'labels', key: 'labels_list' }),
  Object.freeze({ kind: 'surface', label: 'Surface' }),
]);

/**
 * Whether the card can take another element of this kind.
 *
 * Only one thing says no: a card whose gauge *is* the slot, from before
 * `gauges` was an array. There is no array to append to, and writing one
 * would replace that gauge rather than add a second - the same reason
 * `copySpec` refuses it, and with it `duplicateElements`.
 *
 * @param {any} slot
 * @param {string} kind
 * @returns {boolean}
 */
export function canAddKind(slot, kind) {
  const spec = NEW_ELEMENT_KINDS.find(k => k.kind === kind);
  if (!spec) return false;
  return !(spec.legacySingle && !Array.isArray(slot?.[spec.key]) && !!slot?.[spec.active]);
}

/**
 * The box a new element gets: a fifth of the canvas' shorter side, centred on
 * `at` and snapped to the grid, clamped so it lands on the canvas whole.
 *
 * Sized from the canvas rather than from the snap step, because the step is
 * 1 unit on a free canvas and a four-unit box is invisible. A gauge is
 * square because it has to be and the icon because it draws a round glyph
 * across the shorter side of its box - a strip would leave the rest of it
 * empty. A surface is twice as wide as it is tall because a backdrop is, and
 * everything else is a flat strip, which is the shape of a bar and of a line
 * of text.
 *
 * `aspect` overrides that last case for something that knows its own shape -
 * a vertical bar, a ring - because the strip is only right for the horizontal
 * one, and a vertical bar dropped into a strip is a template that arrives
 * looking broken. It cannot override the square, which is a lock rather than
 * a default.
 *
 * @param {{w: number, h: number, grid?: number, snap?: number}} canvas
 * @param {string} id
 * @param {boolean} surface
 * @param {{x: number, y: number}} [at] defaults to the middle of the canvas
 * @param {number} [aspect] wanted width divided by height
 * @param {any} [slot] the card's own config, for a bar's orientation
 * @returns {{x: number, y: number, w: number, h: number}}
 */
function newBox(canvas, id, surface, at, aspect, slot) {
  const step = resolveSnap(canvas);
  const snap = v => Math.max(step, Math.round(v / step) * step);
  const side = snap(Math.min(canvas.w, canvas.h) / 5);

  const square = isSquareLocked({ id }, slot);
  let w = side, h = side;
  if (!square && aspect > 0) {
    // The long edge is the strip's, so a bar asking for 3 gets exactly the
    // strip back and the default stays one rule rather than two.
    const long = snap(side * 1.5);
    if (aspect >= 1) { w = long; h = snap(long / aspect); }
    else { h = long; w = snap(long * aspect); }
  }
  else if (surface) w = snap(side * 2);
  else if (!square) { w = snap(side * 1.5); h = snap(side * 0.5); }
  w = Math.min(w, canvas.w);
  h = Math.min(h, canvas.h);

  const cx = at ? at.x : canvas.w / 2;
  const cy = at ? at.y : canvas.h / 2;
  return {
    x: Math.max(0, Math.min(Math.round((cx - w / 2) / step) * step, canvas.w - w)),
    y: Math.max(0, Math.min(Math.round((cy - h / 2) / step) * step, canvas.h - h)),
    w, h,
  };
}

/**
 * Whether an id names an element the card actually has, and so one the canvas
 * can be told to show.
 *
 * The same answer `listElements` and `getLayoutTargets` give, over ids rather
 * than over the card: three elements are the card's own, the rest are an
 * index into a list, and a gauge on a slot that never grew a `gauges` array
 * is the single legacy one. An id nothing backs would draw an empty box for
 * ever, so it is refused rather than placed.
 *
 * @param {any} slot
 * @param {string} id
 * @returns {boolean}
 */
function placeableId(slot, id) {
  if (id === 'icon' || id === 'name' || id === 'state') return true;
  let m;
  if ((m = /^gauge_(\d+)$/.exec(id))) {
    return Array.isArray(slot?.gauges)
      ? Number(m[1]) < slot.gauges.length
      : (!!slot?.gauge_active && m[1] === '0');
  }
  if ((m = /^progressbar_(\d+)$/.exec(id))) {
    return Array.isArray(slot?.progressbars) && Number(m[1]) < slot.progressbars.length;
  }
  if ((m = /^label_(\d+)(?:_(?:icon|name|value))?$/.exec(id))) {
    return Array.isArray(slot?.labels_list) && Number(m[1]) < slot.labels_list.length;
  }
  return false;
}

/**
 * A new element on the canvas, and the definition behind it.
 *
 * `what` is either one of `NEW_ELEMENT_KINDS`' kinds - a new gauge, bar,
 * label or surface - or the id of something the card already has and the
 * canvas does not show yet, which needs no definition at all. `entry` is the
 * fresh list entry for the first case; see `NEW_ELEMENT_KINDS` for why it is
 * passed in rather than built here.
 *
 * Pure, and null when there is nothing to add: an unknown kind, one the card
 * cannot take (`canAddKind`), an id nothing backs, or one the canvas already
 * shows.
 *
 * @param {any} slot
 * @param {any} canvas
 * @param {string} what a kind, or the id of an existing element
 * @param {any} [entry] the new list entry, for a kind that has a list
 * @param {{x: number, y: number}} [at] point the box is centred on
 * @param {number} [aspect] the shape the entry wants, see `newBox`
 * @returns {{ canvas: any, patch: Record<string, any>, id: string } | null}
 */
export function addElement(slot, canvas, what, entry, at, aspect) {
  const elements = Array.isArray(canvas?.elements) ? canvas.elements : [];
  const who = newIdentity(slot, canvas, what);
  if (!who) return null;
  const { id, surface } = who;
  // Cloned here rather than in `pendingPatch`, because the other caller is
  // the ghost under a moving pointer and only reads what comes back.
  const patch = pendingPatch(slot, who, structuredClone(entry ?? {}));

  const el = { id, ...(surface ? { surface: true } : { inner: 'cc' }),
               ...newBox(canvas, id, surface, at, aspect, { ...slot, ...patch }) };
  return { canvas: { ...canvas, elements: [...elements, el] }, patch, id };
}

/**
 * What the slot gains when `entry` is added as `who`.
 *
 * Shared by the placement and by the ghost that previews it, because the two
 * have to size the box the same way and the entry is what decides it: a bar
 * is square only if it is a ring, and whether it is a ring is in the entry
 * being added, not in the slot it is being added to. Asking the old slot
 * gives the new element the shape of whatever happened to sit at that index
 * before - nothing, usually, so a ring came out a third smaller than the
 * ghost that promised it.
 *
 * @param {any} slot
 * @param {{spec?: {key?: string, active?: string}}} who from `newIdentity`
 * @param {any} entry
 * @returns {Record<string, any>} the keys to merge onto the slot
 */
function pendingPatch(slot, who, entry) {
  /** @type {Record<string, any>} */
  const patch = {};
  const spec = who?.spec;
  if (!spec?.key) return patch;
  const list = Array.isArray(slot?.[spec.key]) ? slot[spec.key] : [];
  patch[spec.key] = [...list, entry ?? {}];
  // Nothing renders while its module is off, and the switch that used to
  // turn it on is in the section the canvas replaces.
  if (spec.active && !slot?.[spec.active]) patch[spec.active] = true;
  return patch;
}

/**
 * Who the next element would be: the id it would take and whether it is a
 * surface, or null when there is nothing to add.
 *
 * Split out of `addElement` so the editor can draw the box a click is about
 * to create without creating it - see `newElementPreview`. A preview that
 * worked the id out for itself would be a second answer to the same
 * question, and the two would drift the first time a kind is added.
 *
 * @param {any} slot
 * @param {any} canvas
 * @param {string} what a kind, or the id of an existing element
 * @returns {{ id: string, surface: boolean, spec: any } | null}
 */
function newIdentity(slot, canvas, what) {
  const elements = Array.isArray(canvas?.elements) ? canvas.elements : [];
  const spec = NEW_ELEMENT_KINDS.find(k => k.kind === what);
  const id = String(what || '');

  if (!spec) {
    if (!placeableId(slot, id) || elements.some(e => e.id === id)) return null;
    return { id, surface: false, spec: null };
  }
  if (!canAddKind(slot, what)) return null;
  if (spec.key) {
    const list = Array.isArray(slot?.[spec.key]) ? slot[spec.key] : [];
    return { id: `${spec.kind}_${list.length}`, surface: false, spec };
  }
  let n = 0;
  while (elements.some(e => e.id === `surface_${n}`)) n++;
  return { id: `surface_${n}`, surface: true, spec };
}

/**
 * The element `addElement` would put at `at`, without adding it: the same id,
 * the same surface flag and the same box, snapped and clamped exactly as the
 * real one will be.
 *
 * Pure, and null wherever `addElement` would also refuse. The editor draws
 * this as a ghost under the crosshair, so what is shown before the click is
 * the thing the click produces rather than an approximation of it.
 *
 * @param {any} slot
 * @param {any} canvas
 * @param {string} what a kind, or the id of an existing element
 * @param {{x: number, y: number}} [at] point the box is centred on
 * @param {number} [aspect] the shape the entry wants, see `newBox`
 * @param {any} [entry] the entry the click will add, see `pendingPatch`
 * @returns {{ id: string, surface: boolean, x: number, y: number, w: number, h: number } | null}
 */
export function newElementPreview(slot, canvas, what, at, aspect, entry) {
  const who = newIdentity(slot, canvas, what);
  if (!who) return null;
  // The same prospective slot the click will use. `aspect` cannot stand in
  // for it: a square is a lock rather than a default, and `newBox` does not
  // read `aspect` at all once it has locked.
  const patch = pendingPatch(slot, who, entry);
  return { id: who.id, surface: who.surface,
           ...newBox(canvas, who.id, who.surface, at, aspect, { ...slot, ...patch }) };
}
