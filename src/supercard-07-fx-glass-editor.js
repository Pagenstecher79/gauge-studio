import { LitElement, html, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { DEAD_PATTERN_TARGETS } from "./config-cleanup.js";
import { lightParams, bevelShadow, px, isRoundTarget, isReliefTarget } from "./glass-light.js";
import { clampLightAngle, hasCardLight, LIGHT_ANGLE, LIGHT_DISTANCE } from "./card-light.js";
import { lensScaleFraction, MAX_IOR } from "./glass-lens.js";

import { icon } from "./icons.js";

import { ListReorder } from "./list-reorder.js";

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
      preview: { type: Boolean },
      // Small enough to stand in a row of settings, with neither the sample
      // nor the switch that hides it. Nothing is lost by that: the card's own
      // light is set there, and the card itself is under it - every gauge and
      // every pattern on the canvas is the preview, at the size they are
      // really drawn at, which a sample the width of a thumbnail is not.
      compact: { type: Boolean, reflect: true }
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
    this.compact = false;
    this._isDragging = false;
  }

  static get styles() {
    return css`
      :host { display: block; width: 100%; max-width: 120px; margin: 0 auto; touch-action: none; }
      :host([compact]) { max-width: 34px; margin: 0; }
      /* The half of the sky the sun cannot reach, drawn rather than merely
         refused: a pad that quietly ignores half of itself reads as broken,
         and one that shows where the ground is reads as a horizon. */
      .horizon { position: absolute; left: 0; right: 0; top: 50%; bottom: 0;
        background: rgba(0,0,0,0.3); pointer-events: none; z-index: 0; }
      :host([compact]) .pad-container { border-width: 1px; }
      :host([compact]) .thumb { width: 11px; height: 11px; }
      :host([compact]) .sun-icon { font-size: 7px; }
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

    // The sun stops at the horizon rather than setting behind it, and it stops
    // at the end it is nearer to - so a finger carried on past the edge slides
    // it along the horizon and leaves it there, instead of throwing it across
    // the sky. See `clampLightAngle`.
    shadowAngle = clampLightAngle(shadowAngle);

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
        <div class="horizon"></div>
        ${this.preview && !this.compact ? html`
          <div class="sample ${isRoundTarget(this.pattern?.target) ? 'round' : ''}"
               style="box-shadow: ${bevelShadow(light, px)};"></div>` : ''}
        <div class="thumb" style="left: ${tx}%; top: ${ty}%;"><div class="sun-icon">${icon('sun')}</div></div>
      </div>
      ${this.compact ? '' : html`
      <label class="preview-toggle" title="A sample lit from where the sun is. Turn it off for a plain pad.">
        <input type="checkbox" .checked=${this.preview}
               @change=${e => { this.preview = e.target.checked; }}>
        Light preview
      </label>`}
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
  /**
   * Whether the glass takes the corner of the thing it lies on.
   *
   * Without manual adjustments it always does, and that is the answer nearly
   * everybody wants: a surface rounded to 20 and glass rounded to 8 is a
   * bright square edge standing proud of the paint under it. But the radius
   * used to be the one manual number with no way back - switching manual
   * adjustments on for the edge distance took the corner off the object as
   * well - so it is its own question now.
   *
   * Default on, except for a pattern that has a radius typed into it
   * already: that one is drawing what somebody set, and a card must not
   * change what it draws because the editor learned a new switch.
   */
  const linked = pat => pat.radius_linked === undefined
    ? (pat.border_radius === undefined || pat.border_radius === '')
    : !!pat.radius_linked;

  return [
    { type: 'details', icon: icon('ruler'), label: 'Dimensions & Shape', fields: [
      { id: 'manual_override', label: 'Manual adjustments', type: 'checkbox', condition: isDirect,
        hint: "The glass fits the element by itself. Turn this on to depart from that - a negative edge distance makes it larger than the element, and the radius stops following the element's own." },

      { id: 'force_square', label: 'Lock shape (1:1 aspect ratio)', type: 'checkbox', condition: manual,
        hint: 'Forces a perfect square/circle (cqmin).',
        style: 'background:rgba(3,169,244,0.1); padding:8px; border-radius:6px;',
        labelStyle: 'color:var(--primary-color)' },
      { type: 'custom', condition: manual, render: ctx => paddingRow(ctx) },
      { id: 'radius_linked', label: 'Link corner radius', type: 'checkbox',
        condition: manual, value: linked,
        hint: "The glass rounds its corners exactly as the object under it does, and follows when that changes. Turn this off to round the glass on its own." },
      { id: 'border_radius', label: 'Corner radius (border-radius)', type: 'length',
        unitId: 'border_radius_unit', placeholder: 'Auto', width: '60%',
        condition: pat => manual(pat) && !linked(pat) },
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
      { id: 'ior', label: 'Refractive index (n)', type: 'range', min: 1, max: MAX_IOR, step: 0.05, placeholder: 1,
        condition: pat => lensScaleFraction(pat.refraction) > 0,
        hint: 'How dense the glass is. At 1 only the rim bends. Higher and the whole body refracts - what is behind the pane is drawn inward, more towards the sides than in the middle - and the colours split at the edge into a warm and a cold fringe, the way a prism splits them. Costs more to draw: three passes over the backdrop instead of one.' },
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

      { type: 'custom', condition: pat => pat.shadow_style !== 'none', render: ctx => sunLine(ctx) },
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
      // from the same direction, so the line that says where it is stands in
      // whichever section is currently the one that uses it.
      { type: 'custom', render: ctx => sunLine(ctx),
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

/**
 * Where the sun is, said rather than set.
 *
 * The pad used to stand here, one per pattern, which is how a card came to
 * hold six suns that nothing kept in step. There is one now, on the canvas,
 * and a second control for it here would put the divergence straight back -
 * so this names the one place it is set and says which light this pattern is
 * drawing by at the moment.
 *
 * Which is not always the card's: a pattern saved before the card had a light
 * keeps the one it was drawn under until somebody moves the card's, and that
 * is worth saying plainly, because the numbers it is being lit by are then
 * still its own and are nowhere on the screen.
 */
function sunLine(ctx) {
  const pat = ctx.entry;
  const onCard = hasCardLight(ctx.slot);
  return html`
    <div class="row" style="align-items: flex-start;">
      <label>Light source (sun)</label>
      <div style="width:60%; font-size:11px; color: var(--secondary-text-color); line-height:1.45;">
        ${onCard
          ? html`From the card's own sun, set under <b>Light</b> in the canvas settings -
                 one light for every gauge and every pattern on the card.`
          : html`Still lit from this pattern's own sun,
                 <b>${pat.shadow_angle ?? LIGHT_ANGLE}°</b> at
                 <b>${pat.shadow_distance ?? LIGHT_DISTANCE}x</b>. Moving the card's light -
                 <b>Light</b> in the canvas settings - takes every pattern over to it.`}
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
    refraction: 0, ior: 1,
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
    // Made here rather than in a render, or a redraw mid-drag would drop the
    // card being carried. `list-reorder.js` says why this is not the
    // browser's own drag and drop: that one answers a mouse and nothing else.
    this._reorder = new ListReorder(this, {
      rows: () => this.renderRoot?.querySelectorAll('.pattern-card') || [],
      move: (from, to) => this._movePattern(from, to),
    });
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

  /**
   * The patterns this editor draws, with the place each has in the stored
   * list.
   *
   * Not every pattern is drawn here - one whose target carries its own switch
   * is edited there - so a row's place on the screen is not its place in the
   * config, and the drag has to translate between the two or it moves the
   * wrong effect.
   */
  _visibleRows(patterns) {
    return patterns
      .map((pat, idx) => ({ pat, idx }))
      .filter(({ pat }) => !hasOwnSwitch(pat.target, this.slot));
  }

  /** One card carried to another place, in rows on the screen. */
  _movePattern(from, to) {
    const patterns = readPatterns(this.slot);
    const rows = this._visibleRows(patterns);
    const src = rows[from];
    const dst = rows[to];
    if (!src || !dst || src.idx === dst.idx) return;
    const next = structuredClone(patterns);
    const [moved] = next.splice(src.idx, 1);
    next.splice(dst.idx, 0, moved);
    this._commit(next);
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
    const rows = this._visibleRows(patterns);

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
              <div class="pattern-card ${this._reorder.lifted(n) ? 'drag-lifted' : ''} ${
                  this._reorder.target(n) ? 'drag-target' : ''}">
                <div class="pattern-header" @click=${e => this._toggle(pat.id, e)}>
                  <div>
                    <span class="drag-handle" title="Drag to move"
                          @pointerdown=${e => this._reorder.down(e, n)}
                          @pointermove=${this._reorder.over}
                          @pointerup=${this._reorder.up}
                          @pointercancel=${this._reorder.up}
                          @click=${this._reorder.swallow}>${icon('grip-vertical')}</span>
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
// --- THE EDITOR HALF OF THE MODULE ---
window.SupercardModules['fx_glass'] = window.SupercardModules['fx_glass'] || {};
Object.assign(window.SupercardModules['fx_glass'], (() => {

  function renderCustomBlock(commitFn, hass, slot) {
    return html`<sc-fx-glass-editor .commitFn=${commitFn} .hass=${hass} .slot=${slot}></sc-fx-glass-editor>`;
  }

  function editorFields() { return []; }

  return /** @type {SupercardModule} */ ({ renderCustomBlock, editorFields });
})());
