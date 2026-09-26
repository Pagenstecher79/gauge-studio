import { LitElement, html, css, nothing } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { canvasFromGrid } from "./canvas-model.js";
import { stripDeadConfig, migrateSlotKey } from "./config-cleanup.js";
import { icon } from "./icons.js";
import { GRADIENT_PRESETS, gradientPresetCss } from "./gradient-presets.js";
import { framedPart, fieldFramed, framedIn, menusFor } from "./framed-fields.js";

window.SupercardModules = window.SupercardModules || {};

// --- SHARED EDITOR UTILS ---
// The other half of `window.SupercardUtils`: the controls every editor draws
// and the two stylesheets they start from. It is assigned onto the same
// object the runtime half built, so `SC.colorRow` reads the same either way -
// but only once this bundle has been loaded, which is when an editor opens.
Object.assign(window.SupercardUtils, (() => {

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
   * A length and the unit it is measured in: the number, and the menu beside
   * it that says what the number means.
   *
   * A corner radius is the setting that needs it - eight of something is a
   * hairline on one element and a full round end on another, and which of the
   * two depends entirely on whether the eight is pixels or per cent of the
   * box. The control was written out twice already, for the surface's corner
   * and for the glass panel's, and the bar's is the third.
   *
   * Two storage shapes, because the card carries both and neither is worth a
   * migration: a colour pattern keeps the unit in a key of its own, and every
   * length a bar owns carries it in the value string (`'50%'`, `'8px'`). Pass
   * `unit` and `onUnit` for the first; leave them out and the row splits and
   * rejoins the string itself.
   *
   * @param {string|number|undefined} value
   * @param {(v: string) => void} onInput what the number field writes - the
   *   whole string where the unit rides in it, the bare number otherwise
   * @param {{ units?: readonly string[], unit?: string, onUnit?: (u: string) => void,
   *          dflt?: string, placeholder?: string, min?: number, max?: number,
   *          step?: number|string }} [opts] `dflt` is the value the element is
   *   drawn at when nothing is set, which is what tells the row which unit to
   *   show for a card that has never said.
   */
  const lengthRow = (value, onInput, opts = {}) => {
    const units = opts.units || ['px', '%'];
    const split = splitLength(value, opts.dflt);
    // Where the unit has a key of its own the string never holds one, so the
    // key is the only answer; otherwise it is whatever the value carries, and
    // the default's unit for a value that carries none.
    const inline = opts.unit === undefined;
    const unit = inline ? split.unit : opts.unit;
    const write = (/** @type {string} */ n, /** @type {string} */ u) =>
      onInput(inline ? (n === '' ? '' : n + u) : n);
    return html`
      <div class="length-row">
        <input type="number" .value=${split.n} placeholder=${opts.placeholder || nothing}
               min=${opts.min ?? nothing} max=${opts.max ?? nothing} step=${opts.step ?? nothing}
               @input=${e => write(e.target.value, unit)}>
        <select @change=${e => (inline ? write(split.n, e.target.value)
                                       : opts.onUnit?.(e.target.value))}>
          ${units.map(u => html`<option value=${u} ?selected=${unit === u}>${u}</option>`)}
        </select>
      </div>`;
  };

  /**
   * A stored length taken apart into its number and its unit.
   *
   * The number comes back as the string the input field shows rather than as
   * a float, so a field being typed into keeps its empty state and its
   * half-written `0.` instead of being rewritten under the cursor.
   *
   * @param {string|number|undefined|null} value
   * @param {string} [dflt] what the element is drawn at when nothing is set
   * @returns {{ n: string, unit: string }}
   */
  const splitLength = (value, dflt = '') => {
    const unitOf = (/** @type {string} */ s) =>
      (/^\s*-?\d*\.?\d*\s*([a-z%]+)\s*$/i.exec(s)?.[1]) || '';
    const raw = value === undefined || value === null ? '' : String(value).trim();
    const m = /^(-?\d*\.?\d*)\s*([a-z%]*)$/i.exec(raw);
    if (!m) return { n: '', unit: unitOf(String(dflt)) || 'px' };
    return { n: m[1], unit: m[2] || unitOf(String(dflt)) || 'px' };
  };

  /**
   * The ready-made colour ramps, as the pictures they are.
   *
   * Swatches rather than a menu of names: a ramp is a picture, and "Fresh to
   * stuffy" only means something once the purple at the top has been seen.
   * What each one is *for* is the balloon on it, because that line is read
   * once and then never again.
   *
   * The gauge's ring and the bar's fill are coloured from the same catalogue
   * and differ only in which keys the pick is written to - so the grid is one
   * control and the caller says what a pick means.
   *
   * @param {(id: string) => void} onPick
   * @param {{ label?: string }} [opts]
   */
  const rampGrid = (onPick, opts = {}) => html`
    <div class="col" style="gap:6px;">
      <label>${opts.label || 'Start from a ramp'} ${tipDot('A set of colour stops that suit each other, written straight into the list below. Every stop stays yours to move, and nothing remembers which ramp you picked.')}</label>
      <div class="ramp-grid">
        ${GRADIENT_PRESETS.map(pr => html`
          <button class="ramp" title=${pr.label + ' \u2013 ' + pr.hint}
                  @click=${() => onPick(pr.id)}>
            <span class="ramp-bar" style="background:${gradientPresetCss(pr)}"></span>
            <span class="ramp-name">${pr.label}</span>
          </button>`)}
      </div>
    </div>`;

  /** `lengthRow` under its own label. */
  const lengthField = (label, value, onInput, opts = {}) => html`
    <div class="col">
      <label>${label}</label>
      ${lengthRow(value, onInput, opts)}
    </div>`;

  /*
   * Whether a field has been handed over to the canvas, which of its parts
   * took it, and what a fold has left - all three are `framed-fields.js`,
   * because one editor of the two draws its own fields and the rule has to
   * be the same rule there. They are published below so that editor and the
   * canvas can both ask.
   */

  /**
   * The list a `select` field offers.
   *
   * It may be a function, because a list of targets depends on what the other
   * entries have already claimed and a list of shapes on whether the drawing
   * can show them. Three editors used to read `field.options` straight, and
   * all three broke the day a field first answered with a function - a
   * `.map` on a function throws, and a throw inside a render takes the whole
   * editor with it, so the menus below the canvas simply stopped opening.
   * One reader, so that cannot happen again in a fourth place.
   *
   * @param {any} field
   * @param {any} entry the config being edited
   * @param {any} [ctx] whatever the caller's renderer passes on
   * @returns {any[]}
   */
  const fieldOptions = (field, entry, ctx) => {
    const list = typeof field?.options === 'function'
      ? field.options(entry, ctx) : field?.options;
    return Array.isArray(list) ? list : [];
  };

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
        const options = fieldOptions(field, ctx.entry, ctx);
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

      // A length whose unit is part of the answer. `unitId` names the key the
      // unit lives in where it has one of its own; without it the unit rides
      // in the value, which is how every length a bar owns is stored.
      case 'length':
        return place(lengthRow(val, set, {
          units: field.units, dflt: field.dflt, placeholder: field.placeholder,
          min: field.min, max: field.max, step: field.step,
          ...(field.unitId ? { unit: ctx.entry?.[field.unitId] ?? field.units?.[0] ?? 'px',
                               onUnit: u => ctx.set(field.unitId, u) } : {}),
        }), 'col');

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
   * The mark and the balloon it opens: every explanation in every editor.
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
   * The mark that opens one explanation. `right` hangs the balloon from the mark's
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
                      >${icon('info')}</span>`;
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
    .toggle-icon { font-size: 13px; margin-right: 8px; width: 13px;
                   display: inline-flex; align-items: center; justify-content: center;
                   opacity: .7; }
    .section-title { font-size: 11px; font-weight: bold; color: var(--primary-color); text-transform: uppercase; border-bottom: 1px solid var(--divider-color,#333); padding-bottom: 4px; margin-top: 8px; margin-bottom: -4px; }
    .color-row { display: flex; align-items: center; gap: 6px; }
    .color-row input[type="text"] { flex: 1; }
    /* The number takes the room and the unit takes what it needs, so the
       menu is the same width under either stylesheet and the fields of a
       column line up down their right-hand edge. */
    .length-row { display: flex; align-items: center; gap: 6px; }
    .length-row input[type="number"] { flex: 1; min-width: 0; }
    .length-row select { width: 64px; flex: none; }
    .pattern-card { background: var(--secondary-background-color, #1e1e1e); border: 1px solid var(--divider-color, #444); border-radius: 8px; padding: 10px; position: relative; }
    .pattern-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; cursor: pointer; }
    .pattern-content { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; margin-top: 8px; border-top: 1px dashed var(--divider-color, #333); }
    /* touch-action:none is what makes a grip work with a finger at all -
       without it the browser claims the gesture for a scroll before the first
       move is delivered, and the list slides away under the hand. See
       list-reorder.js. */
    .drag-handle { cursor: grab; padding-right: 8px; color: var(--secondary-text-color);
                   touch-action: none; user-select: none; }
    .drag-lifted { opacity: 0.4; }
    .drag-target { border-top: 3px dashed var(--primary-color, #03a9f4); }
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
    .length-row { display: flex; align-items: center; gap: 8px; }
    .length-row input[type="number"] { flex: 1; min-width: 0; }
    .length-row select { width: 64px; flex: none; }
    /* The ramp swatches. In the shared sheet because the gauge's ring and the
       bar's fill offer the same catalogue, and a ramp drawn two sizes would
       be the same setting looking like two. */
    .ramp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .ramp { display: flex; flex-direction: column; gap: 4px; padding: 4px;
            border: 1px solid var(--divider-color,#444); border-radius: 6px;
            background: none; color: inherit; cursor: pointer; font: inherit; }
    .ramp:hover { border-color: var(--primary-color,#03a9f4); }
    .ramp-bar { height: 10px; border-radius: 5px; }
    .ramp-name { font-size: 11px; line-height: 1.2; color: var(--secondary-text-color);
                 overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toggle { position: relative; width: 36px; height: 20px; flex-shrink: 0; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .toggle-slider { position: absolute; inset: 0; background: var(--divider-color,#555); border-radius: 20px; cursor: pointer; transition: background 0.2s; }
    .toggle-slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; background: white; border-radius: 50%; transition: transform 0.2s; }
    .toggle input:checked + .toggle-slider { background: var(--primary-color,#03a9f4); }
    .toggle input:checked + .toggle-slider::before { transform: translateX(16px); }
    details.inner-section summary { padding: 10px 12px; font-weight: 600; font-size: 14px; cursor: pointer; outline: none; display: flex; justify-content: space-between; align-items: center; color: var(--primary-text-color); }
    details.inner-section summary::-webkit-details-marker { display: none; }
    /* The same button as in \`editorStyles\`, so an add button is one button
       whichever stylesheet the editor around it started from. */
    .add-btn { background: transparent; border: 1px dashed var(--primary-color, #03a9f4); color: var(--primary-color, #03a9f4); padding: 10px; border-radius: 6px; cursor: pointer; font-weight: 600; width: 100%; text-align: center; }
    /* A button that is nothing but its icon: the icon is sized by the font
       size here, the way every other icon in the editor is. */
    .icon-btn { background: none; border: none; padding: 4px; cursor: pointer;
                display: inline-flex; align-items: center; color: inherit; }
    ${tipStyles}
  `;

  return /** @type {SupercardUtilsEditor} */ ({
    colorRow, colorField, lengthRow, lengthField, splitLength, rampGrid,
    slider, sliderRow, sliderField, tipDot,
    renderField, renderFields, fieldFramed, framedPart, framedIn, menusFor,
    fieldOptions, editorStyles, formStyles
  });
})());

