import { LitElement, html, svg, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { normalizeStops, stopsToCss } from "./gradient-stops.js";
import { squareBarOnCanvas } from "./canvas-model.js";
import { lightParams, reliefPattern, reliefShadow, reliefLayers } from "./glass-light.js";
import { isLiquidEffect, pillLensFraction, liquidPillCSS, liquidPadding, pillFontSize,
         pillCrossExtent } from "./pill-glass.js";
import { applyLensGeometry, lensFilterElement } from "./glass-lens.js";
import { suspendable, watchModalSuspend } from "./glass-suspend.js";
import { icon } from "./icons.js";
import { adaptiveInk } from "./adaptive-ink.js";
import { gradientPresetPatch } from "./gradient-presets.js";

const SC = window.SupercardUtils;

// ==========================================
// 1. HELPER FUNCTIONS
// ==========================================
const { safeFloat, hexToRgb, rgbToHex, sampleGradient } = window.SupercardUtils;

// Scoped by the component's shadow root, the same way the goo filter is: one
// pill per bar, so one id per shadow tree is all that is ever needed.
const LENS_FILTER_ID = 'sc-pill-lens';

const parseDim = (v, fallback, unit = 'px') => {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? `${s}${unit}` : s;
};

// A concrete hex, for contrast maths and for feeding CSS directly. Theme
// vars are resolved here because the caller needs a number now; a hex is
// passed through verbatim so #rrggbbaa keeps its alpha.
function extractHex(c) {
  if (!c) return '#000000';
  const s = SC.resolveVar(String(c).trim());
  if (s.startsWith('#')) return s;
  const rgb = SC.toRgb(s);
  return rgb ? rgbToHex(rgb[0], rgb[1], rgb[2]) : '#ffffff';
}

function solveCubicBezier(x, p1x, p1y, p2x, p2y) {
  const cx = 3*p1x, bx = 3*(p2x-p1x)-cx, ax = 1-cx-bx;
  const cy = 3*p1y, by = 3*(p2y-p1y)-cy, ay = 1-cy-by;
  const sampleX = t => ((ax*t+bx)*t+cx)*t;
  const sampleY = t => ((ay*t+by)*t+cy)*t;
  const derivX  = t => (3*ax*t+2*bx)*t+cx;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const d = sampleX(t) - x;
    if (Math.abs(d) < 1e-6) break;
    t -= d / derivX(t);
  }
  return sampleY(t);
}

function getLuminance(hex) {
  try {
    const [r,g,b] = hexToRgb(hex).map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126*r + 0.7152*g + 0.0722*b;
  } catch { return 0; }
}

function contrastColor(hex) {
  try { return getLuminance(hex) > 0.179 ? '#000000' : '#ffffff'; }
  catch { return '#ffffff'; }
}

// True only when a colour is certainly fully opaque. Anything we cannot resolve
// here (var(), named colours, color-mix) counts as translucent, so the caller
// keeps whatever it would have drawn.
function isOpaqueColor(c) {
  if (!c) return false;
  const s = String(c).trim().toLowerCase();
  if (s === 'transparent' || s.startsWith('var(')) return false;
  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const h = hex[1];
    if (h.length === 4) return h[3] === 'f';
    if (h.length === 8) return h.slice(6) === 'ff';
    return h.length === 3 || h.length === 6;
  }
  const fn = s.match(/^(?:rgba?|hsla?)\(([^)]*)\)$/);
  if (fn) {
    const parts = fn[1].split(/[\s,\/]+/).filter(Boolean);
    return parts.length < 4 || parseFloat(parts[3]) >= 1;
  }
  return false;
}

// The curve a bar travels on: a plain ease, or a decaying bounce whose
// intensity the user sets. It used to be handed to CSS as a linear() sampled
// every 2 %; now the frame loop evaluates it, which is the curve those samples
// were approximating.
function bounceEaseFn(intensity) {
  if (!intensity || intensity <= 0) return t => solveCubicBezier(t, 0.4, 0, 0.2, 1);
  const amount = intensity / 100;
  return t => 1 - Math.exp(-t * (8 - 4 * amount)) * Math.cos(t * (10 + 10 * amount));
}


// ==========================================
// 2. THE COMPONENT
// ==========================================
const ELM_BASE    = 700; 
const ELM_STATIC  = 800; 
const ELM_DYNAMIC = 900; 
const ELM_FLOAT   = 1000; 

// EXPERIMENT ONLY (perf/cpu-investigation): window.SC_FRAME_SKIP = false turns
// the frame skipping off so the two can be measured against each other in one
// build. Goes away with the fix.
const SC_FRAME_SKIP_DEFAULT = true;
const SC_ANIM_FPS_CAP = 30;

