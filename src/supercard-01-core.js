import { LitElement, html, css, nothing } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { reportedRows, isHeightPinned, canvasFromGrid, defaultShapeRows } from "./canvas-model.js";
import { stripDeadConfig, migrateSlotKey } from "./config-cleanup.js";
import { rowsAsCanvas } from "./rows-compat.js";
import { icon } from "./icons.js";

// --- CENTRAL LAYER DICTIONARY ---
export const SC_LAYERS = {
  BG_NATIVE: 0,
  BG_STATIC: 100,
  BG_ANIMATED: 200,
  LAYOUT_GRID: 500,
  ELM_BASE: 700,
  ELM_STATIC: 800,
  ELM_DYNAMIC: 900,
  ELM_FLOAT: 1000,
  FX_FILTERS: 1300,
  FX_GLASS: 1400,
  INT_BASE: 1700,
  INT_EVENTS: 1800
};

window.SupercardModules = window.SupercardModules || {};

// --- SHARED UTILS (number/color helpers used by multiple modules) ---
window.SupercardUtils = window.SupercardUtils || {};
Object.assign(window.SupercardUtils, (() => {
  /** @type {(v: any, d: number) => number} */
  const safeFloat = (v, d) => { const f = parseFloat(v); return isNaN(f) ? d : f; };

  /** @type {(hex: string) => [number, number, number] | null} */
  const hexToRgb = hex => {
    if (!hex || typeof hex !== 'string') return null;
    const h = hex.replace('#', '');
    if (h.length === 3) return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
    if (h.length === 6) return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
    return null;
  };

  /** @type {(r: number, g: number, b: number) => string} */
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

  /**
   * Look up a `var(--x)` against the document root. Anything else is handed
   * back untouched. Split out from toRgb because a var() that stays a var()
   * keeps following the theme, so only callers that need a concrete number
   * right now (contrast maths, gradient sampling) should resolve one.
   * @type {(v: string) => string}
   */
  const resolveVar = v => {
    if (typeof v !== 'string' || !v.startsWith('var(')) return v;
    const m = v.match(/var\(([^),]+)/);
    return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1].trim()).trim() : v;
  };

  /**
   * The one colour reader. Accepts everything the editors can produce - an
   * [r,g,b] array, #rgb / #rrggbb, or an rgb()/rgba() string - and returns
   * [r,g,b], or null when the value is not a colour we can read.
   * @param {any} value
   * @param {{ resolveVars?: boolean }} [opts]
   * @returns {[number, number, number] | null}
   */
  function toRgb(value, opts = {}) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return null;
    let v = value.trim();
    if (opts.resolveVars) v = resolveVar(v);
    if (v.startsWith('#')) return hexToRgb(v);
    if (v.startsWith('rgb')) {
      const m = v.match(/\d+/g);
      if (m && m.length >= 3) return [parseInt(m[0]), parseInt(m[1]), parseInt(m[2])];
    }
    return null;
  }

  /**
   * A copy of `list` with one field of one entry replaced. The editors are
   * built on immutable commits - clone, change, hand the new list to the
   * commit function - and writing that out by hand at every input meant a
   * hundred chances to forget the clone and mutate the live config instead.
   * @template T
   * @param {T[]} list
   * @param {number} idx
   * @param {string} key
   * @param {any} value
   * @returns {T[]}
   */
  function withPatch(list, idx, key, value) {
    const next = structuredClone(list);
    next[idx][key] = value;
    return next;
  }

  /**
   * Whether a gauge sizes itself from the box it is in rather than from a
   * pixel figure of its own.
   *
   * On a canvas the answer is always yes: the element *is* the size control
   * there, and a second one in the gauge editor could only contradict it. Off
   * the canvas it is the gauge's own setting.
   *
   * Both the renderer and fx-glass have to reach the same answer - fx-glass
   * picks `cqmin` or `px` units from it - so it is decided once, here.
   *
   * The string "true" counts, which a hand-written config can carry where the
   * editor's checkbox would have written a boolean. Both editor controls have
   * always read it that way - the checkbox shows such a card as switched on,
   * and the pixel field hides itself - so only the renderer disagreed, and a
   * card in that state offered no size control while still drawing at
   * `gauge_size_px`. Everything now goes through this one test.
   *
   * @param {any} gaugeConfig one entry of `gauges`
   * @param {boolean} [onCanvas] whether the card renders from a canvas
   * @returns {boolean}
   */
  function gaugeIsResponsive(gaugeConfig, onCanvas) {
    if (onCanvas) return true;
    const v = gaugeConfig?.gauge_size_responsive;
    return v === true || v === 'true';
  }

  // The card's own measured size, published by its resize observer. Each entry
  // is a length, so `calc()` can take a percentage of it.
  const CARD_SIDES = {
    width:  'var(--sc-avail-w, 100px)',
    height: 'var(--sc-avail-h, 100px)',
    min:    'var(--sc-avail-min, 100px)',
    max:    'max(var(--sc-avail-w, 100px), var(--sc-avail-h, 100px))',
  };

  /**
   * Whether the card draws from a canvas.
   *
   * A `canvas` key alone is not enough: `layout_active` gates the renderer, so
   * a card with the layout switched off draws the plain content row whatever
   * canvas it is still carrying - the same reading showsElement takes. What
   * the card actually draws is what decides its shape and which of the two
   * sets of dimension controls the editor offers.
   *
   * @param {any} slot
   * @returns {boolean}
   */
  function onCanvas(slot) {
    return !!(slot?.layout_active && slot?.canvas);
  }

  /**
   * Whether the card draws itself as a pill.
   *
   * A canvas card never does. Its elements are placed in a rectangle and the
   * shape control is not offered there, so honouring a `pill` left over from
   * the card's rows days would give it a shape nothing in the editor could
   * change. The renderer, a full-card colour or glass pattern and a bar's edge
   * indent all have to reach the same answer, so it is decided once, here.
   *
   * @param {any} slot
   * @returns {boolean}
   */
  function cardIsPill(slot) {
    return !onCanvas(slot) && slot?.layout_shape !== 'rectangle';
  }

  /**
   * The card's corner radius as a CSS length, or null when the card has not
   * set one - what to draw instead differs per caller, so that stays theirs.
   *
   * A percentage needs a side to be a percentage of, and `border-radius: 10%`
   * is not it: it resolves horizontally against the width and vertically
   * against the height, which draws an elliptical corner rather than a round
   * one. So the reference side is named and read from the card's measured
   * size, which is why those lengths are published on the host - a custom
   * property inherits down, and the container's style attribute belongs to lit.
   *
   * @param {any} slot
   * @returns {string | null}
   */
  function cardRadius(slot) {
    if (cardIsPill(slot)) return '999px';
    // A canvas card that still says `pill` and has never had a unit written to
    // it was a pill before the canvas took the shape control away: half the
    // shorter side is that same stadium, so the corner such a card has on
    // someone's dashboard right now is kept rather than squared off by an
    // update they did not ask for. The unit key is what dates the card - it
    // did not exist before this - and setting a radius in the editor retires
    // `layout_shape` besides, because that is the answer to the shape question
    // the canvas no longer asks.
    if (onCanvas(slot) && slot?.layout_shape !== 'rectangle'
        && slot?.border_radius_unit === undefined) {
      return `calc(${CARD_SIDES.min} * 50 / 100)`;
    }
    const v = slot?.border_radius;
    if (v === undefined || v === null || v === '') return null;
    // A radius written before the unit existed is a pixel one, so an absent
    // unit has to go on meaning px: reading it as a percentage would resize
    // the corners of every card that has ever set one.
    if (slot.border_radius_unit !== '%') return `${v}px`;
    return `calc(${CARD_SIDES[slot.border_radius_ref] || CARD_SIDES.min} * ${safeFloat(v, 0)} / 100)`;
  }

  /**
   * Resolve a config entry's entity/attribute through the global alias list.
   * Every module that can be pointed at a global entity needs this, so it
   * lives here rather than being re-typed per module. `match` is the alias
   * record itself for callers that also want its name.
   *
   * @param {{ id: string, entity: string, attribute: string, alias?: string }[]} list
   * @param {any} cfg
   * @param {string} [entityKey]
   * @param {string} [attrKey]
   */
  function resolveAlias(list, cfg, entityKey = 'entity', attrKey = 'attribute') {
    const id = cfg?.global_id;
    if (id && id !== 'manual') {
      const found = (list || []).find(g => g.id === id);
      if (found) return { entity: found.entity, attribute: found.attribute, alias: found.alias || '', match: found };
    }
    return { entity: cfg?.[entityKey], attribute: cfg?.[attrKey], alias: '', match: null };
  }

  /**
   * @param {{ pos: number, color: string }[]} stops
   * @param {number} pct
   * @returns {string}
   */
  function sampleGradient(stops, pct) {
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    const pos = pct * 100;
    if (pos <= sorted[0].pos) return sorted[0].color;
    if (pos >= sorted[sorted.length - 1].pos) return sorted[sorted.length - 1].color;
    for (let i = 0; i < sorted.length - 1; i++) {
      const lo = sorted[i], hi = sorted[i + 1];
      if (pos >= lo.pos && pos <= hi.pos) {
        const t = (pos - lo.pos) / (hi.pos - lo.pos);
        const [r1, g1, b1] = hexToRgb(lo.color) || [128, 128, 128];
        const [r2, g2, b2] = hexToRgb(hi.color) || [128, 128, 128];
        return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
      }
    }
    return sorted[sorted.length - 1].color;
  }

  /**
   * The gauges and progress bars a slot contains, as {id, label} records.
   * The target lists differ per editor - flat here, grouped in layout, with
   * extra per-label sub-targets there - but *which* gauges and bars exist is
   * one question with one answer, so it is answered once.
   * @param {any} slot
   */
  function listElements(slot) {
    const gaugeCount = Array.isArray(slot.gauges) ? slot.gauges.length : (slot.gauge_active ? 1 : 0);
    const gauges = Array.from({ length: gaugeCount }, (_, i) => ({ id: `gauge_${i}`, label: `Gauge ${i + 1}` }));
    const bars = (Array.isArray(slot.progressbars) ? slot.progressbars : [])
      .map((pb, i) => ({ id: `progressbar_${i}`, label: pb?.label_text || `Progressbar ${i + 1}` }));
    return { gauges, bars };
  }

  /**
   * What to call an element in front of a person, or '' when the card knows
   * nothing better than its id.
   *
   * `gauge_0` says where an element is in the config, which is the right name
   * for a glass target and the wrong one for a list of what is on the canvas:
   * three gauges on a card are three rooms, and the id says which of them is
   * which only to whoever put them there.
   *
   * The order is the same one every panel in this card already uses to title
   * an entry - the name the user typed, then the alias they gave the entity,
   * then Home Assistant's friendly name, then the entity id without its
   * domain. Nothing here invents a name: an element with no entity and no
   * label keeps its id, and the caller decides what to draw instead.
   *
   * @param {any} slot the card's `config.gauge_studio`
   * @param {any} hass
   * @param {string} id an element id, as the canvas and the target lists use it
   * @param {string} [cardEntity] the card's own entity, which icon/name/state show
   * @returns {string}
   */
  function elementLabel(slot, hass, id, cardEntity) {
    const states = hass?.states || {};
    const ofEntity = (entity) => {
      if (!entity || typeof entity !== 'string') return '';
      return states[entity]?.attributes?.friendly_name || entity.split('.')[1] || entity;
    };
    // An entry's own text first, then whatever the entity it points at is
    // called - through the alias list, because a card that names its entities
    // there has said what it wants them called.
    const ofEntry = (entry, textKey) => {
      const own = typeof entry?.[textKey] === 'string' ? entry[textKey].trim() : '';
      if (own) return own;
      const { entity, alias } = resolveAlias(slot?.global_entities, entry);
      return alias || ofEntity(entity);
    };

    const at = (list, i) => (Array.isArray(list) ? list[i] : null);
    const idx = (prefix) => parseInt(id.slice(prefix.length), 10);

    if (id.startsWith('gauge_')) {
      // Without a `gauges` array the card is the one gauge it draws, so its
      // settings are the slot itself - the shape listElements counts.
      const entry = Array.isArray(slot?.gauges) ? at(slot.gauges, idx('gauge_')) : slot;
      return entry ? ofEntry(entry, 'gauge_label_text') : '';
    }
    if (id.startsWith('progressbar_')) {
      const entry = at(slot?.progressbars, idx('progressbar_'));
      return entry ? ofEntry(entry, 'label_text') : '';
    }
    if (id.startsWith('label_')) {
      const entry = at(slot?.labels_list, idx('label_'));
      return entry ? ofEntry(entry, 'label_text') : '';
    }
    // The three that draw the card's own entity rather than one of their own.
    if (id === 'icon' || id === 'name' || id === 'state') return ofEntity(cardEntity);
    return '';
  }

  /**
   * The selector for the box the layout renderer draws an element in.
   *
   * Every element box the renderer draws gets a shadow part named after its
   * id - a surface included, which is the only thing a surface *is*. That box
   * is the region a layout cell used to be, so it is what colour and fx-glass
   * paint. Rows name their cells as parts too, and their item boxes by this
   * same name, because a label is drawn in the renderer's shadow on either
   * model and card-level CSS has no other way in.
   * @param {string} id
   * @returns {string}
   */
  function elementPartSelector(id) {
    return `sc-layout-renderer::part(element-${id})`;
  }

  /**
   * Whether the card actually shows the element with this id.
   *
   * On the canvas model the canvas is the whole answer. `onAfterRender` moves
   * exactly the elements the canvas names into the renderer, so one that is
   * not on it is never moved - it stays in the card's own flow and draws at
   * its natural size, which for a gauge is most of the card. Removing an
   * element from the canvas is what the editor's remove button does, so this
   * is the difference between "removed" and "still in the list but unplaced".
   *
   * Every other model draws everything the lists contain, and a card whose
   * layout is switched off draws them in the plain content row - so both
   * answer yes regardless of what a leftover `canvas` key says.
   * @param {any} config
   * @param {string} id
   * @returns {boolean}
   */
  function showsElement(config, id) {
    const els = config?.canvas?.elements;
    if (!config?.layout_active || !Array.isArray(els)) return true;
    return els.some(el => el?.id === id);
  }

  /**
   * Flat {id: label} map of elements available for targeting (color patterns,
   * fx-glass, interactions). The layout editor builds its own grouped list
   * from listElements instead, because it also offers per-label sub-targets.
   * @param {any} slot
   * @returns {Record<string, string>}
   */
  function getAvailableElements(slot) {
    const elements = { 'empty': 'Empty', 'icon': 'Icon', 'name': 'Entity name', 'state': 'State (value)' };
    const { gauges, bars } = listElements(slot);
    for (const g of gauges) elements[g.id] = g.label;
    for (const b of bars) elements[b.id] = b.label;
    if (Array.isArray(slot.labels_list)) {
      slot.labels_list.forEach((l, idx) => {
        elements[`label_${idx}`] = `Label: ${l.label_text || l.entity || idx + 1}`;
      });
    }
    // A surface is in none of the lists above: it has no entity and no config
    // of its own, and exists only as a box on the canvas. Being painted is the
    // whole reason it exists, so it has to be offerable as a target - without
    // this, migration created surfaces that no editor could then address.
    if (Array.isArray(slot?.canvas?.elements)) {
      for (const el of slot.canvas.elements) {
        if (!el?.surface || typeof el.id !== 'string') continue;
        const n = /^surface_(\d+)$/.exec(el.id);
        elements[el.id] = n ? `Surface ${Number(n[1]) + 1}` : 'Surface';
      }
    }
    return elements;
  }

  // --- SHARED EDITOR CHROME ---------------------------------------------
  // Both blocks below were copy-pasted into every editor module and had
  // started to drift apart. As one CSSResult each, the browser parses a
  // single stylesheet that all the adopting shadow roots share, and a change
  // to the editor look is a change in one place.
  //
  // Modules keep their own block after these in the styles array, so a module
  // that genuinely wants a different value just restates that one property.

  /**
   * The colour control every editor draws: the swatch, and the text beside it
   * that also takes `transparent`, `inherit` or a `var()`.
   *
   * It was written out by hand in five modules, which is how the swatch ended
   * up a different size in three of them. The two stylesheets both carry
   * `.color-row`, so this renders the same under either one.
   *
   * @param {string} value the colour as stored, which may be empty
   * @param {(v: string) => void} onInput
   * @param {{ fallback?: string, placeholder?: string, hexOnly?: boolean,
   *          textFallback?: boolean, onText?: (v: string) => void }} [opts]
   *   `hexOnly` refuses anything but `#rrggbb` from the text field, for a
   *   setting that has no keyword to offer; `textFallback` shows the fallback
   *   in the text field too, rather than leaving it empty for a placeholder;
   *   `onText` takes the text field alone, where it must be debounced.
   */
  const colorRow = (value, onInput, opts = {}) => {
    const fallback = opts.fallback === undefined ? '#ffffff' : opts.fallback;
    const text = value || (opts.textFallback ? fallback : '');
    return html`
      <div class="color-row">
        <input type="color" .value=${value || fallback} @input=${e => onInput(e.target.value)}>
        <input type="text" .value=${text} placeholder=${opts.placeholder || nothing}
               @input=${e => {
                 if (opts.hexOnly && !/^#[0-9a-fA-F]{6}$/.test(e.target.value)) return;
                 (opts.onText || onInput)(e.target.value);
               }}>
      </div>`;
  };

  /**
   * The range control, and the two rows it is drawn in.
   *
   * `sliderRow` is the label-beside-slider form, `sliderField` the one with
   * the value read out at the right of its own label. Both were written out
   * in every editor, which is why the same setting is 50% wide in one menu
   * and 60% in the next; a call site says `width` only while it still has to
   * differ.
   *
   * @param {number} value
   * @param {(v: number) => void} onInput
   * @param {{ min?: number, max?: number, step?: number|string, width?: string,
   *          style?: string, int?: boolean, dynamicStep?: boolean }} [opts] `int` rounds what
   *   the slider reports, for a setting that is stored as a whole number;
   *   `dynamicStep` is the progressbar's fine-below-ten step, which has to
   *   follow the value as it is dragged rather than only per render.
   */
  const slider = (value, onInput, opts = {}) => html`
    <input type="range" min=${opts.min ?? 0} max=${opts.max ?? 100} step=${opts.step ?? 1}
           style=${opts.style || ('width:' + (opts.width || '50%'))} .value=${value}
           @input=${e => {
             const v = opts.int ? parseInt(e.target.value) : parseFloat(e.target.value);
             if (opts.dynamicStep) e.target.step = v < 10 ? '0.1' : '1';
             onInput(v);
           }}>`;

  /** A slider beside its label. `label` may be a template, for a hint line. */
  const sliderRow = (label, value, onInput, opts = {}) => html`
    <div class="row"><label>${label}</label>${slider(value, onInput, opts)}</div>`;

  /** A slider under its label, with the value read out at the right of it. */
  const sliderField = (label, value, onInput, opts = {}) => html`
    <div class="col">
      <label>${label}
        <span style="float:right;color:var(--primary-color,#03a9f4);font-weight:600;min-width:32px;text-align:right;">${opts.shown ?? value}</span>
      </label>
      ${slider(value, onInput, { ...opts, width: opts.width || '100%' })}
    </div>`;

  /** `colorRow` under its own label, which is how most of them are used. */
  const colorField = (label, value, onInput, opts = {}) => html`
    <div class="col">
      <label>${label}</label>
      ${colorRow(value, onInput, opts)}
    </div>`;

  /**
   * One field of an editor built from a field array.
   *
   * The gauge and the progressbar are written that way - a field is a record,
   * and one renderer turns its `type` into a control - while the colour,
   * label, glass and interaction editors wrote every field out by hand. This
   * is that renderer, shared, so the second kind can become the first without
   * each of them inventing the translation again.
   *
   * A field is `{ id, label, type }` plus what its type needs: `options` for a
   * select, `min`/`max`/`step` for a range, `placeholder`, a `hint` line under
   * the label, and `condition(entry, slot)` to hide it. `type: 'custom'`
   * hands the rendering back to the editor through `render(ctx)`, for the
   * blocks that are not a field at all - a preview, a picker grid.
   *
   * `ctx` carries the entry being edited and how to write to it:
   * `{ entry, slot, hass, set(id, value), setDebounced(id, value) }`, and
   * `framed` - the set of parts the canvas has taken over, for `framedBy`.
   *
   * @param {any} field
   * @param {any} ctx
   */
  /**
   * Whether a field has been handed over to the canvas and should not be
   * drawn here.
   *
   * Two rules, one answer. `framedBy` names the part whose frame replaces the
   * field, and the field goes while that part is framed - two live controls
   * for one value is worse than one badly placed control. It may be a function
   * of the entry, for where that depends on what is being edited: a solid
   * colour is a swatch on the drawing, a gradient is a list and is not. It
   * may also name several parts, for a setting that more than one of them
   * offers - where the dial starts is asked under the ring that draws the
   * sweep and under the pointer that walks it, and the form has to let go
   * for either.
   * `framedWhen` is the mirror, for the line that stands in for what has gone,
   * so a fold that has lost most of its rows does not read as one that is
   * missing something.
   *
   * Here rather than inside `renderField` because one editor - the bar's -
   * draws its own fields, and the rule has to be the same rule there.
   *
   * `framedPart` is the same question asked for an answer rather than a yes:
   * which of a field's parts is the one that took it. A note that stands in
   * for the missing rows has to say what took them, and with a field that
   * names several parts, reading `framedBy` back is no longer that answer.
   *
   * @param {any} field
   * @param {any} entry the config being edited
   * @param {Set<string>|undefined} framed the parts the canvas has taken over
   * @returns {boolean} true when the field is not to be drawn
   */
  const framedPart = (field, entry, framed) => {
    if (!field) return null;
    const by = typeof field.framedBy === 'function'
      ? field.framedBy(entry) : field.framedBy;
    const parts = Array.isArray(by) ? by : (by ? [by] : []);
    return parts.find((p) => framed?.has?.(p)) ?? null;
  };

  const fieldFramed = (field, entry, framed) => {
    if (!field) return false;
    if (framedPart(field, entry, framed)) return true;
    return !!field.framedWhen && !framed?.has?.(field.framedWhen);
  };

  const renderField = (field, ctx) => {
    if (!field) return html``;
    if (field.condition && !field.condition(ctx.entry, ctx.slot)) return html``;
    if (fieldFramed(field, ctx.entry, ctx.framed)) return html``;

    // A field usually reads its own key; `value` is for the few that do not -
    // a default that falls back through an older key, a switch that is on
    // unless it was switched off.
    const val = field.value ? field.value(ctx.entry, ctx) : ctx.entry?.[field.id];
    const set = v => ctx.set(field.id, v);
    const setSlow = v => (ctx.setDebounced || ctx.set)(field.id, v);
    const width = field.width || '60%';
    // A hint may be a function, for the ones that quote a value back.
    const hint = typeof field.hint === 'function' ? field.hint(ctx.entry, ctx) : field.hint;
    const text = typeof field.label === 'function' ? field.label(ctx.entry, ctx) : field.label;
    // A heading's icon is beside its label, never inside it: the label stays a
    // string, which is what a fold is keyed by and what a search finds.
    const mark = field.icon ? html`<span class="field-icon">${field.icon}</span>` : '';
    // A hint is a balloon on the label's mark, not a line under it: the prose
    // is read once and the line would cost its height for good.
    const label = hint ? html`${text} ${tipDot(hint)}` : text;
    const box = (cls, control) => html`
      <div class=${cls} style=${field.style || nothing}>
        <label style=${field.labelStyle || nothing}>${label}</label>${control}
      </div>`;
    const row = c => box('row', c);
    const col = c => box('col', c);
    /** A field sits in a row unless it says otherwise; a few default to col. */
    const place = (c, dflt) => ((field.layout || dflt || 'row') === 'col' ? col : row)(c);
    /** An explicit control style wins over the one the type would write. */
    const control = dflt =>
      (field.controlStyle != null ? field.controlStyle : dflt) || nothing;

    switch (field.type) {
      case 'custom':
        return field.render(ctx);

      case 'heading':
        return html`<div class="section-title">${mark}${text}</div>`;

      // A section that folds away, with fields of its own.
      // A folded section, drawn the way the gauge and the bar draw theirs, so
      // a fold is the same piece of furniture wherever it appears.
      case 'details':
        return html`
          <details class="inner-section" style=${field.style || 'margin: 0;'}>
            <summary><span style="flex: 1;">${mark}${text} ${tipDot(hint)}</span><span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('chevron-down')}</span></summary>
            <div class="inner-content" style=${field.contentStyle || nothing}>
              ${(field.fields || []).map(f => renderField(f, ctx))}
            </div>
          </details>`;

      // A frame with a label and fields of its own - an action block, a group
      // of settings that belong together.
      case 'group':
        return html`
          <div class=${field.class || nothing} style=${field.style || nothing}>
            ${field.label ? html`<label style=${field.labelStyle || nothing}>${mark}${text}</label>` : ''}
            ${(field.fields || []).map(f => renderField(f, ctx))}
          </div>`;

      // A line of prose among the fields - why a control is missing, what a
      // section means. `bare` writes the text straight into the div, for a
      // caption that is not labelling anything.
      case 'note': {
        const cls = field.class ?? 'row';
        return html`
          <div class=${cls || nothing} style=${field.style || nothing}>
            ${field.bare ? html`${mark}${text}`
              : html`<label style=${field.labelStyle || nothing}>${mark}${text}</label>`}
          </div>`;
      }

      case 'select': {
        // Options may be a function, because a list of targets depends on what
        // the other entries already claimed.
        const options = typeof field.options === 'function'
          ? field.options(ctx.entry, ctx) : (field.options || []);
        const option = o => html`
          <option value=${o.value}
                  ?selected=${o.selected === undefined ? String(val ?? '') === String(o.value) : !!o.selected}
                  ?disabled=${!!o.disabled}>${o.label}</option>`;
        const grouped = options.some(o => o.group);
        let body;
        if (grouped) {
          const groups = new Map();
          options.forEach(o => {
            const g = o.group || '';
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g).push(o);
          });
          body = [...groups].map(([name, els]) => html`
            <optgroup label=${name}>${els.map(option)}</optgroup>`);
        } else {
          body = options.map(option);
        }
        return place(html`
          <select style=${control('width:' + width)} @change=${e => set(e.target.value)}>${body}</select>`);
      }

      case 'checkbox':
        return place(html`
          <ha-switch .checked=${!!val} @change=${e => set(e.target.checked)}></ha-switch>`);

      case 'range':
        return place(slider(val ?? field.placeholder ?? 0, set,
          { min: field.min, max: field.max, step: field.step, width, int: field.int }));

      case 'color':
        return place(colorRow(val || '', set, {
          fallback: field.fallback, placeholder: field.placeholder, hexOnly: field.hexOnly,
          textFallback: field.textFallback,
        }), 'col');

      case 'entity':
        return place(html`
          <ha-entity-picker .hass=${ctx.hass} .allowCustomEntity=${field.allowCustom !== false}
            .value=${val || ''} @value-changed=${e => set(e.detail.value)}></ha-entity-picker>`, 'col');

      case 'icon':
        return place(html`
          <ha-icon-picker .hass=${ctx.hass} .value=${val || ''}
            @value-changed=${e => set(e.detail.value)}></ha-icon-picker>`, 'col');

      case 'number':
        return place(html`
          <input type="number" style=${control('width:' + (field.width || '80px'))}
                 min=${field.min ?? nothing} max=${field.max ?? nothing} step=${field.step ?? nothing}
                 placeholder=${field.placeholder || nothing}
                 .value=${field.blankZero ? (val || '') : (val ?? '')}
                 @input=${e => {
                   const n = field.int ? parseInt(e.target.value) : parseFloat(e.target.value);
                   const bad = Number.isNaN(n) || (field.blankZero && !n);
                   set(bad ? (field.emptyValue ?? null) : n);
                 }}>`);

      default:
        // Text, and anything a field array asks for that is spelled as text.
        return place(html`
          <input type="text" style=${control(field.width ? 'width:' + field.width : '')}
                 placeholder=${field.placeholder || nothing} .value=${val ?? ''}
                 @input=${e => (field.debounce ? setSlow : set)(e.target.value)}>`, 'col');
    }
  };

  /** Every field of a list, in order. */
  const renderFields = (fields, ctx) => (fields || []).map(f => renderField(f, ctx));

  // Used by the module editors that list pattern/label cards (color,
  // progressbar, labels, fx-glass, interaction). Identified by ha-switch.
  /**
   * The ⓘ and the balloon it opens: every explanation in every editor.
   *
   * Prose under a control reads once and then costs that line for good, in an
   * editor that is already taller than the screen. The mark is the primary
   * colour because it is the thing to aim at, and its hit area is padded well
   * past the glyph - 13 px is hard to hit with a mouse and impossible with a
   * thumb - with the room given back as a negative margin so no row grows for
   * it. The balloon answers to hover and to focus, so it is reachable from a
   * keyboard and on a touch screen.
   */
  const tipStyles = css`
    .tip-dot { position: relative; display: inline-block; font-size: 13px; line-height: 1;
               font-weight: normal; cursor: help; color: var(--primary-color, #03a9f4);
               padding: 5px 6px; margin: -5px -6px; vertical-align: middle; }
    .tip-dot::after {
      content: attr(data-tip); position: absolute; left: 0; top: calc(100% + 2px);
      z-index: 30; width: max-content; max-width: 260px; padding: 6px 8px;
      border-radius: 6px; background: var(--card-background-color, #2b2b2b);
      color: var(--primary-text-color); border: 1px solid var(--divider-color, #444);
      box-shadow: 0 4px 12px rgba(0,0,0,0.4); font-size: 11px; line-height: 1.35;
      text-align: left; white-space: normal; opacity: 0; visibility: hidden;
      transition: opacity 0.12s ease; pointer-events: none;
    }
    /* A balloon hung on the right of a row would run off the editor. */
    .tip-dot.right::after { left: auto; right: 0; }
    .tip-dot:hover::after, .tip-dot:focus::after { opacity: 1; visibility: visible; }
  `;

  /**
   * The ⓘ that opens one explanation. `right` hangs the balloon from the mark's
   * right edge, for a mark near the right of its row.
   *
   * The click is swallowed because a mark often sits inside a `<label>`, and a
   * click on a label is a click on the control it names - reading the tip
   * would otherwise flip the switch beside it.
   *
   * @param {any} text @param {{right?: boolean}} [opts]
   */
  function tipDot(text, opts = {}) {
    if (text === undefined || text === null || text === '') return '';
    return html`<span class="tip-dot${opts.right ? ' right' : ''}" tabindex="0"
                      data-tip=${text}
                      @click=${(/** @type {Event} */ e) => { e.preventDefault(); e.stopPropagation(); }}
                      >ⓘ</span>`;
  }

  const editorStyles = css`
    /* The mark in front of a heading. It is sized by the text it stands
       beside and takes its colour, so a heading is one thing, not a picture
       and a word that have to be kept in step. */
    .field-icon { display: inline-flex; align-items: center; margin-right: 6px;
                  vertical-align: -.125em; opacity: .85; }
    /* The space below a menu belongs to the menu, not to the list it sits in:
       a module that renders nothing - the glass list on a healthy canvas, say -
       must leave no gap behind, and a gap on the container would leave one. */
    .inner-section { background: rgba(120,120,120,0.05); border: 1px solid var(--divider-color,#444); border-radius: 6px; margin: 0 16px 16px 16px; }
    summary { padding: 10px 12px; font-weight: 600; font-size: 14px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; color: var(--primary-text-color); }
    summary::-webkit-details-marker { display: none; }
    .inner-content { padding: 12px; display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--divider-color,#444); }
    .row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
    .col { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
    select, input[type="text"], input[type="number"], input[type="range"] { background: var(--card-background-color, #2b2b2b); color: var(--primary-text-color); border: 1px solid var(--divider-color); border-radius: 4px; padding: 6px; }
    .add-btn { background: transparent; border: 1px dashed var(--primary-color, #03a9f4); color: var(--primary-color, #03a9f4); padding: 10px; border-radius: 6px; cursor: pointer; font-weight: 600; width: 100%; text-align: center; }
    ha-switch { --switch-checked-button-color: var(--primary-color); scale: 0.8; }
    .toggle-icon { font-size: 10px; margin-right: 8px; display: inline-block; width: 12px; }
    .section-title { font-size: 11px; font-weight: bold; color: var(--primary-color); text-transform: uppercase; border-bottom: 1px solid var(--divider-color,#333); padding-bottom: 4px; margin-top: 8px; margin-bottom: -4px; }
    .color-row { display: flex; align-items: center; gap: 6px; }
    .color-row input[type="text"] { flex: 1; }
    .pattern-card { background: var(--secondary-background-color, #1e1e1e); border: 1px solid var(--divider-color, #444); border-radius: 8px; padding: 10px; position: relative; }
    .pattern-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; cursor: pointer; }
    .pattern-content { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; margin-top: 8px; border-top: 1px dashed var(--divider-color, #333); }
    .drag-handle { cursor: grab; padding-right: 8px; color: var(--secondary-text-color); }
    option:disabled { color: rgba(255,255,255,0.3); font-style: italic; }
    ${tipStyles}
  `;

  // Used by the compact config forms (core's two editors, the gauge editor).
  // Identified by the hand-rolled .toggle switch instead of ha-switch.
  const formStyles = css`
    * { box-sizing: border-box; }
    /* The mark in front of a heading. It is sized by the text it stands
       beside and takes its colour, so a heading is one thing, not a picture
       and a word that have to be kept in step. */
    .field-icon { display: inline-flex; align-items: center; margin-right: 6px;
                  vertical-align: -.125em; opacity: .85; }
    label { font-size: 13px; color: var(--primary-text-color); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .col { display: flex; flex-direction: column; gap: 4px; }
    input[type="text"], input[type="number"], select { padding: 7px 10px; border: 1px solid var(--divider-color,#444); background: var(--secondary-background-color,#2a2a2a); color: var(--primary-text-color); border-radius: 6px; width: 100%; font-size: 13px; }
    input:focus { border-color: var(--primary-color); outline: none; }
    input[type="range"] { width: 100%; accent-color: var(--primary-color,#03a9f4); }
    input[type="color"] { width: 42px; height: 32px; padding: 2px; border-radius: 6px; border: 1px solid var(--divider-color,#444); background: none; cursor: pointer; }
    .color-row { display: flex; align-items: center; gap: 8px; }
    .color-row input[type="text"] { flex: 1; }
    .toggle { position: relative; width: 36px; height: 20px; flex-shrink: 0; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .toggle-slider { position: absolute; inset: 0; background: var(--divider-color,#555); border-radius: 20px; cursor: pointer; transition: background 0.2s; }
    .toggle-slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; background: white; border-radius: 50%; transition: transform 0.2s; }
    .toggle input:checked + .toggle-slider { background: var(--primary-color,#03a9f4); }
    .toggle input:checked + .toggle-slider::before { transform: translateX(16px); }
    details.inner-section summary { padding: 10px 12px; font-weight: 600; font-size: 14px; cursor: pointer; outline: none; display: flex; justify-content: space-between; align-items: center; color: var(--primary-text-color); }
    details.inner-section summary::-webkit-details-marker { display: none; }
    ${tipStyles}
  `;

