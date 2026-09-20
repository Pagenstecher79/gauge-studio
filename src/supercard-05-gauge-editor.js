import { LitElement, html, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { dialFromStartAngle, startAngleFromDial } from "./gauge-angle.js";
import { GAUGE_DEFAULT } from "./element-templates.js";
import { gradientPresetPatch } from "./gradient-presets.js";
import { icon } from "./icons.js";
import { isPointerGlass, lensFitsPointer, pointerBlurPx } from "./pointer-glass.js";

const SC = window.SupercardUtils;

window.SupercardModules = window.SupercardModules || {};
window.SupercardModules['gauge'] = window.SupercardModules['gauge'] || {};

Object.assign(window.SupercardModules['gauge'], (() => {

function editorFields() {}

/**
 * What a gauge is before anyone configures it.
 *
 * The canvas adds gauges too, and it has no business knowing what one
 * contains - that is this module's, so both add buttons ask here.
 */
function newEntry() {
  return { entity: '', gauge_attribute: '', ...structuredClone(GAUGE_DEFAULT) };
}

/**
 * Whether the gauge is drawn at a size and a place of its own.
 *
 * The renderer lays a responsive gauge out with width and height at 100% and
 * skips the anchor map entirely, so the size, the anchor and the two offsets
 * do nothing whenever this is false - on a canvas always, because there the
 * element's box is both the size and the position. Asking the same helper the
 * renderer asks is what keeps the two answers from drifting apart.
 */
const hasOwnBox = (cfg, slot) => !SC.gaugeIsResponsive(cfg, !!slot?.canvas);

/**
 * A whole scale in one choice.
 *
 * Setting a dial up used to mean finding good numbers for a dozen fields that
 * only make sense together - a tick count that suits the range, a length that
 * suits the ring, a font that suits both. These are those numbers, worked out
 * once. A preset writes only the keys it names: colours, offsets and the
 * distance from the ring are taste, and stay whatever the card already had.
 *
 * Nothing records which preset was picked. It is a starting point, not a mode
 * - every field it wrote stays as editable as before, and the next preset
 * starts from its own numbers rather than from the last one's.
 */
/**
 * The `framedBy` names that belong to a ring rather than to a piece of text.
 * The two are framed on the canvas in different ways, so the line that says so
 * has to say which.
 */
const RING_PARTS = new Set(['frame_ring', 'gauge_ring', 'ticks', 'sub_ticks', 'tick_labels',
                            'pointer', 'pointer_center']);

/**
 * A scale to start from: how many marks, and whether they are numbered.
 *
 * `patch` is what the preset means and is always written. `sizes` is only its
 * taste in how long and how thick the marks are, and that is written where the
 * gauge says nothing and nowhere else - someone who has drawn their ticks the
 * length they want is picking a different number of them here, not asking for
 * that work to be thrown away. Where a length *is* the preset - "Labels only"
 * is ticks of no length at all - it sits in `patch` where it belongs.
 */
const TICK_PRESETS = Object.freeze({
  fine: { label: 'Fine',
    patch: { tick_count: 21, sub_tick_count: 4,
      show_tick_labels: true, tick_label_step: 0, tick_label_stagger: false },
    sizes: { tick_length: 2.5, tick_width: 0.8,
      sub_tick_length: 1.2, sub_tick_width: 0.5, tick_label_font_size: 5 } },
  coarse: { label: 'Coarse',
    patch: { tick_count: 11, sub_tick_count: 0,
      show_tick_labels: true, tick_label_step: 0, tick_label_stagger: false },
    sizes: { tick_length: 3.5, tick_width: 1.2, tick_label_font_size: 6 } },
  classic: { label: 'Classic dial',
    patch: { tick_count: 11, sub_tick_count: 4,
      show_tick_labels: true, tick_label_step: 0, tick_label_stagger: false },
    sizes: { tick_length: 4, tick_width: 1.4,
      sub_tick_length: 2, sub_tick_width: 0.7, tick_label_font_size: 6 } },
  labels: { label: 'Labels only',
    patch: { tick_count: 11, tick_length: 0, tick_width: 0, sub_tick_count: 0,
      show_tick_labels: true, tick_label_step: 0, tick_label_stagger: false },
    sizes: { tick_label_font_size: 6 } },
  none: { label: 'No scale',
    patch: { tick_count: 0, sub_tick_count: 0, show_tick_labels: false } },
});

/** What a preset writes onto the gauge it is dropped on. */
const presetPatch = (/** @type {any} */ preset, /** @type {any} */ cfg) => {
  const out = { ...preset.patch };
  for (const [k, v] of Object.entries(preset.sizes || {})) {
    const had = cfg?.[k];
    if (had === undefined || had === null || had === '') out[k] = v;
  }
  return out;
};

const STYLE_FIELDS = [
  { id: '_section_shape',      icon: icon('proportions'), label: '── Shape & Position',    type: 'section' },
  { id: 'gauge_type',          label: 'Gauge type',             type: 'select', options: [ { value: 'full', label: 'Full 360°' }, { value: 'semi', label: 'Semi 270°' } ] },
  // Four positions used to be the whole offer here, on a dial that has 360 of
  // them. The slider reads clockwise from the top and `gauge-angle.js` turns
  // that into the angle the renderer draws with - see there for why the stored
  // unit is not the shown one. A semi gauge has no say in this: its 270 degree
  // arc is anchored where the gap looks right.
  //
  // The fallback is the renderer's own: a gauge nobody has switched is a full
  // one, the select above shows it as such, and the control must not be missing
  // on the very gauge that has just been added.
  { id: 'gauge_start_angle',   label: 'Start position (° clockwise from the top)', type: 'range', min: 0, max: 359, step: 1, placeholder: '0',
                               fromStored: dialFromStartAngle, toStored: startAngleFromDial,
                               framedBy: ['gauge_ring', 'pointer'],
                               condition: cfg => (cfg.gauge_type ?? 'full') === 'full' },
  { id: 'gauge_scale',         label: 'Scale',            type: 'range',    min: 0.2, max: 1, step: 0.01,  placeholder: '1', framedBy: 'frame_ring'  },

  // The anchor and the two offsets below place a gauge inside a box it does not
  // fill. A canvas element's box is that place - you drag it - so the renderer
  // ignores all three there, and a control that does nothing is worse than a
  // missing one: it reads like a second, contradicting answer to a question the
  // box has already settled.
  { id: 'gauge_position_mode', label: 'Anchor point / position', type: '9-sector', condition: hasOwnBox },
  // The switch itself is the exception. It is how a card off the canvas gives
  // the gauge its own box back, so it has to stay visible once it is on -
  // hiding it would lock whoever ticked it out of unticking it.
  { id: 'gauge_size_responsive', label: 'Responsive size (auto scaling)', type: 'checkbox', condition: (cfg, slot) => !slot?.canvas },
  { id: 'gauge_size_px',         label: 'Size (px)',            type: 'range',    min: 0, max: 600, step: 1, placeholder: '60', condition: hasOwnBox },
  { id: 'gauge_offset_x',      label: 'Offset X (px)',         type: 'range',    min: -25, max: 25, step: 0.1,  placeholder: '0', condition: hasOwnBox },
  { id: 'gauge_offset_y',      label: 'Offset Y (px)',         type: 'range',    min: -25, max: 25, step: 0.1,  placeholder: '0', condition: hasOwnBox },

  { id: '_section_frame',           icon: icon('circle'), label: '── Frame Ring',               type: 'section'  },
  { id: 'frame_ring_active',        label: 'Frame active',                 type: 'checkbox', framedBy: 'frame_ring' },
  { id: 'frame_ring_closed',        label: 'Closed circle',          type: 'checkbox', framedBy: 'frame_ring', condition: cfg => !!cfg.frame_ring_active },
  { id: 'frame_ring_width',         label: 'Width',                       type: 'range',    min: 0, max: 8, step: 0.1,  placeholder: '1.5', framedBy: 'frame_ring', condition: cfg => !!cfg.frame_ring_active },
  { id: 'frame_ring_gap',           label: 'Gap to gradient ring',   type: 'range',    min: 0, max: 6, step: 0.1,  placeholder: '1.5', framedBy: 'frame_ring', condition: cfg => !!cfg.frame_ring_active },
  { id: 'frame_ring_color_type',    framedBy: 'frame_ring', label: 'Colour mode',                   type: 'select',   options: [ { value: 'fixed', label: 'Fixed' }, { value: 'adaptive', label: 'Adaptive' } ], condition: cfg => !!cfg.frame_ring_active },
  { id: 'frame_ring_color',         framedBy: 'frame_ring', label: 'Colour (fixed)',                  type: 'color',    condition: cfg => !!cfg.frame_ring_active && cfg.frame_ring_color_type !== 'adaptive' },
  { id: 'frame_ring_opacity',       label: 'Opacity',                    type: 'range',    min: 0, max: 1, step: 0.01,  placeholder: '1.0', framedBy: 'frame_ring', condition: cfg => !!cfg.frame_ring_active },

  { id: '_section_bg',           icon: icon('image'), label: '── Background',             type: 'section' },
  { id: 'bg_mode',               label: 'Background mode',          type: 'select', options: [ { value: 'none', label: 'None' }, { value: 'adaptive', label: 'Adaptive (theme)' }, { value: 'solid', label: 'Solid colour' }, { value: 'linear', label: 'Linear gradient' }, { value: 'radial', label: 'Radial gradient' } ] },
  { id: 'bg_gradient_preset',    label: 'Gradient type',                type: 'select', options: [ { value: 'classic', label: 'Classic (2 colours)' }, { value: 'manual', label: 'Manual (list)' } ], condition: cfg => ['linear', 'radial'].includes(cfg.bg_mode) },
  { id: 'bg_threshold_unit',     label: 'Threshold unit',          type: 'select',
    hint: 'Thresholds can be given as absolute values or in %.', options: [ { value: 'percent', label: 'Percent (%)' }, { value: 'absolute', label: 'Absolute' } ], condition: cfg => ['linear', 'radial'].includes(cfg.bg_mode) && cfg.bg_gradient_preset === 'manual' },
  { id: 'bg_opacity',            label: 'Opacity',                  type: 'range',    min: 0, max: 1, step: 0.01, placeholder: '1.0' },
  { id: 'bg_color1',             label: 'Colour 1 (inner / start)',    type: 'color',  condition: cfg => ['solid', 'linear', 'radial'].includes(cfg.bg_mode) && cfg.bg_gradient_preset !== 'manual' },
  { id: 'bg_color2',             label: 'Colour 2 (outer / end)',     type: 'color',  condition: cfg => ['linear', 'radial'].includes(cfg.bg_mode) && cfg.bg_gradient_preset !== 'manual' },
  { id: 'bg_balance',            label: 'Balance (%)',                type: 'range',    min: 0, max: 100, step: 0.1, placeholder: '50', condition: cfg => ['linear', 'radial'].includes(cfg.bg_mode) && cfg.bg_gradient_preset !== 'manual' },
  { id: 'bg_gradient_angle',     label: 'Angle (° linear only)',      type: 'range',    min: 0, max: 360, step: 1, placeholder: '135', condition: cfg => cfg.bg_mode === 'linear' },
  { id: 'bg_manual_stops',       type: 'bg_manual_stops', condition: cfg => ['linear', 'radial'].includes(cfg.bg_mode) && cfg.bg_gradient_preset === 'manual' },

  // Last of the section's own fields, so it sits under the background colours
  // and above the two threshold folds. Only on a canvas: the pattern paints
  // the box the renderer names, and without one there is no box.
  { id: '_colour_pattern', type: 'colour_pattern', condition: (cfg, slot) => !!slot?.canvas },

  { id: '_section_bg_threshold',          label: '── Background Colour (Threshold)', type: 'subsection' },
  { id: 'bg_color_threshold_active',      label: 'Threshold active',            type: 'checkbox' },
  { id: 'bg_color_threshold_operator',    label: 'Operator',                     type: 'select', options: [ { value: '>', label: '> Greater than' }, { value: '<', label: '< Less than' }, { value: '>=', label: '>= Greater or equal' }, { value: '<=', label: '<= Less or equal' }, { value: '==', label: '== Equal' } ], condition: cfg => !!cfg.bg_color_threshold_active },
  { id: 'bg_color_threshold_value',       label: 'Threshold',                  type: 'number',  placeholder: '80', condition: cfg => !!cfg.bg_color_threshold_active },
  { id: 'bg_color_threshold_hysteresis',  label: 'Hysteresis (%)',                type: 'range', min: 0, max: 10, step: 0.1, placeholder: '5', condition: cfg => !!cfg.bg_color_threshold_active },
  { id: 'bg_color_threshold_color',       label: 'New background colour',        type: 'color', condition: cfg => !!cfg.bg_color_threshold_active },

  { id: '_section_threshold_anim',          label: '── Threshold Animation',           type: 'subsection'  },
  { id: 'bg_threshold_anim_active',         label: 'Animation active',                  type: 'checkbox' },
  { id: 'bg_threshold_anim_operator',       label: 'Operator',                         type: 'select',   options: [ { value: '>', label: '> Greater than' }, { value: '<', label: '< Less than' }, { value: '>=', label: '>= Greater or equal' }, { value: '<=', label: '<= Less or equal' }, { value: '==', label: '== Equal' } ], condition: cfg => !!cfg.bg_threshold_anim_active },
  { id: 'bg_threshold_anim_value',          label: 'Threshold',                      type: 'number',   placeholder: '80',  condition: cfg => !!cfg.bg_threshold_anim_active },
  { id: 'bg_threshold_anim_hysteresis',     label: 'Hysteresis (%)',                    type: 'range',    min: 0, max: 10, step: 0.5, placeholder: '5', condition: cfg => !!cfg.bg_threshold_anim_active },
  { id: 'bg_threshold_anim_type',           label: 'Animation type',                    type: 'select',   options: [ { value: 'pulse_bg', label: 'Pulse — background' }, { value: 'pulse_frame', label: 'Pulse — frame ring' }, { value: 'ripple', label: 'Ripple — water wave' }, { value: 'waves', label: 'Waves (linear traveling)' }, { value: 'wobble_radial', label: 'Water drop (radial fade-out)' }, { value: 'wobble_linear', label: 'Shockwave (linear fade-out)' } ], condition: cfg => !!cfg.bg_threshold_anim_active },
  { id: 'bg_threshold_anim_color',          label: 'Animation colour (C1)',             type: 'color',    condition: cfg => !!cfg.bg_threshold_anim_active },
  { id: 'bg_threshold_anim_color2',         label: 'Animation colour 2 (trough)',          type: 'color',    condition: cfg => !!cfg.bg_threshold_anim_active && ['waves', 'wobble_radial', 'wobble_linear'].includes(cfg.bg_threshold_anim_type) },
  { id: 'bg_threshold_anim_duration',       label: 'Duration (s)',                        type: 'number',   step: 0.1, placeholder: '1.5', condition: cfg => !!cfg.bg_threshold_anim_active },
  { id: 'bg_threshold_wave_count',          label: 'Count (density)',                  type: 'range',    min: 1, max: 20, step: 1, placeholder: '3', condition: cfg => !!cfg.bg_threshold_anim_active && ['waves', 'wobble_radial', 'wobble_linear'].includes(cfg.bg_threshold_anim_type) },
  { id: 'bg_threshold_wave_balance',        label: 'Balance (peak vs. trough)',           type: 'range',    min: 5, max: 95, step: 1, placeholder: '50', condition: cfg => !!cfg.bg_threshold_anim_active && ['waves', 'wobble_radial', 'wobble_linear'].includes(cfg.bg_threshold_anim_type) },
  { id: 'bg_threshold_gradient_angle',      label: 'Angle (°)',                       type: 'range',    min: 0, max: 360, step: 1, placeholder: '90', condition: cfg => !!cfg.bg_threshold_anim_active && ['waves', 'wobble_linear'].includes(cfg.bg_threshold_anim_type) },
  { id: 'bg_threshold_wobble_amplitude',    label: 'Start amplitude (contrast)',       type: 'range',    min: 1, max: 100, step: 1, placeholder: '100', condition: cfg => !!cfg.bg_threshold_anim_active && ['wobble_radial', 'wobble_linear'].includes(cfg.bg_threshold_anim_type) },
  { id: 'bg_threshold_wobble_freq',         label: 'Range (spread)',         type: 'range',    min: 1, max: 10, step: 1, placeholder: '4', condition: cfg => !!cfg.bg_threshold_anim_active && ['wobble_radial', 'wobble_linear'].includes(cfg.bg_threshold_anim_type) },
  { id: 'bg_threshold_wobble_pause',        label: 'Pause after effect (sec.)',         type: 'range',    min: 0, max: 10, step: 0.5, placeholder: '2', condition: cfg => !!cfg.bg_threshold_anim_active && ['wobble_radial', 'wobble_linear'].includes(cfg.bg_threshold_anim_type) },
  { id: 'bg_threshold_anim_ripple_multi',   label: 'Multiple ripple rings (3×)',        type: 'checkbox', condition: cfg => !!cfg.bg_threshold_anim_active && cfg.bg_threshold_anim_type === 'ripple' },
  { id: 'bg_threshold_anim_ripple_inv',     label: 'Implosion (reverse direction)',    type: 'checkbox', condition: cfg => !!cfg.bg_threshold_anim_active && ['ripple', 'waves'].includes(cfg.bg_threshold_anim_type) },

  { id: '_section_data',        icon: icon('chart-column'), label: '── Data & Scaling',  type: 'section' },
  { id: 'min',                  label: 'Min value',               type: 'number', placeholder: '0'   },
  { id: 'max',                  label: 'Max value',               type: 'number', placeholder: '100' },
  { id: 'value_autorange',      label: 'Auto-range',             type: 'checkbox' },
  { id: 'value_autoscale',      label: 'Auto-scale k/M/G',       type: 'checkbox' },
  { id: 'dynamic_max_scale',    label: 'Dynamic max',        type: 'checkbox' },
  { id: 'autoscale_hysteresis', label: 'Hysteresis (%)',          type: 'number', placeholder: '10'  },

  { id: '_section_color',    icon: icon('palette'), label: '── Colour & Gradient',   type: 'section' },
  { id: 'stroke_width',        label: 'Ring thickness',            type: 'range',    min: 0, max: 5, step: 0.01,  placeholder: '3', framedBy: 'gauge_ring'   },
  { id: 'gradient_ramp',     type: 'gradient_ramp', condition: cfg => ['manual', undefined, ''].includes(cfg.gradient_preset) },
  { id: 'gradient_preset',   label: 'Colour mode',             type: 'select', framedBy: 'gauge_ring', options: [ { value: 'manual', label: 'Manual (list)' }, { value: 'symmetriccustom', label: 'Symmetric (custom)' }, { value: 'symmetric', label: 'Symmetric (default)' }, { value: 'linear', label: 'Linear traffic light' } ] },

  { id: 'gradient_mode', framedBy: 'gauge_ring',     label: 'Gradient type',           type: 'select', options: [ { value: 'smooth', label: 'Smooth' }, { value: 'stepped', label: 'Stepped' } ], condition: cfg => ['manual', undefined].includes(cfg.gradient_preset) },
  { id: 'gradient_resolution', framedBy: 'gauge_ring', label: 'Gradient resolution', type: 'select', options: [ { value: 'auto', label: 'Automatic (size-dependent)' }, { value: 'coarse', label: 'Coarse (1× colour zones)' }, { value: 'medium', label: 'Medium (12× colour zones)' }, { value: 'fine', label: 'Fine (24×) — default' }, { value: 'superfine', label: 'Superfine (48×)' }, { value: 'ultrafine', label: 'Ultrafine (96×)' }, { value: 'megafine', label: 'Megafine (192×)' }  ]},

  { id: 'threshold_unit',    label: 'Threshold unit',     type: 'select',
    hint: 'Thresholds can be given as absolute values or in %.', options: [ { value: 'percent', label: 'Percent (%)' }, { value: 'absolute', label: 'Absolute' } ], condition: cfg => ['manual', undefined].includes(cfg.gradient_preset) },
  { id: 'gradient_start',    label: 'Gradient start',        type: 'number', placeholder: 'auto', condition: cfg => ['manual', undefined].includes(cfg.gradient_preset) },
  { id: 'gradient_end',      label: 'Gradient end',         type: 'number', placeholder: 'auto', condition: cfg => ['manual', undefined].includes(cfg.gradient_preset) },

  { id: 'manual_stops',      type: 'manual_stops', condition: cfg => ['manual', undefined].includes(cfg.gradient_preset) },

  { id: 'color1',     label: 'Outer colour', framedBy: 'gauge_ring',    type: 'color',  condition: cfg => ['symmetric', 'symmetriccustom'].includes(cfg.gradient_preset) },
  { id: 'color2',     label: 'Middle colour', framedBy: 'gauge_ring',    type: 'color',  condition: cfg => ['symmetric', 'symmetriccustom'].includes(cfg.gradient_preset) },
  { id: 'color3',     label: 'Centre colour', framedBy: 'gauge_ring',  type: 'color',  condition: cfg => ['symmetric', 'symmetriccustom'].includes(cfg.gradient_preset) },
  { id: 'threshold1', label: 'Transition centre→middle (%)', framedBy: 'gauge_ring', type: 'range', min: 0, max: 98, step: 1, placeholder: '40', condition: cfg => cfg.gradient_preset === 'symmetriccustom' },
  { id: 'threshold2', label: 'Transition middle→outer (%)', framedBy: 'gauge_ring', type: 'range', min: 0, max: 100, step: 1, placeholder: '75', condition: cfg => cfg.gradient_preset === 'symmetriccustom' },
  { id: 'threshold3', label: 'Gradient width transition 1 (%)', framedBy: 'gauge_ring', type: 'range', min: 0.5, max: 30, step: 0.5, placeholder: '8', condition: cfg => cfg.gradient_preset === 'symmetriccustom' },
  { id: 'threshold4', label: 'Gradient width transition 2 (%)', framedBy: 'gauge_ring', type: 'range', min: 0.5, max: 30, step: 0.5, placeholder: '8', condition: cfg => cfg.gradient_preset === 'symmetriccustom' },

  { id: 'color1',     label: 'Start colour', framedBy: 'gauge_ring',    type: 'color',  condition: cfg => cfg.gradient_preset === 'linear' },
  { id: 'color2',     label: 'Middle colour', framedBy: 'gauge_ring',    type: 'color',  condition: cfg => cfg.gradient_preset === 'linear' },
  { id: 'color3',     label: 'End colour', framedBy: 'gauge_ring',     type: 'color',  condition: cfg => cfg.gradient_preset === 'linear' },
  { id: 'threshold1', label: 'Start spread (%)', framedBy: 'gauge_ring', type: 'range', min: 0, max: 100, step: 1, placeholder: '20', condition: cfg => cfg.gradient_preset === 'linear' },
  { id: 'threshold2', label: 'Mid spread (%)', framedBy: 'gauge_ring', type: 'range', min: 0, max: 100, step: 1, placeholder: '60', condition: cfg => cfg.gradient_preset === 'linear' },

  { id: '_section_pointer',       icon: icon('compass'), label: '── Pointer',                  type: 'section' },
  { id: 'pointer_type',           label: 'Pointer shape',                type: 'select',  options: [ { value: 'needle', label: 'Needle' }, { value: 'triangle', label: 'Triangle' } ], framedBy: 'pointer' },
  { id: 'pointer_width',          label: 'Pointer width',              type: 'range',    min: 0, max: 5, step: 0.1,   placeholder: '2', framedBy: 'pointer'   },
  { id: 'pointer_length',         label: 'Pointer length',               type: 'range',    min: 0, max: 50, step: 0.1,  placeholder: '10', framedBy: 'pointer'  },
  { id: 'pointer_offset',         label: 'Pointer offset from ring',     type: 'range',    min: -10, max: 10, step: 0.1,  placeholder: '2', framedBy: 'pointer'   },
  { id: 'pointer_center_radius',  label: 'Centre point size',          type: 'range',    min: 0, max: 10, step: 0.1, placeholder: '2', framedBy: 'pointer_center'   },
  { id: 'pointer_color_type', framedBy: 'pointer',     label: 'Pointer colour mode',          type: 'select',  options: [ { value: 'fixed', label: 'Fixed' }, { value: 'adaptive', label: 'Adaptive' } ] },
  { id: 'pointer_color', framedBy: 'pointer',          label: 'Pointer colour (fixed)',         type: 'color',   condition: cfg => cfg.pointer_color_type !== 'adaptive' },
  { id: 'pointer_3d_effect', framedBy: 'pointer',      label: '3D effect (plastic)',      type: 'checkbox',
    condition: cfg => !isPointerGlass(cfg.pointer_glass) },
  // Glass is a material the needle is made of, so it stands with the shape
  // and the colour rather than among the shadow's settings. The liquid
  // option appears only on a needle wide enough to show a bend - see
  // POINTER_LENS_MIN_WIDTH - because 12 % of a thin needle is half a pixel
  // and the option would promise something it cannot draw.
  { id: 'pointer_glass', framedBy: 'pointer', label: 'Pointer glass', type: 'select',
    options: cfg => [
      { value: 'none', label: 'None' },
      { value: 'glass', label: 'Glass' },
      ...(lensFitsPointer(cfg.pointer_width ?? 2)
        ? [{ value: 'glass_liquid', label: 'Liquid glass (refracting)' }]
        : []),
    ] },
  { id: 'pointer_glass_blur', framedBy: 'pointer', label: 'Pointer glass blur (px)',
    type: 'range', min: 0, max: 6, step: 0.5, placeholder: '0',
    condition: cfg => isPointerGlass(cfg.pointer_glass) },
  { type: 'note', bare: true, class: '', icon: icon('gauge'),
    style: 'font-size:11px; color:var(--secondary-text-color); margin:-2px 0 4px 0;',
    condition: cfg => isPointerGlass(cfg.pointer_glass)
                   && pointerBlurPx(cfg.pointer_glass_blur) > 0,
    label: 'A blur behind a turning needle is the expensive half: measured, 32 '
         + 'gauges cost a quarter of the frame rate and 64 cost a third. At 0 it '
         + 'is off entirely, and the lit rim costs nothing at all.' },
  { id: 'pointer_dot_color_type', framedBy: 'pointer_center', label: 'Dot colour mode',           type: 'select',  options: [ { value: 'fixed', label: 'Fixed' }, { value: 'adaptive', label: 'Adaptive' } ] },
  { id: 'pointer_dot_color', framedBy: 'pointer_center',      label: 'Dot colour (fixed)',          type: 'color',   condition: cfg => cfg.pointer_dot_color_type !== 'adaptive' },
  // The centre point does not move, and glass costs nothing that does not
  // move: measured at 64 gauges with the needles turning beside it, a glassed
  // hub was still 120 fps. So it is offered whole - both effects and the
  // blur - with no gate and no warning.
  { id: 'pointer_center_glass', framedBy: 'pointer_center', label: 'Centre point glass',
    type: 'select', options: [
      { value: 'none', label: 'None' },
      { value: 'glass', label: 'Glass' },
      { value: 'glass_liquid', label: 'Liquid glass (refracting)' },
    ] },
  { id: 'pointer_center_glass_blur', framedBy: 'pointer_center', label: 'Centre point glass blur (px)',
    type: 'range', min: 0, max: 6, step: 0.5, placeholder: '0',
    condition: cfg => isPointerGlass(cfg.pointer_center_glass) },
  { id: 'pointer_shadow_type', framedBy: 'pointer',    label: 'Pointer shadow',            type: 'select',  options: [ { value: 'none', label: 'None' }, { value: 'fixed', label: 'Fixed' }, { value: 'adaptive', label: 'Adaptive' } ] },
  { id: 'pointer_shadow_color', framedBy: 'pointer',   label: 'Shadow colour',             type: 'color',   condition: cfg => cfg.pointer_shadow_type === 'fixed' },
  { id: 'pointer_shadow_blur', framedBy: 'pointer',     label: 'Shadow blur',   type: 'range', min: 0,  max: 1, step: 0.01,  placeholder: '0.8', condition: cfg => cfg.pointer_shadow_type !== 'none' },
  // Not 'offset Y': the offset is only vertical while the angle is 90 degrees,
  // which is merely its default. The renderer still reads the old key for
  // configs written before the angle had a control.
  { id: 'pointer_shadow_distance', framedBy: 'pointer', label: 'Shadow distance',       type: 'range', min: -5, max: 5, step: 0.1,  placeholder: '0.5', condition: cfg => cfg.pointer_shadow_type !== 'none' },
  { id: 'pointer_shadow_angle', framedBy: 'pointer',    label: 'Shadow angle',          type: 'range', min: 0, max: 360, step: 5,   placeholder: '90',  condition: cfg => cfg.pointer_shadow_type !== 'none' },
  { id: 'pointer_shadow_opacity', framedBy: 'pointer',  label: 'Shadow opacity',        type: 'range', min: 0,  max: 1, step: 0.05, placeholder: '0.35', condition: cfg => cfg.pointer_shadow_type !== 'none' },
  { id: 'animation_duration',     label: 'Animation duration (s)',       type: 'range',    min: 0, max: 10, step: 0.1, placeholder: '0.8', condition: cfg => cfg.animation_easing !== 'spring' },
  { id: 'animation_spring_duration', label: 'Spring animation duration (s)', type: 'range', min: 0.1, max: 10, step: 0.1, placeholder: '1.5', condition: cfg => cfg.animation_easing === 'spring' },
  { id: 'animation_dynamic_speed',label: 'Dynamic pointer acceleration', type: 'checkbox' },
  { id: 'animation_dynamic_speed_invert', label: 'Invert acceleration (long paths fast)', type: 'checkbox', condition: cfg => !!cfg.animation_dynamic_speed },
  { id: 'animation_easing',       label: 'Pointer settling (easing)', type: 'select', options: [
    { value: 'smooth', label: 'Smooth (default)' },
    { value: 'overshoot_light', label: 'Light overshoot' },
    { value: 'overshoot_medium', label: 'Medium overshoot' },
    { value: 'overshoot_heavy', label: 'Heavy overshoot' },
    { value: 'elastic', label: 'Elastic (rubber band)' },
    { value: 'spring', label: 'Physical spring (multi-bounce)' }
  ] },
  { id: 'animation_spring_bounces', label: 'Number of overshoots', type: 'range', min: 1, max: 10, step: 1, placeholder: '3', condition: cfg => cfg.animation_easing === 'spring' },
  { id: 'animation_spring_amplitude', label: 'Spring amplitude (intensity %)', type: 'range', min: 0, max: 100, step: 1, placeholder: '50', condition: cfg => cfg.animation_easing === 'spring' },

  { id: '_section_ticks',           icon: icon('ruler'), label: '── Ticks',                    type: 'section' },
  { id: 'tick_preset',              type: 'tick_preset' },
  { id: 'tick_count',               label: 'Tick count',                 type: 'range',    min: 0, max: 50, step: 1,   placeholder: '0', framedBy: 'ticks'   },
  { id: 'tick_length',              label: 'Tick length',                  type: 'range',    min: 0, max: 6, step: 0.1,   placeholder: '3', framedBy: 'ticks'   },
  { id: 'tick_width',               label: 'Tick width',                 type: 'range',    min: 0, max: 5, step: 0.1,   placeholder: '1', framedBy: 'ticks'   },
  { id: 'tick_offset',              label: 'Tick offset from ring',        type: 'range',    min: -10, max: 10, step: 0.1,   placeholder: '0', framedBy: 'ticks'   },
  { id: 'tick_color_type', framedBy: 'ticks',          label: 'Tick colour mode',             type: 'select',   options: [ { value: 'fixed', label: 'Fixed' }, { value: 'adaptive', label: 'Adaptive' } ] },
  { id: 'tick_color', framedBy: 'ticks',               label: 'Tick colour (fixed)',            type: 'color',   condition: cfg => cfg.tick_color_type !== 'adaptive' },

  { id: '_section_sub_ticks',       label: '── SubTicks',                 type: 'subsection' },
  { id: 'sub_tick_count',           label: 'Sub-tick count (between)',type: 'range',    min: 0, max: 10, step: 1,   placeholder: '0', framedBy: 'sub_ticks'   },
  { id: 'sub_tick_length',          label: 'Sub-tick length',              type: 'range',    min: 0, max: 3, step: 0.1,   placeholder: '1.5', framedBy: 'sub_ticks' },
  { id: 'sub_tick_width',           label: 'Sub-tick width',             type: 'range',    min: 0, max: 3, step: 0.1,   placeholder: '0.5', framedBy: 'sub_ticks' },
  { id: 'sub_tick_offset',          label: 'Sub-tick offset from ring',    type: 'range',    min: -10, max: 10, step: 0.1,   placeholder: '0', framedBy: 'sub_ticks'   },
  { id: 'sub_tick_color_type', framedBy: 'sub_ticks',      label: 'Sub-tick colour mode',         type: 'select',   options: [ { value: 'fixed', label: 'Fixed' }, { value: 'adaptive', label: 'Adaptive' } ] },
  { id: 'sub_tick_color', framedBy: 'sub_ticks',           label: 'Sub-tick colour (fixed)',        type: 'color',    condition: cfg => cfg.sub_tick_color_type !== 'adaptive' },

  { id: '_section_ticks_label',     label: '── Tick Label',               type: 'subsection'},
  { id: 'show_tick_labels',         label: 'Show tick labels',        type: 'checkbox' },
  { id: 'tick_label_step', framedBy: 'tick_labels',        label: 'Label interval',             type: 'range',    min: 0, max: 10, step: 1, placeholder: 'Auto', condition: cfg => !!cfg.show_tick_labels,
    hint: 'Left at nought the card labels as many ticks as stand clear of each other, and works that out again whenever the tick count, the type or the size of the card changes. A number of your own overrides it.' },
  { id: 'tick_label_stagger', framedBy: 'tick_labels',     label: 'Keep every label, on two rows', type: 'checkbox', condition: cfg => !!cfg.show_tick_labels && !parseInt(cfg.tick_label_step || 0),
    hint: 'Rather than labelling fewer ticks, send the crowded ones out by a row. Each label stays over its own tick.' },
  { id: 'tick_label_font_size',     label: 'Label font size',          type: 'range',    min: 0, max: 20, step: 0.5, placeholder: '7',  condition: cfg => !!cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_label_offset',        label: 'Label distance from ring',      type: 'range',    min: -15, max: 15, step: 0.1,  placeholder: '-8', condition: cfg => !!cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_label_join_ends', framedBy: 'tick_labels',    label: 'Join both ends into one label', type: 'checkbox', condition: cfg => !!cfg.show_tick_labels && (cfg.gauge_type ?? 'full') === 'full',
    hint: 'A full circle ends where it began, so both readings share a tick. Off, only the starting one is drawn.' },
  { id: 'tick_label_decimals', framedBy: 'tick_labels',      label: 'Label decimals',        type: 'range',    min: 0, max: 6, step: 1,   placeholder: '0',  condition: cfg => !!cfg.show_tick_labels },
  { id: 'tick_label_color_type', framedBy: 'tick_labels',    label: 'Label colour mode',            type: 'select',   options: [ { value: 'adaptive', label: 'Adaptive' }, { value: 'fixed', label: 'Fixed' } ], condition: cfg => !!cfg.show_tick_labels },
  { id: 'tick_label_color', framedBy: 'tick_labels',         label: 'Label colour (fixed)',           type: 'color',    condition: cfg => !!cfg.show_tick_labels && cfg.tick_label_color_type !== 'adaptive' },

  // The four below decide nothing about how a scale reads and are set once in a
  // card's life if ever, so they sit behind a fold rather than between the
  // settings someone reaches for every time.
  { id: '_section_ticks_fine',      label: '── Fine tuning',              type: 'subsection' },
  { id: 'tick_label_extra_length', framedBy: 'tick_labels',  label: 'Label tick extra length',      type: 'range',    min: 0, max: 4, step: 0.1,   placeholder: '0',  condition: cfg => !!cfg.show_tick_labels },
  { id: 'tick_label_inherit_color', framedBy: 'tick_labels', label: 'Inherit colour from tick',        type: 'checkbox', condition: cfg => !!cfg.show_tick_labels },
  { id: 'tick_label_crossfade_dur', label: 'Crossfade duration (s)',     type: 'range',    min: 0, max: 3, step: 0.1, placeholder: '0.4', condition: cfg => !!cfg.show_tick_labels },
  { id: 'multiplier_divide_ticks', framedBy: 'multiplier', label: 'Divide tick labels by multiplier', type: 'checkbox', condition: cfg => !!cfg.show_tick_labels },

  { id: '_section_custom_ticks',    label: '── Custom Ticks (Fixed Points)', type: 'subsection' },
  { id: 'custom_ticks',             type: 'custom_ticks' },

  { id: '_section_sectors',         icon: icon('chart-pie'), label: '── Sectors (Areas)',       type: 'section' },
  { id: 'sectors',                  type: 'sectors' },

  { id: '_section_labels',        icon: icon('hash'), label: '── Value & Labels',           type: 'section' },
  { id: 'show_value',             label: 'Show value',              type: 'checkbox' },
  { id: 'value_font_size',        label: 'Value font size',          type: 'range',    min: 0, max: 20, step: 0.1,  placeholder: '12',  condition: cfg => !!cfg.show_value, framedBy: 'value' },
  { id: 'value_font_weight',      label: 'Value weight',             type: 'select',   options: [ { value: '400', label: 'Normal' }, { value: '500', label: 'Medium' }, { value: '700', label: 'Bold' } ], condition: cfg => !!cfg.show_value, framedBy: 'value' },
  { id: 'value_offset_x',         label: 'Value offset X',              type: 'range',    min: -25, max: 25, step: 0.1,  placeholder: '0',  condition: cfg => !!cfg.show_value, framedBy: 'value' },
  { id: 'value_offset_y',         label: 'Value offset Y',              type: 'range',    min: -25, max: 25, step: 0.1,  placeholder: '0',  condition: cfg => !!cfg.show_value, framedBy: 'value' },
  { id: 'value_color_type', framedBy: 'value',       label: 'Value colour mode',            type: 'select',  options: [ { value: 'adaptive', label: 'Adaptive' }, { value: 'fixed', label: 'Fixed' } ], condition: cfg => !!cfg.show_value },
  { id: 'value_color', framedBy: 'value',            label: 'Value colour (fixed)',           type: 'color',   condition: cfg => !!cfg.show_value && cfg.value_color_type !== 'adaptive' },
  { id: 'value_decimals', framedBy: 'value',         label: 'Decimals',             type: 'range',    min: 0, max: 6, step: 1, placeholder: '0',   condition: cfg => !!cfg.show_value },
  { id: 'value_show_raw_unit', framedBy: 'value',    label: 'Show unit',           type: 'checkbox', condition: cfg => !!cfg.show_value },
  { id: 'value_replace_unit', framedBy: 'value',     label: 'Replace original unit',  type: 'checkbox', condition: cfg => !!cfg.show_value && !!cfg.value_show_raw_unit },
  { id: 'value_custom_unit',      label: 'Custom unit (suffix)',    type: 'text',     placeholder: 'e.g. W', condition: cfg => !!cfg.show_value && !!cfg.value_show_raw_unit && !!cfg.value_replace_unit },

  { id: 'show_scale_label',       label: 'Show scale label', type: 'checkbox' },
  { id: 'scale_label_font_size', framedBy: 'scale_label',  label: 'Label font size',         type: 'range',    min: 0, max: 20, step: 0.1,  placeholder: '10',  condition: cfg => !!cfg.show_scale_label },
  { id: 'scale_label_offset_x', framedBy: 'scale_label',   label: 'Label offset X',             type: 'range',    min: -25, max: 25, step: 0.1,  placeholder: '0', condition: cfg => !!cfg.show_scale_label },
  { id: 'scale_label_offset_y', framedBy: 'scale_label',   label: 'Label offset Y',             type: 'range',    min: -25, max: 25, step: 0.1,  placeholder: '-18', condition: cfg => !!cfg.show_scale_label },
  { id: 'scale_label_color_type', framedBy: 'scale_label', label: 'Label colour mode',           type: 'select',  options: [ { value: 'adaptive', label: 'Adaptive' }, { value: 'fixed', label: 'Fixed' } ], condition: cfg => !!cfg.show_scale_label },
  { id: 'scale_label_color', framedBy: 'scale_label',      label: 'Label colour (fixed)',          type: 'color',   condition: cfg => !!cfg.show_scale_label && cfg.scale_label_color_type !== 'adaptive' },
  { id: 'scale_label_show_raw_unit', framedBy: 'scale_label', label: 'Show unit',        type: 'checkbox', condition: cfg => !!cfg.show_scale_label },
  { id: 'scale_label_replace_unit', framedBy: 'scale_label',  label: 'Replace original unit',  type: 'checkbox', condition: cfg => !!cfg.show_scale_label && !!cfg.scale_label_show_raw_unit },
  { id: 'scale_label_custom_unit', label: 'Custom unit',       type: 'text',    placeholder: "the entity's own", condition: cfg => !!cfg.show_scale_label && !!cfg.scale_label_show_raw_unit && !!cfg.scale_label_replace_unit },
  { id: 'show_multiplier_label',  label: 'Show multiplier',     type: 'checkbox' },
  { id: 'multiplier_prepend',     label: 'Prefix (e.g. x)',            type: 'text',    placeholder: 'x',   condition: cfg => !!cfg.show_multiplier_label },
  { id: 'multiplier_decimals', framedBy: 'multiplier',   label: 'Decimals',             type: 'range',   min: 0, max: 6, step: 1, placeholder: '0',   condition: cfg => !!cfg.show_multiplier_label },
  { id: 'multiplier_font_size', framedBy: 'multiplier',  label: 'Font size',               type: 'range',    min: 0, max: 20, step: 0.1,  placeholder: '10',  condition: cfg => !!cfg.show_multiplier_label },
  { id: 'multiplier_offset_x', framedBy: 'multiplier',   label: 'Offset X',                   type: 'range',    min: -25, max: 25, step: 0.1,  placeholder: '0',   condition: cfg => !!cfg.show_multiplier_label },
  { id: 'multiplier_offset_y', framedBy: 'multiplier',   label: 'Offset Y',                   type: 'range',    min: -25, max: 25, step: 0.1,  placeholder: '-30', condition: cfg => !!cfg.show_multiplier_label },
  { id: 'multiplier_color_type', framedBy: 'multiplier', label: 'Colour mode',                 type: 'select',  options: [ { value: 'adaptive', label: 'Adaptive' }, { value: 'fixed', label: 'Fixed' } ], condition: cfg => !!cfg.show_multiplier_label },
  { id: 'multiplier_color', framedBy: 'multiplier',      label: 'Colour (fixed)',                type: 'color',   condition: cfg => !!cfg.show_multiplier_label && cfg.multiplier_color_type !== 'adaptive' },

  { id: '_section_gauge_label',    icon: icon('tag'), label: '── Gauge Label',       type: 'section' },
  // On unless it says otherwise, which is how the gauge itself reads the key:
  // a card that was given a label text by hand draws one, and the switch that
  // said "off" hid every field belonging to the label it was drawing.
  { id: 'gauge_label_active',      label: 'Label active',          type: 'checkbox', on: true },
  { id: 'gauge_label_text',        label: 'Label text',           type: 'text',     placeholder: 'Gauge',  condition: cfg => cfg.gauge_label_active !== false },
  { id: 'gauge_label_font_size',   label: 'Font size',         type: 'range',    min: 0, max: 20, step: 0.1,   placeholder: '8',   condition: cfg => cfg.gauge_label_active !== false, framedBy: 'gauge_label' },
  { id: 'gauge_label_font_weight', label: 'Weight',           type: 'select',   options: [ { value: '400', label: 'Normal' }, { value: '500', label: 'Medium' }, { value: '700', label: 'Bold' } ], condition: cfg => cfg.gauge_label_active !== false, framedBy: 'gauge_label' },
  { id: 'gauge_label_offset_x',    label: 'Offset X',             type: 'range',    min: -25, max: 25, step: 0.1,  placeholder: '0',  condition: cfg => cfg.gauge_label_active !== false, framedBy: 'gauge_label' },
  { id: 'gauge_label_offset_y',    label: 'Offset Y',             type: 'range',    min: -25, max: 25, step: 0.1,  placeholder: '0',  condition: cfg => cfg.gauge_label_active !== false, framedBy: 'gauge_label' },
  { id: 'gauge_label_color_type', framedBy: 'gauge_label',  label: 'Colour mode',           type: 'select',   options: [ { value: 'adaptive', label: 'Adaptive' }, { value: 'fixed', label: 'Fixed' } ], condition: cfg => cfg.gauge_label_active !== false },
  { id: 'gauge_label_color', framedBy: 'gauge_label',       label: 'Colour (fixed)',            type: 'color',    condition: cfg => cfg.gauge_label_color_type === 'fixed' }
];

class ScGaugeEditor extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      slot: { type: Object },
      commitFn: { type: Object },
      only: { type: Number },
      priority: { type: String },
      framed: { type: Array }
    };
  }

  constructor() {
    super();
    this._expanded = {};
    this._timeouts = {};
  }

  /**
   * Whether a list entry in this editor is unfolded.
   *
   * Unfolded is a state of the editor, not of the card: it used to be an
   * `_isOpen` field on the stop, tick or sector itself, which made clicking a
   * triangle a config change - written through Home Assistant's storage into
   * somebody's dashboard YAML, where it reads like a setting and no renderer
   * ever looks at it. `_expanded` is where this editor already keeps the fold
   * state of everything else, keyed by a string the caller makes up.
   *
   * Unfolded is the default, because a stop somebody just added should be
   * open; `_expanded` elsewhere in this editor defaults the other way, which
   * is why this asks for `!== false` rather than for truth.
   */
  _isUnfolded(key) { return this._expanded[key] !== false; }

  /** Remember a fold without committing anything. */
  _setUnfolded(key, open) { this._expanded[key] = open; }

  static get styles() {
    return [SC.formStyles, css`
      input[type="text"], input[type="number"], select { transition: border-color 0.2s; }
      .fx-slot { margin: 8px 0; padding: 8px; border-radius: 6px;
                 background: rgba(255,255,255,0.03); border: 1px solid var(--divider-color,#555); }
      details.inner-section { background: rgba(120,120,120,0.05); border: 1px solid var(--divider-color,#444); border-radius: 6px; margin: 0 16px 16px 16px; }
      /* One section can be asked for by whoever is drawing this editor: the
         canvas does it while one of a gauge's own parts is being moved, so
         those settings are at the top of the form instead of eight folds down,
         for as long as the part is in hand. Moved with the order property, not
         by rendering it somewhere else, so nothing here is rebuilt and no fold
         springs shut on the way. */
      details.inner-section.wanted { order: -1; border-color: var(--primary-color,#03a9f4); }
      .framed-note { font-size: 12px; color: var(--secondary-text-color); font-style: italic; }
      .inner-content { padding: 0 12px 12px 12px; display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--divider-color,#444); margin-top: 4px; padding-top: 12px; }
      ha-entity-picker, ha-selector { display: block; width: 100%; }
      .entity-row { display: flex; flex-direction: column; gap: 4px; }
      .field-wrapper { display: block; }
      button.add-btn { margin-top:4px; padding:8px; border-radius:8px; border:1px dashed var(--primary-color,#03a9f4); background:none; color:var(--primary-color,#03a9f4); cursor:pointer; font-size:13px; width:100%; }
      .sector-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 2px;
        width: 54px;
        height: 54px;
        margin-top: 4px;
      }
      .sector-btn {
        background: var(--divider-color, #555);
        border-radius: 2px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .sector-btn:hover {
        background: var(--primary-color, #03a9f4);
        opacity: 0.7;
      }
      .sector-btn.active {
        background: var(--primary-color, #03a9f4);
        box-shadow: 0 0 4px rgba(3,169,244,0.5);
      }
    `];
  }

  /**
   * The gauges to edit. A slot that never grew a `gauges` array still has one
   * gauge - the card's own config - and editing it materialises the array,
   * which is why the fallback is a shape rather than an empty list.
   */
  get _gauges() {
    return Array.isArray(this.slot.gauges) && this.slot.gauges.length > 0
      ? this.slot.gauges
      : [{
          entity: this.slot.gauge_entity_0 || this.slot.entity || '',
          gauge_attribute: this.slot.gauge_attribute_0 || this.slot.gauge_attribute || '',
          inherit: false
        }];
  }

  render() {
    if (!this.slot) return html``;

    const isActive = !!this.slot.gauge_active;
    const gauges = this._gauges;

    // One entry alone, for the canvas editor: no section, no switch, no add
    // button - the canvas has already chosen which gauge is being edited.
    if (typeof this.only === 'number') {
      return gauges[this.only] ? this._renderGaugeBody(gauges[this.only], this.only, gauges) : html``;
    }

    return html`
      <details class="inner-section">
        <summary>${icon('gauge')} Gauges
          <div style="display:flex; align-items:center; gap:8px; margin-left:auto;">
            <span style="font-size:10px; opacity:.6; font-weight:400;">
              ${gauges.length} Gauge${gauges.length !== 1 ? 's' : ''}
            </span>
            <ha-switch
              .checked=${isActive}
              @click=${e => e.stopPropagation()}
              @change=${e => this.commitFn('gauge_active', e.target.checked)}>
            </ha-switch>
          </div>
        </summary>
        <div class="inner-content">
          ${isActive ? html`
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${gauges.map((entry, idx) => this._renderGaugePanel(entry, idx, gauges))}
              <button class="add-btn" @click=${() => this._addGauge(gauges)}>
                ${icon('plus')} Add gauge
              </button>
            </div>
          ` : ''}
        </div>
      </details>`;
  }

  _addGauge(gauges) {
    const newGauges = structuredClone(gauges);
    newGauges.push(newEntry());
    this._expanded[`gauge_${newGauges.length - 1}`] = true;
    this.commitFn('gauges', newGauges);
  }

  _removeGauge(idx, gauges) {
    const newGauges = structuredClone(gauges);
    newGauges.splice(idx, 1);
    this.commitFn('gauges', newGauges);
  }

  _cloneSection(targetIdx, sourceIdx, sec, gauges, selectEl) {
    if(isNaN(sourceIdx)) return;
    const n = structuredClone(gauges);
    const src = n[sourceIdx];
    const tgt = n[targetIdx];
    
    const fieldsToCopy = [];
    const collectFields = (items) => {
       items.forEach(f => { if (f.id) fieldsToCopy.push(f.id); });
    };
    
    collectFields(sec.items);
    if (sec.subsections) sec.subsections.forEach(sub => collectFields(sub.items));
    
    fieldsToCopy.forEach(fid => {
       if (src[fid] !== undefined) {
           tgt[fid] = structuredClone(src[fid]); 
       } else {
           delete tgt[fid]; 
       }
    });
    
    this.commitFn('gauges', n);
    selectEl.value = ""; 
  }

  _renderGaugePanel(entry, idx, gauges) {
    // --- ALIAS TITLE PREVIEW ---
    let title = entry.name || '';
    const { entity: resolvedEntity, match: aliasObj } = SC.resolveAlias(this.slot?.global_entities, entry);
    const isAlias = !!aliasObj;

    if (!title && resolvedEntity && this.hass?.states[resolvedEntity]) {
      const s = this.hass.states[resolvedEntity];
      if (isAlias) {
        title = `[${aliasObj.alias || 'Alias'}] ${s.attributes.friendly_name || resolvedEntity}`;
        if (aliasObj.attribute) title += ` (${aliasObj.attribute})`;
      } else {
        title = s.attributes.friendly_name || resolvedEntity;
      }
    } else if (!title) {
      title = isAlias ? `[${aliasObj.alias || 'Alias'}] ${resolvedEntity || 'Unnamed'}` : `Gauge ${idx + 1}`;
    }
    
    const stateKey = `gauge_${idx}`;
    if (this._expanded[stateKey] === undefined) this._expanded[stateKey] = false;

    return html`
      <details class="inner-section" 
        ?open=${this._expanded[stateKey]} 
        @toggle=${e => this._expanded[stateKey] = e.target.open}
        @dragstart=${(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', idx);
          setTimeout(() => e.target.style.opacity = '0.3', 0);
        }}
        @dragover=${(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          e.currentTarget.style.borderTop = '3px dashed var(--primary-color, #03a9f4)';
        }}
        @dragleave=${(e) => { e.currentTarget.style.borderTop = ''; }}
        @drop=${(e) => {
          e.preventDefault();
          e.currentTarget.style.borderTop = '';
          const draggedIdx = parseInt(e.dataTransfer.getData('text/plain'));
          if (draggedIdx !== idx && !isNaN(draggedIdx)) {
            const n = structuredClone(gauges);
            const [movedItem] = n.splice(draggedIdx, 1);
            n.splice(idx, 0, movedItem);
            this.commitFn('gauges', n);
          }
          e.currentTarget.removeAttribute('draggable');
        }}
        @dragend=${(e) => {
          e.target.style.opacity = '1';
          e.target.removeAttribute('draggable');
        }}
      >
        <summary>
          <span style="display:flex;align-items:center;">
            <span 
              style="cursor: grab; padding: 0 12px 0 0; color: var(--secondary-text-color, #aaa); font-size: 16px; user-select: none;"
              title="Move gauge"
              @mousedown=${(e) => e.target.closest('details').setAttribute('draggable', 'true')}
              @mouseup=${(e) => e.target.closest('details').removeAttribute('draggable')}
            >${icon('grip-vertical')}</span>
            ${title}
          </span>

          ${gauges.length > 1 ? html`
            <div style="display:flex; gap:12px; align-items:center;" @click=${e => e.stopPropagation()}>
              <button title="Move up" ?disabled=${idx === 0} style="background:none;border:none;cursor:${idx === 0 ? 'default' : 'pointer'};font-size:14px;color:${idx === 0 ? 'var(--divider-color,#555)' : 'var(--primary-text-color)'};padding:0;" @click=${(e) => {
                e.preventDefault();
                if (idx === 0) return;
                const n = structuredClone(gauges);
                const temp = n[idx-1]; n[idx-1] = n[idx]; n[idx] = temp;
                this.commitFn('gauges', n);
              }}>${icon('chevron-up')}</button>
              <button title="Move down" ?disabled=${idx === gauges.length - 1} style="background:none;border:none;cursor:${idx === gauges.length - 1 ? 'default' : 'pointer'};font-size:14px;color:${idx === gauges.length - 1 ? 'var(--divider-color,#555)' : 'var(--primary-text-color)'};padding:0;" @click=${(e) => {
                e.preventDefault();
                if (idx === gauges.length - 1) return;
                const n = structuredClone(gauges);
                const temp = n[idx+1]; n[idx+1] = n[idx]; n[idx] = temp;
                this.commitFn('gauges', n);
              }}>${icon('chevron-down')}</button>
              <button title="Remove" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--error-color,#f44);padding:0;" @click=${(e) => { e.preventDefault(); this._removeGauge(idx, gauges); }}>${icon('trash-2')}</button>
            </div>
          ` : ''}
        </summary>
        ${this._renderGaugeBody(entry, idx, gauges)}
      </details>
    `;
  }

  /**
   * One gauge's fields, without the panel around them.
   *
   * Its own section renders it inside a `<details>` that names the entry; the
   * canvas editor renders it alone, under the element the user has selected,
   * where the element list above it has already said which gauge this is.
   */
  _renderGaugeBody(entry, idx, gauges) {
    const updateEntry = (key, val) => {
      this.commitFn('gauges', SC.withPatch(gauges, idx, key, val));
    };
    return html`
        <div class="inner-content">
          <div class="entity-row" style="margin-bottom: 8px;">
            <label>Data source</label>
            <select style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--divider-color); background: var(--card-background-color, #2b2b2b); color: var(--primary-text-color);" @change=${e => updateEntry('global_id', e.target.value)}>
              <option value="manual" ?selected=${entry.global_id === 'manual' || !entry.global_id}>Manual selection</option>
              ${(this.slot?.global_entities || []).map(ge => {
                const stateObj = ge.entity ? this.hass.states[ge.entity] : null;
                const name = ge.alias || stateObj?.attributes?.friendly_name || ge.entity || 'Unnamed';
                let val = stateObj ? stateObj.state : '-';
                if (stateObj && ge.attribute && stateObj.attributes[ge.attribute] !== undefined) {
                  val = stateObj.attributes[ge.attribute];
                }
                const uom = (!ge.attribute && stateObj?.attributes?.unit_of_measurement) ? ` ${stateObj.attributes.unit_of_measurement}` : '';
                const attrLabel = ge.attribute ? ` (${ge.attribute})` : '';
                const label = `[${ge.alias || 'Alias'}] ${name}${attrLabel}: ${val}${uom}`;
                
                return html`<option value=${ge.id} ?selected=${entry.global_id === ge.id}>${label}</option>`;
              })}
            </select>
          </div>

          ${(!entry.global_id || entry.global_id === 'manual') ? html`
            <div style="background:rgba(0,0,0,0.15); padding:10px; border-radius:8px; border:1px solid var(--divider-color,#333); margin-bottom:8px;">
              <div class="entity-row" style="margin-bottom: 8px;">
                <label>Source</label>
                <ha-entity-picker
                  .hass=${this.hass}
                  .allowCustomEntity=${false}
                  .value=${entry.entity || ''}
                  @value-changed=${e => updateEntry('entity', e.detail.value)}
                ></ha-entity-picker>
              </div>

              <div class="entity-row">
                <label>Attribute</label>
                <ha-selector
                  .hass=${this.hass}
                  .selector=${{ attribute: { entity_id: entry.entity || this.slot?.entity || '' } }}
                  .value=${entry.gauge_attribute || ''}
                  @value-changed=${e => updateEntry('gauge_attribute', e.detail.value || '')}
                ></ha-selector>
              </div>
            </div>
          ` : ''}

          ${gauges.length > 1 ? html`
            <div class="row" style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--divider-color,#444);">
              <label>Copy everything from...</label>
              <select style="width: 60%" @change=${e => {
                const srcIdx = parseInt(e.target.value);
                if (isNaN(srcIdx)) return;
                const n = structuredClone(gauges);
                const src = n[srcIdx];
                const currentEntity = n[idx].entity;
                const currentAttr = n[idx].gauge_attribute;
                const currentLabel = n[idx].gauge_label_text;
                n[idx] = { ...src, entity: currentEntity, gauge_attribute: currentAttr, gauge_label_text: currentLabel };
                this.commitFn('gauges', n);
                e.target.value = "";
              }}>
                <option value="" selected disabled>Please select...</option>
                ${gauges.map((g, i) => {
                  if (i === idx) return '';
                  const gName = g.gauge_label_text ? g.gauge_label_text : (g.entity ? g.entity.split('.')[1] : '');
                  return html`<option value=${i}>Gauge ${i+1}${gName ? ' — ' + gName : ''}</option>`;
                })}
              </select>
            </div>
          ` : ''}

          ${this._renderFieldsGroup(STYLE_FIELDS, entry, idx, gauges)}
          <div class="fx-slot">
            <sc-fx-glass-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                               .target=${'elm_gauge_' + idx}></sc-fx-glass-panel>
          </div>
          <div class="fx-slot">
            <sc-push-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                           .target=${'gauge_' + idx}></sc-push-panel>
          </div>
        </div>`;
  }


  /**
   * The shared stops editor. This gauge's own version of it is what the shared
   * one was lifted from, so nothing is lost here - the fold state moved inside
   * the element, which is why `stateKey` is gone.
   */
  _renderStopsEditor(stopsArray, isAbsolute, onUpdate, resolution) {
    return html`
      <sc-gradient-stops .stops=${stopsArray} .absolute=${isAbsolute}
                         .blocks=${resolution === 'coarse'}
                         .onUpdate=${onUpdate}></sc-gradient-stops>`;
  }

  _renderFieldsGroup(fields, entry, idx, gauges) {
    const rootSections = [];
    let currentSection = { isRoot: true, items: [], subsections: [] };
    rootSections.push(currentSection);
    let currentSubsection = null;

    fields.forEach(f => {
      if (f.type === 'section') {
        currentSection = { isRoot: false, id: f.id, icon: f.icon,
                           title: f.label.replace('── ', ''), items: [], subsections: [] };
        rootSections.push(currentSection);
        currentSubsection = null; 
      } else if (f.type === 'subsection') {
        currentSubsection = { id: f.id, icon: f.icon, title: f.label.replace('── ', ''), items: [] };
        currentSection.subsections.push(currentSubsection);
      } else {
        if (currentSubsection) {
          currentSubsection.items.push(f);
        } else {
          currentSection.items.push(f);
        }
      }
    });

    const renderItems = (items) => items.map(f => this._renderLitField(f, entry, idx, gauges));
    const cloneableSections = ['_section_bg', '_section_color', '_section_pointer', '_section_ticks', '_section_sectors', '_section_labels'];

    return rootSections.map(sec => {
      if (sec.isRoot) {
        return renderItems(sec.items);
      } else {
        const detailKey = `g_${idx}_${sec.title}`;
        if (this._expanded[detailKey] === undefined) this._expanded[detailKey] = false;
        // A part can ask for a subsection rather than a section - the ticks,
        // the subticks and the labels are three folds inside one - and a fold
        // inside a shut fold is no use, so the section opens with it.
        const inside = sec.subsections.some(ss => ss.id && ss.id === this.priority);
        const wanted = this.priority === sec.id || inside;

        return html`
          <details class="inner-section ${wanted ? 'wanted' : ''}" data-section=${sec.id}
                   ?open=${this._expanded[detailKey] || wanted}
                   @toggle=${e => this._expanded[detailKey] = e.target.open}>
            <summary style="display:flex; justify-content:space-between; align-items:center;">
              <span style="flex: 1;">${sec.icon
                  ? html`<span class="field-icon">${sec.icon}</span>` : ''}${sec.title}</span>
              ${cloneableSections.includes(sec.id) && gauges.length > 1 ? html`
                <select style="width: auto; max-width: 140px; padding: 2px 4px; font-size: 11px; margin-right: 8px; border: 1px solid var(--divider-color, #444); border-radius: 4px; background: rgba(0,0,0,0.2); color: var(--primary-text-color);" @click=${e => e.stopPropagation()} @change=${e => this._cloneSection(idx, parseInt(e.target.value), sec, gauges, e.target)}>
                  <option value="" disabled selected>Copy from...</option>
                  ${gauges.map((g, i) => i !== idx ? html`<option value="${i}">Gauge ${i+1}</option>` : '')}
                </select>
              ` : ''}
              <span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('chevron-down')}</span>
            </summary>
            
            <div class="inner-content">
              ${this._framedNote(sec.items, entry, sec.title)}
              ${renderItems(sec.items)}
              
              ${sec.subsections.map(subsec => {
                const subDetailKey = `g_${idx}_${sec.title}_${subsec.title}`;
                if (this._expanded[subDetailKey] === undefined) this._expanded[subDetailKey] = false;
                const subWanted = !!subsec.id && subsec.id === this.priority;
                return html`
                  <details class="inner-section ${subWanted ? 'wanted' : ''}" data-section=${subsec.id || ''} style="margin-top: 8px; background: rgba(0,0,0,0.15);" ?open=${this._expanded[subDetailKey] || subWanted} @toggle=${e => this._expanded[subDetailKey] = e.target.open}>
                    <summary style="font-size: 13px; font-weight: 500;">
                      <span class="field-icon">${icon('corner-down-right')}</span>${subsec.icon
                          ? html`<span class="field-icon">${subsec.icon}</span>` : ''}${subsec.title}
                      <span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('chevron-down')}</span>
                    </summary>
                    <div class="inner-content">
                      ${this._framedNote(subsec.items, entry, subsec.title)}
                      ${renderItems(subsec.items)}
                    </div>
                  </details>
                `;
              })}
            </div>
          </details>
        `;
      }
    });
  }

  /** The gauge parts in hand on the canvas - the frame that is selected. */
  get _framed() { return new Set(Array.isArray(this.framed) ? this.framed : []); }

  /**
   * The line that stands in for the controls the canvas has taken over.
   *
   * Without it a fold that has lost three of its five rows reads as a fold
   * that is missing something. It is drawn wherever those rows were - a
   * section's own list or one of its subsections - because a ring's distance
   * and a value's offsets live at different depths of the same menu.
   *
   * It names the fold it stands in, and says whether the fold is empty or
   * only thinner. "This one is on the canvas" was true and useless: read in
   * a dialog of a dozen folds, a line that does not say which settings have
   * gone leaves the reader to work out what is missing from what is left,
   * which is the one thing a fold that has lost its rows cannot show.
   */
  _framedNote(items, entry, title) {
    // Through the shared rule, not a second reading of `framedBy`: a field
    // may name several parts, and only one of them is the one in hand.
    const taken = SC.framedIn(items, entry, this.slot, this._framed);
    if (!taken) return '';
    const { part, rest } = taken;
    // The needle is the one framed part that is dragged by its ends rather
    // than in and out, so it is the one that has to say so.
    // The ring grows inward from an outer edge that stands still, so what is
    // dragged is the inner edge and the note has to say which.
    const how = part === 'gauge_ring'
      ? html`drag the ring's inner edge, which is the edge of it that moves,
             and its colour stands under its chip. The list of stops stays
             here: a row of colours to be dragged about is not a control that
             fits on a dial.`
      : part === 'frame_ring'
      // Two edges that are two different settings, which is worth spelling
      // out: nothing else on a gauge is dragged by the outside of it, and a
      // gauge with no frame drawn still has that outer edge to be sized by.
      ? html`it has two edges: drag the outside to set how far the gauge
             reaches, and the inside to set how wide the frame is drawn. A
             gauge with no frame still shows the outer edge, faintly, because
             that is what its size is. The rest of what the frame is stands
             under its chip.`
      : part === 'pointer'
      ? html`drag either end of the needle, or use the buttons on and under
             its chip.`
      : RING_PARTS.has(part)
      ? html`its distance is the ring you drag, and the rest of what it is
             stands under its chip.`
      : html`drag its frame or the corner of it for size and place, and the
             rest of what it is stands on and under its chip.`;
    const name = title || 'These';
    return html`<div class="framed-note">${rest
      // A fold with rows left is not empty, and saying its settings "are on
      // the canvas" in front of the ones still sitting there would read as a
      // lie about the very rows underneath the line.
      ? html`Parts of the ${name} settings are in the canvas options box while
             this one is selected - ${how}`
      : html`The ${name} settings are on the canvas while this one is
             selected - ${how}`}</div>`;
  }

  _renderLitField(field, entry, idx, gauges) {
    if (!field) return html``;
    if (field.condition && !field.condition(entry, this.slot)) return html``;
    // Size and place are the frame's job while that frame is the one in hand:
    // two ways to set one number, side by side, is one way too many. The other
    // part keeps its sliders, because only the selected one is being worked on.
    if (SC.fieldFramed(field, entry, this._framed)) return html``;

    let content;
    const val = entry[field.id];
    // A hint is a balloon on the label's mark, the same as in the shared
    // renderer - prose under a control only pushes the next one down.
    const label = field.hint ? html`${field.label} ${SC.tipDot(field.hint)}` : field.label;
    
    const updateDirect = (newVal) => {
      this.commitFn('gauges', SC.withPatch(gauges, idx, field.id, newVal));
    };

    const updateDebounced = (newVal) => {
      const tKey = `${idx}_${field.id}`;
      clearTimeout(this._timeouts[tKey]);
      this._timeouts[tKey] = setTimeout(() => updateDirect(newVal), 250);
    };

    switch (field.type) {
      case 'colour_pattern': {
        // The pattern layer sits behind the gauge's own drawing, so this paints
        // the box the gauge stands in - not its ring. Pump is left out: it
        // would pulse that plate under a gauge that does not move with it.
        content = html`
          <sc-color-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                          .switchless=${true} .noPump=${true}
                          .label=${'Background pattern & animation'}
                          .target=${'elm_gauge_' + idx}></sc-color-panel>`;
        break;
      }
      case 'manual_stops': {
        const isAbsolute = entry.threshold_unit === 'absolute';
        content = html`
          <div class="col" style="gap:8px;">
            ${this._renderStopsEditor(val, isAbsolute, (newStops) => {
              this.commitFn('gauges', SC.withPatch(gauges, idx, 'manual_stops', newStops));
            }, entry.gradient_resolution)} </div>
        `;
        break;
      }
      case 'bg_manual_stops': {
        const isAbsolute = entry.bg_threshold_unit === 'absolute';
        content = html`
          <div class="col" style="gap:8px;">
            ${this._renderStopsEditor(val, isAbsolute, (newStops) => {
              this.commitFn('gauges', SC.withPatch(gauges, idx, 'bg_manual_stops', newStops));
            }, entry.gradient_resolution)} </div>
        `;
        break;
      }
      case 'gradient_ramp': {
        content = SC.rampGrid(id => {
          const n = structuredClone(gauges);
          Object.assign(n[idx], gradientPresetPatch(id));
          this.commitFn('gauges', n);
        });
        break;
      }
      case 'tick_preset': {
        content = html`
          <div class="row">
            <label>Start from ${SC.tipDot('A set of numbers that suit each other, written straight into the fields below. Every one of them stays yours to change afterwards, and nothing remembers which you picked.')}</label>
            <select style="width:50%" .value=${''} @change=${e => {
              const preset = TICK_PRESETS[e.target.value];
              e.target.value = '';
              if (!preset) return;
              const n = structuredClone(gauges);
              Object.assign(n[idx], presetPatch(preset, n[idx]));
              this.commitFn('gauges', n);
            }}>
              <option value="" selected>Choose a scale...</option>
              ${Object.entries(TICK_PRESETS).map(([k, p]) => html`<option value=${k}>${p.label}</option>`)}
            </select>
          </div>`;
        break;
      }
      case 'custom_ticks': {
        const cTicks = Array.isArray(val) ? val : [];
        content = html`
          <div class="col" style="gap:8px;">
            ${cTicks.map((ct, ctIdx) => {
              const foldKey = `g${idx}_tick:${ctIdx}`;
              return html`
                <details class="inner-section" style="margin-bottom:0;" 
                  ?open=${this._isUnfolded(foldKey)} 
                  @toggle=${e => this._setUnfolded(foldKey, e.target.open)}
                  @dragstart=${(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('tickIdx', ctIdx);
                    setTimeout(() => e.target.style.opacity = '0.3', 0);
                  }}
                  @dragover=${(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderTop = '3px dashed var(--primary-color, #03a9f4)';
                  }}
                  @dragleave=${(e) => e.currentTarget.style.borderTop = ''}
                  @drop=${(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderTop = '';
                    const dIdx = parseInt(e.dataTransfer.getData('tickIdx'));
                    if (dIdx !== ctIdx && !isNaN(dIdx)) {
                      const n = structuredClone(gauges);
                      const [moved] = n[idx].custom_ticks.splice(dIdx, 1);
                      n[idx].custom_ticks.splice(ctIdx, 0, moved);
                      this.commitFn('gauges', n);
                    }
                  }}
                  @dragend=${(e) => { e.target.style.opacity = '1'; e.target.removeAttribute('draggable'); }}
                >
                  <summary style="padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:600;color:var(--primary-color,#03a9f4); flex:1; display:flex; align-items:center;">
                      <span 
                        style="cursor: grab; padding: 0 12px 0 0; color: var(--secondary-text-color, #aaa); font-size: 16px;" 
                        @mousedown=${(e) => e.target.closest('details').setAttribute('draggable', 'true')}
                        @mouseup=${(e) => e.target.closest('details').removeAttribute('draggable')}
                      >${icon('grip-vertical')}</span>
                      Tick ${ctIdx+1}
                    </div>
                    <div @click=${e => e.stopPropagation()}>
                      <button title="Remove" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--error-color,#f44);" @click=${() => {
                        const n = structuredClone(gauges);
                        n[idx].custom_ticks.splice(ctIdx, 1);
                        this.commitFn('gauges', n);
                      }}>${icon('trash-2')}</button>
                    </div>
                  </summary>
                  <div class="inner-content" style="padding-top:4px; gap:8px;">
                  <div class="row">
                    <label>Value on scale</label>
                    <input type="text" style="width:50%" .value=${ct.value ?? ''} @input=${e => {
                        const val = e.target.value.replace(',', '.'); 
                        clearTimeout(this._timeouts['ct_' + idx + '_' + ctIdx]);
                        this._timeouts['ct_' + idx + '_' + ctIdx] = setTimeout(() => {
                        const n = structuredClone(gauges);
                        n[idx].custom_ticks[ctIdx].value = val !== '' ? parseFloat(val) : '';
                        this.commitFn('gauges', n);
                        }, 500);
                    }}>
                  </div>
                    ${SC.sliderRow('Length', ct.length ?? 4, v => { const n = structuredClone(gauges); n[idx].custom_ticks[ctIdx].length = v; this.commitFn('gauges', n); }, { min: 0, max: 10, step: 0.1, width: '50%' })}
                    ${SC.sliderRow('Width', ct.width ?? 1, v => { const n = structuredClone(gauges); n[idx].custom_ticks[ctIdx].width = v; this.commitFn('gauges', n); }, { min: 0, max: 2, step: 0.1, width: '50%' })}
                    ${SC.sliderRow('Offset from ring', ct.offset ?? 0, v => { const n = structuredClone(gauges); n[idx].custom_ticks[ctIdx].offset = v; this.commitFn('gauges', n); }, { min: -15, max: 0, step: 0.1, width: '50%' })}
                    <div class="col"><label>Colour</label>
                      ${SC.colorRow(ct.color ?? '#ff0000', v => { const n = structuredClone(gauges); n[idx].custom_ticks[ctIdx].color = v; this.commitFn('gauges', n); }, { fallback: '#ff0000', hexOnly: true, textFallback: true })}
                    </div>
                    <div class="row"><label>Label text</label><input type="text" style="width:50%" .value=${ct.label ?? ''} @input=${e => { const n = structuredClone(gauges); n[idx].custom_ticks[ctIdx].label = e.target.value; this.commitFn('gauges', n); }}></div>
                    ${SC.sliderRow('Label offset', ct.label_offset ?? 10, v => { const n = structuredClone(gauges); n[idx].custom_ticks[ctIdx].label_offset = v; this.commitFn('gauges', n); }, { min: -15, max: 4, step: 0.1, width: '50%' })}
                    ${SC.sliderRow('Label size', ct.label_font_size ?? 7, v => { const n = structuredClone(gauges); n[idx].custom_ticks[ctIdx].label_font_size = v; this.commitFn('gauges', n); }, { min: 1, max: 20, step: 0.1, width: '50%' })}
                  </div>
                </details>
              `;
            })}
            <button class="add-btn" @click=${() => {
              const n = structuredClone(gauges);
              if (!n[idx].custom_ticks) n[idx].custom_ticks = [];
              n[idx].custom_ticks.push({ value: 0, length: 4, width: 1, offset: 0, color: '#ff0000', label: '' });
              this._setUnfolded(`g${idx}_tick:${n[idx].custom_ticks.length - 1}`, true);
              this.commitFn('gauges', n);
            }}>${icon('plus')} Add custom tick</button>
          </div>
        `;
        break;
      }
      case 'sectors': {
        const sects = Array.isArray(val) ? val : [];
        content = html`
          <div class="col" style="gap:8px;">
            ${sects.map((sec, sIdx) => {
              const foldKey = `g${idx}_sector:${sIdx}`;
              const secPreset = sec.gradient_preset || (sec.use_gradient ? 'classic' : 'none');

              return html`
                <details class="inner-section" style="margin-bottom:0;" 
                  ?open=${this._isUnfolded(foldKey)} 
                  @toggle=${e => this._setUnfolded(foldKey, e.target.open)}
                  @dragstart=${(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('secIdx', sIdx);
                    setTimeout(() => e.target.style.opacity = '0.3', 0);
                  }}
                  @dragover=${(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderTop = '3px dashed var(--primary-color, #03a9f4)';
                  }}
                  @dragleave=${(e) => e.currentTarget.style.borderTop = ''}
                  @drop=${(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderTop = '';
                    const dIdx = parseInt(e.dataTransfer.getData('secIdx'));
                    if (dIdx !== sIdx && !isNaN(dIdx)) {
                      const n = structuredClone(gauges);
                      const [moved] = n[idx].sectors.splice(dIdx, 1);
                      n[idx].sectors.splice(sIdx, 0, moved);
                      this.commitFn('gauges', n);
                    }
                  }}
                  @dragend=${(e) => { e.target.style.opacity = '1'; e.target.removeAttribute('draggable'); }}
                >
                  <summary style="padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:600;color:var(--primary-color,#03a9f4); flex:1; display:flex; align-items:center;">
                      <span 
                        style="cursor: grab; padding: 0 12px 0 0; color: var(--secondary-text-color, #aaa); font-size: 16px;" 
                        @mousedown=${(e) => e.target.closest('details').setAttribute('draggable', 'true')}
                        @mouseup=${(e) => e.target.closest('details').removeAttribute('draggable')}
                      >${icon('grip-vertical')}</span>
                      Sector ${sIdx+1}
                    </div>
                    <div @click=${e => e.stopPropagation()}>
                      <button title="Remove" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--error-color,#f44);" @click=${() => {
                        const n = structuredClone(gauges);
                        n[idx].sectors.splice(sIdx, 1);
                        this.commitFn('gauges', n);
                      }}>${icon('trash-2')}</button>
                    </div>
                  </summary>
                  <div class="inner-content" style="padding-top:4px; gap:8px;">
                    ${SC.sliderRow('Start (%)', sec.start_percent ?? 75, v => { const n = structuredClone(gauges); n[idx].sectors[sIdx].start_percent = v; this.commitFn('gauges', n); }, { min: 0, max: 100, step: 1, width: '50%' })}
                    ${SC.sliderRow('Length (%)', sec.length_percent ?? 25, v => { const n = structuredClone(gauges); n[idx].sectors[sIdx].length_percent = v; this.commitFn('gauges', n); }, { min: 0, max: 100, step: 1, width: '50%' })}
                    ${SC.sliderRow('Inner radius', sec.inner_radius ?? 12, v => { const n = structuredClone(gauges); n[idx].sectors[sIdx].inner_radius = v; this.commitFn('gauges', n); }, { min: 0, max: 50, step: 0.1, width: '50%' })}
                    ${SC.sliderRow('Outer radius', sec.outer_radius ?? 22, v => { const n = structuredClone(gauges); n[idx].sectors[sIdx].outer_radius = v; this.commitFn('gauges', n); }, { min: 0, max: 50, step: 0.1, width: '50%' })}
                    ${SC.sliderRow('Opacity', sec.opacity ?? 0.85, v => { const n = structuredClone(gauges); n[idx].sectors[sIdx].opacity = v; this.commitFn('gauges', n); }, { min: 0, max: 1, step: 0.05, width: '50%' })}

                    <div style="border-top:1px dashed var(--divider-color,#444); margin:4px 0;"></div>

                    <div class="col"><label>Colour (start)</label>
                      ${SC.colorRow(sec.color ?? '#dc3232', v => { const n = structuredClone(gauges); n[idx].sectors[sIdx].color = v; this.commitFn('gauges', n); }, { fallback: '#dc3232', hexOnly: true, textFallback: true })}
                    </div>

                    <div class="row">
                      <label>Gradient</label>
                      <select @change=${e => {
                        const n = structuredClone(gauges);
                        n[idx].sectors[sIdx].gradient_preset = e.target.value;
                        n[idx].sectors[sIdx].use_gradient = (e.target.value === 'classic');
                        this.commitFn('gauges', n);
                      }}>
                        <option value="none" ?selected=${secPreset === 'none'}>Single colour</option>
                        <option value="classic" ?selected=${secPreset === 'classic'}>Classic (2 colours)</option>
                        <option value="manual" ?selected=${secPreset === 'manual'}>Manual (list)</option>
                      </select>
                    </div>

                    ${secPreset === 'classic' ? html`
                      <div class="col"><label>Colour (end)</label>
                        ${SC.colorRow(sec.color_end ?? '#ffeb3b', v => { const n = structuredClone(gauges); n[idx].sectors[sIdx].color_end = v; this.commitFn('gauges', n); }, { fallback: '#ffeb3b', hexOnly: true, textFallback: true })}
                      </div>
                    ` : ''}

                    ${secPreset !== 'none' ? html`
                      <div class="row" style="margin-top:4px;">
                        <label>Auto resolution (dynamic)</label>
                        <label class="toggle">
                          <input type="checkbox" .checked=${sec.resolution_auto !== false} @change=${e => {
                            const n = structuredClone(gauges);
                            n[idx].sectors[sIdx].resolution_auto = e.target.checked;
                            this.commitFn('gauges', n);
                          }}>
                          <span class="toggle-slider"></span>
                        </label>
                      </div>

                      ${sec.resolution_auto === false ? html`
                        ${SC.sliderRow('Manual precision (degrees)', sec.resolution ?? 1.5, v => {
                          const n = structuredClone(gauges);
                          n[idx].sectors[sIdx].resolution = v;
                          this.commitFn('gauges', n);
                        }, { min: 0.1, max: 5, step: 0.1 })}
                      ` : ''}
                    ` : ''}

                    ${secPreset === 'manual' ? html`
                      <div class="row">
                        <label>Threshold unit</label>
                        <select @change=${e => {
                          const n = structuredClone(gauges);
                          n[idx].sectors[sIdx].threshold_unit = e.target.value;
                          this.commitFn('gauges', n);
                        }}>
                          <option value="percent" ?selected=${(sec.threshold_unit || 'percent') === 'percent'}>Percent (%)</option>
                          <option value="absolute" ?selected=${(sec.threshold_unit || 'percent') === 'absolute'}>Absolute</option>
                        </select>
                      </div>
                      ${this._renderStopsEditor(sec.manual_stops, (sec.threshold_unit || 'percent') === 'absolute', (newStops) => {
                        const n = structuredClone(gauges);
                        n[idx].sectors[sIdx].manual_stops = newStops;
                        this.commitFn('gauges', n);
                      })}
                    ` : ''}

                  </div>
                </details>
              `;
            })}
            <button class="add-btn" @click=${() => {
              const n = structuredClone(gauges);
              if (!n[idx].sectors) n[idx].sectors = [];
              n[idx].sectors.push({ start_percent: 75, length_percent: 25, inner_radius: 12, outer_radius: 22, opacity: 0.85, color: '#dc3232' });
              this._setUnfolded(`g${idx}_sector:${n[idx].sectors.length - 1}`, true);
              this.commitFn('gauges', n);
            }}>${icon('plus')} Add sector</button>
          </div>
        `;
        break;
      }
      case 'checkbox':
        content = html`
          <div class="row">
            <label>${label}</label>
            <label class="toggle">
              <input type="checkbox" .checked=${val === undefined ? !!field.on : !!val}
                     @change=${e => updateDirect(e.target.checked)}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        `;
        break;
      case 'color': {
        const hex = val ? (Array.isArray(val) ? '#' + val.map(x => x.toString(16).padStart(2,'0')).join('') : val) : '';
        content = html`
          <div class="col">
            <label>${label}</label>
            ${SC.colorRow(hex, updateDirect, { fallback: '', placeholder: field.placeholder || '#ffffff', hexOnly: true })}
          </div>
        `;
        break;
      }
      case 'select':
        content = html`
          <div class="row">
            <label>${label}</label>
            <select @change=${e => updateDirect(e.target.value)}>
              ${SC.fieldOptions(field, entry, this).map(o => html`<option value=${o.value} ?selected=${String(val ?? '') === String(o.value)}>${o.label}</option>`)}
            </select>
          </div>
        `;
        break;
      case 'range': {
        // A field's stored unit and the one its slider shows are usually the
        // same, and a field says so by leaving both hooks off. The gauge's zero
        // point is the exception: dial degrees to a person, SVG degrees to the
        // renderer.
        const shown = field.fromStored ? field.fromStored(val) : val;
        const store = v => updateDirect(field.toStored ? field.toStored(v) : v);
        content = SC.sliderField(label, shown ?? field.placeholder ?? 0, store,
          { min: field.min ?? 0, max: field.max ?? 100, step: field.step ?? 1,
            shown: shown ?? field.placeholder ?? '' });
        break;
      }

      case '9-sector':
        const sectors = [
          'top-left',    'top-center',    'top-right',
          'center-left', 'center',        'center-right',
          'bottom-left', 'bottom-center', 'bottom-right'
        ];
        content = html`
          <div class="col">
            <label>${label}</label>
            <div class="sector-grid">
              ${sectors.map(s => html`
                <div 
                  class="sector-btn ${val === s ? 'active' : ''}" 
                  title="${s.replace('-', ' ')}"
                  @click=${() => updateDirect(s)}
                ></div>
              `)}
            </div>
          </div>
        `;
        break;

      default:
        content = html`
          <div class="col">
            <label>${label}</label>
            <input 
              type=${field.type === 'number' ? 'number' : 'text'} 
              .value=${val ?? ''} 
              placeholder=${field.placeholder || ''} 
              step=${field.step ?? ''} 
              min=${field.min ?? ''} 
              max=${field.max ?? ''} 
              @input=${e => updateDebounced(field.type === 'number' ? parseFloat(e.target.value) : e.target.value)}
            >
          </div>
        `;
        break;
      
    }

    return html`<div class="field-wrapper">${content}</div>`;
  }
}

if (!customElements.get('sc-gauge-editor')) {
  customElements.define('sc-gauge-editor', ScGaugeEditor);
}

function renderCustomBlock(commitFn, hass, slot) {
    return html`<sc-gauge-editor .commitFn=${commitFn} .hass=${hass} .slot=${slot}></sc-gauge-editor>`;
  }

// `formFields` is the form seen from the drawing: the canvas asks it which
// fold a part has taken rows from, so a chip's panel can say whether more of
// the same thing is still waiting below. Nothing renders it - the editor
// above does that - so it hands back the array as it is.
return /** @type {SupercardModule} */ ({ editorFields, renderCustomBlock, newEntry,
                                        formFields: () => STYLE_FIELDS,
                                        ownedByCanvas: true });

})());