class ScProgressbar extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      rootConfig: { type: Object },
      globalEntities: { type: Array },
      _isInitialized: { type: Boolean, state: true },
      _displayPct: { type: Number, state: true },
      _isAtLeftEdge: { type: Boolean, state: true },
      _isAtRightEdge: { type: Boolean, state: true }
    };
  }

  constructor() {
    super();
    this._isInitialized = false;
    this._displayPct = 0;
    this._targetPct  = null;
    this._animFrame  = null;
    this._isAtLeftEdge = false;
    this._isAtRightEdge = false;
    this._boxW = 0;
    this._boxH = 0;
  }

  firstUpdated() {
    setTimeout(() => { this._isInitialized = true; }, 50);
    this._checkEdges();
    this._resizeObs = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) { this._boxW = box.width; this._boxH = box.height; }
      this._checkEdges();
    });
    this._resizeObs.observe(this);
  }

  updated(changedProps) {
    super.updated(changedProps);
    // The lens maps are pixel lengths of a pill whose width follows its own
    // text, so they can only be written once the pill has been laid out - and
    // again whenever it has been laid out differently.
    applyLensGeometry(this.shadowRoot);
    // A bar can be on a card that carries no fx-glass at all, so the watcher
    // is armed from here too. It installs itself once per page.
    watchModalSuspend();
    if (changedProps.has('config') || changedProps.has('rootConfig')) {
      this._checkEdges();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._resizeObs) this._resizeObs.disconnect();
    if (this._animFrame) { cancelAnimationFrame(this._animFrame); this._animFrame = null; }
  }

  _checkEdges() {
    requestAnimationFrame(() => {
      try {
        const host = this.getRootNode().host; 
        if (!host) return;
        const myRect = this.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        
        const atLeft = Math.abs(myRect.left - hostRect.left) < 12;
        const atRight = Math.abs(hostRect.right - myRect.right) < 12;

        if (this._isAtLeftEdge !== atLeft) this._isAtLeftEdge = atLeft;
        if (this._isAtRightEdge !== atRight) this._isAtRightEdge = atRight;
      } catch(e) {}
    });
  }

  _get(k, d) { return this.config[k] ?? d; }

  /**
   * The smallest change in the animated percentage this bar can actually
   * show, as a fraction of its range.
   *
   * `_displayPct` is reactive state, so every value written to it re-renders
   * the whole component - the fill, every segment, the pill, the labels. At
   * 120 Hz that is 120 full renders a second per bar for an animation the eye
   * cannot follow that finely: a segmented ring only ever lights whole
   * segments, a counting value only ever shows so many decimals, and a fill
   * edge can only land on a whole pixel. Writing between those steps redraws
   * the bar without changing a thing on screen.
   *
   * The step is the finest of whichever of those the bar is doing, so the
   * motion is exactly what it was - the frames that are dropped are the ones
   * that drew the same picture twice.
   */
  _visibleStep() {
    const steps = [];
    if (this._get('circular_segmented', false)) {
      const n = parseInt(this._get('circular_segment_count', 40));
      if (n > 0) steps.push(1 / n);
    }
    if (this._get('value_animated', false)) {
      const min = safeFloat(this._get('min', 0), 0);
      const max = safeFloat(this._get('max', 100), 100);
      const range = Math.abs(max - min) || 1;
      const decimals = parseInt(this._get('value_decimals', 0)) || 0;
      steps.push(Math.pow(10, -decimals) / range);
    }
    if (this._get('use_gradient', false) && this._boxW > 0 && this._boxH > 0) {
      // A gradient is sampled along the bar, so its finest visible step is a
      // device pixel of the axis it runs along.
      //
      // The size comes from the ResizeObserver, never from `offsetWidth`:
      // this runs inside `render()`, and a layout read there is a forced
      // synchronous layout of the whole page per animating bar. On a
      // dashboard of two dozen cards that is not slow, it is a hung tab.
      const orientation = this._get('orientation', 'horizontal');
      const px = Math.max(1, Math.round(
        /^circular/.test(orientation)
          ? Math.min(this._boxW, this._boxH) * Math.PI
          : (orientation === 'horizontal' ? this._boxW : this._boxH)));
      steps.push(1 / px);
    }
    return steps.length ? Math.min(...steps) : 0;
  }

  _animatePct(to, durationMs) {
    const ease = bounceEaseFn(safeFloat(this._get('bounce_intensity', 50), 50));
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    const sweepFlag = window.SC_SWEEP_FLAG ?? true;
    const from  = this._displayPct;
    const start = performance.now();
    const step  = (window.SC_FRAME_SKIP ?? SC_FRAME_SKIP_DEFAULT) ? this._visibleStep() : 0;
    // The steps this animation draws are discrete - a segment lights, a digit
    // ticks over, a fill edge moves a pixel - and nobody reads them at 120 Hz.
    // Each one costs a repaint of the whole element, and on a segmented ring
    // that repaint is the most expensive thing the card does, so the rate is
    // capped where the eye stops telling the difference rather than at
    // whatever the display happens to run at.
    const minGap = 1000 / (window.SC_MAX_FPS ?? SC_ANIM_FPS_CAP);
    let   shown = this._displayPct;
    let   last  = 0;
    const tick  = (now) => {
      // Set from the frame, not from render(): `_animatePct` is called during
      // render, and the DOM is not ours to touch there.
      if (sweepFlag && !this.hasAttribute('data-sweeping')) this.toggleAttribute('data-sweeping', true);
      const t     = Math.min((now - start) / durationMs, 1);
      const eased = ease(t);
      const next  = from + (to - from) * eased;
      if (t < 1) {
        // Only a value the bar can draw differently is worth a render.
        if (Math.abs(next - shown) >= step && now - last >= minGap) {
          shown = next; last = now; this._displayPct = next;
        }
        this._animFrame = requestAnimationFrame(tick);
      } else {
        this._displayPct = to; this._animFrame = null;
        this.toggleAttribute('data-sweeping', false);
      }
    };
    this._animFrame = requestAnimationFrame(tick);
  }

  static get styles() {
    return [SC.partHighlight, css`
      :host {
        display: block; position: absolute; width: 100%; height: 100%;
        pointer-events: none; contain: layout style;
      }
      .sc-pb-wrap {
        position: relative; width: 100%; height: 100%;
        border-radius: var(--pb-radius, 4px);
        background: var(--pb-bg-color, rgba(255,255,255,0.1));
        overflow: hidden;
        box-shadow: var(--pb-shadow, inset 0 1px 3px rgba(0,0,0,0.3));
        contain: strict;
        z-index: ${ELM_BASE};
        container-type: size;
      }
      /*
       * A ring is drawn as 100cqmin, the largest square its box holds, so a
       * box wider than it is tall is a letterbox and is meant to look like
       * one - that is what lets the canvas stretch a card back and forth
       * without anything on screen changing. The background was the one thing
       * that did not play along: it filled the box, and 50% of a box that
       * is not square is an ellipse. So it gets the ring's square instead,
       * and the wrap carries nothing.
       */
      .sc-pb-wrap.circ {
        background: none; box-shadow: none; border-radius: 0;
      }
      .sc-pb-disc {
        position: absolute; top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 100cqmin; height: 100cqmin;
        border-radius: var(--pb-radius, 50%);
        background: var(--pb-bg-color, rgba(255,255,255,0.1));
        box-shadow: var(--pb-shadow, inset 0 1px 3px rgba(0,0,0,0.3));
        pointer-events: none;
        z-index: ${ELM_BASE};
      }
      .sc-liquid-layer {
        position: absolute; inset: 0; filter: none; border-radius: inherit;
      }
      .sc-liquid-layer.gooey {
        filter: url(#sc-goo-filter);
      }
      .sc-pb-fill {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        border-radius: var(--pb-radius, 4px);
        will-change: clip-path, background; 
        z-index: ${ELM_DYNAMIC};
      }
      
      .sc-seg-container {
        position: absolute; top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 100cqmin; height: 100cqmin;
        pointer-events: none;
      }
      .sc-seg {
        position: absolute; inset: 0; pointer-events: none;
        transform: rotate(var(--rot)); transform-origin: center;
        will-change: transform;
      }
      .sc-seg-inner {
        position: absolute; top: 0; left: 50%; transform: translateX(-50%);
        border-radius: 999rem;
        transition: background 150ms ease, box-shadow 150ms ease;
      }
      /* A segment fades when it lights on its own. While the ring is
         sweeping, the sequence is the motion and the fade is only a second
         animation laid over it - one that re-rasters forty shadowed segments
         on every frame for as long as it runs. Measured on six rings at two
         value changes a second: 140 % of a core with it, 30 % without. */
      :host([data-sweeping]) .sc-seg-inner {
        transition: none;
      }

      .sc-pb-ticks { position: absolute; inset: 0; pointer-events: none; opacity: var(--pb-tick-opacity, 1); z-index: ${ELM_DYNAMIC + 50}; }
      .sc-pb-labels { position: absolute; inset: 0; pointer-events: none; z-index: ${ELM_FLOAT}; }
    `];
  }

  render() {
    if (!this.config || !this.hass) return html``;

    const { entity: resolvedEntity, attribute: resolvedAttribute, alias: resolvedAliasName } =
      SC.resolveAlias(this.globalEntities, this.config);

    const stateObj = resolvedEntity ? this.hass.states[resolvedEntity] : null;
    const rawVal = stateObj ? safeFloat((resolvedAttribute ? stateObj.attributes[resolvedAttribute] : stateObj.state), 0) : 0;

    const min = safeFloat(this._get('min', 0), 0);
    const max = safeFloat(this._get('max', 100), 100);
    const originValStr = this._get('origin', '');
    const originVal = originValStr !== '' ? safeFloat(originValStr, min) : min;
    const range = max - min || 1;
    
    const pct = Math.max(0, Math.min(1, (rawVal - min) / range));
    const animDur = safeFloat(this._get('animation_duration', 0.4), 0.4);

    // Everything that moves with the value is drawn from this loop, so a bar
    // with a duration needs frames whether or not anything else asks for them.
    const needsFrames = animDur > 0
      || this._get('value_animated', false)
      || this._get('use_gradient', false)
      || this._get('circular_segmented', false);

    if (this._isInitialized && pct !== this._targetPct) {
      this._targetPct = pct;
      if (needsFrames) this._animatePct(pct, animDur * 1000);
    }

    const renderPct = this._isInitialized ? (needsFrames ? this._displayPct : pct) : 0;
    const originPct = Math.max(0, Math.min(1, (originVal - min) / range));
    
    // A CSS transition always runs at the display's rate, and on a 120 Hz
    // screen that is where the bars' whole GPU cost came from - the same
    // motion at 30 fps costs a third of it, and nobody can see the difference
    // on a fill that takes seconds to travel. So the positions follow the
    // frame loop, which is capped, and carry no transition of their own.
    // See docs/perf-cpu.md.
    const targetPct = this._isInitialized ? renderPct : originPct;
    
    const p1Target = Math.min(originPct, targetPct);
    const p2Target = Math.max(originPct, targetPct);
    
    const decimals = parseInt(this._get('value_decimals', 0));
    const unit = this._get('value_unit', stateObj?.attributes?.unit_of_measurement || '');
    const activeVal = this._get('value_animated', false) ? (min + renderPct * range) : rawVal;
    
    const displayValue = `${parseFloat(activeVal).toFixed(decimals)}${unit ? ' ' + unit : ''}`;
    const indDisplayValue = `${parseFloat(activeVal).toFixed(parseInt(this._get('indicator_value_decimals', decimals)))}${unit ? ' ' + unit : ''}`;

    const orientation = this._get('orientation', 'horizontal');
    const isHoriz = orientation === 'horizontal';
    const isCirc = String(orientation).startsWith('circular');
    const u = this._get('base_unit', 'auto') === 'auto' ? (isCirc ? 'cqmin' : 'px') : this._get('base_unit');

    let w = parseDim(this._get('width'), isCirc ? '100px' : (isHoriz ? '100%' : '20px')); 
    let h = parseDim(this._get('height'), isCirc ? '100px' : (isHoriz ? '20px' : '100%'));
    const radius = isCirc 
      ? parseDim(this._get('circular_border_radius', 50), '50%', '%') 
      : parseDim(this._get('border_radius', '4'), '4px');

    const bgColorRaw = this._get('bg_color', '#ffffff');
    const bgOpacity = safeFloat(this._get('bg_opacity', 10), 10);
    const bgColor = `color-mix(in srgb, ${bgColorRaw} ${bgOpacity}%, transparent)`;

    const resolvedStops = normalizeStops(this._get('gradient_stops',
      [{ color: this._get('color1', '#2196f3'), pos: 0 },
       { color: this._get('color2', '#4caf50'), pos: 100 }]));
    let fillColor = this._get('fill_color', 'var(--primary-color)');
    
    if (this._get('use_gradient', false)) {
      if (this._get('gradient_as_solid', false)) {
        fillColor = sampleGradient(resolvedStops, renderPct);
      } else {
        fillColor = `linear-gradient(${isHoriz ? '90deg' : '0deg'}, ${stopsToCss(resolvedStops)})`;
      }
    }
    const exactHexColor = this._get('use_gradient', false) ? sampleGradient(resolvedStops, renderPct) : extractHex(fillColor);

    const glassShadow = `
      1px -1px 2px rgba(255,255,255,0.5) inset, 0px -1px 2px rgba(255,255,255,0.5) inset, 
      -1px -1px 2px rgba(255,255,255,0.5) inset, 1px 1px 2px rgba(0,0,0,0.3) inset, 
      -8px 4px 10px -6px rgba(0,0,0,0.25) inset, -1px 1px 6px rgba(0,0,0,0.25) inset, 
      -1px -1px 8px rgba(0,0,0,0.15), 1px 1px 2px rgba(0,0,0,0.15), 2px 2px 6px rgba(0,0,0,0.15), 
      -2px -1px 2px rgba(255,255,255,0.25) inset, 3px 6px 16px -6px rgba(0,0,0,0.5)
    `;

    const fillClipPath = isHoriz
      ? `inset(0 calc((1 - ${p2Target}) * 100%) 0 calc(${p1Target} * 100%))`
      : `inset(calc((1 - ${p2Target}) * 100%) 0 calc(${p1Target} * 100%) 0)`;
    
    const fillStyle = `clip-path: ${fillClipPath}; background: ${fillColor}; transition: background 0.1s linear;`;
    
    // --- NEW: Hoist global card-edge indent logic ---
    const rc = this.rootConfig || {};
    const isCardPill = SC.cardIsPill(rc);
    const hasCardRadius = isCardPill || SC.safeFloat(rc.border_radius, 0) > 0;
    let edgeIndentStr = '0px';
    if (hasCardRadius) {
      // The indent keeps a bar that reaches the card's edge out of the corner,
      // so it follows whatever unit that corner is written in - a percentage
      // one has no pixel figure to take 60% of here.
      edgeIndentStr = isCardPill ? '20px' : `max(8px, calc(${SC.cardRadius(rc)} * 0.6))`;
    }
    
    // ==========================================
    // PATCH: GHOST-PILL & TOP-PILL SEPARATION
    // ==========================================
    let indicatorGooeyHtml = '';
    let indicatorTopHtml = '';
    const showInd = this._get('show_indicator', false) && !isCirc;
    
    const oldGlassBool = this._get('indicator_value_glass', false);
    const glassEffect = this._get('indicator_glass_effect', oldGlassBool ? 'glass_gooey' : 'none');
    // The goo filter exists to merge the pill into the fill, and it re-rasterises
    // the whole fill layer on every animation frame. Without a pill there is
    // nothing to merge, so it would be paid for an effect nobody can see.
    const isGooey = glassEffect === 'glass_gooey'
      && showInd && this._get('indicator_value', false);
    // The displacement map is the same kind of bargain as the goo filter: it
    // re-samples the backdrop on every frame the pill moves, and there is no
    // backdrop to bend when the pill's own background is opaque. The flag is
    // set where that is known, in the pill itself.
    let lensFraction = 0;
    // A rule, not a value: whether a pill turned on its end fits depends on
    // how tall the bar is drawn, which is a layout result. See `pillAt`.
    let pillUprightCSS = '';

    if (showInd) {
      const indColor = this._get('indicator_color', '#ffffff');
      const indThick = parseDim(this._get('indicator_thickness', 2), `2${u}`, u);

      // The line marks the fill's edge, so it stands on two fields at once:
      // half of it lies on the fill and half on the track. One ink has to be
      // wrong on one of them, which is why the adaptive line is drawn twice -
      // the dual-adaptive answer the bar's ticks already give.
      //
      // Over the fill the field is known exactly, and the ink for it is
      // `adaptive-ink.js`: lightness rather than a contrast ratio, because a
      // two-pixel line on a saturated hue is read by lightness and not by a
      // ratio built for text.
      //
      // Over the track it is not known, and asking the background colour is
      // worse than not asking. A track is painted at a tenth of its colour by
      // default, so what the eye sees there is the card - and a white track at
      // half strength over a dark dashboard reads as mid-grey while the
      // colour says white, which is how the adaptive line came out near-black
      // on grey and all but vanished. The theme's own text colour is right on
      // the card by definition, and the card is what the track is showing.
      const lineAdaptive = this._get('indicator_color_adaptive', false);
      const inkOnTrack = lineAdaptive ? 'var(--primary-text-color)' : indColor;
      const inkOnFill = lineAdaptive
        ? (adaptiveInk({ fill: SC.toRgb(exactHexColor) }) || 'var(--primary-text-color)')
        : indColor;

      const lineStyle = (col) => isHoriz
        ? `position:absolute; top:0; bottom:0; width:${indThick}; background:${col}; left:calc(${targetPct} * 100%); transform:translateX(-50%) translateZ(0); z-index:${ELM_FLOAT};`
        : `position:absolute; left:0; right:0; height:${indThick}; background:${col}; bottom:calc(${targetPct} * 100%); transform:translateY(50%) translateZ(0); z-index:${ELM_FLOAT};`;
      
      let realPillHtml = '';
      if (this._get('indicator_value', false)) {
         let pBgRaw = this._get('indicator_value_bg', '#000000');
         let pCol = this._get('indicator_value_color', '#ffffff');
         const adMode = this._get('indicator_value_adaptive_mode', 'none');
         
         if (adMode === 'pill') { pBgRaw = exactHexColor; pCol = contrastColor(exactHexColor); } 
         else if (adMode === 'text') { pCol = exactHexColor; }
         
         const pOp = safeFloat(this._get('indicator_value_opacity', 100), 100);
         const finalBg = `color-mix(in srgb, ${pBgRaw} ${pOp}%, transparent)`;
         
         // backdrop-filter is one of the most expensive things a moving element can
         // carry: the backdrop is re-sampled and re-blurred on every animation
         // frame. It is only ever visible through a translucent pill, so when the
         // pill's own background covers it completely we drop it and draw exactly
         // the same pixels for a fraction of the cost.
         const bgIsOpaque = pOp >= 100 && isOpaqueColor(pBgRaw);
         const blurCSS = px => {
           if (bgIsOpaque) return '';
           const v = suspendable('blur(' + px + 'px)');
           return 'backdrop-filter: ' + v + '; -webkit-backdrop-filter: ' + v + '; ';
         };
         // glass_dark paints its own rgba() background, so only the opacity counts.
         const darkBlurCSS = pOp >= 100
           ? ''
           : 'backdrop-filter: ' + suspendable('blur(6px)') + '; -webkit-backdrop-filter: ' + suspendable('blur(6px)') + '; ';

         let glassCSS = '';
         if (glassEffect === 'glass_gooey') {
           glassCSS = `${blurCSS(4)}box-shadow: ${glassShadow}; border: 1px solid rgba(255, 255, 255, 0.3);`;
         } else if (glassEffect === 'glass_clear') {
           glassCSS = `box-shadow: ${glassShadow}; border: 1px solid rgba(255, 255, 255, 0.3);`;
         } else if (glassEffect === 'glass_clean') {
           glassCSS = `${blurCSS(6)}border: 1px solid rgba(255, 255, 255, 0.4); box-shadow: 0 4px 10px rgba(0,0,0,0.1), inset 0 1px 1px rgba(255,255,255,0.4);`;
         } else if (glassEffect === 'glass_lens') {
           glassCSS = `${blurCSS(4)}border: 1px solid rgba(255, 255, 255, 0.4); box-shadow: inset 0 -4px 8px rgba(0,0,0,0.4), inset 0 4px 8px rgba(255,255,255,0.8), 0 4px 12px rgba(0,0,0,0.4);`;
         } else if (isLiquidEffect(glassEffect)) {
           // No blur of our own: a lens that also frosts its backdrop reads as
           // frosted, and the bending is the point. `bgIsOpaque` still governs
           // the filter, for the same reason it governs every other blur here.
           if (!bgIsOpaque) lensFraction = pillLensFraction(glassEffect);
           glassCSS = liquidPillCSS(glassEffect, lensFraction ? LENS_FILTER_ID : '');
         } else if (glassEffect === 'glass_dark') {
           glassCSS = `${darkBlurCSS}background: rgba(0,0,0,${pOp / 100}) !important; border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: inset 0 1px 1px rgba(255,255,255,0.1), 0 4px 8px rgba(0,0,0,0.5); color: #ffffff !important;`;
         } else {
           glassCSS = `box-shadow: 0 2px 2px rgba(0,0,0,0.25); border: none;`;
         }

         // `auto` used to cross the pill with the bar, on the reasoning that a
         // pill lying along the bar covers a long stretch of it. What it
         // actually did on a horizontal bar was stand the reading on its end,
         // where it has the bar's height to fit into and has to shrink to get
         // there. Upright is what a reading is for, so that is what `auto`
         // means now - the same 0 degrees a vertical bar has always had.
         const pRot = (this._get('indicator_value_rotation', 'auto') === 'auto') ? 0 : parseInt(this._get('indicator_value_rotation'));
         const isVertRot = Math.abs(pRot) === 90;

         // A liquid pill stands further off the text than a flat one, and the
         // clamp that keeps it inside the bar has to know by how much or the
         // rim hangs over the end at 100 %.
         const pad = liquidPadding(glassEffect);

         const pSizeSet = parseDim(this._get('indicator_value_font_size', 10), `10${u}`, u);

         /**
          * Everything about the pill that depends on which way it is turned:
          * the size that fits, the clamp that keeps it off the ends of the bar
          * and the transform that turns it.
          *
          * It is asked twice - once for the rotation the card sets, once for
          * upright - because a pill on its end can be set on a bar that is too
          * flat to hold it, and the card stands it up rather than shrink the
          * reading out of legibility. Two answers built by one piece of
          * arithmetic cannot drift apart, which a second copy of it would.
          *
          * `auto` used to cross the pill with the bar, and the reading then
          * ran across the narrow way of it - two lines on a slim bar, or ends
          * cut off by the bar's own clipping. The pill is `nowrap` now and the
          * size gives way instead. Rotation is a transform and happens after
          * layout, so which screen axis the text ends up running along is
          * known here and nowhere else: hence the extents handed over.
          */
         const pillAt = (/** @type {number} */ rot) => {
           const vert = Math.abs(rot) === 90;
           const size = pillFontSize(pSizeSet, indDisplayValue.length, pad,
                                     vert ? '100cqh' : '100cqw',
                                     vert ? '100cqw' : '100cqh');
           const halfWidth = `calc(${size} * (0.8 + ${indDisplayValue.length} * 0.3 + ${pad.clampEm}))`;
           const halfHeight = `calc(${size} * 1.1)`;
           const base = isHoriz ? (vert ? halfHeight : halfWidth) : (vert ? halfWidth : halfHeight);
           let min = base, max = base;
           if (isHoriz && hasCardRadius) {
             if (this._isAtLeftEdge) min = `calc(${base} + ${edgeIndentStr})`;
             if (this._isAtRightEdge) max = `calc(${base} + ${edgeIndentStr})`;
           }
           const decls = isHoriz
             ? [`left: clamp(${min}, calc(${targetPct} * 100%), calc(100% - ${max}))`,
                `top: 50%`,
                `transform: translate(-50%, -50%) rotate(${rot}deg) translateZ(0)`,
                `will-change: left, transform`,
                `transition: background 0.1s linear, color 0.1s linear`]
             : [`bottom: clamp(${base}, calc(${targetPct} * 100%), calc(100% - ${base}))`,
                `left: 50%`,
                `transform: translate(-50%, 50%) rotate(${rot}deg) translateZ(0)`,
                `will-change: bottom, transform`,
                `transition: background 0.1s linear, color 0.1s linear`];
           return { size, decls };
         };

         const turned = pillAt(pRot);
         const pSize = turned.size;
         const pPosStyle = turned.decls.join('; ') + ';';

         // The one arrangement a user can set that cannot be honoured: a pill
         // on its end needs the bar to be as tall as the pill is long, and a
         // flat bar is not. The card answers it where it is asked - in CSS,
         // against the bar's own container - so it goes on answering as the
         // dashboard is resized, which nothing measured at render time could.
         // The setting is kept, not rewritten: widen the bar and the pill lies
         // back down on its side.
         //
         // Only for a size in pixels, because the threshold is a pixel figure;
         // a size written in any other unit keeps the plain shrink.
         const pxSet = /^(\d+(?:\.\d+)?)px$/.exec(pSizeSet);
         if (isVertRot && pxSet) {
           const needs = pillCrossExtent(parseFloat(pxSet[1]), indDisplayValue.length, pad);
           const up = pillAt(0);
           pillUprightCSS = `@container (max-height: ${(needs - 0.01).toFixed(2)}px) {
        .sc-pb-pill, .sc-pb-pill-ghost {
          font-size: ${up.size} !important;
          ${up.decls.map(d => d + ' !important').join(';\n          ')};
        }
      }`;
         }

         // 1. The real layer
         realPillHtml = html`
            <div class="sc-pb-pill" data-sc-part="pill" style="position:absolute; z-index:${ELM_FLOAT + 50}; background:${finalBg}; color:${pCol}; font-size:${pSize}; padding:${pad.padding}; border-radius:100px; font-weight:bold; white-space:nowrap; display:flex; align-items:center; justify-content:center; ${glassCSS} ${pPosStyle}">
              ${indDisplayValue}
            </div>`;

         // 2. The goo clone
         if (isGooey) {
            indicatorGooeyHtml = html`
              <div class="sc-pb-pill-ghost" style="position:absolute; z-index:${ELM_DYNAMIC}; background:${exactHexColor}; color:transparent; font-size:${pSize}; padding:${pad.padding}; border-radius:100px; white-space:nowrap; display:flex; pointer-events:none; ${pPosStyle}">
                ${indDisplayValue}
              </div>`;
         }
      }
      
      // Two names: the line is switched on and off with the pill and shares
      // its chip, so it breathes whenever the pill is in hand - but its own
      // colour and thickness are set on that chip too, and while one of those
      // is being held the line answers alone.
      // The second copy carries the same two part names as the first: it is
      // the same line, and a highlight that inked only the half outside the
      // fill would be pointing at half a mark.
      const filledLineHtml = lineAdaptive ? html`
        <div style="position:absolute; inset:0; z-index:${ELM_FLOAT}; clip-path:${fillClipPath}; pointer-events:none;">
          <div class="sc-pb-indicator-line" data-sc-part="pill indicator_line" style="${lineStyle(inkOnFill)}"></div>
        </div>` : '';
      indicatorTopHtml = html`<div class="sc-pb-indicator-line" data-sc-part="pill indicator_line" style="${lineStyle(inkOnTrack)}"></div>${filledLineHtml}${realPillHtml}`;
    }

    let circularHtml = ''; 
    if (isCirc) {
      const circScale = safeFloat(this._get('circular_scale', 100), 100) / 100;
      const isSegmented = this._get('circular_segmented', false);
      const showGlow = this._get('circular_glow', true);
      const sw = safeFloat(this._get('circular_stroke_width', 10), 10);
      
      let circArc = 360; 
      const userStart = parseInt(this._get('circular_start_position', 0)); 
      let startAngle = userStart; 
      
      if (orientation === 'circular_speedo') { circArc = 270; startAngle = -135 + userStart; }
      if (orientation === 'circular_half') { circArc = 180; startAngle = -90 + userStart; }
      
      const isReverse = this._get('circular_reverse', false); 
      const dirMult = isReverse ? -1 : 1;
      
      // Relief is configured on the glass pattern that covers this bar, not
      // on the bar - it is an optical effect of the glass, and it has to be
      // lit by the same sun. The ring lives in this shadow root, where the
      // module's CSS cannot reach it, so the bar reads the pattern itself.
      const reliefPat = reliefPattern(this.rootConfig, this.config);

      if (isSegmented) {
        const segCount = parseInt(this._get('circular_segment_count', 40)); 
        const activeCount = Math.floor(renderPct * segCount);
        const angleStep = (circArc / (circArc === 360 ? segCount : Math.max(1, segCount - 1))) * dirMult;
        const wThick = safeFloat(this._get('circular_segment_thickness', 2), 2) + '%'; 
        const hLen = sw + '%'; 

        const reliefShadowCSS = reliefPat
          ? reliefShadow(lightParams(reliefPat), reliefPat, v => (v === 0 ? '0px' : `${Math.round(v * 1000) / 1000}${u}`))
          : 'none';
        
        const segs = [];
        for (let i = 0; i < segCount; i++) {
          const isActive = i <= activeCount && renderPct > 0; 
          const angle = startAngle + (i * angleStep); 
          const segPct = segCount > 1 ? i / (segCount - 1) : 0;
          
          let activeColor = this._get('use_gradient', false) ? (this._get('gradient_as_solid', false) ? exactHexColor : sampleGradient(resolvedStops, segPct)) : extractHex(fillColor);
          const inactiveColor = `color-mix(in srgb, ${bgColorRaw} ${bgOpacity}%, transparent)`; 
          const segBg = isActive ? activeColor : inactiveColor;
          const glowShadow = (showGlow && isActive) ? `0 0 2px ${activeColor}, 0 0 5px ${activeColor}` : 'none';
          // The glow is a colour the segment gives off and the relief is the
          // shape it has; both are box-shadows, so a segment that does both
          // wears them in one list rather than losing one to the other.
          const segShadow = [glowShadow, reliefShadowCSS].filter(v => v !== 'none').join(', ') || 'none';
          const zIdx = isActive ? ELM_DYNAMIC : ELM_STATIC;
          
          segs.push(html`
            <i class="sc-seg" style="--rot: ${angle}deg; z-index: ${zIdx};">
              <div class="sc-seg-inner" style="background: ${segBg}; box-shadow: ${segShadow}; width: ${wThick}; height: ${hLen};"></div>
            </i>
          `);
        }
        circularHtml = html`<div class="sc-seg-container" style="${circScale !== 1 ? `transform: translate(-50%, -50%) scale(${circScale});` : ''}">${segs}</div>`;
        
      } else {
        const svgRot = startAngle - 90; 
        const svgTransform = `rotate(${svgRot} 50 50) ${isReverse ? 'scale(1, -1) translate(0, -100)' : ''}`;
        const r = 50 - (sw / 2); 
        const c = 2 * Math.PI * r; 
        const dashLength = (circArc / 360) * c; 
        const gapLength = c - dashLength;
        const progLength = (targetPct * dashLength) > 0 ? Math.max(0.001, targetPct * dashLength) : 0;
        
        if (!this._uniqueId) this._uniqueId = 'grad-' + Math.random().toString(36).substr(2, 9);

        // A stroke is not a box and cannot wear a box-shadow, so the same
        // relief layers are painted as an SVG filter instead. The viewBox is
        // 100 units across the ring's own square, which is what `cqmin` counts
        // in too, so a depth means the same thing in both branches. A layer's
        // spread has no SVG counterpart and is dropped: it only fills the
        // floor of an engraved groove, which a stroke this thin has none of.
        const rLayers = reliefPat ? reliefLayers(lightParams(reliefPat), reliefPat) : [];
        const reliefId = 'relief-' + this._uniqueId;
        const circleFilter = [
          showGlow ? `url(#glow-${this._uniqueId})` : null,
          rLayers.length ? `url(#${reliefId})` : null,
        ].filter(Boolean).join(' ') || 'none';
        const bgFilter = rLayers.length ? `url(#${reliefId})` : 'none';
        
        circularHtml = html`
          <svg viewBox="0 0 100 100" style="width:100%; height:100%; position:absolute; inset:0; overflow:visible; z-index:${ELM_STATIC}; pointer-events:none; ${circScale !== 1 ? `transform: scale(${circScale}); transform-origin: center;` : ''}">
          <defs>
              ${this._get('use_gradient', false) && !this._get('gradient_as_solid', false) ? svg`
                <linearGradient id="${this._uniqueId}" x1="0%" y1="100%" x2="100%" y2="0%">
                  ${resolvedStops.map(s => svg`<stop offset="${s.pos}%" stop-color="${s.color}" />`)}
                </linearGradient>
              ` : ''}
              ${showGlow ? svg`
                <filter id="glow-${this._uniqueId}" x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="${exactHexColor}" flood-opacity="0.6"/>
                </filter>
              ` : ''}
              ${rLayers.length ? svg`
                <filter id="${reliefId}" x="-50%" y="-50%" width="200%" height="200%">
                  ${rLayers.map((l, i) => l.inset ? svg`
                    <feOffset in="SourceAlpha" dx="${l.dx}" dy="${l.dy}" result="ro${i}"></feOffset>
                    <feGaussianBlur in="ro${i}" stdDeviation="${l.blur / 2}" result="rb${i}"></feGaussianBlur>
                    <feComposite in="SourceAlpha" in2="rb${i}" operator="out" result="rc${i}"></feComposite>
                    <feFlood flood-color="${l.light ? '#ffffff' : '#000000'}" flood-opacity="${l.alpha}" result="rf${i}"></feFlood>
                    <feComposite in="rf${i}" in2="rc${i}" operator="in" result="rl${i}"></feComposite>
                  ` : svg`
                    <feOffset in="SourceAlpha" dx="${l.dx}" dy="${l.dy}" result="ro${i}"></feOffset>
                    <feGaussianBlur in="ro${i}" stdDeviation="${l.blur / 2}" result="rb${i}"></feGaussianBlur>
                    <feFlood flood-color="${l.light ? '#ffffff' : '#000000'}" flood-opacity="${l.alpha}" result="rf${i}"></feFlood>
                    <feComposite in="rf${i}" in2="rb${i}" operator="in" result="rl${i}"></feComposite>
                  `)}
                  <feMerge>
                    ${rLayers.map((l, i) => l.inset ? '' : svg`<feMergeNode in="rl${i}"></feMergeNode>`)}
                    <feMergeNode in="SourceGraphic"></feMergeNode>
                    ${rLayers.map((l, i) => l.inset ? svg`<feMergeNode in="rl${i}"></feMergeNode>` : '')}
                  </feMerge>
                </filter>
              ` : ''}
            </defs>
            <circle cx="50" cy="50" r="${r}" fill="none" stroke="${bgColorRaw}" stroke-opacity="${bgOpacity/100}" stroke-width="${sw}" stroke-dasharray="${dashLength} ${gapLength}" stroke-dashoffset="0" stroke-linecap="round" style="z-index: ${ELM_STATIC}; filter: ${bgFilter};" transform="${svgTransform}"></circle>
            ${progLength > 0 ? svg`
              <circle cx="50" cy="50" r="${r}" data-sc-part="fill" fill="none" stroke="${(this._get('use_gradient', false) && !this._get('gradient_as_solid', false)) ? `url(#${this._uniqueId})` : exactHexColor}" stroke-width="${sw}" stroke-dasharray="${progLength} ${c}" stroke-dashoffset="0" stroke-linecap="round" style="transition: stroke 0.1s linear; z-index: ${ELM_DYNAMIC}; filter: ${circleFilter};" transform="${svgTransform}"></circle>
            ` : ''}
          </svg>
        `;
      }
    }

    let ticksStyle = ''; 
    let tickElementsEmptyArr = []; 
    let tickElementsFilledArr = []; 
    let subtickElementsEmptyArr = [];
    let subtickElementsFilledArr = [];
    let tickLabelsEmptyHtml = ''; 
    let tickLabelsFilledHtml = ''; 
    
    if (this._get('show_ticks', false) && !isCirc) {
      let tCount = parseInt(this._get('tick_count', 10)); 
      const tInterv = safeFloat(this._get('tick_interval', 0), 0); 
      let step = 0;
      
      if (tInterv > 0) { 
        step = (tInterv / range) * 100; 
        tCount = Math.floor((range + 0.0001) / tInterv) + 1; 
      } else if (tCount > 1) { 
        step = 100 / (tCount - 1); 
      }
      
      // Where a tick sits across the bar. `full` pins both edges instead of
      // one, which is what makes it span - it is an alignment, not a length.
      const getAlignCSS = (align, isHor) => { 
        if (isHor) { 
          if (align === 'start') return `top: 0; transform: translate(-50%, 0);`; 
          if (align === 'end') return `bottom: 0; transform: translate(-50%, 0);`; 
          if (align === 'full') return `top: 0; bottom: 0; transform: translate(-50%, 0);`; 
          return `top: 50%; transform: translate(-50%, -50%);`; 
        } else { 
          if (align === 'start') return `left: 0; transform: translate(0, 50%);`; 
          if (align === 'end') return `right: 0; transform: translate(0, 50%);`; 
          if (align === 'full') return `left: 0; right: 0; transform: translate(0, 50%);`; 
          return `left: 50%; transform: translate(-50%, 50%);`; 
        } 
      };

      // The length across the bar, or nothing at all where both edges are
      // already pinned. A spanning tick that also carried a height would be
      // saying two things about the same axis, and the old answer to that was
      // to overwrite the length with 100% - which threw away a tick design the
      // moment someone tried the alignment next to the one they wanted, and
      // did not give it back when they changed their mind. The length is
      // simply not asked for while the tick spans, and is there again the
      // moment it does not.
      const crossSize = (align, len, isHor) =>
        align === 'full' ? '' : (isHor ? `height: ${len};` : `width: ${len};`);
      
      // NEW: Dual-adaptive colors for main ticks
      const isTickAdaptive = this._get('tick_color_adaptive', false);
      const tColorEmpty = isTickAdaptive ? 'color-mix(in srgb, var(--primary-text-color) 40%, transparent)' : this._get('tick_color', 'rgba(255,255,255,0.3)');
      const tColorFilled = isTickAdaptive ? contrastColor(exactHexColor) : this._get('tick_color', 'rgba(255,255,255,0.3)');
      
      const tWidth = parseDim(this._get('tick_width', 1), `1${u}`, u); 
      const rawTLen = this._get('tick_length', '100%'); 
      const tAlign = this._get('tick_align', 'center'); 
      const hideLast = this._get('tick_hide_last', false); 
      const lStep  = parseInt(this._get('tick_label_step', 1)) || 1; 
      const labExtra = parseDim(this._get('tick_labeled_extralength', 0), `0${u}`, u);
      const tMirror = this._get('tick_mirror_side', false);
      
      const showSubticks = this._get('show_subticks', false); 
      const subCount = parseInt(this._get('subtick_count', 4)); 
      const subPos = this._get('subtick_pos', 'main'); 
      const rawSubLen = this._get('subtick_length', '50%'); 
      const subWidth = parseDim(this._get('subtick_width', 1), `1${u}`, u); 
      
      // NEW: Dual-adaptive colors for subticks
      const isSubtickAdaptive = this._get('subtick_color_adaptive', false);
      const subColorEmpty = isSubtickAdaptive ? 'color-mix(in srgb, var(--primary-text-color) 25%, transparent)' : this._get('subtick_color', 'rgba(255,255,255,0.2)');
      const subColorFilled = isSubtickAdaptive ? contrastColor(exactHexColor) : this._get('subtick_color', 'rgba(255,255,255,0.2)');
      const subMirror = this._get('subtick_mirror_side', false);
      
      const tlPos = this._get('tick_labels_pos', 'end');
      
      if (tCount > 1 && step > 0) {
        for (let i = 0; i < tCount; i++) {
          const p = (i * step) / 100; 
          const isLast = Math.abs((i * step) - 100) < 0.1; 
          const hasLabel = (this._get('show_tick_labels', false) && i % lStep === 0);
          
          const baseLen = rawTLen; 
          let currentLen = baseLen; 
          
          if (hasLabel && labExtra !== '0px' && labExtra !== '0cqmin' && tAlign !== 'full') { 
            currentLen = `calc(${baseLen} + ${labExtra})`; 
          }
          
          if (!(hideLast && isLast)) { 
            let styleBase = `position:absolute; pointer-events:none;`; 
            if (isHoriz) styleBase += `left: ${p * 100}%; width: ${tWidth}; ${crossSize(tAlign, currentLen, true)} ${getAlignCSS(tAlign, isHoriz)}`; 
            else styleBase += `bottom: ${p * 100}%; height: ${tWidth}; ${crossSize(tAlign, currentLen, false)} ${getAlignCSS(tAlign, isHoriz)}`; 
            
            tickElementsEmptyArr.push(html`<div style="${styleBase} background:${tColorEmpty};"></div>`);
            tickElementsFilledArr.push(html`<div style="${styleBase} background:${tColorFilled};"></div>`);
            
            if (tMirror && (tAlign === 'start' || tAlign === 'end')) {
              let mAlign = tAlign === 'start' ? 'end' : 'start';
              let mStyleBase = `position:absolute; pointer-events:none;`; 
              if (isHoriz) mStyleBase += `left: ${p * 100}%; width: ${tWidth}; height: ${currentLen}; ${getAlignCSS(mAlign, isHoriz)}`; 
              else mStyleBase += `bottom: ${p * 100}%; height: ${tWidth}; width: ${currentLen}; ${getAlignCSS(mAlign, isHoriz)}`; 
              tickElementsEmptyArr.push(html`<div style="${mStyleBase} background:${tColorEmpty};"></div>`);
              tickElementsFilledArr.push(html`<div style="${mStyleBase} background:${tColorFilled};"></div>`);
            }
          }
          
          if (showSubticks && subCount > 0 && !isLast && p < 1) {
            let activeSubAlign = subPos === 'main' ? tAlign : subPos; 
            let activeSubLen = rawSubLen; 
            let activeSubMirror = subPos === 'main' ? tMirror : subMirror;

            if (activeSubAlign !== 'full'
                && activeSubLen.includes('%') && subPos === 'main' && baseLen.includes('%')) { 
              activeSubLen = `calc(${baseLen} * (${parseFloat(rawSubLen) / 100}))`; 
            }
            for (let j = 1; j <= subCount; j++) {
              const subP = p + (j / (subCount + 1)) * (step / 100); 
              if (subP > 1.001) continue; 
              let subStyleBase = `position:absolute; pointer-events:none;`; 
              if (isHoriz) subStyleBase += `left: ${subP * 100}%; width: ${subWidth}; ${crossSize(activeSubAlign, activeSubLen, true)} ${getAlignCSS(activeSubAlign, isHoriz)}`; 
              else subStyleBase += `bottom: ${subP * 100}%; height: ${subWidth}; ${crossSize(activeSubAlign, activeSubLen, false)} ${getAlignCSS(activeSubAlign, isHoriz)}`; 
              
              subtickElementsEmptyArr.push(html`<div style="${subStyleBase} background:${subColorEmpty};"></div>`);
              subtickElementsFilledArr.push(html`<div style="${subStyleBase} background:${subColorFilled};"></div>`);
              
              if (activeSubMirror && (activeSubAlign === 'start' || activeSubAlign === 'end')) { 
                let mAlign = activeSubAlign === 'start' ? 'end' : 'start'; 
                let mStyleBase = `position:absolute; pointer-events:none;`; 
                if (isHoriz) mStyleBase += `left: ${subP * 100}%; width: ${subWidth}; height: ${activeSubLen}; ${getAlignCSS(mAlign, isHoriz)}`; 
                else mStyleBase += `bottom: ${subP * 100}%; height: ${subWidth}; width: ${activeSubLen}; ${getAlignCSS(mAlign, isHoriz)}`; 
                subtickElementsEmptyArr.push(html`<div style="${mStyleBase} background:${subColorEmpty};"></div>`);
                subtickElementsFilledArr.push(html`<div style="${mStyleBase} background:${subColorFilled};"></div>`);
              }
            }
          }
        }
        
        this._get('custom_ticks', []).forEach(ct => {
          const p = (ct.value - min) / range; 
          if (p < 0 || p > 1) return; 
          const cColor = ct.color || '#ff0000'; 
          const cWidth = parseDim(ct.width, `2${u}`, u);
          const cAlign = (ct.align && ct.align !== 'main') ? ct.align : tAlign; 
          const cMirror = (!ct.align || ct.align === 'main') ? tMirror : ct.mirror;

          let cLen = (ct.length !== undefined && ct.length !== '' && String(ct.length).toLowerCase() !== 'main') ? parseDim(ct.length, rawTLen, u) : rawTLen; 
          if (cAlign === 'full') cLen = '100%';
          let ctStyleBase = `position:absolute; pointer-events:none;`; 
          if (isHoriz) ctStyleBase += `left: ${p * 100}%; width: ${cWidth}; ${crossSize(cAlign, cLen, true)} ${getAlignCSS(cAlign, isHoriz)}`; 
          else ctStyleBase += `bottom: ${p * 100}%; height: ${cWidth}; ${crossSize(cAlign, cLen, false)} ${getAlignCSS(cAlign, isHoriz)}`; 
          
          tickElementsEmptyArr.push(html`<div style="${ctStyleBase} background:${cColor};"></div>`);
          tickElementsFilledArr.push(html`<div style="${ctStyleBase} background:${cColor};"></div>`);
          
          if (cMirror && (cAlign === 'start' || cAlign === 'end')) {
            let mAlign = cAlign === 'start' ? 'end' : 'start';
            let mStyleBase = `position:absolute; pointer-events:none;`; 
            if (isHoriz) mStyleBase += `left: ${p * 100}%; width: ${cWidth}; height: ${cLen}; ${getAlignCSS(mAlign, isHoriz)}`; 
            else mStyleBase += `bottom: ${p * 100}%; height: ${cWidth}; width: ${cLen}; ${getAlignCSS(mAlign, isHoriz)}`; 
            tickElementsEmptyArr.push(html`<div style="${mStyleBase} background:${cColor};"></div>`); 
            tickElementsFilledArr.push(html`<div style="${mStyleBase} background:${cColor};"></div>`); 
          }
        });
        
        if (this._get('show_tick_labels', false)) {
          const tlDec = parseInt(this._get('tick_labels_decimals', 0)); 
          const tlSizeStr = parseDim(this._get('tick_labels_size', 10), `10${u}`, u); 
          // Written only where somebody has set one: a label with no weight
          // of its own inherits the card's, which is what every bar drawn
          // before this setting existed is still doing.
          const tlWeight = this._get('tick_labels_weight', '');
          const tlWeightCss = tlWeight ? `font-weight:${tlWeight}; ` : '';
          const gap = parseDim(this._get('tick_labels_tick_gap', 4), `4${u}`, u); 
          const shift = parseDim(this._get('tick_labels_shift', 0), `0${u}`, u); 
          const centerGapOffset = parseDim(this._get('tick_labels_center_gap_offset', 0), `0${u}`, u);
          
          // NEW: Dual-adaptive colors for labels
          const isTlAdaptive = this._get('tick_labels_color_adaptive', false);
          const tlColorEmpty = isTlAdaptive ? 'var(--primary-text-color)' : this._get('tick_labels_color', 'var(--secondary-text-color)');
          const tlColorFilled = isTlAdaptive ? contrastColor(exactHexColor) : this._get('tick_labels_color', 'var(--secondary-text-color)');

          const tlRot = parseInt(this._get('tick_labels_rotation', 0));
          const tlHideUnit = this._get('tick_labels_hide_unit', false);
          const tlUnitStr = (tlHideUnit || !unit) ? '' : ' ' + unit;
          
          const hideFirstTl = this._get('tick_labels_hide_first', false);
          const hideLastTl = this._get('tick_labels_hide_last', false);
          
          let maxCharLen = 0; 
          if (!isHoriz && tlPos === 'center') { 
            for (let i = 0; i < tCount; i++) { 
              const str = `${parseFloat(min + ((i * step) / 100) * range).toFixed(tlDec)}${tlUnitStr}`; 
              if (str.length > maxCharLen) maxCharLen = str.length; 
            } 
          }
          
          if (tlPos === 'center') { 
            let halfTextExp = isHoriz ? `calc(${tlSizeStr} / 2 + ${gap} + (${centerGapOffset}) / 2)` : `calc(${maxCharLen} * ${tlSizeStr} * 0.3 + ${gap} + (${centerGapOffset}) / 2)`; 
            const maskDir = isHoriz ? 'bottom' : 'right'; 
            const mask = `linear-gradient(to ${maskDir}, black 0%, black calc(50% + ${shift} - ${halfTextExp}), transparent calc(50% + ${shift} - ${halfTextExp}), transparent calc(50% + ${shift} + ${halfTextExp}), black calc(50% + ${shift} + ${halfTextExp}), black 100%)`; 
            ticksStyle += ` -webkit-mask-image: ${mask}; mask-image: ${mask};`; 
          }

          const labelsEmptyArr = [];
          const labelsFilledArr = [];
          
          for (let i = 0; i < tCount; i++) {
            if (i % lStep !== 0) continue; 
            const p = (i * step) / 100; 
            const isFirst = i === 0; 
            const isLast = Math.abs((i * step) - 100) < 0.1;
            
            if (isFirst && hideFirstTl) continue;
            if (isLast && hideLastTl) continue;

            let styleBase = `position:absolute; font-size:${tlSizeStr}; ${tlWeightCss}white-space:nowrap; pointer-events:none; `;
            
            if (isHoriz) { 
              styleBase += `top: calc(50% + ${shift}); `; 
              let alignX = '-50%', mLeft = '0px'; 
              if (tlPos === 'start') { alignX = '-100%'; mLeft = `calc(-1 * ${gap})`; } 
              else if (tlPos === 'end') { alignX = '0'; mLeft = gap; } 
              
              if (isFirst) { 
                alignX = '0'; 
                if (tlPos === 'start') mLeft = '0px'; 
                if (hasCardRadius && this._isAtLeftEdge) mLeft = `calc(${mLeft} + ${edgeIndentStr})`;
              } 
              else if (isLast) { 
                alignX = '-100%'; 
                if (tlPos === 'end') mLeft = '0px'; 
                if (hasCardRadius && this._isAtRightEdge) mLeft = `calc(${mLeft} - ${edgeIndentStr})`;
              } 
              styleBase += `left: ${p * 100}%; margin-left: ${mLeft}; transform: translate(${alignX}, -50%) rotate(${tlRot}deg);`; 
            } else { 
              styleBase += `left: calc(50% + ${shift}); `; 
              let alignY = '50%', mBottom = '0px'; 
              if (tlPos === 'start') { alignY = '100%'; mBottom = `calc(-1 * ${gap})`; } 
              else if (tlPos === 'end') { alignY = '0'; mBottom = gap; } 
              
              if (isFirst) { alignY = '0'; if (tlPos === 'start') mBottom = '0px'; } 
              else if (isLast) { alignY = '100%'; if (tlPos === 'end') mBottom = '0px'; } 
              styleBase += `bottom: ${p * 100}%; margin-bottom: ${mBottom}; transform: translate(-50%, ${alignY}) rotate(${tlRot}deg);`; 
            }
            
            const txt = `${parseFloat(min + (p * range)).toFixed(tlDec)}${tlUnitStr}`;
            labelsEmptyArr.push(html`<span style="${styleBase} color:${tlColorEmpty};">${txt}</span>`);
            labelsFilledArr.push(html`<span style="${styleBase} color:${tlColorFilled};">${txt}</span>`);
          }
          tickLabelsEmptyHtml = html`<div class="sc-pb-tick-labels" data-sc-part="tick_labels" style="position:absolute; inset:0; pointer-events:none; z-index:${ELM_DYNAMIC + 51};">${labelsEmptyArr}</div>`;
          tickLabelsFilledHtml = html`<div class="sc-pb-tick-labels" data-sc-part="tick_labels" style="position:absolute; inset:0; pointer-events:none;">${labelsFilledArr}</div>`;
        }
      }
    }

    let floatingValueHtml = ''; 
    let labelHtml = ''; 
    let valueHtml = ''; 

    if (this._get('show_label', false)) {
      const lSizeStr = parseDim(this._get('label_font_size', 12), `12${u}`, u); 
      // `label_bold` is what the label's weight was before it had three of
      // them, and a card that was never edited since still carries it - so it
      // is what the weight falls back to rather than a second setting.
      const lWeight = this._get('label_font_weight', null)
        || (this._get('label_bold', false) ? '700' : '400');
      let lColor = this._get('label_color', 'var(--primary-text-color)'); 
      
      if (this._get('label_color_adaptive_bar', false)) lColor = isCirc ? exactHexColor : contrastColor(exactHexColor); 
      else if (this._get('label_color_adaptive_theme', false)) lColor = contrastColor(extractHex('var(--primary-background-color)'));
      
      const fallbackLabel = stateObj ? (stateObj.attributes?.friendly_name || stateObj.entity_id.split('.')[1]) : (resolvedEntity || '');
      const finalLabelText = (this.config.global_id && this.config.global_id !== 'manual' && this._get('use_alias_name', false)) ? (resolvedAliasName || fallbackLabel) : (this._get('label_text', '') || fallbackLabel);
      
      if (isCirc) {
        labelHtml = html`<span data-sc-part="label" style="color:${lColor}; font-size:${lSizeStr}; font-weight:${lWeight}; text-shadow:0 1px 2px rgba(0,0,0,0.5); opacity: 0.8; --sc-hl-own:0.8; transform: translateY(${parseDim(this._get('circular_label_offset_y', 0), `0cqmin`, 'cqmin')}); display: block; transition: color 0.1s linear;">${finalLabelText}</span>`;
      } else {
        const lPos = this._get('label_position', 'center'); 
        let ljc = 'center', lai = 'center'; 
        if (lPos.includes('left')) ljc = 'flex-start'; else if (lPos.includes('right')) ljc = 'flex-end'; 
        if (lPos.includes('top')) lai = 'flex-start'; else if (lPos.includes('bottom')) lai = 'flex-end';
        
        labelHtml = html`
          <div class="sc-pb-labels" style="display:flex; width:100%; height:100%; position:absolute; inset:0; pointer-events:none; z-index:${ELM_FLOAT}; justify-content:${ljc}; align-items:${lai}; padding:4px 8px; box-sizing:border-box;">
            <span data-sc-part="label" style="color:${lColor}; font-size:${lSizeStr}; font-weight:${lWeight}; text-shadow:0 1px 2px rgba(0,0,0,0.5); white-space:nowrap; transform: translate(${parseDim(this._get('label_offset_x', 0), `0${u}`, u)}, ${parseDim(this._get('label_offset_y', 0), `0${u}`, u)}) rotate(${this._get('label_rotation', '0')}deg); display:inline-block; transition: color 0.1s linear;">${finalLabelText}</span>
          </div>`;
      }
    }

    if (this._get('show_value', false)) {
      const vSizeStr = parseDim(this._get('value_font_size', 12), `12${u}`, u); 
      // As the label's, and for the same reason: `value_bold` is the weight
      // this had before it had three, and a card nobody has edited since is
      // still carrying it.
      const vWeight = this._get('value_font_weight', null)
        || (this._get('value_bold', false) ? '700' : '400');
      let vColor = this._get('value_color', 'var(--primary-text-color)'); 
      
      if (this._get('value_color_adaptive_bar', false)) vColor = isCirc ? exactHexColor : contrastColor(exactHexColor); 
      else if (this._get('value_color_adaptive_theme', false)) vColor = contrastColor(extractHex('var(--primary-background-color)'));
      
      if (isCirc) {
        valueHtml = html`<span style="color:${vColor}; font-size:${vSizeStr}; font-weight:${vWeight}; text-shadow:0 1px 2px rgba(0,0,0,0.5); transform: translateY(${parseDim(this._get('circular_value_offset_y', 0), `0cqmin`, 'cqmin')}); display: block; transition: color 0.1s linear;">${displayValue}</span>`;
      } else {
        const vPos = this._get('value_position', 'center'); 
        const vRot = parseInt(this._get('value_rotation', '0')); 
        const spanStyle = `color:${vColor}; font-size:${vSizeStr}; font-weight:${vWeight}; text-shadow:0 1px 2px rgba(0,0,0,0.5); white-space:nowrap; transform: rotate(${vRot}deg); display: inline-block; transition: color 0.1s linear;`;
        
        if (vPos === 'floating') {
          const fvVertRot = Math.abs(vRot) === 90; 
          const fvHw = `calc(${vSizeStr} * (${displayValue.length} * 0.3 + 0.2) + 4px)`; 
          const fvHh = `calc(${vSizeStr} * 0.6 + 2px)`; 
          const fvClampBase = isHoriz ? (fvVertRot ? fvHh : fvHw) : (fvVertRot ? fvHw : fvHh);
          
          // NEW: Smart indent add-on for the floating text
          let fvClampMin = fvClampBase;
          let fvClampMax = fvClampBase;
          if (isHoriz && hasCardRadius) {
            if (this._isAtLeftEdge) fvClampMin = `calc(${fvClampBase} + ${edgeIndentStr})`;
            if (this._isAtRightEdge) fvClampMax = `calc(${fvClampBase} + ${edgeIndentStr})`;
          }
          
          floatingValueHtml = html`
            <div style="${isHoriz ? `position:absolute; top:50%; left:clamp(${fvClampMin}, calc(${targetPct} * 100%), calc(100% - (${fvClampMax}))); transform: translate(-50%, -50%) translateZ(0); z-index:${ELM_FLOAT}; display:flex; align-items:center; justify-content:center; pointer-events:none;` : `position:absolute; left:50%; bottom:clamp(${fvClampBase}, calc(${targetPct} * 100%), calc(100% - (${fvClampBase}))); transform: translate(-50%, 50%) translateZ(0); z-index:${ELM_FLOAT}; display:flex; align-items:center; justify-content:center; pointer-events:none;`}">
              <span style="${spanStyle}">${displayValue}</span>
            </div>`;
        } else {
          let alignStyles = 'justify-content:center; align-items:center;'; 
          if (vPos === 'start') alignStyles = isHoriz ? 'justify-content:flex-start; padding-left:8px;' : 'align-items:flex-end; padding-bottom:8px; flex-direction:column;'; 
          else if (vPos === 'end') alignStyles = isHoriz ? 'justify-content:flex-end; padding-right:8px;' : 'align-items:flex-start; padding-top:8px; flex-direction:column;';
          
          valueHtml = html`
            <div class="sc-pb-labels" style="display:flex; width:100%; height:100%; position:absolute; inset:0; pointer-events:none; z-index:${ELM_FLOAT}; ${alignStyles}">
              <span style="${spanStyle}">${displayValue}</span>
            </div>`;
        }
      }
    }

    if (isCirc) {
      const circScale = safeFloat(this._get('circular_scale', 100), 100) / 100;
      const circWrapper = html`<div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none; z-index:${ELM_FLOAT}; gap: 2${u}; transform: scale(${circScale}); transform-origin: center;">${valueHtml}${labelHtml}</div>`;
      labelHtml = ''; 
      valueHtml = circWrapper;
    }

    const hostCSS = `width: ${w}; height: ${h}; --pb-radius: ${radius}; --pb-bg-color: ${bgColor};`;

    return html`
      <style>:host { ${hostCSS} } ${pillUprightCSS}</style>
      
      ${lensFraction ? html`
      <svg style="position: absolute; width: 0; height: 0;" aria-hidden="true">
        <defs>${lensFilterElement(LENS_FILTER_ID, 'dome', lensFraction, '.sc-pb-pill')}</defs>
      </svg>` : ''}

      ${isGooey ? html`
      <svg style="position: absolute; width: 0; height: 0;" aria-hidden="true">
        <defs>
          <filter id="sc-goo-filter">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop"/>
          </filter>
        </defs>
      </svg>` : ''}
      
      <div class="sc-pb-wrap ${isCirc ? 'circ' : ''}">
        ${isCirc ? html`<div class="sc-pb-disc"></div>` : ''}
        <div class="sc-liquid-layer ${isGooey ? 'gooey' : ''}">
          ${isCirc ? circularHtml : html`<div class="sc-pb-fill ${orientation}" data-sc-part="fill" style="${fillStyle}"></div>`}
          ${indicatorGooeyHtml}
        </div>
        
        ${floatingValueHtml}
        
        ${this._get('show_ticks', false) && !isCirc ? html`
          <div class="sc-pb-subticks" data-sc-part="sub_ticks" style="position:absolute; inset:0; z-index:${ELM_DYNAMIC + 40};">${subtickElementsEmptyArr}</div>
          <div class="sc-pb-ticks" data-sc-part="ticks" style="z-index:${ELM_DYNAMIC + 50}; ${ticksStyle}">${tickElementsEmptyArr}</div>
          ${tickLabelsEmptyHtml}
          
          <div style="position:absolute; inset:0; z-index:${ELM_DYNAMIC + 55}; clip-path: ${fillClipPath}; pointer-events:none;">
            <div class="sc-pb-subticks" data-sc-part="sub_ticks" style="position:absolute; inset:0;">${subtickElementsFilledArr}</div>
            <div class="sc-pb-ticks" data-sc-part="ticks" style="position:absolute; inset:0; ${ticksStyle}">${tickElementsFilledArr}</div>
            ${tickLabelsFilledHtml}
          </div>
        ` : ''}
        
        ${labelHtml}
        ${valueHtml}
        
        ${indicatorTopHtml}
      </div>`;
  }
}
if (!customElements.get('sc-progressbar')) customElements.define('sc-progressbar', ScProgressbar);

