import { LitElement, html, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { normalizeStops, stopsToCss } from "./gradient-stops.js";
import { PATTERN_ANIMATIONS, defaultColorPattern, patchPattern, patchPatternStops,
         patternList, patternPreviewCss, solidColorOf,
         solidColorPatch } from "./color-pattern.js";

const SC = window.SupercardUtils;

// --- HELPER FUNCTIONS ---
const { getAvailableElements } = window.SupercardUtils;

function getTargets(slot) {
  const targets = [
    { id: 'none', label: '— Please select a target —' },
    { id: 'main', label: 'Main card (entire background)' }
  ];
  const els = getAvailableElements(slot);
  // The element boxes are the paintable regions, surfaces included - which is
  // what migrating a targeted cell turned it into.
  for (const [id, label] of Object.entries(els)) {
    // An element the canvas does not place has no box and no part, so there is
    // nothing there to paint.
    if (id !== 'empty' && SC.showsElement(slot, id)) targets.push({ id: `elm_${id}`, label });
  }
  return targets;
}

/**
 * Whether a target is painted from a panel of its own rather than from this
 * list. The card always is - Card & Dimensions holds its panel - and on a
 * canvas a surface, a gauge and a bar are, in their own menus: a surface in
 * its element settings, a gauge under Background, a bar under its gradient.
 * Only the *first* pattern
 * of such a target belongs to the panel: a second one on the same target is
 * something the list made, and taking it out of the list would leave it
 * painting a card nobody could find it on.
 *
 * @param {string} target @param {any} slot
 */
function hasOwnPanel(target, slot) {
  if (target === 'main') return true;
  // Only on a canvas: an element's pattern paints the box the renderer names
  // as a shadow part, and without a canvas there is no renderer and no box.
  return !!slot?.canvas && /^elm_(surface|gauge|progressbar)_\d+$/.test(target);
}

// --- THE EDITOR ---
class ScColorEditor extends LitElement {
  static get properties() {
    return {
      slot:      { type: Object },
      hass:      { type: Object },
      commitFn:  { type: Function },
      _expanded: { type: Object, state: true }
    };
  }

  constructor() {
    super();
    this._expanded = {}; // Fresh state per instance
  }

  static get styles() {
    return [SC.editorStyles, css`
      .row { gap: 8px; }
      .section-title { display: flex; justify-content: space-between; align-items: center; }
      .toggle-icon { text-align: center; }
      .color-list { display: flex; flex-direction: column; gap: 6px; background: rgba(0,0,0,0.1); padding: 8px; border-radius: 4px; border: 1px solid var(--divider-color, #333); }
      .color-item { display: flex; flex-direction: column; gap: 4px; padding: 6px; border: 1px solid rgba(255,255,255,0.05); border-radius: 4px; background: rgba(255,255,255,0.02); }
      .color-item-row { display: flex; align-items: center; gap: 8px; }
      .color-item-row input[type="color"], .color-row input[type="color"] { width: 40px; height: 30px; padding: 0; border: none; background: none; cursor: pointer; }
      .action-btn { background: rgba(255,255,255,0.05); border: 1px solid var(--divider-color,#555); color: var(--primary-text-color); padding: 6px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-top: 4px; flex: 1; font-weight: bold; }
      .action-btn:hover { background: rgba(255,255,255,0.1); }
      ha-selector { width: 100%; }
      .pos-preview-wrap { display: flex; align-items: center; justify-content: center; gap: 16px; width: 100%; margin: 8px 0; }
      .pos-preview { width: 140px; height: 140px; background: #111; border: 1px solid var(--divider-color,#555); border-radius: 8px; position: relative; overflow: hidden; cursor: crosshair; touch-action: none; box-shadow: inset 0 0 10px rgba(0,0,0,0.5); }
      .pos-dot { position: absolute; width: 12px; height: 12px; background: var(--primary-color,#03a9f4); border-radius: 50%; transform: translate(-50%,-50%); box-shadow: 0 0 10px var(--primary-color), inset 0 0 4px rgba(255,255,255,0.8); pointer-events: none; }
      .icon-btn { background: rgba(255,255,255,0.05); border: 1px solid var(--divider-color,#555); color: var(--secondary-text-color); width: 36px; height: 36px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
      .icon-btn:hover { background: rgba(255,255,255,0.1); color: var(--primary-color); border-color: var(--primary-color); }
    `];
  }

  _commit(newList) {
    if (this.commitFn) this.commitFn('__merge__', { color_patterns: newList });
  }

  /** Commit `list` with one field of entry `idx` changed. */
  _set(list, idx, key, value) { this._commit(SC.withPatch(list, idx, key, value)); }

  /**
   * A pattern's colours, written as the one stop shape. The parallel
   * `colors`/`stops` arrays a pattern may still carry go in the same edit -
   * leaving them would keep a second, now stale, answer in the config.
   */
  _setStops(list, idx, stops) {
    const n = structuredClone(list);
    delete n[idx].colors;
    delete n[idx].stops;
    n[idx].gradient_stops = stops;
    this._commit(n);
  }

  _toggle(id, e) {
    if (e) e.stopPropagation();
    this._expanded = { ...this._expanded, [id]: !this._expanded[id] };
  }

  /** What the pattern's own settings look like, as a field array. */
  _fields() {
    const waveOrRipple = pat => ['ripple', 'waves'].includes(pat.animation);
    const wobble = pat => ['wobble_radial', 'wobble_linear'].includes(pat.animation);
    const waveColors = pat => waveOrRipple(pat) || wobble(pat);
    const radialCenter = pat => pat.bg_type === 'radial' || pat.animation === 'ripple' || pat.animation === 'wobble_radial';
    const angled = pat => pat.bg_type === 'linear' || pat.animation === 'waves' || pat.animation === 'wobble_linear';
    // The card's own corner is the sensible default for the card, and a plain
    // off for anything drawn inside it.
    const autoBorder = pat => pat.border_radius_auto === undefined ? (pat.target === 'main') : pat.border_radius_auto;
    const fluid = pat => pat.animation === 'fluid';
    const caption = 'font-size:11px; font-weight:bold; color:var(--primary-color); margin-top:4px;';
    const small = 'font-size:11px; color:var(--secondary-text-color);';

    return [
      { id: 'name', label: 'Name (internal)', type: 'text' },
      { id: 'target', label: 'Target container', type: 'select', width: '60%',
        // A target with a panel of its own is not on offer here - unless this
        // pattern already points at it, because a select with nothing selected
        // shows its first option instead and would read as a target it is not.
        options: (pat, ctx) => ctx.targets
          .filter(t => t.id === pat.target || !hasOwnPanel(t.id, ctx.slot)).map(t => {
          const locked = t.id !== 'none' && t.id !== pat.target && ctx.usedTargets.includes(t.id);
          return { value: t.id, disabled: locked, selected: pat.target === t.id,
                   label: locked ? t.label + ' (Already in use)' : t.label };
        }) },

      { type: 'details', label: '🎨 Design & Colours', style: 'margin: 4px 0 0 0;', fields: [
        { type: 'note', class: '', bare: true, style: caption, framedWhen: 'corners',
          label: 'The corners are on the canvas - drag either grip, at the bottom '
               + 'left or the top right.' },
        { id: 'border_radius_auto', label: 'Automatic corner radius', type: 'checkbox',
          value: autoBorder, framedBy: 'corners' },
        { type: 'custom', condition: pat => !autoBorder(pat), framedBy: 'corners',
          render: ctx => this._radiusRow(ctx) },

        { id: 'wave_count', label: 'Count (density)', type: 'range', min: 1, max: 20, int: true,
          placeholder: 3, condition: waveColors,
          hint: 'The colours are calculated dynamically by the effect.' },
        { id: 'wave_balance', label: 'Balance (peak vs. trough)', type: 'range', min: 5, max: 95,
          int: true, placeholder: 50, condition: waveColors },
        { id: 'wave_c1', label: 'Line/wave colour (peak)', type: 'color', fallback: '#03a9f4',
          textFallback: true, condition: waveColors },
        { id: 'wave_c2', label: 'Background colour (trough)', type: 'color', fallback: 'transparent',
          textFallback: true, condition: waveColors },
        { type: 'note', class: '', bare: true, style: caption, label: 'Gradient preview', condition: waveColors },
        { type: 'custom', condition: waveColors, render: ctx => this._wavePreview(ctx, angled(ctx.entry)) },

        { id: 'bg_type', label: 'Background type', type: 'select', width: '60%',
          condition: pat => !waveColors(pat) && !fluid(pat), options: pat => [
            { value: 'solid', label: 'Solid (static)', selected: pat.bg_type === 'solid' },
            { value: 'solid_gradient', label: 'Solid (dynamic from gradient)', selected: pat.bg_type === 'solid_gradient' },
            { value: 'linear', label: 'Gradient (linear)', selected: pat.bg_type === 'linear' },
            { value: 'radial', label: 'Gradient (radial)', selected: pat.bg_type === 'radial' },
          ] },
        { type: 'note', class: '', bare: true, style: caption, label: '🌊 Fluid mode (dynamic mesh)',
          condition: pat => !waveColors(pat) && fluid(pat) },
        { id: 'fluid_style', label: 'Fluid style (viscosity)', type: 'select', width: '60%',
          hint: 'Generates an endless, organically flowing vector animation.',
          style: 'margin-top:4px;', condition: pat => !waveColors(pat) && fluid(pat), options: pat => [
            { value: 'aurora', label: 'Aurora (gentle mesh, GentleRain)', selected: !pat.fluid_style || pat.fluid_style === 'aurora' },
            { value: 'gooey', label: 'Liquid (lava/water, WbONyK)', selected: pat.fluid_style === 'gooey' },
            { value: 'smoke', label: 'Smoke / fog', selected: pat.fluid_style === 'smoke' },
            { value: 'particles', label: 'Particles / stardust', selected: pat.fluid_style === 'particles' },
          ] },
        // Only the one colour of a solid pattern is on the drawing. A
        // gradient is a list of stops and a picture of its own.
        { type: 'note', class: '', bare: true, style: caption, framedWhen: 'paint',
          label: 'Colour and opacity are on the canvas while this one is selected '
               + '- use the buttons under its chip.' },
        { type: 'custom', condition: pat => !waveColors(pat),
          framedBy: pat => ((pat.bg_type || 'solid') === 'solid'
                            && pat.animation !== 'fluid' ? 'paint' : null),
          render: ctx => this._colorsBlock(ctx) },

        { id: 'gradient_angle', label: 'Angle (degrees)', type: 'range', min: 0, max: 360, int: true,
          placeholder: 90, style: 'margin-top:8px;', condition: angled },
        { id: 'opacity', label: 'Opacity (%)', type: 'range', min: 0, max: 100, int: true,
          placeholder: 100, framedBy: 'paint' },
      ] },

      { type: 'details', label: '📊 Data source for colour calculation',
        condition: pat => pat.bg_type === 'solid_gradient' && !fluid(pat), fields: [
          { id: 'global_id', label: 'Data source', type: 'select', layout: 'col',
            style: 'margin-bottom: 4px;', labelStyle: small,
            controlStyle: 'width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--divider-color); background: var(--card-background-color, #2b2b2b); color: var(--primary-text-color);',
            options: pat => this._sourceOptions(pat) },
          { type: 'custom', condition: pat => !pat.global_id || pat.global_id === 'manual',
            render: ctx => this._manualSource(ctx) },
          { type: 'group', class: 'row', style: 'margin-top:4px; gap:12px;', fields: [
            { id: 'gradient_entity_min', label: 'Min (0%)', type: 'number', layout: 'col',
              style: 'flex:1;', labelStyle: small, controlStyle: '', step: '0.1',
              value: pat => pat.gradient_entity_min ?? 0 },
            { id: 'gradient_entity_max', label: 'Max (100%)', type: 'number', layout: 'col',
              style: 'flex:1;', labelStyle: small, controlStyle: '', step: '0.1',
              value: pat => pat.gradient_entity_max ?? 100 },
          ] },
        ] },

      { type: 'details', label: '📍 Centre / origin', condition: radialCenter,
        hint: 'Tap or drag inside the box to freely move the origin point.', fields: [
        { type: 'custom', render: ctx => this._originPad(ctx) },
        { type: 'group', class: 'row', fields: [
          { id: 'radial_x', label: pat => 'X-axis (' + (pat.radial_x ?? 50) + '%)', type: 'range',
            layout: 'col', style: 'flex:1;margin-right:8px', labelStyle: 'font-size:10px',
            min: 0, max: 100, int: true, width: '100%', placeholder: 50 },
          { id: 'radial_y', label: pat => 'Y-axis (' + (pat.radial_y ?? 50) + '%)', type: 'range',
            layout: 'col', style: 'flex:1', labelStyle: 'font-size:10px',
            min: 0, max: 100, int: true, width: '100%', placeholder: 50 },
        ] },
      ] },

      { type: 'details', label: '⚙️ Condition: show background',
        hint: 'Without a condition the background is always visible.', fields: [
        { type: 'custom', render: ctx => this._conditionSelector(ctx, 'bg_condition') },
      ] },

      { type: 'details', label: '🎬 Animation & mode', fields: [
        { type: 'note', class: '', bare: true, style: caption, framedWhen: 'paint',
          label: 'The effect is on the canvas while this one is selected - it is the '
               + 'list under its chip.' },
        { id: 'animation', label: 'Effect', type: 'select', width: '60%', framedBy: 'paint',
          options: pat => PATTERN_ANIMATIONS.map(
            a => ({ ...a, selected: (pat.animation || 'none') === a.value })) },

        { type: 'group', class: 'row', condition: wobble,
          style: 'background:rgba(3,169,244,0.1); padding:8px; border-radius:6px; margin-top:4px;', fields: [
            { type: 'group', class: 'col', style: 'width:100%; gap:12px;', fields: [
              { id: 'wobble_amplitude', label: 'Start amplitude (contrast)', type: 'range',
                style: 'margin:0', min: 1, max: 100, int: true, placeholder: 100 },
              { id: 'wobble_freq', label: 'Range (spread)', type: 'range',
                style: 'margin:0', min: 1, max: 10, int: true, placeholder: 4 },
              { id: 'wobble_pause', label: 'Pause after effect (sec.)', type: 'range',
                style: 'margin:0', min: 0, max: 10, step: 0.5, placeholder: 2 },
            ] },
          ] },

        { id: 'anim_duration', type: 'range', min: 0.5, max: 20, step: 0.1, placeholder: 3,
          style: 'margin-top:4px', condition: pat => pat.animation !== 'none',
          label: pat => wobble(pat) ? 'Fade-out time (duration in sec.)' : 'Speed (sec.)' },
        { id: 'pump_scale', label: 'Pump expansion', type: 'range', min: 1.0, max: 1.2, step: 0.001,
          placeholder: 1.1, condition: isPump,
          hint: pat => pat.animation === 'pump_all'
            ? 'How far the whole thing grows at the top of each breath.'
            : 'How far the background grows behind the content, which stays where it is.' },
        { id: 'wave_invert', label: 'Reverse direction', type: 'checkbox', condition: waveOrRipple },
      ] },

      { type: 'details', label: '⚙️ Condition: run animation', condition: pat => pat.animation !== 'none',
        hint: 'Without a condition the animation is always active.', fields: [
        { type: 'custom', render: ctx => this._conditionSelector(ctx, 'anim_condition') },
      ] },
    ];
  }

  /** The corner radius, and the unit it is in. */
  _radiusRow(ctx) {
    const pat = ctx.entry;
    return html`
      <div class="row">
        <label>Corner radius (manual)</label>
        <div style="display:flex;width:60%;gap:4px">
          <input type="number" style="flex:1" .value=${pat.border_radius ?? ''}
                 @input=${e => ctx.set('border_radius', e.target.value)}>
          <select style="width:60px" @change=${e => ctx.set('border_radius_unit', e.target.value)}>
            <option value="px" ?selected=${pat.border_radius_unit === 'px'}>px</option>
            <option value="%" ?selected=${pat.border_radius_unit === '%'}>%</option>
          </select>
        </div>
      </div>`;
  }

  /** What an effect's two colours look like where they meet. */
  _wavePreview(ctx, angled) {
    const pat = ctx.entry;
    const c1 = pat.wave_c1 || '#03a9f4';
    const c2 = pat.wave_c2 || 'transparent';
    const bg = angled
      ? 'repeating-linear-gradient(' + (pat.gradient_angle ?? 90) + 'deg, ' + c1 + ' 0%, ' + c2 + ' 50%, ' + c1 + ' 100%)'
      : 'repeating-radial-gradient(circle at ' + (pat.radial_x ?? 50) + '% ' + (pat.radial_y ?? 50) + '%, ' + c1 + ' 0%, ' + c2 + ' 50%, ' + c1 + ' 100%)';
    return html`<div style="height:10px;border-radius:5px; background:${bg}"></div>`;
  }

  /**
   * The pattern's colours.
   *
   * A solid background is one colour, so it keeps the plain swatch; everything
   * else - a gradient, or the fluid mesh whose positions are blob radii - is a
   * stop list, and gets the shared editor.
   */
  _colorsBlock(ctx) {
    const pat = ctx.entry;
    const gradient = pat.bg_type !== 'solid' || pat.animation === 'fluid';
    const stopList = normalizeStops(
      pat.gradient_stops ?? { colors: pat.colors, stops: pat.stops }, { fill: false });
    const solidColor = solidColorOf(pat);
    // The preview strip is the one in the stop editor, so a pattern hands it
    // what it actually paints.
    const previewCss = patternPreviewCss(pat);
    const setSolid = value => ctx.setStops(solidColorPatch(pat, value).gradient_stops);

    return html`
      <div class="col"><label>Colours ${pat.animation === 'fluid' && gradient
          ? SC.tipDot("A position here is the blob's radius, not a place along a line.") : ''}</label>
        ${gradient ? html`
          <sc-gradient-stops .stops=${stopList} .previewCss=${previewCss}
            .onUpdate=${list => ctx.setStops(list)}></sc-gradient-stops>
        ` : html`
          <div class="color-list">
            <div class="color-item"><div class="color-item-row">
              <input type="color" .value=${solidColor} @input=${e => setSolid(e.target.value)}>
              <input type="text" .value=${solidColor} style="flex:1" @input=${e => setSolid(e.target.value)}>
            </div></div>
          </div>
        `}
      </div>`;
  }

  /** Where the value driving a dynamic colour comes from: an alias, or here. */
  _sourceOptions(pat) {
    const options = [{ value: 'manual', label: 'Manual selection',
                       selected: pat.global_id === 'manual' || !pat.global_id }];
    (this.slot?.global_entities || []).forEach(ge => {
      const stateObj = ge.entity ? this.hass.states[ge.entity] : null;
      const name = ge.alias || stateObj?.attributes?.friendly_name || ge.entity || 'Unnamed';
      let val = stateObj ? stateObj.state : '-';
      if (stateObj && ge.attribute && stateObj.attributes[ge.attribute] !== undefined) {
        val = stateObj.attributes[ge.attribute];
      }
      const uom = (!ge.attribute && stateObj?.attributes?.unit_of_measurement) ? ` ${stateObj.attributes.unit_of_measurement}` : '';
      const attrLabel = ge.attribute ? ` (${ge.attribute})` : '';
      options.push({ value: ge.id, selected: pat.global_id === ge.id,
                     label: `[${ge.alias || 'Alias'}] ${name}${attrLabel}: ${val}${uom}` });
    });
    return options;
  }

  /** An entity and an attribute of this pattern's own. */
  _manualSource(ctx) {
    const pat = ctx.entry;
    return html`
      <div style="background:rgba(0,0,0,0.15); padding:10px; border-radius:8px; border:1px solid var(--divider-color,#333);">
        <ha-selector .hass=${this.hass} .selector=${{entity:{}}}
          .value=${pat.gradient_entity||''} .label=${'Entity (value source)'}
          @value-changed=${e => ctx.set('gradient_entity', e.detail.value)}>
        </ha-selector>
        <div style="margin-top:8px;">
          <ha-selector .hass=${this.hass}
            .selector=${{attribute:{entity_id: pat.gradient_entity||''}}}
            .value=${pat.gradient_entity_attribute||''} .label=${'Attribute (optional)'}
            @value-changed=${e => ctx.set('gradient_entity_attribute', e.detail.value || undefined)}>
          </ha-selector>
        </div>
      </div>`;
  }

  /** The origin of a radial gradient, dragged in a box. */
  _originPad(ctx) {
    const pat = ctx.entry;
    return html`
      <div class="pos-preview-wrap">
        <div class="pos-preview"
          @pointerdown=${e => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            const updatePos = (ev) => {
              ev.stopPropagation();
              const rect = ev.currentTarget.getBoundingClientRect();
              let pctX = Math.round((Math.max(0,Math.min(ev.clientX-rect.left,rect.width)) / rect.width) * 100);
              let pctY = Math.round((Math.max(0,Math.min(ev.clientY-rect.top,rect.height)) / rect.height) * 100);
              if (pctX !== (pat.radial_x ?? 50) || pctY !== (pat.radial_y ?? 50)) {
                ctx.setMany({ radial_x: pctX, radial_y: pctY });
              }
            };
            updatePos(e);
            e.currentTarget.onpointermove = updatePos;
          }}
          @pointerup=${e => { e.stopPropagation(); e.currentTarget.onpointermove = null; e.currentTarget.releasePointerCapture(e.pointerId); }}
          @pointercancel=${e => { e.stopPropagation(); e.currentTarget.onpointermove = null; }}>
          <div class="pos-dot" style="left:${pat.radial_x ?? 50}%;top:${pat.radial_y ?? 50}%"></div>
        </div>
        <button class="icon-btn" title="Centre (50/50)"
          @click=${() => ctx.setMany({ radial_x: 50, radial_y: 50 })}>
          <ha-icon icon="mdi:crosshairs-gps" style="--mdc-icon-size:20px"></ha-icon>
        </button>
      </div>`;
  }

  /** Home Assistant's own condition editor, for one of the two conditions. */
  _conditionSelector(ctx, key) {
    return html`
      <ha-selector .hass=${this.hass} .selector=${{ condition: {} }} .value=${ctx.entry[key]}
        @value-changed=${e => ctx.set(key, e.detail.value)}>
      </ha-selector>`;
  }

  render() {
    if (!this.slot) return html``;
    const patterns = Array.isArray(this.slot.color_patterns) ? this.slot.color_patterns : [];
    const targets = getTargets(this.slot);
    const usedTargets = patterns.map(p => p.target).filter(t => t !== 'none');
    // The pattern a panel owns is edited there, so the list leaves that one
    // out rather than offering the same colour in two places.
    const owned = new Set();
    patterns.forEach(p => {
      if (hasOwnPanel(p.target, this.slot) && !owned.has(p.target)) owned.add(p.target);
    });
    const rows = patterns
      .map((pat, idx) => ({ pat, idx }))
      .filter(({ pat }) => !(owned.has(pat.target) && patterns.find(p => p.target === pat.target) === pat));

    // On a canvas every box is either an element with settings of its own or a
    // surface, and the card's own colour sits in Card & Dimensions - so this
    // list has nothing left to add and stays out of the menu. It comes back
    // only for what no panel can reach: a pattern pointed at an element that
    // has since gone, or one written before the panels existed.
    if (this.slot.canvas && !rows.length) return html``;

    return html`
      <details class="inner-section">
        <summary>🎨 Colours, Patterns &amp; Animations <span style="font-size:10px">▼</span></summary>
        <div class="inner-content">
          ${rows.map(({ pat, idx }) => {
            const isExp = !!this._expanded[pat.id];
            const targetLabel = targets.find(t => t.id === pat.target)?.label || 'Unknown target';

            return html`
              <div class="pattern-card">
                <div class="pattern-header" @click=${e => this._toggle(pat.id, e)}>
                  <div>
                    <span class="toggle-icon">${isExp ? '▼' : '▶'}</span>
                    <span style="color:${pat.enabled ? 'var(--primary-text-color)' : 'var(--secondary-text-color)'}">${pat.name || 'New pattern'}</span>
                    <span style="font-size:10px;color:${pat.target === 'none' ? '#f44' : 'var(--secondary-text-color)'};margin-left:8px;font-weight:normal">(${targetLabel})</span>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px">
                    <ha-switch .checked=${!!pat.enabled}
                      @click=${e => e.stopPropagation()}
                      @change=${e => { this._set(patterns, idx, 'enabled', e.target.checked); }}>
                    </ha-switch>

                    <button type="button" title="Clone" @click=${e => {
                      e.preventDefault();
                      e.stopPropagation();
                      const n = structuredClone(patterns);
                      const clone = structuredClone(pat);
                      clone.id = Date.now();
                      clone.target = 'none';
                      clone.name = (clone.name || 'Pattern') + ' (Copy)';
                      n.splice(idx + 1, 0, clone);
                      this._commit(n);
                      this._expanded = { ...this._expanded, [clone.id]: true };
                    }} style="background:none;border:none;color:var(--primary-color);cursor:pointer;padding:4px;font-size:14px;">⧉</button>

                    <button @click=${e => { e.stopPropagation(); const n = [...patterns]; n.splice(idx, 1); this._commit(n); }}
                      style="background:none;border:none;color:#f44;cursor:pointer;padding:4px">🗑</button>
                  </div>
                </div>

                ${isExp ? html`
                  <div class="pattern-content" style="display:flex; flex-direction:column; gap:8px;">
                    ${SC.renderFields(this._fields(), {
                      entry: pat, slot: this.slot, hass: this.hass, targets, usedTargets,
                      set: (key, value) => this._set(patterns, idx, key, value),
                      setMany: fields => {
                        const n = structuredClone(patterns);
                        Object.assign(n[idx], fields);
                        this._commit(n);
                      },
                      setStops: stops => this._setStops(patterns, idx, stops),
                    })}
                  </div>
                ` : ''}
              </div>
            `;
          })}
          <button class="add-btn" @click=${() => {
            const fresh = defaultColorPattern('none');
            this._commit([...patterns, fresh]);
            this._expanded = { ...this._expanded, [fresh.id]: true };
          }}>＋ Add new pattern</button>
        </div>
      </details>
    `;
  }
}

if (!customElements.get('sc-color-editor')) {
  customElements.define('sc-color-editor', ScColorEditor);
}

/**
 * One target's colour, drawn as a switch with the pattern's own settings under
 * it - the same shape the glass and the push panels have, and in the same
 * places: the card in Card & Dimensions, a surface in its element settings.
 *
 * A surface takes it `switchless`: a fold instead of a switch, because a box
 * that draws nothing else is already the answer to "is this painted?" - and
 * the pattern is written only when a control is actually touched, so the fold
 * standing open does not paint the surface orange.
 *
 * It is the list editor itself, showing one pattern instead of all of them:
 * the fields, the gradient editor and the condition selectors are written
 * there, and a second copy of them here would be a second thing to keep in
 * step. Only the name and the target are left out - a panel knows both.
 */
/**
 * The same field with the background Pump taken out of the effect list.
 *
 * That one scales the pattern layer, which is the whole of a card or a surface
 * but only the plate behind a gauge's ring or a bar's track - a pulsing
 * backdrop under an element that stands still. The whole-element Pump stays:
 * it scales the element's own box, so the ring or the track breathes with the
 * colour rather than in front of it. The other effects paint, so they read the
 * same wherever they are.
 *
 * @param {any} field
 */
/** Either pump: the background alone, or the whole thing it sits behind. */
const isPump = (/** @type {any} */ pat) => pat.animation === 'pump' || pat.animation === 'pump_all';

function dropPump(field) {
  if (Array.isArray(field.fields)) return { ...field, fields: field.fields.map(dropPump) };
  if (field.id !== 'animation') return field;
  // A pattern already set to Pump keeps it in the list: an option the select
  // cannot show is a select that reads as something the config does not say.
  const keep = (/** @type {any} */ o, /** @type {any} */ pat) =>
    o.value !== 'pump' || pat?.animation === 'pump';
  const options = typeof field.options === 'function'
    ? (/** @type {any} */ pat) => field.options(pat).filter((/** @type {any} */ o) => keep(o, pat))
    : (/** @type {any} */ pat) => field.options.filter((/** @type {any} */ o) => keep(o, pat));
  return { ...field, options };
}

class ScColorPanel extends ScColorEditor {
  static get properties() {
    return { slot: { type: Object }, hass: { type: Object }, commitFn: { type: Function },
             target: { type: String }, label: { type: String },
             switchless: { type: Boolean }, noPump: { type: Boolean },
             framed: { type: Array } };
  }

  static get styles() {
    return [ScColorEditor.styles[0], ScColorEditor.styles[1], css`
      .panel-switch { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .panel-body { margin-top: 8px; border-top: 1px dashed var(--divider-color, #444); padding-top: 8px;
                    display: flex; flex-direction: column; gap: 12px; }
      details.panel-fold > summary { cursor: pointer; list-style: none; font-weight: 500;
                                     display: flex; align-items: center; justify-content: space-between; }
      details.panel-fold > summary::-webkit-details-marker { display: none; }
    `];
  }

  _list() { return patternList(this.slot); }

  /** @param {Record<string, any>} patch */
  _apply(patch) { this._commit(patchPattern(this._list(), this.target, patch)); }

  /** @param {any[]} stops */
  _applyStops(stops) { this._commit(patchPatternStops(this._list(), this.target, stops)); }

  _switch(on) { this._apply({ enabled: on }); }

  render() {
    if (!this.slot || !this.target) return html``;
    const list = this._list();
    const idx = list.findIndex(p => p.target === this.target);
    const pat = idx < 0 ? null : list[idx];
    const on = !!pat?.enabled;
    let fields = this._fields().filter(f => f.id !== 'name' && f.id !== 'target');
    if (this.noPump) fields = fields.map(dropPump);
    const framed = new Set(Array.isArray(this.framed) ? this.framed : []);
    const body = (entry) => SC.renderFields(fields, {
      entry, slot: this.slot, hass: this.hass, framed,
      targets: getTargets(this.slot), usedTargets: [],
      set: (key, value) => this._apply({ [key]: value }),
      setMany: (fields2) => this._apply(fields2),
      setStops: (stops) => this._applyStops(stops),
    });

    if (this.switchless) {
      return html`
        <details class="panel-fold" open>
          <summary>${this.label || '🎨 Colour & pattern'} <span style="font-size:10px">▼</span></summary>
          <div class="panel-body">${body(pat || defaultColorPattern(this.target))}</div>
        </details>`;
    }

    return html`
      <div class="panel-switch">
        <label>${this.label || '🎨 Colour & pattern'}</label>
        <ha-switch .checked=${on} @change=${e => this._switch(e.target.checked)}></ha-switch>
      </div>
      ${on && pat ? html`<div class="panel-body">${body(pat)}</div>` : ''}
    `;
  }
}

if (!customElements.get('sc-color-panel')) {
  customElements.define('sc-color-panel', ScColorPanel);
}

class ScColorStyler extends LitElement {
  static get properties() {
    return { cssText: { type: String } };
  }

  createRenderRoot() { return this; }

  render() {
    return html`<style>${this.cssText || ''}</style>`;
  }
}

if (!customElements.get('sc-color-styler')) {
  customElements.define('sc-color-styler', ScColorStyler);
}

// --- THE MODULE ---
window.SupercardModules['color'] = window.SupercardModules['color'] || {};
Object.assign(window.SupercardModules['color'], (() => {

  const { sampleGradient } = window.SupercardUtils;

  function evaluateCondition(hass, c) {
    if (!c) return true;
    if (Array.isArray(c)) {
      if (c.length === 0) return true;
      return c.every(cond => evaluateCondition(hass, cond));
    }
    if (!c.condition) return true;
    try {
      if (c.condition === 'state') {
        const s = hass.states[c.entity_id];
        if (!s) return false;
        const val = c.attribute ? s.attributes[c.attribute] : s.state;
        return String(val).toLowerCase() === String(c.state).toLowerCase();
      }
      if (c.condition === 'numeric_state') {
        const s = hass.states[c.entity_id];
        if (!s) return false;
        const val = parseFloat(c.attribute ? s.attributes[c.attribute] : s.state);
        if (isNaN(val)) return false;
        if (c.above !== undefined && c.above !== '' && val <= parseFloat(c.above)) return false;
        if (c.below !== undefined && c.below !== '' && val >= parseFloat(c.below)) return false;
        return true;
      }
      if (c.condition === 'and') return (c.conditions || []).every(x => evaluateCondition(hass, x));
      if (c.condition === 'or')  return (c.conditions || []).some(x => evaluateCondition(hass, x));
      if (c.condition === 'not') {
        const inner = c.conditions && c.conditions.length > 0 ? c.conditions[0] : null;
        return inner ? !evaluateCondition(hass, inner) : true;
      }
    } catch (e) { return false; }
    return true;
  }

  function update({ hass, config }) {
    const patterns = Array.isArray(config.color_patterns) ? config.color_patterns : [];
    let styleStr = '';

    styleStr += `@keyframes sc-pattern-pulse {
      0%, 100% { opacity: var(--pat-op, 1); }
      50%       { opacity: calc(var(--pat-op, 1) * 0.3); }
    }\n`;

    // LAYER SYSTEM: cleanly set up the 500 range
    const hasMain = patterns.some(p => p.enabled && p.target === 'main');
    if (hasMain) {
      styleStr += `
        ha-card { position: relative !important; background: transparent !important; border: none !important; box-shadow: none !important; }
      \n`;
    }

    // Always anchor the base container at 500
    styleStr += `
      .supercard-container { position: relative !important; z-index: 500 !important; background: transparent !important; }
    \n`;

    patterns.forEach((pat, idx) => {
      if (!pat.enabled || pat.target === 'none') return;

      const bgActive   = (pat.bg_condition && Object.keys(pat.bg_condition).length > 0) ? evaluateCondition(hass, pat.bg_condition) : true;
      const animActive = (pat.anim_condition && Object.keys(pat.anim_condition).length > 0) ? evaluateCondition(hass, pat.anim_condition) : true;
      if (!bgActive) return;

      let selector = '';
      // The box the pattern paints behind, as opposed to the layer it paints.
      // Only the whole-card pump wants it: that one scales the thing itself,
      // content and all, where every other effect stays on `::before`.
      let boxSelector = '';
      const isMain = pat.target === 'main';

      if (isMain) {
        selector = 'ha-card::before';
        boxSelector = 'ha-card';
      } else {
        // A cell and a canvas element are the same kind of thing here: a box
        // the renderer names as a shadow part, whose ::before the pattern
        // paints. A canvas has no cells, so on a converted card the target is
        // an element id - the surface migration left behind for exactly this.
        const cell = pat.target.match(/^r(\d+)c(\d+)$/);
        if (cell) {
          const partSel = `sc-layout-renderer::part(cell-${cell[1]}-${cell[2]})`;
          selector = `${partSel}::before`;
          boxSelector = partSel;

          // CELL: gets z-index 510 as a solid foundation. No isolation hack needed anymore!
          styleStr += `
            ${partSel} {
              position: relative !important;
              z-index: 510 !important;
              background: transparent !important;
            }
          \n`;
        } else if (pat.target.startsWith('elm_')) {
          // No such foundation on a canvas, deliberately. Every element box is
          // already positioned and they all share one z-index, so the array
          // order is the stacking order - that is what the editor's forward and
          // backward buttons move. Lifting one box to 510 would drop a surface
          // on top of the gauges it was emitted underneath.
          boxSelector = SC.elementPartSelector(pat.target.slice(4));
          selector = `${boxSelector}::before`;
        }
      }
      if (!selector) return;

      let bgValue = 'transparent';
      let animValue = 'none';
      const speed = pat.anim_duration || 3;

      const isWaveOrRipple = ['ripple', 'waves'].includes(pat.animation);
      const isWobble       = ['wobble_radial', 'wobble_linear'].includes(pat.animation);
      const usesWaveColors = isWaveOrRipple || isWobble;

      let allowImportantOnBg = !isWaveOrRipple && !isWobble;

      const rx = pat.radial_x ?? 50;
      const ry = pat.radial_y ?? 50;

      if (usesWaveColors) {
        const count    = pat.wave_count || 3;
        const baseStep = 100 / count;
        const balance  = (pat.wave_balance ?? 50) / 100;
        const c1       = pat.wave_c1 || '#03a9f4';
        const c2       = pat.wave_c2 || 'transparent';

        if (isWobble) {
          const startAmp = (pat.wobble_amplitude ?? 100) / 100;
          const freqMod  = pat.wobble_freq ?? 4;
          const pause    = pat.wobble_pause ?? 2;

          const activeDuration = speed;
          const totalDuration  = activeDuration + pause;
          const activePct      = activeDuration / totalDuration;

          bgValue = c2;

          if (animActive) {
            const animName = `sc-anim-wobble-${pat.id}-${idx}`;
            let kf = `@keyframes ${animName} {\n`;

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
                if (pat.animation === 'wobble_linear') {
                    const mask = `linear-gradient(${pat.gradient_angle ?? 90}deg, transparent ${fadeStart}%, ${c2} ${spreadPct}%)`;
                    const wave = `repeating-linear-gradient(${pat.gradient_angle ?? 90}deg, ${activeColor} ${s1}%, ${c2} ${s2}%, ${activeColor} ${s3}%)`;
                    bgStr = `${mask}, ${wave}`;
                } else {
                    const mask = `radial-gradient(circle at ${rx}% ${ry}%, transparent ${fadeStart}%, ${c2} ${spreadPct}%)`;
                    const wave = `repeating-radial-gradient(circle at ${rx}% ${ry}%, ${activeColor} ${s1}%, ${c2} ${s2}%, ${activeColor} ${s3}%)`;
                    bgStr = `${mask}, ${wave}`;
                }

                kf += `  ${kfPercent}% { background: ${bgStr}; }\n`;
            }
            if (pause > 0) { kf += `  100% { background: ${c2}; }\n`; }
            kf += `}\n`;

            styleStr += kf;
            animValue = `${animName} ${totalDuration}s infinite linear`;
          }
        } else {
          if (animActive && pat.animation !== 'none') {
            const animName = `sc-anim-wave-${pat.id}-${idx}`;
            let kf = `@keyframes ${animName} {\n`;
            for (let i = 0; i <= 100; i += (100 / 240)) {
              const phase = pat.wave_invert ? (1 - i / 100) : (i / 100);
              const shift = phase * baseStep;
              const s1 = shift.toFixed(2);
              const s2 = (shift + baseStep * balance).toFixed(2);
              const s3 = (shift + baseStep).toFixed(2);
              const bg = pat.animation === 'waves'
                ? `repeating-linear-gradient(${pat.gradient_angle || 90}deg, ${c1} ${s1}%, ${c2} ${s2}%, ${c1} ${s3}%)`
                : `repeating-radial-gradient(circle at ${rx}% ${ry}%, ${c1} ${s1}%, ${c2} ${s2}%, ${c1} ${s3}%)`;
              kf += `  ${i.toFixed(2)}% { background: ${bg}; }\n`;
            }
            kf += `}\n`;
            styleStr += kf;
            animValue = `${animName} ${speed}s infinite linear`;
          }
          bgValue = pat.animation === 'waves'
            ? `repeating-linear-gradient(${pat.gradient_angle || 90}deg, ${c1} 0%, ${c2} ${baseStep * balance}%, ${c1} ${baseStep}%)`
            : `repeating-radial-gradient(circle at ${rx}% ${ry}%, ${c1} 0%, ${c2} ${baseStep * balance}%, ${c1} ${baseStep}%)`;
        }

      } else {
        // One list, whichever shape the pattern was saved in. `fill: false`
        // keeps "nobody positioned this" visible: CSS spreads such a colour
        // itself, and the fluid blobs below read the absence as their own
        // default radius rather than as a position.
        const stopList = normalizeStops(
          pat.gradient_stops ?? { colors: pat.colors, stops: pat.stops }, { fill: false });
        const list         = stopList.length ? stopList : [{ pos: null, color: '#000000' }];
        const safeColors   = list.map(st => st.color);
        const stops        = list.map(st => st.pos ?? undefined);
        const colorStopsStr = stopsToCss(list);

        if (pat.animation === 'fluid') {
          const isGooey = pat.fluid_style === 'gooey';
          const isSmoke = pat.fluid_style === 'smoke';
          const isParticles = pat.fluid_style === 'particles';
          const isAurora = !isGooey && !isSmoke && !isParticles;

          let svg = `<svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%' preserveAspectRatio='none'>`;
          svg += `<defs>`;

          if (isGooey) {
            svg += `<filter id='goo_${pat.id}'>
                      <feGaussianBlur in='SourceGraphic' stdDeviation='15' result='blur'/>
                      <feColorMatrix in='blur' mode='matrix' values='1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 30 -12' result='goo'/>
                    </filter>`;
          } else if (isSmoke) {
            svg += `<filter id='smoke_${pat.id}' x='-20%' y='-20%' width='140%' height='140%'>
                      <feTurbulence type='fractalNoise' baseFrequency='0.015' numOctaves='3' result='noise'/>
                      <feDisplacementMap in='SourceGraphic' in2='noise' scale='40' xChannelSelector='R' yChannelSelector='G'/>
                      <feGaussianBlur stdDeviation='12' result='blur'/>
                      <feComponentTransfer><feFuncA type='linear' slope='0.8'/></feComponentTransfer>
                    </filter>`;
          } else if (isAurora) {
            const actualCount = Math.max(4, safeColors.length);
            for (let i = 0; i < actualCount; i++) {
              const cHex = safeColors[i % safeColors.length];
              svg += `<radialGradient id='gf_${pat.id}_${i}' cx='50%' cy='50%' r='50%'>
                        <stop offset='0%' stop-color='${cHex}' stop-opacity='1'/>
                        <stop offset='100%' stop-color='${cHex}' stop-opacity='0'/>
                      </radialGradient>`;
            }
          }
          svg += `</defs>`;
          svg += `<rect width='100%' height='100%' fill='${safeColors[0]}'/>`;

          const rnd = (seed) => { let x = Math.sin(seed) * 10000; return x - Math.floor(x); };

          if (isParticles || isSmoke) {
            const pCount = isSmoke ? 12 : 80;

            if (isSmoke) svg += `<g filter='url(#smoke_${pat.id})'>`;

            for (let i = 0; i < pCount; i++) {
              const cIdx = Math.floor(rnd(i) * safeColors.length);
              const cHex = safeColors[cIdx];

              const startX = rnd(i + 10) * 120 - 10;
              const sway   = isSmoke ? (rnd(i + 20) * 40 - 20) : (rnd(i + 20) * 6 - 3);
              const baseR  = isSmoke ? (20 + rnd(i + 30) * 30) : (0.1 + rnd(i + 30) * 0.4);
              const durY   = (speed * 1.5) + rnd(i + 40) * (speed * 3);
              const durX   = (speed * 2) + rnd(i + 50) * (speed * 2);
              const offset = rnd(i + 60) * -20;
              const baseOp = isSmoke ? (0.4 + rnd(i+70) * 0.6) : (0.6 + rnd(i+70) * 0.4);

              const animOpValues = isParticles
                ? `0; ${baseOp}; ${baseOp*0.2}; ${baseOp}; 0; ${baseOp*0.8}; 0`
                : `0; ${baseOp}; ${baseOp}; 0`;

              if (animActive) {
                svg += `<circle fill='${cHex}' cx='${startX}%' cy='120%' r='${baseR}%' opacity='0'>
                          <animate attributeName='cy' values='120%; -20%' dur='${durY}s' begin='${offset}s' repeatCount='indefinite'/>
                          <animate attributeName='cx' values='${startX}%; ${startX + sway}%; ${startX}%' dur='${durX}s' begin='${offset}s' repeatCount='indefinite'/>
                          <animate attributeName='opacity' values='${animOpValues}' dur='${durY}s' begin='${offset}s' repeatCount='indefinite'/>
                        </circle>`;
              } else {
                svg += `<circle fill='${cHex}' cx='${startX + sway/2}%' cy='${100 - rnd(i)*100}%' r='${baseR}%' opacity='${baseOp}'/>`;
              }
            }

            if (isSmoke) svg += `</g>`;

          } else {
            const actualCount = Math.max(4, safeColors.length);
            if (isGooey) svg += `<g filter='url(#goo_${pat.id})'>`;

            const pX = [11, 13, 17, 19, 23, 29, 31, 37];
            const pY = [13, 17, 19, 23, 29, 31, 37, 41];
            const pR = [17, 19, 23, 29, 31, 37, 41, 43];

            for (let i = 0; i < actualCount; i++) {
              const cIdx = i % safeColors.length;
              const cHex = safeColors[cIdx];
              const rBase = stops[cIdx] !== undefined ? stops[cIdx] : (isGooey ? 25 : 60);

              const durX = pX[i % pX.length] * (speed / 5);
              const durY = pY[i % pY.length] * (speed / 5);
              const durR = pR[i % pR.length] * (speed / 5);

              const x1 = 10 + (i * 15) % 80; const x2 = 80 - (i * 25) % 70; const x3 = 50 + (i * 35) % 40;
              const y1 = 10 + (i * 25) % 80; const y2 = 80 - (i * 15) % 70; const y3 = 50 + (i * 45) % 40;

              const vX = `${x1}%; ${x2}%; ${x3}%; ${x1}%`;
              const vY = `${y1}%; ${y2}%; ${y3}%; ${y1}%`;
              const vR = `${rBase}%; ${rBase * 1.3}%; ${rBase * 0.8}%; ${rBase}%`;

              const fill = isGooey ? cHex : `url(#gf_${pat.id}_${i})`;

              if (animActive) {
                  svg += `<circle fill='${fill}' cx='${x1}%' cy='${y1}%' r='${rBase}%'>
                            <animate attributeName='cx' values='${vX}' dur='${durX}s' repeatCount='indefinite'/>
                            <animate attributeName='cy' values='${vY}' dur='${durY}s' repeatCount='indefinite'/>
                            <animate attributeName='r' values='${vR}' dur='${durR}s' repeatCount='indefinite'/>
                          </circle>`;
              } else {
                  svg += `<circle fill='${fill}' cx='${x1}%' cy='${y1}%' r='${rBase}%'/>`;
              }
            }
            if (isGooey) svg += `</g>`;
          }

          svg += `</svg>`;
          const encodedSvg = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
          bgValue = `url("${encodedSvg}")`;

        } else {
          // --- STANDARD / GRADIENT LOGIC ---
          if (pat.bg_type === 'solid' || pat.bg_type === 'solid_gradient') bgValue = safeColors[0];
          else if (pat.bg_type === 'linear') bgValue = `linear-gradient(${pat.gradient_angle || 90}deg, ${colorStopsStr})`;
          else if (pat.bg_type === 'radial') bgValue = `radial-gradient(circle at ${rx}% ${ry}%, ${colorStopsStr})`;

          if (pat.bg_type === 'solid_gradient') {

            const { entity: resolvedEntity, attribute: resolvedAttribute } =
              SC.resolveAlias(config.global_entities, pat, 'gradient_entity', 'gradient_entity_attribute');

            if (resolvedEntity) {
              const _ges = hass.states[resolvedEntity];
              if (_ges) {
                const _gattr = resolvedAttribute;
                const _graw = _gattr ? _ges.attributes[_gattr] : _ges.state;
                const _gval = parseFloat(_graw);
                const _gmin = parseFloat(pat.gradient_entity_min ?? 0);
                const _gmax = parseFloat(pat.gradient_entity_max ?? 100);

                if (!isNaN(_gval)) {
                  const _pct = Math.max(0, Math.min(1, (_gval - _gmin) / (_gmax - _gmin || 1)));
                  const _dynStops = safeColors.map((col, i) => ({
                    color: col,
                    pos: stops[i] !== undefined ? stops[i] : Math.round((100 / (safeColors.length - 1 || 1)) * i)
                  }));
                  bgValue = sampleGradient(_dynStops, _pct);
                }
              }
            }
          }

          if (animActive && pat.animation !== 'none') {
            if (pat.animation === 'pulse') {
              animValue = `sc-pattern-pulse ${speed}s infinite ease-in-out`;
            }
            if (pat.animation === 'pump') {
              const pScale   = pat.pump_scale || 1.1;
              const pumpName = `sc-anim-pump-${pat.id}-${idx}`;
              styleStr += `@keyframes ${pumpName} {
  0%, 100% { transform: scale(1); opacity: var(--pat-op, 1); }
  50%       { transform: scale(${pScale}); opacity: calc(var(--pat-op, 1) * 0.6); }
}\n`;
              animValue = `${pumpName} ${speed}s infinite ease-in-out`;
            }
            // The whole thing breathes, not the backdrop behind it. The scale
            // goes on the box, so the pattern layer - a child of it - is
            // carried along rather than animated on its own, and the content
            // travels with the colour instead of standing still inside a
            // flickering one. No opacity in it: fading the content is not
            // what a card growing and shrinking does.
            if (pat.animation === 'pump_all' && boxSelector) {
              const pScale   = pat.pump_scale || 1.1;
              const pumpName = `sc-anim-pump-all-${pat.id}-${idx}`;
              styleStr += `@keyframes ${pumpName} {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(${pScale}); }
}\n`;
              // `transform` on the box would otherwise be whatever the
              // renderer left there, and a canvas element carries none - the
              // box is placed with insets, which is what makes this safe.
              styleStr += `${boxSelector} {
  transform-origin: center center;
  animation: ${pumpName} ${speed}s infinite ease-in-out;
  will-change: transform;
}\n`;
            }
          }
        }
      }

      const op = (pat.opacity ?? 100) / 100;
      let isAutoBorder = pat.border_radius_auto;
      if (isAutoBorder === undefined) isAutoBorder = isMain;

      let borderRadius = 'inherit';
      if (isAutoBorder) {
        if (isMain) {
          // The card's own corner, in whatever shape and unit it is set: a
          // full-card pattern that guessed at it would paint over the corner.
          borderRadius = SC.cardRadius(config) ?? 'var(--ha-card-border-radius, 12px)';
        } else {
          borderRadius = 'inherit';
        }
      } else if (pat.border_radius !== undefined && pat.border_radius !== '') {
        borderRadius = `${pat.border_radius}${pat.border_radius_unit || 'px'}`;
      }

      // EXACT ASSIGNMENT HERE:
      // 200 = BG_ANIMATED (for the main card)
      // 520 = sub-container background (exactly between 510 and the 700-range texts!)
      const zIndex = isMain ? '200' : '-1';
      const bgImp  = allowImportantOnBg ? ' !important' : '';

      const bgSizeStr = pat.animation === 'fluid' ? 'background-size: 115% 115% !important;' : 'background-size: 100% 100% !important;';
      const bgPosStr  = 'background-position: center !important;';
      const bgRepStr  = 'background-repeat: no-repeat !important;';

      styleStr += `${selector} {
  content: "" !important;
  display: block !important;
  position: absolute !important;
  inset: 0 !important;
  background: ${bgValue}${bgImp};
  ${bgSizeStr}
  ${bgPosStr}
  ${bgRepStr}
  opacity: ${op};
  --pat-op: ${op};
  animation: ${animValue};
  z-index: ${zIndex} !important;
  border-radius: ${borderRadius} !important;
  pointer-events: none !important;
  will-change: transform, opacity;
}\n`;

    });

    return {
      cssVars: {},
      classes: { add: [], remove: ['uc-bg-active', 'uc-frame-active', 'uc-animate'] },
      litOverlay: html`<style>${styleStr}</style>`
    };
  }

  function renderCustomBlock(commitFn, hass, slot) {
    return html`<sc-color-editor .slot=${slot} .hass=${hass} .commitFn=${commitFn}></sc-color-editor>`;
  }

  function editorFields() { return []; }

  return /** @type {SupercardModule} */ ({ update, renderCustomBlock, editorFields });
})());
