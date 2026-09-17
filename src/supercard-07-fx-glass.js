import { LitElement, html, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { DEAD_PATTERN_TARGETS } from "./config-cleanup.js";
import { lightParams, bevelShadow, px, isRoundTarget, isReliefTarget, boxRingMask, isCircleRadius } from "./glass-light.js";
import { lensScaleFraction, lensFilterMarkup, applyLensGeometry } from "./glass-lens.js";
import { suspendable, watchModalSuspend } from "./glass-suspend.js";
import { icon } from "./icons.js";

const SC = window.SupercardUtils;

// --- NEW UI ELEMENT: X/Y SHADOW PAD (light source) ---
class ScShadowPad extends LitElement {
  static get properties() {
    return {
      angle: { type: Number },
      distance: { type: Number },
      maxDistance: { type: Number },
      // The pattern the light belongs to, for the preview - only its bevel,
      // thickness, style and brightness are read, and the angle and distance
      // are the pad's own, which are ahead of the pattern while dragging.
      pattern: { type: Object },
      preview: { type: Boolean }
    };
  }

  constructor() {
    super();
    this.angle = 90;
    this.distance = 1.0;
    this.maxDistance = 5;
    this.pattern = null;
    // On, because a control whose effect is elsewhere on a long page is the
    // problem the preview exists to solve - but off is a click away, since a
    // lit sample under the sun is also one more thing moving while dragging.
    this.preview = true;
    this._isDragging = false;
  }

  static get styles() {
    return css`
      :host { display: block; width: 100%; max-width: 120px; margin: 0 auto; touch-action: none; }
      .pad-container {
        position: relative; width: 100%; aspect-ratio: 1 / 1;
        background: radial-gradient(circle, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0.2) 100%);
        border: 2px solid var(--divider-color, #444);
        border-radius: 50%; box-shadow: inset 0 2px 8px rgba(0,0,0,0.5);
        cursor: pointer; overflow: hidden;
      }
      .pad-container::before, .pad-container::after { content: ''; position: absolute; background: rgba(255,255,255,0.1); }
      .pad-container::before { top: 0; bottom: 0; left: 50%; width: 1px; transform: translateX(-50%); }
      .pad-container::after { left: 0; right: 0; top: 50%; height: 1px; transform: translateY(-50%); }
      .thumb {
        position: absolute; width: 16px; height: 16px; background: #fff; border-radius: 50%;
        transform: translate(-50%, -50%); box-shadow: 0 0 10px rgba(255,255,255,0.6), 0 2px 4px rgba(0,0,0,0.5);
        pointer-events: none; z-index: 2; display: flex; align-items: center; justify-content: center; transition: box-shadow 0.2s;
      }
      .pad-container:active .thumb { box-shadow: 0 0 15px var(--warning-color, #ff9800), 0 2px 4px rgba(0,0,0,0.5); }
      .sun-icon { font-size: 10px; line-height: 1; margin-top: -1px; }
      /* The sample the light falls on. Not the element the glass will sit on
         - that is drawn on the canvas, at its own size, and a thumbnail of it
         in here would say nothing about the light. What this shows is the one
         thing the pad sets: which edge is lit and which one is in shadow.
         Bevel widths are the pattern's own pixels, so a bevel that swallows
         this sample is a bevel that would swallow a small element too. */
      .sample {
        position: absolute; left: 50%; top: 50%; width: 56%; height: 56%;
        transform: translate(-50%, -50%); border-radius: 10px;
        background: rgba(255,255,255,0.06); pointer-events: none; z-index: 1;
      }
      /* A gauge's glass is a disc, and a bevel reads differently around one:
         the lit edge is an arc that thins out towards the shadow rather than
         two sides meeting at a corner. */
      .sample.round { border-radius: 50%; }
      .preview-toggle {
        display: flex; align-items: center; justify-content: center; gap: 4px;
        margin-top: 6px; font-size: 10px; color: var(--secondary-text-color);
        cursor: pointer; user-select: none;
      }
      .preview-toggle input { margin: 0; cursor: pointer; }
    `;
  }

  _handlePointerDown(e) {
    this._isDragging = true;
    const container = this.shadowRoot.querySelector('.pad-container');
    container.setPointerCapture(e.pointerId);
    this._updatePosition(e);
  }

  _handlePointerMove(e) { if (!this._isDragging) return; this._updatePosition(e); }

  _handlePointerUp(e) {
    this._isDragging = false;
    const container = this.shadowRoot.querySelector('.pad-container');
    container.releasePointerCapture(e.pointerId);
  }

  _updatePosition(e) {
    const rect = this.shadowRoot.querySelector('.pad-container').getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width / 2;
    const dx = e.clientX - cx; const dy = e.clientY - cy;

    let lightAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    let shadowAngle = (lightAngle + 180) % 360;
    if (shadowAngle < 0) shadowAngle += 360;

    let r = Math.sqrt(dx*dx + dy*dy);
    if (r > maxR) r = maxR;
    let distance = (r / maxR) * this.maxDistance;

    if (distance < (this.maxDistance * 0.05)) { distance = 0; shadowAngle = this.angle; }

    this.angle = Math.round(shadowAngle);
    this.distance = parseFloat(distance.toFixed(2));
    this.dispatchEvent(new CustomEvent('pad-change', { detail: { angle: this.angle, distance: this.distance }, bubbles: true, composed: true }));
  }

  render() {
    const lightAngle = (this.angle + 180) * Math.PI / 180;
    const rPct = (this.distance / this.maxDistance) * 50;
    const tx = 50 + Math.cos(lightAngle) * rPct;
    const ty = 50 + Math.sin(lightAngle) * rPct;
    // The pattern's own light, with the pad's live angle and distance: a drag
    // moves those before the commit has come back around, and a preview a
    // render behind the sun it is under is worse than none.
    const light = lightParams({ ...(this.pattern || {}),
                                shadow_angle: this.angle, shadow_distance: this.distance });
    return html`
      <div class="pad-container" @pointerdown=${this._handlePointerDown} @pointermove=${this._handlePointerMove} @pointerup=${this._handlePointerUp} @pointercancel=${this._handlePointerUp}>
        ${this.preview ? html`
          <div class="sample ${isRoundTarget(this.pattern?.target) ? 'round' : ''}"
               style="box-shadow: ${bevelShadow(light, px)};"></div>` : ''}
        <div class="thumb" style="left: ${tx}%; top: ${ty}%;"><div class="sun-icon">${icon('sun')}</div></div>
      </div>
      <label class="preview-toggle" title="A sample lit from where the sun is. Turn it off for a plain pad.">
        <input type="checkbox" .checked=${this.preview}
               @change=${e => { this.preview = e.target.checked; }}>
        Light preview
      </label>
    `;
  }
}
if (!customElements.get('sc-shadow-pad')) customElements.define('sc-shadow-pad', ScShadowPad);

// --- HELPER FUNCTIONS FOR TARGET SELECTION ---
const { getAvailableElements } = window.SupercardUtils;

/**
 * Targets glass is not painted on at all - the same list config-cleanup uses
 * to take a leftover pattern out of a saved card, so the editor cannot offer
 * what the cleanup would then delete.
 */
const NO_GLASS = new Set(DEAD_PATTERN_TARGETS);

/**
 * Elements that ask for their glass in their own editor, so the list must not
 * offer them a second time.
 */
const HAS_OWN_SWITCH = /^elm_(gauge|progressbar|label)_\d+$/;

/**
 * Whether a target carries its own switch somewhere else.
 *
 * The card always does - Card & Dimensions holds it. On a canvas the icon and
 * every surface are picked on the canvas and configured in their element
 * settings, so their switch is there too; on a card without a canvas there is
 * no such place, and this list is the only one they have.
 *
 * @param {string} target @param {any} slot
 */
function hasOwnSwitch(target, slot) {
  if (target === 'main' || HAS_OWN_SWITCH.test(target)) return true;
  if (!slot?.canvas) return false;
  return target === 'elm_icon' || /^elm_surface_\d+$/.test(target);
}

function getTargets(slot) {
  const groups = {
    general: { label: 'General', items: [ { id: 'none', label: '— Please select a target —' } ]},
    elements: { label: 'Direct elements (exact fit)', items: [] }
  };
  const els = getAvailableElements(slot);
  Object.entries(els).forEach(([key, label]) => {
    // An element the canvas does not place has no part to reach, and a target
    // that cannot work is worse than one absent. Surfaces are included.
    if (key !== 'empty' && SC.showsElement(slot, key)
        && !hasOwnSwitch(`elm_${key}`, slot) && !NO_GLASS.has(`elm_${key}`)) {
      groups.elements.items.push({ id: `elm_${key}`, label: `Element: ${label}` });
    }
  });
  return groups;
}

// --- THE EDITOR ---
/**
 * Every control of one glass pattern except the two that only make sense in a
 * list: which element it is for, and whether it is switched on. Both the list
 * editor and the per-element switch draw the same body from here, so a slider
 * added once shows up in both.
 *
 * @param {any} pat the pattern being edited
 * @param {(key: string, value: any) => void} set commit one field
 * @param {(fields: Record<string, any>) => void} setMany commit several at once
 * @param {any} [slot] the card's own config, for the controls only a circular
 *   bar has - which orientation a bar has is not in the pattern's target
 */
function glassFields() {
  /*
   * An element's glass fits itself: `inset: 0` on the element made
   * `position: relative`, or a centred `100cqmin` square where the element is
   * round. Measured across gauge, bar, label, icon and surface, every one of
   * them lands on its element to within half a pixel, so the sliders are off
   * by default and the switch above is what asks for them.
   *
   * They are not only a correction, which is why the switch stays: a negative
   * edge distance paints the glass wider than the element, and an explicit
   * radius rounds glass on a square element. `main` and a layout cell show
   * them outright - there the glass covers a container rather than a thing,
   * and where its edge falls is a real question.
   */
  const isDirect = pat => !!pat.target && pat.target.startsWith('elm_');
  const manual = pat => !isDirect(pat) || pat.manual_override;

  return [
    { type: 'details', icon: icon('ruler'), label: 'Dimensions & Shape', fields: [
      { id: 'manual_override', label: 'Manual adjustments', type: 'checkbox', condition: isDirect,
        hint: "The glass fits the element by itself. Turn this on to depart from that - a negative edge distance makes it larger than the element, and the radius stops following the element's own." },

      { id: 'force_square', label: 'Lock shape (1:1 aspect ratio)', type: 'checkbox', condition: manual,
        hint: 'Forces a perfect square/circle (cqmin).',
        style: 'background:rgba(3,169,244,0.1); padding:8px; border-radius:6px;',
        labelStyle: 'color:var(--primary-color)' },
      { type: 'custom', condition: manual, render: ctx => paddingRow(ctx) },
      { type: 'custom', condition: manual, render: ctx => radiusRow(ctx) },
    ] },

    { type: 'details', icon: icon('donut'), label: 'Ring / Donut Mask', fields: [
      { id: 'ring_effect', label: 'Hide centre (hard edge)', type: 'checkbox',
        hint: 'Blur & colour only affect the edge exactly.', labelStyle: 'color:var(--primary-color)' },
      { id: 'use_custom_ring_width', label: 'Use custom mask thickness', type: 'checkbox',
        style: 'padding-top: 4px;', condition: pat => !!pat.ring_effect,
        hint: pat => 'Off = thickness matches the bevel width exactly (' + (pat.bevel_width ?? pat.bevel_size ?? 2) + 'px)' },
      { id: 'ring_width', label: 'Mask thickness (px)', type: 'range', min: 1, max: 50, step: 0.5,
        placeholder: 5, condition: pat => pat.ring_effect && pat.use_custom_ring_width },
      { id: 'ring_center_opacity', label: 'Effect strength in centre (%)', type: 'range',
        min: 0, max: 100, int: true, placeholder: 0, condition: pat => !!pat.ring_effect,
        hint: '0 = blur & colour completely hollow' },
    ] },

    { type: 'details', icon: icon('search'), label: 'Optics (Magnifier & Curvature)', fields: [
      { id: 'zoom', label: 'Magnify content (zoom)', type: 'range', min: 1, max: 1.5, step: 0.01, placeholder: 1 },
      { id: 'glare', label: 'Convex 3D shine (%)', type: 'range', min: 0, max: 100, int: true, placeholder: 0 },
      { id: 'refraction', label: 'Edge refraction (%)', type: 'range', min: 0, max: 100, int: true, placeholder: 0,
        hint: 'Bends what is behind the edge, the way real glass does. With blur at 0 this is clear glass: what is underneath stays readable and only the rim curls. Not shown by Safari or Firefox, which draw the pane without it.' },
    ] },

    { type: 'details', icon: icon('droplet'), label: 'Glass & Blur', fields: [
      { id: 'blur', label: 'Blur strength (px)', type: 'range', min: 0, max: 2, step: 0.01, placeholder: 10 },
      { id: 'opacity', label: 'Background opacity (%)', type: 'range', min: 0, max: 100, int: true, placeholder: 10 },
      { type: 'custom', render: ctx => html`
        <div class="row"><label>Colour (hex picker)</label>
          <input type="color" .value=${ctx.entry.bg_rgb || '#ffffff'}
                 @input=${e => ctx.set('bg_rgb', e.target.value)}>
        </div>` },
    ] },

    { type: 'details', icon: icon('moon'), label: 'Light Refraction & Bevel (Physics)', fields: [
      { id: 'shadow_style', label: 'Glass style', type: 'select', options: pat => [
        { value: 'none', label: 'Flat (no edges)', selected: pat.shadow_style === 'none' },
        { value: 'frosted', label: 'Frosted (soft edges)', selected: pat.shadow_style === 'frosted' },
        { value: 'liquid', label: 'Liquid (physical refraction)', selected: pat.shadow_style === 'liquid' },
      ] },

      { type: 'custom', condition: pat => pat.shadow_style !== 'none', render: ctx => sunPad(ctx) },
      { id: 'bevel_width', label: 'Bevel width (px)', type: 'range', min: 0, max: 30, step: 0.1,
        hint: 'Extent of the edge inward', condition: pat => pat.shadow_style !== 'none',
        value: pat => pat.bevel_width ?? pat.bevel_size ?? 2 },
      { id: 'glass_thickness', label: 'Glass thickness (depth)', type: 'range', min: 0, max: 20, step: 0.5,
        placeholder: 5, hint: 'Controls the steepness & refraction',
        condition: pat => pat.shadow_style !== 'none' },
      { id: 'light_brightness', label: 'Base brightness (light)', type: 'range', min: 0, max: 1, step: 0.001,
        placeholder: 0.4, condition: pat => pat.shadow_style !== 'none' },
    ] },

    { type: 'details', icon: icon('mountain'), label: 'Relief',
      condition: (pat, slot) => isReliefTarget(pat.target, slot), fields: [
      { id: 'segment_relief', label: 'Light the ring too', type: 'checkbox',
        hint: 'Gives the ring an edge of its own, lit from the same sun as the glass - each pill on a segmented bar, the stroke on a continuous one.' },
      // The sun belongs to the bevel, but the relief borrows it: both are lit
      // from the same direction, so the pad is shown in whichever section is
      // currently the one that uses it.
      { type: 'custom', render: ctx => sunPad(ctx),
        condition: pat => pat.segment_relief && pat.shadow_style === 'none' },
      { id: 'segment_relief_mode', label: 'Relief', type: 'select',
        condition: pat => !!pat.segment_relief,
        options: pat => [
          { value: 'raised', label: 'Raised (standing out of the glass)', selected: pat.segment_relief_mode !== 'engraved' },
          { value: 'engraved', label: 'Engraved (cut into the glass)', selected: pat.segment_relief_mode === 'engraved' },
        ] },
      { id: 'segment_relief_depth', label: 'Relief depth', type: 'range', min: 0, max: 3, step: 0.1,
        placeholder: 0.6, condition: pat => !!pat.segment_relief,
        hint: "In the bar's own unit, so it keeps its look as the ring resizes" },
    ] },
  ];
}

/** The edge distance: a slider, what it reads, and the unit it is in. */
function paddingRow(ctx) {
  const pat = ctx.entry;
  const unit = pat.padding_unit || 'px';
  return html`
    <div class="row">
      <label>Edge distance (inset / padding) ${SC.tipDot('A negative value makes the glass larger than the element.')}</label>
      <div style="display:flex; align-items:center; width:60%; gap:8px">
        ${SC.slider(pat.padding ?? 0, v => ctx.set('padding', v), {
          min: unit === '%' ? -100 : -50, max: unit === '%' ? 100 : 50, style: 'flex:1', int: true })}
        <span style="font-size:11px; min-width:24px; text-align:right;">${pat.padding ?? 0}</span>
        <select style="width:60px" @change=${e => ctx.set('padding_unit', e.target.value)}>
          <option value="px" ?selected=${pat.padding_unit === 'px' || !pat.padding_unit}>px</option>
          <option value="%" ?selected=${pat.padding_unit === '%'}>%</option>
        </select>
      </div>
    </div>`;
}

/** The corner radius, and the unit it is in. */
function radiusRow(ctx) {
  const pat = ctx.entry;
  return html`
    <div class="row">
      <label>Corner radius (border-radius)</label>
      <div style="display:flex;width:60%;gap:4px">
        <input type="number" style="flex:1" .value=${pat.border_radius ?? ''} placeholder="Auto"
               @input=${e => ctx.set('border_radius', e.target.value)}>
        <select style="width:60px" @change=${e => ctx.set('border_radius_unit', e.target.value)}>
          <option value="px" ?selected=${pat.border_radius_unit === 'px'}>px</option>
          <option value="%" ?selected=${pat.border_radius_unit === '%'}>%</option>
        </select>
      </div>
    </div>`;
}

/** The direction the light falls from, as a pad with a lit sample in it. */
function sunPad(ctx) {
  const pat = ctx.entry;
  return html`
    <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 8px; border: 1px dashed var(--divider-color, #444); display: flex; flex-direction: column; align-items: center; gap: 12px; margin: 8px 0;">
      <label style="align-self: flex-start; margin-bottom: -4px;">Light source (sun)</label>
      <sc-shadow-pad
        .angle=${pat.shadow_angle ?? 90}
        .distance=${pat.shadow_distance ?? 1}
        .maxDistance=${5}
        .pattern=${pat}
        @pad-change=${e => ctx.setMany({ shadow_angle: e.detail.angle, shadow_distance: e.detail.distance })}
      ></sc-shadow-pad>
      <div style="display: flex; gap: 16px; font-size: 11px; color: var(--secondary-text-color);">
        <span>Angle: <b style="color:var(--primary-color)">${pat.shadow_angle ?? 90}°</b></span>
        <span>Distance offset: <b style="color:var(--primary-color)">${pat.shadow_distance ?? 1}x</b></span>
      </div>
    </div>`;
}

/**
 * Every control of one glass pattern except the two that only make sense in a
 * list: which element it is for, and whether it is switched on. Both the list
 * editor and the per-element switch draw the same body from here, so a slider
 * added once shows up in both.
 *
 * @param {any} pat the pattern being edited
 * @param {(key: string, value: any) => void} set commit one field
 * @param {(fields: Record<string, any>) => void} setMany commit several at once
 * @param {any} [slot] the card's own config, for the controls only a circular
 *   bar has - which orientation a bar has is not in the pattern's target
 */
function glassBody(pat, set, setMany, slot) {
  return SC.renderFields(glassFields(), { entry: pat, slot, set: (k, v) => set(k, v), setMany });
}

/** A fresh pattern for `target`, with the defaults the Add button used to set. */
function defaultPattern(target) {
  return {
    id: Date.now(), enabled: true, target, blur: 10, opacity: 10, padding: 0, padding_unit: 'px',
    border_radius: '', border_radius_unit: 'px', force_square: false, zoom: 1, glare: 0,
    bg_rgb: '#ffffff', shadow_style: 'liquid', light_brightness: 0.4, bevel_width: 2, glass_thickness: 5,
    refraction: 0,
    shadow_angle: 90, shadow_distance: 1,
    manual_override: false,
    ring_effect: false, use_custom_ring_width: false, ring_width: 5, ring_center_opacity: 0
  };
}

/** The patterns a slot carries, with the pre-list single effect folded in. */
function readPatterns(slot) {
  const patterns = Array.isArray(slot?.fx_glass_patterns) ? slot.fx_glass_patterns : [];
  if (patterns.length === 0 && slot?.fx_glass && slot.fx_glass.enabled) {
    return [{ id: Date.now(), target: 'main', padding_unit: 'px', ...slot.fx_glass }];
  }
  return patterns;
}

/**
 * The glass switch for one target, with its settings unfolding underneath.
 *
 * The pattern list is still the storage - this is a view of the one entry
 * whose `target` is ours. Switching off keeps the entry, so the settings are
 * still there when it goes back on; that is the whole reason the pattern is
 * not simply deleted.
 */
class ScFxGlassPanel extends LitElement {
  static get properties() {
    return { slot: { type: Object }, hass: { type: Object }, commitFn: { type: Function },
             target: { type: String }, label: { type: String } };
  }

  static get styles() {
    return [SC.editorStyles, css`
      .row { gap: 8px; }
      .fx-switch { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .fx-body { margin-top: 8px; border-top: 1px dashed var(--divider-color, #444); padding-top: 8px; }
      .section-title { margin-top: 12px; }
      input[type="color"] { padding: 0; width: 60%; height: 32px; cursor: pointer; border: 1px solid var(--divider-color); }
      input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
      input[type="color"]::-webkit-color-swatch { border: none; border-radius: 3px; }
    `];
  }

  _patterns() { return readPatterns(this.slot); }

  _commit(list) { if (this.commitFn) this.commitFn('__merge__', { fx_glass_patterns: list }); }

  _toggle(on) {
    const list = this._patterns();
    const idx = list.findIndex(p => p.target === this.target);
    if (idx < 0) { this._commit([...list, { ...defaultPattern(this.target), enabled: on }]); return; }
    this._commit(SC.withPatch(list, idx, 'enabled', on));
  }

  render() {
    if (!this.slot || !this.target) return html``;
    const list = this._patterns();
    const idx = list.findIndex(p => p.target === this.target);
    const pat = idx < 0 ? null : list[idx];
    const on = !!pat?.enabled;
    const set = (key, value) => this._commit(SC.withPatch(list, idx, key, value));
    const setMany = (fields) => {
      const n = structuredClone(list);
      Object.assign(n[idx], fields);
      this._commit(n);
    };

    return html`
      <div class="fx-switch">
        <label>${icon('sparkles')} ${this.label || 'Glass FX'}</label>
        <ha-switch .checked=${on} @change=${e => this._toggle(e.target.checked)}></ha-switch>
      </div>
      ${on && pat ? html`<div class="fx-body">${glassBody(pat, set, setMany, this.slot)}</div>` : ''}
    `;
  }
}

if (!customElements.get('sc-fx-glass-panel')) customElements.define('sc-fx-glass-panel', ScFxGlassPanel);

class ScFxGlassEditor extends LitElement {
  static get properties() {
    return {
      slot: { type: Object },
      hass: { type: Object },
      commitFn: { type: Function },
      _expanded: { type: Object, state: true }
    };
  }

  constructor() {
    super();
    this._expanded = ScFxGlassEditor._expandedCache ?? {};
  }

  static get styles() {
    return [SC.editorStyles, css`
      .row { gap: 8px; }
      .toggle-icon { text-align: center; }
      .pattern-card { transition: opacity 0.2s; }
      .pattern-header { user-select: none; }
      select optgroup { background: var(--secondary-background-color, #1e1e1e); color: var(--primary-color); font-weight: bold; font-style: normal; }
      select option { color: var(--primary-text-color); font-weight: normal; }
      input[type="color"] { padding: 0; width: 60%; height: 32px; cursor: pointer; border: 1px solid var(--divider-color); }
      input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
      input[type="color"]::-webkit-color-swatch { border: none; border-radius: 3px; }
    `];
  }

  _commit(newList) {
    if (this.commitFn) this.commitFn('__merge__', { fx_glass_patterns: newList });
  }

  /** Commit `list` with one field of entry `idx` changed. */
  _set(list, idx, key, value) { this._commit(SC.withPatch(list, idx, key, value)); }

  _toggle(id, e) {
    if (e) e.stopPropagation();
    this._expanded = { ...this._expanded, [id]: !this._expanded[id] };
    ScFxGlassEditor._expandedCache = this._expanded;
  }

  render() {
    if (!this.slot) return html``;

    const patterns = readPatterns(this.slot);

    const targetGroups = getTargets(this.slot);
    const usedTargets = patterns.map(p => p.target).filter(t => t !== 'none');

    // A pattern whose element asks for its glass in its own editor is not this
    // list's to show. The list stopped offering those targets, so a row for one
    // could only say "Unknown target" over an empty menu - next to a delete
    // button that would quietly take a gauge's glass with it. A target this
    // list does not know for any other reason, a surface that has since been
    // removed, keeps its row: nothing else can reach that pattern, and a row
    // nobody can find is how the last one of these went unnoticed.
    //
    // Each row carries its index in the stored list, because that is what every
    // edit below commits against, and is numbered by where it sits in this
    // list, because that is the only list the person reading it can see.
    const rows = patterns
      .map((pat, idx) => ({ pat, idx }))
      .filter(({ pat }) => !hasOwnSwitch(pat.target, this.slot));

    // Everything a card can point at is switched from its own editor now, so
    // on a healthy canvas this list has nothing left to offer and stays away.
    // What keeps it is a card without a canvas, where the icon has no element
    // settings to live in - and a stored pattern whose target is gone, because
    // a row nobody can reach is how the last stale target went unnoticed.
    const placed = Array.isArray(this.slot?.canvas?.elements) ? this.slot.canvas.elements : [];
    const reachable = targetGroups.elements.items
      .some(t => placed.some(el => el?.id === t.id.replace(/^elm_/, '')));
    if (!rows.length && !reachable) return html``;

    const getLabelForTarget = (targetId) => {
      for (const group of Object.values(targetGroups)) {
        const found = group.items.find(t => t.id === targetId);
        if (found) return found.label;
      }
      return 'Unknown target';
    };

    return html`
      <details class="inner-section">
        <summary>${icon('sparkles')} FX: Frosted & Liquid Glass (other targets)
          ${SC.tipDot("Gauges, bars and labels carry their own Glass FX switch in their editor, and the card's is in Card & Dimensions. What is left here is the icon, surfaces and layout cells.")}
          <span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('chevron-down')}</span></summary>
        <div class="inner-content">
          ${rows.map(({ pat, idx }, n) => {
            const isExp = !!this._expanded[pat.id];
            let targetLabel = getLabelForTarget(pat.target);
            if (pat.target === 'none') targetLabel = 'Not assigned';


            return html`
              <div class="pattern-card"
                @dragstart=${e => { e.stopPropagation(); e.dataTransfer.setData('application/json', JSON.stringify({ idx })); e.target.style.opacity = '0.4'; }}
                @dragover=${e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.style.borderTop = '3px dashed var(--primary-color)'; }}
                @dragleave=${e => e.currentTarget.style.borderTop = ''}
                @drop=${e => {
                  e.preventDefault(); e.stopPropagation(); e.currentTarget.style.borderTop = '';
                  const data = JSON.parse(e.dataTransfer.getData('application/json') || '{}');
                  if (data.idx !== undefined && data.idx !== idx) {
                    const n = structuredClone(patterns);
                    const [moved] = n.splice(data.idx, 1);
                    n.splice(idx, 0, moved);
                    this._commit(n);
                  }
                }}
                @dragend=${e => e.target.style.opacity = '1'}
              >
                <div class="pattern-header" @click=${e => this._toggle(pat.id, e)}>
                  <div>
                    <span class="drag-handle" @mousedown=${e => { e.stopPropagation(); e.target.closest('.pattern-card').setAttribute('draggable', 'true'); }} @mouseup=${e => { e.stopPropagation(); e.target.closest('.pattern-card').removeAttribute('draggable'); }} @mouseleave=${e => e.target.closest('.pattern-card').removeAttribute('draggable')}>${icon('grip-vertical')}</span>
                    <span class="toggle-icon">${icon(isExp ? 'chevron-down' : 'chevron-right')}</span>
                    <span style="color:${pat.enabled ? 'var(--primary-text-color)' : 'var(--secondary-text-color)'}">Glass effect ${n + 1}</span>
                    <span style="font-size:10px;color:${pat.target === 'none' ? '#f44' : 'var(--secondary-text-color)'};margin-left:8px;font-weight:normal;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:bottom;">(${targetLabel})</span>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px">
                    <ha-switch .checked=${!!pat.enabled} @click=${e => e.stopPropagation()} @change=${e => { this._set(patterns, idx, 'enabled', e.target.checked); }}></ha-switch>
                    <button type="button" title="Clone" @click=${e => { e.preventDefault(); e.stopPropagation(); const n = structuredClone(patterns); const clone = structuredClone(pat); clone.id = Date.now(); clone.target = 'none'; n.splice(idx + 1, 0, clone); this._commit(n); this.requestUpdate(); }} style="background:none;border:none;color:var(--primary-color);cursor:pointer;padding:4px;font-size:14px;">${icon('copy')}</button>
                    <button type="button" title="Delete" @click=${e => { e.preventDefault(); e.stopPropagation(); const n = [...patterns]; n.splice(idx, 1); this._commit(n); }} style="background:none;border:none;color:#f44;cursor:pointer;padding:4px">${icon('trash-2')}</button>
                  </div>
                </div>

                ${isExp ? html`
                  <div class="pattern-content">
                    <div class="row">
                      <label>Target / element</label>
                      <select style="width:60%" @change=${e => { this._set(patterns, idx, 'target', e.target.value); }}>
                        ${Object.values(targetGroups).filter(group => group.items.length).map(group => html`
                          <optgroup label="${group.label}">
                            ${group.items.map(t => {
                              const isLocked = t.id !== 'none' && t.id !== pat.target && usedTargets.includes(t.id);
                              return html`<option value=${t.id} ?selected=${pat.target === t.id} ?disabled=${isLocked}>${t.label} ${isLocked ? '(In use)' : ''}</option>`;
                            })}
                          </optgroup>
                        `)}
                      </select>
                    </div>

                    ${glassBody(pat,
                      (key, value) => this._set(patterns, idx, key, value),
                      (fields) => { const n = structuredClone(patterns); Object.assign(n[idx], fields); this._commit(n); },
                      this.slot)}
                  </div>
                ` : ''}
              </div>
            `;
          })}

          <button type="button" class="add-btn" @click=${(e) => {
            e.preventDefault(); e.stopPropagation();
            const n = structuredClone(patterns);
            const newId = Date.now();
            n.push({ ...defaultPattern('none'), id: newId, target: 'none' });
            this._commit(n);
            this._expanded = { ...this._expanded, [newId]: true };
            this.requestUpdate();
          }}>${icon('plus')} Add new glass effect</button>
        </div>
      </details>
    `;
  }
}

