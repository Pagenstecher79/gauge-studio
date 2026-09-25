// The card's sun, and nothing else.
//
// One light stands over a whole card: every glass bevel, every lit ring and
// every needle's shadow is thrown from it. It began as a pad on each glass
// pattern, which is how a card came to read as several photographs of several
// objects rather than as one object; then it was a row in the canvas
// settings, where it was a card-wide setting filed under the arrangement.
// It is a menu of its own because that is what it is - the light in the room
// the card is standing in.
//
// Editor-only: there is no runtime half. Nothing *draws* the light; the parts
// that are lit read it off the slot through `cardLight` in `card-light.js`.
// `<sc-shadow-pad>` comes from the glass editor, which loads before this.
import { LitElement, html, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { cardLight, clampLightAngle, ARC_MIN, ARC_MAX } from "./card-light.js";
import { icon } from "./icons.js";

const SC = window.SupercardUtils;

window.SupercardModules['light'] = window.SupercardModules['light'] || {};
Object.assign(window.SupercardModules['light'], (() => {

  class ScLightEditor extends LitElement {
    static get properties() {
      return { slot: { type: Object }, commitFn: { type: Object }, _isOpen: { state: true } };
    }

    static get styles() {
      return [SC.formStyles, css`
        .row, .col { margin-bottom: 8px; }
        details.inner-section { background: rgba(120,120,120,0.05); border: 1px solid var(--divider-color,#444); border-radius: 6px; margin-bottom: 16px; }
        .inner-content { padding: 0 12px 12px 12px; display: flex; flex-direction: column; border-top: 1px solid var(--divider-color,#444); margin-top: 4px; padding-top: 12px; }
        /* The pad is the control here, not a chip in a row of them, so it is
           given the width to be aimed at rather than nudged. */
        .pad-row { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }
        .note { font-size: 12px; opacity: 0.7; line-height: 1.45; margin-bottom: 8px; }
        input.num { width: 72px; }
      `];
    }

    /**
     * Both keys in one commit, always - and always both of them.
     *
     * Two commits in a tick lose the first, so they go together anyway. But
     * they also go together when only one was moved: until the card has a
     * light, `cardLight` answers with each part's own saved sun, and writing
     * one key alone would make the card take over with the *default* for the
     * other - every bevel on the card snapping to 90 degrees because somebody
     * dragged the distance.
     */
    _set(patch) {
      const now = cardLight(this.slot);
      this.commitFn('__merge__', { light_angle: now.angle, light_distance: now.distance,
                                   ...patch });
    }

    render() {
      if (!this.slot) return html``;
      const light = cardLight(this.slot);
      return html`
        <div style="padding: 0 16px;">
          <details class="inner-section" ?open=${this._isOpen}
                   @toggle=${(/** @type {any} */ e) => { this._isOpen = e.target.open; }}>
            <summary>── Light <span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('sun')}</span></summary>
            <div class="inner-content">
              <div class="note">
                Where the sun stands over the whole card. Every glass bevel, every lit
                ring and every needle's shadow is thrown from it.
              </div>
              <div class="note">
                The <b>angle</b> turns all of them together. The <b>distance</b> is how far
                the light stands off, and only a bevel and a relief have a depth for that
                to matter to - a needle's shadow is thrown by its own lift off the dial,
                under the gauge's Pointer settings, so this will not move it.
              </div>
              <div class="note">
                Only the upper half of the pad: below it the sun would be under the card,
                and a card lit from beneath reads as a mistake rather than as a light.
              </div>
              ${light.fromCard ? '' : html`<div class="note">
                Nothing is set yet, so each pattern is still lit from its own saved sun.
                Moving this one takes them all over to it, and there is no way back to
                the several suns - so look at the card first.
              </div>`}
              <div class="pad-row">
                <sc-shadow-pad .angle=${light.angle} .distance=${light.distance}
                               .maxDistance=${5}
                               @pad-change=${(/** @type {any} */ e) =>
                                 this._set({ light_angle: e.detail.angle,
                                             light_distance: e.detail.distance })}></sc-shadow-pad>
                <div class="col" style="margin:0">
                  <label>Angle</label>
                  <input class="num" type="number" min=${ARC_MIN} max=${ARC_MAX} step="1"
                         .value=${String(light.angle)}
                         @change=${(/** @type {any} */ e) => {
                           const n = clampLightAngle(parseFloat(e.target.value));
                           // lit writes `.value` only when the bound value changes, so
                           // an angle that folds back onto the one already set would
                           // leave the field showing what was typed, not what was taken.
                           e.target.value = String(n);
                           this._set({ light_angle: n });
                         }}>
                </div>
              </div>
              ${SC.sliderField('Distance', light.distance,
                               (/** @type {number} */ v) => this._set({ light_distance: v }),
                               { min: 0, max: 5, step: 0.1 })}
            </div>
          </details>
        </div>`;
    }
  }

  if (!customElements.get('sc-light-editor')) {
    customElements.define('sc-light-editor', ScLightEditor);
  }

  function renderCustomBlock(/** @type {any} */ commitFn, /** @type {any} */ _hass,
                             /** @type {any} */ slot) {
    return html`<sc-light-editor .commitFn=${commitFn} .slot=${slot}></sc-light-editor>`;
  }

  return /** @type {SupercardModule} */ ({ renderCustomBlock });

})());
