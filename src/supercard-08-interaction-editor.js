import { LitElement, html, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { icon } from "./icons.js";

const SC = window.SupercardUtils;

// --- HELPER FUNCTIONS FOR TARGET SELECTION ---
const { getAvailableElements } = window.SupercardUtils;

function getTargets(slot) {
  const targets = [
    { id: 'none', label: '— Please select a target —', group: 'General' },
    { id: 'main', label: 'Main card (entire background)', group: 'General' }
  ];

  // Basic elements
  targets.push({ id: 'icon', label: 'Icon (main entity)', group: 'Elements (basic)' });
  targets.push({ id: 'name', label: 'Name (main entity)', group: 'Elements (basic)' });
  targets.push({ id: 'state', label: 'State / value', group: 'Elements (basic)' });

  // Gauges
  const gaugeCount = Array.isArray(slot.gauges) ? slot.gauges.length : (slot.gauge_active ? 1 : 0);
  for (let i = 0; i < gaugeCount; i++) targets.push({ id: `gauge_${i}`, label: `Gauge ${i + 1}`, group: 'Elements (gauges)' });

  // Progressbars
  const pbCount = Array.isArray(slot.progressbars) ? slot.progressbars.length : 0;
  for (let i = 0; i < pbCount; i++) targets.push({ id: `progressbar_${i}`, label: `Progressbar ${i + 1}`, group: 'Elements (progressbars)' });

  // Labels
  if (Array.isArray(slot.labels_list)) {
    slot.labels_list.forEach((l, idx) => {
      targets.push({ id: `label_${idx}`, label: `Label ${idx + 1}: ${l.label_text || l.entity || ''}`, group: 'Elements (labels)' });
    });
  }

  // A surface takes no pointer events of its own accord, so a decorative box
  // does not eat the clicks meant for what is drawn over it. One that carries
  // an action is not decorative, and the handler below lets that one through.
  (Array.isArray(slot?.canvas?.elements) ? slot.canvas.elements : [])
    .filter(el => el?.surface && typeof el.id === 'string')
    .forEach((el, i) => targets.push({
      id: el.id, label: `Surface ${i + 1} (${el.id})`, group: 'Elements (surfaces)' }));

  // An element the canvas does not place is not on the card at all, so there is
  // nothing there to click.
  return targets.filter(t => !t.group.startsWith('Elements') || SC.showsElement(slot, t.id));
}

/** The elements the card's main entity draws, which have no editor of their own. */
const BASIC_TARGETS = ['icon', 'name', 'state'];

// --- ONE INTERACTION, AS FIELDS ---
const ACTION_KINDS = [
  { id: 'none', icon: 'x', label: 'None', title: 'No action' },
  { id: 'toggle', icon: 'arrow-right-left', label: 'Toggle', title: 'Toggle' },
  { id: 'more-info', icon: 'info', label: 'Info', title: 'More info' },
  { id: 'call-service', icon: 'zap', label: 'Service', title: 'Call service' },
  { id: 'navigate', icon: 'corner-right-up', label: 'Path', title: 'Navigate' },
];

/** The five-button grid that picks the kind of action. */
function actionPicker(key, ctx) {
  const current = ctx.entry[key] || 'none';
  return html`
    <div class="action-icon-grid">
      ${ACTION_KINDS.map(a => html`
        <div class="action-icon-btn ${current === a.id ? 'active' : ''}" title=${a.title}
             @click=${() => ctx.set(key, a.id)}>
          <span class="action-icon-glyph">${icon(a.icon)}</span><span class="action-icon-label">${a.label}</span>
        </div>`)}
    </div>`;
}

/**
 * The fields of one action block - a picker for the kind of action, and
 * whatever that kind needs. Written as a field array like the gauge's and
 * the bar's, so the three blocks are the same definition three times over.
 */
function actionFields(prefix, label) {
  const key = prefix + '_action';
  const is = (...kinds) => entry => kinds.includes(entry[key] || 'none');
  return {
    type: 'group', class: 'action-box', label,
    labelStyle: 'font-weight:bold; color:var(--primary-text-color);',
    fields: [
      { id: key, type: 'custom', render: ctx => actionPicker(key, ctx) },
      { id: prefix + '_entity', label: 'Target entity (Entity ID)', type: 'entity',
        style: 'margin-top:8px;', condition: is('toggle', 'more-info', 'call-service') },
      { id: prefix + '_service', label: 'Service', type: 'text', placeholder: 'light.turn_on',
        style: 'margin-top:8px;', condition: is('call-service') },
      { id: prefix + '_data', label: 'Data (JSON, optional)', type: 'text',
        placeholder: '{"brightness": 255}',
        style: 'margin-top:8px;', condition: is('call-service') },
      { id: prefix + '_nav', label: 'Path', type: 'text', placeholder: '/lovelace/dashboard',
        style: 'margin-top:8px;', condition: is('navigate') },
    ],
  };
}

/**
 * What one element does when it is pushed. An element has one of these and no
 * more - a push is a tap, a double tap or a hold, and there is no fourth - so
 * this is a panel on the element's own editor rather than an entry in a list.
 */
function pushFields() {
  return [
    { type: 'heading', icon: icon('zap'), label: 'Home Assistant Actions' },
    actionFields('tap', 'Tap'),
    actionFields('double_tap', 'Double tap'),
    actionFields('hold', 'Hold'),
    { type: 'heading', icon: icon('clapperboard'), label: 'Visual animations (GPU)' },
    { id: 'scale_depth', label: 'Click depth (scale)', hint: '0 = Off, 100 = Max. press depth',
      type: 'range', min: 0, max: 100, width: '60%', int: true, placeholder: 50 },
    { id: 'rotate_once', label: 'Rotate once', type: 'checkbox',
      hint: 'One full turn on every push, rather than spinning for ever.' },
    { id: 'rotate_speed', label: 'Turn speed', type: 'range', min: 1, max: 100, width: '60%',
      int: true, placeholder: 50, condition: entry => !!entry.rotate_once },
  ];
}

/** The look both the panel and the leftovers list are drawn in. */
const pushStyles = css`
  .row { gap: 8px; }
  .toggle-icon { text-align: center; }
  .pattern-card { transition: opacity 0.2s; }
  .pattern-header { user-select: none; }
  optgroup { color: var(--primary-color); font-weight: bold; font-style: normal; }
  optgroup option { color: var(--primary-text-color); font-weight: normal; }
  .push-switch { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .push-body { margin-top: 8px; border-top: 1px dashed var(--divider-color, #444); padding-top: 8px;
               display: flex; flex-direction: column; gap: 12px; }
  .action-box { background: rgba(0,0,0,0.15); border: 1px dashed var(--divider-color); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }

  .action-icon-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-top: 4px; }
  .action-icon-btn {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
    background: rgba(255,255,255,0.03); border: 1px solid var(--divider-color, #444); border-radius: 6px;
    cursor: pointer; padding: 8px 4px; color: var(--secondary-text-color); transition: all 0.2s;
  }
  .action-icon-btn:hover { background: rgba(255,255,255,0.08); border-color: var(--primary-color); color: var(--primary-text-color); }
  .action-icon-btn.active { background: rgba(3,169,244,0.1); border-color: var(--primary-color, #03a9f4); color: var(--primary-color, #03a9f4); }
  .action-icon-glyph { font-size: 22px; display: inline-flex; }
  .action-icon-label { font-size: 10px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  ha-entity-picker { width: 100%; }
`;

/**
 * One element's push behaviour, shown in that element's own editor - the same
 * piece of furniture the glass panel is, and for the same reason: the setting
 * belongs to the thing being edited, not to a list somewhere else.
 */
class ScPushPanel extends LitElement {
  static get properties() {
    return { slot: { type: Object }, hass: { type: Object }, commitFn: { type: Function },
             target: { type: String }, label: { type: String } };
  }

  static get styles() { return [SC.editorStyles, pushStyles]; }

  _list() { return Array.isArray(this.slot?.interactions) ? this.slot.interactions : []; }

  _commit(list) { if (this.commitFn) this.commitFn('__merge__', { interactions: list }); }

  _toggle(on) {
    const list = this._list();
    const idx = list.findIndex(p => p.target === this.target);
    if (idx < 0) {
      this._commit([...list, {
        id: Date.now(), enabled: on, target: this.target,
        tap_action: 'none', double_tap_action: 'none', hold_action: 'none',
        scale_depth: 50,
      }]);
      return;
    }
    this._commit(SC.withPatch(list, idx, 'enabled', on));
  }

  render() {
    if (!this.slot || !this.target) return html``;
    const list = this._list();
    const idx = list.findIndex(p => p.target === this.target);
    const pat = idx < 0 ? null : list[idx];
    const on = !!pat?.enabled;
    const set = (key, value) => this._commit(SC.withPatch(list, idx, key, value));

    return html`
      <div class="push-switch">
        <label>${icon('pointer')} ${this.label || 'Push behaviour'}</label>
        <ha-switch .checked=${on} @change=${e => this._toggle(e.target.checked)}></ha-switch>
      </div>
      ${on && pat ? html`
        <div class="push-body">
          ${SC.renderFields(pushFields(), { entry: pat, slot: this.slot, hass: this.hass, set })}
        </div>` : ''}
    `;
  }
}

if (!customElements.get('sc-push-panel')) customElements.define('sc-push-panel', ScPushPanel);

/**
 * What is left of the old list: the interactions whose element no longer has
 * an editor to show them in - a gauge that was deleted, a target written by
 * hand. Every live target carries its own panel, so in a healthy card this
 * section is simply absent, and there is nothing to add here.
 */
class ScInteractionEditor extends LitElement {
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
    this._expanded = ScInteractionEditor._expandedCache ?? {};
  }

  static get styles() { return [SC.editorStyles, pushStyles]; }

  _commit(newList) {
    if (this.commitFn) this.commitFn('__merge__', { interactions: newList });
  }

  /** Commit `list` with one field of entry `idx` changed. */
  _set(list, idx, key, value) { this._commit(SC.withPatch(list, idx, key, value)); }

  _toggle(id, e) {
    if (e) e.stopPropagation();
    this._expanded = { ...this._expanded, [id]: !this._expanded[id] };
    ScInteractionEditor._expandedCache = this._expanded;
  }

  render() {
    if (!this.slot) return html``;

    const patterns = Array.isArray(this.slot.interactions) ? this.slot.interactions : [];
    const targets = getTargets(this.slot);
    // The icon, the name and the state come from the card's main entity and
    // have no editor of their own. On a canvas they are elements, and their
    // push behaviour sits in the element's settings there; without one, this
    // is the only place it can be offered.
    const homeless = this.slot.canvas ? [] : BASIC_TARGETS
      .filter(id => targets.some(t => t.id === id));
    // Every target the card still offers is edited where it lives: gauges,
    // bars and labels in their own editors, the card in Card & Dimensions,
    // the icon, the name, the state and the surfaces on the canvas - or, with
    // no canvas, in the panels above.
    const covered = new Set(targets.map(t => t.id).filter(id => id !== 'none'));
    // Everything live is edited where it lives, so what is listed here is what
    // no panel can reach: a target that has since gone, or one never set.
    const rows = patterns
      .map((pat, idx) => ({ pat, idx }))
      .filter(({ pat }) => !covered.has(pat.target));

    if (!rows.length && !homeless.length) return html``;

    return html`
      <details class="inner-section">
        <summary>${icon('pointer')} Push behaviour
          ${SC.tipDot('Gauges, bars, labels and the card itself carry their push behaviour in their own editor. What is left here is the icon, the name and the state, which have none - and anything pointing at an element the card no longer has.')}
          <span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('chevron-down')}</span></summary>
        <div class="inner-content">
          ${homeless.map(id => html`
            <div class="pattern-card">
              <sc-push-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                             .target=${id}
                             .label=${targets.find(t => t.id === id)?.label || id}></sc-push-panel>
            </div>`)}
          ${rows.map(({ pat, idx }) => {
            const isExp = !!this._expanded[pat.id];
            const targetLabel = targets.find(t => t.id === pat.target)?.label
              || (pat.target === 'none' ? 'Not assigned' : 'Unknown target');

            return html`
              <div class="pattern-card">
                <div class="pattern-header" @click=${e => this._toggle(pat.id, e)}>
                  <div>
                    <span class="toggle-icon">${icon(isExp ? 'chevron-down' : 'chevron-right')}</span>
                    <span style="color:${pat.enabled ? 'var(--primary-text-color)' : 'var(--secondary-text-color)'}">
                      Push behaviour
                    </span>
                    <span style="font-size:10px;color:${pat.target === 'none' ? '#f44' : 'var(--secondary-text-color)'};margin-left:8px;font-weight:normal">(${targetLabel})</span>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px">
                    <ha-switch .checked=${!!pat.enabled}
                      @click=${e => e.stopPropagation()}
                      @change=${e => { this._set(patterns, idx, 'enabled', e.target.checked); }}>
                    </ha-switch>

                    <button type="button" title="Delete" @click=${e => {
                      e.preventDefault(); e.stopPropagation();
                      const n = [...patterns]; n.splice(idx, 1); this._commit(n);
                    }} style="background:none;border:none;color:#f44;cursor:pointer;padding:4px">${icon('trash-2')}</button>
                  </div>
                </div>

                ${isExp ? html`
                  <div class="pattern-content">
                    ${SC.renderFields(pushFields(), {
                      entry: pat, slot: this.slot, hass: this.hass,
                      set: (key, value) => this._set(patterns, idx, key, value),
                    })}
                  </div>
                ` : ''}
              </div>
            `;
          })}
        </div>
      </details>
    `;
  }
}

if (!customElements.get('sc-interaction-editor')) {
  customElements.define('sc-interaction-editor', ScInteractionEditor);
}
ScInteractionEditor._expandedCache = {};
// --- THE EDITOR HALF OF THE MODULE ---
window.SupercardModules['interaction'] = window.SupercardModules['interaction'] || {};
Object.assign(window.SupercardModules['interaction'], (() => {

  let _cachedEditor = null;
  function renderCustomBlock(commitFn, hass, slot) {
    if (!_cachedEditor) _cachedEditor = document.createElement('sc-interaction-editor');
    _cachedEditor.commitFn = commitFn;
    _cachedEditor.slot = slot;
    _cachedEditor.hass = hass;
    return _cachedEditor;
  }

  function editorFields() { return []; }

  return /** @type {SupercardModule} */ ({ renderCustomBlock, editorFields });
})());
