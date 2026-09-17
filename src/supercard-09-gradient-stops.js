import { LitElement, html, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { icon } from "./icons.js";
import { normalizeStops, addStop, removeStop, moveStop, withStop,
         distributeStops, stopsToCss } from "./gradient-stops.js";

const SC = window.SupercardUtils;

/**
 * The one editor for a list of gradient stops.
 *
 * Three editors had three of these: the gauge's folding rows with a drag
 * handle and a bin, the progressbar's flat three-input line, and the colour
 * pattern's colour list with a slider hidden behind a caret. Same job, three
 * answers, and the gauge's is the one that scales - a stop is a colour *and*
 * a position, and an order you can change without retyping the numbers.
 *
 * So this is the gauge's, lifted out whole and given what the other two
 * needed: the absolute/blocks readings of a position that only the gauge has,
 * and labels a caller can override - though nobody does any more, because a
 * stop is called a colour in every menu now.
 *
 * It renders no module of its own and registers nothing on
 * `window.SupercardModules` - it is a control, imported for its side effect of
 * defining the element, the way the fx-glass panel is.
 */
class ScGradientStops extends LitElement {
  static get properties() {
    return {
      stops: { type: Array },
      /** Positions are values on the entity's scale, not per cent. */
      absolute: { type: Boolean },
      /** Each colour owns a band rather than a point - a stepped gauge. */
      blocks: { type: Boolean },
      addLabel: { type: String },
      /** A background the owner builds itself, for a gradient that is not a
          plain left-to-right one - a pattern's angle, or a radial. */
      previewCss: { attribute: false },
      itemLabel: { type: String },
      onUpdate: { attribute: false },
      _open: { state: true },
    };
  }

  constructor() {
    super();
    this.stops = [];
    this.absolute = false;
    this.blocks = false;
    this.addLabel = 'Add colour';
    this.previewCss = '';
    this.itemLabel = 'Color';
    this._open = {};
  }

  static get styles() {
    return [SC.editorStyles, css`
      .bar { display: flex; gap: 8px; margin-bottom: 4px; }
      .bar button {
        flex: 1; padding: 6px; border-radius: 6px; background: none; cursor: pointer;
        font-size: 12px; border: 1px dashed var(--primary-color, #03a9f4);
        color: var(--primary-color, #03a9f4);
      }
      .bar button.plain { border-color: var(--divider-color, #555); color: var(--primary-text-color); }
      .bar button[disabled] { opacity: 0.4; cursor: default; }
      details.stop { margin-bottom: 0; }
      details.stop > summary { padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; }
      .head { font-weight: 600; color: var(--primary-color, #03a9f4); flex: 1; display: flex; align-items: center; }
      /* The handle is what starts a drag, not the row: a press anywhere else
         still opens the row, which is what a summary is for. */
      .grip { cursor: grab; padding: 0 12px 0 0; color: var(--secondary-text-color, #aaa); font-size: 16px; user-select: none; }
      .pos { font-weight: normal; color: var(--secondary-text-color, #aaa); font-size: 11px; margin-left: 6px; }
      .dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-left: 8px;
             box-shadow: 0 0 2px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); }
      .bin { background: none; border: none; cursor: pointer; font-size: 14px; color: var(--error-color, #f44); padding: 0; }
      .preview { height: 14px; border-radius: 4px; margin-bottom: 6px; border: 1px solid var(--divider-color, #444); }
    `];
  }

  /** @param {any[]} next */
  _emit(next) {
    if (this.onUpdate) this.onUpdate(next);
  }

  _fold(i, open) { this._open = { ...this._open, [i]: open }; }

  render() {
    const stops = normalizeStops(this.stops, { blocks: this.blocks, fill: false });
    // An absolute position is a value on the entity's scale, so it says
    // nothing about where a colour sits in a strip: the preview then shows
    // the colours in order and lets CSS space them.
    const preview = this.previewCss || 'linear-gradient(90deg, '
      + (this.absolute ? stops.map(st => st.color).join(', ') : stopsToCss(stops)) + ')';
    return html`
      <div class="col" style="gap:8px; margin-top:4px;">
        ${stops.length ? html`
          <div class="preview" style="background: ${preview}"></div>` : ''}
        <div class="bar">
          <button type="button" @click=${e => {
            e.preventDefault();
            const next = addStop(stops, { absolute: this.absolute });
            this._fold(next.length - 1, true);
            this._emit(next);
          }}>${icon('plus')} ${this.addLabel}</button>
          <button type="button" class="plain" ?disabled=${stops.length < 2}
                  title="Spread the colours evenly"
                  @click=${e => {
                    e.preventDefault();
                    this._emit(distributeStops(stops, { absolute: this.absolute, blocks: this.blocks }));
                  }}>${icon('align-horizontal-distribute-center')} Distribute evenly</button>
        </div>

        ${stops.map((st, i) => html`
          <details class="inner-section stop" ?open=${!!this._open[i]}
            @toggle=${e => this._fold(i, e.target.open)}
            @dragstart=${e => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('stopIdx', String(i));
              setTimeout(() => { e.target.style.opacity = '0.3'; }, 0);
            }}
            @dragover=${e => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              e.currentTarget.style.borderTop = '3px dashed var(--primary-color, #03a9f4)';
            }}
            @dragleave=${e => { e.currentTarget.style.borderTop = ''; }}
            @drop=${e => {
              e.preventDefault();
              e.currentTarget.style.borderTop = '';
              const from = parseInt(e.dataTransfer.getData('stopIdx'));
              if (!isNaN(from) && from !== i) this._emit(moveStop(stops, from, i));
            }}
            @dragend=${e => {
              e.target.style.opacity = '1';
              e.target.removeAttribute('draggable');
            }}>
            <summary>
              <div class="head">
                <span class="grip" title="Move"
                      @mousedown=${e => e.target.closest('details').setAttribute('draggable', 'true')}
                      @mouseup=${e => e.target.closest('details').removeAttribute('draggable')}>${icon('grip-vertical')}</span>
                ${this.itemLabel} ${i + 1}
                <span class="pos">[${this.absolute ? 'Value' : 'Position'}: ${st.pos ?? 'auto'}]</span>
                <span class="dot" style="background:${st.color}"></span>
              </div>
              <div style="display:flex; gap:12px; align-items:center;" @click=${e => e.stopPropagation()}>
                <button class="bin" title="Remove" @click=${e => {
                  e.preventDefault();
                  this._emit(removeStop(stops, i));
                }}>${icon('trash-2')}</button>
              </div>
            </summary>
            <div class="inner-content" style="padding-top:4px; gap:8px;">
              ${this.absolute ? html`
                <div class="row">
                  <label>Threshold (absolute)</label>
                  <input type="number" step="any" style="width:50%" .value=${st.pos ?? ''}
                         @input=${e => this._emit(withStop(stops, i, { pos: parseFloat(e.target.value) }))}>
                </div>
              ` : html`
                ${SC.sliderField('Position (%)', st.pos ?? 0,
                    pos => this._emit(withStop(stops, i, { pos })))}
              `}
              ${SC.colorField('Color', st.color,
                  color => this._emit(withStop(stops, i, { color })),
                  { hexOnly: true, textFallback: true })}
            </div>
          </details>
        `)}
      </div>
    `;
  }
}

if (!customElements.get('sc-gradient-stops')) customElements.define('sc-gradient-stops', ScGradientStops);