// Entity ids referenced anywhere in a card config. Used by shouldUpdate to tell
// a relevant hass update apart from the ones HA fires for every other entity.
const SC_ENTITY_ID_RE = /^[a-z_]+\.[a-z0-9_]+$/;
function collectEntityIds(node, out = new Set(), depth = 0) {
  if (node == null || depth > 8) return out;
  if (typeof node === 'string') {
    if (SC_ENTITY_ID_RE.test(node)) out.add(node);
  } else if (Array.isArray(node)) {
    for (const v of node) collectEntityIds(v, out, depth + 1);
  } else if (typeof node === 'object') {
    for (const v of Object.values(node)) collectEntityIds(v, out, depth + 1);
  }
  return out;
}


/**
 * Whether a new `hass` can change what a component that reads `ids` draws.
 *
 * Home Assistant replaces the whole `hass` object on every state change in
 * the instance, so without this a card of sixteen gauges re-renders all
 * sixteen because one of them ticked - and on a dashboard of two dozen such
 * cards that is most of the work the page does.
 *
 * Themes, locale and language are in here because a formatter reads them and
 * nothing else would notice they changed.
 *
 * @param {any} oldHass
 * @param {any} newHass
 * @param {Iterable<string>} ids
 * @returns {boolean}
 */
function hassInputsChanged(oldHass, newHass, ids) {
  if (!oldHass || !newHass) return true;
  if (oldHass.themes !== newHass.themes
    || oldHass.locale !== newHass.locale
    || oldHass.language !== newHass.language) return true;
  for (const id of ids) {
    if (oldHass.states[id] !== newHass.states[id]) return true;
  }
  return false;
}

  return /** @type {SupercardUtilsApi} */ ({
    safeFloat, hexToRgb, rgbToHex, toRgb, resolveVar, sampleGradient,
    getAvailableElements, listElements, elementLabel, showsElement, elementPartSelector,
    resolveAlias, withPatch, gaugeIsResponsive, onCanvas, cardIsPill, cardRadius,
    collectEntityIds, hassInputsChanged,
    colorRow, colorField, slider, sliderRow, sliderField, tipDot,
    renderField, renderFields, fieldFramed, framedPart,
    editorStyles, formStyles
  });
})());