const SC_UTILS = window.SupercardUtils;

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
    if (field.type === 'select') return html`<div class="row"><label>${field.label}</label><select @change=${e=>update(e.target.value)}>${fieldOptions(field, this.slot, this).map(o=>html`<option value=${o.value} ?selected=${String(val??'')==String(o.value)}>${o.label}</option>`)}</select></div>`;
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

    // What the card *is* comes before what is drawn on it: its box and its
    // entities, then the canvas, then the rest. The canvas was first for a
    // while - it is the card, after all - but it is also the tallest thing in
    // the dialog by far, and two settings menus below it are two menus nobody
    // scrolls to.
    const moduleOrder = ['core', 'light', 'layout', 'color', 'labels', 'gauge', 'progressbar', 'debug'];
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
            <summary>${icon('settings')} Basics, Entity & Aliases <span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('chevron-down')}</span></summary>
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
                  <button type="button" class="add-btn" style="width:auto; padding:6px 12px;"
                          @click=${() => this._addGlobalEntity()}>
                    ${icon('plus')} Add
                  </button>
                </div>

                <ha-sortable handle-selector=".handle" @item-moved=${this._handleSort}>
                  <div class="global-entities-list" style="display: flex; flex-direction: column; gap: 8px;">
                    ${(this.slot.global_entities || []).map((ge, index) => html`
                      <details class="inner-section" style="margin-bottom: 0;">
                        <summary style="display: flex; justify-content: space-between; align-items: center; padding: 8px;">
                          <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                            <span class="handle" style="cursor: grab; color: var(--secondary-text-color); font-size: 18px; display: inline-flex;">${icon('grip-vertical')}</span>
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
                          <button type="button" class="icon-btn" title="Delete"
                                  style="color: var(--error-color, #db4437); font-size: 18px;"
                                  @click=${(e) => { e.preventDefault(); e.stopPropagation(); this._deleteGlobalEntity(index); }}>${icon('trash-2')}</button>
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
                                <button type="button" class="icon-btn" title="Clear attribute"
                                  @click=${() => this._updateGlobalEntity(index, 'attribute', '')}
                                  style="color: var(--secondary-text-color); font-size: 20px;">${icon('x')}</button>
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
