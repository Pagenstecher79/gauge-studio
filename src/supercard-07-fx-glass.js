import { DEAD_PATTERN_TARGETS } from "./config-cleanup.js";
import { lightParams, bevelShadow, px, isRoundTarget, boxRingMask, isCircleRadius } from "./glass-light.js";
import { lensScaleFraction, lensFilterMarkup, applyLensGeometry } from "./glass-lens.js";
import { suspendable, watchModalSuspend } from "./glass-suspend.js";

import { patternList, patternFor, patternRadiusCss } from "./color-pattern.js";

const SC = window.SupercardUtils;

window.SupercardModules = window.SupercardModules || {};

/**
 * Targets glass is not painted on at all - the same list config-cleanup uses
 * to take a leftover pattern out of a saved card.
 */
const NO_GLASS = new Set(DEAD_PATTERN_TARGETS);

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

      // An element's glass fits itself, so the two sliders are off by default
      // and `manual_override` is the switch that asks for them - the switch
      // the editor has always drawn. Nothing read them: the values went into
      // the config and the glass went on fitting itself, so the edge distance
      // did nothing and the radius did nothing, on every element there is.
      const manual = !isDirectElement || !!pat.manual_override;
      // The corner is its own question inside that switch: a pattern may want
      // the edge distance by hand and still take its corner from the object
      // it lies on, which is what `radius_linked` says and what the fallback
      // below works out. Default on, except where a radius is already typed -
      // see `linked` in the editor, which has to answer the same way.
      const ownRadius = pat.radius_linked === undefined
        ? !(pat.border_radius === undefined || pat.border_radius === '')
        : !pat.radius_linked;
      if (manual) {
          padVal = pat.padding ?? 0;
          padUnit = pat.padding_unit ?? 'px';
          if (ownRadius) {
            brValue = pat.border_radius ?? '';
            brUnit = pat.border_radius_unit ?? 'px';
          }
      }

      let autoRadiusFallback = 'inherit';
      // Same switch for the shape lock: its control is drawn under the same
      // condition, and a setting that goes on working while its control is
      // hidden is a setting nobody can turn off.
      let computedForceSquare = manual && (pat.force_square ?? false);
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
        } else if (pat.target.startsWith('elm_surface_')) {
          // A surface's own div is a square box; what anybody sees of it is
          // the paint, and the paint carries the corner. So the glass takes
          // the shape the colour pattern rounds it to - the same reading the
          // circular bar's plate gets, and for the same reason: `inherit`
          // asks the wrong box and answers square every time.
          autoRadiusFallback =
            patternRadiusCss(patternFor(patternList(config), pat.target)) || 'inherit';
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
      const light = lightParams(pat, config);
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
        lensDefs += lensFilterMarkup(lensId, profile, lensFraction, selector, '::after', { ior: pat.ior });
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

  return /** @type {SupercardModule} */ ({ update, onAfterRender });
})());