// ==========================================
// 3. THE EDITOR COMPONENT
// ==========================================
const isCirc = cfg => String(cfg.orientation).startsWith('circular');
const isLin = cfg => !String(cfg.orientation).startsWith('circular');

const STYLE_FIELDS = [
  { id: '_section_shape',      icon: icon('proportions'), label: '── Shape & Position',    type: 'section' },
  { id: 'orientation',         label: 'Orientation / Layout',  type: 'select', options: [
    { value: 'horizontal', label: '↔ Linear horizontal' },
    { value: 'vertical', label: '↕ Linear vertical' },
    { value: 'circular_donut', label: '⭕ Circular: Donut (full circle 360°)' },
    { value: 'circular_speedo', label: '⏱️ Circular: Speedo (270°, open at bottom)' },
    { value: 'circular_half', label: '🕳️ Circular: Half circle (180°)' }
  ] },
  { id: 'base_unit',           label: 'Global scaling unit (base unit)', type: 'select', options: [
    { value: 'auto', label: 'Auto (linear: px, circular: cqmin)' },
    { value: 'px', label: 'px (fixed)' },
    { value: 'cqmin', label: 'cqmin (scales with smallest edge)' },
    { value: 'cqw', label: 'cqw (scales with width)' },
    { value: 'cqh', label: 'cqh (scales with height)' }
  ] },
  { id: 'circular_start_position', label: 'Start position (clock)', type: 'select', options: [
    { value: '0', label: '12 o’clock (top)' },
    { value: '90', label: '3 o’clock (right)' },
    { value: '180', label: '6 o’clock (bottom)' },
    { value: '-90', label: '9 o’clock (left)' }
  ], condition: cfg => isCirc(cfg) },
  { id: 'circular_reverse',      label: 'Reverse direction (counter-clockwise)', type: 'checkbox', condition: cfg => isCirc(cfg) },
  { id: 'circular_stroke_width', label: 'Ring thickness / segment height (%)', type: 'range', min: 1, max: 50, step: 1, placeholder: '10', condition: cfg => isCirc(cfg) },
  { id: 'circular_scale',        label: 'Ring scale (%)', type: 'range', min: 10, max: 100, step: 1, placeholder: '100', condition: cfg => isCirc(cfg) },
  { id: 'circular_glow',         label: 'Neon glow effect',      type: 'checkbox', condition: cfg => isCirc(cfg) },
  // A bar on the canvas is as wide as the box it sits in: the canvas writes
  // `width: 100% !important` on the host, and an important declaration from
  // the outer tree beats the `:host` rule this component writes - measured on
  // a live card, a bar configured at 20px came out the box's 30.4px, and even
  // an inline width could not move it. Offering the field there is offering a
  // control that does nothing. Height is *not* overridden - only capped with
  // `max-height` - so the 20px line inside a taller box is still available.
  { id: 'width',               label: 'Width (CSS)',          type: 'text',   placeholder: '100% or 20px',
    condition: (cfg, slot) => !SC.onCanvas(slot) },
  { id: 'height',              label: 'Height (CSS)',            type: 'text',   placeholder: '20px or 100%' },
  { type: 'note', framedWhen: 'corners', label: 'The corners are on the canvas - drag either grip, at the bottom left or the top right.' },
  // A number and the unit it is in, the way a surface's corner is set - and
  // for the same reason: eight of something is a hairline on one bar and a
  // full round end on another, and which of the two is entirely a question of
  // whether the eight is pixels or per cent. The unit rides in the value, as
  // every length a bar owns does; the renderer has always read it that way.
  { id: 'border_radius',       label: 'Corner radius',           type: 'length', dflt: '4px',
    placeholder: '4', min: 0, step: 0.1, condition: cfg => isLin(cfg), framedBy: 'corners' },
  { id: 'circular_border_radius', label: 'Background corner radius', type: 'length', dflt: '50%',
    placeholder: '50', min: 0, step: 1, condition: cfg => isCirc(cfg), framedBy: 'corners' },
  { id: '_section_colors',     icon: icon('palette'), label: '── Colours, Gradient & Animation',   type: 'section' },
  { id: 'animation_duration',  label: 'Animation duration (s)',  type: 'range',  min: 0, max: 10, step: 0.1, placeholder: '0.4' },
  { id: 'bounce_intensity', label: 'Bounce intensity (%)', type: 'range', min: 0, max: 30, dynamic_step: true, placeholder: '50' },
  { type: 'note', framedWhen: 'fill', label: 'What the bar is filled with is on the canvas - the ramp, the two colours and the track are under the chip. The stops stay here.' },
  { id: 'bg_color',            label: 'Background colour',      type: 'color',  placeholder: '#ffffff', framedBy: 'fill' },
  { id: 'bg_opacity',          label: 'Background opacity (%)', type: 'range', min: 0, max: 100, step: 1, placeholder: '10', framedBy: 'fill' },
  // A gradient overwrites the fill outright, so offering the solid colour
  // there would be offering a setting that does nothing.
  { id: 'fill_color',          label: 'Fill colour (solid)',     type: 'color',  placeholder: 'var(--primary-color)',
    condition: cfg => !cfg.use_gradient, framedBy: 'fill' },
  { id: 'use_gradient',        label: 'Use gradient', type: 'checkbox', framedBy: 'fill' },
  { id: 'gradient_as_solid',   label: 'Derive colour from gradient (dynamic)', type: 'checkbox', condition: cfg => cfg.use_gradient, framedBy: 'fill' },
  // The same catalogue the gauge's ring offers, written into the list below.
  // A fill and a ring are coloured by the same question - what the number
  // means - so the answers already mixed for one of them are the answers for
  // the other, and offering them twice over would be two catalogues to keep.
  { id: 'gradient_ramp',       type: 'ramp', condition: cfg => cfg.use_gradient, framedBy: 'fill' },
  { id: 'gradient_stops',      label: 'Gradient colour stops',    type: 'gradient-stops', condition: cfg => cfg.use_gradient },
  // Under the colours, because it paints behind them: the pattern is the bar's
  // backdrop and the track and fill draw on top of it. Only on a canvas, where
  // the renderer names the box it paints.
  { id: '_colour_pattern',     type: 'colour_pattern', condition: (cfg, slot) => !!slot?.canvas },

  { id: '_section_scale',      icon: icon('chart-column'), label: '── Value Range & Main Ticks', type: 'section' },
  { id: 'min',                 label: 'Minimum',               type: 'number', placeholder: '0' },
  { id: 'max',                 label: 'Maximum',               type: 'number', placeholder: '100' },
  { id: 'origin',              label: 'Start point (value, e.g. 0)', type: 'number', placeholder: 'Empty = minimum' },

  { type: 'note', framedWhen: 'ticks', label: 'The ticks are on the canvas while this bar is open - their number and where they sit are under the chip.' },
  { id: 'show_ticks',          label: 'Show ticks',        type: 'checkbox', condition: cfg => isLin(cfg), framedBy: 'ticks' },
  { id: 'tick_count',          label: 'Number of ticks (when interval is empty)', type: 'range',  min: 0, max: 51, step: 1, placeholder: '10',  condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'ticks' },
  { id: 'tick_interval',       label: 'Tick interval (value step)', type: 'number', placeholder: 'e.g. 10', condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'ticks' },
  { id: 'tick_hide_last',      label: 'Hide last tick line', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'ticks' },
  { id: 'tick_align',          label: 'Start point / alignment', type: 'select', options: [{value:'center', label:'Centered'}, {value:'start', label:'At edge (top/left)'}, {value:'end', label:'Opposite (bottom/right)'}, {value:'full', label:'Full width (100%)'}], condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'ticks' },
  { id: 'tick_mirror_side',    label: 'Also mirror on other side', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks && (cfg.tick_align === 'start' || cfg.tick_align === 'end'), framedBy: 'ticks' },
  { id: 'tick_length',         label: 'Main tick length (%, px)', type: 'text', placeholder: '100%', condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'ticks' },
  { id: 'tick_width',          label: 'Tick width (px or %)', type: 'text', placeholder: '1', condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'ticks' },
  { id: 'tick_color_adaptive', label: 'Dual-adaptive colour (inverted at fill level)', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'ticks' },
  { id: 'tick_color',          label: 'Manual colour',        type: 'color',  placeholder: 'rgba(255,255,255,0.3)', condition: cfg => isLin(cfg) && cfg.show_ticks && !cfg.tick_color_adaptive, framedBy: 'ticks' },

  { id: '_section_segments',   icon: icon('puzzle'), label: '── Segments (circle)',   type: 'section', condition: cfg => isCirc(cfg) },
  { id: 'circular_segmented',  label: 'Split circle into pill segments', type: 'checkbox', condition: cfg => isCirc(cfg) },
  { id: 'circular_segment_count', label: 'Number of segments', type: 'range', min: 2, max: 100, step: 1, placeholder: '40', condition: cfg => isCirc(cfg) && cfg.circular_segmented },
  { id: 'circular_segment_thickness', label: 'Pill thickness (%)', type: 'range', min: 0.1, max: 10, step: 0.1, placeholder: '2', condition: cfg => isCirc(cfg) && cfg.circular_segmented },

  { id: '_section_subticks',   icon: icon('ruler'), label: '── Subticks',           type: 'section', condition: cfg => isLin(cfg) && cfg.show_ticks },
  { type: 'note', framedWhen: 'sub_ticks', label: 'The subticks are on the canvas while this bar is open - their number and where they sit are under the chip.' },
  { id: 'show_subticks',       label: 'Show subticks',     type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'sub_ticks' },
  { id: 'subtick_count',       label: 'Count per interval',  type: 'number', placeholder: '4', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_subticks, framedBy: 'sub_ticks' },
  { id: 'subtick_pos',         label: 'Start point / alignment', type: 'select', options: [{value:'main', label:'Same as main ticks'}, {value:'center', label:'Centered'}, {value:'start', label:'At edge (top/left)'}, {value:'end', label:'Opposite (bottom/right)'}, {value:'full', label:'Full width (100%)'}], placeholder: 'main', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_subticks, framedBy: 'sub_ticks' },
  { id: 'subtick_mirror_side', label: 'Also mirror on other side', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_subticks && (cfg.subtick_pos === 'start' || cfg.subtick_pos === 'end'), framedBy: 'sub_ticks' },
  { id: 'subtick_length',      label: 'Subtick length (% or px)',type: 'text', placeholder: '50%', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_subticks && cfg.subtick_pos !== 'full', framedBy: 'sub_ticks' },
  { id: 'subtick_width',       label: 'Width (px or %)',    type: 'text', placeholder: '1', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_subticks, framedBy: 'sub_ticks' },
  { id: 'subtick_color_adaptive', label: 'Dual-adaptive colour (inverted at fill level)', type: 'checkbox', placeholder: 'false', default: false, condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_subticks, framedBy: 'sub_ticks' },
  { id: 'subtick_color',       label: 'Manual colour',        type: 'color', placeholder: 'rgba(255,255,255,0.2)', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_subticks && !cfg.subtick_color_adaptive, framedBy: 'sub_ticks' },

  { id: '_section_custom_ticks', icon: icon('pin'), label: '── Custom Ticks', type: 'section', condition: cfg => isLin(cfg) && cfg.show_ticks },
  { id: 'custom_ticks',        label: 'Insert additional / manual ticks', type: 'custom-ticks', condition: cfg => isLin(cfg) && cfg.show_ticks },

  { id: '_section_tick_labels',icon: icon('type'), label: '── Tick Labels',        type: 'section', condition: cfg => isLin(cfg) && cfg.show_ticks },
  { type: 'note', framedWhen: 'tick_labels', label: 'The tick labels are on the canvas while this bar is open - how many are numbered and to how many places are under the chip.' },
  { id: 'show_tick_labels',    label: 'Show tick labels (numbers)', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'tick_labels' },
  { id: 'tick_labeled_extralength', label: 'Extra length at labels', type: 'text', placeholder: '0', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_label_step',     label: 'Only every Xth label (1=all)', type: 'number', placeholder: '1', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_decimals',label: 'Decimals',        type: 'number', placeholder: '0', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_size',    label: 'Font size (CSS text)', type: 'text', placeholder: '10', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_weight',  label: 'Weight', type: 'select', options: [ { value: '400', label: 'Normal' }, { value: '500', label: 'Medium' }, { value: '700', label: 'Bold' } ], condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_hide_unit', label: 'Hide unit', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_hide_first', label: 'Hide first label (min)', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_hide_last', label: 'Hide last label (max)', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_rotation',  label: 'Text rotation', type: 'select', options: [
    { value: '0', label: '0° (horizontal)' },
    { value: '90', label: '90°' },
    { value: '-90', label: '-90°' },
    { value: '180', label: '180° (upside down)' }
  ], condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels },
  { id: 'tick_labels_color_adaptive', label: 'Dual-adaptive colour (inverted at fill level)', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_color',   label: 'Custom colour',          type: 'color', placeholder: 'var(--secondary-text-color)', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels && !cfg.tick_labels_color_adaptive, framedBy: 'tick_labels' },
  { id: 'tick_labels_pos',     label: 'Positioning',        type: 'select', options: [{value:'start', label:'Before / above'}, {value:'end', label:'After / below'}, {value:'center', label:'Centered'}], condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels },
  { id: 'tick_labels_shift',   label: 'Offset from centre', type: 'text', placeholder: '0', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels },
  { id: 'tick_labels_tick_gap',label: 'Gap to tick', type: 'text', placeholder: '4', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels && cfg.tick_labels_pos !== 'center' },
  { id: 'tick_labels_center_gap_offset', label: 'Adjust centre gap', type: 'text', placeholder: '0', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels && cfg.tick_labels_pos === 'center' },

  { id: '_section_label',      icon: icon('tag'), label: '── Label (Name/Label)', type: 'section' },
  { type: 'note', framedWhen: 'label', label: 'The label is on the canvas while this bar is open - on a straight bar drag it where it goes and take its corner to size it; on a ring its type size is under the chip. Which way it reads is under the chip either way.' },
  { id: 'show_label',          label: 'Show name / label', type: 'checkbox', framedBy: 'label' },
  { id: 'label_font_size',     label: 'Font size (e.g. 12 or 12cqw)', type: 'text', placeholder: '12',  condition: cfg => cfg.show_label, framedBy: 'label' },
  { id: 'label_font_weight',   label: 'Weight', type: 'select', options: [ { value: '400', label: 'Normal' }, { value: '500', label: 'Medium' }, { value: '700', label: 'Bold' } ], condition: cfg => cfg.show_label, framedBy: 'label' },
  { id: 'label_color',         label: 'Text colour (manual)',   type: 'color',  placeholder: 'var(--primary-text-color)', condition: cfg => cfg.show_label && !cfg.label_color_adaptive_bar && !cfg.label_color_adaptive_theme },
  { id: 'label_color_adaptive_bar',   label: 'Adaptive: contrast to bar color', type: 'checkbox', condition: cfg => cfg.show_label && isLin(cfg) },
  { id: 'label_color_adaptive_bar',   label: 'Take colour from gradient', type: 'checkbox', condition: cfg => cfg.show_label && isCirc(cfg) },
  { id: 'label_color_adaptive_theme', label: 'Adaptive: HA theme (light/dark)',   type: 'checkbox', condition: cfg => cfg.show_label },
  { id: 'label_position',      label: 'Position in the bar',    type: '9-sector', condition: cfg => isLin(cfg) && cfg.show_label },
  { id: 'label_offset_x',      label: 'X offset',  type: 'text', placeholder: '0', condition: cfg => isLin(cfg) && cfg.show_label, framedBy: 'label' },
  { id: 'label_offset_y',      label: 'Y offset',  type: 'text', placeholder: '0', condition: cfg => isLin(cfg) && cfg.show_label, framedBy: 'label' },
  { id: 'circular_label_offset_y', label: 'Y offset in circle (%)', type: 'range', min: -100, max: 100, step: 1, placeholder: '0', condition: cfg => isCirc(cfg) && cfg.show_label },
  { id: 'label_rotation',      label: 'Text rotation',         type: 'select', options: [
    { value: '0', label: '0° (horizontal)' },
    { value: '90', label: '90°' },
    { value: '-90', label: '-90°' }
  ], condition: cfg => isLin(cfg) && cfg.show_label, framedBy: 'label' },

  { id: '_section_value',      icon: icon('hash'), label: '── Value & Label', type: 'section' },
  { id: 'show_value',          label: 'Show value',         type: 'checkbox' },
  { id: 'value_animated',      label: 'Animate value (follow fill level)', type: 'checkbox', condition: cfg => cfg.show_value },
  { id: 'value_font_size',     label: 'Font size (e.g. 12 or 12cqw)', type: 'text', placeholder: '12', condition: cfg => cfg.show_value },
  { id: 'value_rotation',      label: 'Text rotation',         type: 'select', options: [
    { value: '0', label: '0° (default)' },
    { value: '90', label: '90° (clockwise)' },
    { value: '-90', label: '-90° (counter-clockwise)' }
  ], condition: cfg => isLin(cfg) && cfg.show_value },
  { id: 'value_color',         label: 'Text colour (manual)',   type: 'color',  placeholder: 'var(--primary-text-color)', condition: cfg => cfg.show_value && !cfg.value_color_adaptive_bar && !cfg.value_color_adaptive_theme },
  { id: 'value_color_adaptive_bar',   label: 'Adaptive: contrast to bar color', type: 'checkbox', condition: cfg => cfg.show_value && isLin(cfg) },
  { id: 'value_color_adaptive_bar',   label: 'Take colour from gradient', type: 'checkbox', condition: cfg => cfg.show_value && isCirc(cfg) },
  { id: 'value_color_adaptive_theme', label: 'Adaptive: HA theme (light/dark)',   type: 'checkbox', condition: cfg => cfg.show_value },
  { id: 'value_font_weight',   label: 'Weight', type: 'select', options: [ { value: '400', label: 'Normal' }, { value: '500', label: 'Medium' }, { value: '700', label: 'Bold' } ], condition: cfg => cfg.show_value },
  { id: 'value_decimals',      label: 'Decimals',      type: 'range',  min: 0, max: 3, step: 1, placeholder: '0', condition: cfg => cfg.show_value },
  { id: 'value_unit',          label: 'Custom unit (e.g. %)', type: 'text', placeholder: 'Optional', condition: cfg => cfg.show_value },
  { id: 'value_position',      label: 'Text position',         type: 'select', options: [
    { value: 'center',   label: 'Centred in bar' },
    { value: 'start',    label: 'At the start' },
    { value: 'end',      label: 'At the end' },
    { value: 'floating', label: 'Follows the fill level' }
  ], condition: cfg => isLin(cfg) && cfg.show_value },
  { id: 'circular_value_offset_y', label: 'Y offset in circle (%)', type: 'range', min: -100, max: 100, step: 1, placeholder: '0', condition: cfg => isCirc(cfg) && cfg.show_value },

  { id: '_section_indicator',  icon: icon('pill'), label: '── Indicator & Pill',  type: 'section', condition: cfg => isLin(cfg) },
  { id: 'show_indicator',      label: 'Show indicator line', type: 'checkbox', condition: cfg => isLin(cfg) },
  { id: 'indicator_color_adaptive', label: 'Dual-adaptive colour (inverted at fill level)', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_indicator, framedBy: 'pill' },
  { id: 'indicator_color',     label: 'Line colour',       type: 'color',  placeholder: '#ffffff', condition: cfg => isLin(cfg) && cfg.show_indicator && !cfg.indicator_color_adaptive, framedBy: 'pill' },
  { id: 'indicator_thickness', label: 'Line thickness (px/%)',type: 'text', placeholder: '2px', condition: cfg => isLin(cfg) && cfg.show_indicator, framedBy: 'pill' },
  { type: 'note', framedWhen: 'pill', label: 'The pill is on the canvas while this bar is open - the line it rides, its own colours, its type and its glass are all under the chip.' },
  { id: 'indicator_value',     label: 'Show pill with value on line', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_indicator, framedBy: 'pill' },
  { id: 'value_animated',      label: 'Animate value (follow fill level)', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value, framedBy: 'pill' },
  { id: 'indicator_value_rotation', label: 'Pill rotation', type: 'select', framedBy: 'pill', options: [
    { value: 'auto', label: 'Auto (upright, as it reads)' },
    { value: '0', label: '0° (horizontal)' },
    { value: '90', label: '90°' },
    { value: '-90', label: '-90°' },
    { value: '180', label: '180° (upside down)' }
  ], condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value },
  // Said where the turn is chosen, because that is where it looks like a free
  // choice. The card keeps the setting either way - it is the drawing that
  // gives way, and it gives way back the moment there is room.
  { type: 'note', framedBy: 'pill', label: 'On its end, the reading has to fit across the bar. Where the bar is too flat for it the pill stands itself upright instead of shrinking out of legibility, and lies back down when the bar is tall enough.',
    condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value
      && Math.abs(parseInt(cfg.indicator_value_rotation)) === 90 },
  { id: 'indicator_value_decimals', label: 'Pill decimal places', type: 'range', min: 0, max: 3, step: 1, placeholder: '0', condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value, framedBy: 'pill' },
  { id: 'indicator_value_adaptive_mode', label: 'Adaptive behavior', type: 'select', framedBy: 'pill', options: [
    { value: 'none', label: 'None (manual colours)' },
    { value: 'pill', label: 'Whole pill (background adaptive, text contrast)' },
    { value: 'text', label: 'Text only (text adaptive, background manual)' }
  ], condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value },
  { id: 'indicator_value_bg',  label: 'Pill background colour', type: 'color',  placeholder: '#000000', condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value && cfg.indicator_value_adaptive_mode !== 'pill', framedBy: 'pill' },
  { id: 'indicator_value_opacity', label: 'Pill opacity (%)', type: 'range', min: 0, max: 100, step: 1, placeholder: '100', condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value, framedBy: 'pill' },
  { id: 'indicator_glass_effect', label: 'Glass effect (pill)', type: 'select', framedBy: 'pill', options: [
    { value: 'none', label: 'No effect (default)' },
    { value: 'glass_gooey', label: 'Liquid & gooey (3D glass + merging)' },
    { value: 'glass_clean', label: 'Clean frost (Apple style)' },
    { value: 'glass_clear', label: 'Clear 3D glass' },
    { value: 'glass_lens', label: 'Convex lens (magnifier)' },
    { value: 'glass_dark', label: 'Dark tinted glass' },
    { value: 'glass_liquid', label: 'Liquid glass (refracts the bar)' },
    { value: 'glass_liquid_heavy', label: 'Liquid glass, thick (more refraction)' }
  ], condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value },
  { id: 'indicator_value_color', label: 'Pill text colour',     type: 'color',  placeholder: '#ffffff', condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value && cfg.indicator_value_adaptive_mode === 'none', framedBy: 'pill' },
  { id: 'indicator_value_font_size', label: 'Pill font size (CSS text)', type: 'text', placeholder: '10', condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value, framedBy: 'pill' },
];

/**
 * What a progressbar is before anyone configures it.
 *
 * The canvas adds bars too, and it has no business knowing what one contains
 * - that is this module's, so both add buttons ask here.
 */
function newProgressbarEntry() { return { entity: '', attribute: '', label_text: '' }; }

class ScProgressbarEditor extends LitElement {
  static get properties() {
    return { hass: { type: Object }, slot: { type: Object }, commitFn: { type: Function },
             only: { type: Number }, _expanded: { type: Object, state: true },
             // Which parts the canvas has taken over, and which fold the part
             // in hand belongs to. Both are the canvas editor's to say, and
             // both mean nothing when this editor is opened from the card's
             // own menu, which is why neither has a default beyond empty.
             framed: { type: Array }, priority: { type: String } };
  }

  constructor() {
    super();
    this._expanded = {};
  }

  static get styles() {
    // The gauge editor's look, because the two are the same kind of form and
    // used to differ only in which stylesheet they happened to start from.
    return [SC.formStyles, css`
      input[type="text"], input[type="number"], select { transition: border-color 0.2s; }
      .fx-slot { margin: 8px 0; padding: 8px; border-radius: 6px;
                 background: rgba(255,255,255,0.03); border: 1px solid var(--divider-color,#555); }
      details.inner-section { background: rgba(120,120,120,0.05); border: 1px solid var(--divider-color,#444); border-radius: 6px; margin: 0 16px 16px 16px; }
      /* A column so that the order property means something: the fold whose
         part is in hand on the canvas comes first, however far down it sits. */
      .folds { display: flex; flex-direction: column; }
      details.inner-section.wanted { order: -1; border-color: var(--primary-color,#03a9f4); }
      .field-note { font-size: 11px; line-height: 1.4; color: var(--secondary-text-color); }
      .inner-content { padding: 0 12px 12px 12px; display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--divider-color,#444); margin-top: 4px; padding-top: 12px; }
      ha-entity-picker, ha-selector { display: block; width: 100%; }
      .entity-row { display: flex; flex-direction: column; gap: 4px; }
      .field-wrapper { display: block; }
      button.add-btn { margin-top:4px; padding:8px; border-radius:8px; border:1px dashed var(--primary-color,#03a9f4); background:none; color:var(--primary-color,#03a9f4); cursor:pointer; font-size:13px; width:100%; }
      .sector-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 2px;
        width: 54px;
        height: 54px;
        margin-top: 4px;
      }
      .sector-btn {
        background: var(--divider-color, #555);
        border-radius: 2px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .sector-btn:hover { background: var(--primary-color, #03a9f4); opacity: 0.7; }
      .sector-btn.active { background: var(--primary-color, #03a9f4); box-shadow: 0 0 4px rgba(3,169,244,0.5); }

      /* A custom tick is a row of small fields, which is a bar's own shape. */
      .stop-row { display: flex; align-items: center; gap: 5px; background: rgba(255,255,255,0.04); padding: 4px 6px; border-radius: 4px; }
      .stop-row input[type="color"] { width: 32px; height: 26px; padding: 0; border: none; background: none; cursor: pointer; flex-shrink: 0; }
      .stop-row input[type="text"], .stop-row input[type="number"] { font-size: 11px; }
      .stop-row .del-btn { background: none; border: none; color: #f44; cursor: pointer; font-size: 14px; padding: 0; }
    `];
  }

  _addProgressbar(bars) {
    const newBars = structuredClone(bars);
    newBars.push(newProgressbarEntry());
    this._expanded[`pb_${newBars.length - 1}`] = true;
    this.commitFn('progressbars', newBars);
  }

  _removeProgressbar(idx, bars) {
    const newBars = structuredClone(bars);
    newBars.splice(idx, 1);
    this.commitFn('progressbars', newBars);
  }

  _renderField(field, cfg, updateDirect, updateDebounced, idx, updateMany) {
    if (field.condition && !field.condition(cfg, this.slot)) return html``;
    // This editor draws its own fields, so the rule the shared renderer
    // applies has to be asked for by name here - not written out a second
    // time, or the two would drift.
    if (SC.fieldFramed(field, cfg, new Set(this.framed || []))) return html``;
    let content;
    const val = cfg[field.id];

    switch (field.type) {
      case 'colour_pattern':
        // The pattern layer is the bar's backdrop - track, fill and pill draw
        // over it. Pump is left out: it would scale that backdrop alone, under
        // a bar that stays where it is.
        content = html`
          <sc-color-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                          .switchless=${true} .noPump=${true}
                          .label=${'Background pattern & animation'}
                          .target=${'elm_progressbar_' + idx}></sc-color-panel>`;
        break;
      case 'section':
        content = html`<div class="section-title">${field.icon
          ? html`<span class="field-icon">${field.icon}</span>` : ''}${field.label}</div>`;
        break;
      // Not a control: the line that stands in for a row the canvas has taken
      // over, so a fold that has lost most of itself does not read as one that
      // is missing something.
      case 'note':
        return html`<div class="field-note">${field.icon
          ? html`<span class="field-icon">${field.icon}</span>` : ''}${field.label}</div>`;
      case 'checkbox':
        content = html`
          <div class="row">
            <label>${field.label}</label>
            <label class="toggle">
              <input type="checkbox" .checked=${val === true} @change=${e => updateDirect(e.target.checked)}>
              <span class="toggle-slider"></span>
            </label>
          </div>`;
        break;
      case 'select':
        content = html`
          <div class="row">
            <label>${field.label}</label>
            <select @change=${e => updateDirect(e.target.value)}>
              ${field.options.map(opt => html`<option value="${opt.value}" ?selected=${val === opt.value}>${opt.label}</option>`)}
            </select>
          </div>`;
        break;
      case '9-sector': {
        const sectors = ['top-left','top-center','top-right','center-left','center','center-right','bottom-left','bottom-center','bottom-right'];
        content = html`
          <div class="col">
            <label>${field.label}</label>
            <div class="sector-grid">
              ${sectors.map(s => html`<div class="sector-btn ${val === s ? 'active' : ''}" title="${s}" @click=${() => updateDirect(s)}></div>`)}
            </div>
          </div>`;
        break;
      }
      case 'range': {
        // A dynamic step is fine-grained below ten and whole above it, and it
        // has to follow the value as it is dragged, not only per render.
        const shown = val ?? field.placeholder ?? 0;
        const step = field.dynamic_step ? (shown < 10 ? '0.1' : '1') : (field.step ?? 1);
        content = SC.sliderField(field.label, shown, v => updateDirect(v),
          { min: field.min ?? 0, max: field.max ?? 100, step,
            shown: val ?? field.placeholder ?? '', dynamicStep: !!field.dynamic_step });
        break;
      }
      case 'color':
        content = html`
          <div class="col">
            <label>${field.label}</label>
            ${SC.colorRow(val || '', updateDirect, { fallback: '#000000',
              placeholder: field.placeholder || '', onText: updateDebounced })}
          </div>`;
        break;
      // A length and the unit it is in, the way a surface's corner is set.
      case 'length':
        content = SC.lengthField(field.label, val, updateDirect,
          { dflt: field.dflt, placeholder: field.placeholder,
            min: field.min, max: field.max, step: field.step });
        break;
      case 'ramp':
        content = updateMany
          ? SC.rampGrid(id => updateMany(gradientPresetPatch(id, 'bar')))
          : html``;
        break;
      case 'gradient-stops':
        content = html`
          <div class="col">
            <label>${field.label}</label>
            <sc-gradient-stops .onUpdate=${n => updateDirect(n)}
              .stops=${Array.isArray(val) && val.length ? val
                : [{ color: cfg.color1 || '#2196f3', pos: 0 },
                   { color: cfg.color2 || '#4caf50', pos: 100 }]}></sc-gradient-stops>
          </div>`;
        break;
      case 'custom-ticks': {
        const ct = Array.isArray(val) ? val : [];
        const updCt = n => updateDirect(n);
        content = html`
          <div class="col">
            <label>${field.label}</label>
            ${ct.map((t, ti) => html`
              <div class="stop-row" style="flex-wrap:wrap; gap:6px; margin-bottom:4px; padding:8px; background:rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.05); border-radius:6px;">
                <div style="display:flex; align-items:center; gap:4px;">
                  <span style="font-size:10px; color:var(--secondary-text-color);">Value</span>
                  <input type="number" placeholder="Value" style="width:40px" .value=${t.value ?? 50} @input=${e => updCt(ct.map((x,i) => i===ti ? {...x, value: parseFloat(e.target.value)||0} : x))}>
                </div>
                <div style="display:flex; align-items:center; gap:4px;">
                  <input type="color" .value=${t.color || '#ff0000'} @input=${e => updCt(ct.map((x,i) => i===ti ? {...x, color: e.target.value} : x))}>
                </div>
                <div style="display:flex; align-items:center; gap:4px;">
                  <span style="font-size:10px; color:var(--secondary-text-color);">Width</span>
                  <input type="text" style="width:40px" placeholder="W(px/%)" .value=${t.width || '2px'} @input=${e => updCt(ct.map((x,i) => i===ti ? {...x, width: e.target.value} : x))}>
                </div>
                <div style="display:flex; align-items:center; gap:4px;">
                  <span style="font-size:10px; color:var(--secondary-text-color);">Length</span>
                  <input type="text" style="width:45px" placeholder="main" title="Empty or 'main' for main tick length" .value=${t.length || ''} @input=${e => updCt(ct.map((x,i) => i===ti ? {...x, length: e.target.value} : x))}>
                </div>
                <div style="display:flex; align-items:center; gap:4px; flex:1;">
                  <select style="width:100%; font-size:11px; padding:2px;" @change=${e => updCt(ct.map((x,i) => i===ti ? {...x, align: e.target.value} : x))}>
                    <option value="main" ?selected=${!t.align || t.align === 'main'}>Pos: Same as main</option>
                    <option value="center" ?selected=${t.align === 'center'}>Pos: Centred</option>
                    <option value="start" ?selected=${t.align === 'start'}>Pos: Edge 1</option>
                    <option value="end" ?selected=${t.align === 'end'}>Pos: Edge 2</option>
                    <option value="full" ?selected=${t.align === 'full'}>Pos: Full</option>
                  </select>
                </div>
                ${(t.align === 'start' || t.align === 'end') ? html`
                  <div style="display:flex; align-items:center; gap:2px;" title="Mirror to other side">
                    <input type="checkbox" .checked=${!!t.mirror} @change=${e => updCt(ct.map((x,i) => i===ti ? {...x, mirror: e.target.checked} : x))}>
                    <span style="font-size:10px; opacity:0.8;">${icon('flip-vertical')}</span>
                  </div>
                ` : ''}
                <button class="del-btn" @click=${() => updCt(ct.filter((_,i) => i !== ti))}>${icon('trash-2')}</button>
              </div>`)}
            <button type="button" class="add-btn" style="margin-top:4px; padding:6px;"
              @click=${() => updCt([...ct, { value: 50, color: '#ff0000', width: '2px', length: '', align: 'main', mirror: false }])}>${icon('plus')} Add custom tick</button>
          </div>`;
        break;
      }
      default:
        content = html`
          <div class="col">
            <label>${field.label}</label>
            <input type=${field.type === 'number' ? 'number' : 'text'} .value=${val ?? ''} placeholder="${field.placeholder || ''}"
              @input=${e => updateDebounced(field.type === 'number' ? parseFloat(e.target.value) : e.target.value)}>
          </div>`;
        break;
    }
    return html`<div class="field-wrapper">${content}</div>`;
  }

  _renderFieldsGroup(fields, cfg, idx, bars) {
    let timeout;
    const updateDirect    = (key, val) => {
      const next = SC.withPatch(bars, idx, key, val);
      if (key === 'orientation') {
        // A ring is square-locked on the canvas, and the canvas squares a box
        // only when someone edits it. Picking the orientation is that edit, so
        // the box follows now instead of staying a letterbox until the next
        // drag. One commit for both: `_commit` clones the config and Home
        // Assistant writes it back asynchronously, so two in a tick lose one.
        const canvas = squareBarOnCanvas(this.slot?.canvas, idx, val);
        if (canvas && canvas !== this.slot.canvas) {
          this.commitFn('__merge__', { progressbars: next, canvas });
          return;
        }
      }
      this.commitFn('progressbars', next);
    };
    const updateDebounced = (key, val) => { clearTimeout(timeout); timeout = setTimeout(() => updateDirect(key, val), 400); };
    // One press, several keys: a ramp is its colours *and* the switch that
    // says the fill is one. Written in a single commit, because `_commit`
    // clones the config and Home Assistant writes it back asynchronously -
    // two commits in a tick silently lose the first.
    const updateMany = patch => {
      if (!patch) return;
      const next = structuredClone(bars);
      Object.assign(next[idx], patch);
      this.commitFn('progressbars', next);
    };

    const groups = [];
    let cur = null;
    fields.forEach(f => {
      if (f.type === 'section') { if (cur) groups.push(cur); cur = { id: f.id, icon: f.icon, label: f.label.replace('── ', ''), fields: [] }; }
      else if (cur) cur.fields.push(f);
    });
    if (cur) groups.push(cur);

    return html`
      <div class="folds">
      ${groups.map(g => {
        const visibleFields = g.fields.filter(f => !f.condition || f.condition(cfg, this.slot));
        if (visibleFields.length === 0) return html``;

        const sKey = `s_${idx}_${g.label}`;
        if (this._expanded[sKey] === undefined) this._expanded[sKey] = false;
        // The fold the part in hand lives in is opened and pulled to the top.
        // The numbers on the canvas are the ones reached for first; the rest
        // of what a part can be given is in here, and it used to be eight
        // folds down - far enough that reaching it scrolled the canvas, and a
        // frame that cannot be seen cannot be dragged.
        const wanted = !!g.id && this.priority === g.id;
        return html`
          <details class="inner-section ${wanted ? 'wanted' : ''}" data-section=${g.id || ''}
            ?open=${this._expanded[sKey] || wanted}
            @toggle=${e => { this._expanded[sKey] = e.target.open; this.requestUpdate(); }}>
            <summary style="display:flex; justify-content:space-between; align-items:center;">
              <span style="flex: 1;">${g.icon
                  ? html`<span class="field-icon">${g.icon}</span>` : ''}${g.label}</span>
              <span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('chevron-down')}</span>
            </summary>
            <div class="inner-content">
              ${g.fields.map(f => this._renderField(f, cfg, v => updateDirect(f.id, v), v => updateDebounced(f.id, v), idx, updateMany))}
            </div>
          </details>`;
      })}
      </div>`;
  }

  _renderBarPanel(entry, idx, bars) {
    const { entity: resolvedEntity, match: aliasObj } = SC.resolveAlias(this.slot?.global_entities, entry);
    const isAlias = !!aliasObj;

    let title = '';
    if (isAlias) {
      const s = resolvedEntity ? this.hass?.states[resolvedEntity] : null;
      const friendly = s ? (s.attributes.friendly_name || resolvedEntity) : (resolvedEntity || 'Unnamed');
      let val = s ? (aliasObj.attribute ? s.attributes[aliasObj.attribute] : s.state) : '-';
      const uom = (s && !aliasObj.attribute && s.attributes.unit_of_measurement) ? ` ${s.attributes.unit_of_measurement}` : '';
      title = `[${aliasObj.alias || 'Alias'}] ${friendly}`;
      if (aliasObj.attribute) title += ` (${aliasObj.attribute})`;
      title += ` ➔ ${val}${uom}`;
    } else {
      title = entry.label_text || '';
      if (!title && resolvedEntity && this.hass?.states[resolvedEntity]) {
        title = this.hass.states[resolvedEntity].attributes.friendly_name || resolvedEntity;
      } else if (!title) {
        title = `Bar ${idx + 1}`;
      }
    }

    const stateKey = `pb_${idx}`;
    if (this._expanded[stateKey] === undefined) this._expanded[stateKey] = false;
    const updateEntry = (key, val) => { this.commitFn('progressbars', SC.withPatch(bars, idx, key, val)); };

    return html`
      <details class="inner-section" ?open=${this._expanded[stateKey]} @toggle=${e => this._expanded[stateKey] = e.target.open}>
        <summary style="opacity: ${entry.active !== false ? '1' : '0.6'};">
          <span>${title}</span>
          <div style="display:flex; gap:12px; align-items:center;" @click=${e => e.stopPropagation()}>
            <ha-switch
              .checked=${entry.active !== false}
              title="Enable / disable bar"
              style="margin-right: 4px;"
              @change=${e => updateEntry('active', e.target.checked)}>
            </ha-switch>
            <button title="Clone"
              style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--primary-color);padding:0;"
              @click=${e => {
                e.preventDefault();
                const n = structuredClone(bars);
                const clone = structuredClone(n[idx]);
                if(clone.label_text) clone.label_text += ' (Copy)';
                n.splice(idx + 1, 0, clone);
                this.commitFn('progressbars', n);
                this._expanded[`pb_${idx + 1}`] = true;
                this.requestUpdate();
              }}>${icon('copy')}</button>
            <button title="Move up" ?disabled=${idx === 0}
              style="background:none;border:none;cursor:${idx===0?'default':'pointer'};font-size:14px;color:${idx===0?'var(--divider-color,#555)':'var(--primary-text-color)'};padding:0;"
              @click=${e => { e.preventDefault(); if(idx===0) return; const n=structuredClone(bars); const t=n[idx-1]; n[idx-1]=n[idx]; n[idx]=t; this.commitFn('progressbars',n); }}>${icon('chevron-up')}</button>
            <button title="Move down" ?disabled=${idx === bars.length-1}
              style="background:none;border:none;cursor:${idx===bars.length-1?'default':'pointer'};font-size:14px;color:${idx===bars.length-1?'var(--divider-color,#555)':'var(--primary-text-color)'};padding:0;"
              @click=${e => { e.preventDefault(); if(idx===bars.length-1) return; const n=structuredClone(bars); const t=n[idx+1]; n[idx+1]=n[idx]; n[idx]=t; this.commitFn('progressbars',n); }}>${icon('chevron-down')}</button>
            <button title="Remove"
              style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--error-color,#f44);padding:0;"
              @click=${e => { e.preventDefault(); this._removeProgressbar(idx, bars); }}>${icon('trash-2')}</button>
          </div>
        </summary>
        ${this._renderBarBody(entry, idx, bars)}
      </details>`;
  }

  /**
   * One bar's fields, without the panel around them.
   *
   * Its own section renders it inside a `<details>` that names the entry; the
   * canvas editor renders it alone, under the element the user has selected,
   * where the element list above it has already said which bar this is.
   */
  _renderBarBody(entry, idx, bars) {
    const updateEntry = (key, val) => { this.commitFn('progressbars', SC.withPatch(bars, idx, key, val)); };
    return html`
        <div class="inner-content">
          <div class="entity-row">
            <label>Internal name / manual label</label>
            <input type="text" .value=${entry.label_text || ''} placeholder="Shown on the bar (if active)"
              ?disabled=${entry.use_alias_name && entry.global_id && entry.global_id !== 'manual'}
              style=${entry.use_alias_name && entry.global_id && entry.global_id !== 'manual' ? 'opacity: 0.5;' : ''}
              @input=${e => updateEntry('label_text', e.target.value)}>
          </div>

          <div class="entity-row" style="margin-top: 4px; margin-bottom: 4px;">
            <label>Data source</label>
            <select style="width: 100%;" @change=${e => updateEntry('global_id', e.target.value)}>
              <option value="manual" ?selected=${entry.global_id === 'manual' || !entry.global_id}>Manual selection</option>
              ${(this.slot?.global_entities || []).map(ge => {
                const stateObj = ge.entity ? this.hass.states[ge.entity] : null;
                const name = ge.alias || stateObj?.attributes?.friendly_name || ge.entity || 'Unnamed';
                let val = stateObj ? stateObj.state : '-';
                if (stateObj && ge.attribute && stateObj.attributes[ge.attribute] !== undefined) {
                  val = stateObj.attributes[ge.attribute];
                }
                const uom = (!ge.attribute && stateObj?.attributes?.unit_of_measurement) ? ` ${stateObj.attributes.unit_of_measurement}` : '';
                const attrLabel = ge.attribute ? ` (${ge.attribute})` : '';
                const label = `[${ge.alias || 'Alias'}] ${name}${attrLabel}: ${val}${uom}`;

                return html`<option value=${ge.id} ?selected=${entry.global_id === ge.id}>${label}</option>`;
              })}
            </select>
          </div>

          ${(entry.global_id && entry.global_id !== 'manual') ? html`
            <div class="row" style="margin-bottom: 8px; background: rgba(3, 169, 244, 0.1); padding: 6px 8px; border-radius: 4px; border: 1px solid rgba(3, 169, 244, 0.2);">
              <label style="color: var(--primary-color);">Use alias name as bar label</label>
              <label class="toggle">
                <input type="checkbox" .checked=${!!entry.use_alias_name}
                  @change=${e => updateEntry('use_alias_name', e.target.checked)}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          ` : html`
            <div style="background:rgba(0,0,0,0.15); padding:10px; border-radius:8px; border:1px solid var(--divider-color,#333); margin-bottom:8px;">
              <div class="entity-row" style="margin-bottom: 8px;">
                <label>Source</label>
                <ha-entity-picker .hass=${this.hass} .allowCustomEntity=${false} .value=${entry.entity || ''} @value-changed=${e => updateEntry('entity', e.detail.value)}></ha-entity-picker>
              </div>
              <div class="entity-row">
                <label>Attribute</label>
                <ha-selector .hass=${this.hass} .selector=${{ attribute: { entity_id: entry.entity || this.slot?.entity || '' } }} .value=${entry.attribute || ''} @value-changed=${e => updateEntry('attribute', e.detail.value || '')}></ha-selector>
              </div>
            </div>
          `}

          ${bars.length > 1 ? html`
            <div class="row" style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--divider-color,#444);">
              <label>Copy style from...</label>
              <select style="width:60%" @change=${e => {
                const srcIdx = parseInt(e.target.value);
                if (isNaN(srcIdx)) return;
                const n = structuredClone(bars);
                const src = n[srcIdx];
                n[idx] = { ...src, entity: n[idx].entity, attribute: n[idx].attribute, label_text: n[idx].label_text, global_id: n[idx].global_id };
                this.commitFn('progressbars', n);
                e.target.value = '';
              }}>
                <option value="" selected disabled>Please select...</option>
                ${bars.map((b,i) => i !== idx ? html`<option value=${i}>Bar ${i+1}${b.label_text?' — '+b.label_text:(b.entity?' — '+b.entity.split('.')[1]:'')}</option>` : '')}
              </select>
            </div>` : ''}
          ${this._renderFieldsGroup(STYLE_FIELDS, entry, idx, bars)}
          <div class="fx-slot">
            <sc-fx-glass-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                               .target=${'elm_progressbar_' + idx}></sc-fx-glass-panel>
          </div>
          <div class="fx-slot">
            <sc-push-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                           .target=${'progressbar_' + idx}></sc-push-panel>
          </div>
        </div>`;
  }

  render() {
    if (!this.slot) return html``;
    const bars = Array.isArray(this.slot.progressbars) ? this.slot.progressbars : [];
    // One entry alone, for the canvas editor: no section, no switch, no add
    // button - the canvas has already chosen which bar is being edited.
    if (typeof this.only === 'number') {
      return bars[this.only] ? this._renderBarBody(bars[this.only], this.only, bars) : html``;
    }
    if (this._expanded['_main'] === undefined) this._expanded['_main'] = false;

    return html`
      <details class="inner-section" ?open=${this._expanded['_main']}
        @toggle=${e => { this._expanded['_main'] = e.target.open; this.requestUpdate(); }}>
        <summary>${icon('chart-gantt')} Progressbars
          <div style="display:flex; align-items:center; gap:8px; margin-left:auto;">
            <span style="font-size:10px; opacity:.6; font-weight:400;">
              ${bars.length} Bar${bars.length !== 1 ? 's' : ''}
            </span>
            <ha-switch
              .checked=${!!this.slot.progressbar_active}
              @click=${e => e.stopPropagation()}
              @change=${e => this.commitFn('progressbar_active', e.target.checked)}>
            </ha-switch>
          </div>
        </summary>
        <div class="inner-content">
          ${!this.slot.progressbar_active ? html`
            <div style="font-size:12px; color:var(--secondary-text-color); text-align:center; padding:8px 0;">
              Module disabled
            </div>` : html`
            ${bars.map((entry, idx) => this._renderBarPanel(entry, idx, bars))}
            <button type="button" class="add-btn" @click=${() => this._addProgressbar(bars)}>
              ${icon('plus')} Add new progressbar
            </button>`}
        </div>
      </details>`;
  }
}
if (!customElements.get('sc-progressbar-editor')) customElements.define('sc-progressbar-editor', ScProgressbarEditor);

