import { LitElement, html, svg, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { normalizeStops } from "./gradient-stops.js";
import { autoStep, staggerRows, ROW_GAP, rowBox, boxReach } from "./tick-labels.js";
import { gaugeScale, NO_TIER_STATE, tickMultiplier, multiplierParts } from "./gauge-scale.js";
import { ringRadius, ringPartRadius, gaugeOuter, frameBand, gaugeScaleOf } from "./gauge-inner-boxes.js";

const SC = window.SupercardUtils;

// --- HELPER FUNCTIONS ---
const { safeFloat } = window.SupercardUtils;
const polarToCart = (cx, cy, r, deg) => { const rad = deg * Math.PI / 180; return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }; };

const toRgbArray = SC.toRgb;
const interpolateColor = (c1, c2, f) => {
  const a = toRgbArray(c1) || [128,128,128]; const b = toRgbArray(c2) || [128,128,128];
  return [Math.round(a[0]+f*(b[0]-a[0])), Math.round(a[1]+f*(b[1]-a[1])), Math.round(a[2]+f*(b[2]-a[2]))];
};
const resolveColor = (type, arr) => {
  if (type === 'adaptive') return 'var(--primary-text-color)';
  const rgb = toRgbArray(arr); if (rgb) return `rgb(${rgb.join(',')})`;
  if (typeof arr === 'string' && arr.startsWith('rgb')) return arr;
  return arr || 'var(--primary-text-color)';
};
const buildSectorPath = (cx, cy, innerR, outerR, startAng, endAng) => {
  if (Math.abs(endAng - startAng) >= 360) endAng = startAng + 359.99;
  const p1 = polarToCart(cx, cy, outerR, startAng), p2 = polarToCart(cx, cy, outerR, endAng);
  const p3 = polarToCart(cx, cy, innerR, endAng),   p4 = polarToCart(cx, cy, innerR, startAng);
  const la = Math.abs(endAng - startAng) > 180 ? 1 : 0;
  return `M${p1.x.toFixed(3)},${p1.y.toFixed(3)} A${outerR},${outerR},0,${la},1,${p2.x.toFixed(3)},${p2.y.toFixed(3)} L${p3.x.toFixed(3)},${p3.y.toFixed(3)} A${innerR},${innerR},0,${la},0,${p4.x.toFixed(3)},${p4.y.toFixed(3)}Z`;
};