const SC_UTILS = window.SupercardUtils;

class SupercardCore extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object }
    };
  }

  static getLayoutOptions() {
    return { grid_columns: 3, grid_rows: 3, grid_min_columns: 1, grid_min_rows: 1 };
  }

  // What Home Assistant's sections grid asks the card for. The config's own
  // `grid_options` is spread over this by hui-card, so everything here is a
  // default the layout tab may override - which is the whole point: it is the
  // same value in both places, and the canvas editor writes the same key.
  getGridOptions() {
    const slot = this.config?.gauge_studio || {};
    return {
      columns: slot.grid_columns || 3,
      rows: reportedRows(slot),
      min_columns: 1,
      min_rows: 1
    };
  }

  setConfig(config) {
    // FIX: No longer requires an entity!
    this.config = migrateSlotKey(config);
  }

  // HA replaces the whole hass object on every state change in the instance, so
  // without this the card would re-render - and re-run every module - for entities
  // it never reads. Cached per config object; a new config recollects.
  _relevantEntityIds() {
    if (this._entityIdSource !== this.config) {
      this._entityIdSource = this.config;
      this._entityIds = SC_UTILS.collectEntityIds(this.config);
    }
    return this._entityIds;
  }

  shouldUpdate(changedProps) {
    if (!this.hasUpdated) return true;
    if (changedProps.size > 1 || !changedProps.has('hass')) return true;
    return SC_UTILS.hassInputsChanged(changedProps.get('hass'), this.hass, this._relevantEntityIds());
  }

  getCardSize() { return 3; }
  static getConfigElement() { return document.createElement('supercard-modular-editor'); }
  /**
   * A new card starts on the canvas, and starts empty.
   *
   * Reaching it used to take four steps in the model the canvas replaces -
   * switch the layout section on, add a row, add a cell, assign content, then
   * convert - none of which a card added a moment ago has any reason to know
   * about.
   *
   * Only the shape is taken from the card's grid box; nothing is placed on it.
   * The icon, the name and the state are what the card draws by default, but a
   * default is not a decision: placed for you they are three boxes to move or
   * delete before the canvas is yours, and the editor already offers all three
   * under "Add element" for as long as they are not on it.
   *
   * No `layout_shape`: the shape control belongs to the rows model, and a
   * canvas card is a rectangle with a corner radius. That radius is a
   * percentage of the shorter side here, so it follows the card when Home
   * Assistant's layout gives it a different box.
   *
   * The full width of the section, and the row count a card that wide starts
   * at - `defaultShapeRows`, a third of the columns, which is 2:1 at every
   * width. `full` rather than the twelve that equals it today, so a section
   * made wider later takes the card with it.
   *
   * Home Assistant's own default box is three columns by three rows, and empty
   * that is a tall blank rectangle in a quarter-width column.
   *
   * No `rows` in `grid_options`. The row count describes the canvas' *shape*,
   * not the card's height: a number there would pin the height in pixels while
   * the width goes on following the viewport, and the canvas would sit in the
   * middle of it with bands down the sides. Reporting `rows: "auto"` instead
   * makes the ratio the height, so the card scales and nothing letterboxes.
   */
  static getStubConfig() {
    const slot = { layout_active: true, border_radius: 12,
                   border_radius_unit: '%', border_radius_ref: 'min' };
    const grid_options = { columns: 'full' };
    const rows = defaultShapeRows('full');
    const shape = canvasFromGrid({ grid_options: { ...grid_options, rows } }, slot);
    return { entity: '', grid_options, gauge_studio: { ...slot,
      // A grid in per cent, because the canvas is reshaped whenever the card's
      // columns change and a grid in units would not survive it.
      canvas: { w: shape.w, h: shape.h, grid: 2.5, grid_unit: 'pct', elements: [] } } };
  }

  static get styles() {
    return css`
      :host {
        display: grid !important;
        width: 100% !important;
        height: var(--sc-explicit-height, 100%) !important;
        grid-template-columns: 100% !important;
        grid-template-rows: 100% !important;
        box-sizing: border-box !important;
      }

      ha-card {
        display: grid !important;
        grid-template-columns: 100% !important;
        grid-template-rows: 100% !important;
        width: 100% !important;
        height: 100% !important;
        min-width: 0 !important;
        min-height: 0 !important;
        background: none !important;
        border: none !important;
        box-shadow: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      /* --- SUPERCARD RENDER PIPELINE --- */
      .supercard-container {
        display: grid !important;
        grid-template-areas: "stack" !important;
        width: 100% !important;
        height: 100% !important;
        background-color: var(--card-background-color, #1c1c1c);
        overflow: hidden !important;
        isolation: isolate;
        cursor: pointer;
        position: relative;
        z-index: ${SC_LAYERS.BG_NATIVE};
      }

      .supercard-container::before {
        content: "";
        grid-area: stack;
        position: absolute;
        inset: 0;
        background-color: var(--uc-color, transparent);
        z-index: ${SC_LAYERS.BG_STATIC};
        pointer-events: none;
        opacity: var(--uc-opacity, 0);
        transition: background-color 0.6s ease, opacity 0.6s ease;
        border-radius: var(--ha-card-border-radius, 12px);
      }

      .supercard-background { display: none !important; }

      .sc-content-row, #module-overlay-slot {
        grid-area: stack;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
      }

      .sc-content-row {
        display: flex;
        align-items: center;
        gap: calc(16px * var(--sc-scale, 1));
        padding: calc(12px * var(--sc-scale, 1)) calc(16px * var(--sc-scale, 1));
        z-index: ${SC_LAYERS.LAYOUT_GRID};
      }

      #module-overlay-slot {
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: ${SC_LAYERS.ELM_BASE};
        pointer-events: none;
      }

      .supercard-icon-container, .sub-button {
        background-color: rgba(255,255,255,0.1) !important;
        border: 1px solid rgba(255,255,255,0.1) !important;
        display: flex;
        align-items: center;
        justify-content: center;
        width: calc(42px * var(--sc-scale, 1));
        height: calc(42px * var(--sc-scale, 1));
        border-radius: 50%;
        flex-shrink: 0;
        z-index: ${SC_LAYERS.ELM_STATIC};
        position: relative;
      }

     .layer-elm-dynamic {
        z-index: ${SC_LAYERS.ELM_DYNAMIC};
        position: relative;
        will-change: opacity, transform;
      }

      /* --sc-icon-glyph is the canvas' way in: ::slotted() reaches the icon
         container but not the ha-icon inside it, and a rule here on the
         element itself would beat anything inherited. Unset everywhere else,
         so the content row keeps the size it always had. */
      ha-icon { --mdc-icon-size: var(--sc-icon-glyph, calc(24px * var(--sc-scale, 1))); }
      .text-container { display: flex; flex-direction: column; flex-grow: 1; min-width: 0; }
    `;
  }

  firstUpdated() {
    if (!this._resizeObserver) {
      this._resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.contentRect.width;
          const h = entry.contentRect.height;
          if (w > 0 && h > 0) {
            const minDim = Math.min(w, h);
            // On the host, not on #main-container: lit owns that element's
            // style attribute and rewrites it whole on every render, which
            // would drop these until the next resize. A custom property
            // inherits down, so everything inside still reads them - and the
            // corner radius, which is a percentage of one of these lengths,
            // cannot afford to lose them mid-render.
            this.style.setProperty('--sc-avail-w', w + 'px');
            this.style.setProperty('--sc-avail-h', h + 'px');
            this.style.setProperty('--sc-avail-min', minDim + 'px');

            // The rows compatibility path needs the card's real shape, and
            // the first render happens before this observer has ever fired.
            // So the numbers are kept, and that first render is asked for
            // again once there is a box to read - once, because after that
            // the ratio is already the one the canvas was built with.
            const hadBox = this._boxW > 0 && this._boxH > 0;
            this._boxW = w;
            this._boxH = h;
            if (!hadBox) this.requestUpdate();

            const slot = this._drawnSlot();
            // The scale exists for the plain content row, which a canvas card
            // does not draw - so the responsive switches are not offered
            // there, and a leftover one must not scale a placed icon either.
            if (!SC_UTILS.onCanvas(slot) && (slot.card_height_responsive || slot.card_width_responsive)) {
              const scale = Math.max(0.3, minDim / 70);
              this.style.setProperty('--sc-scale', scale.toFixed(3));
            } else {
              this.style.setProperty('--sc-scale', '1');
            }
          }
        }
      });
      this._resizeObserver.observe(this);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  updated(changedProps) {
    super.updated(changedProps);
    Object.values(window.SupercardModules).forEach(module => {
      if (typeof module.onAfterRender === 'function') {
        module.onAfterRender(this.renderRoot, this._drawnSlot(), { overlayChanged: true });
      }
    });
  }

  /**
   * The slot as the card draws it: a leftover rows layout is read as the
   * canvas it describes, so every consumer sees one model.
   *
   * Memoised on the slot object and the measured box, because `render` runs on
   * every state update the card is subscribed to and the migration walks every
   * row, cell and pattern. The slot is replaced rather than mutated on an
   * edit, so its identity is a sound cache key.
   *
   * @returns {any}
   */
  _drawnSlot() {
    const slot = this.config?.gauge_studio || {};
    if (this._drawnFor === slot && this._drawnW === this._boxW && this._drawnH === this._boxH) {
      return this._drawnSlotCache;
    }
    const compat = rowsAsCanvas(slot, this._boxW, this._boxH);
    this._drawnFor = slot;
    this._drawnW = this._boxW;
    this._drawnH = this._boxH;
    this._drawnSlotCache = compat ? { ...slot, ...compat } : slot;
    return this._drawnSlotCache;
  }

  render() {
    if (!this.config || !this.hass) return html``;

    const slot = this.config.gauge_studio || {};
    const drawnSlot = this._drawnSlot();
    const entityId = slot.entity || this.config.entity;

    const stateObj = entityId ? this.hass.states[entityId] : null;

    /*
     * The main entity is optional, and an entity that has gone missing does
     * not take the card with it.
     *
     * The card grew out of one entity, and for a while that was the whole
     * card - so a name Home Assistant did not know was a card with nothing
     * to show, and the red box was the honest answer. It has not been the
     * whole card for a long time: gauges, bars and labels each name their
     * own entity, and this one is left feeding the icon, name and state
     * elements plus the fallback for a tap action. A renamed sensor used by
     * none of those would blank a dashboard's worth of gauges that are all
     * still reporting, which is a worse answer than showing them.
     *
     * So the parts that depend on it say so - the state shows a dash - and
     * the editor names the entity as missing where it can be fixed.
     */
    const missing = !!entityId && !stateObj;

    let stateVal = missing ? '—' : (stateObj ? stateObj.state : '');
    if (stateObj && slot.entity_attribute && stateObj.attributes[slot.entity_attribute] !== undefined) {
      stateVal = stateObj.attributes[slot.entity_attribute];
    }

    const val = parseFloat(stateVal);
    const isNum = !isNaN(val);

    let combinedStyles = '';
    let htmlSlots = [];
    let overlaySlots = [];
    let moduleData = {};

    // Modules are handed the slot, not the card config, so the one fact about
    // the card's box that the layout renderer needs travels with it.
    //
    // A card still carrying a rows layout is answered with the canvas that
    // layout describes - see rows-compat.js. It is spread in ahead of the two
    // private keys and behind the slot, so the repointed pattern lists reach
    // the colour and glass modules the same way the canvas reaches the layout
    // one: every module reads this object and none of them reads the slot.
    const renderConfig = { ...drawnSlot, __moduleData: moduleData,
                           __heightPinned: isHeightPinned(this.config) };

    Object.entries(window.SupercardModules).forEach(([modKey, module]) => {
      if (typeof module.update !== 'function') return;
      const res = module.update({ stateObj, stateVal, val, isNum, config: renderConfig, hass: this.hass });

      if (res?.moduleData) {
        moduleData[modKey] = res.moduleData;
      }

      if (res?.cssVars) {
        for (const [k, v] of Object.entries(res.cssVars)) {
          if(v) combinedStyles += `${k}: ${v}; `;
        }
      }

      if (res?.html !== undefined) htmlSlots.push(html`<div class="sc-html-wrap-${modKey}" style="display:contents" .innerHTML=${res.html}></div>`);
      else if (res?.litHtml !== undefined) htmlSlots.push(html`<div class="sc-html-wrap-${modKey}" style="display:contents">${res.litHtml}</div>`);

      if (res?.litOverlay !== undefined) overlaySlots.push(html`<div class="sc-overlay-wrap-${modKey}" style="display:contents">${res.litOverlay}</div>`);
      else if (res?.htmlOverlay !== undefined) overlaySlots.push(html`<div class="sc-overlay-wrap-${modKey}" style="display:contents" .innerHTML=${res.htmlOverlay}></div>`);
    });

    // FIX: The critical change! Optional chaining (?.) protects against crashes when stateObj is null.
    const uom = stateObj?.attributes?.unit_of_measurement ? ' ' + stateObj.attributes.unit_of_measurement : '';
    const headerText = slot.entity_name_override || stateObj?.attributes?.friendly_name || entityId || 'Unnamed card';
    const iconId = stateObj?.attributes?.icon || 'mdi:bookmark';

    combinedStyles += `border-radius: ${SC_UTILS.cardRadius(slot) ?? '12px'}; `;

    if (slot.card_height_responsive !== true && slot.card_height) {
      combinedStyles += `--sc-explicit-height: ${slot.card_height}px; `;
    } else {
      combinedStyles += `--sc-explicit-height: 100%; `;
    }

    const handleTouchOrClick = (e) => {
      const path = e.composedPath();
      const isSubElement = path.some(el => el.classList && (el.classList.contains('sub-button') || el.classList.contains('supercard-icon-container')));

      if (isSubElement) {
        return;
      }

      e.stopPropagation();

      // No longer exposed in the editor - the interaction module covers this and
      // more, per element rather than for the whole card. The key is still
      // honoured so existing configurations keep their detail view.
      if (!slot.enable_click) return;

      if (this.config) {
        const event = new Event('hass-action', { bubbles: true, composed: true });
        event.detail = {
          config: this.config,
          action: 'tap'
        };
        this.dispatchEvent(event);
      }
    };

    return html`
      <ha-card>
        <div class="supercard-container" id="main-container" style="${combinedStyles}" @click=${handleTouchOrClick} @touchstart=${handleTouchOrClick}>

          <div class="sc-content-row">
            <div class="supercard-icon-container" id="icon" style="display: ${slot.hide_icon ? 'none' : ''}">
              <ha-icon icon="${iconId}"></ha-icon>
            </div>

            <div class="text-container">
              <div class="supercard-header" id="header" style="display: ${slot.hide_entity_name ? 'none' : ''}">${headerText}</div>
              <div class="supercard-state" id="state" style="display: ${slot.hide_entity_state ? 'none' : ''}">${stateVal}${uom}</div>
              <div id="module-html-slot">${htmlSlots}</div>
            </div>
          </div>

          <div id="module-overlay-slot">${overlaySlots}</div>

        </div>
      </ha-card>
    `;
  }
}