if (!customElements.get('sc-fx-glass-editor')) customElements.define('sc-fx-glass-editor', ScFxGlassEditor);
ScFxGlassEditor._expandedCache = {};

// --- THE MODULE ---
window.SupercardModules['fx_glass'] = window.SupercardModules['fx_glass'] || {};
Object.assign(window.SupercardModules['fx_glass'], (() => {

  function getElementSelector(targetId) {
    const id = targetId.replace('elm_', '');
    if (id === 'icon') return 'ha-state-icon, .sc-primary-icon';
    if (id === 'name') return '.sc-lbl-n';
    if (id === 'state') return '.sc-lbl-v';
    if (id.startsWith('gauge_')) return `sc-gauge[data-idx="${id.split('_')[1]}"]`;
    if (id.startsWith('progressbar_')) return `sc-progressbar[data-idx="${id.split('_')[1]}"]`;
    // A label is the one element the renderer draws itself instead of taking it
    // as slotted content - on both models. `sc-label-<n>` was never a tag this
    // project defines, so glass on a label used to paint nothing at all; the
    // box the renderer draws it in is a part, the same as a canvas element's.
    if (id.startsWith('label_')) return SC.elementPartSelector(id);
    // A surface has no component of its own - it exists only as the box the
    // canvas draws it in, so the part is the whole element. Without this it
    // fell through to [slot="surface_0"], which matches nothing: a surface is
    // not slotted content but a div inside the renderer's shadow.
    if (id.startsWith('surface_')) return SC.elementPartSelector(id);
    return `[slot="${id}"]`;
  }

  // EXPERIMENT ONLY - a runtime switch so the three variants can be measured
// against each other in one build: window.SC_AWAKE = 'on' | 'stepped' | 'off'.
// This goes away with the fix; it is not a setting.

function update({ hass, config }) {
    const SC_AWAKE_MODE = window.SC_AWAKE || 'demand';
    let patterns = Array.isArray(config.fx_glass_patterns) ? config.fx_glass_patterns : [];
    if (patterns.length === 0 && config.fx_glass && config.fx_glass.enabled) {
      patterns = [{ target: 'main', padding_unit: 'px', ...config.fx_glass }];
    }
    if (patterns.length === 0) return {};

    let styleStr = '';
    let lensDefs = '';

    patterns.forEach(pat => {
      if (!pat.enabled || pat.target === 'none' || NO_GLASS.has(pat.target)) return;

      const isMain = pat.target === 'main';
      const isDirectElement = pat.target.startsWith('elm_');
      let selector = '';
      if (isMain) selector = 'ha-card';
      else if (isDirectElement) selector = getElementSelector(pat.target);
      else selector = `sc-layout-renderer::part(cell-${pat.target.replace('r', '').replace('c', '-')})`;

      const layerZ = isMain ? 300 : 1400;

      // --- 1. Read manual values ---
      let padVal = 0, padUnit = 'px';
      let brValue = '', brUnit = 'px';

      if (!isDirectElement) {
          padVal = pat.padding ?? 0;
          padUnit = pat.padding_unit ?? 'px';
          brValue = pat.border_radius ?? '';
          brUnit = pat.border_radius_unit ?? 'px';
      }

      let autoRadiusFallback = 'inherit';
      let computedForceSquare = pat.force_square ?? false;
      let scaleFactor = 100;

      let isGaugeResponsive = false;
      let gaugeSizePx = 60;

      if (isMain) {
        // One reading of the card's corner for the renderer, the colour module
        // and here: a percentage radius has no px for this to guess at, and a
        // pill card's glass used to keep square-ish corners inside a round one.
        autoRadiusFallback = SC.cardRadius(config) ?? 'var(--sc-border-radius, var(--ha-card-border-radius, 12px))';
      } else if (isDirectElement) {
        if (isRoundTarget(pat.target)) { autoRadiusFallback = '50%'; computedForceSquare = true; }

        if (pat.target.startsWith('elm_progressbar_')) {
          const pbIdx = parseInt(pat.target.split('_')[2]);
          const pbConf = config.progressbars?.[pbIdx];
          const circular = typeof pbConf?.orientation === 'string' && pbConf.orientation.startsWith('circular');
          if (circular) {
            // A circular bar's ring floats inside `.sc-pb-wrap` - the element's
            // own box, rounded by `circular_border_radius`, which the editor
            // calls "Background corner radius" because that is what it is. That
            // plate is the shape somebody sees, so it is the shape the glass
            // takes. `border_radius` belongs to the straight bar this one is
            // not drawing and says nothing about this one.
            const val = String(pbConf.circular_border_radius ?? 50).trim();
            autoRadiusFallback = /^\d+(\.\d+)?$/.test(val) ? `${val}%` : val;
          } else if (pbConf && pbConf.border_radius !== undefined) {
            let val = String(pbConf.border_radius).trim();
            autoRadiusFallback = /^\d+(\.\d+)?$/.test(val) ? `${val}px` : val;
          } else autoRadiusFallback = 'var(--pb-radius, 4px)';
          computedForceSquare = false;
        } else if (pat.target.startsWith('elm_gauge_')) {
          const gIdx = parseInt(pat.target.split('_')[2]);
          const gConf = (Array.isArray(config.gauges) && config.gauges[gIdx]) ? config.gauges[gIdx] : config;

          // Must agree with what sc-gauge decided, or the glass is measured in
          // px against a gauge measured in cqmin. One helper answers both.
          isGaugeResponsive = SC.gaugeIsResponsive(gConf, !!config.canvas);
          gaugeSizePx = gConf.gauge_size_px ?? 60;

          let scaleVal = gConf.gauge_scale ?? gConf.scale;
          if (scaleVal !== undefined) {
            let parsed = parseFloat(String(scaleVal).replace('%', '').trim());
            scaleFactor = (!isNaN(parsed) && parsed > 0 && parsed <= 5) ? parsed * 100 : parsed;
          } else {
            scaleFactor = 90;
          }
        } else if (pat.target === 'elm_icon') {
          isGaugeResponsive = true;
        }
      }

      // --- DYNAMIC UNIT TRANSLATOR ---
      const sf = scaleFactor / 100;

      /*
       * Blur and padding are lengths, and a length only means something next to
       * the box it is drawn on. A gauge has always read them as a share of
       * itself; a bar or a surface read them as fixed px, so the same 10px blur
       * covered half a 20px bar and a tenth of a 200px one - and the canvas is
       * exactly where that size is not fixed, because the card is drawn at
       * whatever width the dashboard gives it.
       *
       * So every element on a canvas now measures in `cqmin`, one percent of
       * the shorter side of the box the canvas gave it, the way the gauge
       * does. Off the canvas nothing changes: there an element's size comes
       * from its own settings in px, so px is what the blur should match.
       */
      const responsiveUnits = isGaugeResponsive || (isDirectElement && SC.onCanvas(config));

      const u = (val, unit = 'px') => {
        if (val === 0) return '0px';
        if (unit === '%') return `${val}%`;
        return responsiveUnits ? `calc(${val * sf} * 1cqmin)` : `${val * sf}px`;
      };

      const computedInset = u(padVal, padUnit);
      const borderRadius = (brValue !== '') ? u(parseFloat(brValue), brUnit) : autoRadiusFallback;

      // --- 2. Radii & positioning ---
      let positioningCSS = '';
      let parentContainerCSS = '';

      if (computedForceSquare) {
        let padSubtract = padVal !== 0 ? ` - (${u(padVal, padUnit)} * 2)` : '';

        if (isGaugeResponsive) {
          positioningCSS = `
            inset: 0 !important;
            margin: auto !important;
            width: calc((100cqmin * ${sf})${padSubtract}) !important;
            height: calc((100cqmin * ${sf})${padSubtract}) !important;
          `;
          parentContainerCSS = 'container-type: size !important;';
        } else {
          positioningCSS = `
            inset: 0 !important;
            margin: auto !important;
            width: calc((${gaugeSizePx}px * ${sf})${padSubtract}) !important;
            height: calc((${gaugeSizePx}px * ${sf})${padSubtract}) !important;
          `;
        }
      } else {
        // No container of our own here. The canvas already wraps every element
        // in `.sc-item-slot`, a size container the width of the element's box,
        // and that is exactly the box these lengths should be a share of.
        // Putting `container-type: size` on the target instead would be wrong
        // as well as redundant: `elm_name` points at the text inside the box,
        // which is sized by its own content - containment collapses it to
        // nothing.
        positioningCSS = `
          inset: ${computedInset} !important;
          margin: auto !important;
          width: calc(100% - (${computedInset} * 2)) !important;
          height: calc(100% - (${computedInset} * 2)) !important;
        `;
      }

      // --- 3. Styling values ---
      const blur = pat.blur !== undefined ? parseFloat(pat.blur) : 10;
      const opacity = (pat.opacity ?? 10) / 100;
      const zoom = pat.zoom !== undefined ? parseFloat(pat.zoom) : 1;
      const glare = (pat.glare ?? 0) / 100;

      // Falls back to the raw value so a plain "r, g, b" string still works.
      const bgRgb = pat.bg_rgb ? SC.toRgb(pat.bg_rgb) : null;
      const rgbString = bgRgb ? bgRgb.join(', ') : (pat.bg_rgb || '255, 255, 255');

      let backgroundCSS = `rgba(${rgbString}, ${opacity})`;
      if (glare > 0) {
        backgroundCSS = `radial-gradient(ellipse at 30% 25%, rgba(255, 255, 255, ${glare}) 0%, rgba(${rgbString}, ${opacity}) 60%)`;
      }

      // --- 4. Physical light calculation & refraction fake (entirely without the border bug!) ---
      // The same numbers the editor's light-source pad draws its preview
      // with - see glass-light.js.
      const light = lightParams(pat);
      const bWidth = light.bevelWidth;
      const mainShadow = bevelShadow(light, u);

      // The Chrome bug fix: never use physical borders when blur is active!
      const faseCSS = 'border: none !important;';

      // --- 5. Mask (ring effect dynamically scaled) ---
      let maskCSS = '';
      if (pat.ring_effect) {
        const useCustom = pat.use_custom_ring_width ?? false;
        const ringSize = useCustom ? (pat.ring_width ?? 5) : (bWidth > 0 ? bWidth : 2);
        const co = (pat.ring_center_opacity ?? 0) / 100;
        const centerColor = co === 0 ? 'transparent' : `rgba(0,0,0,${co})`;
        // A circle is the only shape one radial gradient can cut, and it is
        // the right one only where the glass is itself a circle. On a bar,
        // a cell or the card the glass is a rounded box, and a round hole in
        // one looks like a mistake, because it is.
        maskCSS = isCircleRadius(borderRadius) ? `
          -webkit-mask-image: radial-gradient(circle closest-side, ${centerColor} calc(100% - ${u(ringSize + 1)}), black calc(100% - ${u(ringSize)})) !important;
          mask-image: radial-gradient(circle closest-side, ${centerColor} calc(100% - ${u(ringSize + 1)}), black calc(100% - ${u(ringSize)})) !important;
        ` : `
          ${boxRingMask(u(ringSize), co)}
        `;
      }

      const applyContentZoom = !isDirectElement || (!pat.target.startsWith('elm_gauge_') && !pat.target.startsWith('elm_progressbar_') && pat.target !== 'elm_icon');

      // --- 6. Content z-index correction ---
      let childZIndexCSS = '';

      if (isMain) {
        childZIndexCSS = `
          ha-card .supercard-container {
            position: relative !important;
            z-index: 500 !important;
          }
        `;
      } else {
        childZIndexCSS = `
          ${selector} > * {
            position: relative;
            z-index: 700 !important;
            -webkit-backface-visibility: hidden !important;
            backface-visibility: hidden !important;
            ${applyContentZoom ? `
              transform: scale(${zoom}) translateZ(0) !important;
              transform-origin: center center !important;
              transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1);
            ` : `
              transform: translateZ(0) !important;
            `}
          }
        `;
      }

      // A pane that carries `backdrop-filter` costs the GPU about 2.5 % of a
      // core for as long as it is on screen, whether or not anything moves -
      // measured with sixteen of them on a frozen page: 50 % of a core, 10 %
      // with the declaration gone. So it is only worth writing when it shows:
      // a zero blur is the property at full price for no picture, and behind
      // an opaque pane there is nothing to see blurred.
      const opaquePane = opacity >= 1 && !(glare > 0);
      const blursBackdrop = blur > 0 && !opaquePane;

      // The lens is the same bargain as the blur, and behind an opaque pane
      // it buys the same nothing. It is not the same *picture*, though: a
      // blur hides what is under the glass and a lens does not, so a pane
      // with refraction and no blur is clear glass over readable content -
      // the one look the frosted pane could never give.
      const lensFraction = opaquePane ? 0 : lensScaleFraction(pat.refraction);
      const lensId = `sc-glass-lens-${pat.id}`;
      if (lensFraction) {
        // A gauge's glass is a disc and curls at its ring; everything else is
        // a pane, however rounded, and gathers the backdrop at its rim.
        // `isCircleRadius` catches a surface someone has made round by hand.
        const profile = isRoundTarget(pat.target) || isCircleRadius(borderRadius) ? 'disc' : 'dome';
        lensDefs += lensFilterMarkup(lensId, profile, lensFraction, selector, '::after');
      }
      const backdropCSS = [blursBackdrop ? `blur(${u(blur)})` : '', lensFraction ? `url(#${lensId})` : '']
        .filter(Boolean).join(' ');

      // --- 7. CSS generation ---
      // EXPERIMENT (perf/cpu-investigation): the pane below used to carry
      // `animation: sc-glass-awake-<id> 0.5s infinite alternate`, an opacity
      // nudge whose only purpose was to keep the pane repainting. On a
      // backdrop-filtered layer that means re-sampling and re-blurring the
      // backdrop on every single frame, for every glass pattern on the card.
      // Measured on a real dashboard: 141% of a core at rest, 60% with this
      // one line gone.
      const repaintAnim = `sc-glass-awake-${pat.id}-${Math.random().toString(36).substring(2,7)}`;

      styleStr += `
        @keyframes ${repaintAnim} {
          0% { opacity: 0.99; }
          100% { opacity: 1; }
        }

        ${isMain ? 'ha-card { position: relative !important; background: transparent !important; border: none !important; box-shadow: none !important; isolation: isolate !important; }' : ''}

        ${!isMain ? `
        ${selector} {
          position: relative ${isDirectElement ? '!important' : ''};
          isolation: isolate !important;
          ${parentContainerCSS}
        }
        ` : ''}

        ${childZIndexCSS}

        ${selector}::after {
          content: '' !important;
          position: absolute !important;
          ${positioningCSS}
          box-sizing: border-box !important;
          z-index: ${layerZ} !important;
          pointer-events: none !important;
          border-radius: ${borderRadius} !important;
          background: ${backgroundCSS} !important;
          box-shadow: ${mainShadow} !important;
          ${faseCSS}

          ${SC_AWAKE_MODE === 'on' ? `animation: ${repaintAnim} 0.5s infinite alternate !important;` : ''}
          transform: translateZ(0) !important;
          -webkit-transform: translateZ(0) !important;

          ${backdropCSS ? `
          -webkit-backdrop-filter: ${suspendable(backdropCSS)} !important;
          backdrop-filter: ${suspendable(backdropCSS)} !important;` : ''}
          ${maskCSS}
        }

        ${SC_AWAKE_MODE === 'demand' ? `
        /* The nudge, once per render instead of once per frame: --sc-awake is
           flipped in onAfterRender, which only runs when something the card
           draws has changed, so an idle card costs nothing and a changing one
           still gets its backdrop re-sampled. It moves the pane's opacity by
           a thousandth - invisible, and enough to make it repaint. */
        ${selector}::after { opacity: calc(1 - var(--sc-awake, 0) * 0.001) !important; }
        ` : ''}
      `;
    });
    // The filters ride along with the styles, in the same overlay: a
    // `url(#...)` in a backdrop-filter resolves within the tree the styled
    // element lives in, and that is this one.
    return { htmlOverlay: `<style>${styleStr}</style>${lensDefs ? `<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs>${lensDefs}</defs></svg>` : ''}` };
  }

  /**
   * Flip the nudge after a render that changed something.
   *
   * `backdrop-filter` samples what is behind the pane when the pane paints,
   * and a pane that never paints can hold a stale sample. The card used to
   * buy that with an infinite animation, which re-blurred the backdrop on
   * every frame for as long as the dashboard was open - 80 % of a core on a
   * real one. This does the same job on the only occasions it can matter:
   * the card re-rendered.
   *
   * It flips a custom property inside a stylesheet the card adopts, and
   * touches no element: a class or attribute on the card would fire the
   * MutationObservers other frontend integrations keep on it - card-mod
   * watches every card - and a re-render triggered from inside `updated()`
   * is how a render loop starts. A stylesheet edit fires nothing.
   */
  const awakeSheets = new WeakMap();
  function onAfterRender(shadow) {
    if (!shadow) return;
    // Once per page, not once per card: the watcher is what drops every
    // pane's blur while a modal dialog stands over the dashboard.
    watchModalSuspend();
    // A lens is measured, not declared: its maps and its displacement are in
    // pixels of a pane whose size only exists once the card has been laid
    // out. This is the first moment that is true, and every later render is
    // also the first moment it is true again after a resize.
    applyLensGeometry(shadow);
    if (typeof CSSStyleSheet === 'undefined') return;
    let entry = awakeSheets.get(shadow);
    if (!entry) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(':host { --sc-awake: 0; }');
        shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
        entry = { sheet, on: false };
        awakeSheets.set(shadow, entry);
      } catch (_) { return; }
    }
    entry.on = !entry.on;
    try { entry.sheet.cssRules[0].style.setProperty('--sc-awake', entry.on ? '1' : '0'); } catch (_) {}
  }

  function renderCustomBlock(commitFn, hass, slot) {
    return html`<sc-fx-glass-editor .commitFn=${commitFn} .hass=${hass} .slot=${slot}></sc-fx-glass-editor>`;
  }

  function editorFields() { return []; }

  return /** @type {SupercardModule} */ ({ update, onAfterRender, renderCustomBlock, editorFields });
})());