// --- THE LIT COMPONENT ---
class ScGauge extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      globalEntities: { type: Array },
      // Set by the card when it renders from a canvas, where the element's
      // box is the gauge's size and the gauge's own pixel figure is not.
      onCanvas: { type: Boolean },
      // Set by the canvas editor while the pointer or its hub is the part in
      // hand. A needle that swings away mid-drag is a needle whose length
      // cannot be set, and a live entity is free to move at any moment.
      frozen: { type: Boolean },
      _isInitialized: { type: Boolean, state: true }
    };
  }

  static get styles() {
    return css`
      :host { display: block; position: relative; width: 100%; height: 100%; pointer-events: none; }
      
      .text-container      { position: static !important; }
      .supercard-container { position: relative !important; }
      
      @keyframes sc-pulse-bg   { 0%,100%{opacity:0.15;transform:translateZ(0)} 50%{opacity:0.65;transform:translateZ(0)} }
      @keyframes sc-pulse-frame{ 0%,100%{opacity:0.2;transform:translateZ(0)}  50%{opacity:1.0;transform:translateZ(0)} }
      @keyframes sc-ripple-expand {
        0%   { transform: scale(0.08) translateZ(0); opacity: 0.9; }
        85%  { opacity: 0; }
        100% { transform: scale(var(--sc-ripple-scale,8)) translateZ(0); opacity: 0; }
      }
      @keyframes sc-ripple-implode {
        0%   { transform: scale(var(--sc-ripple-scale,8)) translateZ(0); opacity: 0; }
        15%  { opacity: 0; }
        30%  { opacity: 0.8; }
        100% { transform: scale(0.08) translateZ(0); opacity: 0; }
      }
      @keyframes sc-tick-fade-in { 0% { opacity: 0; } 100% { opacity: 1; } }

      .sc-anim-pulse-bg    { animation: sc-pulse-bg    var(--sc-anim-dur,1.5s) ease-in-out infinite; will-change:transform,opacity; }
      .sc-anim-pulse-frame { animation: sc-pulse-frame var(--sc-anim-dur,1.5s) ease-in-out infinite; will-change:transform,opacity; }
      .sc-anim-ripple      { animation: sc-ripple-expand var(--sc-anim-dur,1.5s) cubic-bezier(0.1, 0.4, 0.4, 1) infinite; will-change:transform,opacity; }
      .sc-anim-ripple-inv  { animation: sc-ripple-implode var(--sc-anim-dur,1.5s) cubic-bezier(0.3, 0, 0.8, 0.8) infinite; will-change:transform,opacity; }
      
      .sc-anim-ripple-d1   { animation-delay: calc(var(--sc-anim-dur,1.5s) * 0.33); }
      .sc-anim-ripple-d2   { animation-delay: calc(var(--sc-anim-dur,1.5s) * 0.66); }
      
      .g-tick-labels.fade-in { animation: sc-tick-fade-in var(--sc-fade-dur, 0.4s) cubic-bezier(0.4, 0, 0.2, 1) forwards; }

      /* A needle rotating inside the SVG repaints the whole gauge on the main
         thread every frame - an SVG transform is never composited. Each moving
         part therefore gets its own <svg> in the HTML flow, where the same
         rotation is a compositor transform and the gauge below it never
         repaints. See docs/perf-cpu.md. */
      /* The layer is the square the gauge's viewBox is letterboxed into, not
         the wrap's box: a percentage transform-origin measures the element,
         and only on that square does it land on the pivot. transform-box with
         view-box would be the direct way to say this, but on an outer svg it
         does not move the origin into viewBox units - measured, not assumed. */
      /* Safari re-rasterises a gauge that is not on its own compositing layer
         every time the value changes, and the redrawn picture does not always
         land on the same pixel - the whole instrument twitches once or twice a
         second. Promoting the wrap makes Safari rasterise it once and only move
         the finished layer afterwards, which is also what the needle's own
         layers already rely on.

         Measured on a 16-gauge canvas card in Safari: the twitch is there with
         the element box on whole device pixels as well as on fractional ones,
         so it is the repaint and not the geometry. will-change rather than a
         translateZ(0), because the wrap already carries a transform of its own
         when the gauge is placed by hand and the two would overwrite each
         other. */
      .sc-gauge-wrap { container-type: size; will-change: transform; }
      .sc-gauge-layer { position: absolute; inset: 0; margin: auto;
                        width: 100cqmin; height: 100cqmin;
                        pointer-events: none; }

      /* --- SUPERCARD LAYER MAPPING --- */
      .layer-elm-base    { z-index: 700; }
      .layer-elm-static  { z-index: 800; }
      .layer-elm-dynamic { z-index: 900; }
      .layer-elm-float   { z-index: 1000; }
    `;
  }

  constructor() {
    super();
    this.SIZE = 50;
    this.CENTER = 25;
    this._tierState = NO_TIER_STATE;
    this._thresholdActive = false;
    this._bgColorThresholdActive = false;
    this._isInitialized = false;
    this._lastRenderAngle = null; // NEW: Stores the last angle for calculating the difference
  }

  firstUpdated() {
    setTimeout(() => { this._isInitialized = true; }, 50);
  }

  _get(k, d) { return this.config[k] ?? d; }

  _handleTouch(e) { e.stopPropagation(); }

  _checkThreshold(val, op, threshold, hysPct, wasActive) {
    const hys = safeFloat(hysPct, 0) / 100;
    const t   = parseFloat(threshold); if (isNaN(t)) return false;
    const tLo = t*(1-hys), tHi = t*(1+hys);
    switch (op) {
      case '>':  return wasActive ? val > tLo  : val > tHi;
      case '<':  return wasActive ? val < tHi  : val < tLo;
      case '>=': return wasActive ? val >= tLo : val >= tHi;
      case '<=': return wasActive ? val <= tHi : val <= tLo;
      case '==': return Math.abs(val - t) <= Math.abs(t * hys);
      default:   return false;
    }
  }

  /**
   * The scale this render is drawn against.
   *
   * The arithmetic is `gaugeScale`, which is pure; what lives here is the one
   * thing it cannot hold - where the two hystereses were on the render before
   * this one.
   */
  _calculateGaugeData(rawVal) {
    const rawMin = this._get('min', ''), rawMax = this._get('max', '');
    const blank = (/** @type {any} */ v) => v === '' || v === null || v === undefined;
    const data = gaugeScale({
      value: rawVal,
      min: blank(rawMin) ? 0 : parseFloat(rawMin),
      max: blank(rawMax) ? 100 : parseFloat(rawMax),
      autoRange:  this._get('value_autorange',   false) === true,
      autoScale:  this._get('value_autoscale',   false) === true,
      dynamicMax: this._get('dynamic_max_scale', false) === true,
      hysteresis: parseFloat(this._get('autoscale_hysteresis', 10)),
      state: this._tierState,
    });
    this._tierState = data.state;
    return data;
  }

  _getParsedManualStops(stopsArray, min, max, unit = 'percent', gStart = min, gEnd = max) {
    if (!stopsArray || !Array.isArray(stopsArray) || stopsArray.length === 0) return null;
    const rG = gEnd - gStart;
    const isPct = unit === 'percent';
    const norm = v => { 
      if (v===undefined||v===null||v==='') return null; 
      const f=parseFloat(v); 
      return isNaN(f) ? null : (isPct ? gStart + (f/100)*rG : f); 
    };
    // `fill: false`, because a stop with no threshold on it is one the gauge
    // has always dropped - an even spread would invent a band for it.
    const stops = normalizeStops(stopsArray, { fill: false })
      .map(st => ({ limit: norm(st.pos), c: toRgbArray(st.color) || [128,128,128] }))
      .filter(s => s.limit !== null);
    if (stops.length === 0) return null;
    stops.sort((a,b)=>a.limit-b.limit);
    if (stops.length === 1) stops.push({ limit: stops[0].limit + 0.001, c: stops[0].c });
    return stops;
  }

  _getColorAt(val, stops) {
    if (!stops || stops.length === 0) return [128,128,128];
    if (val <= stops[0].limit) return stops[0].c;
    if (val >= stops[stops.length-1].limit) return stops[stops.length-1].c;
    for (let i = 0; i < stops.length-1; i++) {
      if (val >= stops[i].limit && val <= stops[i+1].limit) {
        return interpolateColor(stops[i].c, stops[i+1].c, (val-stops[i].limit)/(stops[i+1].limit-stops[i].limit));
      }
    }
    return stops[0].c;
  }

  _getSmartStops(min, max) {
    const preset = this._get('gradient_preset', 'manual');
    const range = max - min, mid = min + range / 2;
    const lim = (v, c) => ({ limit: v, c });
    const gStart=safeFloat(this._get('gradient_start',min),min), gEnd=safeFloat(this._get('gradient_end',max),max);
    
    if (preset === 'manual') {
      const parsed = this._getParsedManualStops(this._get('manual_stops', []), min, max, this._get('threshold_unit','percent'), gStart, gEnd);
      if (parsed) return parsed;
    }

    const rG=gEnd-gStart, isPct=this._get('threshold_unit','percent')==='percent';
    const norm = v => { if (v===undefined||v===null||v==='') return null; const f=parseFloat(v); return isNaN(f)?null:(isPct?gStart+(f/100)*rG:f); };

    if (preset === 'symmetriccustom') {
      const cOut=this._get('color1',[76,175,80]), cMid=this._get('color2',[255,235,59]), cCen=this._get('color3',[244,67,54]);
      const half = range / 2;
      let t1  = Math.max(0, Math.min(98, safeFloat(this._get('threshold1',40),40))) / 100;
      let t2  = Math.max(t1, Math.min(100, safeFloat(this._get('threshold2',75),75))) / 100;
      let gw1 = Math.max(0.5, Math.min(30, safeFloat(this._get('threshold3', 8), 8))) / 100;
      let gw2 = Math.max(0.5, Math.min(30, safeFloat(this._get('threshold4', 8), 8))) / 100;
      if (t2 <= t1 + gw1) t2 = t1 + gw1 + 0.01;
      return [ lim(min,cOut), lim(mid-half*(t2+gw2/2),cOut), lim(mid-half*(t2-gw2/2),cMid), lim(mid-half*(t1+gw1/2),cMid), lim(mid-half*(t1-gw1/2),cCen),
               lim(mid,cCen), lim(mid+half*(t1-gw1/2),cCen), lim(mid+half*(t1+gw1/2),cMid), lim(mid+half*(t2-gw2/2),cMid), lim(mid+half*(t2+gw2/2),cOut), lim(max,cOut) ];
    }
    if (preset === 'symmetric') {
      const cOut=this._get('color1',[76,175,80]), cMid=this._get('color2',[255,235,59]), cCen=this._get('color3',[244,67,54]);
      return [ lim(min,cOut), lim(min+range*0.25,cMid), lim(min+range*0.50,cCen), lim(min+range*0.75,cMid), lim(max,cOut) ];
    }
    if (preset === 'linear') {
      const cOut=this._get('color1',[76,175,80]), cMid=this._get('color2',[255,235,59]), cCen=this._get('color3',[244,67,54]);
      const spCen=safeFloat(this._get('threshold1',20),20)/100, spMid=safeFloat(this._get('threshold2',60),60)/100;
      return [ lim(min,cOut), lim(min+range*spCen,cOut), lim((min+range*spCen)+(range-range*spCen)*spMid,cMid), lim(max,cCen) ];
    }
    
    const stops = []; const t1 = norm(this._get('threshold1',null));
    stops.push(lim(t1!==null?t1:gStart, this._get('color1',[33,150,243])));
    [[this._get('threshold2',null),this._get('color2',[76,175,80])],[this._get('threshold3',null),this._get('color3',[255,152,0])],[this._get('threshold4',null),this._get('color4',[244,67,54])]].forEach(([t,c]) => { const n=norm(t); if(n!==null) stops.push(lim(n,c)); });
    stops.push(lim(gEnd, this._get('color5',[156,39,176])));
    stops.sort((a,b)=>a.limit-b.limit);
    if (stops.length < 2) stops.push({ limit: gEnd, c: stops[0]?.c||[128,128,128] });
    return stops;
  }

  _buildRingTemplate(data, startAngle, totalAngle, radius, stroke) {
    const stops = this._getSmartStops(data.min, data.max);
    const range = data.max - data.min;
    const isStepped = (this._get('gradient_mode', 'smooth') === 'stepped');
    
    const resMode = this._get('gradient_resolution', 'auto');
    let segs = 1;
    if (resMode === 'auto') {
      const res = Math.max(0.4, 25 / (radius + 1));
      segs = Math.max(1, Math.floor(Math.abs(totalAngle) / res));
    } else {
      const resMap = { 'coarse': 1, 'medium': 12, 'fine': 24, 'superfine': 48 , 'ultrafine': 96, 'megafine': 192 };
      const baseSegs = resMode === 'coarse' ? stops.length : Math.max(1, stops.length - 1);
      segs = Math.max(1, baseSegs * (resMap[resMode] ?? 24));
    }
    
    const colors = [];
    for (let i = 0; i < segs; i++) {
      const p1=i/segs, p2=(i+1)/segs, vSeg=data.min+p1*range;
      
      let rawRgb;
      const segments = []; 

      if (isStepped && resMode === 'coarse') {
        for (let i = 0; i < stops.length; i++) {
          const s1 = stops[i];
          const limit1 = s1.limit;
          const limit2 = (i < stops.length - 1) ? stops[i+1].limit : (data.min + range);
          
          const p1 = Math.max(0, Math.min(1, (limit1 - data.min) / range));
          const p2 = Math.max(0, Math.min(1, (limit2 - data.min) / range));
          
          if (p2 > p1) { segments.push({ p1, p2, color: s1.c }); }
        }
      } else {
         rawRgb = this._getColorAt(vSeg, stops);
      }
      
      const rgb = toRgbArray(rawRgb)||rawRgb;
      colors.push(`rgb(${rgb.join(',')})`);
    }

    // Runs of one color, not one path per subdivision step.
    const runs = [];
    for (let i = 0; i < segs; ) {
      let j = i + 1;
      while (j < segs && colors[j] === colors[i]) j++;
      runs.push({ from: i / segs, to: j / segs, c: colors[i] });
      i = j;
    }

    const arc = (a1, a2, color) => {
      // Kept to half circles: a single arc spanning 360 degrees would start and
      // end on the same point and draw nothing, and one over 180 would need the
      // large-arc flag. Two or three sub-arcs avoid both.
      const parts = Math.max(1, Math.ceil(Math.abs(a2 - a1) / 180));
      const out = [];
      for (let k = 0; k < parts; k++) {
        const b1 = a1 + (a2 - a1) * (k / parts);
        const b2 = a1 + (a2 - a1) * ((k + 1) / parts);
        const c1 = polarToCart(this.CENTER, this.CENTER, radius, b1);
        const c2 = polarToCart(this.CENTER, this.CENTER, radius, b2);
        out.push(`M${c1.x.toFixed(3)},${c1.y.toFixed(3)} A${radius},${radius},0,0,1,${c2.x.toFixed(3)},${c2.y.toFixed(3)}`);
      }
      return color
        ? svg`<path class="layer-elm-base" data-sc-part="gauge_ring" d="${out.join(' ')}" stroke="${color}" stroke-width="${stroke}" fill="none" stroke-linecap="butt"/>`
        : out.join(' ');
    };

    // A ring of one color is one stroked arc; there is nothing to interpolate
    // and a gradient would only cost a mask.
    if (runs.length === 1) {
      return svg`<g class="g-ring">${arc(startAngle, startAngle + totalAngle, runs[0].c)}</g>`;
    }

    // Everything else is a conic gradient behind a mask shaped like the ring:
    // one node instead of one per color. SVG has no angular gradient, so the
    // gradient is a CSS one painted into a foreignObject.
    //
    // Every band stays flat, as a pair of stops sharing an angle. At coarse
    // resolutions the banding is the point, and at fine ones the bands are a
    // step or two of rgb apart anyway - so reproducing them costs a second
    // stop per run and buys an image identical to the one the paths drew.
    // polarToCart measures from three o'clock, a conic gradient from twelve.
    // Both run clockwise, which is the only direction a gauge is drawn in.
    const base = ((startAngle + 90) % 360 + 360) % 360;
    const gradStops = [];
    for (const run of runs) {
      gradStops.push(`${run.c} ${(run.from * totalAngle).toFixed(3)}deg`,
                     `${run.c} ${(run.to * totalAngle).toFixed(3)}deg`);
    }

    // The id only has to be unique inside this gauge's shadow root.
    return svg`<g class="g-ring">
      <defs><mask id="scRingMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${this.CENTER * 2}" height="${this.CENTER * 2}">
        <path d="${arc(startAngle, startAngle + totalAngle)}" stroke="#fff" stroke-width="${stroke}" fill="none" stroke-linecap="butt"/>
      </mask></defs>
      <foreignObject class="layer-elm-base" x="0" y="0" width="${this.CENTER * 2}" height="${this.CENTER * 2}" mask="url(#scRingMask)" style="pointer-events:none">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;pointer-events:none;background:conic-gradient(from ${base.toFixed(3)}deg, ${gradStops.join(', ')})"></div>
      </foreignObject>
      <!-- The gradient ring is painted by a div behind a mask, and a div is
           not a shape the editor can ask whether a press is on it. So the
           same arc is drawn once more in nothing at all: it paints no pixel
           and it is what data-sc-part names, so a press on the ring finds
           the ring here rather than nowhere. -->
      <path class="layer-elm-base" data-sc-part="gauge_ring" d="${arc(startAngle, startAngle + totalAngle)}"
            stroke="transparent" stroke-width="${stroke}" fill="none" stroke-linecap="butt"/>
    </g>`;
  }


  /**
   * The entity ids this gauge draws from: whatever its config names, plus the
   * one an alias resolves to. Cached against the two objects it is read from,
   * so a config edit or a change to the global list recollects and nothing
   * else does.
   */
  _inputIds() {
    if (this.__idsFor !== this.config || this.__idsForGlobals !== this.globalEntities) {
      this.__idsFor = this.config;
      this.__idsForGlobals = this.globalEntities;
      const ids = SC.collectEntityIds(this.config);
      const alias = SC.resolveAlias(this.globalEntities, this.config, 'entity', 'gauge_attribute');
      if (alias.entity) ids.add(alias.entity);
      this.__ids = ids;
    }
    return this.__ids;
  }

  /**
   * A card hands every gauge on it a new `hass` whenever any entity in the
   * whole instance changes, and there are sixteen gauges on a card and two
   * dozen cards on a dashboard. A gauge that draws none of what changed has
   * nothing to redraw.
   */
  shouldUpdate(changedProps) {
    if (!this.hasUpdated) return true;
    if (changedProps.size > 1 || !changedProps.has('hass')) return true;
    return SC.hassInputsChanged(changedProps.get('hass'), this.hass, this._inputIds());
  }

  render() {
    if (!this.config || !this.hass) return html``;
    
    const _alias = SC.resolveAlias(this.globalEntities, this.config, 'entity', 'gauge_attribute');
    const resolvedEntity = _alias.entity || '';
    const resolvedAttribute = _alias.attribute || null;

    const stateObj = resolvedEntity ? this.hass.states[resolvedEntity] : null;
    
    const rawMin = this._get('min', '');
    const fallbackMin = (rawMin === '' || rawMin === null) ? 0 : (parseFloat(rawMin) || 0);

    const rawState = stateObj ? (resolvedAttribute ? stateObj.attributes[resolvedAttribute] : stateObj.state) : null;
    const rawVal = safeFloat(rawState, fallbackMin);
    const data = this._calculateGaugeData(rawVal);

    const isSemi      = this._get('gauge_type','full') === 'semi';  
    const customStart = parseFloat(this._get('gauge_start_angle', '-90'));
    const startAngle  = isSemi ? 135 : customStart;
    const totalAngle  = isSemi ? 270 : 360;
    // `gauge_scale` is how far out the gauge reaches, and everything it is
    // made of is subtracted from there inwards - so a frame ring cannot push
    // the drawing past the edge of the box, it can only eat into the dial.
    // Read through `_get`, never off `this.config`: a gauge that inherits
    // gets its numbers from the card above it, and reading the raw config
    // here silently draws such a gauge at the template's size instead.
    const geom = {
      gauge_scale: this._get('gauge_scale', 0.9),
      stroke_width: this._get('stroke_width', 3),
      frame_ring_active: this._get('frame_ring_active', false) === true,
      frame_ring_width: this._get('frame_ring_width', 1.5),
      frame_ring_gap: this._get('frame_ring_gap', 1.5),
      scale_from_outer: this._get('scale_from_outer', false) === true,
    };
    const scale  = gaugeScaleOf(geom);
    const stroke = safeFloat(geom.stroke_width, 3);
    const band   = frameBand(geom, scale);
    const radius = ringRadius(stroke, scale, band);
    const range  = data.max - data.min;
    const pct    = Math.max(0, Math.min(1, (data.val - data.min) / (range || 1)));
    
    const targetAngle = startAngle + pct * totalAngle;
    // Frozen holds the angle it was at when the freeze began, rather than
    // merely switching the transition off: without it a new state would still
    // jump the needle to wherever the entity has got to, which is the very
    // thing being frozen out.
    if (!this.frozen) this._frozenAngle = null;
    else if (this._frozenAngle === null || this._frozenAngle === undefined) {
      this._frozenAngle = this._isInitialized ? targetAngle : startAngle;
    }
    const renderAngle = this.frozen
      ? this._frozenAngle
      : (this._isInitialized ? targetAngle : startAngle);

    // --- NEW: CALCULATE DIFFERENCE AND DYNAMIC DURATION ---
    if (this._lastRenderAngle === null) this._lastRenderAngle = startAngle;
    const diff = Math.abs(targetAngle - this._lastRenderAngle);
    if (this._isInitialized) this._lastRenderAngle = targetAngle;

    const easingMode = this._get('animation_easing', 'smooth');

    // Base duration (decoupled for spring)
    let dur = safeFloat(this._get('animation_duration', 0.8), 0.8);
    if (easingMode === 'spring') {
      dur = safeFloat(this._get('animation_spring_duration', 1.5), 1.5);
    }
    
    // Dynamic acceleration (optional)
    if (this._get('animation_dynamic_speed', false) && this._isInitialized && diff > 0) {
      const distancePct = Math.min(1, diff / totalAngle);
      if (this._get('animation_dynamic_speed_invert', false)) {
        dur = dur * Math.max(0.3, 1 - Math.sqrt(distancePct) + 0.3);
      } else {
        dur = dur * Math.max(0.3, Math.sqrt(distancePct)); 
      }
    }

    // --- NEW: SETTLING (EASING CURVES) ---
    let easingCurve = 'cubic-bezier(0.2, 0, 0, 1)'; // smooth (default)
    
    if (easingMode === 'overshoot_light')  easingCurve = 'cubic-bezier(0.25, 1.15, 0.5, 1)';
    if (easingMode === 'overshoot_medium') easingCurve = 'cubic-bezier(0.34, 1.4, 0.64, 1)';
    if (easingMode === 'overshoot_heavy')  easingCurve = 'cubic-bezier(0.5, 1.6, 0.4, 1)';
    if (easingMode === 'elastic')          easingCurve = 'cubic-bezier(0.68, -0.2, 0.265, 1.55)';
    
    if (easingMode === 'spring') {
      const bounces = parseInt(this._get('animation_spring_bounces', 3));
      // Calculate amplitude: 100% = barely any damping, 0% = massive damping
      const rawAmp = safeFloat(this._get('animation_spring_amplitude', 50), 50) / 100;
      const decay = 8 - (rawAmp * 7); 
      
      const points = [];
      const steps = 60;
      const freq = bounces * Math.PI + (Math.PI / 2);
      
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (t === 1) { points.push('1'); continue; }
        const val = 1 - Math.exp(-decay * t) * Math.cos(freq * t);
        points.push(val.toFixed(3));
      }
      easingCurve = `linear(${points.join(', ')})`;
    }

    this._thresholdActive = this._checkThreshold(data.val, this._get('bg_threshold_anim_operator', '>'), this._get('bg_threshold_anim_value', 80), this._get('bg_threshold_anim_hysteresis', 5), this._thresholdActive);
    this._bgColorThresholdActive = this._checkThreshold(data.val, this._get('bg_color_threshold_operator', '>'), this._get('bg_color_threshold_value', 80), this._get('bg_color_threshold_hysteresis', 5), this._bgColorThresholdActive);
    
    const animActive  = this._get('bg_threshold_anim_active', false) === true;
    const animType    = this._get('bg_threshold_anim_type', 'pulse_bg');
    const animDur     = safeFloat(this._get('bg_threshold_anim_duration', 1.5), 1.5);
    const animCol     = resolveColor('fixed', this._get('bg_threshold_anim_color', [255,50,50]));
    const isInv       = this._get('bg_threshold_anim_ripple_inv', false) === true;
    const rippleScaleVal = ((radius + stroke/2) / (radius * 0.15)).toFixed(1);
    const bgColActive = this._get('bg_color_threshold_active', false) === true;
    const targetColorBg = resolveColor('fixed', this._get('bg_color_threshold_color', [255,50,50]));

    const pulseBgClass    = (animActive && this._thresholdActive && animType === 'pulse_bg') ? 'sc-anim-pulse-bg' : '';
    const pulseFrameClass = (animActive && this._thresholdActive && animType === 'pulse_frame') ? 'sc-anim-pulse-frame' : '';
    const rClassActive    = isInv ? 'sc-anim-ripple-inv' : 'sc-anim-ripple';
    const rClass          = (animActive && this._thresholdActive && animType === 'ripple') ? rClassActive : '';
    
    let bgFill = '', bgOpacity = safeFloat(this._get('bg_opacity',1.0),1.0);
    if (bgColActive && this._bgColorThresholdActive) {
      bgFill = targetColorBg;
    } else if (animActive && this._thresholdActive && animType === 'pulse_bg') {
      bgFill = animCol;
    }

    const isResponsive = SC.gaugeIsResponsive(this.config, this.onCanvas);
    const sizePx = safeFloat(this._get('gauge_size_px', 60), 60);
    const posMode = this._get('gauge_position_mode', 'center');
    const tx = safeFloat(this._get('gauge_offset_x', 0), 0), ty = safeFloat(this._get('gauge_offset_y', 0), 0);
    
    const posMap = {
      'top-left':     `top:0; left:0; transform:translate(${tx}px,${ty}px)`,
      'top-center':   `top:0; left:50%; transform:translate(calc(-50% + ${tx}px),${ty}px)`,
      'top-right':    `top:0; right:0; transform:translate(${-tx}px,${ty}px)`,
      'center-left':  `top:50%; left:0; transform:translate(${tx}px,calc(-50% + ${ty}px))`,
      'center':       `top:50%; left:50%; transform:translate(calc(-50% + ${tx}px),calc(-50% + ${ty}px))`,
      'center-right': `top:50%; right:0; transform:translate(${-tx}px,calc(-50% + ${ty}px))`,
      'bottom-left':  `bottom:0; left:0; transform:translate(${tx}px,${-ty}px)`,
      'bottom-center':`bottom:0; left:50%; transform:translate(calc(-50% + ${tx}px),${-ty}px)`,
      'bottom-right': `bottom:0; right:0; transform:translate(${-tx}px,${-ty}px)`,
    };
    
    const wrapStyle = `
      position: absolute;
      pointer-events: none;
      z-index: 700;
      width: ${isResponsive ? '100%' : `${sizePx}px`};
      height: ${isResponsive ? '100%' : `${sizePx}px`};
      ${isResponsive ? '' : (posMap[posMode] || posMap['center'])}; 
      --sc-anim-dur: ${animDur}s;
      --sc-ripple-scale: ${rippleScaleVal};
      ${pulseFrameClass ? `--sc-frame-anim-color:${animCol};` : ''}
      --sc-fade-dur: ${safeFloat(this._get('tick_label_crossfade_dur', 0.4), 0.4)}s;
    `;

    const bgR = (this.CENTER - 0.5) * scale;
    let hideSvgBg = false;
    let waveStyleBlock = '';
    let waveDivNode = '';
    const usesWaveColors = ['waves', 'wobble_radial', 'wobble_linear'].includes(animType);

    if (animActive && this._thresholdActive && usesWaveColors) {
      hideSvgBg = true;
      const waveCount = safeFloat(this._get('bg_threshold_wave_count', 3), 3);
      const baseStep = 100 / waveCount;
      const balance = safeFloat(this._get('bg_threshold_wave_balance', 50), 50) / 100;
      const c1 = animCol; 
      const c2 = resolveColor('fixed', this._get('bg_threshold_anim_color2', 'transparent'));
      const speed = animDur;
      const gAngle = safeFloat(this._get('bg_threshold_gradient_angle', 90), 90);
      const rx = 50, ry = 50;

      const isWobble = ['wobble_radial', 'wobble_linear'].includes(animType);
      const animKey = `sc-gauge-wave-${this.dataset.idx}`;
      let animValue = 'none';
      let waveBgValue = c2;

      if (isWobble) {
        const startAmp = safeFloat(this._get('bg_threshold_wobble_amplitude', 100), 100) / 100;
        const freqMod = safeFloat(this._get('bg_threshold_wobble_freq', 4), 4);
        const pause = safeFloat(this._get('bg_threshold_wobble_pause', 2), 2);
        const activeDuration = speed;
        const totalDuration = activeDuration + pause;
        const activePct = activeDuration / totalDuration;

        let kf = `@keyframes ${animKey} {\n`;
        const steps = 60;
        for (let i = 0; i <= steps; i++) {
          const phase = i / steps;
          const kfPercent = (phase * activePct * 100).toFixed(1);
          const dampening = Math.pow(1 - phase, 2);
          const currentAmp = startAmp * dampening;
          const mixPct = (currentAmp * 100).toFixed(1);
          const activeColor = `color-mix(in srgb, ${c1} ${mixPct}%, ${c2})`;
          const currentStep = baseStep * (1 - phase * 0.3);
          const easeOut = 1 - Math.pow(1 - phase, 3);
          const shift = easeOut * freqMod * baseStep;
          const s1 = shift.toFixed(2);
          const s2 = (shift + currentStep * balance).toFixed(2);
          const s3 = (shift + currentStep).toFixed(2);
          const spreadPct = (easeOut * 150).toFixed(1);
          const fadeStart = Math.max(0, spreadPct - 15).toFixed(1);

          let bgStr = '';
          if (animType === 'wobble_linear') {
            const mask = `linear-gradient(${gAngle}deg, transparent ${fadeStart}%, ${c2} ${spreadPct}%)`;
            const wave = `repeating-linear-gradient(${gAngle}deg, ${activeColor} ${s1}%, ${c2} ${s2}%, ${activeColor} ${s3}%)`;
            bgStr = `${mask}, ${wave}`;
          } else {
            const mask = `radial-gradient(circle at ${rx}% ${ry}%, transparent ${fadeStart}%, ${c2} ${spreadPct}%)`;
            const wave = `repeating-radial-gradient(circle at ${rx}% ${ry}%, ${activeColor} ${s1}%, ${c2} ${s2}%, ${activeColor} ${s3}%)`;
            bgStr = `${mask}, ${wave}`;
          }
          kf += `  ${kfPercent}% { background: ${bgStr}; }\n`;
        }
        if (pause > 0) kf += `  100% { background: ${c2}; }\n`;
        kf += `}\n`;
        
        waveStyleBlock = html`<style>${kf}</style>`;
        animValue = `${animKey} ${totalDuration}s infinite linear`;
      } else {
        let kf = `@keyframes ${animKey} {\n`;
        const isInv = this._get('bg_threshold_anim_ripple_inv', false);
        for (let i = 0; i <= 100; i += (100 / 60)) {
          const phase = isInv ? (1 - i / 100) : (i / 100);
          const shift = phase * baseStep;
          const s1 = shift.toFixed(2);
          const s2 = (shift + baseStep * balance).toFixed(2);
          const s3 = (shift + baseStep).toFixed(2);
          const bg = animType === 'waves'
            ? `repeating-linear-gradient(${gAngle}deg, ${c1} ${s1}%, ${c2} ${s2}%, ${c1} ${s3}%)`
            : `repeating-radial-gradient(circle at ${rx}% ${ry}%, ${c1} ${s1}%, ${c2} ${s2}%, ${c1} ${s3}%)`;
          kf += `  ${i.toFixed(2)}% { background: ${bg}; }\n`;
        }
        kf += `}\n`;
        
        waveStyleBlock = html`<style>${kf}</style>`;
        animValue = `${animKey} ${speed}s infinite linear`;
        waveBgValue = animType === 'waves'
            ? `repeating-linear-gradient(${gAngle}deg, ${c1} 0%, ${c2} ${baseStep * balance}%, ${c1} ${baseStep}%)`
            : `repeating-radial-gradient(circle at ${rx}% ${ry}%, ${c1} 0%, ${c2} ${baseStep * balance}%, ${c1} ${baseStep}%)`;
      }

      const diameterPct = bgR * 4;
      waveDivNode = html`
        <div style="position:absolute; top:50%; left:50%; width:${diameterPct}%; height:${diameterPct}%; transform:translate(-50%,-50%); border-radius:50%; background:${waveBgValue}; animation:${animValue}; z-index:690; pointer-events:none; opacity:${bgOpacity};"></div>
      `;
    }

    const bgMode = this._get('bg_mode','none');
    const bgId = `scBg_${this.config.entity ? this.config.entity.replace(/[^a-zA-Z0-9]/g,'_') : 'x'}_${this.dataset.idx || 0}`;
    const bgC1 = resolveColor('fixed', this._get('bg_color1',[30,30,30]));
    const bgC2 = resolveColor('fixed', this._get('bg_color2',[60,60,60]));
    const bgBal = Math.max(0, Math.min(100, safeFloat(this._get('bg_balance',50),50)));
    let bgNode = '';

    if (!hideSvgBg) {
      if (bgMode === 'adaptive') {
        bgNode = svg`<circle class="layer-elm-base ${pulseBgClass}" cx="${this.CENTER}" cy="${this.CENTER}" r="${bgR}" fill="var(--card-background-color,#1c1c1c)" opacity="${bgOpacity}" style="transition: fill 0.4s ease; ${bgFill ? `fill:${bgFill};` : ''}"/>`;
      } else if (bgMode === 'solid') {
        bgNode = svg`<circle class="layer-elm-base ${pulseBgClass}" cx="${this.CENTER}" cy="${this.CENTER}" r="${bgR}" fill="${bgC1}" opacity="${bgOpacity}" style="transition: fill 0.4s ease; ${bgFill ? `fill:${bgFill};` : ''}"/>`;
      } else if (bgMode === 'linear' || bgMode === 'radial') {
        const bgPreset = this._get('bg_gradient_preset', 'classic'); 
        let stopsSvg = '';

        if (bgPreset === 'manual') {
          const bgStops = this._getParsedManualStops(this._get('bg_manual_stops', []), data.min, data.max, this._get('bg_threshold_unit', 'percent'));
          if (bgStops) {
            const bgRange = data.max - data.min || 1;
            stopsSvg = bgStops.map(s => {
              const pct = Math.max(0, Math.min(100, ((s.limit - data.min) / bgRange) * 100));
              return svg`<stop offset="${pct.toFixed(1)}%" stop-color="rgb(${s.c.join(',')})"/>`;
            });
          }
        }
        
        if (!stopsSvg) {
          stopsSvg = svg`<stop offset="0%" stop-color="${bgC1}"/><stop offset="${bgBal.toFixed(1)}%" stop-color="${bgC1}"/><stop offset="100%" stop-color="${bgC2}"/>`;
        }

        if (bgMode === 'linear') {
          const angle=safeFloat(this._get('bg_gradient_angle',135),135), rad=angle*Math.PI/180;
          const x1=(50-Math.cos(rad)*50).toFixed(1), y1=(50-Math.sin(rad)*50).toFixed(1);
          const x2=(50+Math.cos(rad)*50).toFixed(1), y2=(50+Math.sin(rad)*50).toFixed(1);
          bgNode = svg`<defs><linearGradient id="${bgId}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">${stopsSvg}</linearGradient><clipPath id="${bgId}clip"><circle cx="${this.CENTER}" cy="${this.CENTER}" r="${bgR}"/></clipPath></defs><circle class="layer-elm-base ${pulseBgClass}" cx="${this.CENTER}" cy="${this.CENTER}" r="${bgR}" fill="url(#${bgId})" opacity="${bgOpacity}" clip-path="url(#${bgId}clip)" style="transition: fill 0.4s ease; ${bgFill ? `fill:${bgFill};` : ''}"/>`;
        } else if (bgMode === 'radial') {
          bgNode = svg`<defs><radialGradient id="${bgId}" cx="50%" cy="50%" r="50%">${stopsSvg}</radialGradient><clipPath id="${bgId}clip"><circle cx="${this.CENTER}" cy="${this.CENTER}" r="${bgR}"/></clipPath></defs><circle class="layer-elm-base ${pulseBgClass}" cx="${this.CENTER}" cy="${this.CENTER}" r="${bgR}" fill="url(#${bgId})" opacity="${bgOpacity}" clip-path="url(#${bgId}clip)" style="transition: fill 0.4s ease; ${bgFill ? `fill:${bgFill};` : ''}"/>`;
        }
      } else {
        bgNode = svg`<circle class="layer-elm-base ${pulseBgClass}" cx="${this.CENTER}" cy="${this.CENTER}" r="${bgR}" fill="transparent" opacity="0" style="pointer-events:none; transition: fill 0.4s ease; opacity: ${bgFill ? bgOpacity : 0}; ${bgFill ? `fill:${bgFill};` : ''}"/>`;
      }
    }

    const frameActive = this._get('frame_ring_active',false) === true;
    let frameNode = '';
    if (frameActive) {
      const fStroke  = safeFloat(this._get('frame_ring_width',  1.5),1.5) * scale;
      const fGap     = safeFloat(this._get('frame_ring_gap',    1.5),1.5) * scale;
      const fOpacity = safeFloat(this._get('frame_ring_opacity',1.0),1.0);
      const fCol     = resolveColor(this._get('frame_ring_color_type','fixed'), this._get('frame_ring_color',[80,80,80]));
      const fRadius  = gaugeOuter(scale) - fStroke/2;
      const fClosed  = this._get('frame_ring_closed',false) === true;
      const pulseFrameStroke = pulseFrameClass ? `stroke: ${animCol};` : `stroke: ${fCol};`;
      
      if (fClosed || totalAngle >= 360) {
        frameNode = svg`<circle class="layer-elm-base ${pulseFrameClass}" data-sc-part="frame_ring" cx="${this.CENTER}" cy="${this.CENTER}" r="${fRadius}" stroke-width="${fStroke}" fill="none" opacity="${fOpacity}" style="${pulseFrameStroke} transition: stroke 0.4s ease;"/>`;
      } else {
        const c1f=polarToCart(this.CENTER,this.CENTER,fRadius,startAngle);
        const c2f=polarToCart(this.CENTER,this.CENTER,fRadius,startAngle+totalAngle-0.01);
        const la=totalAngle>180?1:0;
        frameNode = svg`<path class="layer-elm-base ${pulseFrameClass}" data-sc-part="frame_ring" d="M${c1f.x.toFixed(3)},${c1f.y.toFixed(3)} A${fRadius},${fRadius},0,${la},1,${c2f.x.toFixed(3)},${c2f.y.toFixed(3)}" stroke-width="${fStroke}" fill="none" stroke-linecap="round" opacity="${fOpacity}" style="${pulseFrameStroke} transition: stroke 0.4s ease;"/>`;
      }
    }

    const tCount = parseInt(this._get('tick_count',0));
    const div = tCount > 1 ? tCount - 1 : 1;
    const smartMVal = range !== 0 ? tickMultiplier(range, tCount) : 1;

    const ticks = []; const tLabels = [];
    if (tCount > 0) {
      const tLen=safeFloat(this._get('tick_length',3),3)*scale, tWid=safeFloat(this._get('tick_width',1),1)*scale;
      const rOut=ringPartRadius(radius, safeFloat(this._get('tick_offset',0),0), scale), rIn=rOut-tLen;
      const tCol=resolveColor(this._get('tick_color_type','fixed'),this._get('tick_color',[128,128,128]));
      const tlCol=resolveColor(this._get('tick_label_color_type','adaptive'),this._get('tick_label_color',null));
      const labelTickCol=this._get('tick_label_tick_color',null)?resolveColor('fixed',this._get('tick_label_tick_color',null)):tlCol;
      const tlSize=safeFloat(this._get('tick_label_font_size',7),7)*scale, tlOff=safeFloat(this._get('tick_label_offset',10),10)*scale;
      const tlSpread=safeFloat(this._get('tick_label_spread',0),0)*scale;

      // What each tick would say, needed before any of them is drawn: how
      // wide a label is decides how many of them fit.
      // A step that is not whole under its own divisor needs a decimal, or
      // two neighbours round to the same digit and the scale reads as though
      // it had stopped counting. Only where nobody has answered: a decimal
      // count that was set is the answer.
      const setDec = parseInt(this._get('tick_label_decimals', 0));
      const labelStepVal = Math.abs(range) / div
        / ((this._get('show_multiplier_label',false) && this._get('multiplier_divide_ticks',false)) ? smartMVal : 1);
      const tickDecimals = setDec > 0 ? setDec
        : (Math.abs(labelStepVal - Math.round(labelStepVal)) > 1e-9 ? 1 : 0);
      const tickText = (/** @type {number} */ i) => {
        let v = data.min + (i/div)*range;
        if (this._get('show_multiplier_label',false) && this._get('multiplier_divide_ticks',false)) v /= smartMVal;
        const dec = tickDecimals;
        return dec > 0 ? parseFloat(v.toFixed(dec)).toString() : v.toFixed(0);
      };
      // A dial that comes full circle draws its last tick on top of its
      // first, and with it the last label on top of the first - which is how
      // 2500 and 0 came to sit inside each other at the top of a full gauge.
      // So the last one is not drawn at all: on a closed dial it is the first
      // one, one lap later, and the tick under it is the same tick. Where
      // both readings are wanted, they are joined into the one label that
      // stands at the seam, in the order the eye meets them going round - the
      // lap that is ending, then the one that is starting.
      const closedDial = totalAngle >= 360 && tCount > 1;
      const joinEnds = closedDial && this._get('tick_label_join_ends', false);
      const plainTexts = Array.from({length: tCount}, (_, i) => tickText(i));
      const labelText = (/** @type {number} */ i) => (joinEnds && i === 0)
        ? `${plainTexts[tCount - 1]} / ${plainTexts[0]}` : plainTexts[i];
      const plan = { count: tCount, startAngle, totalAngle, radius: radius + tlOff,
                     fontSize: tlSize, outward: tlOff >= 0, closed: closedDial,
                     texts: plainTexts.map((_, i) => labelText(i)),
                     reachTexts: plainTexts };
      // A step nobody set is the card's to choose: it labels as many ticks as
      // stand clear of each other, which is the thing the old hand-tuned
      // spread was reaching for and could not hold on to, because the answer
      // moves with the tick count, the type, the digits and the card's size.
      const setStep = parseInt(this._get('tick_label_step', 0));
      const labelStep = setStep > 0 ? setStep : autoStep(plan);
      // The row shares one circle: every label is pushed off it by the reach
      // of the widest of them, so a two-digit number does not stand half a
      // digit deeper than the one-digit number beside it.
      const labelReachBox = rowBox(plainTexts.filter(
        (_, i) => i % labelStep === 0 && !(closedDial && i === tCount - 1)), tlSize);
      // Or it keeps every label and sends the crowded ones out a row, which is
      // the one way of separating them that leaves each over its own tick.
      const labelRows = this._get('tick_label_stagger', false) ? staggerRows(plan, labelStep) : [];

      const subTickCount = parseInt(this._get('sub_tick_count',0));
      if (subTickCount > 0 && tCount > 1) {
        const stLen = safeFloat(this._get('sub_tick_length',1.5),1.5)*scale;
        const stWid = safeFloat(this._get('sub_tick_width',0.5),0.5)*scale;
        const stCol = resolveColor(this._get('sub_tick_color_type','fixed'), this._get('sub_tick_color',[100,100,100]));
        const stROut = ringPartRadius(radius, safeFloat(this._get('sub_tick_offset',0),0), scale), stRIn = stROut - stLen;

        for (let i = 0; i < tCount - 1; i++) {
          const angStart = startAngle + (i/div)*totalAngle;
          const angEnd = startAngle + ((i+1)/div)*totalAngle;
          const angStep = (angEnd - angStart) / (subTickCount + 1);
          for (let j = 1; j <= subTickCount; j++) {
            const ang = angStart + j * angStep;
            const p1 = polarToCart(this.CENTER, this.CENTER, stRIn, ang);
            const p2 = polarToCart(this.CENTER, this.CENTER, stROut, ang);
            ticks.push(svg`<line class="layer-elm-static" data-sc-part="sub_ticks" x1="${p1.x.toFixed(3)}" y1="${p1.y.toFixed(3)}" x2="${p2.x.toFixed(3)}" y2="${p2.y.toFixed(3)}" stroke="${stCol}" stroke-width="${stWid}" stroke-linecap="round"/>`);
          }
        }
      }

      for (let i=0; i<tCount; i++) {
        // The seam of a closed dial: this tick and this label are the first
        // ones, drawn a second time in the same place.
        if (closedDial && i === tCount - 1) continue;
        const ang=startAngle+(i/div)*totalAngle;
        const isLabel=this._get('show_tick_labels',false) && (i%labelStep===0);
        const curRIn=isLabel ? rOut-tLen-safeFloat(this._get('tick_label_extra_length',0),0)*scale : rIn;
        const p1=polarToCart(this.CENTER,this.CENTER,curRIn,ang), p2=polarToCart(this.CENTER,this.CENTER,rOut,ang);
        const curCol=isLabel?(this._get('tick_label_inherit_color',false)?tlCol:labelTickCol):tCol;
        ticks.push(svg`<line class="layer-elm-static" data-sc-part="ticks" x1="${p1.x.toFixed(3)}" y1="${p1.y.toFixed(3)}" x2="${p2.x.toFixed(3)}" y2="${p2.y.toFixed(3)}" stroke="${curCol}" stroke-width="${tWid}" stroke-linecap="round"/>`);
        
        if (isLabel) {
          const tStr = labelText(i);
          
          const rad = ang * Math.PI / 180;
          const cosA = Math.cos(rad), sinA = Math.sin(rad);
          const isOut = tlOff >= 0;

          // Every label is a box centred on its own point, pushed off the
          // label circle by its own reach so that what lies on the circle is
          // the edge facing the ticks. Anchor and baseline used to be
          // switched at fixed thresholds instead, which moved a label's box
          // a half-width sideways or a half-height down the moment its tick
          // crossed one - a kink in a row of numbers otherwise on a perfect
          // arc. The points were round; the type was not.
          const rowShift = (labelRows[i] || 0) * (isOut ? 1 : -1) * ROW_GAP * tlSize;
          const reach = boxReach(labelReachBox, cosA, sinA);
          const pL = polarToCart(this.CENTER, this.CENTER,
                                 radius + tlOff + rowShift + (isOut ? reach : -reach), ang);
          
          if (sinA < -0.75 && Math.abs(cosA) > 0.02) {
             const intensity = (sinA + 0.75) / -0.25; 
             pL.x += (cosA > 0 ? 1 : -1) * tlSpread * intensity;
          }

          tLabels.push(svg`<text class="layer-elm-static" data-sc-part="tick_labels" x="${pL.x.toFixed(3)}" y="${pL.y.toFixed(3)}" fill="${tlCol}" font-size="${tlSize}px" text-anchor="middle" dominant-baseline="central">${tStr}</text>`);
        }
      }
    }

    const customTicks = this._get('custom_ticks', []);
    customTicks.forEach(ct => {
      if (ct.value === undefined || ct.value === '') return;
      const v = parseFloat(ct.value);
      if (isNaN(v)) return;
      const ctPct = Math.max(0, Math.min(1, (v - data.min) / (range || 1)));
      const ang = startAngle + ctPct * totalAngle;

      const ctLen = safeFloat(ct.length, 4)*scale;
      const ctWid = safeFloat(ct.width, 1)*scale;
      const ctCol = resolveColor('fixed', ct.color || '#ff0000');
      const ctROut = ringPartRadius(radius, safeFloat(ct.offset, 0), scale), ctRIn  = ctROut - ctLen;
      const p1 = polarToCart(this.CENTER, this.CENTER, ctRIn, ang);
      const p2 = polarToCart(this.CENTER, this.CENTER, ctROut, ang);

      ticks.push(svg`<line class="layer-elm-static" x1="${p1.x.toFixed(3)}" y1="${p1.y.toFixed(3)}" x2="${p2.x.toFixed(3)}" y2="${p2.y.toFixed(3)}" stroke="${ctCol}" stroke-width="${ctWid}" stroke-linecap="round"/>`);

      if (ct.label) {
        const cLblOff = safeFloat(ct.label_offset, 10) * scale;
        const pL = polarToCart(this.CENTER, this.CENTER, radius + cLblOff, ang);
        const lSize = safeFloat(ct.label_font_size, 7) * scale;
        
        const cRad = ang * Math.PI / 180;
        const cCosA = Math.cos(cRad), cSinA = Math.sin(cRad);
        const cIsOut = cLblOff >= 0;
        
        let cAnchor = "middle";
        if (cCosA > 0.05) cAnchor = cIsOut ? "start" : "end";
        else if (cCosA < -0.05) cAnchor = cIsOut ? "end" : "start";

        let cBase = "central";
        if (cSinA > 0.05) cBase = cIsOut ? "hanging" : "baseline";
        else if (cSinA < -0.05) cBase = cIsOut ? "baseline" : "hanging";

        tLabels.push(svg`<text class="layer-elm-static" x="${pL.x.toFixed(3)}" y="${pL.y.toFixed(3)}" fill="${ctCol}" font-size="${lSize}px" text-anchor="${cAnchor}" dominant-baseline="${cBase}" style="pointer-events:none">${ct.label}</text>`);
      }
    });

    const extraLabels = [];
    if (this._get('show_scale_label',false)) {
      const lTxt = data.unitPrefix+(this._get('scale_label_show_raw_unit',false)?this._get('scale_label_custom_unit',stateObj?.attributes?.unit_of_measurement||''):'');
      const lCol = resolveColor(this._get('scale_label_color_type','adaptive'),this._get('scale_label_color',null));
      extraLabels.push(svg`<text class="layer-elm-dynamic" data-sc-part="scale_label" x="${this.CENTER+safeFloat(this._get('scale_label_offset_x',0),0)*scale}" y="${this.CENTER+safeFloat(this._get('scale_label_offset_y',-18),-18)*scale}" fill="${lCol}" font-size="${safeFloat(this._get('scale_label_font_size',10),10)*scale}px" text-anchor="middle" font-weight="500" style="pointer-events:none">${lTxt}</text>`);
    }
    if (this._get('show_multiplier_label',false) && tCount > 1) {
      // The multiplier is what the printed numbers have to be multiplied by
      // to be read as the real value - so it is the factor the labels were
      // actually divided by, and nothing else. Where they are not divided at
      // all that factor is 1. It used to be `range/div` there, which is the
      // step from one tick to the next: a true number about the scale, but
      // not this one, so a dial whose labels already said 300 to 2500 was
      // captioned "x100".
      const mRaw = this._get('multiplier_divide_ticks',false) ? smartMVal : 1;
      const { factor: mValDisp, prefix: mPrefix } = multiplierParts(mRaw, data.resultTier);
      const mDec = parseInt(this._get('multiplier_decimals',0));
      // A factor below one rounds to "x0" at no decimals, and a gauge that
      // says multiply by zero says the scale is worthless. Whole numbers keep
      // the setting; a fraction is drawn at the places it needs.
      const mNum = parseFloat(mValDisp.toFixed(mDec)) || parseFloat(mValDisp.toPrecision(2));
      const mStr=`${this._get('multiplier_prepend','x')}${mNum}${mPrefix}`;
      const mCol=resolveColor(this._get('multiplier_color_type','adaptive'),this._get('multiplier_color',null));
      extraLabels.push(svg`<text class="layer-elm-dynamic" data-sc-part="multiplier" x="${this.CENTER+safeFloat(this._get('multiplier_offset_x',0),0)*scale}" y="${this.CENTER+safeFloat(this._get('multiplier_offset_y',-30),-30)*scale}" fill="${mCol}" font-size="${safeFloat(this._get('multiplier_font_size',10),10)*scale}px" text-anchor="middle" font-weight="500" style="pointer-events:none">${mStr}</text>`);
    }
    if (this._get('gauge_label_text','') && this._get('gauge_label_active',true)) {
      const glTxt=this._get('gauge_label_text',''), glSize=safeFloat(this._get('gauge_label_font_size',8),8)*scale;
      const glW=this._get('gauge_label_font_weight',600);
      const glX=this.CENTER+safeFloat(this._get('gauge_label_offset_x',0),0)*scale, glY=this.CENTER+safeFloat(this._get('gauge_label_offset_y',-8),-8)*scale;
      const glCol=resolveColor(this._get('gauge_label_color_type','adaptive'),this._get('gauge_label_color',null));
      extraLabels.push(svg`<text class="layer-elm-static" data-sc-part="gauge_label" x="${glX.toFixed(2)}" y="${glY.toFixed(2)}" fill="${glCol}" font-size="${glSize}px" font-weight="${glW}" text-anchor="middle" dominant-baseline="middle" style="pointer-events:none">${glTxt}</text>`);
    }

    const pCol  = resolveColor(this._get('pointer_color_type','fixed'), this._get('pointer_color', [255,255,255]));
    const pW    = safeFloat(this._get('pointer_width',2),2)*scale, pLlen=safeFloat(this._get('pointer_length',10),10)*scale;
    const rTip  = radius-(safeFloat(this._get('pointer_offset',2),2)*scale), xBase=rTip-pLlen;
    
    let shadowDef = '';
    let filterAttr = '';
    let sX = 0, sY = 0;
    // Black at a little over a third, which is what this shadow was painted
    // with before either of them was a setting.
    let sCol = 'rgb(0,0,0)', sOpacity = 0.35;
    const pShadowType = this._get('pointer_shadow_type', 'none');
    
    if (pShadowType !== 'none') {
      const sBlur = safeFloat(this._get('pointer_shadow_blur', 0.8), 0.8);
      // `pointer_shadow_offset_y` is the name this carried while the angle was
      // always 90 degrees and the distance was therefore always vertical. The
      // editor writes `pointer_shadow_distance` now; the old key is still read
      // so a config written before the rename keeps its shadow.
      const sDist = safeFloat(this._get('pointer_shadow_distance', this._get('pointer_shadow_offset_y', 0.5)), 0.5);
      const sAngle = safeFloat(this._get('pointer_shadow_angle', 90), 90); 
      const sRad = sAngle * Math.PI / 180;
      // 'adaptive' cannot mean here what it means everywhere else in this file.
      // The theme's text color is near-white on a dark card, and the shadow is
      // offset and barely blurred, so it does not read as the halo a lifted
      // object casts on a dark surface - it reads as a second, ghostly pointer
      // beside the real one. A shadow is the absence of light in any theme;
      // what adapts is its strength, which is the opacity below. 'fixed' takes
      // the color the editor has been offering all along.
      sCol = pShadowType === 'adaptive'
        ? 'rgb(0,0,0)'
        : resolveColor('fixed', this._get('pointer_shadow_color', [0, 0, 0]));
      // On the group rather than on each shape: the hub and the pointer overlap,
      // and a shadow that is darker where one object crosses itself is not a
      // shadow.
      sOpacity = safeFloat(this._get('pointer_shadow_opacity', 0.35), 0.35);
      
      sX = sDist * Math.cos(sRad);
      sY = sDist * Math.sin(sRad);
      
      const shadowId = `p-shadow-${this.config.entity ? this.config.entity.replace(/[^a-zA-Z0-9]/g,'_') : 'x'}_${this.dataset.idx || 0}`;
      
      shadowDef = svg`
        <defs>
          <filter id="${shadowId}" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="${sBlur}" />
          </filter>
        </defs>
      `;
      filterAttr = `url(#${shadowId})`;
    }
    
    const scaleKey = `${data.unitPrefix}_${data.resultTier}_${data.max}`;

    // Each moving part gets its own <svg> in the HTML flow, because a transform
    // there is composited and the same transform on an SVG group is not - see
    // the .sc-gauge-layer comment in the stylesheet. The layers keep the paint
    // order the single SVG had: the needle's shadow, then the pivot dot, then
    // the needle, with the value text above all of them.
    // Every layer carries the same viewBox as the gauge below it, so what it
    // draws lands where it always did, and the stylesheet sizes it to the
    // square that viewBox fills - which is what makes a percentage origin
    // land exactly on the pivot.
    // `needle` marks the one layer whose live angle the canvas editor reads off
    // the DOM, so the handles on its two ends can ride along with it.
    const layer = (originX, originY, rotate, content, needle = false) => html`
      <div class="sc-gauge-layer" ?data-sc-needle=${needle}
           style="transform-origin: ${(originX / this.SIZE * 100).toFixed(4)}% ${(originY / this.SIZE * 100).toFixed(4)}%;${
             rotate ? ` transform: rotate(${renderAngle}deg); transition: transform ${this.frozen || !this._isInitialized ? 0 : dur}s ${easingCurve};` : ''}">
        <svg viewBox="0 0 ${this.SIZE} ${this.SIZE}" style="width:100%;height:100%;overflow:visible;display:block;">
          ${content}
        </svg>
      </div>`;

    const is3d = this._get('pointer_3d_effect', false);
    // The needle turns about the gauge's centre. It used to be movable off it,
    // which is why the pivot is still named rather than written out: the shadow
    // is placed against it, and everything the needle draws is drawn from it.
    const pivot = this.CENTER;
    const dotR = safeFloat(this._get('pointer_center_radius',2),2) * scale;
    const shape = (color, gradId) => this._get('pointer_type','needle') === 'triangle'
      ? svg`<polygon points="${rTip},0 ${xBase},${(-pW/2).toFixed(2)} ${xBase},${(pW/2).toFixed(2)}" fill="${color}"/>${
          gradId ? svg`<polygon points="${rTip},0 ${xBase},${(-pW/2).toFixed(2)} ${xBase},${(pW/2).toFixed(2)}" fill="url(#${gradId})"/>` : ''}`
      : svg`<line x1="${xBase}" y1="0" x2="${rTip}" y2="0" stroke="${color}" stroke-width="${pW}" stroke-linecap="round"/>${
          gradId ? svg`<line x1="${xBase}" y1="0" x2="${rTip}" y2="0" stroke="url(#${gradId})" stroke-width="${pW}" stroke-linecap="round"/>` : ''}`;

    // The shadow rotates about its own pivot, offset from the needle's - as it
    // did when it was a translate inside the rotating group.
    const shadowAt = (content) => layer(pivot + sX, pivot + sY, true, svg`
          ${shadowDef}
          <g transform="translate(${(pivot + sX).toFixed(2)}, ${(pivot + sY).toFixed(2)})" filter="${filterAttr}" opacity="${sOpacity}">
            ${content}
          </g>`);

    const pointerLayers = html`
      ${filterAttr ? shadowAt(svg`<circle cx="0" cy="0" r="${dotR}" fill="${sCol}"/>${is3d ? '' : shape(sCol, null)}`) : ''}
      ${layer(pivot, pivot, false, svg`<circle cx="${pivot}" cy="${pivot}" r="${dotR}" fill="${resolveColor(this._get('pointer_dot_color_type','fixed'), this._get('pointer_dot_color',[255,255,255]))}"/>`)}
      ${(filterAttr && is3d) ? shadowAt(shape(sCol, null)) : ''}
      ${layer(pivot, pivot, true, svg`
          ${is3d ? svg`<defs>
            <linearGradient id="sc-3d-pointer-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="white" stop-opacity="0.8"/>
              <stop offset="35%" stop-color="white" stop-opacity="0.0"/>
              <stop offset="65%" stop-color="black" stop-opacity="0.0"/>
              <stop offset="100%" stop-color="black" stop-opacity="0.6"/>
            </linearGradient>
          </defs>` : ''}
          <g transform="translate(${pivot.toFixed(2)}, ${pivot.toFixed(2)})">${shape(pCol, is3d ? 'sc-3d-pointer-grad' : null)}</g>`, true)}`;

    return html`
      <div class="sc-gauge-wrap" @touchstart=${this._handleTouch} style="${wrapStyle}">
        ${waveStyleBlock}
        ${waveDivNode}
        
        <svg viewBox="0 0 ${this.SIZE} ${this.SIZE}" style="width:100%;height:100%;overflow:visible;display:block;">
          ${bgNode}

          ${animType === 'ripple' ? [...Array(this._get('bg_threshold_anim_ripple_multi',false)?3:1)].map((_, i) => svg`
            <g transform="translate(${this.CENTER},${this.CENTER})">
              <circle class="layer-elm-float ${rClass} ${i===1?'sc-anim-ripple-d1':i===2?'sc-anim-ripple-d2':''}" 
                      cx="0" cy="0" r="${(radius * 0.15).toFixed(2)}" fill="none" stroke="${animCol}" 
                      stroke-width="${(stroke*0.5).toFixed(2)}" opacity="0" style="will-change:transform,opacity;"/>
            </g>
          `) : ''}

          ${frameNode}

          ${this._buildRingTemplate(data, startAngle, totalAngle, radius, stroke)}
          
          ${this._get('sectors', []).map(sec => {
            const sStart = startAngle + safeFloat(sec.start_percent,75)/100*totalAngle;
            const sEnd = sStart + safeFloat(sec.length_percent,25)/100*totalAngle;
            if (Math.abs(sEnd-sStart)<0.01) return '';
            
            const outerR = safeFloat(sec.outer_radius,22)*scale;
            const innerR = safeFloat(sec.inner_radius,12)*scale;
            const secRange = sEnd - sStart;

            const val1 = data.min + (safeFloat(sec.start_percent, 75) / 100) * range;
            const val2 = data.min + ((safeFloat(sec.start_percent, 75) + safeFloat(sec.length_percent, 25)) / 100) * range;
            const valRange = val2 - val1;

            const secPreset = sec.gradient_preset || (sec.use_gradient ? 'classic' : 'none');
            const secManualStops = secPreset === 'manual' ? this._getParsedManualStops(sec.manual_stops, val1, val2, sec.threshold_unit || 'percent') : null;

            if (secManualStops || (sec.use_gradient && sec.color_end)) {
              let res;

              if (sec.resolution_auto) {
                  const effectiveRadius = outerR; 
                  res = Math.max(0.2, 15 / (effectiveRadius + 1)); 
              } else {
                  const rawRes = safeFloat(sec.resolution, 3.6); 
                  res = 5.1 - Math.max(0.1, Math.min(5.0, rawRes));
              }

              const segs = Math.max(4, Math.floor(Math.abs(secRange) / res));
              const gradPaths = [];
              
              if (secManualStops) {
                for(let i=0; i<segs; i++) {
                  const p1 = i/segs; const p2 = (i+1)/segs;
                  const a1 = sStart + p1*secRange; 
                  const a2 = sStart + p2*secRange + (secRange > 0 ? 0.2 : -0.2); 
                  
                  const midPct = p1 + (0.5/segs);
                  const valAtSeg = val1 + midPct * valRange;
                  const rC = this._getColorAt(valAtSeg, secManualStops);
                  
                  gradPaths.push(svg`<path class="layer-elm-base" d="${buildSectorPath(this.CENTER,this.CENTER,innerR,outerR,a1,a2)}" fill="rgb(${rC.join(',')})" opacity="${safeFloat(sec.opacity, 0.85)}"/>`);
                }
              } else {
                const rgb1 = toRgbArray(resolveColor('fixed', sec.color||'#dc3232')) || [220,50,50];
                const rgb2 = toRgbArray(resolveColor('fixed', sec.color_end)) || [0,255,0];
                for(let i=0; i<segs; i++) {
                  const p1 = i/segs; const p2 = (i+1)/segs;
                  const a1 = sStart + p1*secRange; 
                  const a2 = sStart + p2*secRange + (secRange > 0 ? 0.2 : -0.2); 
                  const rC = interpolateColor(rgb1, rgb2, p1 + (0.5/segs)); 
                  gradPaths.push(svg`<path class="layer-elm-base" d="${buildSectorPath(this.CENTER,this.CENTER,innerR,outerR,a1,a2)}" fill="rgb(${rC.join(',')})" opacity="${safeFloat(sec.opacity, 0.85)}"/>`);
                }
              }
              return gradPaths;
            } else {
              return svg`<path class="layer-elm-base" d="${buildSectorPath(this.CENTER,this.CENTER,innerR,outerR,sStart,sEnd)}" fill="${resolveColor('fixed', sec.color||'#dc3232')}" opacity="${safeFloat(sec.opacity, 0.85)}"/>`;
            }
          })}

          ${ticks.length > 0 ? svg`<g>${ticks}</g>` : ''}
          ${tLabels.length > 0 ? svg`<g class="g-tick-labels fade-in" key="${scaleKey}">${tLabels}</g>` : ''}

          ${extraLabels}

        </svg>

        ${pointerLayers}

        ${this._get('show_value',false) ? layer(this.CENTER, this.CENTER, false, svg`          
            <text class="layer-elm-dynamic" data-sc-part="value"
                  x="${this.CENTER + safeFloat(this._get('value_offset_x',0),0)*scale}"
                  y="${this.CENTER + safeFloat(this._get('value_offset_y',15),15)*scale}"
                  fill="${resolveColor(this._get('value_color_type','adaptive'),this._get('value_color',null))}"
                  font-size="${safeFloat(this._get('value_font_size',12),12)*scale}px"
                  text-anchor="middle" font-weight="${this._get('value_font_weight',700)}">
              ${data.val.toFixed(parseInt(this._get('value_decimals',0)))}${data.unitPrefix}${this._get('value_show_raw_unit',false)
                ? (this._get('value_replace_unit',false)
                    ? this._get('value_custom_unit', stateObj?.attributes?.unit_of_measurement||'')
                    : stateObj?.attributes?.unit_of_measurement||'')
                : ''}
            </text>
          `) : ''}
      </div>
    `;
  }
}

if (!customElements.get('sc-gauge')) customElements.define('sc-gauge', ScGauge);

// --- BRIDGE TO CORE ---
window.SupercardModules['gauge'] = window.SupercardModules['gauge'] || {};
Object.assign(window.SupercardModules['gauge'], (() => {

  function update({ config, hass }) {
    if (!config?.gauge_active) return {};
    const gauges = Array.isArray(config.gauges) && config.gauges.length > 0
      ? config.gauges
      : [config];
    return {
      // Not created at all when the canvas does not show it: an element the
      // canvas has no box for is never moved into the renderer, so it would
      // draw in the card's own flow at its natural size.
      litOverlay: html`${gauges.map((cfg, idx) => SC.showsElement(config, `gauge_${idx}`) ? html`
        <sc-gauge data-idx="${idx}" .config=${cfg} .hass=${hass} .globalEntities=${config.global_entities} .onCanvas=${!!config.canvas}></sc-gauge>
      ` : '')}`
    };
  }

  return /** @type {SupercardModule} */ ({ update });
})());