if (!customElements.get('gauge-studio-core')) customElements.define('gauge-studio-core', SupercardCore);

window.customCards = window.customCards || [];
if (!window.customCards.find(c => c.type === 'gauge-studio-core')) {
  window.customCards.push({
    type: 'gauge-studio-core', name: 'Gauge, Progressbar, Custom Card Studio', description: 'Gauges and progress bars for your dashboard, arranged and configured in the card editor', preview: false, documentationURL: ''
  });
}

// --- HELPER FOR MODULE FORMS ---
class ScGenericModuleEditor extends LitElement {
  static get properties() { return { slot: { type: Object }, fields: { type: Array }, title: { type: String }, commitFn: { type: Object }, _isOpen: { state: true } }; }
  constructor() { super(); this._timeouts = {}; }

  static get styles() {
    return [SC_UTILS.formStyles, css`
      .row, .col { margin-bottom: 8px; }
      details.inner-section { background: rgba(120,120,120,0.05); border: 1px solid var(--divider-color,#444); border-radius: 6px; margin-bottom: 16px; }
      .inner-content { padding: 0 12px 12px 12px; display: flex; flex-direction: column; border-top: 1px solid var(--divider-color,#444); margin-top: 4px; padding-top: 12px; }
    `];
  }

  static evalShowIf(spec, slot) {
    if (!spec) return true;
    const conditions = Array.isArray(spec) ? spec : [spec];
    return conditions.every(cond => {
      const act = slot[cond.field];
      const exp = cond.value;
      if (Array.isArray(exp)) return exp.includes(act);
      if (typeof exp === 'boolean') return (act === undefined ? false : Boolean(act)) === exp;
      return String(act) === String(exp);
    });
  }

