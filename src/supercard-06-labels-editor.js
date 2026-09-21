import { LitElement, html, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { icon } from "./icons.js";

const SC = window.SupercardUtils;

/**
 * What a label is before anyone configures it.
 *
 * The canvas adds labels too, and it has no business knowing what one
 * contains - that is this module's, so both add buttons ask here. The id is
 * the label's own, used for its name and for remembering which card is open;
 * it is not the `label_N` the canvas and every target list go by, which is
 * the index in `labels_list`.
 */
function newEntry() {
  return {
    id: Date.now(), label_text: '', enabled: true,
    use_entity: false, show_name: true, use_override: false,
    use_icon: false, icon: '', icon_position: 'before',
    icon_color: '', icon_size: '', icon_gap: null,
    decimals: null, text_shadow: false, use_indicator: false,
    indicator_shape: 'rect', indicator_visibility: 'always'
  };
}

class ScLabelsEditor extends LitElement {
  static get properties() {
    return {
      slot:       { type: Object },
      commitFn:   { type: Function },
      hass:       { type: Object },
      only:       { type: Number },
      /*
       * Set by the canvas editor when the box this label is drawn in sizes
       * the label itself. The size fields are then not merely unused, they
       * are misleading: whatever is typed there changes nothing.
       */
      boxSized:   { type: Boolean },
      _expanded:  { type: Object, state: true },
      _outerOpen: { state: true }
    };
  }

  constructor() {
    super();
    this._expanded = {};
  }

  static get styles() {
    return [SC.editorStyles, css`
      .col { gap: 4px; }
      .fx-slot { margin: 8px 0; padding: 8px; border-radius: 6px;
                 background: rgba(255,255,255,0.03); border: 1px solid var(--divider-color,#555); }
      .add-btn { padding: 8px; }
      .toggle-icon { margin-right: 6px; }
      .section-title { margin-top: 4px; margin-bottom: 0; }
      input[type="text"], input[type="number"], select { box-sizing: border-box; }
      .label-card { background: var(--secondary-background-color, #1e1e1e); border: 1px solid var(--divider-color, #444); border-radius: 8px; padding: 8px; margin-bottom: 8px; }
      .label-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; cursor: pointer; }
      .label-content { display: flex; flex-direction: column; gap: 10px; padding-top: 10px; margin-top: 8px; border-top: 1px solid var(--divider-color, #333); }
      .header-val { color: var(--primary-color, #03a9f4); font-family: monospace; font-weight: bold; margin-left: 8px; background: rgba(3,169,244,0.1); padding: 2px 4px; border-radius: 3px; }
      ha-icon-picker { width: 100%; }
      .color-row input[type="color"] { width: 36px; height: 30px; padding: 0; border: none; background: none; cursor: pointer; }
      .icon-preview { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--secondary-text-color); margin-top: 2px; }
      .clear-btn { background: rgba(255, 50, 50, 0.1); border: 1px solid rgba(255, 50, 50, 0.3); color: #f44; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex-shrink: 0; transition: all 0.2s; }
      .clear-btn:hover { background: rgba(255, 50, 50, 0.2); }
    `];
  }

  _commit(newList) {
    if (this.commitFn) this.commitFn('__merge__', { labels_list: newList });
  }

  /** Commit `list` with one field of entry `idx` changed. */
  _set(list, idx, key, value) { this._commit(SC.withPatch(list, idx, key, value)); }

  _getLabelTitle(item) {
    let name = item.label_text || '';
    let valStr = '';

    // --- ALIAS DETECTION IN HEADER ---
    const { entity: resolvedEntity, attribute: resolvedAttribute, match: aliasObj } =
      SC.resolveAlias(this.slot?.global_entities, item);
    const isAlias = !!aliasObj;

    if (item.use_entity && resolvedEntity && this.hass?.states[resolvedEntity]) {
      const s = this.hass.states[resolvedEntity];
      let val = resolvedAttribute ? s.attributes[resolvedAttribute] : s.state;

      if (item.decimals !== undefined && item.decimals !== null && val !== undefined && val !== null && val !== '') {
        const parsed = parseFloat(val);
        if (!isNaN(parsed)) val = parsed.toFixed(item.decimals);
      }

      const uom = (!resolvedAttribute && s.attributes.unit_of_measurement) ? ` ${s.attributes.unit_of_measurement}` : '';
      valStr = `${val}${uom}`;

      if (!name) {
        if (isAlias) {
           name = `[${aliasObj.alias || 'Alias'}] ${s.attributes.friendly_name || resolvedEntity}`;
           if (resolvedAttribute) name += ` (${resolvedAttribute})`;
        } else if (!item.use_override) {
           name = s.attributes.friendly_name || resolvedEntity;
        }
      }
    } else if (!name) {
      if (isAlias) {
        name = `[${aliasObj.alias || 'Alias'}] ${resolvedEntity || 'Unnamed'}`;
      } else {
        name = `Label ${item.id.toString().slice(-3)}`;
      }
    }

    const iconPrev = item.use_icon && item.icon
      ? html`<ha-icon icon=${item.icon} style="--mdc-icon-size:14px;opacity:0.7;margin-right:4px;"></ha-icon>`
      : '';

    return html`
      <span class="toggle-icon">${icon(this._expanded[item.id] ? 'chevron-down' : 'chevron-right')}</span>
      <div style="display:flex;align-items:center;">
        ${iconPrev}
        ${name}
        ${valStr ? html`<span class="header-val">${valStr}</span>` : ''}
      </div>
    `;
  }

  /**
   * One label, as the card its own section lists.
   */
  _renderLabelCard(item, idx, list) {
    return html`
            <div class="label-card">
              <div class="label-header" @click=${() => this._expanded = {...this._expanded, [item.id]: !this._expanded[item.id]}}>
                ${this._getLabelTitle(item)}
                <div style="display:flex;align-items:center;gap:8px">
                  <ha-switch .checked=${!!item.enabled}
                    @click=${e => e.stopPropagation()}
                    @change=${e => { this._set(list, idx, 'enabled', e.target.checked); }}>
                  </ha-switch>
                  <button @click=${e => { e.stopPropagation(); const n = [...list]; n.splice(idx, 1); this._commit(n); }}
                    style="background:none;border:none;color:#f44;cursor:pointer;padding:4px">${icon('trash-2')}</button>
                </div>
              </div>

              ${this._expanded[item.id] ? this._renderLabelContent(item, idx, list) : ''}
            </div>`;
  }

  /**
   * One label's fields, without the card around them.
   *
   * A field array, like the gauge's and the bar's: a field is a record, and
   * the shared renderer turns it into a control. The blocks that are not a
   * field at all - the manual entity box, the icon preview, the indicator's
   * trigger with its datalist - hand the markup back through `custom`.
   */
  _fields() {
    const withEntity = item => !!item.use_entity;
    const withIcon = item => !!item.use_icon;
    return [
      { id: 'label_text', label: 'Manual text / label', type: 'text', placeholder: 'e.g. Temperature' },
      { id: 'use_entity', label: 'Link entity', type: 'checkbox' },

      { id: 'global_id', label: 'Data source', type: 'select', layout: 'col',
        style: 'margin-top: 4px; margin-bottom: 4px;', controlStyle: 'width: 100%;',
        condition: withEntity, options: item => this._sourceOptions(item) },
      { type: 'custom', render: ctx => this._manualSource(ctx),
        condition: item => item.use_entity && (!item.global_id || item.global_id === 'manual') },

      { id: 'decimals', label: 'Decimals', type: 'number', width: '60px',
        min: 0, max: 5, placeholder: 'Auto', int: true, condition: withEntity },
      { id: 'show_name', label: 'Show label / entity name', type: 'checkbox',
        value: item => item.show_name !== false, condition: withEntity },
      { id: 'use_override', label: 'Use manual text as name (override)', type: 'checkbox',
        condition: item => item.use_entity && item.show_name !== false },

      { id: 'text_shadow', label: 'Text shadow (glow/shadow)', type: 'checkbox' },

      { type: 'heading', label: 'Icon' },
      { id: 'use_icon', label: 'Show icon', type: 'checkbox' },
      { type: 'custom', condition: withIcon, render: ctx => this._iconPicker(ctx) },
      { id: 'icon_position', label: 'Position', type: 'select', width: '55%', condition: withIcon,
        options: item => [
          { value: 'before', label: 'Before text', selected: (item.icon_position || 'before') === 'before' },
          { value: 'after', label: 'After text', selected: item.icon_position === 'after' },
          { value: 'only', label: 'Icon only (no text)', selected: item.icon_position === 'only' },
        ] },
      { id: 'icon_color', label: 'Icon colour', type: 'color', fallback: '#ffffff',
        placeholder: 'Empty = inherit', condition: withIcon },
      // On a box that sizes the label itself, a size here would change nothing.
      { type: 'note', class: 'tip', condition: item => item.use_icon && this.boxSized,
        labelStyle: 'font-size:11px;color:var(--secondary-text-color)',
        label: 'The icon takes the size of its box, because "Fill the box" is on for this element.' },
      { id: 'icon_size', label: 'Icon size (CSS)', type: 'text', layout: 'row', width: '80px',
        placeholder: '20px, 50cqmin', condition: item => item.use_icon && !this.boxSized },
      { id: 'icon_gap', label: 'Gap to text (px)', type: 'number', width: '60px',
        placeholder: '4', int: true, blankZero: true, condition: withIcon },

      { type: 'heading', label: 'Indicator & Container' },
      { id: 'use_indicator', label: 'Use as indicator (container)', type: 'checkbox' },
      ...this._indicatorFields(),

      { type: 'custom', render: ctx => html`
        <div class="fx-slot">
          <sc-fx-glass-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                             .target=${'elm_label_' + ctx.idx}></sc-fx-glass-panel>
        </div>` },
      { type: 'custom', render: ctx => html`
        <div class="fx-slot">
          <sc-push-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                         .target=${'label_' + ctx.idx}></sc-push-panel>
        </div>` },
    ];
  }

  /** The indicator block: its trigger, its shape, and its two states. */
  _indicatorFields() {
    const shown = item => !!item.use_indicator;
    const state = (suffix, title, boxStyle, titleStyle) => ({
      type: 'group', style: boxStyle, fields: [
        { type: 'note', class: '', bare: true, style: titleStyle, label: title },
        { id: 'indicator_icon_' + suffix, label: 'Icon', type: 'icon', style: 'margin-bottom: 8px;' },
        { id: 'indicator_bg_' + suffix, label: 'Background colour', type: 'color',
          fallback: suffix === 'active' ? '#03a9f4' : '#333333', placeholder: 'transparent',
          style: 'margin-bottom: 8px;' },
        { id: 'indicator_color_' + suffix, label: 'Icon/text colour', type: 'color',
          fallback: '#ffffff', placeholder: 'inherit' },
      ],
    });

    return [
      { type: 'group', condition: shown,
        style: 'background:rgba(0,0,0,0.15); padding:10px; border-radius:8px; border:1px solid var(--divider-color,#333); margin-top: 4px;',
        fields: [
          { type: 'note', class: 'tip', bare: true,
            style: 'font-size: 11px; color: var(--secondary-text-color); margin-bottom: 12px; font-style: italic;',
            icon: icon('lightbulb'), label: 'The indicator automatically uses the data source set above as its trigger.' },
          { type: 'group', class: 'row', style: 'margin-bottom: 8px;', fields: [
            { id: 'indicator_shape', label: 'Background shape', type: 'select', layout: 'col',
              style: 'flex:1; margin-right:8px;', controlStyle: 'width: 100%; height:32px;',
              options: item => [
                { value: 'rect', label: 'Rectangle', selected: item.indicator_shape !== 'circle' },
                { value: 'circle', label: 'Circle', selected: item.indicator_shape === 'circle' },
              ] },
            { id: 'indicator_radius', label: 'Radius', type: 'text', style: 'width:80px;',
              controlStyle: 'height:32px;', placeholder: '8px',
              condition: item => item.indicator_shape !== 'circle' },
          ] },
          { type: 'group', class: 'row', style: 'margin-bottom: 8px;', fields: [
            { type: 'custom', render: ctx => this._indicatorTrigger(ctx) },
          ] },
          { type: 'group', class: 'row', fields: [
            { id: 'indicator_visibility', label: 'Visibility', type: 'select', layout: 'col',
              style: 'flex:1;', controlStyle: 'width: 100%; height:32px;', options: item => [
                { value: 'always', label: 'Always show',
                  selected: !item.indicator_visibility || item.indicator_visibility === 'always' },
                { value: 'active_only', label: 'Show only when state matches',
                  selected: item.indicator_visibility === 'active_only' },
                { value: 'inactive_only', label: 'Hide when state matches',
                  selected: item.indicator_visibility === 'inactive_only' },
              ] },
          ] },
        ] },

      { type: 'group', condition: shown,
        style: 'display: flex; flex-direction: column; gap: 8px; margin-top: 8px;', fields: [
          state('default', 'Default (off)',
            'background:rgba(255,255,255,0.02); padding:8px; border-radius:8px; border:1px solid var(--divider-color,#333);',
            'font-size: 11px; font-weight: bold; color: var(--secondary-text-color); margin-bottom: 8px; text-transform: uppercase;'),
          state('active', 'Active (on)',
            'background:rgba(3, 169, 244, 0.05); padding:8px; border-radius:8px; border:1px solid rgba(3, 169, 244, 0.2);',
            'font-size: 11px; font-weight: bold; color: var(--primary-color); margin-bottom: 8px; text-transform: uppercase;'),
        ] },
    ];
  }

  /** Where a label's value comes from: an alias, or an entity of its own. */
  _sourceOptions(item) {
    const options = [{ value: 'manual', label: 'Manual selection',
                       selected: item.global_id === 'manual' || !item.global_id }];
    (this.slot.global_entities || []).forEach(ge => {
      const stateObj = ge.entity ? this.hass.states[ge.entity] : null;
      const name = ge.alias || stateObj?.attributes?.friendly_name || ge.entity || 'Unnamed';
      let val = stateObj ? stateObj.state : '-';
      if (stateObj && ge.attribute && stateObj.attributes[ge.attribute] !== undefined) {
        val = stateObj.attributes[ge.attribute];
      }
      const uom = (!ge.attribute && stateObj?.attributes?.unit_of_measurement) ? ` ${stateObj.attributes.unit_of_measurement}` : '';
      const attrLabel = ge.attribute ? ` (${ge.attribute})` : '';
      options.push({ value: ge.id, selected: item.global_id === ge.id,
                     label: `[${ge.alias || 'Alias'}] ${name}${attrLabel}: ${val}${uom}` });
    });
    return options;
  }

  /** An entity and an attribute of this label's own. */
  _manualSource(ctx) {
    const item = ctx.entry;
    return html`
      <div style="background:rgba(0,0,0,0.15); padding:10px; border-radius:8px; border:1px solid var(--divider-color,#333); margin-bottom:8px;">
        <div class="col" style="margin-bottom:8px;">
          <label>Entity</label>
          <ha-entity-picker .hass=${this.hass} .allowCustomEntity=${false} .value=${item.entity || ''}
            @value-changed=${e => ctx.set('entity', e.detail.value)}>
          </ha-entity-picker>
        </div>
        <div class="col">
          <label>Attribute</label>
          <div style="display:flex; align-items:center; gap:8px;">
            <ha-selector style="flex:1;" .hass=${this.hass} .selector=${{ attribute: { entity_id: item.entity || this.slot?.entity } }} .value=${item.attribute || ''}
              @value-changed=${e => ctx.set('attribute', e.detail.value)}>
            </ha-selector>
            <button title="Clear" class="clear-btn" @click=${() => ctx.set('attribute', '')}>${icon('x')}</button>
          </div>
        </div>
      </div>`;
  }

  /** The icon picker, with what it picked shown underneath. */
  _iconPicker(ctx) {
    const item = ctx.entry;
    return html`
      <div class="col">
        <label>Select icon</label>
        <ha-icon-picker .hass=${this.hass} .value=${item.icon || ''}
          @value-changed=${e => ctx.set('icon', e.detail.value)}>
        </ha-icon-picker>
        ${item.icon ? html`
          <div class="icon-preview">
            <ha-icon icon=${item.icon} style="--mdc-icon-size:20px;color:${item.icon_color || 'var(--primary-text-color)'}"></ha-icon>
            <span>${item.icon}</span>
          </div>` : ''}
      </div>`;
  }

  /**
   * The state that switches the indicator on, offered as the states the
   * entity actually has.
   */
  _indicatorTrigger(ctx) {
    const item = ctx.entry;
    const resolved = SC.resolveAlias(this.slot?.global_entities, item).entity;
    let availableStates = ['on', 'off', 'open', 'closed', 'true', 'false', 'home', 'not_home'];
    const sObj = resolved ? this.hass?.states[resolved] : null;
    if (sObj?.attributes && Array.isArray(sObj.attributes.options)) {
      availableStates = [...new Set([...availableStates, ...sObj.attributes.options])];
    }
    const datalistId = `states_${item.id}`;

    return html`
      <div class="col" style="flex:1;">
        <label>Active state (trigger)</label>
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="text" list=${datalistId} style="flex:1; height:32px;" .value=${item.indicator_state || ''} placeholder="e.g. on, open"
            @input=${e => ctx.set('indicator_state', e.target.value)}>
          <datalist id=${datalistId}>
            ${availableStates.map(st => html`<option value="${st}"></option>`)}
          </datalist>
          <button title="Clear" class="clear-btn" @click=${() => ctx.set('indicator_state', '')}>${icon('x')}</button>
        </div>
      </div>`;
  }

  _renderLabelContent(item, idx, list) {
    return html`
      <div class="label-content">
        ${SC.renderFields(this._fields(), {
          entry: item, slot: this.slot, hass: this.hass, idx,
          set: (key, value) => this._set(list, idx, key, value),
        })}
      </div>`;
  }

  render() {
    if (!this.slot) return html``;
    const list = Array.isArray(this.slot.labels_list) ? this.slot.labels_list : [];

    // One entry alone, for the canvas editor: no section, no header, no add
    // button - the canvas has already chosen which label is being edited.
    if (typeof this.only === 'number') {
      return list[this.only] ? this._renderLabelContent(list[this.only], this.only, list) : html``;
    }

    return html`
      <details class="inner-section" ?open=${this._outerOpen} @toggle=${e => this._outerOpen = e.target.open}>
        <summary>${icon('tag')} Labels &amp; Extra Texts <span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('chevron-down')}</span></summary>
        <div class="inner-content">
          ${list.map((item, idx) => this._renderLabelCard(item, idx, list))}

          <button class="add-btn" @click=${() => {
            const entry = newEntry();
            this._commit([...list, entry]);
            this._expanded = { ...this._expanded, [entry.id]: true };
          }}>${icon('plus')} Add label</button>
        </div>
      </details>
    `;
  }
}
customElements.define('sc-labels-editor', ScLabelsEditor);

// --- THE EDITOR HALF OF THE MODULE ---
window.SupercardModules['labels'] = window.SupercardModules['labels'] || {};
Object.assign(window.SupercardModules['labels'], (() => {

  function renderCustomBlock(commitFn, hass, slot) {
    return html`<sc-labels-editor .slot=${slot} .hass=${hass} .commitFn=${commitFn}>
    </sc-labels-editor>`;
  }

  return /** @type {SupercardModule} */ ({ renderCustomBlock, newEntry,
                                           ownedByCanvas: true });
})());
