const SC = window.SupercardUtils;

window.SupercardModules = window.SupercardModules || {};

// --- ENGINE ---
window.SupercardModules['labels'] = window.SupercardModules['labels'] || {};
Object.assign(window.SupercardModules['labels'], (() => {

  function update({ hass, config }) {
    const list = Array.isArray(config.labels_list) ? config.labels_list : [];

    const labelsResolved = list.map((item, idx) => {
      const _alias = SC.resolveAlias(config.global_entities, item);
      const resolvedEntity = _alias.entity || '';
      const resolvedAttribute = _alias.attribute || null;

      let parsedIconSize = item.icon_size || '20px';
      if (/^\d+$/.test(parsedIconSize)) parsedIconSize += 'px';

      const base = {
        id: `label_${idx}`,
        enabled: !!item.enabled,
        source: {
          entity: resolvedEntity,
          attribute: resolvedAttribute
        },
        text: {
          name: item.label_text || '',
          value: '',
          showName: item.show_name !== false,
          shadow: !!item.text_shadow
        },
        icon: {
          enabled: !!(item.use_icon && item.icon),
          name: item.icon || '',
          position: item.icon_position || 'before',
          color: item.icon_color || 'inherit',
          size: parsedIconSize,
          gap: item.icon_gap != null ? item.icon_gap : 4
        }
      };

      if (!item.enabled) return base;

      if (item.use_entity && resolvedEntity && hass?.states?.[resolvedEntity]) {
        const s = hass.states[resolvedEntity];
        let rawVal = resolvedAttribute ? s.attributes?.[resolvedAttribute] : s.state;

        if (item.decimals !== undefined && item.decimals !== null && rawVal !== undefined && rawVal !== null && rawVal !== '') {
          const parsed = parseFloat(rawVal);
          if (!isNaN(parsed)) {
            rawVal = parsed.toFixed(item.decimals);
          }
        }

        const uom = (!resolvedAttribute && s.attributes?.unit_of_measurement)
          ? ` ${s.attributes.unit_of_measurement}`
          : '';

        base.text.value = `${rawVal ?? ''}${uom}`;

        if (!item.use_override) {
          base.text.name = s.attributes?.friendly_name || resolvedEntity;
        }
      }

      base.mode =
        (base.icon.enabled && base.icon.position === 'only') ? 'icon-only' :
        (base.text.showName && base.text.value) ? 'both' :
        (base.text.showName) ? 'name' :
        (base.text.value) ? 'value' :
        'name';

      // --- INDICATOR LOGIC ---
      if (item.use_indicator) {
        let indActive = false;

        if (resolvedEntity && hass?.states?.[resolvedEntity]) {
          const sObj = hass.states[resolvedEntity];
          const st = resolvedAttribute ? sObj.attributes[resolvedAttribute] : sObj.state;
          const targetStates = (item.indicator_state || '').split(',').map(s => s.trim());
          indActive = targetStates.includes(String(st));
        }

        // --- VISIBILITY ---
        const visMode = item.indicator_visibility || 'always';
        if (visMode === 'active_only' && !indActive) {
          base.enabled = false;
        } else if (visMode === 'inactive_only' && indActive) {
          base.enabled = false;
        }

        const actBg = item.indicator_bg_active || 'rgba(3, 169, 244, 0.2)';
        const defBg = item.indicator_bg_default || 'transparent';
        const actCol = item.indicator_color_active || 'var(--primary-color)';
        const defCol = item.indicator_color_default || 'inherit';

        const actIcon = item.indicator_icon_active || item.icon || '';
        const defIcon = item.indicator_icon_default || item.icon || '';

        const shape = item.indicator_shape || 'rect';
        const radius = shape === 'circle' ? '50%' : (item.indicator_radius || '8px');

        base.container = {
          isIndicator: true,
          active: indActive,
          shape: shape,
          radius: radius,
          bgColor: indActive ? actBg : defBg,
          color: indActive ? actCol : defCol
        };

        base.icon.enabled = true;
        base.icon.name = indActive ? actIcon : defIcon;
        base.icon.color = indActive ? actCol : defCol;
        base.text.color = indActive ? actCol : defCol;
      }

      return base;
    });

    return {
      moduleData: { labelsResolved },
      staticKey: `labels-v2-${JSON.stringify(config.labels_list)}`
    };
  }

  return /** @type {SupercardModule} */ ({ update });
})());