  render() {
    if (!this.slot || !this.fields) return html``;
    return html`
      <div style="padding: 0 16px;">
        <details class="inner-section" ?open=${this._isOpen} @toggle=${e => this._isOpen = e.target.open}>
          <summary>── ${this.title} <span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('chevron-down')}</span></summary>
          <div class="inner-content">
            ${this.fields.map(f => this._renderField(f))}
          </div>
        </details>
      </div>
    `;
  }

  _renderField(field) {
    if (field.type === 'section') return html`<div style="font-weight:600; margin-top:12px; border-bottom:1px dashed var(--divider-color,#444); padding-bottom:4px; margin-bottom:8px; color:var(--primary-color,#03a9f4);">${field.label.replace('── ', '')}</div>`;
    if (field.showIf && !ScGenericModuleEditor.evalShowIf(field.showIf, this.slot)) return html``;

    const val = this.slot[field.id];
    const update = (v) => this.commitFn(field.id, v);
    const updateD = (v) => { clearTimeout(this._timeouts[field.id]); this._timeouts[field.id] = setTimeout(() => update(v), 250); };

    if (field.type === 'checkbox') return html`<div class="row"><label>${field.label}</label><label class="toggle"><input type="checkbox" .checked=${!!val} @change=${e=>update(e.target.checked)}><span class="toggle-slider"></span></label></div>`;
    if (field.type === 'select') return html`<div class="row"><label>${field.label}</label><select @change=${e=>update(e.target.value)}>${(field.options||[]).map(o=>html`<option value=${o.value} ?selected=${String(val??'')==String(o.value)}>${o.label}</option>`)}</select></div>`;
    if (field.type === 'range') return sliderField(field.label, val ?? field.placeholder ?? 0, update,
      { min: field.min || 0, max: field.max || 100, step: field.step || 1 });
    if (field.type === 'color') {
       const hex = val ? (Array.isArray(val) ? '#'+val.map(x=>x.toString(16).padStart(2,'0')).join('') : val) : '';
       return html`<div class="col"><label>${field.label}</label>${colorRow(hex, update, { fallback: '', placeholder: '#ffffff', hexOnly: true })}</div>`;
    }
    return html`<div class="col"><label>${field.label}</label><input type="${field.type==='number'?'number':'text'}" placeholder=${field.placeholder||''} step=${field.step||'any'} .value=${val??''} @input=${e=>updateD(field.type==='number'?parseFloat(e.target.value):e.target.value)}></div>`;
  }
}
customElements.define('sc-generic-module-editor', ScGenericModuleEditor);

