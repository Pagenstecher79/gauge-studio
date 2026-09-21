import { html } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { normalizeStops, stopsToCss } from "./gradient-stops.js";
import { BEND_ROOM, bendsOf, bendClipPath, bendEscapes } from "./canvas-bend.js";

const SC = window.SupercardUtils;

window.SupercardModules = window.SupercardModules || {};

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

      // A bow outward is paint beyond the box, so the layer is grown by the
      // room one may need and the clip path hands back everything but the
      // shape. The box has to stop clipping its own contents to show it -
      // which is why only a pattern that actually bows outward asks for that.
      const bends = bendsOf(pat);
      const clip = bendClipPath(bends);
      const bentStr = clip ? `inset: -${BEND_ROOM}% !important; clip-path: ${clip};` : '';
      if (clip && bendEscapes(bends) && boxSelector) {
        styleStr += `${boxSelector} { overflow: visible !important; }\n`;
      }

      const bgSizeStr = pat.animation === 'fluid' ? 'background-size: 115% 115% !important;' : 'background-size: 100% 100% !important;';
      const bgPosStr  = 'background-position: center !important;';
      const bgRepStr  = 'background-repeat: no-repeat !important;';

      styleStr += `${selector} {
  content: "" !important;
  display: block !important;
  position: absolute !important;
  inset: 0 !important;
  ${bentStr}
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

  return /** @type {SupercardModule} */ ({ update });
})());
