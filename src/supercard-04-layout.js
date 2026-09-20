import { LitElement, html, svg, css, unsafeCSS, nothing } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { resolveSnap, gridToUnits, unitsToGrid, applyDrag, applyGroupDrag, distributeElements,
         elementsInRect, duplicateElements,
         isSquareLocked, isPinned, DEFAULT_CANVAS, DEFAULT_GRID,
         gridRowsToPx, gridColumnsToPx, gridSize, canvasFromGrid, canvasFromCard,
         pinnedToShape, rescaleCanvas, rowsForShape,
         sectionColumns, sectionWidthPx, editingDialog, markDialogClean,
         dialogHasUnsavedWork, contentRowArranges, HA_COLUMN_COUNT,
         canDuplicate, reorderElement, overlappingElements,
         alignElements, restorePatch,
         NEW_ELEMENT_KINDS, canAddKind, addElement, newElementPreview,
         barIsCircular } from "./canvas-model.js";
import { needsRowsCompat, rowsAsCanvas } from "./rows-compat.js";
import { offsetsFromDrag, fontFromResize, GAUGE_VIEW,
         ringRadius, ringPartRadius, offsetFromRadius,
         needleEnds, needleFromRadius, needleSlide,
         ringInnerEdge, strokeFromRadius, alignParts, frameBand, gaugeScaleOf, gaugeOuter,
         frameInnerEdge, scaleFromRadius, frameWidthFromRadius } from "./gauge-inner-boxes.js";
import { templatesFor, templateEntry, previewFor, GAUGE_FACE } from "./element-templates.js";
import { revealBy, scrollParent } from "./reveal-scroll.js";
import { icon, iconMask } from "./icons.js";
import { dialFromStartAngle, startAngleFromDial } from "./gauge-angle.js";
import { GRADIENT_PRESETS, gradientPresetPatch } from "./gradient-presets.js";
import { labelFontSize, labelIconSize, DENSITY, FIT_DENSITY } from "./label-typography.js";
import { applyCardConfig } from "./card-apply.js";
import { highlightInk } from "./highlight-ink.js";
import { withoutElementConfig, TARGET_LISTS } from "./config-cleanup.js";
import { GRIP_CORNERS, radiusFromGrip, gripHome } from "./canvas-corner.js";
import { BEND_SIDES, BEND_ROOM, bendKey, bendAtKey, BEND_AT_MID,
         bendsOf, bendEscapes, isBent,
         bendClipPath, bendOutlineSvg, bentBox,
         bendGripHome, bendFromGrip } from "./canvas-bend.js";
import { PATTERN_ANIMATIONS, patternList, patternFor, patchPattern,
         defaultColorPattern, patternPreviewCss, patternRadiusCss,
         solidColorOf, solidColorPatch } from "./color-pattern.js";

const SC = window.SupercardUtils;

/**
 * How long the highlight stands out of the way after a colour was set.
 *
 * Long enough to judge the colour that was just chosen against the rest of
 * the drawing, short enough that the part is found again without having to
 * take it in hand a second time. The hold is pushed ahead by every write, so
 * a picker being dragged never gets its pulse back between two frames.
 */
const HL_HOLD_MS = 5000;

/**
 * The cell a template's miniature is drawn into, in CSS pixels.
 *
 * Here rather than in the stylesheet because `_previewBox` has to fit the
 * element's own shape inside it, and a cell size that lived in both places
 * would eventually disagree - the miniature would then be laid out to one
 * size and clipped to another.
 *
 * 3:2, because a 270-degree gauge face is wider than it is tall and a bar of
 * any orientation fits inside one.
 */
const TPL_CELL = Object.freeze({ w: 100, h: 66 });

/**
 * What stands over an element in the editor rather than being drawn by it.
 *
 * The frame is one box, and the element's own drawing is only one of its
 * children: the chips, the panel of numbers, the grips and the buttons are
 * siblings of it. So a rule written for what the element draws has to say so,
 * or it reaches the furniture too - and the overrides here are `!important`,
 * which is how an element with its overflow let out silently stopped its own
 * panel from scrolling, and one set in bold put its chips in bold with it.
 *
 * Excluding the grip by name was already the shape of the answer; this is the
 * whole list, in one place, so a new piece of furniture is added here rather
 * than found later as a chip in the wrong font.
 */
const EDITOR_FURNITURE = ['.handle', '.inner-open', '.inner-frame', '.inner-adds',
  '.corner-grip', '.ring-tag', '.ring-steps', '.ring-shape', '.ring-layer'].join(', ');

/**
 * Per-element typography, as CSS text.
 *
 * The card puts this on the slot it renders an element into; the canvas
 * editor puts it on the box it previews that element in. It has to be one
 * function, because a size written in em or % resolves against whichever box
 * the element is sitting in - and a preview whose text is a different size
 * from the card's is not previewing the card.
 *
 * @param {any} item element carrying font_size / font_weight / font_color / overflow
 * @param {string} boxSel selector for the box around the element
 * @param {string} elSel selector for the element inside that box
 * @returns {string}
 */
function itemTypography(item, boxSel, elSel) {
  let styles = '';
  const fc = item.font_adaptive ? 'var(--primary-text-color)' : (item.font_color || '');

  if (item.font_size || item.font_weight || item.font_color || item.font_adaptive) {
    const fsInherit = item.font_size ? `font-size: inherit !important;` : '';
    const fw = item.font_weight ? `font-weight:${item.font_weight}!important;` : '';
    const fccss = fc ? `color:${fc}!important;` : '';

    styles += `${elSel} { ${fsInherit}${fw}${fccss} }\n`;

    let vars = '';
    if (item.font_size) {
      const fsBase = `${item.font_size}${item.font_unit||'px'}`;
      const fsVar = `min(${fsBase}, 100cqh, 100cqi)`;
      vars += `font-size: ${fsVar} !important; --sc-fs-n:${fsVar}; --sc-fs-v:${fsVar}; `;
    }
    if (item.font_weight) { vars += `--sc-fw-n:${item.font_weight}; --sc-fw-v:${item.font_weight}; `; }
    if (fc) { vars += `--sc-fc-n:${fc}; --sc-fc-v:${fc}; `; }

    if (vars) { styles += `${boxSel} { ${vars} }\n`; }
  }

  if (item.overflow) {
    styles += `${boxSel} { overflow: visible !important; }
      ${elSel} { overflow: visible !important; max-width: none !important; text-overflow: clip !important; }\n`;
  }

  return styles;
}

// --- AVAILABLE ELEMENTS ---
// Grouped, and with four sub-targets per label, so this is not the flat
// SC.getAvailableElements the other editors use - but which gauges and bars
// exist comes from the same place.
function getLayoutTargets(slot) {
  const elements = [
    { id: 'empty', label: 'Empty', group: 'Basic' },
    { id: 'icon', label: 'Icon (main entity)', group: 'Basic' },
    { id: 'name', label: 'Name (main entity)', group: 'Basic' },
    { id: 'state', label: 'State / value', group: 'Basic' }
  ];

  const { gauges, bars } = SC.listElements(slot);
  for (const g of gauges) elements.push({ ...g, group: 'Gauges' });
  for (const b of bars) elements.push({ ...b, group: 'Progressbars' });

  if (Array.isArray(slot.labels_list)) {
    slot.labels_list.forEach((lbl, idx) => {
      const lblName = lbl.label_text || `Label ${idx + 1}`;
      const statusStr = !lbl.enabled ? ' (disabled)' : '';
      const gName = `Label ${idx + 1} - ${lblName}${statusStr}`;

      elements.push({ id: `label_${idx}`, label: `Complete (container/indicator)`, group: gName });
      elements.push({ id: `label_${idx}_icon`, label: `Icon only`, group: gName });
      elements.push({ id: `label_${idx}_name`, label: `Name only`, group: gName });
      elements.push({ id: `label_${idx}_value`, label: `Value only`, group: gName });
    });
  }

  return elements;
}


// --- LAYOUT RENDERER (LitElement) ---
class ScLayoutRenderer extends LitElement {
  static get properties() { return { config: { type: Object } }; }

  static get styles() {
    return css`
      :host {
        display: block; width: 100%; height: 100%; min-height: 60px;
        animation: fadeIn 0.15s ease-in-out;
      }
      @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
      
      .sc-layout-master { 
        display:flex; flex-direction:column; width:100%; height:100%; min-width:0; min-height:0; 
      }
      .sc-layout-row { display:flex; flex-direction:row; width:100%; min-height:0; min-width:0; }
      
      .sc-layout-cell {
        position: relative; 
        height: 100%; min-width: 0; min-height: 0; max-width: 100%; width: 100%;
        container-type: size; 
        container-name: cell;
      }
      
      .sc-layout-cell.overflow-hidden { overflow: hidden; }
      .sc-layout-cell.overflow-visible { overflow: visible; }
      
      /* The canvas: one coordinate space, a fixed aspect ratio, and children
         placed absolutely in percentages of it. Elements reuse .sc-item-slot
         below rather than getting a class of their own - it already carries
         the size container that sc-gauge's 100cqmin resolves against, and
         every typography rule in this file already addresses it. */
      .sc-canvas {
        position: relative; width: 100%;
        margin: 0 auto;
        container-type: size; container-name: cell;
      }
      .sc-canvas .sc-surface { pointer-events: none; }

      /* Only present when the card's height is pinned - by a row count in
         Home Assistant's layout tab, or by this card's absolute height. The
         canvas then has to fit inside a box it did not choose, so it keeps
         its ratio and is letterboxed rather than stretched: a max-height
         alone would clamp the height and leave the width at 100%, which is
         the one thing a fixed aspect ratio exists to prevent.

         Size containment needs a definite height and only gets one here,
         which is exactly what "pinned" means - hence the wrapper rather than
         a rule on .sc-canvas itself. It is also why the unpinned path emits
         no wrapper at all: container-type size against an indefinite height
         collapses the card to nothing. */
      .sc-canvas-fit {
        position: relative; width: 100%; height: 100%;
        container-type: size; container-name: card;
      }

      .sc-item-slot {
        position: absolute; 
        display: flex; box-sizing: border-box;
        pointer-events: auto; z-index: 2;
        overflow: hidden; 
        container-type: size;
        container-name: item;
      }
      
      .sc-item-slot.overflow-visible { overflow: visible !important; }
      
      .sc-lbl-n, .sc-lbl-v {
        line-height: 1.1; white-space: nowrap; overflow: hidden;
        text-overflow: ellipsis; max-width: 100%; min-width: 0; display: block;
      }
      
      ::slotted(*) { pointer-events:auto !important; }
      ::slotted(sc-gauge) { width:100cqmin !important; height:100cqmin !important; max-width:100% !important; max-height:100% !important; }
      ::slotted(sc-progressbar) { width:100% !important; max-height:100% !important; }
      /* The icon draws itself at a fixed 42px plus its border, scaled by
         --sc-scale - and --sc-scale is pinned to 1 on a canvas, so without
         this the box someone drew is ignored: cropped in a small one, lost in
         a large one. The glyph keeps the proportion it has in the content
         row, 24px inside the 44px the container actually occupies. */
      ::slotted(.sc-primary-icon) {
        box-sizing: border-box !important;
        width: 100cqmin !important; height: 100cqmin !important;
        --sc-icon-glyph: 54.5cqmin;
      }
      ::slotted([slot^="label_"]) {
        display:flex !important; flex-direction:column !important;
        align-items:center; justify-content:center; width:100%; height:100%;
        overflow: hidden; min-width: 0;
      }
      
      /* --- DEBUG MODE --- */
      .debug-mode .sc-layout-cell { outline: 1px solid rgba(0,255,0,0.5); background: rgba(0,255,0,0.05); }
      .debug-mode .sc-item-slot { outline: 1px solid rgba(255,0,255,0.6) !important; background: rgba(255,0,255,0.1) !important; }
      .debug-mode .sc-lbl-n, .debug-mode .sc-lbl-v, .debug-mode ::slotted(*) {
        outline: 1px dashed rgba(0,255,255,0.8) !important; background: rgba(0,255,255,0.1) !important;
      }
      .dbg-label { position:absolute; top:0; left:0; font-size:10px; color:#000; background:#0f0; padding:2px 4px; z-index:999; border-radius:0 0 4px 0; font-weight:bold; pointer-events:none; }
      .debug-flexbox .sc-item-slot { 
        outline: 1px dotted rgba(255, 255, 0, 0.8) !important; 
        background: rgba(255, 255, 0, 0.1) !important; 
      }
    `;
  }

  _innerStyle(pos) {
    const m = {
      tl:'start,flex-start,left', tc:'start,center,center', tr:'start,flex-end,right',
      cl:'center,flex-start,left', cc:'center,center,center', cr:'center,flex-end,right',
      bl:'end,flex-start,left', bc:'end,center,center', br:'end,flex-end,right'
    };
    const [ai, jc, ta] = (m[pos] || m['cc']).split(',');
    return `align-items:${ai}; justify-content:${jc}; text-align:${ta};`;
  }

  _getResolvedLabel(id) {
    const labels = this.config?.__moduleData?.labels?.labelsResolved;
    if (!Array.isArray(labels)) return null;
    return labels.find(lbl => lbl.id === id) || null;
  }

  _renderResolvedLabel(id, layoutItem) {
    const match = id.match(/^label_(\d+)(?:_(icon|name|value))?$/);
    if (!match) return html``;
    const lIdx = match[1];
    const part = match[2];

    const item = this._getResolvedLabel(`label_${lIdx}`);
    if (!item || !item.enabled) return html``;

    const isOverflow = layoutItem && layoutItem.overflow;
    const overflowCSS = isOverflow ? 'overflow:visible; white-space:nowrap; max-width:none;' : 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%;';
    const wrapCSS = isOverflow ? 'overflow:visible; max-width:none;' : 'max-width:100%; overflow:hidden;';

    const tName = item.text?.name || '';
    const tValue = item.text?.value || '';

    const lenName = Math.max(1, tName.length) + 1;
    const lenValue = Math.max(1, tValue.length) + 1;

    // A density that only caps a chosen size may be optimistic; one that
    // decides the size may not - see FIT_DENSITY.
    const density = layoutItem?.font_fit ? FIT_DENSITY : DENSITY;
    const factorN = layoutItem?.font_factor || density;
    const factorV = layoutItem?.font_factor || density;

    const shadowCSS = item.text?.shadow ? 'text-shadow: 0 1px 2px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.5);' : '';
    const iconShadow = item.text?.shadow ? 'filter: drop-shadow(0px 1px 2px rgba(0,0,0,0.8));' : '';

    /*
     * A box drawn large on the canvas is usually asking for text that fills
     * it, and until now it got text at the card's own size that only shrank
     * when the box became too small. `font_fit` is that second reading, asked
     * for per element: the size the element was given drops out of the min()
     * and the box decides. Both lines of a label that shows a name over a
     * value then share the height, or the two of them together are taller
     * than the box they are in.
     */
    const fit = !!layoutItem?.font_fit;
    const stacked = fit && part === undefined && item.text?.showName !== false && !!tValue ? 2 : 1;
    // The icon sits on the name's line, so only that line pays for it.
    const besideName = fit && item.icon?.enabled && item.icon.position !== 'only' && part !== 'value';
    const nameSize = labelFontSize({ chars: lenName, factor: factorN, lines: stacked,
                                     base: fit ? null : 'var(--sc-fs-n, inherit)',
                                     iconGap: besideName ? (item.icon.gap ?? 4) : null });
    const valueSize = labelFontSize({ chars: lenValue, factor: factorV, lines: stacked,
                                      base: fit ? null : 'var(--sc-fs-v, inherit)' });

    const nameStyle = `font-size: ${nameSize}; font-weight:var(--sc-fw-n, inherit); color:var(--sc-fc-n, inherit); line-height:1.1; margin:0; padding:0; display:block; min-width:0; ${overflowCSS} ${shadowCSS}`;
    const valueStyle = `font-size: ${valueSize}; font-weight:var(--sc-fw-v, inherit); color:var(--sc-fc-v, inherit); line-height:1.1; margin:0; padding:0; display:block; min-width:0; ${overflowCSS} ${shadowCSS}`;

    // An icon beside text is text-sized; an icon alone has the whole box.
    const iconSizeVar = labelIconSize(fit
      ? { lines: stacked }
      : { base: `var(--sc-fs-n, ${item.icon.size || '20px'})` });
    const iconTpl = item.icon?.enabled ? html`<ha-icon icon=${item.icon.name} style="--mdc-icon-size:${iconSizeVar}; color:${item.icon.color || 'inherit'}; ${iconShadow} vertical-align:middle; display:inline-flex; align-items:center; flex-shrink:0;"></ha-icon>` : null;

    if (part === 'icon') return iconTpl ? html`<div style="display:flex;align-items:center;justify-content:center;min-width:0;${wrapCSS}">${iconTpl}</div>` : html``;
    if (part === 'name') return html`<span class="sc-lbl-n" style="${nameStyle}">${item.text?.name || ''}</span>`;
    if (part === 'value') return html`<span class="sc-lbl-v" style="${valueStyle}">${item.text?.value || ''}</span>`;
    if (item.mode === 'icon-only') return html`<div style="display:flex;align-items:center;justify-content:center;min-width:0;${wrapCSS}">${iconTpl}</div>`;

    const pre = item.icon?.enabled && item.icon.position === 'before' ? html`<span style="margin-right:${item.icon.gap ?? 4}px;display:inline-flex;flex-shrink:0;">${iconTpl}</span>` : null;
    const suf = item.icon?.enabled && item.icon.position === 'after' ? html`<span style="margin-left:${item.icon.gap ?? 4}px;display:inline-flex;flex-shrink:0;">${iconTpl}</span>` : null;

    if (item.text?.showName !== false) {
      return html`
        <div style="display:flex; flex-direction:column; align-items:inherit; justify-content:inherit; min-width:0; ${wrapCSS}">
          <div style="display:flex; align-items:center; min-width:0; ${wrapCSS}">
            ${pre}<span class="sc-lbl-n" style="${nameStyle}">${item.text?.name || ''}</span>${suf}
          </div>
          ${item.text?.value ? html`<span class="sc-lbl-v" style="${valueStyle} margin-top:2px;">${item.text.value}</span>` : ''}
        </div>`;
    }

    return html`<div style="display:flex; align-items:center; min-width:0; ${wrapCSS}">${pre}<span class="sc-lbl-n" style="${nameStyle}">${item.text?.value || item.text?.name || ''}</span>${suf}</div>`;
  }

  /**
   * Per-element CSS, keyed on data-item-id. Shared by both render paths: the
   * canvas places the same .sc-item-slot boxes the row/cell layout does, so
   * this addresses them identically either way.
   */
  _itemStyles(items) {
    return items.map(item => {
      const box = `.sc-item-slot[data-item-id="${item.id}"]`;
      let styles = itemTypography(item, box, `::slotted([slot="${item.id}"])`);

      // The label module draws its own spans inside the slot, so they need the
      // same release from clipping. Nothing else renders text in there, which
      // is why this stays here rather than in the shared function.
      if (item.overflow) {
        styles += `${box} .sc-lbl-n, ${box} .sc-lbl-v { overflow: visible !important; max-width: none !important; text-overflow: clip !important; }\n`;
      }
      return styles;
    }).filter(Boolean).join('\n');
  }

  /**
   * The canvas path: one coordinate space, elements placed absolutely.
   *
   * Geometry is stored in virtual units and converted to percentages here, so
   * a fixed aspect ratio makes percentage positioning uniform scaling - no
   * measured scale factor is needed. Font sizes need none either: every one
   * in the wild uses container units (cqw, cqmin), which resolve against the
   * element's own size container, and that box is the same either way.
   *
   * Surfaces carry no slot. They exist to be painted by a colour or fx-glass
   * pattern, so they take no pointer events and get a part to address.
   */
  _renderCanvas(canvas) {
    const debug = this.config.layout_debug;
    const els = Array.isArray(canvas.elements) ? canvas.elements : [];
    const pct = (v, total) => `${(v / total * 100).toFixed(4)}%`;

    // Unpinned, the canvas defines the card's height: full width, and the
    // ratio supplies the rest. Pinned, the height is already decided, so the
    // width comes down from it instead and the canvas centres in what is left.
    const fit = this.config.__heightPinned;
    const box = fit
      ? `aspect-ratio: ${canvas.w} / ${canvas.h}; width: min(100%, calc(100cqh * ${(canvas.w / canvas.h).toFixed(6)}));`
      : `aspect-ratio: ${canvas.w} / ${canvas.h};`;

    const canvasHtml = html`
      <div class="sc-canvas ${debug ? 'debug-mode' : ''}" style="${box}">
        ${els.map(el => {
          const box = `left:${pct(el.x, canvas.w)}; top:${pct(el.y, canvas.h)};` +
                      ` width:${pct(el.w, canvas.w)}; height:${pct(el.h, canvas.h)};`;
          if (el.surface) {
            return html`<div class="sc-item-slot sc-surface" part="element-${el.id}"
                             data-item-id="${el.id}" style="${box}"></div>`;
          }

          let containerCSS = '';
          if (el.id?.startsWith('label_')) {
            const match = el.id.match(/^label_(\d+)/);
            if (match) {
              const lblData = this._getResolvedLabel(`label_${match[1]}`);
              if (lblData && lblData.container && lblData.container.isIndicator) {
                const c = lblData.container;
                containerCSS = `background: ${c.bgColor} !important; border-radius: ${c.radius} !important; color: ${c.color} !important; transition: background 0.3s ease, color 0.3s ease, border-radius 0.3s ease; box-sizing: border-box;`;
              }
            }
          }

          return html`
            <div class="sc-item-slot ${el.overflow ? 'overflow-visible' : ''}"
                 part="element-${el.id}" data-item-id="${el.id}"
                 style="${box} ${this._innerStyle(el.inner || 'cc')} ${containerCSS}">
              ${debug ? html`<div class="dbg-id" style="position:absolute; bottom:0; right:0; font-size:9px; color:#fff; background:rgba(244,67,54,0.9); padding:1px 3px; z-index:999; border-radius:3px 0 0 0; font-weight:bold; white-space:nowrap; pointer-events:none;">${el.id}</div>` : ''}
              ${el.id?.startsWith('label_') ? this._renderResolvedLabel(el.id, el) : html`<slot name="${el.id}"></slot>`}
            </div>`;
        })}
      </div>`;

    return html`
      <style>${this._itemStyles(els.filter(e => !e.surface))}</style>
      ${fit ? html`<div class="sc-canvas-fit">${canvasHtml}</div>` : canvasHtml}`;
  }

  render() {
    // One model reaches this point. A card still carrying `layout_rows` is
    // answered with the canvas that layout describes before the renderer ever
    // sees it - see rows-compat.js - so there is nothing here to fall back to.
    if (this.config?.canvas) return this._renderCanvas(this.config.canvas);
    return html``;
  }
}
if (!customElements.get('sc-layout-renderer')) customElements.define('sc-layout-renderer', ScLayoutRenderer);



// --- CANVAS EDITOR -------------------------------------------------------
// One canvas, elements placed on it directly. The rows/cells/items model it
// replaced is gone; what is left of it is rows-compat.js, which reads an old
// card's `layout_rows` as the canvas it describes.
//
// All geometry maths lives in canvas-model.js and is unit-tested there; this
// component turns pointer positions into a delta in virtual units and draws
// the result. Nothing here decides where an element lands.

/**
 * How far a press may sit from the one before it and still count as the same
 * spot - both for walking down the stack under the pointer and for telling a
 * click from a drag. Small enough that aiming at a different element never
 * counts as the same spot, large enough to absorb the hand's own wobble.
 */
const SAME_SPOT_PX = 4;

/**
 * How far outside its own rect a part's frame can still be grabbed.
 *
 * The same 8px `.inner-frame::after` adds - a single digit's text rect is too
 * small a thing to aim at - and the walk down a stack of parts has to test
 * against what the pointer can actually hit, or a press would pick a part
 * that the stack it is walking says is not there.
 */
const PART_GRAB_PX = 8;

/**
 * How thick a sizing band is drawn, in screen pixels.
 *
 * In pixels rather than in the gauge's own units so that it is the same line
 * whatever the gauge's size - the needle's handles and the crosshair are
 * already measured that way. A pixel: half a pixel was tried and is too
 * little to see, and this is still thinner than the band was on a gauge of
 * any size, which is the point - it lies across the very ticks and numbers it
 * is there to place.
 */
const BAND_PX = 1;

/**
 * The icon on an alignment button.
 *
 * Two bars and the line they are pulled to. Unicode has arrows and brackets
 * but nothing that reads as "line these up on their left edges", and six
 * buttons that all look like arrows are six buttons nobody can tell apart.
 *
 * @param {'left'|'hcenter'|'right'|'top'|'vcenter'|'bottom'} edge
 */
/**
 * The mark on an align button.
 *
 * Each one shows what it does rather than which way it points: bars gathered
 * against an edge, or run through the middle they are put back on. An arrow
 * only says "that way", and six arrows in a row say it six times.
 */
function alignIcon(edge) {
  const name = { left: 'align-start-vertical', right: 'align-end-vertical',
                 top: 'align-start-horizontal', bottom: 'align-end-horizontal',
                 hcenter: 'align-center-vertical',
                 vcenter: 'align-center-horizontal' }[edge];
  return name ? icon(name) : '';
}

/**
 * How many steps back the canvas editor remembers.
 *
 * A snapshot is the canvas and the element lists, so a card with sixteen
 * gauges is a few kilobytes of it; thirty of those is nothing next to what
 * the editor already holds, and further back than anybody reaches by hand.
 */
const HISTORY_DEPTH = 30;

/**
 * What the arrows put back.
 *
 * The canvas, the elements on it, and the box the card asks Home Assistant
 * for - not the colour rules, the glass patterns or the interactions, which
 * are edited in their own sections of the same dialog and are nobody's idea
 * of "the last thing I did on the canvas".
 */
const HISTORY_KEYS = Object.freeze(['canvas', 'gauges', 'progressbars', 'labels_list']);

/**
 * What the one step that deletes a surface has to answer for.
 *
 * A surface is nothing but its box, so deleting the box takes its paint, its
 * glass and its push with it - and a step that removes those has to be able
 * to hand them back, or its undo puts back a surface nobody had. Only that
 * step: see `_snapshot`.
 */
const SNAPSHOT_KEYS = Object.freeze([...HISTORY_KEYS, ...TARGET_LISTS]);

/**
 * Whether a commit changes anything an undo snapshot holds - the slot keys
 * above, or Home Assistant's `grid_options`. Everything else travels through
 * the same editor (the element settings commit through it, so their steps sit
 * in the right order) but is not its to put back.
 *
 * @param {string} key @param {any} value
 */
function touchesHistory(key, value) {
  if (key === '__batch__') {
    return Array.isArray(value) && value.some(([k, v]) => touchesHistory(k, v));
  }
  if (key === '__card__') return !!value && Object.keys(value).includes('grid_options');
  if (key === '__merge__') return !!value && Object.keys(value).some(k => HISTORY_KEYS.includes(k));
  return HISTORY_KEYS.includes(key);
}

/**
 * The zoom levels the - and + buttons walk through.
 *
 * Zoom is a property of the view, never of the card: it scales the pixels the
 * canvas is drawn at and nothing else. Every pointer position is read against
 * the canvas' own rect and divided by its width (`_bandPoint`, `_atPointer`,
 * `_onMove`), so an element's coordinates stay the whole canvas units they
 * were - which is the point, since the snapping work rests on them being
 * whole. Nothing here is ever committed.
 *
 * 1 is the level at which the canvas fits its frame exactly; the two below it
 * are for a tall canvas whose whole shape no longer fits the editor.
 *
 * @type {readonly number[]}
 */
const ZOOM_STEPS = Object.freeze([0.5, 0.75, 1, 1.5, 2, 3, 4]);

/**
 * How near the edge of the zoomed view a drag has to come before the view
 * follows it, and the most it may travel in one frame.
 *
 * A drag that reaches the edge of the window has nowhere left to go: the
 * element is still held, the rest of the canvas is a scroll away, and the
 * hand would have to let go to get there. So the view scrolls itself, faster
 * the deeper into the strip the pointer is - which also means a pointer that
 * merely grazes the edge barely moves it.
 *
 * Deliberately slow: the point is to reach the next part of the canvas while
 * still holding an element, not to cross the whole drawing. Hard against the
 * edge this is 9px a frame - a window's width or so a second at 60Hz, which
 * the eye can follow and the hand can stop - and it falls off across the
 * strip to a crawl where the pointer only grazes it.
 */
/*
 * The zoom is not remembered between two openings of the dialog, and that is
 * on purpose.
 *
 * It used to be, keyed by the canvas' shape and kept for as long as the page
 * lived, on the reasoning that a glance at something else should not cost the
 * magnification you had set up. In use it was the other way round: the zoom
 * that was right for the corner being worked on is exactly the wrong thing to
 * be handed when the card is opened the next time for something else, and a
 * view nobody set, restored from a session that is over, is a view nobody can
 * account for. Opening the editor shows the whole card, which is what the
 * editor is for.
 *
 * It costs nothing inside one dialog: Home Assistant renders one tab at a
 * time and takes this editor out of the document for the Layout tab, but it
 * keeps the element and puts the same instance back, so the zoom is still
 * whatever it was. Measured, not assumed - the tab switch gives back an
 * element identical to the one that left, while a second opening of the
 * dialog builds a new one.
 */

/**
 * Whether leaving an element's own parts takes the canvas back to the zoom it
 * was being arranged at.
 *
 * Going in magnifies, because the parts are a couple of viewBox units across
 * and cannot otherwise be aimed at; coming back out undoes that, because the
 * arrangement is what the canvas is for. But leaving happens by clicking
 * beside the element as often as by pressing the button, and someone working
 * their way around one element at a time loses the magnification every time
 * their aim is off. So it is a choice, kept here for the same reason the zoom
 * itself is - a preference of the bench, never written to a card.
 */
let zoomBack = true;

/**
 * Whether a finger on the canvas draws on it, or scrolls the page past it.
 *
 * Only a touchscreen has to choose. `touch-action` is read once, when the
 * finger goes down, so the gesture belongs to one of the two before anything
 * can look at it - there is no deciding halfway through, and no gesture that
 * is both. Scrolling is the answer for the finger that is only passing the
 * canvas on its way down the dialog, which is most of them; drawing is the
 * answer while the canvas is actually being arranged, and it is what brings
 * the selection frame and the pinch back. So it is a switch, and it is above
 * the canvas as well as below it, because the finger that is stuck is on the
 * canvas and either end of it is a thumb away.
 *
 * Module scope, like `zoomBack`: the bench, not the card, and it outlives
 * the dialog so the choice is not made again on every open.
 */
let fingerDraws = false;

/**
 * Whether anything on this device can touch the screen at all. Read once -
 * a display does not grow a touchscreen while a dialog is open - and only
 * used to keep the switch out of a mouse's way, where `touch-action` decides
 * nothing.
 */
const CAN_TOUCH = typeof window !== 'undefined'
  && !!window.matchMedia?.('(any-pointer: coarse)').matches;

/**
 * Where a chip has been put by hand, for as long as the page lives.
 *
 * A chip stands where its part is, which is the right place for it right up
 * to the moment the part it names is under it - a tick label behind the
 * subticks' numbers, a colour cluster over the very corner being rounded. So
 * a chip can be picked up and put down anywhere on the element, and it takes
 * its own numbers with it.
 *
 * Like the zoom, this is not config: it is the bench the work is done on, not
 * the work. Writing it would put one person's arrangement of the editor into
 * everybody's dashboard. It is keyed by the element and the part, so each
 * chip is remembered on its own, and a chip that has been moved is put back
 * where its part says by double-clicking it.
 */
const chipPlace = new Map();

const chipKey = (/** @type {string} */ id, /** @type {string} */ part) => id + '\u0000' + part;

/**
 * How big the chip menus are drawn, and how far the grip may take them.
 *
 * One number for all of them rather than one per chip: the size is a
 * question about the person reading, not about the part - a menu that has to
 * be bigger to be hit is a menu that has to be bigger everywhere. Module
 * scope for the same reason `zoomBack` is: it outlives the dialog, so the
 * setting does not have to be made again the next time a card is opened.
 *
 * The bounds are what stays usable: below three quarters the icons stop
 * being readable, above double the menu is most of the canvas it is drawn
 * over.
 */
const STEPS_MIN = 0.75;
const STEPS_MAX = 2;
let stepsZoom = 1;

/** How much of the window a "zoom to the selection" leaves around it. */
const FIT_MARGIN = 0.85;

/**
 * The same, on the way into a gauge's own parts: none.
 *
 * The air the button leaves is what lets a selection be seen in its
 * surroundings, and on the way in there are no surroundings to see - the
 * gauge is the whole of what is being worked on, and every one of its parts
 * is a couple of viewBox units across. So it fills the window.
 */
const INNER_FILL = 1;

/**
 * The same, for a kind whose controls stand on the element's own edge.
 *
 * A gauge's parts are all inside it, so filling the window is only ever a way
 * of making them bigger. A surface's corner grips are *on* the border, and a
 * bar's will be too - filled to the edge, they sit under the rim of the window
 * itself, where a press that misses by a pixel takes hold of the view and
 * scrolls it instead. The room outside the element is what makes them
 * grabbable, and it is the whole reason for the number.
 */
const RIM_FILL = 0.9;

/**
 * The shape the window is drawn at while a gauge's own parts are being
 * edited: a square, whatever shape the canvas is.
 *
 * The window otherwise carries the canvas' shape, so on a flat card - 12
 * columns by 2 rows - the height is already the tight axis at 100%: the zoom
 * that fits one gauge into it is *below* one, and asking to work on a gauge
 * made the whole drawing smaller. A square gives the vertical axis the room
 * the horizontal one already has, and it is the shape a gauge itself is. A
 * canvas taller than it is wide is left alone: there the width is the tight
 * axis and the fit works already.
 */
const INNER_RATIO = 1;

/**
 * The parts of a gauge the canvas can edit directly, and the fields each of
 * them is.
 *
 * The gauge draws both from a centre offset and a font size, in the units of
 * its own viewBox - so a frame on the canvas is those three numbers, and
 * dragging or resizing it writes them. The defaults are the gauge's own: a
 * part that has never been set still has to be drawn somewhere, and the frame
 * has to go to the same place.
 */
/**
 * The weights a text on a gauge can be set to, and the button that steps
 * through them.
 *
 * Drawn as an A in the weight it would give, because that is the whole
 * setting: three words in a select say less about it than three letters do.
 */
/**
 * The three weights, and why one of them is 500 rather than 600.
 *
 * Home Assistant ships Roboto at 100, 300, 400, 500, 700 and 900. Ask for 600
 * and the browser goes looking upward for the nearest cut it has, which is
 * 700 - measured on the demo, "Value 88.8" comes out at 191.74 px at both
 * weights and 189.86 at 500. So semi-bold was bold under another name, and
 * the middle of the three is now the medium the font actually has.
 *
 * A card that already says 600 is left alone: it draws what it always drew.
 */
const textWeights = (/** @type {string} */ key,
                     /** @type {string|((cfg: any) => string)} */ dflt) => ({
  key, dflt, order: ['400', '500', '700'],
  of: { '400': { glyph: 'A', label: 'to normal', weight: 400 },
        '500': { glyph: 'A', label: 'to medium', weight: 500 },
        '700': { glyph: 'A', label: 'to bold', weight: 700 } },
});

/**
 * The two glyphs that tell a mark's length from its thickness.
 *
 * A tick runs outward from the ring, so its length is the up-and-down icon
 * and its width the one across - the same way round as the mark itself.
 */
const LONG = icon('move-vertical');
const THICK = icon('move-horizontal');

/**
 * A mark's colour is stored the way the colour reader takes it - a hex string,
 * an rgb(), or the [r,g,b] array older cards carry - and the browser's own
 * colour control speaks nothing but #rrggbb, so a swatch reads through toRgb.
 */
const markHex = (/** @type {any} */ value, /** @type {string} */ dflt) => {
  const rgb = SC.toRgb(value, { resolveVars: true });
  return rgb ? SC.rgbToHex(rgb[0], rgb[1], rgb[2]) : dflt;
};

/** A shadow is off, a colour of its own, or taken from what it falls from. */
const SHADOW_MODE = Object.freeze([
  { value: 'none', label: 'None', short: 'None' },
  { value: 'fixed', label: 'Fixed', short: 'Fixed' },
  { value: 'adaptive', label: 'Adaptive', short: 'Adaptive' },
]);

/** Whether there is a shadow for the four rows under it to shape. */
const hasShadow = (/** @type {any} */ cfg) =>
  (cfg.pointer_shadow_type || 'none') !== 'none';

/**
 * How a ring is coloured, and what each answer then asks for.
 *
 * The same four the form has always offered. Manual is a list of stops and the
 * list stays in the form - a row of draggable colours is not a control that
 * fits under a chip - but the ramp that fills it does fit, as one menu of
 * ready-made ones.
 */
const RING_COLOUR_MODE = Object.freeze([
  { value: 'manual', label: 'Manual (list)', short: 'List' },
  { value: 'symmetriccustom', label: 'Symmetric (custom)', short: 'Sym.\u00A0custom' },
  { value: 'symmetric', label: 'Symmetric (default)', short: 'Symmetric' },
  { value: 'linear', label: 'Linear traffic light', short: 'Linear' },
]);

/** Whether the ring is being coloured from a list of stops. */
const isStopList = (/** @type {any} */ cfg) =>
  ['manual', undefined, ''].includes(cfg.gradient_preset);

/** Whether the ring is one of the two that are three colours and no list. */
const isThreeColour = (/** @type {any} */ cfg) =>
  ['symmetric', 'symmetriccustom'].includes(cfg.gradient_preset);

/** The ready-made ramps, as the menu reads them: a name and what it is for. */
const RAMP_PICKS = Object.freeze([
  { value: '', label: 'Ramp\u2026', short: 'Ramp\u2026' },
  ...GRADIENT_PRESETS.map(pr => ({ value: pr.id, label: pr.label + ' \u2013 ' + pr.hint,
                                   short: pr.label })),
]);

/**
 * How far the dial goes round, and where it begins.
 *
 * One question asked twice, so the two rows travel together - and they are
 * offered under two chips, because the answer belongs to two things at once.
 * The sweep is the ring's, which is what draws it; the start is the
 * pointer's, which is what you watch while you set it. Listed twice rather
 * than written twice: it is the same pair of rows either way, so the two
 * chips cannot drift apart.
 *
 * The sweep has two values, so it reads as the switch it is rather than as a
 * list with two things in it. The start is shown clockwise from the top and
 * stored in the renderer's unit, where zero is three o'clock - hence the two
 * translators; see `gauge-angle.js` for why the stored unit cannot simply
 * change. `read` alone would only get a translated value as far as the
 * thumb, which is why the slider honours `patch` too. A semi gauge is
 * anchored where its gap looks right and has no say in where it starts,
 * which is the condition the form's own field carries as well.
 */
const SWEEP_STEPS = Object.freeze([
  { key: 'gauge_type', icon: icon('chart-pie'), what: 'sweep',
    read: (/** @type {any} */ cfg) => cfg.gauge_type || 'full',
    picks: [{ value: 'full', label: 'Full 360\u00B0', short: '360\u00B0' },
            { value: 'semi', label: 'Semi 270\u00B0', short: '270\u00B0' }] },
  { key: 'gauge_start_angle', icon: icon('compass'), slide: true, by: 1, min: 0, max: 359,
    dflt: 0, what: 'start position, clockwise from the top',
    condition: (/** @type {any} */ cfg) => (cfg.gauge_type ?? 'full') === 'full',
    read: (/** @type {any} */ cfg) => dialFromStartAngle(cfg.gauge_start_angle),
    patch: (/** @type {any} */ _cfg, /** @type {number} */ v) =>
      ({ gauge_start_angle: startAngleFromDial(v) }) },
]);

/** One swatch on the ring, for the presets that are three colours rather than a list. */
const ringColour = (/** @type {string} */ key, /** @type {string} */ what,
                    /** @type {string} */ dflt, /** @type {any} */ condition) => ({
  icon: icon('paintbrush'), what, paint: true, condition,
  read: (/** @type {any} */ cfg) => markHex(cfg[key], dflt),
  patch: (/** @type {any} */ _cfg, /** @type {string} */ v) => ({ [key]: v }),
});

/** Fixed or adaptive: the same two answers for every mark a gauge draws. */
const COLOUR_MODE = Object.freeze([
  { value: 'fixed', label: 'Fixed', short: 'Fixed' },
  { value: 'adaptive', label: 'Adaptive', short: 'Adaptive' },
]);

/** The pair of rows that says how a mark is coloured, for whichever mark. */
const colourRows = (/** @type {string} */ mode, /** @type {string} */ key,
                    /** @type {string} */ what, /** @type {string} */ dflt,
                    /** @type {string} */ fallback,
                    /** @type {((cfg: any) => boolean)=} */ when) => [
  { key: mode, icon: icon('palette'), what: what + ' colour', picks: COLOUR_MODE,
    condition: when,
    read: (/** @type {any} */ cfg) => cfg[mode] || fallback },
  { icon: icon('paintbrush'), what: 'fixed ' + what + ' colour', paint: true,
    condition: (/** @type {any} */ cfg) => (cfg[mode] || fallback) !== 'adaptive'
                                        && (!when || when(cfg)),
    read: (/** @type {any} */ cfg) => markHex(cfg[key], dflt),
    patch: (/** @type {any} */ _cfg, /** @type {string} */ v) => ({ [key]: v }) },
];

/**
 * The swatch that belongs beside a bar's adaptive switch.
 *
 * A bar says how a mark is coloured with a flag rather than with the gauge's
 * fixed/adaptive pair, so `colourRows` does not fit - but the hole it leaves
 * is the same one. With adaptive off the mark is drawn in a colour of the
 * card's own, and the only way to that colour was the form.
 */
const barPaint = (/** @type {string} */ key, /** @type {string} */ flag,
                  /** @type {string} */ what, /** @type {string} */ fallback) => ({
  icon: icon('paintbrush'), what: 'fixed ' + what + ' colour', paint: true,
  condition: (/** @type {any} */ cfg) => !cfg[flag],
  // Through the fallback rather than past it: what the swatch should show
  // when the card says nothing is what the renderer draws, which may be a
  // `var()` and is never a hex.
  read: (/** @type {any} */ cfg) => markHex(cfg[key] ?? fallback, '#ffffff'),
  patch: (/** @type {any} */ _cfg, /** @type {string} */ v) => ({ [key]: v }),
});

/**
 * A slider over one of the lengths a bar keeps as text.
 *
 * `slide` writes the number it shows, and for one of these that would drop
 * the `px` or the `%` that says what the number means. So the unit the card
 * already carries is put back on - or, where the card says nothing, the one
 * the renderer falls back to.
 */
const barSlide = (/** @type {string} */ key, /** @type {string} */ dflt,
                  /** @type {string} */ what, /** @type {any} */ opts) => ({
  key, what, dflt, slide: true, unit: true, ...opts,
  patch: (/** @type {any} */ cfg, /** @type {number} */ v) =>
    ({ [key]: v + splitUnit(cfg[key], dflt).unit }),
});

/**
 * Where a part stands and how big it is the first time it is switched on.
 *
 * A part used to arrive at whatever the renderer falls back to when a card
 * says nothing, and those numbers were never chosen as a starting point -
 * they are the oldest defaults in the file, and several of them put a text
 * outside the 50-unit box the gauge is clipped to. Switching a thing on and
 * seeing nothing is the worst first answer an editor can give.
 *
 * So each part carries the place and the size it should arrive at, read off
 * a dial that had been arranged by hand until it looked right (the demo's
 * CO₂ gauge). They are written only where the card says nothing, so a card
 * that has been arranged already keeps every number it has.
 */
const GAUGE_PARTS = Object.freeze({
  gauge_label: { label: 'Label', x: 'gauge_label_offset_x', y: 'gauge_label_offset_y',
                 size: 'gauge_label_font_size', dx: 0, dy: -8, dsize: 8,
                 section: '_section_gauge_label',
                 // The same key the switch in the form writes, and read the
                 // way the gauge reads it: absent means on.
                 active: 'gauge_label_active',
                 // A label with no text draws nothing however active it is, so
                 // switching it on here seeds the form's own placeholder -
                 // otherwise the button would look broken.
                 needs: 'gauge_label_text', seed: 'Gauge',
                 // What it says, typed in its own frame.
                 text: 'gauge_label_text',
                 place: { gauge_label_offset_x: 0, gauge_label_offset_y: 10.7,
                          gauge_label_font_size: 4.1 },
                 weight: textWeights('gauge_label_font_weight', '500'),
                 steps: colourRows('gauge_label_color_type', 'gauge_label_color',
                                   'label', '#ffffff', 'adaptive') },
  value: { label: 'Value', x: 'value_offset_x', y: 'value_offset_y',
           size: 'value_font_size', dx: 0, dy: 15, dsize: 12,
           section: '_section_labels',
           // The value's y is a baseline - the label's is the text's middle - so
           // its chip has to stand half a cap height above the number it offers.
           baseline: true, active: 'show_value',
           place: { value_offset_x: 0, value_offset_y: 20, value_font_size: 4.9 },
           weight: textWeights('value_font_weight', '700'),
           // Size, place and weight are the frame and the chip's own button.
           // What is left is what the number says and in what colour - a
           // custom unit is text, and text stays in the form.
           steps: [
             ...colourRows('value_color_type', 'value_color', 'value',
                           '#ffffff', 'adaptive'),
             { key: 'value_decimals', icon: icon('decimals-arrow-right'), by: 1, min: 0, max: 6, dflt: 0,
               what: 'decimals' },
             { key: 'value_show_raw_unit', icon: icon('link'), flag: true,
               what: 'show the unit' },
             { key: 'value_replace_unit', icon: icon('arrow-right-left'), flag: true,
               what: 'replace the unit',
               condition: (/** @type {any} */ cfg) => !!cfg.value_show_raw_unit },
           ] },
  // The two that say what scale the number is being read on: the k/M/G the
  // card has auto-scaled to, and how much of the range one tick interval is
  // worth. Both are baselined like the value, and neither has a weight of its
  // own - they are drawn at 500 and always have been.
  scale_label: { label: 'Scale', x: 'scale_label_offset_x', y: 'scale_label_offset_y',
                 size: 'scale_label_font_size', dx: 0, dy: -18, dsize: 10,
                 section: '_section_labels', baseline: true, active: 'show_scale_label',
                 // A line under the multiplier and in the same type: these two
                 // say the same kind of thing and are read together. The dial
                 // the other places come from has no scale label of its own,
                 // so this is the one that is placed by where its neighbour is
                 // rather than copied.
                 place: { scale_label_offset_x: 0, scale_label_offset_y: -4.4,
                          scale_label_font_size: 2.4 },
                 // The prefix is the card's own and is not text anybody types;
                 // whether the unit follows it is, and that switch had no
                 // control at all until it got a chip.
                 steps: [
                   ...colourRows('scale_label_color_type', 'scale_label_color', 'scale',
                                 '#ffffff', 'adaptive'),
                   { key: 'scale_label_show_raw_unit', icon: icon('link'), flag: true,
                     what: 'show the unit' },
                 ] },
  multiplier: { label: 'Multiplier', x: 'multiplier_offset_x', y: 'multiplier_offset_y',
                size: 'multiplier_font_size', dx: 0, dy: -30, dsize: 10,
                section: '_section_labels', baseline: true, active: 'show_multiplier_label',
                // A multiplier is the range shared between tick intervals, so
                // a gauge with fewer than two ticks has nothing to divide and
                // the renderer draws none. Switching it on brings ticks with
                // it, the way switching tick labels on does.
                //
                // And its own default offset is -30, which at any ordinary
                // scale is above the top of the 50-unit box - switched on and
                // left at it, it is a label nobody sees, and the form's
                // slider cannot even reach back to it. So a card that has
                // never said where it goes is given somewhere it can be seen:
                // midway between the centre the pointer turns about and the
                // gauge's own name, which is the gap the face leaves empty.
                // Taken from the name's own offset rather than written out,
                // so moving the name moves this with it instead of leaving a
                // second number behind to drift.
                needs: (/** @type {any} */ cfg) => SC.safeFloat(cfg.tick_count, 0) > 1,
                seed: { tick_count: 11 },
                place: { multiplier_offset_x: 0,
                         multiplier_offset_y: GAUGE_FACE.gauge_label_offset_y / 2,
                         multiplier_font_size: 2.4 },
                steps: [
                  ...colourRows('multiplier_color_type', 'multiplier_color', 'multiplier',
                                '#ffffff', 'adaptive'),
                  { key: 'multiplier_decimals', icon: icon('decimals-arrow-right'), by: 1, min: 0, max: 6, dflt: 0,
                    what: 'decimals' },
                  { key: 'multiplier_divide_ticks', icon: icon('divide'), flag: true,
                    what: 'divide the tick labels by it',
                    condition: (/** @type {any} */ cfg) => !!cfg.show_tick_labels },
                ] },
});

/**
 * The parts of a gauge that stand on a ring rather than at a point.
 *
 * Ticks, sub-ticks and tick labels are each a distance from the ring the gauge
 * is drawn on, which makes their frame a ring too: dragging it in or out is
 * the one gesture that says what that distance is, and it says it in the place
 * where the answer can be seen.
 *
 * `on` is a predicate rather than a key, because none of the three has a
 * switch of its own - a ring of ticks is on when there are ticks to draw, and
 * tick labels need ticks to sit on. `turnOn` is written whatever the card
 * says; `seed` only where the card says nothing, and it carries whatever else
 * has to be true for the ring to be seen at all.
 *
 * `steps` are the numbers offered under the chip while this ring is the one in
 * hand - the ones a person reaches for next once the distance is right. A ring
 * of marks is how many, how long and how thick; a ring of numbers is the type
 * size. Each carries the glyph that says which of them it is, because three
 * pairs of buttons in a row are otherwise three of the same thing.
 */
const GAUGE_RINGS = Object.freeze({
  // The gauge's own ring, framed by the edge of it that moves. First in the
  // list so every other band is drawn over it rather than under.
  gauge_ring: {
    label: 'Ring', section: '_section_color',
    on: () => true,
    radiusOf: (/** @type {any} */ cfg, /** @type {number} */ _ring, /** @type {number} */ scale) =>
      ringInnerEdge(SC.safeFloat(cfg.stroke_width, 3), scale, frameBand(cfg, scale)),
    fromRadius: (/** @type {number} */ r, /** @type {any} */ _cfg, /** @type {number} */ _ring, /** @type {number} */ scale) =>
      ({ stroke_width: strokeFromRadius(r, scale, frameBand(_cfg, scale)) }),
    steps: [
      ...SWEEP_STEPS,
      { key: 'gradient_preset', icon: icon('palette'), what: 'colour mode', picks: RING_COLOUR_MODE,
        read: (/** @type {any} */ cfg) => cfg.gradient_preset || 'manual' },
      // A ramp is not a mode and nothing remembers it was picked: it writes a
      // list of stops and steps back out of the way, which is why this row
      // reads its own name rather than a value.
      { icon: icon('rainbow'), what: 'ready-made ramp', picks: RAMP_PICKS,
        condition: isStopList, read: () => '',
        patch: (/** @type {any} */ _cfg, /** @type {string} */ v) => gradientPresetPatch(v) },
      { key: 'gradient_mode', icon: icon('blend'), what: 'gradient type', condition: isStopList,
        read: (/** @type {any} */ cfg) => cfg.gradient_mode || 'smooth',
        picks: [{ value: 'smooth', label: 'Smooth', short: 'Smooth' },
                { value: 'stepped', label: 'Stepped', short: 'Stepped' }] },
      ringColour('color1', 'outer colour', '#4caf50', isThreeColour),
      ringColour('color2', 'middle colour', '#ffeb3b', isThreeColour),
      ringColour('color3', 'centre colour', '#f44336', isThreeColour),
      { key: 'threshold1', icon: icon('signal-low'), slide: true, by: 1, min: 0, max: 98, dflt: 40,
        what: 'centre to middle (%)',
        condition: (/** @type {any} */ cfg) => cfg.gradient_preset === 'symmetriccustom' },
      { key: 'threshold2', icon: icon('signal-medium'), slide: true, by: 1, min: 0, max: 100, dflt: 75,
        what: 'middle to outer (%)',
        condition: (/** @type {any} */ cfg) => cfg.gradient_preset === 'symmetriccustom' },
      { key: 'threshold3', icon: icon('fold-horizontal'), slide: true, by: 0.5, min: 0.5, max: 30, dflt: 8,
        what: 'width of the first transition (%)',
        condition: (/** @type {any} */ cfg) => cfg.gradient_preset === 'symmetriccustom' },
      { key: 'threshold4', icon: icon('unfold-horizontal'), slide: true, by: 0.5, min: 0.5, max: 30, dflt: 8,
        what: 'width of the second transition (%)',
        condition: (/** @type {any} */ cfg) => cfg.gradient_preset === 'symmetriccustom' },
      ringColour('color1', 'start colour', '#4caf50',
                 (/** @type {any} */ cfg) => cfg.gradient_preset === 'linear'),
      ringColour('color2', 'middle colour', '#ffeb3b',
                 (/** @type {any} */ cfg) => cfg.gradient_preset === 'linear'),
      ringColour('color3', 'end colour', '#f44336',
                 (/** @type {any} */ cfg) => cfg.gradient_preset === 'linear'),
      { key: 'threshold1', icon: icon('signal-low'), slide: true, by: 1, min: 0, max: 100, dflt: 20,
        what: 'start spread (%)',
        condition: (/** @type {any} */ cfg) => cfg.gradient_preset === 'linear' },
      { key: 'threshold2', icon: icon('signal-medium'), slide: true, by: 1, min: 0, max: 100, dflt: 60,
        what: 'mid spread (%)',
        condition: (/** @type {any} */ cfg) => cfg.gradient_preset === 'linear' },
      // Last, because it is the one row here that is not about which colour
      // goes where but about how finely the ring is cut to draw it.
      { key: 'gradient_resolution', icon: icon('grid-3x3'), what: 'gradient resolution',
        read: (/** @type {any} */ cfg) => cfg.gradient_resolution || 'auto',
        picks: [{ value: 'auto', label: 'Automatic (size-dependent)', short: 'Auto' },
                { value: 'coarse', label: 'Coarse (1\u00D7 colour zones)', short: '1\u00D7' },
                { value: 'medium', label: 'Medium (12\u00D7)', short: '12\u00D7' },
                { value: 'fine', label: 'Fine (24\u00D7)', short: '24\u00D7' },
                { value: 'superfine', label: 'Superfine (48\u00D7)', short: '48\u00D7' },
                { value: 'ultrafine', label: 'Ultrafine (96\u00D7)', short: '96\u00D7' },
                { value: 'megafine', label: 'Megafine (192\u00D7)', short: '192\u00D7' }] },
    ],
  },
  // The one band on a gauge that has a thickness worth grabbing, and the only
  // one with two edges that mean different things. The outside is how far the
  // gauge reaches at all - `gauge_scale` - so dragging it in shrinks the whole
  // dial; the inside is how wide the frame is drawn, and pulling it inwards
  // makes the frame fat, which pushes everything else in with it.
  //
  // Always live, even with no frame drawn: the outer edge exists either way -
  // it is `scale * 25` whether anything is painted on it or not - so a gauge
  // with the frame switched off still offers it, as a virtual ring, and is
  // sized by the same handle. That is why this one has no `turnOff`: the
  // minus would take away the only way to set a gauge's size. The frame
  // itself is switched under the chip instead, where it reads as what it is.
  frame_ring: {
    label: 'Frame', section: '_section_frame',
    hint: 'drag the outside to size the gauge, the inside to widen the frame',
    on: () => true,
    ghost: (/** @type {any} */ cfg) => cfg.frame_ring_active !== true,
    radiusOf: (/** @type {any} */ _cfg, /** @type {number} */ _ring, /** @type {number} */ scale) =>
      gaugeOuter(scale),
    edges: {
      outer: { what: "the gauge's size",
        radiusOf: (/** @type {any} */ _cfg, /** @type {number} */ _ring, /** @type {number} */ scale) =>
          gaugeOuter(scale),
        fromRadius: (/** @type {number} */ r) => scaleFromRadius(r) },
      // Nothing to take hold of while no frame is drawn: the two edges are the
      // same circle then, and a second band on top of the first is a handle
      // nobody can tell from the one under it.
      inner: { what: "the frame's width",
        condition: (/** @type {any} */ cfg) => cfg.frame_ring_active === true,
        radiusOf: (/** @type {any} */ cfg, /** @type {number} */ _ring, /** @type {number} */ scale) =>
          frameInnerEdge(cfg, scale),
        fromRadius: (/** @type {number} */ r, /** @type {any} */ _cfg, /** @type {number} */ _ring,
                     /** @type {number} */ scale) => frameWidthFromRadius(r, scale) },
    },
    steps: [
      { key: 'frame_ring_active', icon: icon('circle'), what: 'frame drawn', flag: true },
      { key: 'frame_ring_closed', icon: icon('circle-dashed'), what: 'closed circle', flag: true,
        condition: (/** @type {any} */ cfg) => cfg.frame_ring_active === true },
      { key: 'frame_ring_gap', icon: icon('separator-horizontal'), by: 0.1, min: 0, max: 6, dflt: 1.5,
        what: 'gap to the ring inside it',
        condition: (/** @type {any} */ cfg) => cfg.frame_ring_active === true },
      { key: 'frame_ring_opacity', icon: icon('contrast'), by: 0.05, min: 0, max: 1, dflt: 1,
        what: 'opacity',
        condition: (/** @type {any} */ cfg) => cfg.frame_ring_active === true },
      ...colourRows('frame_ring_color_type', 'frame_ring_color', 'frame', '#505050', 'fixed',
                    (/** @type {any} */ cfg) => cfg.frame_ring_active === true),
    ],
  },
  ticks: {
    label: 'Ticks', offset: 'tick_offset', doffset: 0, limit: 10,
    section: '_section_ticks',
    on: (/** @type {any} */ cfg) => SC.safeFloat(cfg.tick_count, 0) > 0,
    turnOn: { tick_count: 11 }, turnOff: { tick_count: 0 },
    // The count is not copied from the dial these shapes come from: how many
    // ticks a scale wants is a fact about the scale, and 23 of them is the
    // answer for 300 to 2500 in hundreds and for nothing else.
    seed: { tick_length: 1.8, tick_width: 0.3, tick_offset: -0.9 },
    steps: [
      { key: 'tick_count', icon: icon('hash'), by: 1, min: 2, max: 50, dflt: 11, what: 'ticks' },
      { key: 'tick_length', icon: LONG, by: 0.1, min: 0, max: 6, dflt: 3, what: 'tick length' },
      { key: 'tick_width', icon: THICK, by: 0.1, min: 0, max: 5, dflt: 1, what: 'tick width' },
      ...colourRows('tick_color_type', 'tick_color', 'tick', '#808080', 'fixed'),
    ],
  },
  sub_ticks: {
    label: 'Subticks', offset: 'sub_tick_offset', doffset: 0, limit: 10,
    section: '_section_sub_ticks',
    on: (/** @type {any} */ cfg) => SC.safeFloat(cfg.sub_tick_count, 0) > 0
                                 && SC.safeFloat(cfg.tick_count, 0) > 1,
    turnOn: { sub_tick_count: 4 }, turnOff: { sub_tick_count: 0 },
    // Sub-ticks are drawn between ticks, so a gauge with none gets ticks too.
    seed: { tick_count: 11, sub_tick_length: 0.8, sub_tick_width: 0.1,
            sub_tick_offset: -1.2 },
    steps: [
      { key: 'sub_tick_count', icon: icon('hash'), by: 1, min: 1, max: 10, dflt: 4, what: 'sub-ticks' },
      { key: 'sub_tick_length', icon: LONG, by: 0.1, min: 0, max: 3, dflt: 1.5,
        what: 'sub-tick length' },
      { key: 'sub_tick_width', icon: THICK, by: 0.1, min: 0, max: 3, dflt: 0.5,
        what: 'sub-tick width' },
      ...colourRows('sub_tick_color_type', 'sub_tick_color', 'sub-tick', '#646464', 'fixed'),
    ],
  },
  tick_labels: {
    label: 'Tick labels', offset: 'tick_label_offset', doffset: -8, limit: 15,
    section: '_section_ticks_label',
    on: (/** @type {any} */ cfg) => !!cfg.show_tick_labels
                                 && SC.safeFloat(cfg.tick_count, 0) > 0,
    turnOn: { show_tick_labels: true }, turnOff: { show_tick_labels: false },
    // The renderer's own default distance is +10, which is outside the 50-unit
    // box the gauge is clipped to - labels switched on and left at it are
    // labels nobody sees.
    //
    // The interval is left at nothing on purpose, so the card works out for
    // itself how many of these will fit; the dial's own 2 is an answer to its
    // own 23 ticks.
    seed: { tick_count: 11, tick_label_offset: -4.5, tick_label_font_size: 2.5,
            tick_label_extra_length: 0.5 },
    // The whole of what a row of numbers is: how many of the ticks are
    // labelled, to how many places, how big, how far the tick they sit on is
    // drawn out, and in what colour. The distance from the ring is the frame's
    // own, so it is not repeated here.
    steps: [
      { key: 'tick_label_step', icon: icon('list'), by: 1, min: 0, max: 10, dflt: 0,
        what: 'label interval' },
      // Only while the interval is left to the card: sending crowded labels
      // out by a row is the other answer to the same crowding, and a number of
      // one's own has already answered it.
      { key: 'tick_label_stagger', icon: icon('corner-right-up'), what: 'two rows', flag: true,
        condition: (/** @type {any} */ cfg) => !SC.safeFloat(cfg.tick_label_step, 0) },
      // Only on a dial that comes full circle, where the two ends of the
      // scale land on one tick. Off, the label there is the one the dial
      // starts at; on, it reads both, ending lap first.
      { key: 'tick_label_join_ends', icon: icon('combine'), flag: true,
        what: 'both ends in one label',
        condition: (/** @type {any} */ cfg) => (cfg.gauge_type ?? 'full') === 'full' },
      { key: 'tick_label_decimals', icon: icon('decimals-arrow-right'), by: 1, min: 0, max: 6, dflt: 0,
        what: 'decimals' },
      { key: 'tick_label_font_size', icon: icon('a-large-small'), by: 0.5, min: 1, max: 20, dflt: 7,
        what: 'label type' },
      { key: 'tick_label_extra_length', icon: LONG, by: 0.1, min: 0, max: 4, dflt: 0,
        what: 'extra length on a labelled tick' },
      { key: 'tick_label_inherit_color', icon: icon('link'), flag: true,
        what: 'labelled tick takes the label colour' },
      ...colourRows('tick_label_color_type', 'tick_label_color', 'label',
                    '#ffffff', 'adaptive'),
    ],
  },
  // The needle is not a ring at all - it is a line, and it is grabbed by
  // either end. A circle the base rides on cannot be pulled through the pivot,
  // because a radius has no far side; two handles on a signed line can, which
  // is how a needle gets the tail out the other side that dials often have.
  // Always drawn: a gauge has no switch for its pointer, so there is nothing
  // to offer and nothing to take away.
  pointer: {
    label: 'Pointer', section: '_section_pointer', needle: true,
    on: () => true,
    radiusOf: (/** @type {any} */ cfg, /** @type {number} */ ring, /** @type {number} */ scale) =>
      needleEnds(SC.safeFloat(cfg.pointer_offset, 2), SC.safeFloat(cfg.pointer_length, 10),
                 ring, scale).tip,
    // Everything a needle is, apart from where it reaches to: length and
    // offset are the two ends being dragged, and a second control for either
    // would be a second answer to a question already asked.
    steps: [
      ...SWEEP_STEPS,
      { key: 'pointer_width', icon: THICK, slide: true, by: 0.1, min: 0.1, max: 10,
        dflt: 2, what: 'pointer width' },
      ...colourRows('pointer_color_type', 'pointer_color', 'pointer', '#ffffff', 'fixed'),
      { key: 'pointer_3d_effect', icon: icon('axis-3d'), flag: true, what: 'plastic 3D' },
      { key: 'pointer_shadow_type', icon: icon('moon'), what: 'shadow', picks: SHADOW_MODE,
        read: (/** @type {any} */ cfg) => cfg.pointer_shadow_type || 'none' },
      { icon: icon('paintbrush'), what: 'shadow colour', paint: true,
        condition: (/** @type {any} */ cfg) => cfg.pointer_shadow_type === 'fixed',
        read: (/** @type {any} */ cfg) => markHex(cfg.pointer_shadow_color, '#000000'),
        patch: (/** @type {any} */ _cfg, /** @type {string} */ v) =>
          ({ pointer_shadow_color: v }) },
      // The four that shape a shadow are not there to be read when there is no
      // shadow to shape - the panel is short enough without them.
      { key: 'pointer_shadow_blur', icon: icon('droplet'), slide: true, by: 0.01, min: 0, max: 1,
        dflt: 0.8, what: 'shadow blur', condition: hasShadow },
      { key: 'pointer_shadow_distance', icon: icon('move-diagonal'), slide: true, by: 0.1, min: -5,
        max: 5, dflt: 0.5, what: 'shadow distance', condition: hasShadow },
      { key: 'pointer_shadow_angle', icon: icon('rotate-cw'), slide: true, by: 5, min: 0, max: 360,
        dflt: 90, what: 'shadow angle', condition: hasShadow },
      { key: 'pointer_shadow_opacity', icon: icon('contrast'), slide: true, by: 0.05, min: 0,
        max: 1, dflt: 0.35, what: 'shadow opacity', condition: hasShadow },
    ],
    // Shape is the other thing a needle is, and with only two of them a button
    // on the chip says it better than a select eight folds down the dialog.
    shapes: { key: 'pointer_type', dflt: 'needle', order: ['needle', 'triangle'],
              of: { needle: { glyph: '\u25AC', label: 'a needle' },
                    triangle: { glyph: '\u25B2', label: 'a triangle' } } },
  },
  pointer_center: {
    label: 'Centre point', section: '_section_pointer',
    on: (/** @type {any} */ cfg) => SC.safeFloat(cfg.pointer_center_radius, 2) > 0,
    turnOn: { pointer_center_radius: 2.5 }, turnOff: { pointer_center_radius: 0 },
    radiusOf: (/** @type {any} */ cfg, /** @type {number} */ _ring, /** @type {number} */ scale) =>
      SC.safeFloat(cfg.pointer_center_radius, 2) * scale,
    fromRadius: (/** @type {number} */ r, /** @type {any} */ _cfg, /** @type {number} */ _ring, /** @type {number} */ scale) => ({
      pointer_center_radius: offsetFromRadius(0, r, scale, 25),
    }),
    // Size is the circle being dragged, so colour is all that is left to say.
    steps: colourRows('pointer_dot_color_type', 'pointer_dot_color', 'dot',
                      '#ffffff', 'fixed'),
  },
});

/**
 * The radius a ring part is drawn at, and the fields that would put it at a
 * radius - the two halves of what a ring frame does.
 *
 * Most rings are an offset from the gauge's own ring, which is the default
 * here; the pointer's base and the hub are measured differently, so those two
 * bring their own arithmetic.
 */
const ringPartAt = (/** @type {any} */ spec, /** @type {any} */ cfg,
                    /** @type {number} */ ring, /** @type {number} */ scale) =>
  spec.radiusOf ? spec.radiusOf(cfg, ring, scale)
                : ringPartRadius(ring, SC.safeFloat(cfg[spec.offset], spec.doffset), scale);

const ringPartPatch = (/** @type {any} */ spec, /** @type {number} */ r, /** @type {any} */ cfg,
                       /** @type {number} */ ring, /** @type {number} */ scale,
                       /** @type {string|null} */ edge = null) => {
  const e = edge && spec.edges?.[edge];
  if (e) return e.fromRadius(r, cfg, ring, scale);
  return spec.fromRadius ? spec.fromRadius(r, cfg, ring, scale)
                         : { [spec.offset]: offsetFromRadius(ring, r, scale, spec.limit) };
};

/**
 * The circles a ring puts on the drawing: one, or one per edge for a band
 * that has a thickness of its own.
 *
 * @param {any} spec @param {any} cfg @param {number} ring @param {number} scale
 */
const ringBands = (spec, cfg, ring, scale) => {
  if (!spec.edges) {
    return [{ edge: null, r: Math.abs(ringPartAt(spec, cfg, ring, scale)),
              what: spec.label.toLowerCase() }];
  }
  return Object.entries(spec.edges)
    .filter(([, e]) => !e.condition || e.condition(cfg))
    .map(([edge, e]) => ({ edge, r: Math.abs(e.radiusOf(cfg, ring, scale)), what: e.what }));
};

/**
 * Where each ring's offer stands on its ring, in degrees clockwise from three
 * o'clock. Across the top and down the right, far enough apart that three
 * offers on one gauge can all be read, and clear of the top-left corner where
 * the ring steppers sit.
 *
 * The gaps have to clear more than the chips themselves: the numbers of
 * whichever ring is in hand hang under its chip, three lines deep, and the
 * tick labels' chip used to stand where the sub-ticks' numbers land. Past
 * three o'clock it is below them with room to spare.
 */
/**
 * The parts whose frame the needle would otherwise run away from. Both are
 * measured along the needle's own line, so the gauge holds its angle while
 * either is being set - see `frozen` in the gauge renderer.
 */
const FROZEN_WHILE_HELD = new Set(['pointer', 'pointer_center']);

/**
 * The needle's two ends, and what each one is for.
 *
 * Each moves only itself: the tail is a length taken from a tip that stays
 * put, and the tip carries its offset while the tail stays put - so the two
 * together set a length from whichever end is nearer the hand.
 */
const NEEDLE_ENDS = Object.freeze({
  tip: { what: 'point' },
  tail: { what: 'tail' },
});

const RING_CHIP_ANGLE = Object.freeze({ frame_ring: 160, gauge_ring: 120, ticks: -90,
                                       sub_ticks: -50, tick_labels: 10, pointer_center: 200 });

/** How long Apply stays on "Saved" before it is a button again. */
const APPLY_SAVED_MS = 2000;

/** How far a press may wander and still be a press rather than a drag, in px. */
const CHIP_DRAG_SLOP = 3;

/** How near the pivot a chip may stand, in viewBox units. */
const RING_CHIP_MIN = 7;

/**
 * How far anything that floats over the canvas keeps off the edge of what
 * can be seen, in pixels.
 *
 * A panel pushed to within a hair of the edge is a panel that reads as
 * clipped even when it is not: the rounded corner and the focus ring of a
 * select inside it sit outside the box the browser measures, and the
 * scrollbar of the view crosses the last few pixels. Wide enough that the
 * gap is visible as a gap.
 */
const CANVAS_EDGE = 12;

/**
 * Which way the needle is pointing at this instant, in degrees clockwise from
 * three o'clock.
 *
 * The matrix rather than the inline `rotate()`: that one says where the needle
 * is going, and while the transition runs the two are different numbers.
 */
function needleAngle(el) {
  if (!el) return 0;
  try {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return Math.atan2(m.b, m.a) * 180 / Math.PI;
  } catch {
    return 0;
  }
}

/**
 * The one part a surface has: the paint on it.
 *
 * A surface draws nothing of its own, so there are no frames to put on
 * anything - the box *is* the part. Its chip stands near the top of the box
 * and carries what the drawing can answer for: the one colour, when the
 * pattern is a solid one; which effect it runs; and how strongly it is
 * painted. A gradient is a list of stops and a picture of its own, so it stays
 * in the menu, where there is room to see it.
 *
 * `spot` is what says this part is not on a ring: it stands where it is told
 * to, in per cent of the box, and pressing it is only ever taking it in hand.
 */
const SURFACE_PARTS = Object.freeze({
  paint: {
    label: 'Colour', spot: { l: 50, t: 14 },
    on: () => true,
    steps: [
      { icon: icon('paintbrush'), what: 'colour', paint: true,
        // Only a solid pattern has *a* colour. The others have a list of them.
        condition: (/** @type {any} */ cfg) => (cfg.bg_type || 'solid') === 'solid',
        read: solidColorOf,
        patch: (/** @type {any} */ cfg, /** @type {string} */ v) => solidColorPatch(cfg, v) },
      { key: 'animation', icon: icon('clapperboard'), what: 'effect', picks: PATTERN_ANIMATIONS,
        read: (/** @type {any} */ cfg) => cfg.animation || 'none' },
      { key: 'opacity', icon: icon('contrast'), by: 5, min: 0, max: 100, dflt: 100, what: 'opacity' },
    ],
  },
});

/**
 * What the card's own icon has: which icon it is.
 *
 * One part and one row, because there is only one thing about it the canvas
 * can answer for. The card draws the icon its entity carries, which is the
 * right icon almost always and the wrong one exactly when somebody has put
 * the entity on a card to mean something else - and until now there was
 * nowhere at all to say so. Left empty it goes back to the entity's own.
 */
const ICON_PARTS = Object.freeze({
  glyph: {
    label: 'Icon', spot: { l: 50, t: 50 },
    on: () => true,
    steps: [
      { key: 'icon_override', icon: icon('image'), what: 'icon', pickIcon: true },
    ],
  },
});

/**
 * What a bar has that can be worked on where it is drawn.
 *
 * None of them is a ring, so none has a radius and none is dragged in or out:
 * a bar's parts are along it, not around a centre, and what there is to set
 * about each is a count, a step or a shape rather than a distance. So they are
 * `spot` parts - a chip standing where it is told, with the numbers under it -
 * and the frames, the offers and the letting go are the same machinery the
 * gauge's rings already use.
 *
 * Where each stands is a starting place, not a decision: every chip can be
 * picked up and put down, and on a bar - which is usually far wider than it is
 * tall - that is what the person will want to do.
 *
 * Only a line has ticks and a pill. A bar drawn as a ring has neither, so
 * those parts simply are not on.
 */
const lineOnly = (/** @type {any} */ cfg) => !barIsCircular(cfg);

/**
 * The one piece of a bar that stands where it is put.
 *
 * A bar's own parts are all fixed to it - the fill is the bar, a tick stands
 * on the scale - except the label, which is a text at an offset from
 * whichever of the nine sectors it is anchored to. That is the same thing a
 * gauge's label is, so it is framed the same way: dragged where it goes,
 * sized by the corner, and the numbers it was set by are gone from the form
 * while the frame is up.
 *
 * Only on a straight bar. A ring's label has a `circular_label_offset_y` and
 * no x at all - there is nowhere to drag it sideways to - so there it stays
 * the chip it was, and `can` on both sides keeps exactly one of the two in
 * the editor at a time.
 *
 * `limit` because the gauge's 25 is 25 viewBox units, and a bar's offsets are
 * in pixels or in hundredths of its track: the bound that means the same
 * thing here is the bar's own box.
 */
const BAR_LABEL_PARTS = Object.freeze({
  label: {
    label: 'Label', section: '_section_label', can: lineOnly,
    x: 'label_offset_x', y: 'label_offset_y', size: 'label_font_size',
    dx: 0, dy: 0, dsize: 12, sizeMin: 4, sizeMax: 60,
    // Empty is not nothing here: a bar with no label text of its own draws
    // the entity's name, so the field offers that as its placeholder and
    // clearing it goes back to it.
    text: 'label_text',
    limit: (/** @type {any} */ px, /** @type {number} */ per) =>
      ({ x: px.width / per, y: px.height / per }),
    active: 'show_label',
    // Nothing to place: an offset the card has not set is zero, and zero is
    // the sector the label is anchored to - which is somewhere it can be seen.
    weight: textWeights('label_font_weight',
                        (/** @type {any} */ cfg) => cfg.label_bold ? '700' : '400'),
    steps: [
      { key: 'label_rotation', icon: icon('rotate-cw'), what: 'label rotation',
        read: (/** @type {any} */ cfg) => String(cfg.label_rotation ?? '0'),
        picks: [{ value: '0', label: 'Horizontal', short: '0\u00B0' },
                { value: '90', label: 'Quarter turn', short: '90\u00B0' },
                { value: '-90', label: 'Quarter turn back', short: '-90\u00B0' }] },
    ],
  },
});

const BAR_PARTS = Object.freeze({
  // The one part of a bar that cannot be switched off: a bar without a fill
  // is not a bar. So no `turnOff` and no `on` that ever says no - the chip is
  // there to hold what the fill is *coloured* with, which is the one question
  // a bar is read by and the one that sat six folds down the dialog.
  fill: {
    label: 'Fill', section: '_section_colors', spot: { l: 50, t: 50 },
    on: () => true,
    steps: [
      { key: 'use_gradient', icon: icon('blend'), flag: true, what: 'gradient fill' },
      // The same catalogue the gauge's ring offers. Under a chip it is the
      // list of names rather than the grid of swatches the form draws: a
      // panel of numbers is one row high per setting, and nine pictures in it
      // would be the panel.
      { icon: icon('rainbow'), what: 'ready-made ramp', picks: RAMP_PICKS,
        condition: (/** @type {any} */ cfg) => !!cfg.use_gradient,
        read: () => '',
        patch: (/** @type {any} */ _cfg, /** @type {string} */ v) =>
          gradientPresetPatch(v, 'bar') },
      { key: 'gradient_as_solid', icon: icon('droplet'), flag: true,
        what: 'one colour, read off the ramp',
        condition: (/** @type {any} */ cfg) => !!cfg.use_gradient },
      { icon: icon('paintbrush'), what: 'fill colour', paint: true,
        condition: (/** @type {any} */ cfg) => !cfg.use_gradient,
        read: (/** @type {any} */ cfg) => markHex(cfg.fill_color ?? 'var(--primary-color)', '#03a9f4'),
        patch: (/** @type {any} */ _cfg, /** @type {string} */ v) => ({ fill_color: v }) },
      { icon: icon('layers'), what: 'track colour', paint: true,
        read: (/** @type {any} */ cfg) => markHex(cfg.bg_color, '#ffffff'),
        patch: (/** @type {any} */ _cfg, /** @type {string} */ v) => ({ bg_color: v }) },
      { key: 'bg_opacity', icon: icon('contrast'), slide: true, by: 5, min: 0, max: 100,
        dflt: 10, what: 'track opacity' },
    ],
  },
  label: {
    label: 'Label', section: '_section_label', spot: { l: 25, t: 28 },
    // The straight bar's label is framed instead - see BAR_LABEL_PARTS.
    can: barIsCircular,
    on: (/** @type {any} */ cfg) => !!cfg.show_label,
    turnOn: { show_label: true }, turnOff: { show_label: false },
    // `label_bold` is the weight this label had before it had three of them.
    // A card that still carries it has never been edited since, so it decides
    // what the button starts on - otherwise a bold label would show under a
    // button reading normal, and the first press would make it lighter.
    weight: textWeights('label_font_weight',
                        (/** @type {any} */ cfg) => cfg.label_bold ? '700' : '400'),
    steps: [
      { key: 'label_font_size', icon: icon('a-large-small'), by: 1, min: 4, max: 60, dflt: 12,
        what: 'label type' },
      { key: 'label_rotation', icon: icon('rotate-cw'), what: 'label rotation',
        read: (/** @type {any} */ cfg) => String(cfg.label_rotation ?? '0'),
        picks: [{ value: '0', label: 'Horizontal', short: '0\u00B0' },
                { value: '90', label: 'Quarter turn', short: '90\u00B0' },
                { value: '-90', label: 'Quarter turn back', short: '-90\u00B0' }] },
    ],
  },
  pill: {
    label: 'Pill', section: '_section_indicator', spot: { l: 62, t: 28 },
    can: lineOnly,
    on: (/** @type {any} */ cfg) => !!cfg.show_indicator && !!cfg.indicator_value,
    // The pill rides the indicator line, so switching it on brings the line
    // with it; switching it off leaves the line, which is a mark of its own.
    turnOn: { show_indicator: true, indicator_value: true },
    turnOff: { indicator_value: false },
    steps: [
      // `hl`: the pill's chip holds the line's settings as well as the
      // pill's own, and a pulse over both while the line's thickness is being
      // set is a pulse over the wrong thing. A row that names a part narrows
      // the highlight to it for as long as it is held.
      // No `hl` here: only a slider narrows the highlight while it is held,
      // and a checkbox is a press rather than a hold - there would be nothing
      // to see.
      { key: 'indicator_color_adaptive', icon: icon('palette'), flag: true,
        what: 'adaptive line colour' },
      { icon: icon('paintbrush'), what: 'line colour', paint: true, hl: 'indicator_line',
        condition: (/** @type {any} */ cfg) => !cfg.indicator_color_adaptive,
        read: (/** @type {any} */ cfg) => markHex(cfg.indicator_color, '#ffffff'),
        patch: (/** @type {any} */ _cfg, /** @type {string} */ v) => ({ indicator_color: v }) },
      barSlide('indicator_thickness', '2px', 'line thickness',
               { icon: THICK, by: 0.5, min: 0, max: 10, hl: 'indicator_line' }),
      { key: 'indicator_value_rotation', icon: icon('rotate-cw'), what: 'rotation',
        read: (/** @type {any} */ cfg) => String(cfg.indicator_value_rotation ?? 'auto'),
        picks: [{ value: 'auto', label: 'Upright, as it reads', short: 'Auto' },
                { value: '0', label: 'Horizontal', short: '0\u00B0' },
                // The two that can be asked for and not fit: the card stands
                // such a pill upright on a bar too flat to hold it, so the
                // row says as much rather than the drawing surprising anyone.
                { value: '90', label: 'Quarter turn - upright where the bar is flat', short: '90\u00B0' },
                { value: '-90', label: 'Quarter turn back - upright where the bar is flat', short: '-90\u00B0' },
                { value: '180', label: 'Upside down', short: '180\u00B0' }] },
      { note: 'On its end the reading has to fit across the bar. Where the bar is too flat it stands upright by itself, and lies down again when there is room.',
        condition: (/** @type {any} */ cfg) =>
          Math.abs(parseInt(cfg.indicator_value_rotation)) === 90 },
      { key: 'indicator_value_decimals', icon: icon('decimals-arrow-right'), by: 1, min: 0, max: 3, dflt: 0,
        what: 'decimal places' },
      barSlide('indicator_value_font_size', '10', 'type size',
               { icon: icon('a-large-small'), by: 1, min: 4, max: 20 }),
      { key: 'indicator_value_adaptive_mode', icon: icon('palette'),
        what: 'colour mode',
        read: (/** @type {any} */ cfg) => cfg.indicator_value_adaptive_mode || 'none',
        picks: [{ value: 'none', label: 'Nothing - both colours are set here', short: 'Manual' },
                { value: 'pill', label: 'The pill, with the text for contrast', short: 'Pill' },
                { value: 'text', label: 'The text alone', short: 'Text' }] },
      { icon: icon('droplet'), what: 'background colour', paint: true,
        condition: (/** @type {any} */ cfg) =>
          (cfg.indicator_value_adaptive_mode || 'none') !== 'pill',
        read: (/** @type {any} */ cfg) => markHex(cfg.indicator_value_bg, '#000000'),
        patch: (/** @type {any} */ _cfg, /** @type {string} */ v) =>
          ({ indicator_value_bg: v }) },
      { icon: icon('type'), what: 'text colour', paint: true,
        condition: (/** @type {any} */ cfg) =>
          (cfg.indicator_value_adaptive_mode || 'none') === 'none',
        read: (/** @type {any} */ cfg) => markHex(cfg.indicator_value_color, '#ffffff'),
        patch: (/** @type {any} */ _cfg, /** @type {string} */ v) =>
          ({ indicator_value_color: v }) },
      { key: 'indicator_value_opacity', icon: icon('contrast'), by: 5, min: 0, max: 100, dflt: 100,
        what: 'opacity' },
      { key: 'value_animated', icon: icon('waves'), flag: true,
        what: 'animated value' },
      { key: 'indicator_glass_effect', icon: icon('pill'), what: 'glass effect',
        read: (/** @type {any} */ cfg) => cfg.indicator_glass_effect || 'none',
        picks: [{ value: 'none', label: 'No effect', short: 'Flat' },
                { value: 'glass_gooey', label: 'Liquid and gooey', short: 'Gooey' },
                { value: 'glass_clean', label: 'Clean frost', short: 'Frost' },
                { value: 'glass_clear', label: 'Clear 3D glass', short: 'Clear' },
                { value: 'glass_lens', label: 'Convex lens', short: 'Lens' },
                { value: 'glass_dark', label: 'Dark tinted glass', short: 'Dark' },
                { value: 'glass_liquid', label: 'Liquid glass', short: 'Liquid' },
                { value: 'glass_liquid_heavy', label: 'Liquid glass, thick',
                  short: 'Liquid+' }] },
    ],
  },
  ticks: {
    label: 'Ticks', section: '_section_scale', spot: { l: 25, t: 72 },
    can: lineOnly,
    on: (/** @type {any} */ cfg) => !!cfg.show_ticks,
    turnOn: { show_ticks: true }, turnOff: { show_ticks: false },
    // Only where the card says nothing: the numbers under the chip step what
    // is there, and what is there was the renderer's fallback rather than
    // anyone's answer. Writing one down the first time a part is switched on
    // is not overwriting a design - there was none.
    seed: { tick_count: 11, tick_length: '100%', tick_width: '1' },
    steps: [
      { key: 'tick_count', icon: icon('hash'), by: 1, min: 0, max: 51, dflt: 10, what: 'ticks' },
      { key: 'tick_interval', icon: icon('list'), by: 1, min: 0, max: 1000, dflt: 0,
        what: 'tick interval, in the value\u2019s own units - 0 leaves it to the count' },
      { key: 'tick_length', icon: LONG, by: 5, min: 0, max: 400, dflt: '100%', unit: true,
        what: 'tick length',
        // A tick that is pinned to both edges has no length to set.
        condition: (/** @type {any} */ cfg) => cfg.tick_align !== 'full' },
      { key: 'tick_width', icon: THICK, by: 0.5, min: 0, max: 50, dflt: '1', unit: true,
        what: 'tick width' },
      { key: 'tick_align', icon: icon('align-center-vertical'), what: 'tick alignment',
        read: (/** @type {any} */ cfg) => cfg.tick_align || 'center',
        picks: [{ value: 'center', label: 'Centred', short: 'Centre' },
                { value: 'start', label: 'At the top or left edge', short: 'Edge' },
                { value: 'end', label: 'At the opposite edge', short: 'Far' },
                { value: 'full', label: 'Right across the bar', short: 'Across' }] },
      { key: 'tick_mirror_side', icon: icon('flip-vertical'), flag: true, what: 'mirrored',
        condition: (/** @type {any} */ cfg) =>
          cfg.tick_align === 'start' || cfg.tick_align === 'end' },
      { key: 'tick_hide_last', icon: icon('scissors'), flag: true, what: 'no last tick' },
      { key: 'tick_color_adaptive', icon: icon('palette'), flag: true, what: 'adaptive colour' },
      barPaint('tick_color', 'tick_color_adaptive', 'tick', 'rgba(255,255,255,0.3)'),
    ],
  },
  sub_ticks: {
    label: 'Subticks', section: '_section_subticks', spot: { l: 50, t: 88 },
    can: lineOnly,
    on: (/** @type {any} */ cfg) => !!cfg.show_ticks && !!cfg.show_subticks,
    // Subticks are drawn between ticks, and the renderer gates them on the
    // ticks being shown - so switching them on brings the ticks with them
    // rather than switching on something nobody can see.
    turnOn: { show_subticks: true, show_ticks: true },
    turnOff: { show_subticks: false },
    seed: { tick_count: 11, subtick_length: '50%', subtick_width: '1' },
    steps: [
      { key: 'subtick_count', icon: icon('hash'), by: 1, min: 1, max: 20, dflt: 4,
        what: 'sub-ticks per interval' },
      { key: 'subtick_length', icon: LONG, by: 5, min: 0, max: 400, dflt: '50%', unit: true,
        what: 'sub-tick length',
        condition: (/** @type {any} */ cfg) => cfg.subtick_pos !== 'full' },
      { key: 'subtick_width', icon: THICK, by: 0.5, min: 0, max: 50, dflt: '1', unit: true,
        what: 'sub-tick width' },
      { key: 'subtick_pos', icon: icon('align-center-vertical'), what: 'sub-tick alignment',
        read: (/** @type {any} */ cfg) => cfg.subtick_pos || 'main',
        picks: [{ value: 'main', label: 'As the main ticks', short: 'As ticks' },
                { value: 'center', label: 'Centred', short: 'Centre' },
                { value: 'start', label: 'At the top or left edge', short: 'Edge' },
                { value: 'end', label: 'At the opposite edge', short: 'Far' },
                { value: 'full', label: 'Right across the bar', short: 'Across' }] },
      { key: 'subtick_mirror_side', icon: icon('flip-vertical'), flag: true, what: 'mirrored',
        condition: (/** @type {any} */ cfg) =>
          cfg.subtick_pos === 'start' || cfg.subtick_pos === 'end' },
      { key: 'subtick_color_adaptive', icon: icon('palette'), flag: true,
        what: 'adaptive colour' },
      barPaint('subtick_color', 'subtick_color_adaptive', 'sub-tick',
               'rgba(255,255,255,0.2)'),
    ],
  },
  tick_labels: {
    label: 'Tick labels', section: '_section_tick_labels', spot: { l: 75, t: 72 },
    can: lineOnly,
    on: (/** @type {any} */ cfg) => !!cfg.show_ticks && !!cfg.show_tick_labels,
    turnOn: { show_tick_labels: true, show_ticks: true },
    turnOff: { show_tick_labels: false },
    seed: { tick_count: 11, tick_labels_size: '10' },
    weight: textWeights('tick_labels_weight', '400'),
    steps: [
      { key: 'tick_label_step', icon: icon('hash'), by: 1, min: 1, max: 20, dflt: 1,
        what: 'every Xth tick numbered' },
      { key: 'tick_labels_decimals', icon: icon('decimals-arrow-right'), by: 1, min: 0, max: 3, dflt: 0,
        what: 'decimal places' },
      { key: 'tick_labels_size', icon: icon('a-large-small'), by: 1, min: 1, max: 80, dflt: '10', unit: true,
        what: 'label size' },
      { key: 'tick_labeled_extralength', icon: LONG, by: 1, min: 0, max: 200, dflt: '0',
        unit: true, what: 'extra length on a numbered tick',
        // The extra length is added to the tick, and a tick pinned to both
        // edges has nothing to add it to.
        condition: (/** @type {any} */ cfg) => cfg.tick_align !== 'full' },
      { key: 'tick_labels_hide_unit', icon: icon('link'), flag: true, what: 'no unit' },
      { key: 'tick_labels_hide_first', icon: icon('arrow-left-to-line'), flag: true, what: 'no first' },
      { key: 'tick_labels_hide_last', icon: icon('arrow-right-to-line'), flag: true, what: 'no last' },
      { key: 'tick_labels_color_adaptive', icon: icon('palette'), flag: true,
        what: 'adaptive colour' },
      barPaint('tick_labels_color', 'tick_labels_color_adaptive', 'tick label',
               'var(--secondary-text-color)'),
    ],
  },
});

/**
 * Whether an element can have this part at all, as opposed to whether it has
 * it now.
 *
 * Two different questions, and running them together is how a circular bar
 * came to be offered a pill it can never draw. `on` says the part is switched
 * on; `can` says the element is the sort of thing that has one. A part with no
 * `can` is one every element of its kind can have, which is most of them.
 */
const partCan = (spec, cfg) => !spec.can || spec.can(cfg);

/**
 * What has to be written alongside the switch for a part to actually appear.
 *
 * A switch is not always enough. A label with no text draws nothing however
 * active it is; a multiplier is a range divided between ticks, so a gauge
 * with no ticks draws none however loudly it is asked to - and a part
 * switched on from the canvas that then fails to appear reads as a broken
 * button rather than as a setting that is missing something.
 *
 * Two rules, because they answer two questions.
 *
 * `needs` is what the part stands on, and `seed` what to write when it is not
 * standing on it: a key and a value where one field is missing, a predicate
 * and a patch where what is missing is a condition rather than a field. Where
 * the predicate already holds nothing is written at all, so a gauge that has
 * 21 ticks keeps them - and where it does not hold, the patch goes in whole,
 * because a card that says `tick_count: 0` has said something that does not
 * work rather than nothing.
 *
 * `place` is where the part goes, and that one is written only where the card
 * says nothing: a part somebody has already put somewhere stays there.
 */
const partSeed = (spec, cfg) => {
  const patch = {};
  for (const [k, v] of Object.entries(spec.place || {})) {
    if (cfg[k] === undefined) patch[k] = v;
  }
  if (typeof spec.needs === 'function') {
    if (!spec.needs(cfg)) Object.assign(patch, spec.seed);
  } else if (spec.needs && !cfg[spec.needs]) {
    patch[spec.needs] = spec.seed;
  }
  return patch;
};

/** Whether the part is actually being drawn right now. */
const partOn = (spec, cfg) => partCan(spec, cfg) && spec.on(cfg);

/**
 * What the drawing multiplies a part's own numbers by, on top of the
 * measurement.
 *
 * A gauge's texts are placed in viewBox units and then the whole face is
 * drawn at a scale of its own, so the two have to be multiplied together. A
 * bar has no such second factor - its label is placed in a CSS length, and
 * `measureBar` already says what one of those is worth on the screen. Asking
 * the gauge's question of a bar's config is how a 40-pixel drag came out as
 * 46: `gaugeScaleOf` answers for any config handed to it, and a bar's answer
 * means nothing.
 */
const partScaleOf = (target) => target?.k?.partScale?.(target.cfg) || 1;

/**
 * A length a bar writes as text - `100%`, `1`, `4px`, `12cqw`.
 *
 * The bar's lengths are text fields because the unit is part of the answer: a
 * tick length in per cent is of the bar's thickness and follows it, where one
 * in pixels does not. A stepper that wrote a bare number would silently change
 * which of those was meant, so it steps the number and hands the unit back
 * untouched.
 */
function splitUnit(value, dflt) {
  const raw = value === undefined || value === null || value === '' ? dflt : String(value);
  const m = /^\s*(-?\d*\.?\d+)\s*([a-z%]*)\s*$/i.exec(raw);
  return m ? { n: parseFloat(m[1]), unit: m[2] || '' }
           : { n: parseFloat(String(dflt)) || 0, unit: '' };
}

/** One shared empty map, for a kind that has no parts of that sort. */
const NO_PARTS = Object.freeze({});

/**
 * Measure a gauge's own parts, in per cent of the element's box.
 *
 * Measured rather than worked out: a gauge is letterboxed inside its element,
 * drawn at a scale of its own and at whatever the canvas is zoomed to, and the
 * text's own rect already knows all three. Per cent of the box, so the frames
 * are right at any zoom without measuring again.
 *
 * `pxPerUnit` comes from the SVG's screen matrix, which is the only thing that
 * knows where the letterboxed viewBox actually landed.
 *
 * @param {any} box the element's box on the canvas
 */
function measureGauge(box) {
  const gauge = box.querySelector('sc-gauge');
  // The gauge's own square, not the element's box: the viewBox letterboxes
  // inside it, so this is what an offset in viewBox units is a fraction of.
  const svg = gauge?.shadowRoot?.querySelector('svg');
  const texts = gauge?.shadowRoot?.querySelectorAll('[data-sc-part]') || [];
  const needle = gauge?.shadowRoot?.querySelector('[data-sc-needle]');
  if (!svg) return null;
  const elRect = box.getBoundingClientRect();
  if (!elRect.width || !elRect.height) return null;
  const svgRect = svg.getBoundingClientRect();
  /** @type {any} */
  const next = {
    parts: {},
    // Off the computed transform rather than off the config: mid-animation
    // the needle is wherever the transition has got to, and that is where
    // its handles have to be. Zero when there is no needle to read.
    angle: needleAngle(needle),
    // The element's own box in screen pixels, which is what a length set in
    // pixels is read against.
    px: { width: elRect.width, height: elRect.height },
    svg: {
      l: (svgRect.left - elRect.left) / elRect.width * 100,
      t: (svgRect.top - elRect.top) / elRect.height * 100,
      w: svgRect.width / elRect.width * 100,
      h: svgRect.height / elRect.height * 100,
    },
  };
  texts.forEach((/** @type {any} */ t) => {
    const part = t.dataset.scPart;
    if (!GAUGE_PARTS[part]) return;
    const r = t.getBoundingClientRect();
    if (!r.width && !r.height) return;
    // Per part, not once: the value is drawn in a layer of its own, and a
    // layer is free to be scaled differently from the one beside it.
    const ctm = t.ownerSVGElement?.getScreenCTM?.();
    next.parts[part] = {
      // What the card actually drew, which is not always what it was told to
      // draw: a bar falls back to the entity's own name, and that is what the
      // field in the frame has to offer as its placeholder.
      text: (t.textContent || '').trim(),
      l: (r.left - elRect.left) / elRect.width * 100,
      t: (r.top - elRect.top) / elRect.height * 100,
      w: r.width / elRect.width * 100,
      h: r.height / elRect.height * 100,
      pxPerUnit: ctm?.a || (elRect.width / GAUGE_VIEW),
    };
  });
  return next;
}

/**
 * The frame a box-shaped kind is measured in: the element's own box, whole.
 *
 * Nothing letterboxes inside it, so a per cent of the box already is a per
 * cent of the drawing - there is no scale to read, no text rect to follow and
 * no needle to be turning. A constant, which also means the sameness check
 * settles on the first measurement and the follow loop stops straight away.
 */
function boxFrame(box) {
  const r = box.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { parts: NO_PARTS, angle: 0, svg: { l: 0, t: 0, w: 100, h: 100 },
           px: { width: r.width, height: r.height } };
}

/**
 * The same for a bar, plus the one part of it that is placed by hand.
 *
 * Nothing letterboxes here either, so the box is still the frame - but the
 * label travels in whatever unit the bar measures in, and what that unit is
 * worth on the screen is a length only the drawing knows. `cqmin` and its
 * two siblings are a hundredth of the track, which is the element that
 * carries `container-type`; a plain `px` is a CSS pixel, which the canvas'
 * own zoom then magnifies. The zoom is read off the box - its rect against
 * its own layout width - rather than off `this._zoom`, because the editor is
 * not the only transform between a bar and the screen.
 *
 * @param {any} box the element's box on the canvas
 * @param {any} [cfg] the bar's config, which names the unit
 */
function measureBar(box, cfg) {
  const base = boxFrame(box);
  if (!base || barIsCircular(cfg || {})) return base;
  const bar = box.querySelector('sc-progressbar');
  const label = bar?.shadowRoot?.querySelector('[data-sc-part="label"]');
  const wrap = bar?.shadowRoot?.querySelector('.sc-pb-wrap');
  if (!label || !wrap) return base;
  const elRect = box.getBoundingClientRect();
  const r = label.getBoundingClientRect();
  if (!r.width && !r.height) return base;
  const track = wrap.getBoundingClientRect();
  const zoom = box.offsetWidth ? elRect.width / box.offsetWidth : 1;
  const unit = cfg?.base_unit && cfg.base_unit !== 'auto' ? cfg.base_unit : 'px';
  const per = unit === 'cqw' ? track.width / 100
    : unit === 'cqh' ? track.height / 100
    : unit === 'cqmin' ? Math.min(track.width, track.height) / 100
    : zoom;
  return { ...base, parts: { label: {
    text: (label.textContent || '').trim(),
    l: (r.left - elRect.left) / elRect.width * 100,
    t: (r.top - elRect.top) / elRect.height * 100,
    w: r.width / elRect.width * 100,
    h: r.height / elRect.height * 100,
    pxPerUnit: per || 1,
  } } };
}

/**
 * How far a press may miss what it was aimed at and still land on it.
 *
 * A tick is a pixel wide. It is also a thing a finger is aimed at, so a press
 * is allowed to be a little off - but only a little: a bar's marks stand a
 * few pixels apart, and a reach wide enough to feel generous is wide enough
 * to answer with the neighbour.
 */
const PART_HIT_SLOP = 5;

/** The press itself, and eight points a slop out from it. */
const HIT_RING = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
                  [0.7, 0.7], [0.7, -0.7], [-0.7, 0.7], [-0.7, -0.7]]
  .map(([x, y]) => [x * PART_HIT_SLOP, y * PART_HIT_SLOP]);

/**
 * Whether a press is on this shape, and how big a thing it would be landing
 * on - 0 for a miss.
 *
 * Its rectangle is the wrong question for anything drawn round: the box of a
 * gauge's ring is the whole gauge, and a press in the middle of one is a
 * press on nothing. So a shape is asked - `isPointInStroke`, and `isPointInFill`
 * only where there is a fill to be inside, because the fill *geometry* of a
 * ring drawn with `fill="none"` is still the disc it encloses. Everything
 * else is a box and is taken as one.
 *
 * The slop is sampled around the press rather than added to the shape,
 * because a stroke cannot be widened without redrawing it.
 */
function paints(/** @type {any} */ node) {
  if (node.textContent?.trim()) return true;
  const cs = getComputedStyle(node);
  if (cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return true;
  if (parseFloat(cs.borderTopWidth) || parseFloat(cs.borderLeftWidth)) return true;
  const bg = cs.backgroundColor;
  return !(bg === 'transparent' || /,\s*0\)$/.test(bg) || /\/\s*0\s*\)$/.test(bg));
}

/**
 * Whether the press is on this shape: 2 on it, 1 within a slop of it, 0 not.
 *
 * Its rectangle is the wrong question for anything drawn round: the box of a
 * gauge's ring is the whole gauge, and a press in the middle of one is a
 * press on nothing. So a shape is asked - `isPointInStroke`, and
 * `isPointInFill` only where there is a fill to be inside, because the fill
 * *geometry* of a ring drawn with `fill="none"` is still the disc it
 * encloses. Everything else is a box and is taken as one.
 *
 * The slop is sampled around the press rather than added to the shape,
 * because a stroke cannot be widened without redrawing it.
 */
function hitNode(/** @type {any} */ node, /** @type {number} */ x, /** @type {number} */ y) {
  const r = node.getBoundingClientRect();
  if (!r.width && !r.height) return 0;
  // A row of ticks whose ticks are switched off is still a box the width of
  // the bar, and it would swallow every press meant for the bare drawing -
  // including the one that is how a part is let go of. A leaf that paints
  // nothing is not a part; it is where a part would have been.
  const svg = typeof node.isPointInStroke === 'function';
  if (!svg && !node.children.length && !paints(node)) return 0;
  if (x < r.left - PART_HIT_SLOP || x > r.right + PART_HIT_SLOP
      || y < r.top - PART_HIT_SLOP || y > r.bottom + PART_HIT_SLOP) return 0;
  const inBox = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  const ctm = svg && node.getScreenCTM?.();
  if (!ctm) return inBox ? 2 : 1;
  const inv = ctm.inverse();
  const filled = getComputedStyle(node).fill !== 'none';
  const on = (/** @type {DOMPoint} */ p) =>
    node.isPointInStroke(p) || (filled && node.isPointInFill(p));
  if (on(new DOMPoint(x, y).matrixTransform(inv))) return 2;
  for (const [dx, dy] of HIT_RING) {
    if (on(new DOMPoint(x + dx, y + dy).matrixTransform(inv))) return 1;
  }
  return 0;
}

/**
 * Which part of what an element draws a press landed on, or null.
 *
 * The renderers mark what they draw with `data-sc-part` - the same attribute
 * a gauge's texts are already measured by - so what can be taken hold of is
 * what is actually on the screen, wherever the renderer decided to put it,
 * and the editor needs to know no geometry of its own. A mark that stands for
 * a row of things is marked once and its children are what is tested, because
 * the row is the part and a tick is where the press is.
 *
 * What is on wins over what is merely near, and after that the last one drawn
 * wins - not the smallest. A tick is smaller than the pill lying over it and
 * would otherwise be answered with through the pill; document order is the
 * order the renderer painted in, so the thing on top is the thing named.
 *
 * All of them, in that order, rather than only the first: the one on top is
 * the answer to a press, and the rest are the stack a second press at the
 * same spot walks down - the same gesture the canvas has for the elements
 * one level up.
 *
 * @param {any} box the element's box on the canvas
 * @param {number} x
 * @param {number} y
 * @param {any} parts the parts this kind will answer with
 * @returns {string[]} topmost first, empty when the press landed on none
 */
function drawnPartsAt(box, x, y, parts) {
  const root = box?.querySelector('sc-gauge, sc-progressbar')?.shadowRoot;
  if (!root) return [];
  const scan = (/** @type {any} */ node) => {
    if (!node.children.length) return hitNode(node, x, y);
    let best = 0;
    for (const kid of node.children) best = Math.max(best, scan(kid));
    return best;
  };
  const hits = [];
  for (const node of root.querySelectorAll('[data-sc-part]')) {
    const part = /** @type {any} */ (node).dataset.scPart;
    if (!parts[part]) continue;
    const h = scan(node);
    if (h) hits.push({ part, h });
  }
  // Read backwards, then sorted by certainty - `sort` is stable, so the two
  // rules stay in that order. A part marked on more than one node is named
  // once, by the topmost of them.
  hits.reverse();
  hits.sort((a, b) => b.h - a.h);
  return [...new Set(hits.map(h => h.part))];
}

/**
 * The kinds of element whose own parts the canvas can take in hand, and what
 * each one is made of.
 *
 * The frames, the chips, the steppers and the zoom do the same thing whatever
 * is being edited. What differs is three things: where the config lives, which
 * parts there are, and which editor holds their settings. That difference is
 * here and nowhere else, so a new kind is an entry rather than a second copy
 * of the machinery.
 *
 * `config` answers the entry being edited, or null when this element is not
 * one that can be; `drawn` names the parts it is actually drawing right now,
 * because only those have something on the canvas to take hold of; `write`
 * answers the one `_send` that puts a patch where that kind keeps it.
 */
const INNER_KINDS = Object.freeze({
  gauge: {
    match: /^gauge_(\d+)$/,
    noun: 'gauge',
    holds: 'its label, its value, its scale, its needle',
    editor: 'sc-gauge-editor',
    parts: GAUGE_PARTS,
    rings: GAUGE_RINGS,
    measure: measureGauge,
    partScale: gaugeScaleOf,
    config: (/** @type {any} */ slot, /** @type {string} */ _id, /** @type {number} */ idx) => {
      if (!slot.gauge_active) return null;
      const gauges = Array.isArray(slot.gauges) && slot.gauges.length ? slot.gauges : [slot];
      return gauges[idx] || null;
    },
    // Only what the gauge actually draws can be taken hold of, and the same
    // two conditions the renderer itself goes by decide that.
    drawn: (/** @type {any} */ cfg) => {
      const on = [];
      if (cfg.gauge_label_text && cfg.gauge_label_active !== false) on.push('gauge_label');
      if (cfg.show_value) on.push('value');
      if (cfg.show_scale_label) on.push('scale_label');
      if (cfg.show_multiplier_label && SC.safeFloat(cfg.tick_count, 0) > 1) on.push('multiplier');
      return on;
    },
    write: (/** @type {any} */ slot, /** @type {any} */ t, /** @type {any} */ patch) => {
      // A card written before the list existed keeps its one gauge on the slot
      // itself; cloning that into a `gauges` array would copy the whole card
      // into it, so those fields are merged where they already live.
      if (!Array.isArray(slot.gauges) || !slot.gauges.length) {
        return t.idx === 0 ? { key: '__merge__', value: { ...patch } } : null;
      }
      const next = structuredClone(slot.gauges);
      if (!next[t.idx]) return null;
      Object.assign(next[t.idx], patch);
      return { key: 'gauges', value: next };
    },
  },
  bar: {
    match: /^progressbar_(\d+)$/,
    noun: 'bar',
    holds: 'its ticks, its pill, its label',
    editor: 'sc-progressbar-editor',
    parts: BAR_LABEL_PARTS,
    rings: BAR_PARTS,
    measure: measureBar,
    // Two keys for one idea, because a line and a ring round their corners on
    // different boxes: `border_radius` is the straight bar's own, and
    // `circular_border_radius` the plate a ring floats on. The renderer reads
    // whichever the orientation calls for, so the grips write the same one.
    //
    // Either may be a length or a share of the box, and which it is rides in
    // the value the way every length a bar owns does - so the grip is told
    // the unit by the value it is about to change, and writes it back. A card
    // that says nothing gets the unit the renderer falls back to.
    corners: (/** @type {any} */ cfg) => {
      const circular = barIsCircular(cfg);
      const key = circular ? 'circular_border_radius' : 'border_radius';
      const { n, unit } = SC.splitLength(cfg[key], circular ? '50%' : '4px');
      return { key, unit, now: SC.safeFloat(n, 0),
               patch: (/** @type {number} */ v) => ({ [key]: v + unit }) };
    },
    config: (/** @type {any} */ slot, /** @type {string} */ _id, /** @type {number} */ idx) => {
      if (!slot.progressbar_active || !Array.isArray(slot.progressbars)) return null;
      return slot.progressbars[idx] || null;
    },
    drawn: (/** @type {any} */ cfg) =>
      cfg.show_label && !barIsCircular(cfg) ? ['label'] : [],
    write: (/** @type {any} */ slot, /** @type {any} */ t, /** @type {any} */ patch) => {
      if (!Array.isArray(slot.progressbars) || !slot.progressbars[t.idx]) return null;
      const next = structuredClone(slot.progressbars);
      Object.assign(next[t.idx], patch);
      return { key: 'progressbars', value: next };
    },
  },
  icon: {
    // No index to take: there is one card icon, and the id is the whole name.
    match: /^icon$/,
    noun: 'icon',
    holds: 'which icon it draws',
    // Nothing in the form to bring to the top - the icon had no setting at
    // all before this one, which is half of why it is worth having here.
    editor: '',
    parts: NO_PARTS,
    rings: ICON_PARTS,
    measure: boxFrame,
    // The card's own config: the icon belongs to the card, not to an entry in
    // a list, so the slot is the entry being edited.
    config: (/** @type {any} */ slot) => slot,
    drawn: () => [],
    write: (/** @type {any} */ _slot, /** @type {any} */ _t, /** @type {any} */ patch) =>
      ({ key: '__merge__', value: { ...patch } }),
  },
  surface: {
    match: /^surface_(\d+)$/,
    noun: 'surface',
    holds: 'its corners, its colour, the way it moves',
    // A surface has no editor of its own: what it is painted with is the
    // colour panel folded into its element settings, and that has no named
    // sections to bring to the top.
    editor: '',
    measure: boxFrame,
    rings: SURFACE_PARTS,
    // The corners are the pattern's, because a surface has no box of its own
    // to round - the paint is what has a shape. Taking a grip in hand is also
    // what says the radius is set by hand, which is the switch the menu offers
    // above the same number.
    // Every side of a box can be bowed, and the keys are always the same, so
    // the kind has nothing to say here beyond that it can be.
    sides: true,
    corners: (/** @type {any} */ cfg) => {
      const unit = cfg.border_radius_unit === '%' ? '%' : 'px';
      return { key: 'border_radius', unit, now: SC.safeFloat(cfg.border_radius, 0),
               // Taking a grip in hand is also what says the radius is set by
               // hand, which is the switch the menu offers above the number.
               patch: (/** @type {number} */ v) => ({ border_radius: v,
                                                      border_radius_auto: false,
                                                      border_radius_unit: unit }) };
    },
    // A surface nothing paints yet is opened on the pattern it would have, the
    // way its panel is: the first thing written is what brings it into being.
    config: (/** @type {any} */ slot, /** @type {string} */ id) =>
      patternFor(patternList(slot), 'elm_' + id) || defaultColorPattern('elm_' + id),
    drawn: () => [],
    write: (/** @type {any} */ slot, /** @type {any} */ t, /** @type {any} */ patch) =>
      ({ key: 'color_patterns', value: patchPattern(patternList(slot), 'elm_' + t.id, patch) }),
  },
});

/**
 * The two align buttons that keep a meaning for a gauge's own label and value.
 * A text has no left edge to line up against here - it has a middle, and the
 * gauge has one too.
 */
const MIDDLE_AXIS = Object.freeze({
  hcenter: { axis: 'x', what: 'vertical' },
  vcenter: { axis: 'y', what: 'horizontal' },
});

/** Frames of no movement that end the follow loop behind the part frames. */
const INNER_STILL_FRAMES = 4;

const EDGE_STRIP_PX = 32;
const EDGE_SPEED_MAX = 9;

/**
 * Whether a key event came out of something somebody is typing into.
 *
 * The press is read from its path rather than from `document.activeElement`,
 * because the editor lives in a shadow root inside a dialog: the active
 * element seen from the document is the dialog, whatever is focused inside.
 */
function isTyping(e) {
  return e.composedPath().some(n => {
    const tag = n?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || n?.isContentEditable;
  });
}
const ZOOM_MIN = ZOOM_STEPS[0];
const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

class ScCanvasEditor extends LitElement {
  static get properties() {
    return {
      slot: { type: Object },
      hass: { type: Object },
      // The Lovelace card config, for `grid_options` - the card's height is
      // Home Assistant's field, not one of ours.
      cardConfig: { type: Object },
      commitFn: { type: Function },
      _sel: { type: String, state: true },
      _extra: { type: Array, state: true },
      _band: { type: Object, state: true },
      _drag: { type: Object, state: true },
      _dragCanvas: { type: Object, state: true },
      _configOpen: { type: Boolean, state: true },
      _menu: { type: Boolean, state: true },
      _applyState: { type: String, state: true },
      _applyError: { type: String, state: true },
      _canApply: { type: Boolean, state: true },
      _menuKind: { type: String, state: true },
      // Which template's colour page the menu is showing, null for the page
      // of shapes. A bar is picked in two answers - what shape it is, and
      // what its fill means - so the menu has a page for each.
      _menuTemplate: { type: Object, state: true },
      _placing: { type: String, state: true },
      _ghost: { type: Object, state: true },
      _zoom: { type: Number, state: true },
      _zoomBack: { type: Boolean, state: true },
      _space: { type: Boolean, state: true },
      _finger: { type: Boolean, state: true },
      _inner: { type: String, state: true },
      _innerRects: { type: Object, state: true },
      _innerSel: { type: String, state: true },
      // Whether the part in hand is shown on the drawing itself, and until
      // when that is held off. Both are state and neither is config: the
      // highlight is a way of looking at the canvas, not a property of the
      // card being drawn.
      _hl: { type: Boolean, state: true },
      _hlHold: { type: Number, state: true },
      // Which of the needle's two handles is being held, and so which one is
      // drawing a crosshair. One at a time: the pair of lines is there to say
      // where *this* end is going.
      _crossEnd: { type: String, state: true },
      // The one part the highlight is narrowed to while a row that names it
      // is being held - a chip can set more than one mark.
      _hlNarrow: { type: String, state: true },
      // The part whose text is being typed into, in its own frame. One at a
      // time, and it is never the same question as which part is in hand: a
      // part is held to be moved and edited to be read.
      _innerEdit: { type: String, state: true },
      // The parts held *besides* the one in hand. A plain array rather than a
      // Set, because lit's change detection is identity on both and an array
      // is what the render walks.
      _innerAlso: { type: Array, state: true },
      _names: { type: Boolean, state: true },
      _layerDrag: { type: Object, state: true },
      _undoStack: { type: Array, state: true },
      _redoStack: { type: Array, state: true },
    };
  }

  constructor() {
    super();
    this._sel = null;
    this._extra = [];
    this._band = null;
    this._drag = null;
    // Where a drag in progress has put the canvas, before it is committed.
    this._dragCanvas = null;
    // Set while an undo or redo is putting a column span back, so `updated`
    // knows the change it is about to see is not a user's edit.
    this._restoredGrid = false;
    this._configOpen = true;
    // Live until the first render has asked the dialog. A button that starts
    // grey and comes on a frame later reads as broken; one that starts live
    // and goes grey reads as the answer arriving.
    this._canApply = true;
    this._menu = false;
    // Which kind's template page the menu is showing, null for its front
    // page. State, because the menu is drawn from it.
    this._menuKind = null;
    this._menuTemplate = null;
    this._placing = null;
    // The template the next placement lays down and the config it copied out
    // of it, or null for whatever the module makes. Not reactive - the hint
    // reads the label, and the hint re-renders with `_placing` anyway.
    this._placingTemplate = null;
    this._placingEntry = null;
    this._ghost = null;
    this._zoom = 1;
    this._zoomBack = zoomBack;
    this._finger = fingerDraws;
    // The zoom the canvas was being arranged at before a gauge was opened,
    // and null whenever none is being held for it.
    this._zoomBefore = null;
    // A pan in progress: where the pointer went down and where the view stood
    // then. Not reactive - scrolling the view is what draws it.
    this._pan = null;
    // The touches on the canvas, by pointer id, and the pinch two of them
    // make. A trackpad pinch arrives as a wheel and is handled there; this is
    // for a real touchscreen, where nothing else reports one.
    this._touches = new Map();
    // Which element's own parts are being edited on the canvas, the frames
    // measured for them, and the gesture moving one. The rects are state
    // because they are measured from what was drawn and then drawn from.
    this._inner = null;
    /** @type {string|null} The part whose settings to show once the press is over. */
    this._revealOnUp = null;
    this._innerSel = null;
    this._innerAlso = [];
    this._innerEdit = null;
    /**
     * The last frame the part being typed into was measured at, and the text
     * it held when the typing started.
     *
     * A text that is emptied is a text the card draws nothing for, and a part
     * that draws nothing has no rect - so the frame, and the field inside it,
     * would vanish under the caret at exactly the moment somebody is clearing
     * it to type something else. The last measurement stands in until there
     * is something to measure again.
     * @type {any}
     */
    this._editRect = null;
    /** @type {string|null} */
    this._editFrom = null;
    /** Whether anything has been typed yet in the edit now open. */
    this._typed = false;
    /** @type {{x: number, y: number, same: boolean, stack: string[]}|null} */
    this._innerLastDown = null;
    this._hl = true;
    this._hlHold = 0;
    this._hlTimer = 0;
    this._hlNarrow = null;
    this._hlNarrowOff = null;
    this._innerFrame = 0;
    this._innerRects = null;
    this._innerDrag = null;
    this._crossEnd = null;
    this._pinch = null;
    // The last pointer position, in client pixels. The edge scroll works from
    // it: the pointer can stand still while the view keeps moving under it.
    this._ptr = null;
    this._edgeFrame = 0;
    // Space held, which turns the canvas into a hand. Reactive, because the
    // cursor says so before anything is dragged.
    this._space = false;
    // Where the pointer last was, in client pixels, whether or not anything
    // is being dragged. Space arms the hand only over the canvas - everywhere
    // else it is a page scroll, and taking it globally would be taking it
    // from the rest of the dialog - and a key event cannot say where the
    // pointer is, so the position is remembered as it moves.
    this._lastClient = null;
    // On: a name under a box is what somebody recognises their element by.
    // The box itself still says the id, which is what the rest of the editor
    // calls it - the list, the glass targets, the colour rules - so the two
    // languages are both on screen rather than one replacing the other. Like
    // the zoom, it belongs to the open editor and is never committed.
    this._names = true;
    // A layer being carried through the list: where it was picked up and
    // which row it is over now, both indices into the element array. Null
    // whenever nothing is in hand.
    this._layerDrag = null;
    // The way back, and the way forward again. They live as long as the open
    // editor does: what came before it is Home Assistant's own undo.
    this._undoStack = [];
    this._redoStack = [];
    // Set while a snapshot is being put back, so restoring is not itself
    // remembered as a change to undo.
    this._travelling = false;
    // The last press: where it was, whether it moved, and what lay under it.
    // Not reactive - nothing renders from it.
    this._lastDown = null;
    // A menu that outlives a click elsewhere, or a placement no key can get
    // out of, is a trap - and the click that closes the menu is not one this
    // element ever sees, so both listeners are the document's.
    this._onKey = e => {
      if (e.key === 'Escape' && (this._menu || this._placing)) this._closeMenu();
      // Space is the hand, the way it is in every canvas editor - but only
      // over the canvas, and never while something is being typed into.
      if (e.key === ' ' && this._pointerOverCanvas() && !this._space && !isTyping(e)) {
        this._space = true;
        e.preventDefault();
      }
      // The usual three, but only over the canvas: everywhere else they are
      // the browser's own page zoom, and taking those globally would take
      // them from the rest of Home Assistant.
      if ((e.ctrlKey || e.metaKey) && this._pointerOverCanvas() && !isTyping(e)) {
        if (e.key === '+' || e.key === '=') { e.preventDefault(); this._stepZoom(1); }
        else if (e.key === '-' || e.key === '_') { e.preventDefault(); this._stepZoom(-1); }
        else if (e.key === '0') { e.preventDefault(); this._applyZoom(1); }
      }
    };
    this._onKeyUp = e => { if (e.key === ' ') this._space = false; };
    // Tracked on the document rather than on the canvas: `pointerenter` is
    // not fired for a pointer that was already standing where the editor
    // opened, and the editor is opened by a click that ends over it often
    // enough for that to be the normal case.
    this._onDocMove = e => { this._lastClient = { x: e.clientX, y: e.clientY }; };
    // A window that loses focus mid-gesture never sees the key come up, and
    // the canvas would stay a hand until the next press of space.
    this._onBlur = () => { this._space = false; };
    this._onDocDown = e => {
      if (this._menu && !e.composedPath().includes(this.shadowRoot?.querySelector('.menu-wrap'))) {
        this._menu = false;
        this._menuKind = null;
        this._menuTemplate = null;
      }
    };
  }

  /**
   * Whether the canvas draws the real gauges or plain boxes. Kept in the card
   * rather than in this element, because the switch now sits in another menu -
   * two elements cannot share a field, and they do share the card.
   *
   * On regardless while an element's own parts are in hand. Those frames sit
   * on the drawing - a pointer's frame is where the pointer is drawn - so
   * with plain boxes there is nothing for them to sit on, and the button
   * that opens them used to be greyed out with a note asking for the switch
   * to be thrown first. A button that explains what to do instead of doing
   * it is a button doing half its job: opening an element now brings the
   * drawing with it, and closing it takes it away again. Nothing is
   * committed - the switch keeps saying what the card was set to.
   */
  get _live() { return this._innerOn || this.slot?.live_preview !== false; }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('pointermove', this._onDocMove, true);
    document.addEventListener('pointerdown', this._onDocDown, true);
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('pointermove', this._onDocMove, true);
    document.removeEventListener('pointerdown', this._onDocDown, true);
    this._stopEdgeScroll();
    if (this._innerFrame) cancelAnimationFrame(this._innerFrame);
    this._innerFrame = 0;
    clearTimeout(this._appliedTimer);
    clearTimeout(this._hlTimer);
    this._hlNarrowOff?.();
    super.disconnectedCallback();
  }

  /**
   * Follow the card's size when it is changed in Home Assistant's Layout tab.
   *
   * Changing it here reshapes the canvas - see `_setGrid` - and the Layout tab
   * writes the same `grid_options` the same controls do, so it is the same
   * person asking for the same thing. It used to leave the canvas behind: the
   * numbers in this tab updated, the shape did not, until something was typed
   * here again.
   *
   * Only on a change, and never on the first `cardConfig` to arrive. A canvas
   * that has always been a different shape from its card is somebody's
   * decision, and reshaping it for merely opening the editor is the rewrite
   * while nobody is watching that `_matchGrid` exists to avoid - the Match
   * button still offers that one.
   *
   * Both directions: a row count reshapes to it, and clearing one goes back to
   * the shape the canvas had before any row count was set. `_reshapedFor` is
   * null when there is nothing to do, which is what stops the commit this
   * causes from causing another.
   */
  updated(changed) {
    super.updated(changed);
    // Reading the section while this editor is in the document is what fills
    // the memory the detached case lives on - see `_maxColumns`. It cannot
    // wait for something to ask: the controls that read them sit in a fold,
    // and the Layout tab is often the first thing opened.
    if (this.isConnected) { void this._maxColumns; void this._sectionPx; }
    this._refreshApply();
    // However a gauge's parts were left - the button, or a different element
    // selected - the canvas goes back to the zoom it was being arranged at,
    // and the gauge is properly let go of. Letting go matters: `_inner` holds
    // an id rather than a flag, so a gauge left by selecting something else
    // used to come back into edit mode the moment it was selected again -
    // without the zoom that opening it deliberately brings.
    if (this._inner && !this._innerOn) {
      this._inner = null;
      this._innerRects = null;
      this._innerSel = null;
      this._innerEdit = null;
      this._innerLastDown = null;
    }
    // An element left any other way - a click beside the canvas, a different
    // element taken up - keeps the zoom where it is and only forgets where it
    // came from. Being thrown back out to the whole canvas because you
    // clicked next to it is the opposite of what a click next to something
    // means, and the way back is one press on the reset button.
    if (!this._innerOn && this._zoomBefore != null) this._zoomBefore = null;
    // On the host, because the cursor has to go from everything the hand
    // can be over while a handle is held, and a shadow root's rules cannot
    // reach the host from inside a child.
    this.toggleAttribute('cross', !!this._crossEnd);
    this._measureInner();
    this._placeNeedle();
    this._followInner();
    this._settleFloating();
    // A canvas nobody sees is the one broken state this editor can be opened
    // in: `layout_active` gates the renderer, so a card carrying a canvas with
    // the switch off draws its plain content row while this editor happily
    // arranges elements onto a picture the card never shows. Nothing here can
    // tell the person that by drawing it, so the switch goes on instead - and
    // only ever from off to on, for a card that already has a canvas.
    if (this.slot?.canvas && !this.slot.layout_active && !this._activated) {
      this._activated = true;
      // Unasked-for, like the adoption's own commit, and it must not count as
      // unsaved work either - see `markDialogClean`.
      const dialog = editingDialog(this);
      this.commitFn?.('__merge__', { layout_active: true });
      setTimeout(() => markDialogClean(dialog));
    }
    if (!changed.has('cardConfig')) return;
    const was = changed.get('cardConfig');
    if (!was) return;
    const grid = this.cardConfig?.grid_options || {};
    const before = was.grid_options || {};
    if (grid.columns === before.columns && grid.rows === before.rows) return;
    // A column span put back by the arrows arrives here looking like an edit,
    // and reshaping for it would both undo the canvas the same snapshot just
    // restored and put a step on the stack the user never took - so the press
    // after it would walk back through a change of ours instead of theirs.
    if (this._restoredGrid) { this._restoredGrid = false; return; }
    // Home Assistant's Layout tab has no way of asking a card what it is
    // worth, so switching auto height off pins `min_rows ?? 1` - one row,
    // a 56 pixel strip, which is never what anyone switching a canvas card
    // to a fixed height means. This card's own switch pins the height the
    // card has at that moment (see `_setAutoHeight`), and that is what the
    // tab's switch gets to mean as well. Only the fallback itself is caught:
    // a row count that was already a number is somebody's choice, and one
    // set deliberately to a single row survives the next edit.
    if (grid.rows === 1 && typeof before.rows !== 'number') {
      const worth = rowsForShape(this._canvas, this._columns, this._maxColumns, this._sectionPx);
      if (worth > 1) { this._setShapeRows(worth); return; }
    }
    // `was` is the config before Home Assistant's own tab changed it, so this
    // is the row count the canvas was worth under the old column span.
    const shaped = this._reshapedFor();
    if (shaped) this._commit(shaped);
  }

  static get styles() {
    return [SC.editorStyles, css`
      .row { gap: 8px; }
      /* The one line over the canvas: the grid on the left, the preview switch
         on the right, and each label carrying its explanation in a balloon. */
      .canvas-settings { display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
                         margin: 0 0 8px 0; font-size: 13px; }
      .canvas-settings > .gap { flex: 1; min-width: 6px; }
      /* Narrower than the controls in Card & Dimensions on purpose: this row
         has to hold two settings and a switch in the width of the canvas. */
      .canvas-settings select { width: 104px; }
      .canvas-settings .num { width: 58px; box-sizing: border-box; }
      .canvas-settings ha-switch { margin-left: -4px; }
      .canvas-settings .settings-label { display: inline-flex; align-items: center; gap: 4px;
                                         color: var(--primary-text-color); }
      .canvas-wrap { position: relative;
        background: color-mix(in srgb, var(--primary-text-color, #fff) 6%, transparent);
        border: 1px dashed var(--divider-color,#444); border-radius: 4px; padding: 0; display: flex; justify-content: center; }
      /* The canvas' own breathing room, moved onto a strip that takes pointer
         events. A selection frame has to be able to start and end *outside*
         the canvas, or an element lying flush against an edge can never be
         wholly inside a frame - the press that draws it would already have to
         be past the edge. The strip is also where a drag that overshoots the
         canvas keeps being tracked. */
      /* A finger here is the page's until it is on something draggable.
         With touch-action none - which this was, over the full width of the
         editor - a touchscreen could not scroll past the canvas at all: the
         only way down the dialog was the sliver outside the strip, and even
         that was a guess. The pan is handed back instead, and everything that
         is actually dragged - an element, a part's frame, a grip, a chip -
         says none for itself, so taking hold of one of those still works. It
         costs the two gestures that are a bare finger on the canvas: a
         selection frame, and the pinch, whose second finger the browser may
         take for a two-finger scroll. Neither is gone - the switch above
         the canvas and below it hands the finger back to the canvas, above it and below
         it, for as long as one is being drawn on. */
      .canvas-pad { flex: 1; min-width: 0; padding: 24px 16px;
                    touch-action: pan-x pan-y;
                    display: flex; justify-content: center; }
      /* Space held, the whole canvas is a hand and the hand moves the window,
         so nothing here is the page's to scroll. */
      .canvas-pad.hand { touch-action: none; }
      /* The switch the other way round: the finger is the canvas' again, so
         the selection frame and the pinch are back and the page is scrolled
         beside the canvas instead of across it. */
      .canvas-pad.finger, .canvas-pad.finger .canvas { touch-action: none; }
      /* Space held: the whole canvas is a hand, and every cursor inside it -
         an element's grab, a handle's resize - has to give way to that, or
         the canvas would say one thing and its contents another. */
      .canvas-pad.hand, .canvas-pad.hand * { cursor: grab !important; }
      .canvas-pad.hand:active, .canvas-pad.hand:active * { cursor: grabbing !important; }
      /* The window the canvas is zoomed inside. It keeps the footprint the
         canvas has at 100% - width of the strip, shape of the canvas, save
         for the stretch a gauge's own editing borrows in height - so
         zooming in makes the drawing bigger and the editor no taller: the
         part that no longer fits is reached by scrolling, not by pushing
         everything below the canvas down the page.
         The canvas centres itself with an auto margin rather than with
         justify-content or place-content, because content centred by those
         is clipped on the side it overflows, where there is no scroll to
         reach it - an auto margin collapses to 0 instead. Both axes need it,
         which is why the window is a flex container: an auto margin only
         centres vertically inside one. */
      /* The gutter is held open whether a scrollbar is in it or not, and
         that is not tidiness - without it the window has a zoom at which it
         cannot make up its mind. The canvas is a per cent of this box, so a
         scrollbar appearing narrows it and shortens it with it; the window's
         own height does not follow, because it is worked out from a width
         the scrollbar has not been taken off yet. So just under the zoom
         that fills the window in height, the canvas overflows while there is
         no scrollbar and fits once there is one - neither answer stands, and
         Chromium flips between them for as long as you look at it. Measured
         on an 858px window: every zoom from 2.582 to 2.614 flutters, and
         2.614 is exactly the zoom that going into a gauge aims for. Holding
         the gutter open costs the width of one scrollbar and makes the
         canvas' height the same number in both states, so there is nothing
         left to flip. */
      .canvas-view { position: relative; width: 100%; overflow: auto;
                     scrollbar-gutter: stable;
                     scrollbar-width: thin; display: flex; }
      /* flex: none, or a canvas drawn wider than the window would be shrunk
         back to fit by flex-shrink and there would be nothing to scroll. */
      .canvas-view > .canvas { margin: auto; flex: none; }
      .names { display: flex; align-items: center; gap: 2px; }
      .names.history button { font-size: 18px; line-height: 1; padding: 3px 8px; }
      .names button { background: var(--card-background-color, #1c1c1c); border: 1px solid var(--divider-color,#444); color: var(--primary-text-color); border-radius: 4px; padding: 4px 7px; font-size: 13px; line-height: 1.1; cursor: pointer; }
      .names button[disabled] { opacity: 0.4; cursor: default; }
      /* A press on a zoom button is over the moment it happens, so those may
         light up under the pointer in the accent colour. Names stays pressed,
         and a hover that borrowed the same colour would hide which way it
         stands - exactly while the pointer is still on the button that was
         just clicked. So the accent means on here, and hovering only lifts. */
      .names button:hover:not([disabled]) { background: var(--divider-color, #444); }
      .names button.on, .names button.on:hover { background: var(--primary-color); border-color: var(--primary-color); color: #fff; }
      /* The tools under the canvas: what is done to a selection on the left,
         what is done to the view on the right. They are always here and grey
         out instead of appearing, so the row does not change height and the
         buttons stay where the hand left them. */
      .tools { display: flex; align-items: center; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
      /* Centred rather than stretched: the zoom level is a line of text among
         buttons, and in a stretched box it sits at the top of its own height
         while the buttons beside it are tall. */
      .tools .group { display: flex; align-items: center; gap: 4px; }
      /* A rule before every group but the first, so the row reads as what it
         is - gaps, edges, middles, the pencil, then what happens to whole
         elements - instead of one long undifferentiated run of squares. */
      .tools .group:not(:first-of-type) {
        border-left: 1px solid var(--divider-color,#444); padding-left: 10px; }
      /* One square for every tool, whether it holds a glyph or a drawing:
         a row of buttons that are each as wide as their symbol reads as a row
         of different things. Centred by the button itself, so nothing depends
         on how much side bearing a particular character happens to carry. */
      .tools button { width: 30px; height: 30px; min-width: 30px; box-sizing: border-box;
                      display: flex; align-items: center; justify-content: center;
                      background: var(--card-background-color, #1c1c1c); border: 1px solid var(--divider-color,#444); color: var(--primary-text-color); border-radius: 4px; padding: 0; font-size: 17px; line-height: 1; cursor: pointer; }
      .tools button:hover:not([disabled]) { background: var(--primary-color); color: #fff; }
      .tools button[disabled] { opacity: 0.4; cursor: default; }
      .tools .level { min-width: 46px; display: flex; align-items: center; justify-content: center; align-self: stretch; font-variant-numeric: tabular-nums; }
      .tools button.on { background: var(--primary-color); color: #fff; }
      /* A button that stays pressed cannot borrow the hover's fill, or it
         reads as on while the pointer is over it and as off the moment the
         pointer leaves - which is the opposite of what it is saying. */
      .tools button.toggle:hover:not([disabled]) { background: rgba(3,169,244,0.28); color: inherit; }
      .tools button.toggle.on:hover:not([disabled]) { background: var(--primary-color); color: #fff; }
      .tools button.danger { color: var(--error-color, #f44336); }
      .tools button.danger:hover:not([disabled]) { background: var(--error-color, #f44336); color: #fff; }
      .tools .spacer { flex: 1; }

      /* The stack, front at the top - the way a layer list reads everywhere
         else, and the other way round from the elements array, where the last
         one is the one drawn last. Not a fold: it is the editor's only list
         of what is on the canvas, and a list you have to open first is a list
         half the people never see. */
      .objects { border: 1px solid var(--divider-color,#444); border-radius: 6px; margin-top: 6px; background: rgba(255,255,255,0.02); }
      .objects-head { padding: 6px 10px; font-size: 12px; font-weight: 600; color: var(--primary-color,#03a9f4); user-select: none; display: flex; align-items: center; gap: 6px; }
      .layer-list { display: flex; flex-direction: column; gap: 2px; padding: 0 6px 6px; }
      /* Only the selected row wraps, and it has to: its number inputs and the
         four order buttons need more than 500px, and Home Assistant's card
         editor is nowhere near that wide. There the name takes a line of its
         own so the numbers below it line up. Every other row is a name and
         four buttons and fits on one line, which is what makes a long list
         readable. */
      .layer { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; padding: 3px 6px; border-radius: 4px; background: rgba(255,255,255,0.03); }
      .layer.sel { background: rgba(3,169,244,0.18); box-shadow: inset 0 0 0 1px var(--primary-color,#03a9f4); }
      .layer.co { background: rgba(3,169,244,0.09); }
      .layer .nums { flex: 1 0 100%; display: flex; gap: 6px; padding-left: 20px; }
      .layer .nums .num { width: 68px; box-sizing: border-box; }
      .layer .lock { font-size: 11px; opacity: 0.8; }
      /* touch-action, or a finger on the grip scrolls the dialog instead of
         carrying the layer - the pointer events never arrive. */
      .layer .grip { color: var(--secondary-text-color); cursor: grab; font-size: 14px;
                     display: inline-flex; align-items: center; touch-action: none; }
      .layer .grip:active { cursor: grabbing; }
      .layer.dragging { opacity: 0.4; }
      .layer.dragging .grip { cursor: grabbing; }
      .layer.drop { outline: 2px dashed var(--primary-color,#03a9f4); outline-offset: -2px; }
      .layer .who { flex: 1; min-width: 0; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      /* The id stays visible next to the name, quietly: it is what every
         other list in this editor calls the element - a glass pattern, a
         colour rule, an interaction all name gauge_0 - so a row that showed
         only the friendly name would leave nothing to match them against. */
      .layer .who .id { font-family: monospace; color: var(--secondary-text-color); font-size: 11px; margin-left: 6px; }
      /* Alone, the id is the name, and it reads as the row's own text. */
      .layer .who .id.only { font-family: inherit; color: inherit; font-size: 12px; margin-left: 0; }
      .layer .over { color: var(--warning-color,#ffc107); cursor: help; }
      .layer button { background: none; border: none; color: var(--secondary-text-color); cursor: pointer; font-size: 13px; padding: 1px 3px; border-radius: 3px; }
      .layer button:hover:not([disabled]) { color: var(--primary-text-color); background: rgba(255,255,255,0.08); }
      .layer button[disabled] { opacity: 0.3; cursor: default; }
      /* border-box, so the 1px border is inside the width the zoom sets: as
         content-box it made the canvas 2px wider than the window it is drawn
         in, which is two scrollbars at 100% for a border. */
      /* The drawing surface stands for the card, so it takes the card's own
         colour and follows the theme with it - on a light theme a fixed dark
         slab is not a neutral backdrop, it is a wrong preview of where the
         elements will end up. The border and the shadow are what keep it
         legible against a dialog painted the same colour. */
      .canvas { position: relative; width: 100%; box-sizing: border-box;
        background: var(--ha-card-background, var(--card-background-color, #1a1a1a));
        border: 1px solid var(--divider-color, #555); border-radius: 4px; overflow: hidden;
        touch-action: pan-x pan-y; user-select: none; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
      /* Mixed from the ink rather than fixed to white: the grid has to read
         as a faint ruling on whatever the surface turned out to be. */
      .grid { position: absolute; inset: 0; pointer-events: none;
        --sc-rule: color-mix(in srgb, var(--primary-text-color, #fff) 9%, transparent);
        background-image: linear-gradient(to right, var(--sc-rule) 1px, transparent 1px), linear-gradient(to bottom, var(--sc-rule) 1px, transparent 1px); }
      /* Isolated because the live preview draws real gauges and bars, and
         those stack themselves with SC_LAYERS - numbers in the thousands,
         against the editor's own 2-to-5. Kept inside the box it is drawn in,
         a preview cannot climb over the selection, the placing overlay or the
         add menu. */
      /* The box is draggable, so the finger on it is ours - the canvas around
         it has handed the up-and-down back to the page. */
      .el { touch-action: none;
            position: absolute; isolation: isolate; box-sizing: border-box; cursor: grab; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: #fff; text-shadow: 0 1px 2px #000; border-radius: 2px; background: rgba(3,169,244,0.3); border: 1px solid var(--primary-color); overflow: hidden; }
      .el.surface { background: rgba(255,193,7,0.18); border-style: dashed; border-color: #ffc107; }
      /* The chips and the panel of numbers are drawn inside the element they
         belong to, and an element clips its own paint - so a chip stepped
         aside on a small gauge came out with half a word on it. While the
         element is the one open for editing, it stops clipping: what is
         outside it then is only the controls for it. */
      .el.inner { overflow: visible; }
      /* A side bowed outward is paint beyond the box, and the grip that set
         it stands out there too. Only while it is bent: the box clips its own
         contents the rest of the time, which is what keeps a chip inside the
         element it belongs to. */
      .el.bent { overflow: visible; }
      /* The box's own border goes while the outline has it: two edges round
         one shape, one of them wrong, is worse than the wrong one alone. */
      .el.outlined, .el.outlined.sel { border-color: transparent; }
      .el-outline { position: absolute; z-index: 1; pointer-events: none;
        overflow: visible; }
      .el-outline polygon { fill: none; stroke: #ffc107; stroke-width: 1;
        stroke-dasharray: 3 3; }
      .el.sel .el-outline polygon { stroke-width: 2; stroke-dasharray: none; }
      .el.sel { background: rgba(3,169,244,0.55); border-width: 2px; z-index: 3; }
      /* A pinned element says so twice: the cursor, which answers before the
         press, and the badge, which answers from across the canvas. The border
         goes solid-grey so a locked surface stops reading as a dashed one. */
      .el.pinned { cursor: default; border-color: #9e9e9e; border-style: solid; }
      /* Top right, where the lock badge used to be drawn: it is a button now,
         and it is on every box rather than only on the locked ones. A badge
         that only appears once the lock is shut answers "is this locked" and
         nothing else - the way to shut it was a selection and a second button
         under the canvas, which is a long way round for one box. The one
         under the canvas stays, because a group is the thing it is good at.

         An open lock is quiet and a shut one is not: sixteen bright locks
         over sixteen gauges would be a row of buttons with a drawing behind
         it, and the state worth reading from across the canvas is the shut
         one. Hover and focus bring the quiet ones up. */
      .el-lock { position: absolute; top: 6px; right: 6px; z-index: 7;
        width: 24px; height: 24px; padding: 0; font-size: 15px; line-height: 1;
        display: flex; align-items: center; justify-content: center;
        border-radius: 5px; cursor: pointer; touch-action: none;
        border: 1px solid transparent; background: none; color: #fff;
        opacity: 0.32; filter: drop-shadow(0 1px 2px #000) drop-shadow(0 0 3px #000);
        transition: opacity 0.12s; }
      .el-lock:hover, .el-lock:focus-visible { opacity: 1; }
      .el.sel > .el-lock { opacity: 0.6; }
      .el.pinned > .el-lock { opacity: 1; }
      /* Which boxes answer a push, and so take that click away from the card
         underneath them. Bottom left, clear of the lock above it and of the
         resize handle opposite. The card's own badge sits on the canvas frame.
         Both badges stand off the border the same distance the ring steppers
         do: against it a glyph reads as part of the frame's edge. */
      /* A mask rather than a glyph, for the same reason the lock above is one.
         The drawing already points up and to the left, so where the emoji had
         to be mirrored and turned, this one is only turned - far enough that
         the finger goes down into the box it belongs to. */
      .el.pushed::after, .canvas.pushed::after {
        content: ''; position: absolute; bottom: 6px; left: 6px; z-index: 5;
        width: 15px; height: 15px; pointer-events: none; background: #fff;
        filter: drop-shadow(0 1px 2px #000) drop-shadow(0 0 3px #000);
        -webkit-mask: var(--sc-push-mask) center / contain no-repeat;
        mask: var(--sc-push-mask) center / contain no-repeat;
        transform: rotate(135deg); transform-origin: center; }
      .canvas.pushed::after { bottom: 4px; left: 5px; width: 20px; height: 20px; }
      /* Live, the box is a frame around someone else's drawing rather than a
         block of colour: the fill would hide the very thing being previewed,
         so selection is an inset ring instead. Size containment mirrors
         .sc-canvas in the renderer, which is what the 100cqmin below
         resolves against there.
         The text properties go back to inherited because .el sets 10px bold
         with a shadow for the id it draws, and that would be the font a
         previewed element resolves em and % against - in the card it inherits
         the dashboard's text instead, so the same config rendered smaller
         here than on the card it is previewing.
         line-height has to be named after the shorthand, which resets it: a
         card on a dashboard inherits Home Assistant's 1.6, the config dialog
         inherits normal, and a circular bar whose two lines are nudged
         together by circular_*_offset_y then lands the label on the value. */
      .el.live { background: none; border-color: rgba(3,169,244,0.5); container-type: size;
                 font: inherit; line-height: var(--ha-line-height-normal, 1.6);
                 color: inherit; text-shadow: none; letter-spacing: normal; }
      .el.live.sel { background: none; box-shadow: inset 0 0 0 2px var(--primary-color); }
      .el.live > sc-gauge { width: 100cqmin; height: 100cqmin; max-width: 100%; max-height: 100%; }
      .el.live > sc-progressbar { width: 100%; max-height: 100%; }
      /* Over the selected elements (.el.sel is 3), because the frame is what
         the pointer is doing right now and has to stay readable across one. */
      .band { position: absolute; z-index: 4; pointer-events: none; border: 1px dashed var(--primary-color,#03a9f4); background: rgba(3,169,244,0.12); }
      /* Names ride above the boxes rather than inside them. A 20-unit gauge is
         barely wider than one letter, and a caption clipped to a W says less
         than the id it would have replaced - so a tag is allowed to run past
         the edge of the element it belongs to, and is stopped only by the edge
         of the canvas. An element with nothing assigned yet has no name to
         show and falls back to its id, so every box keeps a tag - a gap in the
         row would only read as an element that had gone missing. The layer
         never takes the pointer: every press on it belongs to whatever lies
         underneath. Being outside the box also keeps the card's own
         typography, which the live preview injects at the box, away from a
         label that is the editor's rather than the card's. */
      .tags { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
      .tag {
        position: absolute; transform: translateY(-100%); width: max-content;
        padding: 0 3px; border-radius: 0 4px 0 0;
        background: rgba(0,0,0,0.72); color: #fff;
        font-size: 9px; font-weight: normal; line-height: 1.6;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        text-shadow: none;
      }
      /* Ink, not white: on a light surface a white grip is the surface. */
      .handle { position: absolute; right: 0; bottom: 0; width: 12px; height: 12px;
        background: color-mix(in srgb, var(--primary-text-color, #fff) 85%, transparent); border-radius: 100% 0 0 0; cursor: nwse-resize; touch-action: none; }
      .handle::after { content: ''; position: absolute; right: -10px; bottom: -10px; width: 22px; height: 22px; }
      /* The frames over a gauge's own text. The outline is drawn outside the
         measured rect, because the rect is the glyphs and a border on it would
         sit across them. */
      /* A preview keeps its layers to itself. A renderer stacks its own parts
         with SC_LAYERS - 700 for a background, 900 for a value - and while it
         makes no stacking context of its own those numbers compete with the
         editor's own overlays inside this box: a gauge with a background drew
         straight over the part frames, which then could not be seen at all. */
      .el > sc-gauge, .el > sc-progressbar { isolation: isolate; }
      /* These lie over whatever the gauge draws - a bright dial, a dark one, a
         picture - so a single thin line in one colour is legible on some
         gauges and lost on others. Each carries a dark plate of its own: the
         shadow fills the outline's offset, so the bright dashes always stand
         against black rather than against the artwork. */
      /* Two colours, decided once. Blue is every part of the gauge that has a
         frame; amber is the one part in hand, and it is warm rather than loud
         because it lies over artwork somebody is trying to look at. */
      :host { --sc-part: #8ce0ff; --sc-part-sel: #f2b544; --sc-part-sel-ink: #1b1200; }
      /* The drawing the push badge is masked with, here because a content
         property cannot hold an element and a mask has to come from
         somewhere. The lock had one too until it became a button, which can
         simply hold the icon. */
      :host { --sc-push-mask: ${unsafeCSS(iconMask('pointer'))}; }
      /* The halo and the offset outline both paint *outside* the box, and a
         drag moves the box by rewriting left/top. WebKit then repaints
         only the border box and leaves the ring behind, so a label dragged
         across a gauge on an iPad trails grey fragments of its own shadow -
         which the light surface made plain to see. Its own compositing layer
         is what fixes that: the layer is redrawn whole, so there is no dirty
         rectangle to get wrong. Only the parts of the one element being
         worked on carry a frame, so this is a handful of layers, not many. */
      .inner-frame { position: absolute; outline: 1px dashed var(--sc-part);
        outline-offset: 3px; box-shadow: 0 0 0 4px rgba(0,0,0,0.55);
        background: rgba(3,169,244,0.14); cursor: move;
        will-change: transform;
        touch-action: none; z-index: 5; }
      .inner-frame::after { content: ''; position: absolute; inset: -8px; }
      /* Which of the two the middle-axis buttons would act on. */
      .inner-frame.sel { outline: 2px solid var(--sc-part-sel);
        background: rgba(242,181,68,0.22); }
      /* One surface, with the name at its left and the buttons at its right,
         so a frame's head reads the way a ring's chip does. They used to be
         three things placed separately - the name at the frame's left corner
         and the buttons at its right - which on a wide frame put the name and
         the button that acts on it half the drawing apart. */
      .inner-tag { position: absolute; left: 0; bottom: 100%; margin-bottom: 7px;
        display: flex; align-items: center; gap: 3px;
        font-size: 11.5px; line-height: 1; padding: 2px 3px 2px 5px; border-radius: 3px;
        background: var(--primary-color, #03a9f4); color: #fff; white-space: nowrap;
        pointer-events: none; opacity: 0.8; box-shadow: 0 0 0 1px rgba(0,0,0,0.55); }
      .inner-frame.sel .inner-tag { opacity: 1;
        background: var(--sc-part-sel); color: var(--sc-part-sel-ink); }
      /* The buttons every chip ends with, in one order wherever a chip is
         drawn: what the part says, then the way back out. Last because it is
         the one press that cannot be taken back by pressing again, and a
         button that removes something belongs at the end of a row rather than
         in the middle of one. A bin rather than a minus sign - a minus beside
         a row of steppers reads as one fewer of something. */
      .chip-btn { width: 15px; height: 15px; padding: 0; font-size: 11px;
        line-height: 0; display: grid; place-items: center; pointer-events: auto;
        border-radius: 3px; cursor: pointer; touch-action: none;
        border: 1px solid rgba(255,255,255,0.7); background: rgba(0,0,0,0.4);
        color: #fff; }
      .ring-tag.sel .chip-btn, .inner-frame.sel .chip-btn {
        border-color: rgba(0,0,0,0.45); color: var(--sc-part-sel-ink); }
      .chip-btn.drop:hover { background: var(--error-color,#db4437);
        border-color: var(--error-color,#db4437); color: #fff; }
      .chip-btn.write:hover { background: rgba(255,255,255,0.3); }
      .chip-btn.write.on { background: rgba(0,0,0,0.75); color: #fff;
        border-color: rgba(255,255,255,0.9); }
      /* Over the text it is setting, centred on it, and never narrower than a
         word or two: the frame is as wide as whatever is drawn, and a label
         being cleared to be retyped would leave a field too small to aim at.
         The editor's own type size rather than the drawing's - the frame is
         read at whatever the canvas is zoomed to, and the field has to stay
         legible at all of them. */
      .inner-text { position: absolute; left: 50%; top: 50%;
        transform: translate(-50%, -50%);
        width: 100%; min-width: 120px; box-sizing: border-box;
        font: inherit; font-size: 12px; line-height: 1.2; text-align: center;
        padding: 2px 4px; border-radius: 3px; touch-action: auto; cursor: text;
        border: 2px solid var(--sc-part-sel); background: rgba(0,0,0,0.92);
        color: #fff; box-shadow: 0 0 0 2px rgba(0,0,0,0.55); z-index: 1; }
      .inner-text:focus { outline: none;
        box-shadow: 0 0 0 1px rgba(0,0,0,0.55), 0 0 0 3px rgba(242,181,68,0.35); }
      /* Every offer this element has not taken up yet, down the sides of it -
         out of the drawing, and out of the way of the chips of the parts that
         are drawn.

         Each used to stand where its part would appear, which reads well with
         one offer out and badly with six. A row across the top was no better
         on a gauge: the middle of the top edge is where the arc reaches
         highest, so the row lay over the drawing on exactly the elements that
         had the most to offer. The sides are the empty part of a round thing
         in a square box, and there is room there for every offer a kind has.

         A column per kind, so which are texts on the face and which are rings
         around it is said by where they stand rather than by a gap in a list.
         It wraps inwards if a column ever runs out of height - never off the
         box - and the right-hand one packs to the right so its second column
         grows towards the middle rather than away.

         Only left/top or right/top, never both sides at once: an absolute box
         spanning two edges is as wide as the element whatever it holds, and
         the dodging measures this box, so a stretched one would read as being
         in the panel's way from either side and could never step out of it. */
      .inner-adds { position: absolute; top: 6px;
        max-height: calc(100% - 42px);
        transform: translate(var(--sc-chip-dx, 0px), var(--sc-chip-dy, 0px));
        transition: transform 1.2s cubic-bezier(0.33, 0, 0.2, 1);
        display: flex; flex-flow: column wrap; column-gap: 6px; row-gap: 3px;
        z-index: 6; pointer-events: none; }
      /* Below the pencil, which owns the top left corner. */
      .inner-adds.left { left: 6px; top: 36px;
        align-items: flex-start; align-content: flex-start; }
      .inner-adds.right { right: 6px;
        align-items: flex-end; align-content: flex-end; }
      /* The offer to switch a part on. It writes the key the form's own switch
         writes, so there is one setting and not two. Dashed, because nothing
         is there yet. */
      .inner-add { pointer-events: auto;
        padding: 1px 6px; font-size: 11.5px; line-height: 1.5; white-space: nowrap;
        border-radius: 4px; cursor: pointer; touch-action: none;
        border: 1px dashed var(--sc-part); background: rgba(0,0,0,0.65); color: #fff;
        box-shadow: 0 0 0 1px rgba(0,0,0,0.55); }
      .inner-add:hover { background: var(--primary-color,#03a9f4); border-style: solid; }
      /* A ring is a distance from the centre, so its frame is a ring too and
         the only gesture on it is in and out. Drawn in the gauge's own viewBox
         over the gauge's own square, which is what keeps it a circle whatever
         shape the element's box is. The layer itself takes no presses: only
         the fat transparent band does, or the hollow middle would swallow
         every press on the gauge inside it. */
      .ring-layer { position: absolute; overflow: visible; z-index: 4;
        pointer-events: none; }
      /* The needle's handles sit above the chips, not below them. A chip is a
         label that happens to be pressable; a handle is the thing being
         dragged, and the tail is dragged in towards the pivot where the hub's
         own chip stands. */
      .grip-layer { z-index: 8; }
      /* Thin, dashed and half transparent: the band lies across the very marks
         it is there to place, and anything heavier hid the ticks and
         sub-ticks under it. It used to go solid and half again as wide when
         it was the ring in hand, back when every ring had one and the width
         was what told them apart. Only the ring in hand is drawn now, so
         there is nothing left to tell apart and the colour is enough. */
      .ring-band { fill: none; stroke: var(--sc-part); stroke-width: var(--sc-band-w, 0.35);
        stroke-dasharray: 1.2 1.2; opacity: 0.5;
        filter: drop-shadow(0 0 0.5px rgba(0,0,0,0.9)); }
      .ring-band.sel { stroke: var(--sc-part-sel); }
      /* The edge of a ring nobody has drawn. It still sets the gauge's size,
         so it has to be reachable - but a longer dash and less of it says it
         is a measure rather than something painted on the card. */
      .ring-band.ghost { stroke-dasharray: 0.6 2.4; opacity: 0.35; }
      .ring-hit { fill: none; stroke: transparent; stroke-width: 2.4;
        pointer-events: stroke; cursor: ns-resize; touch-action: none; }
      /* The needle itself, which selects the pointer and slides it in and out
         along its own line. The two ends set its length instead, and they are
         drawn after this so they win the press where the two overlap. */
      .needle-hit { fill: none; stroke: transparent; stroke-width: 3;
        pointer-events: stroke; cursor: move; touch-action: none; }
      /* The needle's two ends. Filled, unlike the bands: a grip is small
         enough that taking every press inside it is what it is for, and the
         needle has nothing underneath it worth reading through. */
      .ring-grip { fill: var(--sc-part); stroke: rgba(0,0,0,0.9); stroke-width: 0.2;
        opacity: 0.6; }
      .ring-grip.sel { fill: var(--sc-part-sel); opacity: 1; }
      /* The arrow goes away while a crosshair is up: two pointers for one
         hand, one of them drawn by the browser over the very crossing point
         the other one is there to show, is one too many. Every descendant
         and not just the host, because nearly everything under it sets a
         cursor of its own - a band is ew-resize, a grip nwse-resize - and
         inheritance would not reach past any of them. */
      :host([cross]), :host([cross]) * { cursor: none !important; }
      /* A real crosshair: one line each way, crossing where the handle is.
         Dashed and thin, because it is drawn across the very marks it is
         there to line the handle up against - a solid pair hid the ticks it
         was being read off. Only while a handle is held, and only for the
         handle actually held: two crosshairs on one needle say nothing about
         either end. */
      .grip-cross { stroke: var(--sc-part-sel); stroke-dasharray: 1 0.7;
        opacity: 0.85; pointer-events: none; }
      .ring-grip-hit { fill: transparent; stroke: none; pointer-events: all;
        cursor: move; touch-action: none; }
      .ring-tag { position: absolute;
        transform: translate(calc(-50% + var(--sc-chip-dx, 0px)),
                             calc(-50% + var(--sc-chip-dy, 0px)));
        /* Only the stepping aside moves a chip by a transform - where it
           belongs is left/top, and a chip dragged by hand writes those -
           so this animates the dodge and nothing else, and never lags a
           finger. Slow, and slowest at both ends: a chip is getting out of
           the way of something the eye is already on, so it has to be
           possible to ignore. At a fifth of a second it read as a jump. */
        transition: transform 1.2s cubic-bezier(0.33, 0, 0.2, 1);
        display: flex; align-items: center; gap: 3px; z-index: 7;
        font-size: 11.5px; line-height: 1; padding: 2px 5px; border-radius: 3px;
        background: var(--primary-color, #03a9f4); color: #fff; white-space: nowrap;
        opacity: 0.85; cursor: grab; touch-action: none;
        box-shadow: 0 0 0 1px rgba(0,0,0,0.55); }
      /* The one chip that never gives way is the one the panel hangs from, so
         it is also the one the panel may not cover: on a canvas too short for
         the panel there is nowhere for either to go, and that chip is how the
         panel is put away again. */
      .ring-tag.sel { opacity: 1; z-index: 9;
        background: var(--sc-part-sel); color: var(--sc-part-sel-ink); }
      .ring-shape { width: 15px; height: 15px; padding: 0; font-size: 10px;
        line-height: 1; border-radius: 3px; cursor: pointer; touch-action: none;
        border: 1px solid rgba(0,0,0,0.45); background: rgba(0,0,0,0.25);
        color: var(--sc-part-sel-ink); }
      .ring-shape:hover { background: rgba(0,0,0,0.45); }
      /* The way into a gauge's own parts, on the gauge it would open. It used
         to be a button in the toolbar, where nothing said which element it
         was about - and the corner it stands in is the one the ring's numbers
         left when they moved under their chips. */
      .inner-open { position: absolute; top: 6px; left: 6px; z-index: 7;
        width: 24px; height: 24px; padding: 0; font-size: 15px; line-height: 1;
        border-radius: 5px; cursor: pointer; touch-action: none;
        border: 1px solid var(--sc-part); background: rgba(0,0,0,0.62);
        color: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.55); }
      .inner-open:hover:not([disabled]) { background: var(--primary-color,#03a9f4); }
      .inner-open.on { border-color: var(--sc-part-sel);
        background: var(--sc-part-sel); color: var(--sc-part-sel-ink); }
      .inner-open[disabled] { opacity: 0.35; cursor: default; }
      /* The tag itself takes no presses - it is a label on a frame that is
         dragged - so the one button inside it has to ask for them back. */
      .inner-tag .ring-shape { pointer-events: auto; margin-left: 4px;
        vertical-align: -2px; }
      /* Where the ring's number lives: directly under the chip that names the
         part, so the two read as one control rather than as a cluster in a
         corner that has to be matched up with a selection across the gauge.
         Hung from the chip's own spot, half a chip's height below its middle. */
      /* One number per line, in four columns - glyph, less, the number,
         more - so the three read as a list rather than as a row that wraps
         wherever the gauge happens to end. A grid rather than a stack of
         rows, because the numbers are of different widths and a column that
         does not line up is harder to read than one that does.
         width: max-content, or an absolutely placed box is shrunk to the room
         left of it in its containing block - half the gauge - and the box
         would stand wider than the column inside it. */
      /* Over the chips while it is showing. The panel belongs to the one part
         in hand and is as deep as that part has things to say; a chip that
         lay across it would take rows away with nothing to say that it had.
         The chips are still there underneath and come back the moment the
         part is let go, and the panel's own chip sits above it anyway,
         because the panel hangs off the bottom of it. */
      /* The nudge is what keeps the panel inside the canvas: the editor
         measures the box once it is drawn and says how far it has to come
         back, because how tall eight rows are is a layout result and not
         something the chip's position can know. */
      /* The scale is the grip's, and it is last in the transform so the
         nudge in front of it stays in plain pixels - a translate that is
         leftmost is not scaled by what follows it, which is what lets the
         fitting keep measuring in window pixels. The origin is the anchor
         the panel hangs from, so growing it does not move it off its chip. */
      .ring-steps { position: absolute;
        transform: translate(calc(-50% + var(--sc-steps-dx, 0px)),
                             calc(12px + var(--sc-steps-dy, 0px)))
                   scale(var(--sc-steps-zoom, 1));
        transform-origin: top center;
        overflow-y: auto; overscroll-behavior: contain;
        /* So the cap the fitting works out is the height the panel is drawn
           at: on content-box the padding is added to it and the panel stands
           six pixels taller than the canvas it was measured against. */
        box-sizing: border-box;
        z-index: 8;
        /* Kept for the case no chip can get out of the way: behind the panel
           is better than across it. */
        display: grid; grid-template-columns: auto auto auto auto;
        align-items: center; justify-items: center;
        width: max-content; gap: 3px; padding: 3px 5px;
        border-radius: 5px; background: rgba(0,0,0,0.62);
        box-shadow: 0 0 0 1px rgba(242,181,68,0.6); }
      /* Hanging upwards from its anchor instead of downwards, for a panel
         placed on a line it has to stay on one side of. */
      .ring-steps.up { transform: translate(calc(-50% + var(--sc-steps-dx, 0px)),
                                            calc(-100% - 12px + var(--sc-steps-dy, 0px)))
                                  scale(var(--sc-steps-zoom, 1));
        transform-origin: bottom center; }
      /* Two menus' worth of columns, for a panel that has half a drawing to
         stand in rather than all of it. A group is four cells wide however
         many columns there are, so the rows simply pair up. */
      .ring-steps.wide { grid-template-columns: repeat(8, auto); }
      /* A line where the second menu begins, so eight cells in a row read as
         two rows of four rather than one row of eight. A group is always four
         columns wide, so every second one starts the fifth column - which is
         the only way to name that column at all, the widths being the
         contents'. Drawn on the cell and stretched to the row, so what breaks
         it is the gap between rows and nothing else. */
      .ring-steps.wide > .ring-group:nth-child(even) > *:first-child {
        align-self: stretch; margin-left: 4px; padding-left: 5px;
        border-left: 1px solid rgba(255,255,255,0.16); }
      /* Sticky, so it stays in the corner of a panel that is scrolling its
         own rows rather than sliding away with them. Its own row, because a
         grid cell that hangs outside the grid is a cell the rows have to
         leave room for. */
      .steps-grip { grid-column: 1 / -1; justify-self: end; position: sticky;
        bottom: 0; width: 10px; height: 10px; margin: -1px -2px -1px 0;
        cursor: nwse-resize; touch-action: none;
        background: linear-gradient(135deg, transparent 52%,
                    var(--sc-part-sel) 52%, var(--sc-part-sel) 68%,
                    transparent 68%, transparent 78%,
                    var(--sc-part-sel) 78%, var(--sc-part-sel) 94%, transparent 94%); }
      /* Inwards and not all round: the panel is a scroll container, and six
         pixels of invisible hit pad hanging past its bottom right corner is
         six pixels of content to scroll to - both bars appeared on a menu
         that fitted, and the horizontal one then took the height that made
         the vertical one true. */
      .steps-grip::after { content: ''; position: absolute; inset: -6px 0 0 -6px; }
      /* The group is what a number is made of, not a box of its own: its four
         parts are cells of the one grid, which is what lines the columns up. */
      .ring-group { display: contents; }
      /* Wide enough for an emoji: a glyph that carries its own colour is drawn
         at more than its font size, and at ten pixels the three surface icons
         were clipped down their left edge. */
      /* The icon is sized by this font size, not by a width of its own. */
      .ring-step-icon { font-size: 15px; line-height: 1; color: var(--sc-part-sel);
        min-width: 15px; display: inline-flex; align-items: center;
        justify-content: center; }
      .ring-step { width: 20px; height: 20px; padding: 0; font-size: 15px;
        line-height: 1; border-radius: 4px; cursor: pointer; touch-action: none;
        border: 1px solid var(--sc-part-sel); background: rgba(0,0,0,0.5); color: #fff; }
      .ring-step:hover:not([disabled]) { background: var(--primary-color,#03a9f4); }
      .ring-step[disabled] { opacity: 0.35; cursor: default; }
      .ring-step-val { font-size: 13px; line-height: 1; color: #fff;
        min-width: 22px; text-align: center; font-variant-numeric: tabular-nums; }
      /* A swatch and a select stand across the three cells the two buttons and
         the number would, so a row of either still reads as one line. */
      .ring-wide { grid-column: span 3; justify-self: stretch; }
      .ring-slide { grid-column: span 2; justify-self: stretch; width: 96px;
        height: 20px; margin: 0; cursor: pointer; accent-color: var(--sc-part-sel); }
      .ring-swatch { height: 20px; border-radius: 4px; cursor: pointer;
        border: 1px solid var(--sc-part-sel); overflow: hidden; position: relative; }
      /* The colour input itself is the picker and not the swatch: every
         browser draws its own box around one, and none of them is this small.
         Blown up and pushed out of sight, the label is the whole of what is
         seen and a press on it still opens the picker. */
      .ring-swatch input[type="color"] { position: absolute; inset: -50%;
        width: 200%; height: 200%; padding: 0; border: none; background: none;
        cursor: pointer; opacity: 0; }
      /* Words, so they wrap: four cells across and a width of its own, or a
         sentence would stretch the columns every other row is measured by. */
      .ring-note { grid-column: span 4; justify-self: stretch; max-width: 190px;
        font-size: 10px; line-height: 1.3; color: rgba(255,255,255,0.72);
        padding: 1px 2px 2px; }
      .ring-flag { display: flex; align-items: center; gap: 4px; height: 20px;
        font-size: 11px; line-height: 1; color: #fff; cursor: pointer;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ring-flag input { margin: 0; width: 13px; height: 13px; flex: none; cursor: pointer; }
      .ring-pick { height: 20px; padding: 0 2px; font-size: 11px; line-height: 1;
        border-radius: 4px; cursor: pointer; max-width: 108px;
        border: 1px solid var(--sc-part-sel); background: rgba(0,0,0,0.5); color: #fff; }
      /* Home Assistant's picker is a full-height text field with a dropdown,
         which is a form control in a row of 20px chips. Scaled down rather
         than restyled: its insides are its own shadow root's, and the two
         custom properties it does read are the ones below. */
      .ring-iconpick { max-width: 150px; --mdc-typography-subtitle1-font-size: 11px;
        --text-field-padding: 0 4px; }
      .ring-iconpick::part(base) { height: 24px; }
      /* On the edge it runs along, at the point the radius reaches. Above
         everything else on the box, because a corner is where a chip is least
         likely to be but the two can still meet on a small element.

         Tangent to the border rather than centred on it: the element's box
         clips what hangs out of it, so a grip astride the line would be drawn
         as a half disc. The rim touches the line instead, which reads the same
         and is all there. */
      .corner-grip { position: absolute; width: 11px; height: 11px;
        border-radius: 50%; z-index: 9; background: var(--sc-part-sel);
        touch-action: none;
        box-shadow: 0 0 0 1.5px rgba(0,0,0,0.7), 0 0 0 2.5px rgba(255,255,255,0.85); }
      /* Round like the corner grips, because they do the same kind of work,
         and told apart by the arrow the cursor takes on: a side moves along
         one axis only, and which one is the whole of what there is to know. */
      .side-grip { position: absolute; width: 11px; height: 11px;
        border-radius: 50%; z-index: 9; background: var(--sc-part-sel);
        touch-action: none; transform: translate(-50%, -50%);
        box-shadow: 0 0 0 1.5px rgba(0,0,0,0.7), 0 0 0 2.5px rgba(255,255,255,0.85); }
      /* Both axes, because the handle does both: across the side is the
         depth of the bow, along it is where the crest of that bow sits. */
      .side-grip { cursor: move; }
      .side-grip::after { content: ''; position: absolute; inset: -7px; }
      .corner-grip[data-corner="bl"] { transform: translate(-50%, -100%);
        cursor: ew-resize; }
      .corner-grip[data-corner="tr"] { transform: translate(-100%, -50%);
        cursor: ns-resize; }
      .corner-grip::after { content: ''; position: absolute; inset: -7px; }
      /* Under everything the editor draws on the box, and taking no presses:
         it is the drawing, not a control. */
      .surface-skin { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
      .inner-grip { position: absolute; right: -8px; bottom: -8px; width: 10px; height: 10px;
        border-radius: 50%; background: var(--primary-color, #03a9f4);
        box-shadow: 0 0 0 1.5px rgba(0,0,0,0.6), 0 0 0 2.5px rgba(255,255,255,0.85);
        cursor: nwse-resize; touch-action: none; z-index: 6; }
      .inner-grip::after { content: ''; position: absolute; inset: -8px; }
      .inner-frame.sel .inner-grip { background: var(--sc-part-sel); }
      .num { width: 68px; }
      /* The card's box controls read as one column: the mode first, always the
         same width, then the number it needs - which several of them do not,
         so an inline width would leave the rows out of step with each other. */
      .ctl {
        display: grid; grid-template-columns: 126px 76px 64px;
        gap: 10px; align-items: center; justify-items: start;
      }
      .ctl > select { width: 126px; }
      /* Its own column, so the unit beside it cannot end up on top of it. */
      .ctl > .num { width: 76px; box-sizing: border-box; }
      /* Third column whether or not the second is filled: a row without a
         number would otherwise slide its unit under the number of the row
         above it. */
      .ctl > .hint { grid-column: 3; }
      .hint { font-size: 11px; color: var(--secondary-text-color); }
      /* While one of a gauge's own parts is in hand its settings belong right
         under the canvas, not below a list of sixteen layers - the two have to
         be within sight of each other to be worth anything. Moved with
         the order property, not by rendering it somewhere else: lit would build the
         editor afresh at the new place and every fold in it would spring
         shut. */
      .col.part-in-hand > .objects,
      .col.part-in-hand > .hint { order: 1; }
      .el-config { border: 1px solid var(--divider-color,#444); border-radius: 6px; background: rgba(0,0,0,0.15); }
      .el-config > summary { padding: 7px 10px; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--primary-color,#03a9f4); list-style: none; display: flex; align-items: center; gap: 6px; user-select: none; }
      .el-config > summary::-webkit-details-marker { display: none; }
      /* A pseudo-element holds no element, so the one icon in the editor that
         cannot be an \`<svg>\` is this marker - it is the same drawing as a mask. */
      .el-config > summary::before { content: ''; width: 11px; height: 11px; flex: none;
        background: currentColor; mask: ${unsafeCSS(iconMask('chevron-right'))} center/contain no-repeat;
        transition: transform 0.15s; }
      .el-config[open] > summary::before { transform: rotate(90deg); }
      .el-config-body { padding: 0 6px 6px; }
      /* The editor stacks against itself, not against the card SC_LAYERS
         orders: 2 and 3 are the resize handle and the selected element, so
         the placing overlay and the menu sit just above those. */
      .tool-row { display: flex; align-items: center; gap: 8px; margin: 2px 0 6px; flex-wrap: wrap; }
      .menu-wrap { position: relative; }
      /* Solid where Add element is dashed: one of them offers a thing that is
         not there yet, the other does something to what is. */
      .apply-btn { border-style: solid; }
      .apply-btn[disabled] { opacity: 0.4; cursor: default; }
      .apply-error { color: var(--error-color, #db4437); }
      .menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 5; min-width: 200px;
              max-height: 280px; overflow-y: auto; padding: 4px; border-radius: 6px;
              border: 1px solid var(--divider-color,#444); box-shadow: 0 6px 20px rgba(0,0,0,0.45);
              background: var(--card-background-color, var(--secondary-background-color, #1c1c1c)); }
      .menu-group { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
                    color: var(--secondary-text-color); padding: 6px 8px 2px; }
      .menu-item { display: block; width: 100%; text-align: left; background: none; border: none;
                   color: var(--primary-text-color); font-size: 12px; padding: 6px 8px;
                   border-radius: 4px; cursor: pointer; }
      .menu-item:hover { background: rgba(3,169,244,0.18); }
      .menu-item[disabled] { opacity: 0.4; cursor: default; }
      .menu-item[disabled]:hover { background: none; }
      /* The template page is two columns wide rather than one, so the
         miniature is big enough to tell a temperature from a humidity. Still
         bounded by the max-height above and scrolling, because seven of these
         are taller than any menu should be allowed to grow. */
      .menu.wide { min-width: 340px; max-height: 420px; }
      .menu-item .chev { float: right; color: var(--secondary-text-color); margin-top: 1px; }
      .menu-item .chev.back { float: none; margin-right: 6px; }
      .menu-item.back { color: var(--secondary-text-color); font-size: 11px; }
      .menu-item.tpl { display: flex; align-items: center; gap: 10px; padding: 6px; }
      /* The box the element is rendered into is the element's size - a gauge
         on the canvas is the size of its box - so the miniature's proportions
         are the cell's and not the template's. The cell's own size is written
         inline from TPL_CELL, which is where _previewBox reads it. */
      .tpl-pv { flex: 0 0 auto; border-radius: 4px;
                overflow: hidden; background: rgba(255,255,255,0.04);
                display: flex; align-items: center; justify-content: center; }
      .tpl-fit { display: block; position: relative; }
      .tpl-pv.empty { display: flex; align-items: center; justify-content: center;
                      font-size: 18px; color: var(--secondary-text-color); }
      .tpl-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      .tpl-text b { font-size: 12px; font-weight: 600; }
      .tpl-text em { font-style: normal; font-size: 10px; line-height: 1.3;
                     color: var(--secondary-text-color); }
      .place-layer { position: absolute; inset: 0; z-index: 4; cursor: crosshair; }
      /* The box the next click makes, drawn where it would land. Faint and
         dashed so it reads as not-yet-there, and pointer-events:none so the
         crosshair keeps moving it instead of hovering it - it is a child of
         the layer that is tracking the pointer. */
      .ghost { position: absolute; box-sizing: border-box; pointer-events: none;
               border: 1px dashed var(--primary-color); border-radius: 2px;
               background: rgba(3,169,244,0.22); opacity: 0.75;
               display: flex; align-items: center; justify-content: center;
               font-size: 10px; font-weight: bold; color: #fff;
               text-shadow: 0 1px 2px #000; overflow: hidden; }
      .ghost.surface { border-color: #ffc107; background: rgba(255,193,7,0.16); }
    `];
  }

  /**
   * The canvas as it is right now - mid-drag, that is where the pointer has
   * put it rather than what is saved.
   */
  get _canvas() {
    return this._dragCanvas || this.slot?.canvas || { ...DEFAULT_CANVAS, elements: [] };
  }

  _commit(canvas) { this._send('__merge__', { canvas }); }

  /**
   * Where a change to the canvas goes: into the drag, or into the config.
   *
   * A drag used to commit on every pointermove. Home Assistant wrote the card
   * config back for each of them, which handed every gauge and bar on the
   * canvas a new `config` object at pointer frequency - so the editor had to
   * drop the live previews to plain boxes for the duration, and one drag left
   * thirty entries in the undo history for a single gesture.
   *
   * A drag is one change, so it is one commit, made when the pointer is let
   * go. Until then the moved canvas lives here and the getter above hands it
   * out, which is all the drawing needs.
   */
  _put(canvas) {
    if (this._drag) this._dragCanvas = canvas;
    else this._commit(canvas);
  }

  /**
   * Commit, remembering what it is being changed from.
   *
   * Every change this editor makes goes through here, including the ones its
   * sub-editors make, so that the arrows above the canvas can walk back
   * through them one at a time. The snapshot is taken before the commit
   * because `this.slot` still holds the old config then - Home Assistant
   * hands the new one back asynchronously, a render later.
   */
  _send(key, value, keys = HISTORY_KEYS) {
    if (!this.commitFn) return;
    // A write that touches nothing the snapshot holds cannot be undone by
    // putting one back - a push, a colour or a glass pattern from an element's
    // settings is such a write. Recording it anyway would leave an entry on
    // the stack whose restore changes nothing, so the arrow would be enabled
    // and do nothing when pressed.
    if (!this._travelling && touchesHistory(key, value)) {
      this._undoStack = [...this._undoStack, this._snapshot(keys)].slice(-HISTORY_DEPTH);
      // A new change is a new future, so whatever was undone is not it.
      this._redoStack = [];
    }
    this.commitFn(key, value);
  }

  /**
   * What this editor's undo is responsible for putting back.
   *
   * A step carries the keys it is answerable for, because that is not the
   * same set every time: almost every step is the canvas', but one that
   * deletes a surface also takes the paint, the glass and the push off it,
   * and putting the surface back without them puts back a different surface.
   * Restoring those lists on every step instead would quietly undo a colour
   * set between two moves - an edit that made no step of its own, and that
   * nobody asked to have taken back.
   *
   * @param {readonly string[]} [keys]
   */
  _snapshot(keys = HISTORY_KEYS) {
    /** @type {Record<string, any>} */
    const slot = {};
    for (const key of keys) {
      if (this.slot?.[key] !== undefined) slot[key] = structuredClone(this.slot[key]);
    }
    return { slot, keys, grid: structuredClone(this.cardConfig?.grid_options ?? null) };
  }

  /** Put one snapshot back, as one commit. */
  _restore(snap) {
    const patch = restorePatch(this.slot || {}, snap.slot, snap.keys || HISTORY_KEYS);
    const gridNow = this.cardConfig?.grid_options ?? null;
    const gridDiffers = JSON.stringify(gridNow) !== JSON.stringify(snap.grid);
    if (!patch && !gridDiffers) return false;

    /** @type {[string, any][]} */
    const writes = [];
    if (gridDiffers) {
      writes.push(['__card__', { grid_options: snap.grid || undefined }]);
      this._restoredGrid = true;
    }
    if (patch) writes.push(['__merge__', patch]);
    this._travelling = true;
    try { this.commitFn('__batch__', writes); } finally { this._travelling = false; }
    return true;
  }

  _undo() {
    const snap = this._undoStack[this._undoStack.length - 1];
    if (!snap) return;
    const now = this._snapshot(snap.keys);
    this._undoStack = this._undoStack.slice(0, -1);
    if (this._restore(snap)) this._redoStack = [...this._redoStack, now].slice(-HISTORY_DEPTH);
  }

  _redo() {
    const snap = this._redoStack[this._redoStack.length - 1];
    if (!snap) return;
    const now = this._snapshot(snap.keys);
    this._redoStack = this._redoStack.slice(0, -1);
    if (this._restore(snap)) this._undoStack = [...this._undoStack, now].slice(-HISTORY_DEPTH);
  }

  /**
   * The card height in Home Assistant grid rows, or null for "as tall as the
   * canvas". Absent and the literal 'auto' both mean the latter: the card
   * reports `auto` itself, so an untouched config carries no rows at all.
   */
  get _rows() {
    const r = this.cardConfig?.grid_options?.rows;
    return typeof r === 'number' ? r : null;
  }

  /** The card's width in grid columns, from wherever it is currently set. */
  get _columns() { return gridSize(this.cardConfig, this.slot).columns; }

  /**
   * The widest the card can be here. Read from the section being edited on
   * every use rather than kept: the same editor instance stays mounted while
   * the section's width is changed in the tab next to it.
   *
   * Remembered all the same, because "every use" includes the uses where this
   * editor is not in the document. Home Assistant's dialog renders one tab at
   * a time, so opening Layout takes this element out of the tree - and the
   * only reason it is still updated is that the dialog goes on setting its
   * properties. Both readers walk *up* from here to find the section being
   * edited, and a detached element has nothing above it, so a size set in the
   * Layout tab was being measured against the reference section rather than
   * the real one: a card made square came back as a canvas shaped for a
   * 480-pixel section it is not in. The last answer from while it was mounted
   * is that same section, moments earlier.
   */
  get _maxColumns() {
    if (this.isConnected) this._sectionCols = sectionColumns(this);
    return this._sectionCols || HA_COLUMN_COUNT;
  }

  /**
   * How wide the card's section really is, read the same way and for the same
   * reason: the dashboard behind the dialog is where the number lives, and it
   * changes while this editor stays mounted. Remembered while detached, as
   * above - and only ever a width that was actually measured, since zero is
   * how this says "no section here" and is a perfectly good answer in a
   * masonry view.
   */
  get _sectionPx() {
    if (this.isConnected) {
      const px = sectionWidthPx(this);
      if (px > 0) this._sectionW = px;
    }
    return this._sectionW || 0;
  }

  /**
   * Writes HA's own `grid_options` rather than fields of our own, so these
   * controls and the layout tab are two views of one value instead of two
   * settings that have to be kept in step.
   *
   * Changing the card's box here also reshapes the canvas to match: the user
   * is setting the card's size, and a canvas that then letterboxed inside it
   * would be answering a question they did not ask. Clearing the row count
   * again puts the canvas back in the shape it had before, so the trip there
   * and back leaves nothing behind. It is not done on render - a card that
   * rewrites its own config for being displayed can corrupt a dashboard while
   * nobody is watching - so a shape that never matched in the first place is
   * offered as the Match button instead.
   */
  _setGrid(patch) {
    const grid = { ...(this.cardConfig?.grid_options || {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete grid[k]; else grid[k] = v;
    }
    if (!this.commitFn) return;
    const writes = [['__card__', {
      grid_options: Object.keys(grid).length ? grid : undefined
    }]];
    const shaped = this._reshapedFor({ ...this.cardConfig, grid_options: grid });
    if (shaped) writes.push(['__merge__', { canvas: shaped }]);
    this._send('__batch__', writes);
  }

  /**
   * Full width is not the number that happens to equal it today: a section made
   * wider later takes a `full` card with it, and leaves a numbered one behind.
   */
  _setFullWidth(full) {
    this._setGrid({ columns: full ? 'full' : this._maxColumns });
  }

  /**
   * Home Assistant's own switch, mirrored: on, the card reports `rows: "auto"`
   * and its height is whatever the canvas' shape makes of its width; off, the
   * height is pinned to a row count and the canvas is reshaped to that box.
   *
   * Turning it off pins the row count the card is already worth *here*, at the
   * width this section really has - so the card does not change height at the
   * moment the switch is thrown.
   */
  _setAutoHeight(auto) {
    if (auto) { this._setGrid({ rows: null }); return; }
    this._setGrid({ rows: rowsForShape(this._canvas, this._columns, this._maxColumns, this._sectionPx) });
  }

  /** A pinned height in rows. Under auto height the shape sets it instead. */
  _setShapeRows(rows) { this._setGrid({ rows }); }

  /**
   * The canvas as a card box wants it, or null when it is already that.
   *
   * Two readings of the same box, and the difference is whether the card's
   * height is somebody else's decision or the canvas' own.
   *
   * Pinned - a number in `grid_options.rows` - the height is given, and the
   * shape is made to match the box so the canvas does not letterbox inside
   * it. The shape it had before is remembered, because a pin is a state to
   * come back from. The section's measured width is what that box is read
   * against: a real height in pixels has to be met by a real width.
   *
   * Under auto height the canvas' shape *is* the card's height, so a change
   * of width says nothing about it - a card made wider gets taller in
   * proportion and the arrangement is untouched. This used to impose a
   * default shape here, a third of the columns, which quietly flattened a
   * canvas somebody had drawn square the moment they touched the width. The
   * one thing to do is to go back to the shape a row count was pinned over,
   * which is the only shape this knows was theirs.
   *
   * Null when there is nothing to do, which is what stops the commit this
   * causes from causing another.
   *
   * @param {any} cardConfig
   */
  _reshapedFor(cardConfig = this.cardConfig) {
    const c = structuredClone(this._canvas);
    const rows = cardConfig?.grid_options?.rows;

    if (typeof rows === 'number') {
      const shape = canvasFromGrid(cardConfig, this.slot, 400, this._maxColumns, this._sectionPx);
      return pinnedToShape(c, shape);
    }

    const { free, ...rest } = c;
    if (!free) return null;
    return (rest.w === free.w && rest.h === free.h) ? rest : rescaleCanvas(rest, free);
  }

  /** Reshape the canvas to the card's grid box, carrying the layout with it. */
  _matchGrid() {
    const shaped = this._reshapedFor();
    if (shaped) this._commit(shaped);
  }

  /** Whether the canvas is a different shape from the box the card occupies. */
  get _gridMismatch() {
    if (typeof this.cardConfig?.grid_options?.rows !== 'number') return false;
    const shape = canvasFromGrid(this.cardConfig, this.slot, 400, this._maxColumns, this._sectionPx);
    const c = this._canvas;
    return Math.abs(c.w / c.h - shape.w / shape.h) > 0.005;
  }

  /** Commit the canvas with one element's fields changed. */
  _setEl(idx, patch) {
    const c = structuredClone(this._canvas);
    const el = c.elements[idx];
    // `undefined` deletes the key, the same as it does in a `__card__` commit.
    // An element that is simply not locked should carry no `locked` at all,
    // or every canvas ever unlocked keeps a key saying so.
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete el[k]; else el[k] = v;
    }
    this._put(c);
  }

  /**
   * Commit several elements' boxes at once, by id.
   *
   * One commit, not one per element: `_commit` clones `this.config` and Home
   * Assistant writes it back asynchronously, so a second commit in the same
   * tick would be built from a config that does not have the first one yet -
   * dragging four elements would move one.
   */
  _setEls(patches) {
    const c = structuredClone(this._canvas);
    for (const el of c.elements) {
      const patch = patches[el.id];
      if (patch) Object.assign(el, patch);
    }
    this._put(c);
  }

  /**
   * Typing the canvas' own width or height forgets the shape a row count was
   * going to put back. It was a note about where the canvas came from, and
   * this is the user saying where it is now.
   */
  _setCanvas(key, value) {
    const c = structuredClone(this._canvas);
    c[key] = value;
    if (key === 'w' || key === 'h') delete c.free;
    this._commit(c);
  }

  /**
   * Switch the unit `grid` and `snap` are written in, carrying both numbers
   * over so the grid on screen does not move. The unit is a way of writing
   * the step down, not a different step - someone picking per cent wants
   * their grid to survive a reshape, not to lose it on the way there.
   */
  /**
   * The grid and its snap step, written as proportions of the canvas.
   *
   * A canvas still carrying them in units is converted on the way past: one
   * commit, because the conversion and the edit are the same edit, and two
   * commits in a tick would lose the first.
   */
  _setGridPct(patch) {
    const c = structuredClone(this._canvas);
    if (c.grid_unit !== 'pct') {
      if (typeof c.grid === 'number' && c.grid > 0) c.grid = unitsToGrid(c, c.grid);
      if (typeof c.snap === 'number' && c.snap > 0) c.snap = unitsToGrid(c, c.snap);
      c.grid_unit = 'pct';
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete c[k]; else c[k] = v;
    }
    this._commit(c);
  }

  // --- dragging ---------------------------------------------------------

  /**
   * Which elements lie under a pointer position, topmost first.
   *
   * Later in the array draws on top, so reversed is the order a click meets
   * them. Geometry, not the event's target: an element the click cannot
   * reach because another one covers it is exactly what this has to find.
   */
  _stackAt(e, rect) {
    const c = this._canvas;
    const px = (e.clientX - rect.left) / rect.width * c.w;
    const py = (e.clientY - rect.top) / rect.height * c.h;
    const hit = [];
    for (let i = c.elements.length - 1; i >= 0; i--) {
      const el = c.elements[i];
      if (px >= el.x && px <= el.x + el.w && py >= el.y && py <= el.y + el.h) hit.push(i);
    }
    return hit;
  }

  /**
   * Which element this press acts on, and what the release will need to know.
   *
   * Pressing the same spot again keeps whatever is selected there rather than
   * jumping back to the top of the stack - otherwise an element you clicked
   * your way down to could be selected but never dragged. The walking itself
   * happens on release, in `_onUp`, so that a press-and-drag moves what you
   * picked instead of the next one down.
   */
  _pressTarget(e, rect, idx) {
    const stack = this._stackAt(e, rect);
    const prev = this._lastDown;
    const same = !!prev && Math.abs(prev.x - e.clientX) <= SAME_SPOT_PX
                        && Math.abs(prev.y - e.clientY) <= SAME_SPOT_PX;
    this._lastDown = { x: e.clientX, y: e.clientY, moved: false, same, stack };
    if (!stack.length) return idx;
    const at = stack.findIndex(i => this._canvas.elements[i].id === this._sel);
    return same && at >= 0 ? stack[at] : stack[0];
  }

  /** A click on the canvas itself: nothing selected, and the walk starts over. */
  _deselect() { this._sel = null; this._extra = []; this._lastDown = null; }

  /**
   * Everything selected. `_sel` stays the one the settings and the element
   * list follow - a second selected element does not make the question "which
   * one am I configuring" ambiguous, it just adds elements that move together.
   */
  get _selection() { return this._sel ? [this._sel, ...this._extra] : []; }

  _isSel(id) { return this._sel === id || this._extra.includes(id); }

  /** The selection with one element added or taken out. */
  _toggleSel(id) {
    if (this._sel === id) {
      // The anchor leaving promotes the next one, so a selection that still
      // has elements in it never ends up with nothing to show settings for.
      this._sel = this._extra[0] ?? null;
      this._extra = this._extra.slice(1);
    } else if (this._extra.includes(id)) {
      this._extra = this._extra.filter(x => x !== id);
    } else if (this._sel) {
      this._extra = [...this._extra, id];
    } else {
      this._sel = id;
    }
    // Walking down a stack of overlapping elements is a single-selection idea;
    // a press that changed the selection is not a step in one.
    this._lastDown = null;
  }

  /** Select one element and nothing else. */
  _selectOnly(id) { this._sel = id; this._extra = []; }

  /** Select exactly these, the first of them the one the settings follow. */
  _applySelection(ids) { this._sel = ids[0] ?? null; this._extra = ids.slice(1); }

  /**
   * Copy everything selected, and select the copies.
   *
   * One `__merge__`, as `_duplicate` does for one element: the new boxes and
   * the entries they point at are a single edit, and `_commit` clones
   * `this.config`, so a second commit in the same tick would be written from
   * a config that does not have the first one yet.
   */
  _duplicateSelection() {
    const made = duplicateElements(this.slot, this._canvas, this._selection);
    if (!made || !this.commitFn) return;
    // The copies, not the originals: a copy is made to be put somewhere, and
    // what is selected is what the next drag moves.
    this._applySelection(made.ids);
    this._send('__merge__', { canvas: made.canvas, ...made.patch });
  }

  /**
   * Take every selected element off the canvas, in one commit.
   *
   * One commit rather than one per element, because the config is cloned on
   * each and Home Assistant writes it back asynchronously - three deletes in
   * a tick would keep only the last.
   */
  _removeSelection() {
    const selected = new Set(this._selection);
    if (!selected.size) return;
    const c = structuredClone(this._canvas);
    const going = this._canvas.elements.filter(el => selected.has(el.id));
    c.elements = c.elements.filter(el => !selected.has(el.id));
    if (c.elements.length === this._canvas.elements.length) return;
    // The list below the canvas follows the selection, so ids that no longer
    // exist would leave it empty with nothing left to click.
    this._sel = null;
    this._extra = [];
    // A surface is nothing but its box, and the next surface drawn takes the
    // lowest free number - so paint left behind under `elm_surface_0` is
    // paint the next `surface_0` comes up wearing. Only a surface: everything
    // else keeps its own config in a list of its own, where taking the box
    // off the canvas is not the same as deleting the thing.
    const dead = withoutElementConfig(this.slot,
      going.filter(el => el.surface).map(el => el.id));
    if (!dead) { this._commit(c); return; }
    // One commit, not two: `_commit` clones the config it was handed, and
    // Home Assistant writes that back a render later, so the second of two
    // commits in a tick is written over the first.
    this._send('__merge__', { canvas: c, ...dead }, SNAPSHOT_KEYS);
  }

  /**
   * Lock or unlock the whole selection.
   *
   * One press has to mean one thing for all of them, so a selection that is
   * not all locked locks, and only a selection that is entirely locked
   * unlocks. Half a selection changing state per press is the behaviour
   * nobody can predict.
   */
  _lockSelection() {
    const selected = new Set(this._selection);
    if (!selected.size) return;
    const lock = !this._allLocked;
    const c = structuredClone(this._canvas);
    for (const el of c.elements) {
      if (!selected.has(el.id)) continue;
      // Not locked carries no key at all, or every canvas ever unlocked keeps
      // one saying so.
      if (lock) el.locked = true; else delete el.locked;
    }
    this._commit(c);
  }

  /**
   * Lock or unlock one element, from its own button on the box.
   *
   * Beside `_lockSelection` rather than through it: that one is about a
   * selection and answers one press with one state for all of them, while
   * this is about the box under the finger and must not touch what happens
   * to be selected - nor select it, which would throw away a selection being
   * built for something else.
   *
   * @param {string} id
   */
  _toggleLock(id) {
    const c = structuredClone(this._canvas);
    const el = c.elements.find(e => e.id === id);
    if (!el) return;
    // Not locked carries no key at all - see `_lockSelection`.
    if (isPinned(el)) delete el.locked; else el.locked = true;
    this._commit(c);
  }

  /** Whether every selected element is locked, which is what unlocks them. */
  get _allLocked() {
    const els = this._canvas.elements;
    const sel = this._selection;
    return sel.length > 0 && sel.every(id => {
      const el = els.find(e => e.id === id);
      return el && isPinned(el);
    });
  }

  /** How many of the selected elements a copy would actually produce. */
  get _copyable() {
    const els = this._canvas.elements;
    return this._selection.filter(id => {
      const el = els.find(e => e.id === id);
      return el && canDuplicate(this.slot, el);
    }).length;
  }

  /**
   * Even gaps along one axis, for the elements that are selected.
   *
   * Next to the canvas rather than in the row of buttons under it, because it
   * acts on what is drawn there and on nothing else, and because it appears
   * and disappears with the selection - a button that comes and goes in a
   * fixed row moves every other button with it.
   */
  /**
   * Line the selection up on one edge, or through one middle.
   *
   * Beside the distribute buttons, because both are the same kind of thing:
   * an arrangement of the elements that are selected, done to all of them at
   * once.
   *
   * @param {'left'|'hcenter'|'right'|'top'|'vcenter'|'bottom'} edge
   */
  _align(edge) {
    const out = alignElements(this._canvas, this._selection, edge);
    if (out) this._commit(out);
  }

  _distribute(axis) {
    const out = distributeElements(this._canvas, this._selection, axis);
    if (out) this._commit(out);
  }

  /** How many of the selected elements an arrangement could actually move. */
  get _distributable() {
    const els = this._canvas.elements;
    return this._selection.filter(id => {
      const el = els.find(e => e.id === id);
      return el && !isPinned(el);
    }).length;
  }

  /**
   * What this element is called, or '' when only its id says anything.
   *
   * The card's own entity is Home Assistant's field on the Lovelace config,
   * not one of ours, which is why it is handed over separately - `icon`,
   * `name` and `state` draw it rather than an entity of their own.
   */
  _label(id) {
    return SC.elementLabel(this.slot, this.hass, id, this.cardConfig?.entity);
  }

  /** The tooltip on a box: what it is, what it is called, and whether it is pinned. */
  _title(el, pinned) {
    const name = this._label(el.id);
    return `${name ? `${name} (${el.id})` : el.id}${pinned ? ' - locked' : ''}`;
  }

  _onDown(e, idx, mode) {
    // Space makes the whole canvas a hand, elements included: the press is
    // there to move the window, not to pick anything up.
    if (e.button === 1 || (this._space && e.button === 0)) {
      e.stopPropagation();
      return this._startPan(e);
    }
    e.stopPropagation();
    if (mode === 'move' && this._takeDrawnPart(e)) return;
    // A press that gets this far is on bare canvas, or on an element's own box
    // where it draws nothing - every part stops the event where it is taken
    // hold of, and the drawing has just had its turn. So it is how a part is
    // let go of again, which until then could only be done by taking hold of
    // a different one.
    this._letGoOfPart();
    const surface = e.currentTarget.closest('.canvas');
    const rect = surface.getBoundingClientRect();
    // A resize handle names its own element; only a press on the box itself
    // has a stack to choose from. Resizing still ends the walk, so the next
    // click on the box starts from the top again.
    if (mode === 'move') idx = this._pressTarget(e, rect, idx);
    else this._lastDown = null;
    const el = this._canvas.elements[idx];

    // Shift, Ctrl or Cmd adds to the selection instead of replacing it, and
    // starts nothing: a press meant to pick a second element is not a drag,
    // and a hand that moves a pixel while holding a modifier should not
    // shove what it was only pointing at.
    if (mode === 'move' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      this._toggleSel(el.id);
      return;
    }
    // Pressing something already in the selection keeps the selection - that
    // press is how the group is dragged. Anything else selects just itself.
    if (!this._isSel(el.id)) this._selectOnly(el.id);

    // Selected but not dragged. A pinned element still has to be reachable -
    // it is where its settings live, and where the lock is undone - so the
    // press picks it up as any other and simply starts nothing.
    if (isPinned(el)) return;
    const box = e => ({ id: e.id, surface: e.surface, locked: e.locked,
                        x: e.x, y: e.y, w: e.w, h: e.h });
    const group = mode === 'move' && this._selection.length > 1
      ? this._canvas.elements.filter(e => this._isSel(e.id)).map(box)
      : null;
    const view = this._view;
    this._drag = {
      idx, mode, rect, group,
      startX: e.clientX, startY: e.clientY,
      startScroll: { left: view?.scrollLeft ?? 0, top: view?.scrollTop ?? 0 },
      origin: box(el),
    };
    this._ptr = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  /**
   * Save the card without closing the dialog.
   *
   * The dialog's own save does this and then shuts, which is the wrong shape
   * for a canvas: arranging one is a long job, and the way to keep it safe
   * should not also be the way to stop working on it. The reaching-into-HA
   * part is in `card-apply.js`; what is left here is what the button says.
   */
  async _apply() {
    if (this._applyState === 'saving') return;
    this._applyState = 'saving';
    this._applyError = '';
    const result = await applyCardConfig(this);
    if (!result.ok) {
      this._applyState = 'idle';
      this._applyError = result.error;
      return;
    }
    this._applyState = 'saved';
    this._refreshApply();
    clearTimeout(this._appliedTimer);
    this._appliedTimer = setTimeout(() => { this._applyState = 'idle'; }, APPLY_SAVED_MS);
  }

  /**
   * Whether Apply has anything to do, read off the dialog's dirty state.
   *
   * Read rather than tracked, because the dialog goes dirty for edits this
   * editor never sees - a card's size set in the Layout tab is Home
   * Assistant's own control writing Home Assistant's own key. Tracking our
   * commits would grey the button out over work that really is unsaved, which
   * is the one failure mode worth designing against; a button that is live
   * with nothing to do merely writes the same config twice.
   *
   * So it is asked for at every render, and once more when the pointer
   * arrives on the button - the render may be older than the last visit to
   * another tab, and you cannot click it without going there first.
   */
  _refreshApply() {
    const can = dialogHasUnsavedWork(this);
    if (can !== this._canApply) this._canApply = can;
  }

  /** The window the canvas is zoomed and scrolled inside. */
  get _view() { return this.shadowRoot?.querySelector('.canvas-view') ?? null; }

  /**
   * How many times its own height the window is drawn at.
   *
   * One everywhere except inside a gauge, where the window is squared off -
   * so the stretch is exactly what a flat canvas is missing, and nothing on
   * a canvas that is not flat. See INNER_RATIO.
   */
  get _viewStretch() {
    if (!this._innerOn) return 1;
    const c = this._canvas;
    if (!c?.h) return 1;
    return Math.max(1, c.w / c.h / INNER_RATIO);
  }

  /** Whether the pointer is standing over the canvas and its strip. */
  _pointerOverCanvas() {
    const p = this._lastClient;
    const pad = this.shadowRoot?.querySelector('.canvas-pad');
    if (!p || !pad) return false;
    const r = pad.getBoundingClientRect();
    return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  }

  /**
   * A pointer that moved. The position is kept rather than used and dropped,
   * because the edge scroll goes on working from it while the pointer stands
   * still.
   */
  _onMove(e) {
    this._ptr = { x: e.clientX, y: e.clientY };
    if (e.pointerType === 'touch' && this._touches.has(e.pointerId)) {
      this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pinch && this._touches.size >= 2) return this._pinchTo();
    }
    if (this._innerDrag) return this._innerTo();
    if (this._pan) return this._panTo();
    if (!this._band && !this._drag) return;
    this._track();
    this._edgeScroll();
  }

  /** What the gesture in progress makes of wherever the pointer now is. */
  _track() {
    if (this._band) return this._onBandMove();
    if (!this._drag) return;
    const p = this._ptr;
    if (!p) return;
    const c = this._canvas;
    const { rect, startX, startY, startScroll, origin, mode, idx } = this._drag;
    // The canvas moves under a scrolling view, so a pointer standing still is
    // over a different part of it than it was. Without this the element would
    // simply stop while the edge scroll carried the canvas out from under it.
    const view = this._view;
    const sx = view ? view.scrollLeft - startScroll.left : 0;
    const sy = view ? view.scrollTop - startScroll.top : 0;
    // Pointer pixels -> virtual units, so the maths never sees a pixel.
    const delta = {
      dx: (p.x - startX + sx) / rect.width * c.w,
      dy: (p.y - startY + sy) / rect.height * c.h,
    };
    if (this._lastDown && (Math.abs(p.x - startX + sx) > SAME_SPOT_PX
                        || Math.abs(p.y - startY + sy) > SAME_SPOT_PX)) {
      this._lastDown.moved = true;
    }
    if (this._drag.group) this._setEls(applyGroupDrag(c, this._drag.group, delta, origin.id));
    else this._setEl(idx, applyDrag(c, origin, mode, delta, this.slot));
  }

  /**
   * Scroll the view while a gesture is held against its edge.
   *
   * One frame loop, started by the first move that reaches a strip and ended
   * with the gesture. Each frame moves the view and then re-runs the gesture
   * against the pointer, so the element under the hand keeps up with the
   * canvas sliding beneath it.
   */
  _edgeScroll() {
    if (this._edgeFrame) return;
    const step = () => {
      this._edgeFrame = 0;
      const view = this._view;
      const p = this._ptr;
      if (!view || !p || (!this._drag && !this._band)) return;
      const r = view.getBoundingClientRect();
      // Scaled across the strip rather than clamped inside it: at a top speed
      // below the strip's own width a clamp would make the outer half of the
      // strip one flat speed, and the fine control is exactly there.
      const speed = deep => Math.min(EDGE_SPEED_MAX, deep / EDGE_STRIP_PX * EDGE_SPEED_MAX);
      const push = (near, far) => {
        if (near < EDGE_STRIP_PX) return -speed(EDGE_STRIP_PX - near);
        if (far < EDGE_STRIP_PX) return speed(EDGE_STRIP_PX - far);
        return 0;
      };
      const dx = push(p.x - r.left, r.right - p.x);
      const dy = push(p.y - r.top, r.bottom - p.y);
      if (dx || dy) {
        const was = { left: view.scrollLeft, top: view.scrollTop };
        view.scrollLeft += dx;
        view.scrollTop += dy;
        // At either end there is nothing left to scroll, and re-running the
        // gesture would only repeat the work of the last move.
        if (view.scrollLeft !== was.left || view.scrollTop !== was.top) this._track();
      }
      this._edgeFrame = requestAnimationFrame(step);
    };
    this._edgeFrame = requestAnimationFrame(step);
  }

  _stopEdgeScroll() {
    if (this._edgeFrame) cancelAnimationFrame(this._edgeFrame);
    this._edgeFrame = 0;
  }

  /**
   * Drag the view itself: the middle button, or space and the left one.
   *
   * A zoomed canvas is bigger than its window, and reaching the far corner by
   * scrollbar alone is the one thing the zoom made worse. Nothing about the
   * canvas changes here - this moves the window, not the drawing.
   */
  _startPan(e) {
    const view = this._view;
    if (!view) return;
    this._pan = { x: e.clientX, y: e.clientY, left: view.scrollLeft, top: view.scrollTop };
    this._ptr = { x: e.clientX, y: e.clientY };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no live pointer */ }
    e.preventDefault();
  }

  /**
   * Two fingers on the canvas: the one gesture a touchscreen has for zooming.
   *
   * A trackpad's pinch arrives as Ctrl and a wheel and is handled there, but a
   * touchscreen sends nothing of the sort - only two pointers - so the zoom
   * is the ratio of how far apart they are now to how far apart they started,
   * anchored between them. The drag the first finger had started is dropped:
   * `_dragCanvas` is where an uncommitted drag lives, so letting it go puts
   * the element back where the config still has it, and nothing is committed.
   */
  _startPinch() {
    const [a, b] = [...this._touches.values()];
    this._drag = null;
    this._band = null;
    this._dragCanvas = null;
    this._stopEdgeScroll();
    this._pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      zoom: this._zoom,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  _pinchTo() {
    const [a, b] = [...this._touches.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Two fingers that travel together move the view, the same as one finger
    // would - a pinch is nearly always a little of both.
    const view = this._view;
    if (view) {
      view.scrollLeft -= mid.x - this._pinch.mid.x;
      view.scrollTop -= mid.y - this._pinch.mid.y;
    }
    this._pinch.mid = mid;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    this._applyZoom(this._pinch.zoom * (dist / this._pinch.dist), mid);
  }

  _panTo() {
    const view = this._view;
    const p = this._ptr;
    if (!view || !p) return;
    view.scrollLeft = this._pan.left - (p.x - this._pan.x);
    view.scrollTop = this._pan.top - (p.y - this._pan.y);
  }

  /**
   * Draw the canvas at `z` times the size it fits its frame at.
   *
   * Whatever the zoom is aimed at stays where it is. A wheel or a pinch
   * names the point under the pointer, and the buttons name nothing, which
   * keeps the middle of the view - left alone, the scroll position is a
   * number of pixels, so zooming in would hold the top-left corner and walk
   * away from whatever was being looked at.
   *
   * @param {number} z
   * @param {{x: number, y: number} | null} [at] a point in client pixels
   */
  _applyZoom(z, at = null) {
    const view = this.shadowRoot?.querySelector('.canvas-view');
    // Where in the whole drawing the anchor sits, and where in the window it
    // is to stay. Both are read before the zoom and put back after it, which
    // is what keeps that one point still.
    let hold = null;
    if (view && view.scrollWidth && view.scrollHeight) {
      const r = view.getBoundingClientRect();
      const inX = at ? Math.max(0, Math.min(view.clientWidth, at.x - r.left)) : view.clientWidth / 2;
      const inY = at ? Math.max(0, Math.min(view.clientHeight, at.y - r.top)) : view.clientHeight / 2;
      hold = { inX, inY,
               x: (view.scrollLeft + inX) / view.scrollWidth,
               y: (view.scrollTop + inY) / view.scrollHeight };
    }
    this._zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    if (!hold) return;
    this.updateComplete.then(() => {
      view.scrollLeft = hold.x * view.scrollWidth - hold.inX;
      view.scrollTop = hold.y * view.scrollHeight - hold.inY;
    });
  }

  /**
   * Fill the window with what is selected.
   *
   * The window carries the canvas' own aspect ratio, stretched in height
   * where a gauge is being taken apart, so the zoom that fits a box is the
   * ratio of the canvas to that box in whichever axis is tighter - no pixels
   * in it, which is also why it is right before the canvas has been laid out
   * at the new zoom. The scroll that centres it needs the new layout, so it
   * waits for the render.
   *
   * `margin` is how much of the window is left as air around what is fitted,
   * and `atLeast` a floor the fit may not go under. The button uses both
   * defaults - air to see a selection in its surroundings, and no floor,
   * because shrinking to show the whole of something is the point there. The
   * way into a gauge uses neither: it fills the window, and never zooms out
   * of where it already was.
   *
   * @param {{atLeast?: number, margin?: number}} [opts]
   */
  _zoomToSelection({ atLeast = 0, margin = FIT_MARGIN } = {}) {
    const c = this._canvas;
    // What each one reaches, not what its box says: a surface with a side
    // bowed outward is drawn past its box, and the bow is the very thing
    // somebody zooming in on it has come to look at.
    const boxes = c.elements.filter(el => this._isSel(el.id)).map(el => this._elReach(el));
    if (!boxes.length) return;
    const x0 = Math.min(...boxes.map(b => b.x));
    const y0 = Math.min(...boxes.map(b => b.y));
    const x1 = Math.max(...boxes.map(b => b.x + b.w));
    const y1 = Math.max(...boxes.map(b => b.y + b.h));
    // The window's height is the canvas' own times the stretch, so the
    // vertical fit has that much more room than the shape alone says.
    const z = Math.max(atLeast,
                       margin * Math.min(c.w / Math.max(x1 - x0, 0.001),
                                         c.h * this._viewStretch / Math.max(y1 - y0, 0.001)));
    this._zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    const mid = { x: (x0 + x1) / 2 / c.w, y: (y0 + y1) / 2 / c.h };
    this.updateComplete.then(() => {
      const view = this._view;
      if (!view) return;
      view.scrollLeft = mid.x * view.scrollWidth - view.clientWidth / 2;
      view.scrollTop = mid.y * view.scrollHeight - view.clientHeight / 2;
    });
  }

  /**
   * The element whose own parts can be edited on the canvas: exactly one
   * selected, and of a kind that has parts. Two of them have no one frame
   * between them.
   *
   * `parts` and `rings` come off the kind so every call site asks the thing in
   * hand what it is made of, rather than one global map that only a gauge
   * could answer for.
   */
  get _innerTarget() {
    const sel = this._selection;
    if (sel.length !== 1) return null;
    const slot = this.slot || {};
    for (const [kind, k] of Object.entries(INNER_KINDS)) {
      const m = k.match.exec(sel[0]);
      if (!m) continue;
      const idx = Number(m[1]);
      const cfg = k.config(slot, sel[0], idx);
      if (!cfg) return null;
      return { id: sel[0], kind, k, idx, cfg, drawn: k.drawn(cfg),
               parts: k.parts || NO_PARTS, rings: k.rings || NO_PARTS };
    }
    return null;
  }

  /**
   * What the canvas has taken over from the form right now.
   *
   * The part in hand, and - for a kind whose corners are grips - the corners,
   * which are on the drawing for as long as it is open rather than only while
   * something is selected.
   */
  get _innerFramed() {
    const t = this._innerOn ? this._innerTarget : null;
    if (!t) return [];
    return [...(this._innerSel ? [this._innerSel] : []), ...(t.k.corners ? ['corners'] : [])];
  }

  /** The spec of the part in hand, whichever kind of element it belongs to. */
  get _selSpec() {
    const t = this._innerTarget;
    const part = this._innerSel;
    return (t && part) ? (t.parts[part] || t.rings[part] || null) : null;
  }

  /** Whether the frames are up for the element that is selected now. */
  get _innerOn() {
    const target = this._innerTarget;
    return !!target && this._inner === target.id;
  }

  _toggleInner() {
    const target = this._innerTarget;
    if (!target) return;
    const opening = !this._innerOn;
    // The button is the way out that means "take me back to where I was":
    // the zoom it brought is given back here, and nowhere else.
    if (!opening && this._zoomBefore != null) {
      const back = this._zoomBefore;
      this._zoomBefore = null;
      // Read here rather than on the way in, so the switch can be thrown while
      // an element is open and mean it.
      if (this._zoomBack && back !== this._zoom) this._applyZoom(back);
    }
    this._inner = this._innerOn ? null : target.id;
    this._innerRects = null;
    this._innerSel = null;
    this._innerEdit = null;
    this._innerLastDown = null;
    // The parts being framed are a couple of viewBox units across, and at the
    // zoom a whole canvas is arranged at they cannot be aimed at, let alone
    // dragged - so the gauge fills the window as it is opened, and the canvas
    // is handed back at the zoom it was left at. Only the way in is recorded
    // here; the way back out is in `updated`, because a gauge can also be
    // left by selecting something else, which never comes through here.
    if (opening) {
      this._zoomBefore = this._zoom;
      // Fill the window, and never out: the way in is only ever a way closer.
      // Not quite to the edge where the controls are on the edge - see
      // RIM_FILL.
      this._zoomToSelection({ atLeast: this._zoom,
                              margin: target.k.corners ? RIM_FILL : INNER_FILL });
    }
  }

  /**
   * Measure the parts of whatever is being edited, in per cent of its box.
   *
   * The kind does the measuring, because that is the one thing a gauge and a
   * box genuinely do differently. What is shared is here: bail when nothing is
   * open, and write the answer only when it is a different answer - this runs
   * after every render, and writing state that renders is how a measurement
   * becomes a loop.
   */
  _measureInner() {
    const target = this._innerOn ? this._innerTarget : null;
    const box = target && this.shadowRoot?.querySelector(`.el[data-item-id="${this._inner}"]`);
    const next = box ? target.k.measure(box, target.cfg) : null;
    if (!next) {
      if (this._innerRects) this._innerRects = null;
      return false;
    }
    if (this._innerEdit && next.parts[this._innerEdit]) {
      this._editRect = next.parts[this._innerEdit];
    }
    const was = this._innerRects;
    const same = was
      && Object.keys(next.parts).length === Object.keys(was.parts).length
      && ['l', 't', 'w', 'h'].every(f => Math.abs(was.svg[f] - next.svg[f]) < 0.05)
      && Math.abs(was.px.width - next.px.width) < 0.5
      && Math.abs(was.px.height - next.px.height) < 0.5
      && Math.abs(was.angle - next.angle) < 0.05
      && Object.entries(next.parts).every(([k, v]) => {
        const o = was.parts[k];
        return o && ['l', 't', 'w', 'h'].every(f => Math.abs(o[f] - v[f]) < 0.05)
          && Math.abs(o.pxPerUnit - v.pxPerUnit) < 0.01
          // The text too, and not only the box round it: a label that falls
          // back to the entity's name is offered as the placeholder of the
          // field it is typed in, and two names can be the same width.
          && o.text === v.text;
      });
    if (!same) this._innerRects = next;
    return !same;
  }

  /**
   * Keep measuring until the text has come to rest.
   *
   * One measurement after this editor's own render is a measurement of where
   * the text was: the gauge is a component of its own, and its update is a
   * microtask away when ours is finished - so a frame put back on the middle
   * axis would sit on the old spot until something else happened to re-render.
   * A few frames of following costs nothing while nothing moves and is right
   * whatever the gauge does in the meantime.
   */
  _followInner() {
    if (this._innerFrame || !this._innerOn) return;
    let still = 0;
    let wasAngle = null;
    const step = () => {
      this._innerFrame = 0;
      if (!this._innerOn) return;
      const moved = this._measureInner();
      // Exactly, not within a twentieth of a degree: the tail of the needle's
      // easing moves by less than that per frame, and a threshold there let
      // the loop call it still and stop with the frame a few degrees short of
      // the needle - which is the lag you could see.
      const angle = this._placeNeedle();
      const spun = angle !== null && angle !== wasAngle;
      wasAngle = angle;
      still = (moved || spun) ? 0 : still + 1;
      if (still < INNER_STILL_FRAMES) this._innerFrame = requestAnimationFrame(step);
    };
    this._innerFrame = requestAnimationFrame(step);
  }

  /**
   * Let go of whichever of a gauge's parts was in hand.
   *
   * A part is framed for as long as it is the one being set, and the frame is
   * also what hides its fields in the form - so there has to be a way out of
   * it that is not taking hold of a different part. Bare canvas is that way
   * out, inside the gauge as well as beside it.
   */
  _letGoOfPart() {
    if (this._innerSel) this._innerSel = null;
    if (this._innerEdit) this._innerEdit = null;
    if (this._innerAlso.length) this._innerAlso = [];
    // Nothing in hand is not a step in a walk down a stack of parts.
    this._innerLastDown = null;
  }

  /**
   * Every part being held, the one in hand first.
   *
   * Only the texts: `_innerAlso` is filled by a modifier press on a frame,
   * and a ring has no frame to press. Filtered against what is actually
   * drawn, so a part switched off while it was held stops being held.
   */
  get _innerHeld() {
    const target = this._innerTarget;
    if (!target) return [];
    const drawn = new Set(target.drawn);
    return [this._innerSel, ...this._innerAlso]
      .filter((p, i, all) => p && target.parts[p] && drawn.has(p) && all.indexOf(p) === i);
  }

  /** Whether this part is one of the ones being held. */
  _isHeld(part) {
    return this._innerSel === part || this._innerAlso.includes(part);
  }

  /**
   * Add a part to what is held, or take it back out.
   *
   * The one in hand stays the one in hand while others are added to it: it is
   * what the fold at the top of the form is showing, and pulling that out
   * from under the reader to no purpose is worse than the extra rule.
   */
  _toggleHeld(part) {
    const target = this._innerTarget;
    if (!target?.parts[part]) return;
    if (!this._innerSel) {
      this._innerSel = part;
      this._revealPart(part);
      return;
    }
    if (this._innerSel === part) {
      // Letting go of the one in hand promotes the next held part, so the
      // group does not silently lose its head.
      const [next, ...rest] = this._innerAlso;
      this._innerSel = next || null;
      this._innerAlso = next ? rest : [];
      return;
    }
    this._innerAlso = this._innerAlso.includes(part)
      ? this._innerAlso.filter(p => p !== part)
      : [...this._innerAlso, part];
    // As on the canvas: a press that changed what is held is not a step in a
    // walk down a stack.
    this._innerLastDown = null;
  }

  /**
   * Which of an element's parts lie under a pointer position, topmost first.
   *
   * The canvas has `_stackAt` for its elements and this is the same thing one
   * level down: geometry rather than the event's target, because a part the
   * press cannot reach is exactly what it has to find. The rects are the
   * measured ones the frames are drawn from, grown by the same slack the
   * frames are grabbed with, and later in the list draws on top - so reversed
   * is the order a click meets them.
   */
  _partStackAt(e) {
    const target = this._innerTarget;
    const box = this._innerBoxRect();
    const rects = this._innerRects?.parts;
    if (!target || !box || !rects) return [];
    const drawn = new Set(target.drawn);
    const hit = [];
    for (const part of Object.keys(target.parts)) {
      const r = drawn.has(part) ? rects[part] : null;
      if (!r) continue;
      const l = box.left + r.l / 100 * box.width - PART_GRAB_PX;
      const t = box.top + r.t / 100 * box.height - PART_GRAB_PX;
      const w = r.w / 100 * box.width + 2 * PART_GRAB_PX;
      const h = r.h / 100 * box.height + 2 * PART_GRAB_PX;
      if (e.clientX >= l && e.clientX <= l + w
          && e.clientY >= t && e.clientY <= t + h) hit.push(part);
    }
    return hit.reverse();
  }

  /**
   * One step down the stack of parts under the pointer.
   *
   * The walk the canvas does for its elements, done for the parts inside one:
   * a label lying entirely under the value can be taken hold of no other way,
   * and a person who has learned the gesture outside the element has no
   * reason to expect it to stop working inside it.
   *
   * On release rather than on the press, and never after a drag, for the
   * reasons `_onUp` gives for the canvas' own walk. Not while several parts
   * are held either: the walk replaces what is in hand, which is the opposite
   * of what holding several of them is for.
   */
  _walkParts(d) {
    const last = this._innerLastDown;
    if (!d || d.mode !== 'move' || d.started || !last?.same) return;
    if (this._innerAlso.length || last.stack.length < 2) return;
    const at = last.stack.indexOf(this._innerSel || '');
    const next = last.stack[(Math.max(at, 0) + 1) % last.stack.length];
    if (!next || next === this._innerSel) return;
    this._innerSel = next;
    this._revealPart(next);
  }

  /**
   * Pick up one of a gauge's parts.
   *
   * The snapshot is the first commit's, and every commit after it inside the
   * same gesture is kept off the stack the way an undo's own writes are -
   * dragging a label across the gauge is one thing done, not forty.
   */
  _innerDown(e, part, mode, end = null) {
    const target = this._innerTarget;
    if (!target) return;
    e.stopPropagation();
    e.preventDefault();
    // Shift, Ctrl or Cmd adds this part to what is held rather than replacing
    // it - the same modifier that picks a second element on the canvas - and
    // starts nothing: a press meant to pick a second part is not a drag.
    if ((mode === 'move' || mode === 'chip') && target.parts[part]
        && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      this._toggleHeld(part);
      return;
    }
    // A press on anything but a part's own frame ends whatever walk was
    // going on - a chip, a ring and a corner grip each name what they act on,
    // so there is nothing to walk down.
    if (mode !== 'move') this._innerLastDown = null;
    // A chip is grabbed as itself. It used to pass the press on to its ring,
    // so dragging one resized the thing it named - a lever on a part rather
    // than the part, which the ring's own band already is and does better.
    if (mode === 'chip') {
      const box = this._innerBoxRect();
      const chip = e.currentTarget.getBoundingClientRect();
      if (box) {
        // Measured off the chip rather than worked out again: it is drawn
        // about its own middle, so that middle is the very per cent being set.
        this._innerDrag = { part, mode, box, started: false,
                            startX: e.clientX, startY: e.clientY,
                            from: { l: (chip.left + chip.width / 2 - box.left) / box.width * 100,
                                    t: (chip.top + chip.height / 2 - box.top) / box.height * 100 } };
        this._ptr = { x: e.clientX, y: e.clientY };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no live pointer */ }
      }
      const fresh2 = this._innerSel !== part;
      // Not now: this press may yet become a drag of the chip, and anything
      // that scrolls while the finger is down moves the drawing out from
      // under it - the box this drag is measured against was read a line ago
      // and would be stale by the time the finger moved.
      if (fresh2) this._revealOnUp = part;
      // A press on the chip that is already in hand is the way back out: the
      // panel of numbers is put away on release, unless the press turned into
      // a drag, which is the chip being moved rather than pressed.
      if (this._innerDrag) this._innerDrag.held = !fresh2;
      this._innerSel = part;
      this._innerAlso = [];
      return;
    }
    // A corner grip belongs to the element rather than to any one part, so it
    // is taken hold of without taking anything else out of hand.
    if (mode === 'corner' || mode === 'side') {
      const spec = mode === 'side' ? target.k.sides : target.k.corners?.(target.cfg);
      const box = this._innerBoxRect();
      if (!spec || !box) return;
      this._innerDrag = { part: null, mode, end, spec, box, started: false };
      this._ptr = { x: e.clientX, y: e.clientY };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no live pointer */ }
      return;
    }
    // Pressing the same spot again keeps the part that is already in hand
    // there rather than jumping back to the top of the stack, so a part
    // clicked down to can still be dragged. The step itself is taken on
    // release, in `_walkParts`.
    if (mode === 'move') {
      const stack = this._partStackAt(e);
      const prev = this._innerLastDown;
      const same = !!prev && Math.abs(prev.x - e.clientX) <= SAME_SPOT_PX
                          && Math.abs(prev.y - e.clientY) <= SAME_SPOT_PX;
      this._innerLastDown = { x: e.clientX, y: e.clientY, same, stack };
      if (same && this._innerSel && stack.includes(this._innerSel)) part = this._innerSel;
    }
    // Read before the selection moves: what is held is the answer to the press
    // that is arriving, and `_innerHeld` puts whatever is in hand at its head.
    const held = this._innerHeld;
    const fresh = this._innerSel !== part;
    this._innerSel = part;
    // A ring is not one of the things that can be held together with a text,
    // so taking hold of one is letting go of them. A key that is in both
    // tables - a bar's label, framed on a straight bar and a chip on a ring -
    // is the part wherever there is one.
    if (!target.parts[part] && target.rings[part]) this._innerAlso = [];
    // After the assignment, never before: what the reveal has to scroll to is
    // the section the new selection has just pulled to the top of the editor.
    // On release, though, for the same reason a chip's is deferred.
    if (fresh) this._revealOnUp = part;
    // A ring is dragged in and out rather than about, so what the gesture
    // carries is the geometry it is measured against, not a pair of offsets.
    if (mode === 'ring' || mode === 'needle') {
      // A needle has no ring, so its chip names the part and nothing more -
      // the dragging is done by the handles on its two ends. Nor has a part
      // that stands at a spot of its own: a surface's paint is set from the
      // cluster under its chip and by the grips in the box's corners.
      const rspec = target.rings[part];
      if (mode === 'ring' && (rspec?.needle || rspec?.spot)) return;
      const geo = this._ringGeometry(part);
      if (!geo) return;
      // The needle's other end is taken once, here, and held for the whole
      // gesture: recomputing it from the config every move would feed each
      // rounding back into the next one, and the end nobody is touching would
      // creep away under the hand.
      const cfg = target.cfg;
      const from = mode === 'needle'
        ? { offset: SC.safeFloat(cfg.pointer_offset, 2),
            length: SC.safeFloat(cfg.pointer_length, 10) }
        : null;
      // Where along the line the hand took hold of it. An end handle is a
      // point and is simply dragged to the pointer; the line is grabbed
      // anywhere along its length, so what it follows is the travel from
      // here rather than the pointer's own radius.
      const at0 = end === 'line'
        ? this._needleRadius({ x: e.clientX, y: e.clientY }, geo) : 0;
      this._innerDrag = { part, mode, end, from, at0, ...geo,
                          startX: e.clientX, startY: e.clientY, started: false };
      // An end handle, not the line: the crosshair says where one point is
      // being put, and the line is dragged as a whole.
      this._crossEnd = (mode === 'needle' && end !== 'line') ? end : null;
      this._ptr = { x: e.clientX, y: e.clientY };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no live pointer */ }
      return;
    }
    const spec = target.parts[part];
    const cfg = target.cfg;
    // Pressing something already held drags the whole group; pressing
    // anything else is a fresh single selection, and the rest is let go of.
    const group = mode === 'move' && held.length > 1 && held.includes(part)
      ? held.map((p) => {
          const ps = target.parts[p];
          return { part: p, spec: ps,
                   from: { x: SC.safeFloat(cfg[ps.x], ps.dx),
                           y: SC.safeFloat(cfg[ps.y], ps.dy) },
                   pxPerUnit: this._innerRects?.parts?.[p]?.pxPerUnit || 1 };
        })
      : null;
    // Pressing a part that was held alongside makes it the one in hand and
    // leaves the rest held - without this the group would keep a second copy
    // of its own head, and letting go of that head would promote it again.
    if (group) this._innerAlso = held.filter(p => p !== part);
    else this._innerAlso = [];
    this._innerDrag = {
      part, mode, group,
      startX: e.clientX, startY: e.clientY,
      from: {
        x: SC.safeFloat(cfg[spec.x], spec.dx),
        y: SC.safeFloat(cfg[spec.y], spec.dy),
        size: SC.safeFloat(cfg[spec.size], spec.dsize),
      },
      pxPerUnit: this._innerRects?.parts?.[part]?.pxPerUnit || 1,
      scale: partScaleOf(target),
      started: false,
    };
    this._ptr = { x: e.clientX, y: e.clientY };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no live pointer */ }
  }

  /**
   * How far out along the needle's own line a point stands, in viewBox units.
   *
   * Signed, not a distance: a distance would fold the far side of the pivot
   * back onto the near one, and the far side is exactly where a tail is
   * dragged to. Measured against the angle the needle is drawn at this
   * instant rather than the one the config asks for, because mid-animation
   * those are two different numbers.
   *
   * @param {{x: number, y: number}} p the point, in screen pixels
   * @param {any} geo the gesture's geometry - centre and pixels per unit
   */
  _needleRadius(p, geo) {
    const ang = (this._innerRects?.angle ?? 0) * Math.PI / 180;
    return ((p.x - geo.cx) * Math.cos(ang) + (p.y - geo.cy) * Math.sin(ang)) / geo.pxPerUnit;
  }

  /**
   * Lay the needle's frame back over the needle, straight onto the DOM.
   *
   * The angle is read at the last possible moment and written to the nodes
   * without going through a render, because a render is a frame late: the
   * needle is composited by the browser while the config that describes it
   * has not changed, so anything drawn from state trails visibly behind it.
   * Called from `updated` and from every frame of the follow loop, which is
   * alive for as long as the needle is moving. Answers the angle it used, or
   * null when there was no needle to read - which is what tells that loop
   * whether anything is still turning.
   */
  _placeNeedle() {
    const root = this.shadowRoot;
    const lines = root?.querySelectorAll('.needle-line');
    const line = lines && lines[0];
    const cfg = this._innerTarget?.cfg;
    const svgBox = this._innerRects?.svg;
    if (!line || !cfg || !svgBox) return null;
    const gauge = root.querySelector(`.el[data-item-id="${this._inner}"] sc-gauge`);
    const a = needleAngle(gauge?.shadowRoot?.querySelector('[data-sc-needle]')) * Math.PI / 180;
    const scale = gaugeScaleOf(cfg) || 1;
    const ring = ringRadius(SC.safeFloat(cfg.stroke_width, 3), scale, frameBand(cfg, scale));
    const cx = GAUGE_VIEW / 2;
    const cy = cx;
    const ends = needleEnds(SC.safeFloat(cfg.pointer_offset, 2),
                            SC.safeFloat(cfg.pointer_length, 10), ring, scale);
    const on = (/** @type {number} */ r) =>
      ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    const at = { tip: on(ends.tip), tail: on(ends.tail) };
    lines.forEach((/** @type {any} */ n) => {
      n.setAttribute('x1', String(at.tail.x));
      n.setAttribute('y1', String(at.tail.y));
      n.setAttribute('x2', String(at.tip.x));
      n.setAttribute('y2', String(at.tip.y));
    });
    root.querySelectorAll('.grip-layer [data-end]').forEach((/** @type {any} */ n) => {
      const p = at[n.dataset.end];
      if (!p) return;
      // The crosshair's two lines are moved the same way the handle they
      // cross at is, and each only along the axis it is not drawn on.
      if (n.dataset.axis) {
        if (n.dataset.axis === 'x') {
          n.setAttribute('x1', String(p.x));
          n.setAttribute('x2', String(p.x));
        } else {
          n.setAttribute('y1', String(p.y));
          n.setAttribute('y2', String(p.y));
        }
        return;
      }
      n.setAttribute('cx', String(p.x));
      n.setAttribute('cy', String(p.y));
    });
    // The chip rides beside the line's middle, so it moves with it. Its panel
    // does not: the panel is placed against the centre line, on the side the
    // needle is not, and following the needle is exactly what would put it
    // back on top of it.
    const mid = { x: (at.tail.x + at.tip.x) / 2 - 4 * Math.sin(a),
                  y: (at.tail.y + at.tip.y) / 2 + 4 * Math.cos(a) };
    const l = Math.max(2, Math.min(98, svgBox.l + svgBox.w * mid.x / GAUGE_VIEW));
    const t = Math.max(2, Math.min(98, svgBox.t + svgBox.h * mid.y / GAUGE_VIEW));
    // Unless it has been put somewhere by hand, in which case that is where it
    // stays - a chip moved out of the way is no use if the needle keeps
    // fetching it back.
    if (!chipPlace.has(chipKey(this._inner, 'pointer'))) {
      root.querySelectorAll('.ring-tag[data-part="pointer"]')
        .forEach((/** @type {any} */ n) => { n.style.left = l + '%'; n.style.top = t + '%'; });
    }
    return a;
  }

  /** Where the part is now that the pointer has moved. */
  _innerTo() {
    const d = this._innerDrag;
    const p = this._ptr;
    if (!d || !p) return;
    if (d.mode === 'chip') {
      const at = (/** @type {number} */ v) => Math.max(2, Math.min(98, v));
      chipPlace.set(chipKey(this._inner, d.part), {
        l: at(d.from.l + (p.x - d.startX) / d.box.width * 100),
        t: at(d.from.t + (p.y - d.startY) / d.box.height * 100),
      });
      // A chip writes no config, so this flag is not the undo coalescing it is
      // everywhere else here - it is what says the gesture was a drag. Letting
      // go of a chip that has been moved must not be read as the second press
      // that puts its panel away, or the panel closes every time the chip is
      // put somewhere else. Past a few pixels, because a press with a shaking
      // hand is still a press.
      if (!d.started && Math.hypot(p.x - d.startX, p.y - d.startY) > CHIP_DRAG_SLOP) {
        d.started = true;
      }
      this.requestUpdate();
      return;
    }
    if (d.mode === 'side') {
      const bend = bendFromGrip(p, d.box, d.end);
      this._writeInner({ [bendKey(d.end)]: bend.bow, [bendAtKey(d.end)]: bend.at },
                       d.started);
      d.started = true;
      return;
    }
    if (d.mode === 'corner') {
      this._writeInner(d.spec.patch(radiusFromGrip(p, d.box, d.end, d.spec.unit)),
                       d.started);
      d.started = true;
      return;
    }
    if (d.mode === 'needle') {
      const at = this._needleRadius(p, d);
      if (d.end === 'line') {
        // The line is also what a press selects the pointer by, so a hand
        // that shook while pressing must not nudge the needle. Past a few
        // pixels it is a drag and stays one.
        if (!d.started && Math.hypot(p.x - d.startX, p.y - d.startY) <= CHIP_DRAG_SLOP) return;
        this._writeInner(needleSlide(at, d.at0, d.from.offset, d.scale), d.started);
      } else {
        this._writeInner(needleFromRadius(d.end, at, d.from.offset, d.from.length,
                                          d.ring, d.scale), d.started);
      }
      d.started = true;
      return;
    }
    if (d.mode === 'ring') {
      const spec = this._innerTarget?.rings[d.part];
      if (!spec) return;
      const dist = Math.hypot(p.x - d.cx, p.y - d.cy) / d.pxPerUnit;
      const cfg = this._innerTarget?.cfg || {};
      this._writeInner(ringPartPatch(spec, dist, cfg, d.ring, d.scale, d.end), d.started);
      d.started = true;
      return;
    }
    const spec = this._innerTarget?.parts[d.part];
    if (!spec) return;
    const patch = d.mode === 'size'
      ? { [spec.size]: fontFromResize(d.from.size, p.y - d.startY, d.pxPerUnit,
                                      d.scale, spec.sizeMin, spec.sizeMax) }
      : (() => {
          // Every held part travels the same distance on the screen, which is
          // not the same number of units each: a part is measured in its own
          // layer, and a layer is free to be scaled differently from the one
          // beside it. So the pixels are shared and the arithmetic is not.
          const movers = d.group || [{ part: d.part, spec, from: d.from, pxPerUnit: d.pxPerUnit }];
          const out = {};
          const px = this._innerRects?.px;
          for (const m of movers) {
            const per = (m.pxPerUnit || 1) * (d.scale || 1);
            const at = offsetsFromDrag(m.from, p.x - d.startX, p.y - d.startY,
                                       m.pxPerUnit, d.scale,
                                       m.spec.limit && px
                                         ? m.spec.limit(px, per) : undefined);
            out[m.spec.x] = at.x;
            out[m.spec.y] = at.y;
          }
          return out;
        })();
    this._writeInner(patch, d.started);
    d.started = true;
  }

  /**
   * Switch a gauge's label or value on or off from the canvas.
   *
   * The same key the switch in the form writes, so the two are one setting
   * seen from two places rather than two settings that have to agree.
   */
  _setInnerPart(part, on) {
    const target = this._innerTarget;
    const spec = target?.parts[part];
    if (!target || !spec) return;
    if (on) {
      // A part just switched on is the one about to be placed, so it arrives
      // in hand: frame live, fold at the top, sliders stepped aside.
      this._innerSel = part;
      this._revealPart(part);
    } else if (this._innerSel === part) {
      // A part that is no longer drawn cannot stay the one in hand, or its
      // sliders would stay hidden behind a frame that is not there.
      this._innerSel = null;
    }
    const patch = { [spec.active]: on, ...(on ? partSeed(spec, target.cfg) : null) };
    this._writeInner(patch, false);
  }

  /**
   * Switch a ring of ticks, sub-ticks or tick labels on or off.
   *
   * None of the three has a switch of its own, so this writes whatever makes
   * the ring exist - and whatever it stands on. Switching sub-ticks or labels
   * on a gauge that has no ticks yet brings ticks with them, because both are
   * drawn between or beside ticks and neither would appear on its own.
   */
  _setInnerRing(part, on) {
    const target = this._innerTarget;
    const spec = target?.rings[part];
    if (!target || !spec) return;
    if (on) {
      this._innerSel = part;
      this._revealPart(part);
    } else if (this._innerSel === part) {
      this._innerSel = null;
    }
    const patch = { ...((on ? spec.turnOn : spec.turnOff) || {}) };
    // The seed only where the card says nothing: a gauge that already has 21
    // ticks keeps them when its labels are switched on.
    if (on) for (const [k, v] of Object.entries(spec.seed || {})) {
      if (target.cfg[k] === undefined) patch[k] = v;
    }
    this._writeInner(patch, false);
  }

  /**
   * Add to or take from one of the numbers offered under the chip of whichever
   * ring is in hand - a tick count, how long a mark is, how thick.
   *
   * One press is one step and one undo step, which is what separates it from
   * the ring drag beside it.
   */
  _stepRing(st, dir) {
    const target = this._innerTarget;
    if (!target || !st) return;
    const held = st.unit ? splitUnit(target.cfg[st.key], st.dflt) : null;
    const was = held ? held.n : SC.safeFloat(target.cfg[st.key], st.dflt);
    const next = Math.min(st.max, Math.max(st.min, Math.round((was + dir * st.by) * 10) / 10));
    if (next === was) return;
    this._writeInner({ [st.key]: held ? next + held.unit : next }, false);
  }

  /**
   * What a surface looks like on the canvas: the colour and the corner its own
   * pattern paints it with.
   *
   * A surface draws nothing, so the live preview has nothing to hand back for
   * one and the box stayed an empty amber outline - which is no way to set a
   * colour or round a corner, because neither could be seen. The pattern is
   * the drawing here, so the box wears it.
   *
   * Only with the live preview on, the same as every other drawing: with it
   * off the canvas is deliberately a plan of boxes rather than a picture.
   */
  _surfaceSkin(el) {
    if (!el?.surface || !this._live) return '';
    const pat = patternFor(patternList(this.slot), 'elm_' + el.id);
    if (!pat || pat.enabled === false) return '';
    const bg = patternPreviewCss(pat);
    if (!bg) return '';
    const bends = bendsOf(pat);
    const clip = bendClipPath(bends);
    // A layer inside the box rather than the box itself: the pattern's own
    // opacity belongs to the paint, and setting it on the box would take the
    // chips and the grips standing on it down with it.
    //
    // Bent, the layer is grown by the room a bow may need and the clip path
    // hands all of it back but the shape - a clip can only take paint away,
    // so a side bowing outward has to have paint out there to keep.
    return html`<div class="surface-skin"
      style="background:${bg}; opacity:${(pat.opacity ?? 100) / 100};
             border-radius:${patternRadiusCss(pat) || 'inherit'};
             ${clip ? `inset:-${BEND_ROOM}%; clip-path:${clip};` : ''}"></div>`;
  }

  /**
   * Whether an element is bowed outward anywhere, and so has to be let out of
   * its own box.
   */
  _bentEl(el) {
    if (!el?.surface) return false;
    return bendEscapes(this._bendsOf(el));
  }

  /** How the sides of an element are bowed, flat for everything but a surface. */
  _bendsOf(el) {
    return bendsOf(el?.surface
      ? patternFor(patternList(this.slot), 'elm_' + el.id) : null);
  }

  /**
   * The canvas box an element actually reaches, bow and all.
   *
   * The box is still the box - it is what is dragged, what is resized and
   * what everything lines up on. This is only for the two questions that ask
   * where the drawing *ends*: what the editing zoom has to fit, and where the
   * outline goes.
   */
  _elReach(el) {
    return bentBox(el, this._bendsOf(el));
  }

  /**
   * The outline of a bent surface, drawn on the edge the paint actually has.
   *
   * A clip path cannot be stroked, so the box's own dashed rectangle stayed
   * straight while the paint bowed out past it - and a straight line round a
   * bent shape is read as the shape. The polygon is laid over the same grown
   * layer the clip works in, at a `0 0 100 100` viewBox with no aspect ratio
   * to preserve, so one set of per cents describes both. The stroke does not
   * scale with it, or a wide box would draw a dash four times the length of
   * the one above it.
   */
  _bentOutline(el) {
    const bends = this._bendsOf(el);
    if (!isBent(bends)) return '';
    const pts = bendOutlineSvg(bends);
    // The width and the height as well as the inset, and both of them
    // spelled out: an `svg` is a replaced element, so four offsets alone
    // over-constrain it and the browser keeps its intrinsic 1:1 box instead
    // - which on a wide surface is a square outline hanging a long way below
    // the thing it is meant to be drawn round.
    const grown = 100 + 2 * BEND_ROOM;
    return html`<svg class="el-outline" viewBox="0 0 100 100" preserveAspectRatio="none"
      style="inset:-${BEND_ROOM}%; width:${grown}%; height:${grown}%;"><polygon points=${pts}
      vector-effect="non-scaling-stroke"></polygon></svg>`;
  }

  /** The box of the element being edited, on the screen. */
  _innerBoxRect() {
    const box = this.shadowRoot?.querySelector(`.el[data-item-id="${this._inner}"]`);
    const r = box?.getBoundingClientRect();
    return r?.width ? r : null;
  }

  /**
   * The ring a part stands on, and where the gauge's centre is on the screen.
   *
   * Measured rather than worked out from the element's box: the 50x50 viewBox
   * letterboxes inside a box of any shape, and the SVG's own rect is the one
   * thing that knows where it landed and how big a viewBox unit came out.
   */
  _ringGeometry(part) {
    const box = this.shadowRoot?.querySelector(`.el[data-item-id="${this._inner}"]`);
    const svg = box?.querySelector('sc-gauge')?.shadowRoot?.querySelector('svg');
    const r = svg?.getBoundingClientRect();
    if (!r?.width) return null;
    const cfg = this._innerTarget?.cfg || {};
    const scale = gaugeScaleOf(cfg) || 1;
    const pxPerUnit = r.width / GAUGE_VIEW;
    return {
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      pxPerUnit, scale,
      ring: ringRadius(SC.safeFloat(cfg.stroke_width, 3), scale, frameBand(cfg, scale)),
    };
  }




  /**
   * Bring the settings that belong to the part just taken hold of up to where
   * they can be read.
   *
   * The frames are for the rough placing; the numbers beside them are for the
   * rest, and those sat eight folds down the dialog. Rather than scroll the
   * canvas off the screen to reach them - and a frame that cannot be seen
   * cannot be dragged - the gauge editor is asked to put that one section at
   * the top of its list for as long as the part is in hand, which leaves the
   * two things within sight of each other. All this has left to do is make
   * sure the settings are unfolded at all, and nudge them into view if the
   * dialog happens to be scrolled past them.
   */
  async _revealPart(part) {
    const t = this._innerTarget;
    const section = t && (t.parts[part] || t.rings[part])?.section;
    if (!section || !t.k.editor) return;
    this._configOpen = true;
    await this.updateComplete;
    const editor = /** @type {any} */ (
      this.shadowRoot?.querySelector('.el-config ' + t.k.editor));
    if (!editor) return;
    await editor.updateComplete;
    const fold = /** @type {any} */ (editor.shadowRoot?.querySelector(`details[data-section="${section}"]`));
    if (!fold) return;
    // The heading, not the whole fold: it is the shortest thing that proves
    // the settings are there, so the dialog moves as little as it can and the
    // canvas keeps as much of the screen as it can.
    //
    // Worked out rather than handed to `scrollIntoView`, which scrolls every
    // scrollable ancestor: in the config dialog the nearest one holds the
    // canvas too, so the nudge used to take the drawing off the screen. On a
    // touchscreen that was the whole of what a tap on a chip appeared to do.
    const head = fold.querySelector('summary') || fold;
    const view = scrollParent(head);
    if (!view) return;
    // What may not be scrolled away is the element being worked on, not the
    // whole canvas: its frames and its chips are what the next gesture aims
    // at, and one with an edge off the screen cannot be dragged by that edge.
    const dy = revealBy(head.getBoundingClientRect(), view.getBoundingClientRect(),
                        this._innerBoxRect());
    if (dy) view.scrollBy({ top: dy, behavior: 'smooth' });
  }

  /**
   * Put the part that is in hand back on the gauge's middle axis.
   *
   * The same two buttons that line elements up, because it is the same thing
   * asked of something smaller: a gauge is drawn about its centre, so an
   * offset of zero *is* the middle, and no measuring is needed to find it.
   */
  _innerAlign(axis) {
    const target = this._innerTarget;
    const held = this._innerHeld;
    if (!target || !held.length) return;
    const patch = {};
    for (const part of held) {
      const spec = target.parts[part];
      if (spec) patch[axis === 'x' ? spec.x : spec.y] = 0;
    }
    if (Object.keys(patch).length) this._writeInner(patch, false);
  }

  /**
   * Line the held parts up on one of their own edges.
   *
   * The arithmetic is `alignParts`, off the measured boxes - a part's offset
   * places its anchor, and two parts' anchors are not the same point on their
   * boxes, so the offsets alone cannot say where an edge is. The boxes are
   * measured in per cent of the element, and a travel in per cent is a travel
   * in pixels once the element's own size is known.
   *
   * @param {'left'|'right'|'top'|'bottom'} edge
   */
  _innerAlignEdge(edge) {
    const target = this._innerTarget;
    const rects = this._innerRects;
    if (!target || !rects?.px) return;
    const scale = partScaleOf(target);
    const items = this._innerHeld.map((part) => {
      const spec = target.parts[part];
      const r = rects.parts?.[part];
      if (!spec || !r) return null;
      return {
        keys: { x: spec.x, y: spec.y },
        box: { l: r.l / 100 * rects.px.width, t: r.t / 100 * rects.px.height,
               w: r.w / 100 * rects.px.width, h: r.h / 100 * rects.px.height },
        from: { x: SC.safeFloat(target.cfg[spec.x], spec.dx),
                y: SC.safeFloat(target.cfg[spec.y], spec.dy) },
        per: (r.pxPerUnit || 1) * scale,
      };
    }).filter(Boolean);
    const patch = alignParts(/** @type {any} */ (items), edge);
    if (patch) this._writeInner(patch, false);
  }

  /**
   * Write fields onto whatever is being edited, wherever that kind keeps them.
   * `quiet` keeps the write off the undo stack, which is what makes a whole
   * drag one step rather than one per frame.
   */
  /**
   * Which part this element should be showing as the one in hand.
   *
   * The renderer is told by name, on the host, because a stylesheet cannot
   * reach into another element's shadow root and the part is drawn in there.
   * `nothing` and not an empty string: an absent attribute is what the
   * renderer's rules are written against, and an empty one would still match.
   *
   * Nothing is shown for a few seconds after the part's colour was set. A
   * highlight over the colour being chosen is a highlight in the way, so the
   * drawing answers the colour picker plainly first and starts pulsing again
   * once the hand has moved on.
   *
   * @param {string} id
   */
  _hlPart(id) {
    if (!this._hl || !this._innerOn || this._inner !== id) return nothing;
    if (this._hlHold > Date.now()) return nothing;
    return this._hlNarrow || this._innerSel || nothing;
  }

  /**
   * Show one mark rather than the chip's whole part, while a row is held.
   *
   * A chip stands for a part, and for most parts that is one mark. The
   * bar's pill is not one of them: the line under it is switched on with it
   * and set from the same menu, so setting the line's thickness pulsed the
   * pill as well - the one thing on the drawing that was not changing. A row
   * that names a mark takes the pulse for itself until the hand lets go.
   *
   * On the window rather than the control: a slider let go of outside its
   * own thumb - which is most of them - fires nothing the control hears.
   *
   * @param {string|undefined} part
   */
  _narrowHl(part) {
    if (!part) return;
    this._hlNarrowOff?.();
    this._hlNarrow = part;
    const off = () => {
      this._hlNarrow = null;
      this._hlNarrowOff = null;
      window.removeEventListener('pointerup', off);
      window.removeEventListener('pointercancel', off);
    };
    this._hlNarrowOff = off;
    window.addEventListener('pointerup', off);
    window.addEventListener('pointercancel', off);
  }

  /**
   * The ink that part is lent while it is in hand.
   *
   * Contrast against what the part is drawn *on*: a yellow tick is
   * unmissable on a dark dial and gone on a pale one. A gauge that paints
   * its own background is read from that, everything else from the card's,
   * because that is what is behind the drawing.
   *
   * Handed over as a custom property, which is the one thing that does cross
   * into a shadow root, and only while the part is actually in hand - the
   * same answer as `_hlPart`, so the ink and the pulse arrive and leave
   * together and a colour just chosen is shown plain.
   *
   * @param {string} id
   * @param {any} [cfg] the element's own config, where it has a background
   */
  _hlStyle(id, cfg) {
    if (this._hlPart(id) === nothing) return nothing;
    const mode = cfg && cfg.bg_mode;
    const own = mode && mode !== 'none' ? cfg.bg_color1 : null;
    const back = SC.toRgb(own ?? 'var(--card-background-color)', { resolveVars: true })
              || SC.toRgb('var(--ha-card-background)', { resolveVars: true });
    return `--sc-hl-ink:${highlightInk(back || null)};`;
  }

  /**
   * Put the highlight away, because a colour is being chosen.
   *
   * The drawing has to answer the colour picker and nothing else while one
   * is open: a pulse over the very mark being coloured, in an ink that is
   * not the one being picked, is the worst possible thing to judge a colour
   * against. So both go, and come back once the hand has moved on.
   *
   * Nothing else looks at the clock, so the canvas has to be told when the
   * hold is over - `_hlHold` is state, and setting it back to zero is what
   * brings the pulse and the ink with it.
   */
  _holdHighlight() {
    this._hlHold = Date.now() + HL_HOLD_MS;
    clearTimeout(this._hlTimer);
    this._hlTimer = setTimeout(() => { this._hlHold = 0; }, HL_HOLD_MS);
  }

  _writeInner(patch, quiet) {
    // A colour being chosen is the one thing the highlight must not sit on
    // top of, so writing one puts it away for a while.
    if (Object.keys(patch || {}).some(k => /colou?r$/.test(k))) this._holdHighlight();
    const t = this._innerTarget;
    const out = t && t.k.write(this.slot || {}, t, patch);
    if (!out) return;
    const was = this._travelling;
    if (quiet) this._travelling = true;
    try {
      this._send(out.key, out.value);
    } finally {
      this._travelling = was;
    }
  }

  /**
   * The frames over the drawn label and value.
   *
   * Drawn from the measured rects rather than from the offsets, so a frame
   * sits on the text even where the gauge's own scale, its letterboxing or a
   * long value have put it somewhere the numbers alone do not say. A little
   * room is added around each one: the text rect of a single digit is too
   * small a thing to take hold of.
   */
  _renderInner() {
    const target = this._innerTarget;
    if (!target) return '';
    const drawn = new Set(target.drawn);
    const rects = this._innerRects?.parts;
    // A press must not reach the element under it, or reaching for one of
    // these would start dragging the whole gauge.
    const swallow = (/** @type {any} */ e) => { e.stopPropagation(); e.preventDefault(); };
    return html`${Object.entries(target.parts).map(([part, spec]) => {
      const editing = this._innerEdit === part;
      // The last measurement while the text is being typed into: see
      // `_editRect`. Only then - a part switched off has no frame, and one
      // left over from a part that was is worse than none.
      const r = rects?.[part] || (editing ? this._editRect : null);
      if ((!drawn.has(part) && !editing) || !r) return '';
      return html`
        <div class="inner-frame ${this._isHeld(part) ? 'sel' : ''}" data-part=${part}
             style="left:${r.l}%; top:${r.t}%; width:${r.w}%; height:${r.h}%;"
             title=${`Drag the ${spec.label.toLowerCase()}, or its corner to resize it`}
             @pointerdown=${(/** @type {any} */ e) => this._innerDown(e, part, 'move')}>
          <span class="inner-tag">
            ${spec.label}
            ${spec.weight && this._innerSel === part
              ? this._renderSwap(spec.label, spec.weight, 'Set') : ''}
            ${spec.text && this._innerSel === part ? html`
              <button class="chip-btn write ${editing ? 'on' : ''}"
                      title=${editing ? 'Done' : `Type the ${spec.label.toLowerCase()}`}
                      @pointerdown=${swallow}
                      @click=${() => this._editText(part, !editing)}>${icon('pencil')}</button>` : ''}
            <button class="chip-btn drop"
                    title=${`Hide the ${spec.label.toLowerCase()} on this ${target.k.noun}`}
                    @pointerdown=${swallow}
                    @click=${() => this._setInnerPart(part, false)}>${icon('trash-2')}</button>
          </span>
          <!-- \`value\`, the attribute, and not the \`.value\` property: every
               keystroke is written through to the card, and the card comes
               back a render later. Reassigning the property would put back
               what is already there and send the caret to the end of it,
               where the attribute is only the starting value and the browser
               leaves a field somebody has typed in alone. -->
          ${editing ? html`
            <input class="inner-text" type="text" data-edit=${part}
                   value=${target.cfg[spec.text] ?? ''}
                   placeholder=${(target.cfg[spec.text] ? '' : r.text) || spec.label}
                   @pointerdown=${(/** @type {any} */ e) => e.stopPropagation()}
                   @input=${(/** @type {any} */ e) => this._typeText(spec, e.target.value)}
                   @keydown=${(/** @type {any} */ e) => this._typeKey(e, spec)}
                   @blur=${() => this._editText(part, false)}>` : ''}
          <div class="inner-grip"
               @pointerdown=${(/** @type {any} */ e) => this._innerDown(e, part, 'size')}></div>
        </div>
        ${this._innerSel === part
          ? this._renderSteppers(r.l + r.w / 2, r.t + r.h) : ''}`;
    })}
    ${this._renderCorners()}
    ${this._renderSides()}
    ${this._renderRings(swallow)}
    ${this._renderOffers(swallow)}`;
  }

  /**
   * Open or close the field a part's own text is typed into.
   *
   * In the frame rather than in a row of the form, because what a label says
   * and where it stands are one thought: reading it in place is how you know
   * the name fits the space it has. The form keeps the field too - the canvas
   * is not the only way in, and a card being written by hand has no frames.
   *
   * @param {string} part @param {boolean} on
   */
  async _editText(part, on) {
    if (!on) {
      if (this._innerEdit === part) this._innerEdit = null;
      this._editFrom = null;
      return;
    }
    const spec = this._innerTarget?.parts[part];
    if (!spec?.text) return;
    this._editFrom = this._innerTarget?.cfg[spec.text] ?? '';
    this._typed = false;
    this._editRect = this._innerRects?.parts?.[part] || null;
    this._innerEdit = part;
    // After the field exists, not before: it is drawn by the render this
    // assignment asks for.
    await this.updateComplete;
    const box = this.shadowRoot?.querySelector(`.inner-text[data-edit="${part}"]`);
    /** @type {any} */ (box)?.select?.();
  }

  /**
   * One keystroke of it, written straight through to the card.
   *
   * Live, so the drawing answers as it is typed - which is the whole point of
   * typing it here. Quiet after the first, so the edit is one step to undo
   * rather than one per letter.
   */
  _typeText(spec, value) {
    this._writeInner({ [spec.text]: value }, this._typed);
    this._typed = true;
  }

  /** Enter to be done with it, Escape to put back what was there. */
  _typeKey(e, spec) {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); return; }
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (this._editFrom !== null) this._writeInner({ [spec.text]: this._editFrom }, true);
    e.target.blur();
  }

  /**
   * The offers to switch on what this element is not drawing yet, in a column
   * down each side of it.
   *
   * Each used to stand where its part would appear - on its own ring, or on
   * the spot the text would take - so that the press both switched the thing
   * on and said where it was about to show up. It reads well with one offer
   * out and badly with four: a gauge drawing none of them put a button on
   * every ring and two more over the middle, and they landed on each other,
   * on the chips of the parts that *were* drawn, and across the drawing the
   * whole editor is there to let you see.
   *
   * So they stand at the sides instead, where a round drawing in a square box
   * leaves the room. Where a part appears is answered by the part appearing -
   * it arrives in hand, framed, with its numbers open - and the offers stop
   * competing with the drawing for the same space. A column also means they
   * cannot land on each other, which the dodging had been asked to sort out
   * one collision at a time.
   *
   * Parts down one side and rings down the other, in the order their tables
   * are written. How they are switched on is nothing a person reading a row
   * of buttons cares about, but which of them are texts on the face and which
   * are rings around it is, and one list mixing the two reads as an arbitrary
   * one. A kind with only parts simply has an empty right-hand side.
   *
   * @param {(e: any) => void} swallow
   */
  _renderOffers(swallow) {
    const target = this._innerTarget;
    if (!target) return '';
    const drawn = new Set(target.drawn);
    const groups = [
      {
        side: 'left',
        offers: Object.entries(target.parts)
          .filter(([part, spec]) => partCan(spec, target.cfg) && !drawn.has(part))
          .map(([part, spec]) => ({ spec, on: () => this._setInnerPart(part, true) })),
      },
      {
        side: 'right',
        offers: Object.entries(target.rings)
          .filter(([, spec]) => partCan(spec, target.cfg) && !spec.on(target.cfg))
          .map(([part, spec]) => ({ spec, on: () => this._setInnerRing(part, true) })),
      },
    ].filter((group) => group.offers.length);
    if (!groups.length) return '';
    return html`
      ${groups.map(({ side, offers }) => html`
        <div class="inner-adds ${side}">
          ${offers.map(({ spec, on }) => html`
            <button class="inner-add"
                    title=${`Show ${spec.label.toLowerCase()} on this ${target.k.noun}`}
                    @pointerdown=${swallow}
                    @click=${on}>+ ${spec.label}</button>`)}
        </div>`)}`;
  }

  /**
   * The ring frames, the needle's two handles, and the chip on each that names
   * it and takes it off.
   *
   * One SVG over the gauge's own square, in the gauge's own viewBox, so a ring
   * is a circle and not an ellipse however the element's box is shaped. The
   * band is where the press lands - `pointer-events: stroke` on a fat
   * transparent circle - because a filled one would swallow every press on the
   * gauge inside it, the text frames and the drag of the element itself
   * included.
   *
   * The needle is the one part that is not a ring: it is drawn as the line it
   * is, grabbed by either end, and laid out along the angle measured off the
   * live needle so the handles ride with it.
   *
   * It is also drawn last, after every ring, because in SVG the last thing
   * drawn is the first thing hit - and the tail handle is dragged towards the
   * pivot, straight through the hub's own band, which would otherwise take
   * the press meant for the handle sitting on top of it.
   *
   * @param {(e: any) => void} swallow
   */
  _renderRings(swallow) {
    const svgBox = this._innerRects?.svg;
    const target = this._innerTarget;
    const cfg = target?.cfg;
    if (!svgBox || !cfg) return '';
    const live = Object.entries(target.rings).filter(([, spec]) => partOn(spec, cfg));
    if (!live.length) return '';
    // What is drawn as a band, and what only ever stands somewhere. A part
    // with a spot has no radius, so none of the arithmetic below is asked of
    // it and neither layer is drawn for a kind that has only such parts.
    // Only the ring in hand gets a band. A gauge has five of them, and five
    // dashed circles laid over the very marks they are there to place is a
    // picture of the editor rather than of the card - the ticks, the sub-ticks
    // and the numbers on them all vanished under their own frames. The chips
    // stay, so every ring can still be reached; the band is for the one being
    // moved, and the press on the chip is what brings it out.
    const bands = live.filter(([part, spec]) =>
      !spec.needle && !spec.spot && this._innerSel === part);
    const needles = live.filter(([, spec]) => spec.needle);
    const scale = gaugeScaleOf(cfg) || 1;
    const ring = ringRadius(SC.safeFloat(cfg.stroke_width, 3), scale, frameBand(cfg, scale));
    const at = (/** @type {any} */ spec) => Math.abs(ringPartAt(spec, cfg, ring, scale));
    const C = GAUGE_VIEW / 2;
    // Every part of a gauge is drawn about its centre, the needle and its hub
    // included - they turn about it.
    const cen = { x: C, y: C };
    // Both ends laid out on the line the needle is pointing along right now.
    const needleAt = (/** @type {any} */ spec) => {
      const c = cen;
      const a2 = (this._innerRects?.angle ?? 0) * Math.PI / 180;
      const ends = needleEnds(SC.safeFloat(cfg.pointer_offset, 2),
                              SC.safeFloat(cfg.pointer_length, 10), ring, scale);
      const on = (/** @type {number} */ r) =>
        ({ x: c.x + r * Math.cos(a2), y: c.y + r * Math.sin(a2) });
      return { tip: on(ends.tip), tail: on(ends.tail) };
    };
    // One SVG user unit in screen pixels. A band drawn in user units is a
    // different line on every gauge - a hair on a small one and a rope on a
    // big one - so its width is worked back out of the pixels it should come
    // to, the way the needle's handles and the crosshair already are.
    const unit = (this._innerRects?.px?.width || 0) * svgBox.w / 100 / GAUGE_VIEW;
    const bandW = unit > 0 ? BAND_PX / unit : 0.35;
    return html`
      ${!bands.length ? '' : html`
      <svg class="ring-layer" viewBox="0 0 ${GAUGE_VIEW} ${GAUGE_VIEW}"
           style="left:${svgBox.l}%; top:${svgBox.t}%; width:${svgBox.w}%; height:${svgBox.h}%;
                  --sc-band-w:${bandW};">
        ${bands.map(([part, spec]) => svg`${ringBands(spec, cfg, ring, scale).map((b) => {
          const c = cen;
          if (b.r < 0.5) return '';
          // A ring nobody has drawn is still shown, because its edge is what
          // sets the gauge's size - but shown as the outline it is, so it does
          // not read as a frame that is switched on.
          const ghost = spec.ghost?.(cfg) ? 'ghost' : '';
          return svg`
            <circle class="ring-band sel ${ghost}" cx=${c.x} cy=${c.y} r=${b.r}></circle>
            <circle class="ring-hit" cx=${c.x} cy=${c.y} r=${b.r}
                    @pointerdown=${(/** @type {any} */ e) =>
                      this._innerDown(e, part, 'ring', b.edge)}>
              <title>${'Drag ' + b.what + ' in or out'}</title>
            </circle>`;
        })}`)}
      </svg>`}
      ${!needles.length ? '' : (() => {
      // The needle's two handles are drawn in the gauge's own units, which
      // made them one size on a big gauge and another on a small one. The
      // label box's grip is ten pixels wherever it is, and a handle that is
      // dragged the same way should be the same thing to reach for - so the
      // radius is worked back out of the pixels it has to come to.
      const gripR = unit > 0 ? 5 / unit : 1.1;
      return html`
      <svg class="ring-layer grip-layer" viewBox="0 0 ${GAUGE_VIEW} ${GAUGE_VIEW}"
           style="left:${svgBox.l}%; top:${svgBox.t}%; width:${svgBox.w}%; height:${svgBox.h}%;
                  --sc-band-w:${bandW};">
        ${needles.map(([part, spec]) => {
          const sel = this._innerSel === part;
          const n = needleAt(spec);
          return svg`
            <line class="ring-band needle-line ${sel ? 'sel' : ''}"
                  x1=${n.tail.x} y1=${n.tail.y} x2=${n.tip.x} y2=${n.tip.y}></line>
            <line class="needle-line needle-hit"
                  x1=${n.tail.x} y1=${n.tail.y} x2=${n.tip.x} y2=${n.tip.y}
                  @pointerdown=${(/** @type {any} */ ev) =>
                    this._innerDown(ev, part, 'needle', 'line')}>
              <title>${'Drag the ' + spec.label.toLowerCase()
                       + ' in or out, or either end to set its length'}</title>
            </line>
            ${Object.entries(NEEDLE_ENDS).map(([end, e2]) => svg`
              ${this._crossEnd !== end ? '' : svg`
              <line class="grip-cross" data-end=${end} data-axis="y"
                    x1="0" y1=${n[end].y} x2=${GAUGE_VIEW} y2=${n[end].y}
                    stroke-width=${1 / (unit || 1)}></line>
              <line class="grip-cross" data-end=${end} data-axis="x"
                    x1=${n[end].x} y1="0" x2=${n[end].x} y2=${GAUGE_VIEW}
                    stroke-width=${1 / (unit || 1)}></line>`}
              <circle class="ring-grip ${sel ? 'sel' : ''}" data-end=${end}
                      cx=${n[end].x} cy=${n[end].y} r=${gripR}></circle>
              <circle class="ring-grip-hit" data-end=${end}
                      cx=${n[end].x} cy=${n[end].y} r=${gripR * 2.2}
                      @pointerdown=${(/** @type {any} */ ev) => this._innerDown(ev, part, 'needle', end)}>
                <title>${'Drag the needle\'s ' + e2.what + ' to set its length'}</title>
              </circle>`)}`;
        })}
      </svg>`;
      })()}
      ${live.map(([part, spec]) => {
        const c = cen;
        const clampPc = (/** @type {number} */ v) => Math.max(2, Math.min(98, v));
        // The needle's chip cannot stand on a ring, so it stands beside the
        // line instead - at its middle, a little way off to one side, clear of
        // both handles however long the needle is.
        const spot = spec.spot
          // A part that is told where to stand is told in per cent of the box,
          // which is the answer this is on its way to anyway.
          ? { x: spec.spot.l * GAUGE_VIEW / 100, y: spec.spot.t * GAUGE_VIEW / 100 }
          : spec.needle
          ? (() => {
              const n = needleAt(spec);
              const a2 = (this._innerRects?.angle ?? 0) * Math.PI / 180;
              return { x: (n.tail.x + n.tip.x) / 2 - 4 * Math.sin(a2),
                       y: (n.tail.y + n.tip.y) / 2 + 4 * Math.cos(a2) };
            })()
          : (() => {
              // Never nearer than this: the hub's ring is a couple of units
              // across, and a chip drawn on it stands on the pivot itself -
              // over the needle's own tail handle, which is dragged to exactly
              // there.
              const r = Math.max(at(spec), RING_CHIP_MIN);
              const a2 = (RING_CHIP_ANGLE[part] ?? -90) * Math.PI / 180;
              return { x: c.x + r * Math.cos(a2), y: c.y + r * Math.sin(a2) };
            })();
        const l = svgBox.l + svgBox.w * spot.x / GAUGE_VIEW;
        const t = svgBox.t + svgBox.h * spot.y / GAUGE_VIEW;
        if (!spec.needle && (l < 0 || l > 100 || t < 0 || t > 100)) return '';
        // The needle's panel is the one that cannot be placed beside its own
        // chip: the chip rides the middle of the line, so the panel under it
        // hangs straight down the needle. The needle turns about the centre,
        // which makes the half of the gauge its tip is *not* in the half with
        // nothing in it but the hub - so the panel stands on the centre line
        // and grows away from the tip, in two columns, because half a gauge
        // is not tall enough for eight rows of one.
        const steps = spec.needle
          ? { l: svgBox.l + svgBox.w / 2, t: svgBox.t + svgBox.h / 2,
              up: needleAt(spec).tip.y > c.y, wide: true }
          : null;
        return this._renderChip(part, spec, clampPc(l), clampPc(t), swallow, steps);
      })}`;
  }

  /**
   * The offer that names a part, takes it in hand, and holds what can be said
   * about it in a word or a glyph - its shape, and the button that takes it
   * off again. Under it stand the numbers.
   *
   * Written once for every part that has one: a ring works out where its chip
   * goes from the ring itself, a part with a `spot` is told, and from here on
   * the two are the same thing.
   */
  _renderChip(part, spec, l, t, swallow, steps = null) {
    const target = this._innerTarget;
    if (!target) return '';
    const sel = this._innerSel === part;
    const at = chipPlace.get(chipKey(target.id, part)) || { l, t };
    return html`
      <span class="ring-tag ${sel ? 'sel' : ''}" data-part=${part}
            style="left:${at.l}%; top:${at.t}%;"
            title=${`${spec.label}${spec.hint ? ' - ' + spec.hint : ''} - drag the chip `
                    + 'to move it out of the way, double-click to put it back'}
            @dblclick=${() => this._putChipBack(part)}
            @pointerdown=${(/** @type {any} */ e) => this._innerDown(e, part, 'chip')}>
        ${spec.label}
        ${spec.shapes && sel ? this._renderSwap(spec.label, spec.shapes, 'Make') : ''}
        ${spec.weight && sel ? this._renderSwap(spec.label, spec.weight, 'Set') : ''}
        ${spec.turnOff ? html`
          <button class="chip-btn drop"
                  title=${`Take the ${spec.label.toLowerCase()} off this ${target.k.noun}`}
                  @pointerdown=${swallow}
                  @click=${() => this._setInnerRing(part, false)}>${icon('trash-2')}</button>` : ''}
      </span>
      ${sel ? this._renderSteppers(steps?.l ?? at.l, steps?.t ?? at.t, steps) : ''}`;
  }

  /** Put a chip back where the part it names says it should stand. */
  _putChipBack(part) {
    if (chipPlace.delete(chipKey(this._inner, part))) this.requestUpdate();
  }

  /**
   * The grips that round the element's corners.
   *
   * The way a drawing program does it: each grip lives on one edge of the
   * frame and slides along it, and how far it has come from the corner is the
   * radius. Two of them, on edges of their own - the bottom and the right-hand
   * side - so there is one to reach whatever the element sits next to, and one
   * with room whether the element is a long strip or a narrow column. See
   * `canvas-corner.js` for what a drag of one says.
   */
  _renderCorners() {
    const target = this._innerTarget;
    const spec = target?.k.corners?.(target.cfg);
    const box = this._innerRects?.px;
    if (!spec || !box) return '';
    const now = spec.now;
    return html`${Object.entries(GRIP_CORNERS).map(([corner, c]) => {
      const home = gripHome(now, box, corner, spec.unit);
      return html`
        <div class="corner-grip" data-corner=${corner}
             style="left:${home.l}%; top:${home.t}%;"
             title=${`Slide ${c.what} to round the corners - ${now}${spec.unit} now`}
             @pointerdown=${(/** @type {any} */ e) =>
               this._innerDown(e, null, 'corner', corner)}></div>`;
    })}`;
  }

  /**
   * A grip on the middle of each side, for bowing it out or in.
   *
   * Four of them rather than one, because a side is bent on its own: a box
   * with a waist on the left and a barrel on the right is a shape people
   * actually want, and one control could not say it. Each stands on the
   * middle of the side it bends, bow and all, so it is always on the thing it
   * moves - the same rule the corner grips follow. Double-click puts a side
   * straight again, which is the one value a drag cannot reliably land on.
   */
  _renderSides() {
    const target = this._innerTarget;
    if (!target?.k.sides || !this._innerRects?.px) return '';
    const bends = bendsOf(target.cfg);
    return html`${Object.entries(BEND_SIDES).map(([side, s]) => {
      const home = bendGripHome(bends[side], side);
      const now = bends[side];
      return html`
        <div class="side-grip" data-side=${side}
             style="left:${home.l}%; top:${home.t}%;"
             title=${`Drag across ${s.what} to bow it out or in, along it to move the crest - ${
               now.bow ? (now.bow > 0 ? now.bow + '% out' : -now.bow + '% in')
                       : 'straight'} now${
               now.bow && now.at !== BEND_AT_MID ? `, crest at ${now.at}%` : ''}`}
             @dblclick=${() => this._writeInner({ [bendKey(side)]: 0,
                                                  [bendAtKey(side)]: BEND_AT_MID })}
             @pointerdown=${(/** @type {any} */ e) =>
               this._innerDown(e, null, 'side', side)}></div>`;
    })}`;
  }

  /**
   * The numbers under the chip of whichever part is in hand.
   *
   * They hold what a person reaches for once the distance is right - how many
   * marks there are, how long they run and how thick they are drawn, or the
   * size of the tick labels' type. Under the chip rather than on the ring,
   * because the ring is already saying one thing by being dragged and a second
   * control on it would be a second meaning for the same gesture; and under
   * the chip rather than in the frame's corner, because the corner is the far
   * side of the gauge from the part the numbers belong to.
   *
   * One row per line, each wearing its own glyph. Three pairs of identical
   * buttons would say nothing about which is which, and a word in front of
   * each would be wider than the thing they stand on.
   *
   * Three kinds of row, all one line of the same grid: a number that is
   * stepped up and down, a colour that opens the picker the browser already
   * has, and a list that is a select because nine effects are not something to
   * cycle through one press at a time.
   */
  /**
   * Bring the panel of numbers back inside the canvas.
   *
   * The chip says where the panel hangs, and the panel is as tall as the part
   * in hand has things to say - eight rows under a chip near the bottom edge
   * stand half of them outside the canvas, which clips. How far outside is
   * only known once it is drawn, so it is measured here and handed back as a
   * nudge the transform adds to where the chip put it.
   *
   * The nudge already applied is read off the element rather than remembered,
   * because lit rewrites the whole style attribute whenever the chip moves and
   * takes the property with it - reading it back means what is measured is
   * always the position that is actually on screen.
   */
  /**
   * The rectangle a panel or a chip has to stay inside.
   *
   * Not the canvas: the canvas is as big as the zoom makes it and hangs out of
   * the window it is looked at through, which is what actually clips. So it is
   * the part of the canvas that can be seen - and that moves when the view is
   * scrolled, which is why the fitting runs again then.
   */
  _seenRect() {
    const root = this.shadowRoot;
    const canvas = /** @type {any} */ (root?.querySelector('.canvas'));
    const view = /** @type {any} */ (root?.querySelector('.canvas-view'));
    if (!canvas) return null;
    const c = canvas.getBoundingClientRect();
    const parts = [c, view?.getBoundingClientRect()]
      .filter((/** @type {any} */ r) => r && r.width);
    const left = Math.max(...parts.map((/** @type {any} */ r) => r.left));
    const top = Math.max(...parts.map((/** @type {any} */ r) => r.top));
    const right = Math.min(...parts.map((/** @type {any} */ r) => r.right));
    const bottom = Math.min(...parts.map((/** @type {any} */ r) => r.bottom));
    if (right <= left || bottom <= top) return c;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  /**
   * The same rectangle, drawn in a little - the frame nothing floating is let
   * out of.
   *
   * An invisible frame rather than a margin applied at each of the places that
   * place something: the panel, the chips and the add buttons all have to
   * agree on where the edge is, and a margin written out three times is three
   * chances to write a different one. Here it is one rectangle, and staying
   * inside it is the whole rule.
   */
  _safeRect() {
    const c = this._seenRect();
    if (!c) return null;
    const left = c.left + CANVAS_EDGE;
    const top = c.top + CANVAS_EDGE;
    const right = c.right - CANVAS_EDGE;
    const bottom = c.bottom - CANVAS_EDGE;
    // A view too small for its own margins keeps the room it has: an inside
    // out rectangle would push everything to one corner and pin it there.
    if (right <= left || bottom <= top) return c;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  /**
   * Scrolling the view moves what can be seen of the canvas, and the panel and
   * the chips are placed against that. Once per frame at most: a scroll fires
   * far oftener than anything here needs to be worked out again.
   */
  _onViewScroll = () => {
    if (this._fitting) return;
    this._fitting = requestAnimationFrame(() => {
      this._fitting = 0;
      this._settleFloating();
    });
  };

  /**
   * Put the panel and the chips inside the frame, and look again.
   *
   * Once is not always enough. Moving the panel can change what it is measured
   * against - a row that reflows, a scrollbar that appears in the view as the
   * canvas is zoomed - and the second reading is then a few pixels from the
   * first, which is exactly the few pixels that show as a clipped edge. So it
   * repeats while anything is still moving, and gives up after a handful of
   * frames rather than chasing something that will not settle.
   *
   * @param {number} [left] frames still allowed
   */
  _settleFloating(left = 4) {
    const moved = this._fitSteps();
    this._clearChips();
    if (!moved || left <= 0) return;
    if (this._settling) cancelAnimationFrame(this._settling);
    this._settling = requestAnimationFrame(() => {
      this._settling = 0;
      this._settleFloating(left - 1);
    });
  }

  _fitSteps() {
    const root = this.shadowRoot;
    const box = /** @type {any} */ (root?.querySelector('.ring-steps'));
    const canvas = this._safeRect();
    if (!box || !canvas) return false;
    // A panel drawn afresh knows nothing of the grip, and the grip writes
    // straight onto the box - so this is where the remembered size is put
    // back on, before anything is measured against it.
    if (box.style.getPropertyValue('--sc-steps-zoom') !== String(stepsZoom))
      box.style.setProperty('--sc-steps-zoom', String(stepsZoom));
    const was = {
      x: parseFloat(box.style.getPropertyValue('--sc-steps-dx')) || 0,
      y: parseFloat(box.style.getPropertyValue('--sc-steps-dy')) || 0,
    };
    const c = canvas;
    if (!c.height) return false;
    // A per cent would be read against the element the panel hangs on, which
    // is the gauge and not the canvas, so how tall it may be is measured here
    // too. Set before the box is, because it is what the box will be. Against
    // the unscaled box, because the cap is applied before the grip's scale
    // and what has to fit in the canvas is what is finally drawn.
    const room = Math.round(c.height / stepsZoom);
    const cap = room > 0 ? room + 'px' : 'none';
    if (box.style.maxHeight !== cap) box.style.maxHeight = cap;
    const b = box.getBoundingClientRect();
    if (!b.width) return false;
    // Where it would stand with no nudge at all.
    const l = b.left - was.x;
    const t = b.top - was.y;
    // Pushed off the far edge first and the near one second, so a panel too
    // big for the canvas is pinned at the top left of the frame and scrolls
    // rather than hiding its first row.
    const held = (/** @type {any} */ w) => ({
      x: Math.max(Math.min(w.x, c.right - (l + b.width)), c.left - l),
      y: Math.max(Math.min(w.y, c.bottom - (t + b.height)), c.top - t),
    });
    // And off the very thing it is setting. A menu that covers the mark it is
    // there to change is a menu you have to move to see what you did: the
    // pill's own numbers sat squarely on the pill, and a gauge's value on the
    // value. The way out is one step along one axis, past the nearest edge of
    // the mark - a panel that goes round a corner reads as one that has come
    // loose from its chip.
    const keep = this._partBox(this._innerSel);
    const M = 6;
    const clear = (/** @type {any} */ w) => !keep
      || l + w.x >= keep.right - 0.5 || l + w.x + b.width <= keep.left + 0.5
      || t + w.y >= keep.bottom - 0.5 || t + w.y + b.height <= keep.top + 0.5;
    let best = held({ x: 0, y: 0 });
    if (!clear(best)) {
      const ways = [
        { x: 0, y: keep.bottom + M - t },
        { x: 0, y: keep.top - M - (t + b.height) },
        { x: keep.right + M - l, y: 0 },
        { x: keep.left - M - (l + b.width), y: 0 },
      ].map(held).filter(clear)
        .sort((/** @type {any} */ p, /** @type {any} */ q) =>
          (Math.abs(p.x) + Math.abs(p.y)) - (Math.abs(q.x) + Math.abs(q.y)));
      // Nowhere clear inside the canvas leaves it where it was: a mark that
      // fills the view has no beside, and a panel shoved off the edge to
      // honour the rule would be worse than one lying over it.
      if (ways.length) best = ways[0];
    }
    if (Math.abs(best.x - was.x) < 0.5 && Math.abs(best.y - was.y) < 0.5) return false;
    box.style.setProperty('--sc-steps-dx', best.x + 'px');
    box.style.setProperty('--sc-steps-dy', best.y + 'px');
    return true;
  }

  /**
   * Where the mark a part names is actually drawn, in window pixels.
   *
   * Off the drawing rather than off the measured rects: `_innerRects` covers
   * the texts a frame can be put round and nothing else, and what has to be
   * kept clear is every mark a chip sets - a pill, a ring, the needle. The
   * renderers already name each of them for the highlight, so the same
   * attribute answers this, and a mark drawn in several pieces - a tick row,
   * a line and the pill above it - is the box round all of them.
   *
   * @param {string|null} part
   * @returns {{left: number, top: number, right: number, bottom: number}|null}
   */
  _partBox(part) {
    const root = this.shadowRoot;
    const el = part && this._inner
      ? root?.querySelector(`.el[data-item-id="${this._inner}"]`) : null;
    const host = /** @type {any} */ (el?.querySelector('sc-gauge, sc-progressbar'));
    const marks = host?.shadowRoot?.querySelectorAll(`[data-sc-part~="${part}"]`);
    if (!marks?.length) return null;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const mark of marks) {
      const q = mark.getBoundingClientRect();
      if (!q.width && !q.height) continue;
      left = Math.min(left, q.left); top = Math.min(top, q.top);
      right = Math.max(right, q.right); bottom = Math.max(bottom, q.bottom);
    }
    return right > left ? { left, top, right, bottom } : null;
  }

  /**
   * Step the chips out from under the panel of numbers, and out from under
   * each other.
   *
   * The panel stands over the chips, which settled the rows being reachable
   * but not the chips: one covered is one that cannot be pressed, and a chip
   * is the only way to take a different part in hand. So the chips give way -
   * the nearest way out along one axis, as long as it lands inside the canvas
   * and on nothing else.
   *
   * "On nothing else" is why this is one pass over all of them rather than
   * each one on its own: a chip pushed clear of the panel lands wherever it
   * lands, and without knowing where its neighbours went it lands on one. So
   * every chip already settled - and the panel, and the chip the panel belongs
   * to, which never moves - is a place the next one may not go.
   *
   * The move is a nudge on top of where the chip belongs, not a new place for
   * it: a chip dragged aside by hand keeps the place it was given, and the
   * needle's chip keeps being fetched back to the needle.
   */
  _clearChips() {
    const root = this.shadowRoot;
    const c = this._safeRect();
    if (!root || !c) return;
    const box = /** @type {any} */ (root.querySelector('.ring-steps'));
    // Enough that a chip which has stepped aside reads as standing beside the
    // thing rather than against it.
    const M = 8;
    const hits = (/** @type {any} */ h, /** @type {any} */ o) =>
      h.l < o.right + M && h.l + h.w > o.left - M
      && h.t < o.bottom + M && h.t + h.h > o.top - M;
    const taken = box ? [box.getBoundingClientRect()] : [];
    // A frame is worked on the way the panel is read, so it gets the same
    // right to be clear of chips. The one in hand is protected whole - its
    // box, its head and whatever it is being typed into - because that is
    // where the eye and the pointer both are; every other frame only asks
    // that its name stay legible.
    for (const f of /** @type {any[]} */ ([...root.querySelectorAll('.inner-frame')])) {
      const whole = f.classList.contains('sel') || f.querySelector('.inner-text');
      const parts = whole ? [f, ...f.children] : [...f.querySelectorAll('.inner-tag')];
      for (const el of /** @type {any[]} */ (parts)) {
        const r = el.getBoundingClientRect();
        if (r.width || r.height) taken.push(r);
      }
    }
    const chips = /** @type {any[]} */ ([...root.querySelectorAll('.ring-tag, .inner-adds')]);
    // The one the panel hangs from goes first, so it gets the shortest way out
    // and the others arrange themselves around it. It gives way like any
    // other: the panel is placed from where that chip belongs, not from where
    // it ends up, so stepping aside costs the panel nothing and is the only
    // way both can be seen when the panel has been pushed up over it.
    chips.sort((/** @type {any} */ a, /** @type {any} */ b) =>
      Number(b.dataset.part === this._innerSel) - Number(a.dataset.part === this._innerSel));
    for (const chip of chips) {
      const was = {
        x: parseFloat(chip.style.getPropertyValue('--sc-chip-dx')) || 0,
        y: parseFloat(chip.style.getPropertyValue('--sc-chip-dy')) || 0,
      };
      const r = chip.getBoundingClientRect();
      // Where it stands with no nudge, which is the only place worth asking
      // about: a chip that has been pushed aside is not where it belongs.
      //
      // Read off what is on the screen *now*, not off the nudge it was last
      // given: while the chip is gliding those are two different places, and
      // taking the target for the truth makes every pass during a glide
      // measure from somewhere the chip never was. Each such pass then wrote
      // a new target, which restarted the glide - chips wandering for seconds
      // before they came to rest. Untransformed the chip sits at its layout
      // box; the rest of its transform is the centring, which is half its own
      // box for a ring's chip and nothing for a column of add buttons.
      const m = new DOMMatrixReadOnly(getComputedStyle(chip).transform);
      const mid = chip.classList.contains('ring-tag');
      const zoom = chip.offsetWidth ? r.width / chip.offsetWidth : 1;
      const now = {
        x: (m.e + (mid ? chip.offsetWidth / 2 : 0)) * zoom,
        y: (m.f + (mid ? chip.offsetHeight / 2 : 0)) * zoom,
      };
      const h = { l: r.left - now.x, t: r.top - now.y, w: r.width, h: r.height };
      const at = (/** @type {any} */ w) => ({ l: h.l + w.x, t: h.t + w.y, w: h.w, h: h.h });
      const free = (/** @type {any} */ w) => !taken.some((/** @type {any} */ o) => hits(at(w), o));
      const inside = (/** @type {any} */ w) =>
        h.l + w.x >= c.left && h.l + w.x + h.w <= c.right
        && h.t + w.y >= c.top && h.t + w.y + h.h <= c.bottom;
      // The frame is not only something to keep out of the way of - it is the
      // first thing a chip is brought inside, whether anything else is in its
      // way or not. A chip hanging half out of the view is clipped by it, and
      // that is the same fault as lying under the panel.
      const held = (/** @type {any} */ w) => ({
        x: Math.max(Math.min(w.x, c.right - (h.l + h.w)), c.left - h.l),
        y: Math.max(Math.min(w.y, c.bottom - (h.t + h.h)), c.top - h.t),
      });
      let best = held({ x: 0, y: 0 });
      if (!free(best)) {
        // One axis at a time, past every edge of everything already placed:
        // a chip that goes round a corner reads as a chip that has wandered.
        const ways = [];
        for (const o of taken) {
          ways.push({ x: o.left - M - (h.l + h.w), y: 0 }, { x: o.right + M - h.l, y: 0 },
                    { x: 0, y: o.top - M - (h.t + h.h) }, { x: 0, y: o.bottom + M - h.t });
        }
        const ok = ways.map(held).filter(inside).filter(free)
          .sort((/** @type {any} */ p, /** @type {any} */ q) =>
            (Math.abs(p.x) + Math.abs(p.y)) - (Math.abs(q.x) + Math.abs(q.y)));
        if (ok.length) best = ok[0];
      }
      taken.push(/** @type {any} */ ({ left: h.l + best.x, right: h.l + best.x + h.w,
                                       top: h.t + best.y, bottom: h.t + best.y + h.h }));
      // Wider than it needs to be for a still picture: measuring against a
      // drawing that is itself laid out in fractions of a pixel, two passes
      // can disagree by a pixel over nothing, and rewriting the nudge for
      // that restarts a glide that lasts more than a second.
      if (Math.abs(best.x - was.x) < 1.5 && Math.abs(best.y - was.y) < 1.5) continue;
      if (best.x || best.y) {
        chip.style.setProperty('--sc-chip-dx', best.x + 'px');
        chip.style.setProperty('--sc-chip-dy', best.y + 'px');
      } else {
        chip.style.removeProperty('--sc-chip-dx');
        chip.style.removeProperty('--sc-chip-dy');
      }
    }
  }

  _renderSteppers(left, top, opts = null) {
    const target = this._innerTarget;
    const spec = this._selSpec;
    // Not every part has something worth a row - a gauge's hub is one size and
    // nothing else - and no cluster at all says so better than one that does
    // nothing.
    if (!spec?.steps?.length || !target) return '';
    const cfg = target.cfg;
    const swallow = (/** @type {any} */ e) => { e.stopPropagation(); e.preventDefault(); };
    /**
     * The same, for a control the browser has to be left to open itself.
     *
     * A prevented `pointerdown` fires no compatibility `mousedown` and gives
     * no focus, and those are what Chromium opens a colour picker and a
     * select's list on - the `click` still arrives, and nothing happens. So
     * the swatch was a coloured box that could not be pressed. Keeping the
     * press off the canvas is all these need; the drag listens on an
     * ancestor, which `stopPropagation` alone already puts out of reach.
     */
    const keep = (/** @type {any} */ e) => e.stopPropagation();
    const now = (/** @type {any} */ st) =>
      (st.read ? st.read(cfg)
       : st.unit ? splitUnit(cfg[st.key], st.dflt).n
       : SC.safeFloat(cfg[st.key], st.dflt));
    const stepIcon = (/** @type {any} */ st) => html`
      <span class="ring-step-icon" title=${`${spec.label}: ${st.what}`}>${st.icon}</span>`;

    const group = (/** @type {any} */ st) => {
      // A row that would set something this part has not got is not drawn: a
      // gradient has a list of colours, not a colour, so it has no swatch.
      if (st.condition && !st.condition(cfg)) return '';
      // A row that sets nothing. Where a choice can be asked for and not
      // honoured - a pill on its end that the bar is too flat to hold - the
      // menu says so under the row that makes the choice, because that is
      // where it looks like a free one. It takes the four cells a whole row
      // is made of rather than a row of its own, so a menu drawn in two
      // columns still pairs its rows up the way it counts on.
      if (st.note) return html`
        <span class="ring-group"><span class="ring-note">${st.note}</span></span>`;
      // A swatch and a select each take the three cells the two buttons and
      // the number would, so every row still reads as one line of the grid.
      if (st.paint) return html`
        <span class="ring-group">${stepIcon(st)}
          <label class="ring-wide ring-swatch" style="background:${now(st)}"
                 title=${`Set the ${st.what}`} @pointerdown=${keep}>
            <input type="color" .value=${now(st)}
                   @input=${(/** @type {any} */ e) =>
                     this._writeInner(st.patch(cfg, e.target.value), false)}>
          </label>
        </span>`;
      // A switch is neither a number nor a choice from a list: it is on or it
      // is off, and the shortest honest control for that is the box itself
      // with its name beside it.
      if (st.flag) return html`
        <span class="ring-group">${stepIcon(st)}
          <label class="ring-wide ring-flag" title=${`Turn ${st.what} on or off`}
                 @pointerdown=${(/** @type {any} */ e) => e.stopPropagation()}>
            <input type="checkbox" .checked=${!!cfg[st.key]}
                   @change=${(/** @type {any} */ e) =>
                     this._writeInner({ [st.key]: e.target.checked }, false)}>
            <span>${st.what}</span>
          </label>
        </span>`;
      // A slider for a value that is a taste rather than a count - a blur, an
      // opacity, an angle. It takes two of the four cells and hands the last
      // to the number, because a slider with nothing reading out of it says
      // only "about here".
      if (st.slide) return html`
        <span class="ring-group">${stepIcon(st)}
          <input type="range" class="ring-slide" title=${`Set the ${st.what}`}
                 min=${st.min} max=${st.max} step=${st.by} .value=${String(now(st))}
                 @pointerdown=${(/** @type {any} */ e) => {
                   e.stopPropagation();
                   this._narrowHl(st.hl);
                 }}
                 @input=${(/** @type {any} */ e) => {
                   // Same escape hatch the select below has: most sliders set
                   // the number they show, but one whose stored unit is not
                   // its shown one has to translate, and `read` alone only
                   // gets it as far as the thumb.
                   const v = SC.safeFloat(e.target.value, st.dflt);
                   this._writeInner(st.patch ? st.patch(cfg, v) : { [st.key]: v }, false);
                 }}>
          <span class="ring-step-val">${st.unit
            ? now(st) + splitUnit(cfg[st.key], st.dflt).unit : now(st)}</span>
        </span>`;
      // Home Assistant's own icon dropdown, because an icon is picked by
      // looking at it and by typing a few letters of its name - neither of
      // which a list of ours would do as well, and both of which every other
      // icon field in Home Assistant already does this way.
      if (st.pickIcon) return html`
        <span class="ring-group">${stepIcon(st)}
          <ha-icon-picker class="ring-wide ring-iconpick" .hass=${this.hass}
                          .value=${cfg[st.key] || ''}
                          title=${`Set the ${st.what}`}
                          @pointerdown=${keep}
                          @value-changed=${(/** @type {any} */ e) =>
                            this._writeInner({ [st.key]: e.detail.value || undefined }, false)}></ha-icon-picker>
        </span>`;
      if (st.picks) return html`
        <span class="ring-group">${stepIcon(st)}
          <select class="ring-wide ring-pick" title=${`Set the ${st.what}`}
                  @pointerdown=${keep}
                  @change=${(/** @type {any} */ e) => {
                    // A row that sets one key names it; one that drops a whole
                    // design on the part - a ramp of colours - hands back the
                    // patch instead, and answers nothing for the line that is
                    // only the menu's own name for itself.
                    const patch = st.patch ? st.patch(cfg, e.target.value)
                                           : { [st.key]: e.target.value };
                    if (patch) this._writeInner(patch, false);
                    // Nothing records which ramp was picked, so the menu goes
                    // back to saying what it is rather than what was last done
                    // with it.
                    if (st.patch) e.target.value = String(now(st));
                  }}>
            ${st.picks.map((/** @type {any} */ o) => html`
              <option value=${o.value} ?selected=${o.value === now(st)}>${o.short || o.label}</option>`)}
          </select>
        </span>`;
      const val = now(st);
      const btn = (/** @type {number} */ dir, /** @type {string} */ glyph) => html`
        <button class="ring-step" ?disabled=${dir > 0 ? val >= st.max : val <= st.min}
                title=${`${dir > 0 ? 'More' : 'Less'} ${st.what}`}
                @pointerdown=${swallow}
                @click=${() => this._stepRing(st, dir)}>${glyph}</button>`;
      const shown = st.unit ? val + splitUnit(cfg[st.key], st.dflt).unit : val;
      return html`
        <span class="ring-group">${stepIcon(st)}
          ${btn(-1, '−')}<span class="ring-step-val">${shown}</span>${btn(1, '+')}
        </span>`;
    };
    return html`
      <div class="ring-steps ${opts?.up ? 'up' : ''} ${opts?.wide ? 'wide' : ''}"
           data-part=${this._innerSel}
           style="left:${left}%; top:${top}%;">
        ${spec.steps.map(group)}
        <div class="steps-grip" title="Drag to make this menu bigger or smaller"
             @pointerdown=${(/** @type {any} */ e) => this._stepsResize(e)}></div>
      </div>`;
  }

  /**
   * The grip that sets how big the chip menus are drawn.
   *
   * A whole scale rather than a width and a height: the rows are a grid of
   * four columns whose widths the contents decide, so there is nothing for a
   * width to give and nothing for a height to do but show more of what is
   * already there. What a menu on a drawing is actually too small for is
   * hitting and reading, and both of those are the scale.
   *
   * Written straight onto the box and not through state: a re-render would
   * rewrite the style attribute the fitting has just put its nudge into, and
   * the panel would jump once per frame of the drag.
   */
  _stepsResize(e) {
    e.stopPropagation();
    e.preventDefault();
    const grip = e.currentTarget;
    const box = grip.parentElement;
    const from = { x: e.clientX, y: e.clientY, z: stepsZoom };
    grip.setPointerCapture?.(e.pointerId);
    const move = (/** @type {any} */ ev) => {
      // Both axes, because the grip is in a corner and either way out of it
      // reads as "bigger".
      const by = ((ev.clientX - from.x) + (ev.clientY - from.y)) / 240;
      const next = Math.min(STEPS_MAX, Math.max(STEPS_MIN,
        Math.round(from.z * (1 + by) * 100) / 100));
      if (next === stepsZoom) return;
      stepsZoom = next;
      box?.style.setProperty('--sc-steps-zoom', String(stepsZoom));
      this._settleFloating();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  /**
   * The button on a chip that steps the part through the shapes it can take.
   *
   * On the chip rather than in the corner cluster: the corner holds a number
   * that is stepped up and down, and a shape is neither - it is the same one
   * setting the form's select writes, offered where the part is.
   */
  _renderSwap(label, sw, verb) {
    const target = this._innerTarget;
    if (!target) return '';
    const held = String(target.cfg[sw.key] ?? '');
    // A default may be a question about the entry, because what a part is
    // drawn at now can be an older setting nobody has replaced yet.
    const dflt = typeof sw.dflt === 'function' ? sw.dflt(target.cfg) : sw.dflt;
    const now = sw.order.includes(held) ? held : dflt;
    const next = sw.order[(sw.order.indexOf(now) + 1) % sw.order.length];
    return html`
      <button class="ring-shape"
              style=${sw.of[now].weight ? `font-weight:${sw.of[now].weight}` : ''}
              title=${`${verb} the ${label.toLowerCase()} ${sw.of[next].label}`}
              @pointerdown=${(/** @type {any} */ e) => { e.stopPropagation(); e.preventDefault(); }}
              @click=${() => this._writeInner({ [sw.key]: next }, false)}>
        ${sw.of[now].glyph}</button>`;
  }

  /** The next step up (`dir > 0`) or down from wherever the zoom is now. */
  _stepZoom(dir, at = null) {
    // Against the current value rather than an index into the list, because
    // the wheel sets values that are not in it.
    const next = dir > 0
      ? ZOOM_STEPS.find(z => z > this._zoom + 0.001)
      : ZOOM_STEPS.filter(z => z < this._zoom - 0.001).pop();
    if (next) this._applyZoom(next, at);
  }

  /**
   * Ctrl or Cmd and the wheel zooms; the wheel alone scrolls the view.
   *
   * The modifier is what a trackpad's pinch arrives as, so pinching zooms
   * too. Without `preventDefault` the same gesture is the browser's own page
   * zoom, which would take the whole dialog with it.
   *
   * The zoom is aimed at the pointer, so the element being worked on is the
   * one that stays put - the wheel is used over the thing it is meant to
   * bring closer, not over the middle of the window.
   */
  _onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this._applyZoom(Math.round(this._zoom * factor * 100) / 100, { x: e.clientX, y: e.clientY });
  }

  /**
   * A press on the canvas background: the start of a selection frame.
   *
   * Nothing is selected or cleared yet. That happens on release, so a plain
   * click still clears the selection the way it always has, and the press
   * only becomes a frame once the pointer has actually travelled - otherwise
   * every click would flash a zero-sized box.
   */
  /**
   * Offer a press to what the open element draws, and take that part in hand.
   *
   * The part is where it is drawn. A chip stands beside the drawing and a
   * frame is thrown round it, but neither is the thing itself, and hunting
   * along a row of chips for the one that names the tick already under the
   * finger is the proxy the canvas is meant to do away with.
   *
   * Only while an element is open: outside that the press belongs to the
   * element, and a pill covers most of a bar, so a bar could no longer be
   * picked up by its middle. A press that lands on no part is not taken, and
   * falls through to whatever the press would otherwise have been - which is
   * what keeps bare ground the way to let go of a part.
   *
   * @param {any} e
   * @returns {boolean} whether the press has been answered
   */
  _takeDrawnPart(e) {
    if (!this._innerOn) return false;
    const t = this._innerTarget;
    const box = t && this.shadowRoot?.querySelector(`.el[data-item-id="${t.id}"]`);
    if (!box) return false;
    const stack = drawnPartsAt(box, e.clientX, e.clientY, { ...t.parts, ...t.rings });
    if (!stack.length) return false;
    // Pressing the same spot again walks one step down the stack, the way the
    // canvas walks down its elements: a tick under a pill can be reached no
    // other way. On the press rather than on the release, because taking a
    // drawn part in hand starts no drag of its own - a text is dragged by the
    // frame this press puts round it, and a ring by its own band.
    const prev = this._innerLastDown;
    // Not with a modifier down: that press adds a second part to what is
    // held, and adding the one already in hand's neighbour is not what the
    // hand asked for.
    const mod = e.shiftKey || e.ctrlKey || e.metaKey;
    const same = !mod && !!prev && Math.abs(prev.x - e.clientX) <= SAME_SPOT_PX
                                && Math.abs(prev.y - e.clientY) <= SAME_SPOT_PX;
    const at = stack.indexOf(this._innerSel || '');
    const part = same && at >= 0 ? stack[(at + 1) % stack.length] : stack[0];
    this._innerLastDown = { x: e.clientX, y: e.clientY, same, stack };
    e.preventDefault();
    e.stopPropagation();
    // The same modifier that picks a second element on the canvas adds a
    // second text to what is held.
    if (t.parts[part] && mod) {
      this._toggleHeld(part);
      return true;
    }
    const fresh = this._innerSel !== part;
    this._innerSel = part;
    // A ring is not held together with a text, the same rule the chips and
    // the frames go by.
    if (!t.parts[part] && t.rings[part]) this._innerAlso = [];
    // On release, like every other way of taking a part in hand: the reveal
    // scrolls the dialog, and doing that under a finger that is still down
    // moves the drawing out from under it.
    if (fresh) this._revealOnUp = part;
    return true;
  }

  _onCanvasDown(e) {
    // Every touch on the canvas is remembered, whatever it turns out to be:
    // the second one is a pinch, and a pinch has to be able to take over from
    // the drag the first one started.
    if (e.pointerType === 'touch') {
      this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._touches.size === 2) return this._startPinch();
    }
    // The hand first: over a zoomed canvas the middle button and space both
    // move the window, and neither is a press on anything in it.
    if (e.button === 1 || (this._space && e.button === 0)) return this._startPan(e);
    // Placing puts its own layer over the canvas; a press on the strip beside
    // it is not a selection frame, and must not cancel the selection either.
    if (this._placing) return;
    const view = e.currentTarget.querySelector('.canvas-view');
    // A press on the zoomed view's own scrollbar is a scroll. Only the view
    // itself can be the target there - anywhere else the canvas is - and only
    // past its client box, which is the scrollbar's own strip.
    if (view && e.target === view
        && (e.offsetX >= view.clientWidth || e.offsetY >= view.clientHeight)) return;
    // A gauge draws well outside its box - most of a dial's numbers stand
    // beyond it - so a press on one of them arrives here rather than at the
    // element, and the drawing has to be offered the press from both sides.
    if (this._takeDrawnPart(e)) return;
    this._letGoOfPart();
    const canvas = e.currentTarget.querySelector('.canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // Capture, so a frame dragged past the strip keeps being tracked instead
    // of stopping the moment the pointer leaves the editor. Synthetic events
    // have no live pointer to capture, which is not a reason to fail.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no live pointer */ }
    const at = this._bandPoint(e, rect);
    this._band = { rect, live: false, startX: e.clientX, startY: e.clientY,
                   // Held down, the frame adds to what is already selected
                   // instead of replacing it - the same modifiers as a click.
                   base: (e.shiftKey || e.ctrlKey || e.metaKey) ? this._selection : [],
                   x0: at.x, y0: at.y, x1: at.x, y1: at.y };
  }

  /** A pointer position in canvas units, clamped to the canvas. */
  _bandPoint(e, rect) {
    const c = this._canvas;
    return { x: Math.max(0, Math.min(c.w, (e.clientX - rect.left) / rect.width * c.w)),
             y: Math.max(0, Math.min(c.h, (e.clientY - rect.top) / rect.height * c.h)) };
  }

  _onBandMove() {
    const b = this._band;
    const p = this._ptr;
    if (!p) return;
    const live = b.live || Math.abs(p.x - b.startX) > SAME_SPOT_PX
                        || Math.abs(p.y - b.startY) > SAME_SPOT_PX;
    if (!live) return;
    // The canvas' own rect, read again rather than remembered: the edge
    // scroll moves it, and a frame drawn against where it used to be would
    // grab the wrong elements.
    const canvas = this.shadowRoot?.querySelector('.canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : b.rect;
    const at = this._bandPoint({ clientX: p.x, clientY: p.y }, rect);
    this._band = { ...b, rect, live: true, x1: at.x, y1: at.y };
    // Selected as the frame is drawn, not on release: what it holds has to be
    // visible while there is still a chance to make it hold something else.
    const inside = elementsInRect(this._canvas, this._band);
    this._applySelection([...b.base, ...inside.filter(id => !b.base.includes(id))]);
  }

  _onUp(e) {
    if (e?.pointerType === 'touch') this._touches.delete(e.pointerId);
    if (this._innerDrag) {
      const d = this._innerDrag;
      this._innerDrag = null;
      this._crossEnd = null;
      if (d.mode === 'chip' && d.held && !d.started && this._innerSel === d.part) {
        this._innerSel = null;
      }
      // Before the reveal, which is then left to the part the walk landed on:
      // the press that walks is a press on the part already in hand, so it
      // asked for no reveal of its own.
      this._walkParts(d);
      // A press that turned into a drag has been answered by the drag, and
      // the part it was about may not even be the one in hand any more.
      const reveal = this._revealOnUp;
      this._revealOnUp = null;
      if (reveal && !d.started && this._innerSel === reveal) this._revealPart(reveal);
      return;
    }
    // A press that started no drag at all - a ring with no band of its own,
    // or one whose gauge could not be measured - still selected something.
    const pending = this._revealOnUp;
    this._revealOnUp = null;
    if (pending && this._innerSel === pending) this._revealPart(pending);
    // A pinch ends with the second finger, and the one still down does not
    // then start dragging whatever it happens to be resting on.
    if (this._pinch && this._touches.size < 2) {
      this._pinch = null;
      this._drag = null;
      this._band = null;
      this._stopEdgeScroll();
      return;
    }
    this._stopEdgeScroll();
    if (this._pan) { this._pan = null; return; }
    if (this._band) {
      const live = this._band.live;
      this._band = null;
      // A frame is not a step in a walk down a stack of elements.
      this._lastDown = null;
      // A press that never travelled is the plain background click it has
      // always been.
      if (!live) this._deselect();
      return;
    }
    const mode = this._drag?.mode;
    const d = this._lastDown;
    this._drag = null;
    // One gesture, one commit - and one step to undo.
    const moved = this._dragCanvas;
    this._dragCanvas = null;
    if (moved) this._commit(moved);
    // Clicking the same spot again walks one step down the stack under the
    // pointer, the way easy-floorplan does it: an element another one covers
    // completely can be reached no other way. A press that moved was a drag,
    // and a drag picks nothing new.
    // Not while several are selected: the walk replaces what is selected, and
    // that is the opposite of what a second click is doing there.
    if (mode !== 'move' || !d || d.moved || !d.same || d.stack.length < 2) return;
    if (this._extra.length) return;
    const els = this._canvas.elements;
    const at = d.stack.findIndex(i => els[i]?.id === this._sel);
    const next = els[d.stack[(Math.max(at, 0) + 1) % d.stack.length]];
    if (next) this._sel = next.id;
  }

  /**
   * The real component for an element, or null to keep the plain box.
   *
   * The id *is* the index - the same `gauge_0` / `progressbar_0` convention
   * `onAfterRender` slots by - and the two branches mirror what each module's
   * `update()` does, including its own active flags, so the preview cannot
   * show a card the renderer would not draw. `slot` is what the card passes
   * as `rootConfig`, because it is the same object.
   *
   * Both hosts are `pointer-events: none`, which is why a live element can sit
   * inside a draggable box without swallowing the drag.
   */
  _liveContent(el) {
    const slot = this.slot || {};
    if (el.surface || !this.hass) return null;
    const m = /^(gauge|progressbar)_(\d+)$/.exec(String(el.id || ''));
    if (!m) return null;
    const idx = Number(m[2]);

    if (m[1] === 'gauge') {
      if (!slot.gauge_active) return null;
      const gauges = Array.isArray(slot.gauges) && slot.gauges.length > 0 ? slot.gauges : [slot];
      const cfg = gauges[idx];
      if (!cfg) return null;
      // onCanvas: the element's box is the size here, exactly as on the card.
      // frozen: a needle that swings away mid-drag is a needle whose length
      // cannot be set, and a live entity is free to move at any moment. Only
      // this gauge, and only while one of its two pointer parts is in hand.
      const frozen = this._innerOn && this._inner === el.id
                     && FROZEN_WHILE_HELD.has(this._innerSel || '');
      return html`<sc-gauge .config=${cfg} .hass=${this.hass} .frozen=${frozen}
                            data-sc-hl=${this._hlPart(el.id)}
                            style=${this._hlStyle(el.id, cfg)}
                            .globalEntities=${slot.global_entities} .onCanvas=${true}></sc-gauge>`;
    }

    if (!slot.progressbar_active) return null;
    const bars = Array.isArray(slot.progressbars) ? slot.progressbars : [];
    const cfg = bars[idx];
    if (!cfg || cfg.active === false) return null;
    return html`<sc-progressbar .config=${cfg} .hass=${this.hass} .rootConfig=${slot}
                                data-sc-hl=${this._hlPart(el.id)}
                                style=${this._hlStyle(el.id)}
                                .globalEntities=${slot.global_entities}></sc-progressbar>`;
  }

  // --- element list -----------------------------------------------------
  _unplaced() {
    const placed = new Set(this._canvas.elements.map(e => e.id));
    return getLayoutTargets(this.slot || {})
      .filter(t => t.id !== 'empty' && !placed.has(t.id));
  }

  /**
   * What the menu picked, ready for the next click on the canvas to land.
   *
   * `template` is the one the submenu offered, or null for an empty element.
   * Its config is taken here rather than at the click, because by then the
   * menu that knew which template it was is gone - and taken as a copy, so the
   * element the click makes is the person's own from the start.
   *
   * `patch` is what a second page added to it - a bar's ramp - written over
   * the template's own colours before anything is placed, so the element the
   * click makes is finished rather than recoloured a moment later.
   *
   * @param {string} what
   * @param {{ id: string, label: string, aspect?: number } | null} [template]
   * @param {Record<string, any> | null} [patch]
   */
  _startPlacing(what, template = null, patch = null) {
    this._menu = false;
    this._menuKind = null;
    this._menuTemplate = null;
    this._placing = what;
    this._placingTemplate = template;
    this._placingEntry = template ? templateEntry(what, template.id) : null;
    if (this._placingEntry && patch) Object.assign(this._placingEntry, patch);
    // No ghost until the pointer says where. Drawing one at the last position
    // would put a box under a crosshair that has since moved on.
    this._ghost = null;
  }

  _closeMenu() {
    this._menu = false;
    this._menuKind = null;
    this._menuTemplate = null;
    this._placing = null;
    this._placingTemplate = null;
    this._placingEntry = null;
    this._ghost = null;
  }

  /** Where a pointer event is, in canvas units. */
  _atPointer(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const c = this._canvas;
    return { x: (e.clientX - rect.left) / rect.width * c.w,
             y: (e.clientY - rect.top) / rect.height * c.h };
  }

  /**
   * Follow the crosshair with the box the next click would make.
   *
   * The geometry is `newElementPreview`, which is `addElement`'s own working
   * - same id, same size rule, same snap and same clamp at the edges - so the
   * ghost cannot promise a placement the click then does not make. Null where
   * the element could not be added at all, and then nothing is drawn.
   */
  _ghostAt(e) {
    if (!this._placing) return;
    this._ghost = newElementPreview(this.slot, this._canvas, this._placing,
                                    this._atPointer(e), this._placingTemplate?.aspect,
                                    this._pendingEntry(this._placing, this._placingEntry));
  }

  /**
   * The entry the click is about to add: the template's where one was chosen,
   * and the module's own otherwise.
   *
   * The ghost needs it for the same reason the placement does - it is what
   * says whether the new box is locked square - so both ask here rather than
   * the ghost guessing from the template's `aspect`, which cannot answer it.
   *
   * @param {string} what
   * @param {any} chosen
   * @returns {any}
   */
  _pendingEntry(what, chosen) {
    if (chosen) return chosen;
    const kind = NEW_ELEMENT_KINDS.find(k => k.kind === what);
    return kind?.module ? window.SupercardModules[kind.module]?.newEntry?.() : undefined;
  }

  /**
   * A method rather than an arrow in the template: every pointermove sets the
   * ghost and so re-renders, and a fresh closure there would have lit detach
   * and reattach the listener on every one of those frames.
   */
  _dropGhost() { this._ghost = null; }

  /** The label the menu gave whatever is waiting to be placed. */
  get _placingLabel() {
    const kind = NEW_ELEMENT_KINDS.find(k => k.kind === this._placing);
    if (kind) return this._placingTemplate
      ? `${this._placingTemplate.label.toLowerCase()} ${kind.label.toLowerCase()}`
      : kind.label.toLowerCase();
    const t = this._unplaced().find(t => t.id === this._placing);
    return t ? (t.group === 'Basic' ? t.label : `${t.group} - ${t.label}`) : this._placing;
  }

  /**
   * Put the chosen element down where the pointer is.
   *
   * The definition comes from the module that renders it - `newEntry` - so
   * the canvas decides where a new gauge goes without knowing what a gauge
   * contains. One `__merge__` rather than two commits, for the reason
   * `_duplicate` gives.
   */
  _place(e) {
    // The overlay is a child of the canvas, whose own press clears the
    // selection - and the point of placing is to end up with the new element
    // selected.
    e.stopPropagation();
    const what = this._placing;
    const chosen = this._placingEntry;
    const aspect = this._placingTemplate?.aspect;
    this._placing = null;
    this._placingTemplate = null;
    this._placingEntry = null;
    this._ghost = null;
    if (!what || !this.commitFn) return;

    const c = this._canvas;
    const at = this._atPointer(e);

    const entry = this._pendingEntry(what, chosen);

    const made = addElement(this.slot, c, what, entry, at, aspect);
    if (!made) return;
    this._sel = made.id;
    this._send('__merge__', { canvas: made.canvas, ...made.patch });
  }

  /**
   * What can be added, in two groups: something the card does not have yet,
   * and something it has that the canvas is not showing.
   *
   * A kind that has templates opens a second page rather than a flyout beside
   * this one: the menu is `overflow-y: auto` because it has to be - the list
   * of unplaced targets can be longer than the editor - and anything that
   * flew out of it would be clipped by exactly that.
   */
  _renderAddMenu() {
    if (this._menuTemplate) return this._renderRampMenu(this._menuKind, this._menuTemplate);
    if (this._menuKind) return this._renderTemplateMenu(this._menuKind);
    const unplaced = this._unplaced();
    return html`
      <div class="menu">
        <div class="menu-group">New</div>
        ${NEW_ELEMENT_KINDS.map(k => {
          const ok = canAddKind(this.slot, k.kind);
          const hasTemplates = ok && templatesFor(k.kind).length > 0;
          return html`
            <button class="menu-item" ?disabled=${!ok}
                    title=${ok ? '' : "This card's gauge is the card itself, from before a card could have more than one - a second one would replace it."}
                    @click=${() => hasTemplates ? (this._menuKind = k.kind) : this._startPlacing(k.kind)}>
              ${k.label}${hasTemplates ? html`<span class="chev">${icon('chevron-right')}</span>` : ''}
            </button>`;
        })}
        ${unplaced.length ? html`
          <div class="menu-group">Not on the canvas</div>
          ${unplaced.map(t => html`
            <button class="menu-item" @click=${() => this._startPlacing(t.id)}>${
              t.group === 'Basic' ? t.label : `${t.group} - ${t.label}`}</button>`)}` : ''}
      </div>`;
  }

  /**
   * The templates for one kind, each shown as the thing it makes.
   *
   * The miniature is the element itself, rendered from the template with a
   * sample reading - not a picture of one. A screenshot would have to be taken
   * again every time a default moves, would be wrong in the meantime without
   * saying so, and would be lit in whichever theme the person taking it had.
   * This one is right by construction and follows the theme, because it is the
   * same component the canvas is about to put down.
   *
   * @param {string} kind
   */
  _renderTemplateMenu(kind) {
    const k = NEW_ELEMENT_KINDS.find(n => n.kind === kind);
    const cell = `width:${TPL_CELL.w}px; height:${TPL_CELL.h}px;`;
    return html`
      <div class="menu wide">
        <button class="menu-item back" @click=${() => { this._menuKind = null; }}>
          <span class="chev back">${icon('chevron-left')}</span>Back
        </button>
        <div class="menu-group">New ${(k?.label || kind).toLowerCase()}</div>
        <button class="menu-item tpl" @click=${() => this._startPlacing(kind)}>
          <span class="tpl-pv empty" style=${cell}>${icon('plus')}</span>
          <span class="tpl-text"><b>Empty</b><em>Nothing set, the way Add has always made one.</em></span>
        </button>
        ${templatesFor(kind).map(t => html`
          <button class="menu-item tpl" @click=${() => (kind === 'progressbar'
                    ? (this._menuTemplate = t) : this._startPlacing(kind, t))}>
            <span class="tpl-pv" style=${cell}>${this._renderTemplatePreview(kind, t)}</span>
            <span class="tpl-text"><b>${t.label}</b><em>${t.hint}</em></span>
            ${kind === 'progressbar' ? html`<span class="chev">${icon('chevron-right')}</span>` : ''}
          </button>`)}
      </div>`;
  }

  /**
   * What the bar just chosen should mean, as the colours that say it.
   *
   * A bar is two answers, not one: what shape it is, and what its fill means.
   * The three shapes differ in nothing else - they are all 0 to 100 per cent -
   * so the one thing left to decide is the ramp, and a menu that laid the
   * three shapes and the nine ramps out at once would be twenty-seven rows
   * for two questions.
   *
   * The gauge has no such page. Its templates are quantities, and a
   * temperature already knows what its colours mean - offering to recolour
   * one at the moment it is made would be offering to make it wrong.
   *
   * @param {string} kind
   * @param {{ id: string, label: string, hint: string, aspect?: number }} t
   */
  _renderRampMenu(kind, t) {
    const cell = `width:${TPL_CELL.w}px; height:${TPL_CELL.h}px;`;
    return html`
      <div class="menu wide">
        <button class="menu-item back" @click=${() => { this._menuTemplate = null; }}>
          <span class="chev back">${icon('chevron-left')}</span>Back
        </button>
        <div class="menu-group">${t.label} bar - colours</div>
        <button class="menu-item tpl" @click=${() => this._startPlacing(kind, t)}>
          <span class="tpl-pv" style=${cell}>${this._renderTemplatePreview(kind, t)}</span>
          <span class="tpl-text"><b>Default</b><em>The template's own colours - cool to warm, and full is good.</em></span>
        </button>
        ${GRADIENT_PRESETS.map(pr => html`
          <button class="menu-item tpl"
                  @click=${() => this._startPlacing(kind, t, gradientPresetPatch(pr.id, 'bar'))}>
            <span class="tpl-pv" style=${cell}>${
              this._renderTemplatePreview(kind, t, gradientPresetPatch(pr.id, 'bar'))}</span>
            <span class="tpl-text"><b>${pr.label}</b><em>${pr.hint}</em></span>
          </button>`)}
      </div>`;
  }

  /**
   * The largest box of the template's own shape that fits in a preview cell.
   *
   * The shape is the one `newBox` will give the element: a gauge is square
   * because it is locked square, and everything else is the strip unless the
   * template asked for something.
   *
   * @param {string} kind
   * @param {{ aspect?: number }} t
   */
  _previewBox(kind, t) {
    // Clamped, because past about 1:2 a miniature stops being a small picture
    // of the element and becomes a line: the vertical bar's own 1:3 would
    // leave it a third of the cell's height across, too narrow to show that it
    // has a scale down one side. The shape still reads as upright, which is
    // the whole question this row is answering.
    const want = kind === 'gauge' ? 1 : (t.aspect || 3);
    const aspect = Math.min(3, Math.max(0.5, want));
    const w = Math.min(TPL_CELL.w, TPL_CELL.h * aspect);
    return { w: Math.round(w), h: Math.round(w / aspect) };
  }

  /**
   * One miniature, or nothing at all where the renderer is not on the page.
   *
   * `previewFor` lends the element a synthetic entity so the needle stands at
   * a plausible reading instead of against the left stop, which is the only
   * position at which all seven gauges look identical. The `hass` it builds
   * carries that one state and nothing else - the renderers read nothing else
   * off it - so the preview cannot show, or leak, anything of the person's.
   *
   * @param {string} kind
   * @param {{ id: string }} t
   * @param {Record<string, any> | null} [patch] what a second page has added
   */
  _renderTemplatePreview(kind, t, patch = null) {
    const pv = previewFor(kind, t.id);
    if (!pv) return '';
    if (patch) Object.assign(pv.config, patch);
    // The miniature is the shape the click will make, not the cell it sits in:
    // a ring shown in a 3:2 cell is an ellipse, and a vertical bar is a
    // horizontal one. The cell stays one size so the rows keep their rhythm,
    // and the element is fitted inside it.
    const box = this._previewBox(kind, t);
    const el = kind === 'gauge'
      ? html`<sc-gauge .hass=${pv.hass} .config=${pv.config}
                       .globalEntities=${[]} .onCanvas=${true}></sc-gauge>`
      : kind === 'progressbar'
        ? html`<sc-progressbar .hass=${pv.hass} .config=${pv.config}
                               .globalEntities=${[]} .rootConfig=${{}}></sc-progressbar>`
        : '';
    if (!el) return '';
    return html`<span class="tpl-fit"
                      style="width:${box.w}px; height:${box.h}px;">${el}</span>`;
  }

  /**
   * Move one element in the paint order - a step, or all the way.
   *
   * @param {number} idx
   * @param {number|'front'|'back'} to a step is passed as an index
   */
  _reorder(idx, to) {
    const next = reorderElement(this._canvas, idx, to);
    if (next) this._commit(next);
  }

  /**
   * Carry one layer through the list, from its grip.
   *
   * Pointer events rather than HTML5 drag and drop: that API has no touch at
   * all, and Home Assistant is driven from a tablet as often as from a desk.
   * The capture means the grip keeps receiving the move even when the pointer
   * has left the narrow column it started in, which is most of the gesture.
   *
   * Only the grip starts it, so the name beside it stays a click that selects
   * and the buttons stay buttons - a whole row that is draggable swallows
   * both.
   *
   * @param {PointerEvent} e
   * @param {number} idx index into the element array, not the row on screen
   */
  _layerGrab(e, idx) {
    e.preventDefault();
    e.stopPropagation();
    const grip = /** @type {HTMLElement} */ (e.currentTarget);
    grip.setPointerCapture(e.pointerId);
    this._layerDrag = { from: idx, to: idx };

    const move = (/** @type {PointerEvent} */ ev) => {
      const to = this._layerAt(ev.clientY);
      if (to !== null && to !== this._layerDrag?.to) this._layerDrag = { from: idx, to };
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      const drag = this._layerDrag;
      this._layerDrag = null;
      if (drag && drag.to !== drag.from) this._reorder(drag.from, drag.to);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  /**
   * The row the pointer is over, as an index into the element array.
   *
   * Nearest rather than strictly inside, so carrying a layer past either end
   * of the list means the front or the back - which is what the gesture looks
   * like it should mean, and saves reaching for the chevrons to finish.
   *
   * @param {number} y
   * @returns {number | null}
   */
  _layerAt(y) {
    let best = null, near = Infinity;
    for (const row of this.shadowRoot?.querySelectorAll('.layer-list .layer') ?? []) {
      const r = row.getBoundingClientRect();
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < near) { near = d; best = Number(/** @type {HTMLElement} */ (row).dataset.layerIdx); }
    }
    return Number.isInteger(best) ? best : null;
  }

  /**
   * The one control that says who the finger on the canvas belongs to.
   *
   * Drawn twice, above the canvas and below it, and it is the same button
   * both times - a switch you have to scroll to is no use to the scroll that
   * is stuck. Nothing for a mouse, which `touch-action` does not touch.
   */
  _renderFinger() {
    if (!CAN_TOUCH) return '';
    return html`
      <button class="toggle ${this._finger ? 'on' : ''}"
              title=${this._finger
                ? 'A finger on the canvas draws: a frame around several elements, and a pinch to zoom. Press to scroll the editor with it again - the canvas is then passed by rather than drawn on.'
                : 'A finger on the canvas scrolls the editor past it. Press to draw on the canvas with it instead - a selection frame and a pinch to zoom, with the page scrolled beside the canvas.'}
              @click=${() => { fingerDraws = this._finger = !this._finger; }}>${icon(this._finger ? 'pointer' : 'move-vertical')}</button>`;
  }

  /**
   * The objects on the canvas, front at the top.
   *
   * One list, because there used to be two. A stack list and a list of boxes
   * grew side by side over the same objects, in opposite orders, and both
   * could reorder - so the same pair of chevrons meant "up" in one and "down"
   * in the other. Nobody could have read that, and the fold in front of the
   * stack list meant the one you saw first was the one that was wrong way up.
   *
   * Front at the top, because that is the only order a stack may be shown in
   * and the grip is what explains it. A row carries everything that is about
   * the object as a box: where it sits in the stack, whether it is locked,
   * whether it shares its place with another - and, for the one object that
   * is selected alone, its numbers. Not folded away: it is the only list now.
   *
   * Two buttons, not four. One step forward and one step back were the grip
   * before there was a grip, and dragging a row one place is what the grip is
   * best at; the two ends are what it is worst at, because a stack of six in a
   * dialog that scrolls is a drag across half the list where a click will do.
   *
   * @param {any[]} els the canvas elements, in array order
   * @param {string[]} selected the ids currently in hand
   * @param {number} step the snap, which the number fields step by
   */
  _renderObjects(els, selected, step) {
    if (!els.length) return '';
    const last = els.length - 1;
    const rows = els.map((el, idx) => ({ el, idx })).reverse();
    const drag = this._layerDrag;
    return html`
      <div class="objects">
        <div class="objects-head">${icon('layers')} Objects (${els.length}) - the top of the list is drawn on top</div>
        <div class="layer-list">
          ${rows.map(({ el, idx }) => {
            const over = overlappingElements(this._canvas, el.id);
            const name = this._label(el.id);
            const mine = selected.includes(el.id);
            // The numbers belong to one object at a time: with several in hand
            // a single box's x is not what anybody is editing.
            const alone = mine && selected.length === 1;
            return html`
              <div class="layer ${mine ? (selected.length > 1 ? 'co' : 'sel') : ''}
                          ${drag?.from === idx ? 'dragging' : ''}
                          ${drag && drag.to === idx && drag.from !== idx ? 'drop' : ''}"
                   data-layer-idx=${idx}>
                <span class="grip" title="Drag to move it through the stack"
                      @pointerdown=${e => this._layerGrab(e, idx)}>${icon('grip-vertical')}</span>
                <span class="who" title=${el.id} @click=${e => {
                        // The same modifiers as on the canvas, so a selection
                        // can be built from either place.
                        if (e.shiftKey || e.ctrlKey || e.metaKey) this._toggleSel(el.id);
                        else this._selectOnly(el.id);
                      }}>${name ? html`<span class="named">${name}</span>` : ''}<span
                          class="id ${name ? '' : 'only'}">${el.id}</span></span>
                ${over.length ? html`<span class="over"
                  title="Shares its place with ${over.join(', ')}">${icon('layers')}</span>` : ''}
                ${isPinned(el) ? html`<span class="lock"
                  title="Locked - unlock it with the lock under the canvas">${icon('lock')}</span>` : ''}
                <button title="All the way to the front" ?disabled=${idx === last}
                        @click=${() => this._reorder(idx, 'front')}>${icon('chevrons-up')}</button>
                <button title="All the way to the back" ?disabled=${idx === 0}
                        @click=${() => this._reorder(idx, 'back')}>${icon('chevrons-down')}</button>
                ${alone ? html`
                  <span class="nums">
                    ${(isSquareLocked(el, this.slot) ? ['x', 'y', 'size'] : ['x', 'y', 'w', 'h']).map(k => html`
                      <input class="num" type="number" step=${step}
                             .value=${Math.round(k === 'size' ? Math.min(el.w, el.h) : el[k])}
                             title=${k === 'size' ? 'size - this one is always square' : k}
                             @change=${e => {
                               const v = parseFloat(e.target.value) || 0;
                               this._setEl(idx, k === 'size' ? { w: v, h: v } : { [k]: v });
                             }}>`)}
                  </span>` : ''}
              </div>`;
          })}
        </div>
      </div>`;
  }

  /**
   * The selected element's own settings, under the canvas.
   *
   * A mount point, not a second implementation: the editor that owns those
   * fields renders one entry alone when given `only`, so a change to a bar's
   * fields is a change in the progressbar editor and shows up here without
   * anything being kept in step. `.slot` is the config sub-object every
   * editor takes - the property shadows the HTML attribute of that name, the
   * way this editor is itself mounted.
   */
  /**
   * The two settings that belong to the label's box rather than to the label.
   *
   * A label can sit on the canvas more than once - as a whole, and as its
   * icon, name and value on their own - and each of those boxes is a size of
   * its own. So how the text answers that size is a property of the box, and
   * it is edited here rather than in the label's own editor, which has no
   * idea which box is being looked at.
   */
  _renderLabelBoxTypo(id) {
    const idx = this._canvas.elements.findIndex(e => e.id === id);
    if (idx < 0) return '';
    const el = this._canvas.elements[idx];
    const fit = !!el.font_fit;
    return html`
      <div class="row" style="padding:4px 4px 0;">
        <label>Fill the box ${SC.tipDot('Text and icon take the size of the box they are in, '
          + "instead of the card's own font size. Drag the box bigger and they grow with it.")}</label>
        <ha-switch .checked=${fit} @change=${e => this._setEl(idx, { font_fit: e.target.checked || undefined })}></ha-switch>
      </div>
      ${fit ? html`
        <div class="row" style="padding:0 4px 4px;">
          <label title="Lower it when the text leaves too much room to the sides - narrow characters like 1 or . need less width than an average one">Text density</label>
          <div style="display:flex; align-items:center; width:60%; gap:8px;">
            ${SC.slider(el.font_factor || FIT_DENSITY, v => this._setEl(idx, { font_factor: v }),
                        { min: 0.2, max: 0.9, step: 0.05, style: 'flex:1' })}
            <span class="hint" style="width:26px; text-align:right;">${el.font_factor || FIT_DENSITY}</span>
          </div>
        </div>` : ''}`;
  }

  _renderElementConfig(id) {
    const wrap = (title, body) => html`
      <details class="el-config" ?open=${this._configOpen}
               @toggle=${e => { this._configOpen = e.target.open; }}>
        <summary>${title}</summary>
        <div class="el-config-body">${body}</div>
      </details>`;
    // The sub-editor commits through this editor, so a gauge's own settings
    // are steps the arrows above the canvas can walk back through too.
    const props = { hass: this.hass, slot: this.slot, commitFn: (k, v) => this._send(k, v) };

    let m;
    if ((m = id.match(/^progressbar_(\d+)$/))) {
      return wrap('Progressbar settings', html`
        <sc-progressbar-editor .hass=${props.hass} .slot=${props.slot}
                               .commitFn=${props.commitFn} .only=${Number(m[1])}
                               .priority=${this._innerOn && this._innerSel
                                 ? (this._selSpec?.section || '') : ''}
                               .framed=${this._innerFramed}></sc-progressbar-editor>`);
    }
    if ((m = id.match(/^gauge_(\d+)$/))) {
      return wrap('Gauge settings', html`
        <sc-gauge-editor .hass=${props.hass} .slot=${props.slot}
                         .commitFn=${props.commitFn} .only=${Number(m[1])}
                         .priority=${this._innerOn && this._innerSel
                           ? (this._selSpec?.section || '') : ''}
                         .framed=${this._innerFramed}></sc-gauge-editor>`);
    }
    if ((m = id.match(/^label_(\d+)(?:_(?:icon|name|value))?$/))) {
      const box = this._canvas.elements.find(e => e.id === id);
      return wrap('Label settings', html`
        ${this._renderLabelBoxTypo(id)}
        <sc-labels-editor .hass=${props.hass} .slot=${props.slot} .commitFn=${props.commitFn}
                          .only=${Number(m[1])} .boxSized=${!!box?.font_fit}></sc-labels-editor>`);
    }

    const el = this._canvas.elements.find(e => e.id === id);
    // Neither a surface nor the three elements the main entity draws has an
    // editor of its own, so what is theirs rather than the card's is offered
    // here: how they answer a push, and the glass they are seen through.
    // Name and state are left out of the glass - config-cleanup deletes a
    // pattern pointed at either, so offering one would be offering a setting
    // that deletes itself.
    const glassable = el?.surface || id === 'icon';
    const what = el?.surface
      ? 'A surface draws nothing of its own - it is a box for a colour or glass pattern to '
        + 'paint, and for a push to land on.'
      : `${id} comes from the card's main entity, so what it shows is the card's. What it does `
        + 'when pushed is its own.';
    return wrap(html`${el?.surface ? 'Surface settings' : 'Element settings'} ${SC.tipDot(what)}`, html`
      ${el?.surface ? html`
        <div style="padding:0 4px 8px;">
          <sc-color-panel .hass=${props.hass} .slot=${props.slot} .switchless=${true}
                          .framed=${this._inner === id ? this._innerFramed : []}
                          .commitFn=${props.commitFn} .target=${'elm_' + id}></sc-color-panel>
        </div>` : ''}
      <div style="padding:0 4px 8px;">
        <sc-push-panel .hass=${props.hass} .slot=${props.slot}
                       .commitFn=${props.commitFn} .target=${id}></sc-push-panel>
      </div>
      ${glassable ? html`
        <div style="padding:0 4px 8px;">
          <sc-fx-glass-panel .hass=${props.hass} .slot=${props.slot}
                             .commitFn=${props.commitFn} .target=${'elm_' + id}></sc-fx-glass-panel>
        </div>` : ''}`);
  }

  /**
   * Whether an element answers a push, which is what the badge on its box
   * says. A switched-on panel counts even with every action still on "none":
   * the press itself is an answer, and the badge is there to say which boxes
   * take a click away from the card underneath.
   *
   * @param {string} id
   */
  _pushed(id) {
    const list = Array.isArray(this.slot?.interactions) ? this.slot.interactions : [];
    return list.some(p => p?.enabled && p.target === id);
  }

  /**
   * The card's box and the canvas' grid. Rendered by `sc-canvas-dimensions`
   * in the core editor's Card & Dimensions menu rather than here, so that
   * everything above the canvas is the canvas.
   */
  /**
   * The snap grid and the live preview, drawn over the canvas rather than in
   * Card & Dimensions: both describe this picture and nothing else, and both
   * are read while looking at what they change.
   *
   * One line, with the prose in a balloon on the mark rather than under it:
   * the space over the canvas is the space the canvas wants, and an
   * explanation that is read once should not hold a line of it for good. The
   * balloon answers to hover and to focus, so it is reachable from a keyboard
   * and on a touch screen, and it stays when the card's tips are hidden -
   * it costs no height, which is what "Hide tips" is about.
   *
   * The grid is a proportion of the canvas, never a number of units: a unit
   * grid survives only until the canvas is reshaped, and then every element
   * sits between two lines. A canvas still carrying a unit grid is shown its
   * own value as a proportion, and the first edit writes it down that way.
   */
  _renderCanvasSettings() {
    const c = this._canvas;
    const pctGrid = c.grid_unit === 'pct';
    const gridValue = pctGrid ? (c.grid ?? unitsToGrid(c, DEFAULT_GRID))
                              : unitsToGrid(c, c.grid ?? DEFAULT_GRID);
    const snapValue = typeof c.snap === 'number' && c.snap > 0
      ? (pctGrid ? c.snap : unitsToGrid(c, c.snap)) : c.snap;
    // A step the canvas already carries is rarely one of the offered ones, and
    // a select with nothing selected shows its first option instead - the step
    // in force has to be in the list for the field to read true. The list runs
    // up to a half canvas because at that size the step is the layout: 50
    // divides the canvas in two, 33.3 in three, 25 in four.
    const snapSteps = [...new Set([1, 2, 5, 10, 20, 25, 33.3, 50,
                                   ...(typeof snapValue === 'number' && snapValue > 0 ? [snapValue] : [])])]
      .sort((a, b) => a - b);

    const gridTip = 'Per cent of the canvas width, so the grid keeps its proportions when '
      + 'the canvas is reshaped.'
      + (gridValue > 0 ? ` Currently ${gridToUnits({ ...c, grid_unit: 'pct' }, gridValue)} of ${c.w} units.` : '');
    const hlTip = 'The part in hand blinks on the drawing itself and is lent a colour that stands out against what it is drawn on - the mark, not a frame round it. A colour just changed is shown plain for five seconds first, so the highlight is never what you are judging it by.';
    // The switch says what the card is set to; while an element is open the
    // preview is on over the top of it, and the tip is what says so - a
    // switch that reads "on" and cannot be thrown explains nothing on its own.
    const liveHeld = this._innerOn && this.slot?.live_preview === false;
    const liveTip = liveHeld
      ? 'On for as long as this element\'s own parts are in hand - the frames sit on the drawing. Back to plain boxes when it is closed.'
      : (this._live
          ? "The real gauges and bars. Text sizes are the card's, not this preview's."
          : 'Plain boxes - easier to see and to grab.');

    return html`
      <div class="canvas-settings">
        <span class="settings-label">Grid / snap ${SC.tipDot(gridTip)}</span>
        <select @change=${e => {
          const v = e.target.value;
          this._setGridPct({ snap: v === 'grid' ? undefined : (v === 'free' ? 0 : parseFloat(v)) });
        }}>
          <option value="grid" ?selected=${snapValue === undefined}>Snap to grid</option>
          <option value="free" ?selected=${snapValue === 0}>Free</option>
          ${snapSteps.map(n => html`
            <option value=${n} ?selected=${snapValue === n}>Step ${n}%</option>`)}
        </select>
        <input class="num" type="number" min="0" step="any" .value=${gridValue}
               @change=${e => this._setGridPct({ grid: Math.max(0, parseFloat(e.target.value) || 0) })}>
        <span class="hint">%</span>
        <span class="gap"></span>
        <span class="settings-label">Live preview ${SC.tipDot(liveTip, { right: true })}</span>
        <ha-switch .checked=${this._live} .disabled=${liveHeld}
                   @change=${e => this._send('live_preview', e.target.checked ? undefined : false)}></ha-switch>
        <span class="gap"></span>
        <span class="settings-label">Highlight ${SC.tipDot(hlTip, { right: true })}</span>
        <ha-switch .checked=${this._hl}
                   @change=${(/** @type {any} */ e) => { this._hl = e.target.checked; }}></ha-switch>
      </div>`;
  }

  _renderDimensions() {
    const rows = this._rows;
    const columns = this._columns;
    const maxColumns = this._maxColumns;
    const mismatch = this._gridMismatch;
    const full = columns === 'full';

    return html`
      <div class="col">
        <div class="row">
          <label>Card width ${SC.tipDot('A width here is one column of the section. The Layout '
            + 'tab counts in cells of three columns unless its Precise mode is on - so this field '
            + 'is like that switch already on.')}</label>
          <div class="ctl">
            <select @change=${e => this._setFullWidth(e.target.value === 'full')}>
              <option value="columns" ?selected=${!full}>of ${maxColumns} columns</option>
              <option value="full" ?selected=${full}>Full width</option>
            </select>
            ${full ? '' : html`
              <input class="num" type="number" min="1" max=${maxColumns} step="1" .value=${columns}
                     @change=${e => {
                       const n = Math.max(1, Math.min(maxColumns, parseInt(e.target.value) || 1));
                       // lit writes .value only when the bound value changes, so a
                       // number that clamps back to the one already set would leave
                       // the field showing what was typed instead.
                       e.target.value = String(n);
                       this._setGrid({ columns: n });
                     }}>`}
            <span class="hint">${Math.round(gridColumnsToPx(columns, maxColumns))} px</span>
          </div>
        </div>
        <div class="row">
          <label>Card height ${SC.tipDot(rows === null
            ? 'The canvas is as wide as its columns and a third of that tall, at any width - so '
              + 'the card keeps its proportions and nothing letterboxes. For a shape of your own, '
              + 'set a fixed height in rows.'
            : "Auto height is off, so the card's height is pinned in the Layout tab and the canvas "
              + 'is reshaped to match it. Turn it back on to let the shape decide the height '
              + 'again.')}</label>
          <div class="ctl">
            <select @change=${e => this._setAutoHeight(e.target.value === 'auto')}>
              <option value="auto" ?selected=${rows === null}>Auto height</option>
              <option value="rows" ?selected=${rows !== null}>rows, fixed</option>
            </select>
            ${rows === null ? '' : html`
              <input class="num" type="number" min="1" max="50" .value=${rows}
                     @change=${e => this._setShapeRows(Math.max(1, parseInt(e.target.value) || 1))}>
              <span class="hint">${gridRowsToPx(rows)} px</span>`}
          </div>
        </div>
        ${mismatch ? html`
          <div class="hint" style="margin:-4px 0 4px 0; display:flex; gap:8px; align-items:center;">
            <span style="flex:1">The canvas is a different shape from the card, so it letterboxes inside it.</span>
            <button class="add-btn" style="width:auto; padding:5px 10px;" @click=${() => this._matchGrid()}>
              Match the card
            </button>
          </div>` : ''}
      </div>
    `;
  }

  render() {
    if (!this.slot?.canvas) return html``;
    const c = this._canvas;
    const els = Array.isArray(c.elements) ? c.elements : [];
    const step = resolveSnap(c);
    const gridPct = (c.grid > 0 ? gridToUnits(c, c.grid) : step) / c.w * 100;
    const pct = (v, total) => `${v / total * 100}%`;
    // The list below the canvas shows the selected elements alone, so an id
    // that no longer names one - a gauge deleted in its own editor, say -
    // would leave it empty. Fall back to the whole list.
    const alive = id => els.some(e => e.id === id);
    const sel = alive(this._sel) ? this._sel : null;
    const selected = this._selection.filter(alive);
    const inner = this._innerTarget;
    // A frame in hand borrows the two middle-axis buttons for itself, and
    // several frames held together borrow the whole row: lining texts up with
    // each other is the same question as lining elements up, asked of what is
    // inside one of them.
    const held = this._innerOn ? this._innerHeld : [];
    const centring = held.length ? inner?.parts[held[0]] : null;
    const heldMany = held.length > 1;
    const movers = this._distributable;
    // Three groups, in the order the work is usually done: the gaps first,
    // then the edges, then the middles - which are also the two a gauge's own
    // label and value borrow, so they sit together at the end.
    const alignBtn = ([edge, what]) => {
      // Three readings of the same button, in the order a press is meant:
      // the middles put whatever is held back on the gauge's own axis, the
      // edges line the held parts up on each other, and with nothing held
      // they do what they have always done to the elements.
      const onParts = centring && (MIDDLE_AXIS[edge] || heldMany);
      const title = !onParts
        ? (movers < 2
            ? 'Two selected elements that can move are needed to line anything up'
            : `${what}. The outermost of them stays where it is.`)
        : (MIDDLE_AXIS[edge]
            ? `Put ${heldMany ? 'everything held' : `the ${centring.label.toLowerCase()}`} back on the ${inner.k.noun}'s ${MIDDLE_AXIS[edge].what} middle`
            : `${what}, among the parts held. The outermost of them stays where it is.`);
      return html`
        <button title=${title}
                ?disabled=${onParts ? false : movers < 2}
                @click=${() => (!onParts
                  ? this._align(/** @type {any} */ (edge))
                  : (MIDDLE_AXIS[edge]
                      ? this._innerAlign(MIDDLE_AXIS[edge].axis)
                      : this._innerAlignEdge(/** @type {any} */ (edge))))}>${alignIcon(/** @type {any} */ (edge))}</button>`;
    };

    return html`
      <div class="col ${centring ? 'part-in-hand' : ''}">
        <style>${this._live ? els.filter(e => !e.surface).map(el => itemTypography(el,
          `.el.live[data-item-id="${el.id}"]`,
          `.el.live[data-item-id="${el.id}"] > :not(${EDITOR_FURNITURE})`)).join('\n') : ''}</style>

        <div class="tool-row">
          <div class="menu-wrap">
            <button class="add-btn" style="width:auto; padding:6px 12px;"
                    @click=${() => { this._menu = !this._menu; this._menuKind = null;
                                     this._menuTemplate = null;
                                     this._placing = null; this._placingTemplate = null;
                                     this._placingEntry = null; }}>
              ${icon('plus')} Add element
            </button>
            ${this._menu ? this._renderAddMenu() : ''}
          </div>
          ${this._placing ? '' : SC.tipDot('Later in the list draws on top. A gauge and a '
                     + 'round bar stay square and fill their box.')}
          <button class="add-btn apply-btn" style="width:auto; padding:6px 12px;"
                  ?disabled=${this._applyState === 'saving' || !this._canApply}
                  title=${this._canApply
                    ? 'Put the card on the dashboard now and carry on - the dialog stays open'
                    : 'Nothing to save - the dashboard already has this card'}
                  @pointerenter=${() => this._refreshApply()}
                  @click=${() => this._apply()}>
            ${this._applyState === 'saved' ? html`${icon('check')} Saved`
              : this._applyState === 'saving' ? html`${icon('save')} Saving…`
              : html`${icon('save')} Apply`}
          </button>
          ${this._applyError ? html`<span class="hint apply-error">${this._applyError}</span>` : ''}
          ${this._placing
            // The one line of prose that is not an explanation but an
            // instruction for a mode the editor is in, so it stays on screen.
            ? html`<span class="hint" style="flex:1">Click on the canvas to place the
                   ${this._placingLabel}. Escape cancels.</span>`
            : html`<span style="flex:1"></span>`}
          <div class="names history">
            <button title=${this._undoStack.length
                      ? 'Undo the last change to the canvas or its elements'
                      : 'Nothing to undo yet'}
                    ?disabled=${!this._undoStack.length}
                    @click=${() => this._undo()}>${icon('undo-2')}</button>
            <button title=${this._redoStack.length
                      ? 'Do it again'
                      : 'Nothing to redo'}
                    ?disabled=${!this._redoStack.length}
                    @click=${() => this._redo()}>${icon('redo-2')}</button>
          </div>
          <div class="names">
            ${this._renderFinger()}
            <button class="toggle ${this._names ? 'on' : ''}"
                    title="Put each element's name on its box. Off, a box says its id - which is what the lists, the glass targets and the colour rules call it."
                    @click=${() => { this._names = !this._names; }}>Names</button>
          </div>
        </div>

        ${this._renderCanvasSettings()}

        <div class="canvas-wrap">
          <div class="canvas-pad ${this._space ? 'hand' : ''} ${this._finger ? 'finger' : ''}"
               @pointermove=${this._onMove}
               @pointerup=${this._onUp}
               @pointercancel=${this._onUp}
               @pointerdown=${this._onCanvasDown}
               @auxclick=${e => { if (e.button === 1) e.preventDefault(); }}
               @wheel=${this._onWheel}>
          <div class="canvas-view" @scroll=${this._onViewScroll}
               style="aspect-ratio:${c.w} / ${c.h * this._viewStretch};">
          <div class="canvas ${this._pushed('main') ? 'pushed' : ''}" style="aspect-ratio:${c.w} / ${c.h}; width:${this._zoom * 100}%;">
            <div class="grid" style="background-size:${gridPct}% ${gridPct * c.w / c.h}%;"></div>
            ${this._placing ? html`
              <div class="place-layer" @pointerdown=${this._place}
                   @pointermove=${this._ghostAt}
                   @pointerleave=${this._dropGhost}>
                ${this._ghost ? html`
                <div class="ghost ${this._ghost.surface ? 'surface' : ''}"
                     style="left:${pct(this._ghost.x, c.w)}; top:${pct(this._ghost.y, c.h)}; width:${pct(this._ghost.w, c.w)}; height:${pct(this._ghost.h, c.h)};"
                     >${this._ghost.id}</div>` : ''}
              </div>` : ''}
            ${this._band?.live ? html`
              <div class="band" style="left:${pct(Math.min(this._band.x0, this._band.x1), c.w)}; top:${pct(Math.min(this._band.y0, this._band.y1), c.h)}; width:${pct(Math.abs(this._band.x1 - this._band.x0), c.w)}; height:${pct(Math.abs(this._band.y1 - this._band.y0), c.h)};"></div>` : ''}
            ${els.map((el, idx) => {
              // Live through a drag as well: it moves boxes and commits
              // nothing until the pointer is let go, so no element is handed
              // a new config in the meantime and nothing re-renders that the
              // drag did not move.
              const live = this._live ? this._liveContent(el) : null;
              const pinned = isPinned(el);
              return html`
              <div class="el ${el.surface ? 'surface' : ''} ${this._bentEl(el) ? 'bent' : ''} ${isBent(this._bendsOf(el)) ? 'outlined' : ''} ${this._inner === el.id ? 'inner' : ''} ${live ? 'live' : ''} ${this._isSel(el.id) ? 'sel' : ''} ${pinned ? 'pinned' : ''} ${this._pushed(el.id) ? 'pushed' : ''}"
                   style="left:${pct(el.x, c.w)}; top:${pct(el.y, c.h)}; width:${pct(el.w, c.w)}; height:${pct(el.h, c.h)};"
                   data-item-id=${el.id} title=${this._title(el, pinned)}
                   @pointerdown=${e => this._onDown(e, idx, 'move')}>
                ${this._surfaceSkin(el)}
                ${this._bentOutline(el)}
                ${live ?? el.id}
                ${inner?.id === el.id ? html`
                  <button class="inner-open ${this._innerOn ? 'on' : ''}"
                          title=${this._innerOn
                            ? `Done with this ${inner.k.noun}'s own parts`
                            : `Take this ${inner.k.noun}'s own parts in hand - ${inner.k.holds}`
                              + (this.slot?.live_preview === false
                                  ? ', with the live preview on for as long as it is open'
                                  : '')}
                          @pointerdown=${(/** @type {any} */ e) => { e.stopPropagation(); e.preventDefault(); }}
                          @click=${() => this._toggleInner()}>${icon('pencil')}</button>` : ''}
                ${this._innerOn ? '' : html`
                <button class="el-lock"
                        title=${pinned
                          ? 'Locked - press to let it be dragged again'
                          : 'Lock in place, so a stray drag cannot move it'}
                        @pointerdown=${(/** @type {any} */ e) => { e.stopPropagation(); e.preventDefault(); }}
                        @click=${() => this._toggleLock(el.id)}>${icon(pinned ? 'lock' : 'lock-open')}</button>`}
                ${this._innerOn && this._inner === el.id ? this._renderInner() : ''}
                ${pinned || selected.length > 1 ? '' : html`
                <div class="handle" @pointerdown=${e => this._onDown(e, idx, 'resize')}></div>`}
              </div>`;
            })}
            ${this._names ? html`
              <div class="tags">
                ${els.map(el => html`
                  <div class="tag" style="left:${pct(el.x, c.w)}; top:${pct(el.y + el.h, c.h)}; max-width:${(1 - el.x / c.w) * 100}%;">${this._label(el.id) || el.id}</div>`)}
              </div>` : ''}
          </div>
          </div>
          </div>
        </div>

        <div class="tools">
          <div class="group">
            <button title=${movers < 3
                      ? 'Three selected elements that can move are needed to even out the gaps between them'
                      : 'Even gaps left to right. The outermost two stay where they are.'}
                    ?disabled=${movers < 3}
                    @click=${() => this._distribute('x')}>${icon('align-horizontal-distribute-center')}</button>
            <button title=${movers < 3
                      ? 'Three selected elements that can move are needed to even out the gaps between them'
                      : 'Even gaps top to bottom. The outermost two stay where they are.'}
                    ?disabled=${movers < 3}
                    @click=${() => this._distribute('y')}>${icon('align-vertical-distribute-center')}</button>
          </div>
          <div class="group">${[['left', 'Line up their left edges'],
                                ['right', 'Line up their right edges'],
                                ['top', 'Line up their top edges'],
                                ['bottom', 'Line up their bottom edges']].map(alignBtn)}</div>
          <div class="group">${[['hcenter', 'Line them up through one vertical middle'],
                                ['vcenter', 'Line them up through one horizontal middle']].map(alignBtn)}</div>
          <span class="spacer"></span>
          <div class="group">
            <button class="toggle ${this._allLocked && selected.length ? 'on' : ''}"
                    title=${!selected.length
                      ? 'Select an element to lock it in place'
                      : (this._allLocked
                          ? `Let ${selected.length === 1 ? 'it' : 'them'} be dragged again`
                          : 'Lock in place, so a stray drag cannot move it')}
                    ?disabled=${!selected.length}
                    @click=${() => this._lockSelection()}>${icon(this._allLocked ? 'lock' : 'lock-open')}</button>
            <button title=${!selected.length
                      ? 'Select an element to copy it'
                      : (this._copyable === selected.length
                          ? `Copy ${selected.length === 1 ? 'it' : `all ${selected.length}`}`
                          : (this._copyable
                              ? `Copy the ${this._copyable} of them that can be copied`
                              : 'The card has only one of these, so there is nothing to copy'))}
                    ?disabled=${!this._copyable}
                    @click=${() => this._duplicateSelection()}>${icon('copy')}</button>
            <button class="danger" title=${!selected.length
                      ? 'Select an element to take it off the canvas'
                      : `Take ${selected.length === 1 ? 'it' : `all ${selected.length}`} off the canvas`}
                    ?disabled=${!selected.length}
                    @click=${() => this._removeSelection()}>${icon('trash-2')}</button>
          </div>
          ${CAN_TOUCH ? html`<div class="group">${this._renderFinger()}</div>` : ''}
          <div class="group">
            <button title="Zoom out" ?disabled=${this._zoom <= ZOOM_MIN}
                    @click=${() => this._stepZoom(-1)}>${icon('zoom-out')}</button>
            <span class="hint level">${Math.round(this._zoom * 100)}%</span>
            <button title="Zoom in" ?disabled=${this._zoom >= ZOOM_MAX}
                    @click=${() => this._stepZoom(1)}>${icon('zoom-in')}</button>
            <button title=${selected.length
                      ? 'Fill the window with what is selected'
                      : 'Select an element to zoom in on it'}
                    ?disabled=${!selected.length}
                    @click=${() => this._zoomToSelection()}>${icon('scan')}</button>
            <button class="toggle ${this._zoomBack ? '' : 'on'}"
                    title=${this._zoomBack
                      ? 'Leaving an element takes the canvas back to the zoom it was being arranged at. Press to keep the magnification instead - useful when one element after another is being worked on close up.'
                      : 'The magnification stays when an element is left. Press to have the canvas go back to the zoom it was being arranged at.'}
                    @click=${() => { zoomBack = this._zoomBack = !this._zoomBack; }}>${icon(this._zoomBack ? 'pin-loose' : 'pin-in')}</button>
            <button title="Back to 100%, the size at which the whole canvas fits. Zoomed in, the middle button or space and the left one move the view; Ctrl or Cmd with the wheel - or two fingers - zooms where the pointer is, and Ctrl or Cmd with +, - and 0 does it from the keyboard."
                    ?disabled=${this._zoom === 1} @click=${() => this._applyZoom(1)}>${icon('rotate-ccw')}</button>
          </div>
        </div>

        ${this._renderObjects(els, selected, step)}
        <div class="hint">${selected.length > 1
          ? html`${selected.length} selected - dragging one moves them all, and the buttons under the canvas copy them or even out the gaps. An element's own settings are back when it is the only one selected.`
          : (sel
            ? html`Click the canvas background to list every element again. Shift-click a second element to move them together.`
            : html`Click an element on the canvas to work on it here, or drag a frame on the background to take several.`)}</div>

        ${sel && selected.length === 1 ? this._renderElementConfig(sel) : ''}

      </div>`;
  }
}
if (!customElements.get('sc-canvas-editor')) customElements.define('sc-canvas-editor', ScCanvasEditor);

/**
 * The card's box, the canvas' grid and the two view switches, rendered inside
 * the core editor's Card & Dimensions menu - where the rest of what the card
 * is, rather than what is drawn on it, is set.
 *
 * It is the canvas editor itself, drawing one part of itself: every getter
 * these controls read - the section's width, the row count, the reshaping - is
 * already written there, and a second copy of that arithmetic is the last
 * thing this card needs. What it must not inherit is the canvas editor's
 * *behaviour*: the document-wide keys and the reshape-on-cardConfig-change
 * would then happen twice per edit.
 */
class ScCanvasDimensions extends ScCanvasEditor {
  static get styles() { return [SC.formStyles, ScCanvasEditor.styles[1]]; }
  connectedCallback() { LitElement.prototype.connectedCallback.call(this); }
  disconnectedCallback() { LitElement.prototype.disconnectedCallback.call(this); }
  updated() {}

  /**
   * These controls sit in another menu but write the same `canvas` and
   * `grid_options` the canvas editor's arrows walk back through, so the step
   * belongs on that editor's stack. Kept here, it would be on a stack with no
   * arrows - and the editor's own last snapshot, still holding the size the
   * user has since changed, would quietly revert it on the next undo.
   */
  _send(key, value) {
    // Card & Dimensions is a shadow root of its own, one level in from the one
    // the canvas editor sits in, so the search climbs out through the hosts.
    let root = /** @type {any} */ (this.getRootNode());
    for (let hops = 0; root && hops < 5; hops++) {
      const editor = root.querySelector?.('sc-canvas-editor');
      if (editor && editor !== this) { editor._send(key, value); return; }
      root = root.host ? root.host.getRootNode() : null;
    }
    super._send(key, value);
  }
  render() { return this.slot?.canvas ? this._renderDimensions() : html``; }
}

if (!customElements.get('sc-canvas-dimensions')) customElements.define('sc-canvas-dimensions', ScCanvasDimensions);


/**
 * Writes down the canvas the card is already drawing, once, when the editor
 * opens.
 *
 * Two cards come here, and neither of them has a picture to lose. A rows
 * layout is already being drawn as a canvas - rows-compat.js builds it in
 * memory on every load - so writing it down changes the model and nothing
 * else. A card with no layout and at most one object has nothing to arrange:
 * the one element fills the card exactly as the content row drew it. See
 * `contentRowArranges` for where that line is and why.
 *
 * A card with no layout and several objects is *not* here. Stacking its
 * contents into bands is a new arrangement however faithful the contents, so
 * that one gets the offer and its button.
 *
 * `layout_rows` is left in the config either way, so a migration that lands
 * badly is undone by deleting `canvas` in the YAML editor.
 *
 * The write happens on open rather than at render because a Lovelace card
 * cannot persist its own config outside the editor. This is the only place that
 * can. It is staged in the dialog like any other edit, so Cancel discards it.
 *
 * The shape is measured the way Convert measured it: the section's column count
 * and width are read from this element, which sits inside the edit dialog where
 * both are to be had. `canvasFromBox` is not used, because the card itself is
 * not this element and cannot be measured through it.
 *
 * It renders nothing. The commit replaces it with the canvas editor on the next
 * update, and a card whose commit has not come back yet has nothing to say.
 */
class ScCanvasAdopt extends LitElement {
  static get properties() { return { slot: { type: Object }, cardConfig: { type: Object } }; }

  firstUpdated() {
    // One write per element, however often lit updates it: a second commit in
    // the same dialog would be built from the same rows and overwrite whatever
    // the first one has since been edited into.
    if (this._done) return;
    this._done = true;

    const slot = this.slot || {};
    const columns = sectionColumns(this), px = sectionWidthPx(this);
    const shape = canvasFromGrid(this.cardConfig, slot, 400, columns, px);
    const migrated = needsRowsCompat(slot)
      ? rowsAsCanvas(slot, shape.w, shape.h)
      // The content row's own canvas, built the way the offer's button builds
      // it. Pill was a card *shape* and the canvas has only a corner radius;
      // half the shorter side is the same stadium, so a round card stays
      // round instead of being squared off by a change of model. It travels
      // in this commit, because a second one in the same tick is lost.
      : { canvas: canvasFromCard(this.cardConfig, slot, columns, px),
          ...(SC.cardIsPill(slot)
            ? { border_radius: 50, border_radius_unit: '%', border_radius_ref: 'min' }
            : {}) };
    // `layout_active` travels with it. The canvas is what the card draws from
    // now, and a canvas without that switch is one nobody sees - which is how
    // the last rows cards ended up carrying a picture and showing their plain
    // content row instead. A layout that was switched off comes on, because
    // the alternative is a card that cannot be laid out at all. It travels in
    // this commit: a second one in the same tick would be lost.
    if (!migrated) return;
    // Nobody asked for that commit, so it must not count as unsaved work: a
    // dirty dialog turns Home Assistant's light dismiss off, and the card then
    // refuses to close when the dashboard beside it is clicked. See
    // `markDialogClean`. The dialog is looked up first, because the commit
    // replaces this element with the canvas editor and there is no walking up
    // out of a detached one; and it is told afterwards, because Home Assistant
    // has to have taken the commit in before it can be told to forget it.
    const dialog = editingDialog(this);
    this.commitFn('__merge__', { ...migrated, layout_active: true });
    setTimeout(() => markDialogClean(dialog));
  }

  render() { return html``; }
}
if (!customElements.get('sc-canvas-adopt')) customElements.define('sc-canvas-adopt', ScCanvasAdopt);

// --- BRIDGE TO CORE ---
window.SupercardModules['layout'] = window.SupercardModules['layout'] || {};
Object.assign(window.SupercardModules['layout'], (() => {
  function resolveElement(shadow, id) {
    if (id === 'icon')  return shadow.querySelector('#icon');
    if (id === 'name')  return shadow.querySelector('#header');
    if (id === 'state') return shadow.querySelector('#state');
    if (id.startsWith('gauge_')) return shadow.querySelector(`sc-gauge[data-idx="${id.split('_')[1]}"]`);
    if (id.startsWith('progressbar_')) return shadow.querySelector(`sc-progressbar[data-idx="${id.split('_')[1]}"]`);
    return null;
  }

  function update({ config }) {
    if (!config?.layout_active) return {};
    return { litOverlay: html`<sc-layout-renderer .config=${config}></sc-layout-renderer>` };
  }

  function onAfterRender(shadow, config) {
    const contentRow = shadow.querySelector('.sc-content-row');
    if (!config?.layout_active) {
      if (contentRow) contentRow.style.display = 'flex';
      return;
    }
    const renderer = shadow.querySelector('sc-layout-renderer');
    if (!renderer) return;
    if (contentRow) contentRow.style.display = 'none';

    const assignSlot = (el, slotName) => {
      if (!el) return;
      if (slotName === 'icon') el.classList.add('sc-primary-icon');
      if (slotName === 'name') el.classList.add('sc-lbl-n');
      if (slotName === 'state') el.classList.add('sc-lbl-v');
      if (el.slot !== slotName) el.slot = slotName;
      if (el.parentElement !== renderer) renderer.appendChild(el);
    };

    // Which elements exist is the canvas's answer and nothing else's.
    if (!Array.isArray(config.canvas?.elements)) return;

    const placed = new Set(config.canvas.elements.map(el => el.id));
    // assignSlot moved these out of the template lit created them in, so lit
    // cannot take them back when the module stops rendering them. One whose
    // element has been removed from the canvas would stay here for good -
    // invisible, still bound to hass, and still the first thing
    // resolveElement finds if that element is ever placed again.
    [...renderer.children].forEach(node => {
      const tag = node.tagName;
      if (tag !== 'SC-GAUGE' && tag !== 'SC-PROGRESSBAR') return;
      if (!placed.has(node.slot)) node.remove();
    });
    config.canvas.elements.forEach(el => {
      if (el.surface || el.id?.startsWith('label_')) return;
      assignSlot(resolveElement(shadow, el.id), el.id);
    });
  }

  /**
   * A card with a canvas gets the canvas editor; a card whose canvas can be
   * written down without inventing anything is given it and then gets the same
   * editor; only a card where the switch would *rearrange* something is
   * offered one.
   *
   * Migrating and offering differ by whether a layout has to be invented. A
   * rows layout migrates position for position - one that is switched on is
   * already being drawn as a canvas on the dashboard, rows-compat.js does that
   * in memory on every load; one that is switched off is a draft, and
   * `rowsToRead` shares the card between its rows rather than believing a
   * height nobody has ever seen. A card that never had a layout draws the
   * content row, and there the count decides: one object, or none, is not an
   * arrangement and comes along on its own, while several are stacked into
   * bands that nobody chose and so stay behind a button. See
   * `contentRowArranges`.
   */
  function renderCustomBlock(commitFn, hass, slot, cardConfig) {
    if (slot?.canvas) {
      return html`<sc-canvas-editor style="display:block; margin-bottom:16px;"
                                    .slot=${slot} .hass=${hass} .cardConfig=${cardConfig}
                                    .commitFn=${commitFn}></sc-canvas-editor>`;
    }
    if (needsRowsCompat(slot) || !contentRowArranges(cardConfig, slot)) {
      return html`<sc-canvas-adopt .slot=${slot} .cardConfig=${cardConfig}
                                   .commitFn=${commitFn}></sc-canvas-adopt>`;
    }
    return html`
      <div style="margin: 0 16px 16px 16px; padding: 10px 12px; border: 1px dashed var(--primary-color,#03a9f4); border-radius: 6px; font-size: 12px; color: var(--secondary-text-color); display: flex; align-items: center; gap: 12px;">
        <span style="flex:1">
          <b style="color:var(--primary-text-color)">Start on the canvas.</b>
          Everything the card shows comes along - laid out top to bottom as a
          starting point, then dragged and sized wherever you want it. You can
          switch back by deleting <code>canvas</code> in the YAML editor.
        </span>
        <button type="button" style="background: var(--primary-color,#03a9f4); border: none; color: #fff; padding: 7px 12px; border-radius: 6px; cursor: pointer; font-weight: 600; white-space: nowrap;"
          @click=${e => {
            // Pill was a card *shape*, and the canvas has only a corner radius.
            // Half the shorter side is the same stadium, so a round card stays
            // round instead of being squared off by a change of model. It
            // travels in this commit; a second one in the same tick is lost.
            const pillAsRadius = SC.cardIsPill(slot)
              ? { border_radius: 50, border_radius_unit: '%', border_radius_ref: 'min' }
              : {};
            // layout_active gates the renderer, so a canvas without it is a
            // canvas nobody sees.
            commitFn('__merge__', {
              canvas: canvasFromCard(cardConfig, slot,
                sectionColumns(e.currentTarget), sectionWidthPx(e.currentTarget)),
              layout_active: true, ...pillAsRadius });
          }}>
          Use canvas
        </button>
      </div>`;
  }

  return /** @type {SupercardModule} */ ({ update, onAfterRender, editorFields: () => [], renderCustomBlock });
})());