// --- MAIN EDITOR AS LIT ELEMENT ---
class SupercardModularEditor extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object }
    };
  }

  setConfig(config) {
    this.config = migrateSlotKey(config);
  }

  _applyCommit(newConfig, key, value) {
    if (key === '__card__') {
      // The Lovelace card config itself, not the slot: `grid_options` is HA's
      // own key and lives there, so the canvas editor's height control and the
      // layout tab write the same field rather than two that have to agree.
      for (const [k, v] of Object.entries(value)) {
        if (v === undefined) delete newConfig[k]; else newConfig[k] = v;
      }
    } else if (key === '__merge__') {
      Object.assign(newConfig.gauge_studio, value);
    } else {
      newConfig.gauge_studio[key] = value;
      if (key === 'entity') newConfig.entity = value;
    }
  }

  _commit(key, value) {
    if (!this.config) return;
    const newConfig = structuredClone(this.config);
    if (!newConfig.gauge_studio) newConfig.gauge_studio = {};

    // One edit that has to touch both the card config and the slot arrives as
    // a batch, because two commits in one tick lose the first: this clones
    // `this.config`, and Home Assistant only writes that back asynchronously,
    // so the second clone would still be the pre-edit one.
    if (key === '__batch__') {
      for (const [k, v] of value) this._applyCommit(newConfig, k, v);
    } else {
      this._applyCommit(newConfig, key, value);
    }

    // Every commit is a rewrite of the card anyway, so it is the cheapest
    // moment to drop the settings and list entries nothing reads any more.
    // See `config-cleanup.js`.
    const cleaned = stripDeadConfig(newConfig.gauge_studio);
    if (cleaned) newConfig.gauge_studio = cleaned;

    const event = new Event("config-changed", { bubbles: true, composed: true });
    event.detail = { config: newConfig };
    this.dispatchEvent(event);
  }

  render() {
    if (!this.config || !this.hass) return html``;
    const slot = this.config.gauge_studio || {};

    // The canvas is the card, so it comes first and everything that describes
    // it follows underneath - its dimensions, then its entities, then what is
    // painted on it.
    const moduleOrder = ['layout', 'core', 'color', 'labels', 'gauge', 'progressbar', 'debug'];
    const availableModules = Object.keys(window.SupercardModules);

    availableModules.sort((a, b) => {
      let posA = moduleOrder.indexOf(a);
      let posB = moduleOrder.indexOf(b);
      if (posA === -1) posA = 999;
      if (posB === -1) posB = 999;
      return posA - posB;
    });

    return html`
      <div id="modules-container" style="display:flex; flex-direction:column; padding-top: 8px;">
        ${availableModules.map(modKey => {
          const mod = window.SupercardModules[modKey];
          const blocks = [];

          // On a canvas card the elements themselves are added and configured
          // on the canvas, selection by selection, so the module's own list of
          // every gauge or label would be a second way to do the same job. A
          // card still on rows and cells keeps its sections - that is the only
          // editor it has.
          if (slot.canvas && mod.ownedByCanvas) return blocks;

          if (typeof mod.editorFields === 'function') {
            const fields = mod.editorFields?.() ?? [];
            if (fields.length > 0) {
              blocks.push(html`
                <sc-generic-module-editor
                  .title=${modKey.charAt(0).toUpperCase() + modKey.slice(1)}
                  .fields=${fields}
                  .slot=${slot}
                  .commitFn=${(k, v) => this._commit(k, v)}>
                </sc-generic-module-editor>
              `);
            }
          }

          if (typeof mod.renderCustomBlock === 'function') {
            const customBlock = mod.renderCustomBlock((k, v) => this._commit(k, v), this.hass, slot, this.config);
            if (customBlock) blocks.push(customBlock);
          }

          return blocks;
        })}
      </div>
    `;
  }
}
customElements.define('supercard-modular-editor', SupercardModularEditor);

