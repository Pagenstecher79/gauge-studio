import { LitElement, html, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { normalizeStops, stopsToCss } from "./gradient-stops.js";
import { BEND_ROOM, bendsOf, bendClipPath, bendEscapes } from "./canvas-bend.js";
import { icon } from "./icons.js";
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

      { type: 'details', icon: icon('palette'), label: 'Design & Colours', style: 'margin: 4px 0 0 0;', fields: [
        { type: 'note', class: '', bare: true, style: caption, framedWhen: 'corners',
          label: 'The corners are on the canvas - drag either grip, at the bottom '
               + 'left or the top right.' },
        // The side grips are switched off on the canvas (`sides` on the
        // surface kind), so the line that pointed at them would be pointing
        // at nothing. It goes back in with them.
        { id: 'border_radius_auto', label: 'Automatic corner radius', type: 'checkbox',
          value: autoBorder, framedBy: 'corners' },
        { id: 'border_radius', label: 'Corner radius (manual)', type: 'length',
          unitId: 'border_radius_unit', width: '60%', framedBy: 'corners',
          condition: pat => !autoBorder(pat) },

        { id: 'wave_count', label: 'Count (density)', type: 'range', min: 1, max: 20, int: true,
          placeholder: 3, condition: waveColors, framedBy: 'paint',
          hint: 'The colours are calculated dynamically by the effect.' },
        { id: 'wave_balance', label: 'Balance (peak vs. trough)', type: 'range', min: 5, max: 95,
          int: true, placeholder: 50, condition: waveColors, framedBy: 'paint' },
        { id: 'wave_c1', label: 'Line/wave colour (peak)', type: 'color', fallback: '#03a9f4',
          textFallback: true, condition: waveColors, framedBy: 'paint' },
        { id: 'wave_c2', label: 'Background colour (trough)', type: 'color', fallback: 'transparent',
          textFallback: true, condition: waveColors, framedBy: 'paint' },
        { type: 'note', class: '', bare: true, style: caption, label: 'Gradient preview', condition: waveColors },
        { type: 'custom', condition: waveColors, render: ctx => this._wavePreview(ctx, angled(ctx.entry)) },

        { id: 'bg_type', label: 'Background type', type: 'select', width: '60%',
          framedBy: 'paint',
          condition: pat => !waveColors(pat) && !fluid(pat), options: pat => [
            { value: 'solid', label: 'Solid (static)', selected: pat.bg_type === 'solid' },
            { value: 'solid_gradient', label: 'Solid (dynamic from gradient)', selected: pat.bg_type === 'solid_gradient' },
            { value: 'linear', label: 'Gradient (linear)', selected: pat.bg_type === 'linear' },
            { value: 'radial', label: 'Gradient (radial)', selected: pat.bg_type === 'radial' },
          ] },
        { type: 'note', class: '', bare: true, style: caption, icon: icon('waves'), label: 'Fluid mode (dynamic mesh)',
          condition: pat => !waveColors(pat) && fluid(pat) },
        { id: 'fluid_style', label: 'Fluid style (viscosity)', type: 'select', width: '60%',
          hint: 'Generates an endless, organically flowing vector animation.',
          framedBy: 'paint',
          style: 'margin-top:4px;', condition: pat => !waveColors(pat) && fluid(pat), options: pat => [
            { value: 'aurora', label: 'Aurora (gentle mesh, GentleRain)', selected: !pat.fluid_style || pat.fluid_style === 'aurora' },
            { value: 'gooey', label: 'Liquid (lava/water, WbONyK)', selected: pat.fluid_style === 'gooey' },
            { value: 'smoke', label: 'Smoke / fog', selected: pat.fluid_style === 'smoke' },
            { value: 'particles', label: 'Particles / stardust', selected: pat.fluid_style === 'particles' },
          ] },
        // All of it, not the solid colour alone: a surface *is* what it is
        // painted with, and a type, an angle and an effect on the drawing
        // with the colours left down here is the split the frames exist to
        // end. So the stop list goes up too, small editor though it is.
        { type: 'note', class: '', bare: true, style: caption, framedWhen: 'paint',
          label: 'Every colour setting is on the canvas while this one is selected '
               + '- the type, the colours, the angle, the effect and the opacity, '
               + 'under its chip. Drag the corner of that menu to make room.' },
        { type: 'custom', condition: pat => !waveColors(pat), framedBy: 'paint',
          render: ctx => this._colorsBlock(ctx) },

        { id: 'gradient_angle', label: 'Angle (degrees)', type: 'range', min: 0, max: 360, int: true,
          placeholder: 90, style: 'margin-top:8px;', condition: angled, framedBy: 'paint' },
        { id: 'opacity', label: 'Opacity (%)', type: 'range', min: 0, max: 100, int: true,
          placeholder: 100, framedBy: 'paint' },
      ] },

      { type: 'details', icon: icon('chart-column'), label: 'Data source for colour calculation',
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

      // The pad is a better control than the two sliders that stand in for
      // it on the canvas - but a second live control for the same pair of
      // numbers is worse than a coarser one in the right place, so the whole
      // fold goes while the paint is in hand.
      { type: 'details', icon: icon('crosshair'), label: 'Centre / origin', condition: radialCenter,
        framedBy: 'paint',
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

      { type: 'details', icon: icon('settings'), label: 'Condition: show background',
        hint: 'Without a condition the background is always visible.', fields: [
        { type: 'custom', render: ctx => this._conditionSelector(ctx, 'bg_condition') },
      ] },

      { type: 'details', icon: icon('clapperboard'), label: 'Animation & mode', fields: [
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

      { type: 'details', icon: icon('settings'), label: 'Condition: run animation', condition: pat => pat.animation !== 'none',
        hint: 'Without a condition the animation is always active.', fields: [
        { type: 'custom', render: ctx => this._conditionSelector(ctx, 'anim_condition') },
      ] },
    ];
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
          <span style="font-size:20px; display:inline-flex;">${icon('crosshair')}</span>
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
        <summary>${icon('palette')} Colours, Patterns &amp; Animations <span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('chevron-down')}</span></summary>
        <div class="inner-content">
          ${rows.map(({ pat, idx }) => {
            const isExp = !!this._expanded[pat.id];
            const targetLabel = targets.find(t => t.id === pat.target)?.label || 'Unknown target';

            return html`
              <div class="pattern-card">
                <div class="pattern-header" @click=${e => this._toggle(pat.id, e)}>
                  <div>
                    <span class="toggle-icon">${icon(isExp ? 'chevron-down' : 'chevron-right')}</span>
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
                    }} style="background:none;border:none;color:var(--primary-color);cursor:pointer;padding:4px;font-size:14px;">${icon('copy')}</button>

                    <button @click=${e => { e.stopPropagation(); const n = [...patterns]; n.splice(idx, 1); this._commit(n); }}
                      style="background:none;border:none;color:#f44;cursor:pointer;padding:4px">${icon('trash-2')}</button>
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
          }}>${icon('plus')} Add new pattern</button>
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
          <summary>${icon('palette')} ${this.label || 'Colour & pattern'} <span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('chevron-down')}</span></summary>
          <div class="panel-body">${body(pat || defaultColorPattern(this.target))}</div>
        </details>`;
    }

    return html`
      <div class="panel-switch">
        <label>${icon('palette')} ${this.label || 'Colour & pattern'}</label>
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

// --- THE EDITOR HALF OF THE MODULE ---
window.SupercardModules['color'] = window.SupercardModules['color'] || {};
Object.assign(window.SupercardModules['color'], (() => {

  function renderCustomBlock(commitFn, hass, slot) {
    return html`<sc-color-editor .slot=${slot} .hass=${hass} .commitFn=${commitFn}></sc-color-editor>`;
  }

  function editorFields() { return []; }

  return /** @type {SupercardModule} */ ({ renderCustomBlock, editorFields });
})());