// ==========================================
// 4. BRIDGE TO CORE
// ==========================================
window.SupercardModules = window.SupercardModules || {};
window.SupercardModules['progressbar'] = window.SupercardModules['progressbar'] || {};
Object.assign(window.SupercardModules['progressbar'], (() => {
  function update({ config, hass }) {
    if (!config?.progressbar_active) return {};
    const bars = Array.isArray(config.progressbars) && config.progressbars.length > 0 ? config.progressbars : [];
    if (bars.length === 0) return {};
    return {
      // See the note in the gauge module: a bar the canvas has no box for is
      // never slotted, and would draw full-width in the card's own flow.
      litOverlay: html`${bars.map((cfg, idx) => cfg.active !== false && SC.showsElement(config, `progressbar_${idx}`) ? html`
        <sc-progressbar data-idx="${idx}" .config=${cfg} .hass=${hass} .rootConfig=${config} .globalEntities=${config.global_entities}></sc-progressbar>
      ` : '')}`
    };
  }

  function editorFields() { return []; }

  let _cachedEditor = null;
  function renderCustomBlock(commitFn, hass, slot) {
    if (!_cachedEditor) _cachedEditor = document.createElement('sc-progressbar-editor');
    _cachedEditor.commitFn = commitFn;
    _cachedEditor.hass = hass;
    _cachedEditor.slot = slot;
    return _cachedEditor;
  }

  return /** @type {SupercardModule} */ ({ update, editorFields, renderCustomBlock,
                                           newEntry: newProgressbarEntry,
                                           ownedByCanvas: true });
})());