// --- CORE EDITOR MODULE ---
window.SupercardModules['core'] = window.SupercardModules['core'] || {};
Object.assign(window.SupercardModules['core'], (() => {

  class ScCoreEditor extends LitElement {
    /*
     * `cardEntity` is the top-level `entity` of the Lovelace card config, not
     * the slot's. The card reads `slot.entity || config.entity`, and YAML
     * written by hand usually only sets the second - so an editor that only
     * knew the first would call a card without a main entity fine while the
     * card was drawing a dash for one it cannot find.
     */
    static get properties() { return { hass: { type: Object }, slot: { type: Object }, commitFn: { type: Object }, cardEntity: { type: String }, cardConfig: { type: Object }, _expanded: { state: true } }; }
    constructor() { super(); this._expanded = {}; }
    static get styles() {
      return [SC_UTILS.formStyles, css`
        .row, .col { margin-bottom: 8px; }
        details.inner-section { background: rgba(120,120,120,0.05); border: 1px solid var(--divider-color,#444); border-radius: 6px; margin-bottom: 16px; }
        .inner-content { padding: 0 12px 12px 12px; display: flex; flex-direction: column; border-top: 1px solid var(--divider-color,#444); margin-top: 4px; padding-top: 12px; }
        ha-entity-picker { display: block; width: 100%; }
      `];
    }
    // --- NEW METHODS FOR GLOBAL ENTITIES ---
    _addGlobalEntity() {
      const entities = [...(this.slot.global_entities || [])];

      // Fallback for non-HTTPS environments (local HA instances)
      const newId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'ge_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);

      entities.push({
        id: newId,
        alias: '',
        entity: this.slot.entity || '',
        attribute: ''
      });

      this.commitFn('global_entities', entities);
    }

    _updateGlobalEntity(index, key, value) {
      const entities = [...(this.slot.global_entities || [])];
      entities[index] = { ...entities[index], [key]: value };
      this.commitFn('global_entities', entities);
    }

    _deleteGlobalEntity(index) {
      const entities = [...(this.slot.global_entities || [])];
      entities.splice(index, 1);
      this.commitFn('global_entities', entities);
    }

    _handleSort(e) {
      const { oldIndex, newIndex } = e.detail;
      if (oldIndex === newIndex) return;
      const entities = [...(this.slot.global_entities || [])];
      const [moved] = entities.splice(oldIndex, 1);
      entities.splice(newIndex, 0, moved);
      this.commitFn('global_entities', entities);
    }

    render() {
      if (!this.slot) return html``;
      const update = (k, v) => this.commitFn(k, v);

      // A canvas card is a rectangle whose corner can be a percentage of a
      // side it names; the shape and the two responsive switches belong to the
      // rows model and are not offered there. An absent unit means px - see
      // SC.cardRadius, which has to read a card written before the unit
      // existed the same way it always did.
      const onCanvas = SC_UTILS.onCanvas(this.slot);
      // A canvas card carrying a `pill` from its rows days is read as the
      // stadium that shape was, so a radius set here has to retire the key in
      // the same commit or it would be the one thing the control cannot do.
      const updateRadius = (k, v) => onCanvas && this.slot.layout_shape !== 'rectangle'
        ? this.commitFn('__merge__', { [k]: v, layout_shape: 'rectangle' })
        : update(k, v);
      const brUnit = this.slot.border_radius_unit === '%' ? '%' : 'px';
      const brRef = this.slot.border_radius_ref || 'min';
      const brMax = brUnit === '%' ? 50 : 100;
      const brValue = this.slot.border_radius ?? 12;

      return html`
        <div style="padding:0 16px;">
          <details class="inner-section" ?open=${this._expanded.dim} @toggle=${e => this._expanded = {...this._expanded, dim: e.target.open}}>
            <summary>${icon('proportions')} Card & Dimensions <span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('chevron-down')}</span></summary>
            <div class="inner-content">
              ${onCanvas ? html`
                <sc-canvas-dimensions .slot=${this.slot} .cardConfig=${this.cardConfig}
                                      .commitFn=${this.commitFn}></sc-canvas-dimensions>
              ` : ''}
              ${onCanvas ? html`
                <div class="col" style="margin-top:8px; padding-top:12px; border-top:1px dashed var(--divider-color,#444);">
                  <label>Corner radius</label>
                  <div style="display:flex; gap:8px; align-items:center;">
                    ${SC_UTILS.slider(brValue, v => updateRadius('border_radius', v), { max: brMax, style: 'flex:1', int: true })}
                    <input type="number" min="0" max=${brMax} style="width:56px;" .value=${brValue} @input=${e => updateRadius('border_radius', parseInt(e.target.value))}>
                    <select style="width:56px;" @change=${e => updateRadius('border_radius_unit', e.target.value)}>
                      <option value="px" ?selected=${brUnit === 'px'}>px</option>
                      <option value="%" ?selected=${brUnit === '%'}>%</option>
                    </select>
                  </div>
                </div>
                ${brUnit === '%' ? html`
                  <div class="row">
                    <label>Percent of</label>
                    <select @change=${e => updateRadius('border_radius_ref', e.target.value)}>
                      <option value="min" ?selected=${brRef === 'min'}>Shorter side</option>
                      <option value="max" ?selected=${brRef === 'max'}>Longer side</option>
                      <option value="width" ?selected=${brRef === 'width'}>Width</option>
                      <option value="height" ?selected=${brRef === 'height'}>Height</option>
                    </select>
                  </div>
                ` : ''}
              ` : html`
                <div class="row">
                  <label>Card shape</label>
                  <select @change=${e => update('layout_shape', e.target.value)}>
                    <option value="rectangle" ?selected=${this.slot.layout_shape === 'rectangle'}>Rectangular</option>
                    <option value="pill" ?selected=${this.slot.layout_shape === 'pill'}>Pill (rounded)</option>
                  </select>
                </div>
                <div class="col">
                  <label>Corner radius (px)</label>
                  <div style="display:flex; gap:8px; align-items:center;">
                    ${SC_UTILS.slider(this.slot.border_radius ?? 12, v => update('border_radius', v), { style: 'flex:1', int: true })}
                    <input type="number" min="0" max="100" style="width:64px;" .value=${this.slot.border_radius ?? 12} @input=${e => update('border_radius', parseInt(e.target.value))}>
                  </div>
                </div>

                <div class="row" style="margin-top: 8px; border-top: 1px dashed var(--divider-color,#444); padding-top: 12px;">
                  <label>Responsive width (HA layout)</label>
                  <label class="toggle"><input type="checkbox" .checked=${this.slot.card_width_responsive !== false} @change=${e => update('card_width_responsive', e.target.checked)}><span class="toggle-slider"></span></label>
                </div>
                ${this.slot.card_width_responsive === false ? html`
                  <div class="col">
                    <label>Absolute width (px or %)</label>
                    <input type="text" placeholder="e.g. 200px" .value=${this.slot.card_width || ''} @input=${e => update('card_width', e.target.value)}>
                  </div>
                ` : ''}

                <div class="row" style="margin-top: 8px; border-top: 1px dashed var(--divider-color,#444); padding-top: 12px;">
                  <label>Responsive height (HA layout)</label>
                  <label class="toggle"><input type="checkbox" .checked=${this.slot.card_height_responsive === true} @change=${e => update('card_height_responsive', e.target.checked)}><span class="toggle-slider"></span></label>
                </div>
                ${this.slot.card_height_responsive !== true ? html`
                  <div class="col">
                    <label>Absolute height (px)</label>
                    <input type="number" placeholder="e.g. 80" .value=${this.slot.card_height || ''} @input=${e => update('card_height', parseInt(e.target.value))}>
                  </div>
                ` : ''}
              `}

              <div style="margin-top:8px; padding-top:12px; border-top:1px dashed var(--divider-color,#444);">
                <sc-color-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                                .target=${'main'} .label=${'Colour & pattern (entire card)'}></sc-color-panel>
              </div>
              <div style="margin-top:8px;">
                <sc-fx-glass-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                                   .target=${'main'} .label=${'Glass FX (entire card)'}></sc-fx-glass-panel>
              </div>
              <div style="margin-top:8px;">
                <sc-push-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                               .target=${'main'} .label=${'Push behaviour (entire card)'}></sc-push-panel>
              </div>
            </div>
          </details>

          <details class="inner-section" ?open=${this._expanded.basis} @toggle=${e => this._expanded = {...this._expanded, basis: e.target.open}}>
            <summary>${icon('settings')} Basics & Entity(ies) & Aliases <span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('chevron-down')}</span></summary>
            <div class="inner-content">

              <div class="col">
                <label>Main entity (optional) ${SC_UTILS.tipDot(
                  'Feeds the Icon, Name and State elements, and stands in for an action that '
                  + 'names no entity of its own. Gauges, bars and labels bring their own - leave '
                  + 'this empty if the card has no use for it.')}</label>
                <ha-selector
                  .hass=${this.hass}
                  .selector=${{ entity: {} }}
                  .value=${this.slot.entity || ''}
                  @value-changed=${e => update('entity', e.detail.value)}>
                </ha-selector>
                ${(() => {
                  const named = this.slot.entity || this.cardEntity;
                  if (!named || !this.hass || this.hass.states[named]) return '';
                  return html`
                    <span style="font-size:11px;color:var(--error-color,#f44336);margin-top:4px;">
                      ${icon('triangle-alert')} Home Assistant does not know <code>${named}</code> - renamed or removed.
                      The card still draws; the Icon, Name and State elements have nothing to show.
                    </span>`;
                })()}
              </div>

              <div class="col">
                <label>Attribute (optional)</label>
                <ha-selector
                  .hass=${this.hass}
                  .selector=${{ attribute: { entity_id: this.slot.entity || '' } }}
                  .value=${this.slot.entity_attribute || ''}
                  @value-changed=${e => update('entity_attribute', e.detail.value)}>
                </ha-selector>
              </div>

              <!-- === NEW BLOCK: GLOBAL ENTITIES === -->
              <div class="col" style="margin-top: 12px; border-top: 1px dashed var(--divider-color,#444); padding-top: 12px;">
                <div class="row" style="margin-bottom: 12px;">
                  <label style="font-weight: 600;">Global entities (alias) ${SC_UTILS.tipDot(
                    'Name an entity once here, and every gauge, bar, label, colour pattern and '
                    + 'action picks it from a list instead of naming it again. Swap the entity on '
                    + 'this one line and everything that uses the alias follows - which is what '
                    + 'makes a card built for one room a card you can drop into the next. An alias '
                    + 'carries its attribute too, so a single entry can mean "the humidity of the '
                    + 'bedroom sensor" everywhere it is used, and the menus show the current value '
                    + 'beside the name so you pick the right one.')}</label>
                  <div style="cursor: pointer; background: var(--primary-color, #03a9f4); color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;" @click="${() => this._addGlobalEntity()}">
                    + Add
                  </div>
                </div>

                <ha-sortable handle-selector=".handle" @item-moved=${this._handleSort}>
                  <div class="global-entities-list" style="display: flex; flex-direction: column; gap: 8px;">
                    ${(this.slot.global_entities || []).map((ge, index) => html`
                      <details class="inner-section" style="margin-bottom: 0;">
                        <summary style="display: flex; justify-content: space-between; align-items: center; padding: 8px;">
                          <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                            <ha-icon class="handle" icon="mdi:drag" style="cursor: grab; color: var(--secondary-text-color);"></ha-icon>
                            <span style="font-weight: normal; font-size: 13px; line-height: 1.2;">
                              ${(() => {
                                // 1. Get the state object from HA
                                const stateObj = ge.entity ? this.hass.states[ge.entity] : null;

                                // 2. Determine the name (alias or HA friendly name)
                                const name = ge.alias || (stateObj?.attributes?.friendly_name || ge.entity || 'New alias');

                                if (!stateObj) return name; // Fallback if entity doesn't exist

                                // 3. Get the value (state or attribute)
                                let val = stateObj.state;
                                if (ge.attribute && stateObj.attributes[ge.attribute] !== undefined) {
                                  val = stateObj.attributes[ge.attribute];
                                }

                                // 4. Append unit (if present, but only for the main state)
                                const uom = (!ge.attribute && stateObj.attributes?.unit_of_measurement)
                                  ? ` ${stateObj.attributes.unit_of_measurement}`
                                  : '';

                                // 5. Assemble the final string
                                const attrLabel = ge.attribute ? ` (${ge.attribute})` : '';
                                return html`<strong>${name}</strong>${attrLabel}: ${val}${uom}`;
                              })()}
                            </span>
                          </div>
                          <ha-icon icon="mdi:delete" style="cursor: pointer; color: var(--error-color, #db4437); --mdc-icon-size: 18px;" @click=${(e) => { e.preventDefault(); this._deleteGlobalEntity(index); }}></ha-icon>
                        </summary>
                        <div class="inner-content" style="padding-top: 8px;">
                          <div class="col">
                            <label>Alias name</label>
                            <input type="text" .value=${ge.alias || ''} @input=${e => this._updateGlobalEntity(index, 'alias', e.target.value)}>
                          </div>
                          <div class="col" style="margin-top: 8px;">
                            <label>Entity</label>
                            <ha-selector
                              .hass=${this.hass}
                              .selector=${{ entity: {} }}
                              .value=${ge.entity}
                              @value-changed=${e => this._updateGlobalEntity(index, 'entity', e.detail.value)}>
                            </ha-selector>
                          </div>
                          <div class="col" style="margin-top: 8px;">
                            <label>Attribute (optional)</label>
                            <div style="display: flex; align-items: center; gap: 8px;">

                              <ha-selector
                                style="flex: 1; width: 100%;"
                                .hass=${this.hass}
                                .selector=${{ attribute: { entity_id: ge.entity } }}
                                .value=${ge.attribute}
                                @value-changed=${e => this._updateGlobalEntity(index, 'attribute', e.detail.value)}>
                              </ha-selector>

                              ${ge.attribute ? html`
                                <ha-icon
                                  icon="mdi:close-circle"
                                  title="Clear attribute"
                                  @click=${() => this._updateGlobalEntity(index, 'attribute', '')}
                                  style="cursor: pointer; color: var(--secondary-text-color); --mdc-icon-size: 24px; padding: 4px;">
                                </ha-icon>
                              ` : ''}

                            </div>
                          </div>

                        </div>
                      </details>
                    `)}
                  </div>
                </ha-sortable>
              </div>
              <!-- === END NEW BLOCK === -->

            </div>
          </details>

        </div>
      `;
    }
  }

  if (!customElements.get('sc-core-editor')) customElements.define('sc-core-editor', ScCoreEditor);

  function renderCustomBlock(commitFn, hass, slot, cardConfig) {
    return html`<sc-core-editor .commitFn=${commitFn} .hass=${hass} .slot=${slot}
                                .cardConfig=${cardConfig}
                                .cardEntity=${cardConfig?.entity || ''}></sc-core-editor>`;
  }

  return /** @type {SupercardModule} */ ({ renderCustomBlock });

})());
