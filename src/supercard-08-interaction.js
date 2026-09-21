const SC = window.SupercardUtils;

window.SupercardModules = window.SupercardModules || {};

// --- THE MODULE ---
window.SupercardModules['interaction'] = window.SupercardModules['interaction'] || {};
Object.assign(window.SupercardModules['interaction'], (() => {

  function getCssSelector(target) {
    // The card, not the box inside it: a push on the main card presses the
    // whole thing, frame and padding included.
    if (target === 'main') return 'ha-card';
    if (target.match(/^r\d+c\d+$/)) return `sc-layout-renderer::part(cell-${target.replace('r','').replace('c','-')})`;
    if (target === 'icon') return '#icon';
    if (target === 'name') return '#header';
    if (target === 'state') return '#state';
    if (target.startsWith('gauge_')) return `sc-gauge[data-idx="${target.split('_')[1]}"]`;
    if (target.startsWith('progressbar_')) return `sc-progressbar[data-idx="${target.split('_')[1]}"]`;
    if (target.startsWith('label_')) return `.sc-item-slot[data-item-id="${target}"], #${target}`;
    if (/^surface_\d+$/.test(target)) return '';
    return '';
  }

  function update({ config }) {
    let patterns = Array.isArray(config.interactions) ? config.interactions : [];
    if (patterns.length === 0) return {};

    let styleStr = '';

    patterns.forEach(pat => {
      if (!pat.enabled || pat.target === 'none') return;

      const selector = getCssSelector(pat.target);
      if (!selector) return;

      const isMain = pat.target === 'main';
      const scaleVal = pat.scale_depth !== undefined ? pat.scale_depth : 50;

      styleStr += `${selector} { pointer-events: auto !important; cursor: pointer !important; -webkit-tap-highlight-color: transparent !important; }\n`;

      // The press itself is applied by the pointer handler, not by :active.
      // :active matches every ancestor of whatever was pressed, so a gauge
      // with an action of its own used to press the whole card along with it.
      if (scaleVal > 0) {
        if (isMain) styleStr += `ha-card ha-ripple { display: none !important; }\n`;
      }

    });

    return { htmlOverlay: `<style>${styleStr}</style>` };
  }

  // --- HA ACTION EXECUTOR ---
  // 'ctx' carries the live { hass, config, rootEntity }; 'hostEl' is the main
  // card, so events reliably escape the shadow DOM.
  function executeAction(actionType, pat, ctx, element, hostEl) {
    const { hass, config, rootEntity } = ctx;
    const type = pat[`${actionType}_action`] || 'none';
    let entity = pat[`${actionType}_entity`];

    if (type === 'none') return;

    // Fall back to the card's main entity. render() resolves it as
    // slot.entity || config.entity, so both have to be checked here - YAML
    // written by hand usually only sets the top-level key.
    if (!entity) entity = config?.entity || rootEntity;

    if (type === 'toggle' && entity && hass) {
      const domain = entity.split('.')[0];
      // Optimize toggle for known switchable domains
      if (['light', 'switch', 'input_boolean', 'fan', 'cover', 'lock'].includes(domain)) {
         hass.callService(domain, 'toggle', { entity_id: entity });
      } else {
         hass.callService('homeassistant', 'toggle', { entity_id: entity });
      }
    } else if (type === 'more-info' && entity) {
      // Always fire the event from the root card so it reliably leaves the Shadow DOM
      const ev = new CustomEvent('hass-more-info', { composed: true, bubbles: true, detail: { entityId: entity } });
      (hostEl || element).dispatchEvent(ev);
    } else if (type === 'navigate') {
      const navPath = pat[`${actionType}_nav`];
      if (navPath) {
        history.pushState(null, '', navPath);
        window.dispatchEvent(new CustomEvent('location-changed'));
      }
    } else if (type === 'call-service' && hass) {
      const servicePath = pat[`${actionType}_service`];
      if (servicePath && servicePath.includes('.')) {
        const [domain, service] = servicePath.split('.');
        let parsedData = {};
        try { parsedData = JSON.parse(pat[`${actionType}_data`] || '{}'); } catch(e) {}
        if (entity && !parsedData.entity_id) parsedData.entity_id = entity;
        hass.callService(domain, service, parsedData);
      }
    }
  }

  // --- EVENT LISTENER INJECTION ---
  function onAfterRender(shadow, config) {
    // Absolutely safe HASS access via the host element
    const hass = shadow.host.hass || document.querySelector('home-assistant')?.hass;
    const rootEntity = shadow.host?.config?.entity;

    // Refreshed on every render, before any early return: listeners are attached
    // only once, so this is the only thing keeping them from acting on the config
    // and hass that happened to be current when the element was first rendered.
    shadow._sc_ctx = { config, hass, rootEntity };

    // What this module has taken pointer events and a cursor for. An element
    // keeps its listeners once they are attached - they opt out themselves -
    // but the inline styles have to be given back when a push is deleted or
    // switched off, or a surface goes on swallowing the clicks meant for the
    // card underneath until the page is reloaded.
    const claimed = shadow._sc_pushed_els || (shadow._sc_pushed_els = new Set());
    const held = new Set();

    const renderer = shadow.querySelector('sc-layout-renderer');

    const patterns = Array.isArray(config.interactions) ? config.interactions : [];

    patterns.forEach(pat => {
      if (!pat.enabled || pat.target === 'none') return;

      let el = null;
      if (pat.target === 'main') {
        el = shadow.querySelector('ha-card') || shadow.host;
      } else if (pat.target.match(/^r\d+c\d+$/)) {
        if (renderer && renderer.shadowRoot) {
          const match = pat.target.match(/r(\d+)c(\d+)/);
          el = renderer.shadowRoot.querySelector(`#sc-cell-${match[1]}-${match[2]}`);
        }
      } else if (pat.target === 'icon') {
        el = shadow.querySelector('#icon');
      } else if (pat.target === 'name') {
        el = shadow.querySelector('#header');
      } else if (pat.target === 'state') {
        el = shadow.querySelector('#state');
      } else if (pat.target.startsWith('gauge_')) {
        el = shadow.querySelector(`sc-gauge[data-idx="${pat.target.split('_')[1]}"]`);
      } else if (pat.target.startsWith('progressbar_')) {
        el = shadow.querySelector(`sc-progressbar[data-idx="${pat.target.split('_')[1]}"]`);
      } else if (/^surface_\d+$/.test(pat.target)) {
        if (renderer && renderer.shadowRoot) {
          el = renderer.shadowRoot.querySelector(`.sc-item-slot[data-item-id="${pat.target}"]`);
        }
      } else if (pat.target.startsWith('label_')) {
        if (renderer && renderer.shadowRoot) {
          el = renderer.shadowRoot.querySelector(`.sc-item-slot[data-item-id="${pat.target}"]`);
          if (!el) el = renderer.shadowRoot.querySelector(`#${pat.target}`);
        }
        if (!el) el = shadow.querySelector(`#${pat.target}`);
      }

      if (!el) return;

      held.add(el);
      el.style.cursor = 'pointer';
      // Inline, because .sc-canvas .sc-surface turns pointer events off inside
      // the renderer's shadow root, where a style of ours does not reach.
      el.style.pointerEvents = 'auto';
      el.style.webkitTapHighlightColor = 'transparent';

      const compStyle = getComputedStyle(el);
      if (compStyle.display === 'inline' || compStyle.display === 'contents') {
        el.style.display = 'inline-block';
        el._sc_display_forced = true;
      }

      if (el._sc_interactions_attached) return;
      el._sc_interactions_attached = true;

      // Re-resolve against the current config on every event. Returns null once
      // the pattern is gone, switched off, or pointed at a different element -
      // this element keeps its listeners, so they have to opt out themselves.
      const currentPattern = () => {
        const cur = shadow._sc_ctx?.config?.interactions?.find(i => i.id === pat.id);
        if (!cur || cur.enabled === false || cur.target !== pat.target) return null;
        return cur;
      };

      let clickTimer = null;
      let holdTimer = null;
      let isHeld = false;

      // An element with a push of its own keeps it to itself, so the card
      // underneath answers only where nothing above it does. One whose pattern
      // has since gone lets the push through instead of blocking it silently.
      const preventProp = (e) => { if (currentPattern()) e.stopPropagation(); };
      const resetScale = () => { if (el.style.scale) el.style.scale = '1'; };

      const onPointerDown = (e) => {
        preventProp(e);
        isHeld = false;

        const ctx = shadow._sc_ctx;
        const currentPat = currentPattern();
        // Both answers to a push are transitions on the same element, so they
        // go into one declaration - a second assignment would drop the first.
        const eased = 'cubic-bezier(0.2, 0, 0, 1)';
        const moves = [];
        const sinks = !!currentPat && currentPat.scale_depth > 0;
        if (sinks) moves.push('scale 0.15s ' + eased);
        if (currentPat && currentPat.rotate_once) {
          // The turn counts up instead of going back to zero, so a second push
          // carries on from where the first one stopped rather than snapping
          // back and starting again.
          const speed = Math.min(100, Math.max(1, SC.safeFloat(currentPat.rotate_speed, 50)));
          const dur = Math.max(0.15, 3 - speed * 0.0287);
          moves.push('rotate ' + dur.toFixed(2) + 's ' + eased);
          el._sc_turns = (el._sc_turns || 0) + 1;
        }
        if (moves.length) el.style.transition = moves.join(', ');
        if (sinks) el.style.scale = 1 - (currentPat.scale_depth * 0.0015);
        if (currentPat && currentPat.rotate_once) el.style.rotate = (el._sc_turns * 360) + 'deg';

        holdTimer = setTimeout(() => {
          isHeld = true;
          if (currentPat) executeAction('hold', currentPat, ctx, el, shadow.host);
        }, 500);
      };

      const onPointerUp = (e) => {
        preventProp(e);
        clearTimeout(holdTimer);
        resetScale();

        if (isHeld) return;

        const ctx = shadow._sc_ctx;
        const currentPat = currentPattern();
        if (!currentPat) return;

        const hasDoubleTap = currentPat.double_tap_action && currentPat.double_tap_action !== 'none';

        if (hasDoubleTap) {
          if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
            executeAction('double_tap', currentPat, ctx, el, shadow.host);
          } else {
            clickTimer = setTimeout(() => {
              clickTimer = null;
              executeAction('tap', currentPat, ctx, el, shadow.host);
            }, 250);
          }
        } else {
          executeAction('tap', currentPat, ctx, el, shadow.host);
        }
      };

      const onPointerCancel = (e) => {
        clearTimeout(holdTimer);
        resetScale();
      };

      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('pointerup', onPointerUp);
      el.addEventListener('pointerleave', onPointerCancel);
      el.addEventListener('pointercancel', onPointerCancel);
      el.addEventListener('click', preventProp);
    });

    // Give back what is no longer pushed. The element itself is left alone -
    // it may be drawing its own cursor or scale - so only the three properties
    // set above are cleared, and `display` only where it was forced.
    claimed.forEach(el => {
      if (held.has(el)) return;
      el.style.cursor = '';
      el.style.pointerEvents = '';
      el.style.webkitTapHighlightColor = '';
      el.style.scale = '';
      if (el._sc_display_forced) { el.style.display = ''; el._sc_display_forced = false; }
    });
    shadow._sc_pushed_els = held;
  }

  return /** @type {SupercardModule} */ ({ update, onAfterRender });
})());
