import { LitElement, html, svg, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { normalizeStops, stopsToCss } from "./gradient-stops.js";
import { lightParams, reliefPattern, reliefShadow, reliefLayers } from "./glass-light.js";
import { isLiquidEffect, pillLensFraction, liquidPillCSS, liquidPadding, pillFontSize,
         pillCrossExtent } from "./pill-glass.js";
import { applyLensGeometry, lensFilterElement } from "./glass-lens.js";
import { suspendable, watchModalSuspend } from "./glass-suspend.js";
import { adaptiveInk } from "./adaptive-ink.js";

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
        <defs>${lensFilterElement(LENS_FILTER_ID, 'dome', lensFraction, '.sc-pb-pill', undefined, this)}</defs>
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

  return /** @type {SupercardModule} */ ({ update });
})());
