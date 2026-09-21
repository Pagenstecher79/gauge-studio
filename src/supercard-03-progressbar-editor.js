import { LitElement, html, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { squareBarOnCanvas } from "./canvas-model.js";
import { icon } from "./icons.js";
import { gradientPresetPatch } from "./gradient-presets.js";
import { isLiquidEffect } from "./pill-glass.js";
import { MAX_IOR } from "./glass-lens.js";

const SC = window.SupercardUtils;

window.SupercardModules = window.SupercardModules || {};

// 3. THE EDITOR COMPONENT
// ==========================================
const isCirc = cfg => String(cfg.orientation).startsWith('circular');
const isLin = cfg => !String(cfg.orientation).startsWith('circular');

const STYLE_FIELDS = [
  { id: '_section_shape',      icon: icon('proportions'), label: '── Shape & Position',    type: 'section' },
  { id: 'orientation',         label: 'Orientation / Layout',  type: 'select', options: [
    { value: 'horizontal', label: '↔ Linear horizontal' },
    { value: 'vertical', label: '↕ Linear vertical' },
    { value: 'circular_donut', label: '⭕ Circular: Donut (full circle 360°)' },
    { value: 'circular_speedo', label: '⏱️ Circular: Speedo (270°, open at bottom)' },
    { value: 'circular_half', label: '🕳️ Circular: Half circle (180°)' }
  ] },
  { id: 'base_unit',           label: 'Global scaling unit (base unit)', type: 'select', options: [
    { value: 'auto', label: 'Auto (linear: px, circular: cqmin)' },
    { value: 'px', label: 'px (fixed)' },
    { value: 'cqmin', label: 'cqmin (scales with smallest edge)' },
    { value: 'cqw', label: 'cqw (scales with width)' },
    { value: 'cqh', label: 'cqh (scales with height)' }
  ] },
  { id: 'circular_start_position', label: 'Start position (clock)', type: 'select', options: [
    { value: '0', label: '12 o’clock (top)' },
    { value: '90', label: '3 o’clock (right)' },
    { value: '180', label: '6 o’clock (bottom)' },
    { value: '-90', label: '9 o’clock (left)' }
  ], condition: cfg => isCirc(cfg) },
  { id: 'circular_reverse',      label: 'Reverse direction (counter-clockwise)', type: 'checkbox', condition: cfg => isCirc(cfg) },
  { id: 'circular_stroke_width', label: 'Ring thickness / segment height (%)', type: 'range', min: 1, max: 50, step: 1, placeholder: '10', condition: cfg => isCirc(cfg) },
  { id: 'circular_scale',        label: 'Ring scale (%)', type: 'range', min: 10, max: 100, step: 1, placeholder: '100', condition: cfg => isCirc(cfg) },
  { id: 'circular_glow',         label: 'Neon glow effect',      type: 'checkbox', condition: cfg => isCirc(cfg) },
  // A bar on the canvas is as wide as the box it sits in: the canvas writes
  // `width: 100% !important` on the host, and an important declaration from
  // the outer tree beats the `:host` rule this component writes - measured on
  // a live card, a bar configured at 20px came out the box's 30.4px, and even
  // an inline width could not move it. Offering the field there is offering a
  // control that does nothing. Height is *not* overridden - only capped with
  // `max-height` - so the 20px line inside a taller box is still available.
  { id: 'width',               label: 'Width (CSS)',          type: 'text',   placeholder: '100% or 20px',
    condition: (cfg, slot) => !SC.onCanvas(slot) },
  { id: 'height',              label: 'Height (CSS)',            type: 'text',   placeholder: '20px or 100%' },
  { type: 'note', framedWhen: 'corners', label: 'The corners are on the canvas - drag either grip, at the bottom left or the top right.' },
  // A number and the unit it is in, the way a surface's corner is set - and
  // for the same reason: eight of something is a hairline on one bar and a
  // full round end on another, and which of the two is entirely a question of
  // whether the eight is pixels or per cent. The unit rides in the value, as
  // every length a bar owns does; the renderer has always read it that way.
  { id: 'border_radius',       label: 'Corner radius',           type: 'length', dflt: '4px',
    placeholder: '4', min: 0, step: 0.1, condition: cfg => isLin(cfg), framedBy: 'corners' },
  { id: 'circular_border_radius', label: 'Background corner radius', type: 'length', dflt: '50%',
    placeholder: '50', min: 0, step: 1, condition: cfg => isCirc(cfg), framedBy: 'corners' },
  { id: '_section_colors',     icon: icon('palette'), label: '── Colours, Gradient & Animation',   type: 'section' },
  { id: 'animation_duration',  label: 'Animation duration (s)',  type: 'range',  min: 0, max: 10, step: 0.1, placeholder: '0.4' },
  { id: 'bounce_intensity', label: 'Bounce intensity (%)', type: 'range', min: 0, max: 30, dynamic_step: true, placeholder: '50' },
  { type: 'note', framedWhen: 'fill', label: 'What the bar is filled with is on the canvas - the ramp, the colours it is mixed from, the solid colour and the track are all under the chip.' },
  { id: 'bg_color',            label: 'Background colour',      type: 'color',  placeholder: '#ffffff', framedBy: 'fill' },
  { id: 'bg_opacity',          label: 'Background opacity (%)', type: 'range', min: 0, max: 100, step: 1, placeholder: '10', framedBy: 'fill' },
  // A gradient overwrites the fill outright, so offering the solid colour
  // there would be offering a setting that does nothing.
  { id: 'fill_color',          label: 'Fill colour (solid)',     type: 'color',  placeholder: 'var(--primary-color)',
    condition: cfg => !cfg.use_gradient, framedBy: 'fill' },
  { id: 'use_gradient',        label: 'Use gradient', type: 'checkbox', framedBy: 'fill' },
  { id: 'gradient_as_solid',   label: 'Derive colour from gradient (dynamic)', type: 'checkbox', condition: cfg => cfg.use_gradient, framedBy: 'fill' },
  // The same catalogue the gauge's ring offers, written into the list below.
  // A fill and a ring are coloured by the same question - what the number
  // means - so the answers already mixed for one of them are the answers for
  // the other, and offering them twice over would be two catalogues to keep.
  { id: 'gradient_ramp',       type: 'ramp', condition: cfg => cfg.use_gradient, framedBy: 'fill' },
  { id: 'gradient_stops',      label: 'Gradient colour stops',    type: 'gradient-stops', condition: cfg => cfg.use_gradient, framedBy: 'fill' },
  // Under the colours, because it paints behind them: the pattern is the bar's
  // backdrop and the track and fill draw on top of it. Only on a canvas, where
  // the renderer names the box it paints.
  { id: '_colour_pattern',     type: 'colour_pattern', condition: (cfg, slot) => !!slot?.canvas },

  { id: '_section_scale',      icon: icon('chart-column'), label: '── Value Range & Main Ticks', type: 'section' },
  { id: 'min',                 label: 'Minimum',               type: 'number', placeholder: '0' },
  { id: 'max',                 label: 'Maximum',               type: 'number', placeholder: '100' },
  { id: 'origin',              label: 'Start point (value, e.g. 0)', type: 'number', placeholder: 'Empty = minimum' },

  { type: 'note', framedWhen: 'ticks', label: 'The ticks are on the canvas while this bar is open - their number and where they sit are under the chip.' },
  { id: 'show_ticks',          label: 'Show ticks',        type: 'checkbox', condition: cfg => isLin(cfg), framedBy: 'ticks' },
  { id: 'tick_count',          label: 'Number of ticks (when interval is empty)', type: 'range',  min: 0, max: 51, step: 1, placeholder: '10',  condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'ticks' },
  { id: 'tick_interval',       label: 'Tick interval (value step)', type: 'number', placeholder: 'e.g. 10', condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'ticks' },
  { id: 'tick_hide_last',      label: 'Hide last tick line', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'ticks' },
  { id: 'tick_align',          label: 'Start point / alignment', type: 'select', options: [{value:'center', label:'Centered'}, {value:'start', label:'At edge (top/left)'}, {value:'end', label:'Opposite (bottom/right)'}, {value:'full', label:'Full width (100%)'}], condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'ticks' },
  { id: 'tick_mirror_side',    label: 'Also mirror on other side', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks && (cfg.tick_align === 'start' || cfg.tick_align === 'end'), framedBy: 'ticks' },
  { id: 'tick_length',         label: 'Main tick length (%, px)', type: 'text', placeholder: '100%', condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'ticks' },
  { id: 'tick_width',          label: 'Tick width (px or %)', type: 'text', placeholder: '1', condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'ticks' },
  { id: 'tick_color_adaptive', label: 'Dual-adaptive colour (inverted at fill level)', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'ticks' },
  { id: 'tick_color',          label: 'Manual colour',        type: 'color',  placeholder: 'rgba(255,255,255,0.3)', condition: cfg => isLin(cfg) && cfg.show_ticks && !cfg.tick_color_adaptive, framedBy: 'ticks' },

  { id: '_section_segments',   icon: icon('puzzle'), label: '── Segments (circle)',   type: 'section', condition: cfg => isCirc(cfg) },
  { id: 'circular_segmented',  label: 'Split circle into pill segments', type: 'checkbox', condition: cfg => isCirc(cfg) },
  { id: 'circular_segment_count', label: 'Number of segments', type: 'range', min: 2, max: 100, step: 1, placeholder: '40', condition: cfg => isCirc(cfg) && cfg.circular_segmented },
  { id: 'circular_segment_thickness', label: 'Pill thickness (%)', type: 'range', min: 0.1, max: 10, step: 0.1, placeholder: '2', condition: cfg => isCirc(cfg) && cfg.circular_segmented },

  { id: '_section_subticks',   icon: icon('ruler'), label: '── Subticks',           type: 'section', condition: cfg => isLin(cfg) && cfg.show_ticks },
  { type: 'note', framedWhen: 'sub_ticks', label: 'The subticks are on the canvas while this bar is open - their number and where they sit are under the chip.' },
  { id: 'show_subticks',       label: 'Show subticks',     type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'sub_ticks' },
  { id: 'subtick_count',       label: 'Count per interval',  type: 'number', placeholder: '4', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_subticks, framedBy: 'sub_ticks' },
  { id: 'subtick_pos',         label: 'Start point / alignment', type: 'select', options: [{value:'main', label:'Same as main ticks'}, {value:'center', label:'Centered'}, {value:'start', label:'At edge (top/left)'}, {value:'end', label:'Opposite (bottom/right)'}, {value:'full', label:'Full width (100%)'}], placeholder: 'main', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_subticks, framedBy: 'sub_ticks' },
  { id: 'subtick_mirror_side', label: 'Also mirror on other side', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_subticks && (cfg.subtick_pos === 'start' || cfg.subtick_pos === 'end'), framedBy: 'sub_ticks' },
  { id: 'subtick_length',      label: 'Subtick length (% or px)',type: 'text', placeholder: '50%', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_subticks && cfg.subtick_pos !== 'full', framedBy: 'sub_ticks' },
  { id: 'subtick_width',       label: 'Width (px or %)',    type: 'text', placeholder: '1', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_subticks, framedBy: 'sub_ticks' },
  { id: 'subtick_color_adaptive', label: 'Dual-adaptive colour (inverted at fill level)', type: 'checkbox', placeholder: 'false', default: false, condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_subticks, framedBy: 'sub_ticks' },
  { id: 'subtick_color',       label: 'Manual colour',        type: 'color', placeholder: 'rgba(255,255,255,0.2)', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_subticks && !cfg.subtick_color_adaptive, framedBy: 'sub_ticks' },

  { id: '_section_custom_ticks', icon: icon('pin'), label: '── Custom Ticks', type: 'section', condition: cfg => isLin(cfg) && cfg.show_ticks },
  { id: 'custom_ticks',        label: 'Insert additional / manual ticks', type: 'custom-ticks', condition: cfg => isLin(cfg) && cfg.show_ticks },

  { id: '_section_tick_labels',icon: icon('type'), label: '── Tick Labels',        type: 'section', condition: cfg => isLin(cfg) && cfg.show_ticks },
  { type: 'note', framedWhen: 'tick_labels', label: 'The tick labels are on the canvas while this bar is open - how many are numbered and to how many places are under the chip.' },
  { id: 'show_tick_labels',    label: 'Show tick labels (numbers)', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks, framedBy: 'tick_labels' },
  { id: 'tick_labeled_extralength', label: 'Extra length at labels', type: 'text', placeholder: '0', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_label_step',     label: 'Only every Xth label (1=all)', type: 'number', placeholder: '1', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_decimals',label: 'Decimals',        type: 'number', placeholder: '0', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_size',    label: 'Font size (CSS text)', type: 'text', placeholder: '10', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_weight',  label: 'Weight', type: 'select', options: [ { value: '400', label: 'Normal' }, { value: '500', label: 'Medium' }, { value: '700', label: 'Bold' } ], condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_hide_unit', label: 'Hide unit', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_hide_first', label: 'Hide first label (min)', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_hide_last', label: 'Hide last label (max)', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_rotation',  label: 'Text rotation', type: 'select', options: [
    { value: '0', label: '0° (horizontal)' },
    { value: '90', label: '90°' },
    { value: '-90', label: '-90°' },
    { value: '180', label: '180° (upside down)' }
  ], condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels },
  { id: 'tick_labels_color_adaptive', label: 'Dual-adaptive colour (inverted at fill level)', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels, framedBy: 'tick_labels' },
  { id: 'tick_labels_color',   label: 'Custom colour',          type: 'color', placeholder: 'var(--secondary-text-color)', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels && !cfg.tick_labels_color_adaptive, framedBy: 'tick_labels' },
  { id: 'tick_labels_pos',     label: 'Positioning',        type: 'select', options: [{value:'start', label:'Before / above'}, {value:'end', label:'After / below'}, {value:'center', label:'Centered'}], condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels },
  { id: 'tick_labels_shift',   label: 'Offset from centre', type: 'text', placeholder: '0', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels },
  { id: 'tick_labels_tick_gap',label: 'Gap to tick', type: 'text', placeholder: '4', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels && cfg.tick_labels_pos !== 'center' },
  { id: 'tick_labels_center_gap_offset', label: 'Adjust centre gap', type: 'text', placeholder: '0', condition: cfg => isLin(cfg) && cfg.show_ticks && cfg.show_tick_labels && cfg.tick_labels_pos === 'center' },

  { id: '_section_label',      icon: icon('tag'), label: '── Label (Name/Label)', type: 'section' },
  { type: 'note', framedWhen: 'label', label: 'The label is on the canvas while this bar is open - on a straight bar drag it where it goes and take its corner to size it; on a ring its type size is under the chip. Which way it reads is under the chip either way.' },
  { id: 'show_label',          label: 'Show name / label', type: 'checkbox', framedBy: 'label' },
  { id: 'label_font_size',     label: 'Font size (e.g. 12 or 12cqw)', type: 'text', placeholder: '12',  condition: cfg => cfg.show_label, framedBy: 'label' },
  { id: 'label_font_weight',   label: 'Weight', type: 'select', options: [ { value: '400', label: 'Normal' }, { value: '500', label: 'Medium' }, { value: '700', label: 'Bold' } ], condition: cfg => cfg.show_label, framedBy: 'label' },
  { id: 'label_color',         label: 'Text colour (manual)',   type: 'color',  placeholder: 'var(--primary-text-color)', condition: cfg => cfg.show_label && !cfg.label_color_adaptive_bar && !cfg.label_color_adaptive_theme },
  { id: 'label_color_adaptive_bar',   label: 'Adaptive: contrast to bar color', type: 'checkbox', condition: cfg => cfg.show_label && isLin(cfg) },
  { id: 'label_color_adaptive_bar',   label: 'Take colour from gradient', type: 'checkbox', condition: cfg => cfg.show_label && isCirc(cfg) },
  { id: 'label_color_adaptive_theme', label: 'Adaptive: HA theme (light/dark)',   type: 'checkbox', condition: cfg => cfg.show_label },
  { id: 'label_position',      label: 'Position in the bar',    type: '9-sector', condition: cfg => isLin(cfg) && cfg.show_label },
  { id: 'label_offset_x',      label: 'X offset',  type: 'text', placeholder: '0', condition: cfg => isLin(cfg) && cfg.show_label, framedBy: 'label' },
  { id: 'label_offset_y',      label: 'Y offset',  type: 'text', placeholder: '0', condition: cfg => isLin(cfg) && cfg.show_label, framedBy: 'label' },
  { id: 'circular_label_offset_y', label: 'Y offset in circle (%)', type: 'range', min: -100, max: 100, step: 1, placeholder: '0', condition: cfg => isCirc(cfg) && cfg.show_label },
  { id: 'label_rotation',      label: 'Text rotation',         type: 'select', options: [
    { value: '0', label: '0° (horizontal)' },
    { value: '90', label: '90°' },
    { value: '-90', label: '-90°' }
  ], condition: cfg => isLin(cfg) && cfg.show_label, framedBy: 'label' },

  { id: '_section_value',      icon: icon('hash'), label: '── Value & Label', type: 'section' },
  { id: 'show_value',          label: 'Show value',         type: 'checkbox' },
  { id: 'value_animated',      label: 'Animate value (follow fill level)', type: 'checkbox', condition: cfg => cfg.show_value },
  { id: 'value_font_size',     label: 'Font size (e.g. 12 or 12cqw)', type: 'text', placeholder: '12', condition: cfg => cfg.show_value },
  { id: 'value_rotation',      label: 'Text rotation',         type: 'select', options: [
    { value: '0', label: '0° (default)' },
    { value: '90', label: '90° (clockwise)' },
    { value: '-90', label: '-90° (counter-clockwise)' }
  ], condition: cfg => isLin(cfg) && cfg.show_value },
  { id: 'value_color',         label: 'Text colour (manual)',   type: 'color',  placeholder: 'var(--primary-text-color)', condition: cfg => cfg.show_value && !cfg.value_color_adaptive_bar && !cfg.value_color_adaptive_theme },
  { id: 'value_color_adaptive_bar',   label: 'Adaptive: contrast to bar color', type: 'checkbox', condition: cfg => cfg.show_value && isLin(cfg) },
  { id: 'value_color_adaptive_bar',   label: 'Take colour from gradient', type: 'checkbox', condition: cfg => cfg.show_value && isCirc(cfg) },
  { id: 'value_color_adaptive_theme', label: 'Adaptive: HA theme (light/dark)',   type: 'checkbox', condition: cfg => cfg.show_value },
  { id: 'value_font_weight',   label: 'Weight', type: 'select', options: [ { value: '400', label: 'Normal' }, { value: '500', label: 'Medium' }, { value: '700', label: 'Bold' } ], condition: cfg => cfg.show_value },
  { id: 'value_decimals',      label: 'Decimals',      type: 'range',  min: 0, max: 3, step: 1, placeholder: '0', condition: cfg => cfg.show_value },
  { id: 'value_unit',          label: 'Custom unit (e.g. %)', type: 'text', placeholder: 'Optional', condition: cfg => cfg.show_value },
  { id: 'value_position',      label: 'Text position',         type: 'select', options: [
    { value: 'center',   label: 'Centred in bar' },
    { value: 'start',    label: 'At the start' },
    { value: 'end',      label: 'At the end' },
    { value: 'floating', label: 'Follows the fill level' }
  ], condition: cfg => isLin(cfg) && cfg.show_value },
  { id: 'circular_value_offset_y', label: 'Y offset in circle (%)', type: 'range', min: -100, max: 100, step: 1, placeholder: '0', condition: cfg => isCirc(cfg) && cfg.show_value },

  { id: '_section_indicator',  icon: icon('pill'), label: '── Indicator & Pill',  type: 'section', condition: cfg => isLin(cfg) },
  { id: 'show_indicator',      label: 'Show indicator line', type: 'checkbox', condition: cfg => isLin(cfg) },
  { id: 'indicator_color_adaptive', label: 'Dual-adaptive colour (inverted at fill level)', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_indicator, framedBy: 'pill' },
  { id: 'indicator_color',     label: 'Line colour',       type: 'color',  placeholder: '#ffffff', condition: cfg => isLin(cfg) && cfg.show_indicator && !cfg.indicator_color_adaptive, framedBy: 'pill' },
  { id: 'indicator_thickness', label: 'Line thickness (px/%)',type: 'text', placeholder: '2px', condition: cfg => isLin(cfg) && cfg.show_indicator, framedBy: 'pill' },
  { type: 'note', framedWhen: 'pill', label: 'The pill is on the canvas while this bar is open - the line it rides, its own colours, its type and its glass are all under the chip.' },
  { id: 'indicator_value',     label: 'Show pill with value on line', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_indicator, framedBy: 'pill' },
  { id: 'value_animated',      label: 'Animate value (follow fill level)', type: 'checkbox', condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value, framedBy: 'pill' },
  { id: 'indicator_value_rotation', label: 'Pill rotation', type: 'select', framedBy: 'pill', options: [
    { value: 'auto', label: 'Auto (upright, as it reads)' },
    { value: '0', label: '0° (horizontal)' },
    { value: '90', label: '90°' },
    { value: '-90', label: '-90°' },
    { value: '180', label: '180° (upside down)' }
  ], condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value },
  // Said where the turn is chosen, because that is where it looks like a free
  // choice. The card keeps the setting either way - it is the drawing that
  // gives way, and it gives way back the moment there is room.
  { type: 'note', framedBy: 'pill', label: 'On its end, the reading has to fit across the bar. Where the bar is too flat for it the pill stands itself upright instead of shrinking out of legibility, and lies back down when the bar is tall enough.',
    condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value
      && Math.abs(parseInt(cfg.indicator_value_rotation)) === 90 },
  { id: 'indicator_value_decimals', label: 'Pill decimal places', type: 'range', min: 0, max: 3, step: 1, placeholder: '0', condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value, framedBy: 'pill' },
  { id: 'indicator_value_adaptive_mode', label: 'Adaptive behavior', type: 'select', framedBy: 'pill', options: [
    { value: 'none', label: 'None (manual colours)' },
    { value: 'pill', label: 'Whole pill (background adaptive, text contrast)' },
    { value: 'text', label: 'Text only (text adaptive, background manual)' }
  ], condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value },
  { id: 'indicator_value_bg',  label: 'Pill background colour', type: 'color',  placeholder: '#000000', condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value && cfg.indicator_value_adaptive_mode !== 'pill', framedBy: 'pill' },
  { id: 'indicator_value_opacity', label: 'Pill opacity (%)', type: 'range', min: 0, max: 100, step: 1, placeholder: '100', condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value, framedBy: 'pill' },
  { id: 'indicator_glass_effect', label: 'Glass effect (pill)', type: 'select', framedBy: 'pill', options: [
    { value: 'none', label: 'No effect (default)' },
    { value: 'glass_gooey', label: 'Liquid & gooey (3D glass + merging)' },
    { value: 'glass_clean', label: 'Clean frost (Apple style)' },
    { value: 'glass_clear', label: 'Clear 3D glass' },
    { value: 'glass_lens', label: 'Convex lens (magnifier)' },
    { value: 'glass_dark', label: 'Dark tinted glass' },
    { value: 'glass_liquid', label: 'Liquid glass (refracts the bar)' },
    { value: 'glass_liquid_heavy', label: 'Liquid glass, thick (more refraction)' }
  ], condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value },
  // Only the two liquid effects carry a displacement map; the rest are paint.
  // The default of 1 is the rim alone, which is the pill every saved card has.
  { id: 'indicator_glass_ior', label: 'Pill refractive index (n)', type: 'range', framedBy: 'pill',
    min: 1, max: MAX_IOR, step: 0.05, placeholder: '1',
    condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value
                   && isLiquidEffect(cfg.indicator_glass_effect),
    hint: 'How dense the pill\'s glass is. At 1 only its rim bends the bar behind '
        + 'it. Higher and the whole pill refracts, and the bar splits into a warm '
        + 'and a cold fringe at the edges. The costly one: measured on 64 pills '
        + 'moving at once, the rim alone held 119 fps and the full index fell to '
        + '53. A pill that has arrived costs nothing again, so on an ordinary bar '
        + 'that is a dip of about a second per reading. What does make it a '
        + 'standing cost is a backdrop that never settles - an animated colour '
        + 'pattern on the fill, or a translucent bar over an animated card '
        + 'background, which the pill has to bend afresh every frame whether the '
        + 'value changes or not.' },
  { id: 'indicator_value_color', label: 'Pill text colour',     type: 'color',  placeholder: '#ffffff', condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value && cfg.indicator_value_adaptive_mode === 'none', framedBy: 'pill' },
  { id: 'indicator_value_font_size', label: 'Pill font size (CSS text)', type: 'text', placeholder: '10', condition: cfg => isLin(cfg) && cfg.show_indicator && cfg.indicator_value, framedBy: 'pill' },
];

/**
 * What a progressbar is before anyone configures it.
 *
 * The canvas adds bars too, and it has no business knowing what one contains
 * - that is this module's, so both add buttons ask here.
 */
function newProgressbarEntry() { return { entity: '', attribute: '', label_text: '' }; }

class ScProgressbarEditor extends LitElement {
  static get properties() {
    return { hass: { type: Object }, slot: { type: Object }, commitFn: { type: Function },
             only: { type: Number }, _expanded: { type: Object, state: true },
             // Which parts the canvas has taken over, and which fold the part
             // in hand belongs to. Both are the canvas editor's to say, and
             // both mean nothing when this editor is opened from the card's
             // own menu, which is why neither has a default beyond empty.
             framed: { type: Array }, priority: { type: String } };
  }

  constructor() {
    super();
    this._expanded = {};
  }

  static get styles() {
    // The gauge editor's look, because the two are the same kind of form and
    // used to differ only in which stylesheet they happened to start from.
    return [SC.formStyles, css`
      input[type="text"], input[type="number"], select { transition: border-color 0.2s; }
      .fx-slot { margin: 8px 0; padding: 8px; border-radius: 6px;
                 background: rgba(255,255,255,0.03); border: 1px solid var(--divider-color,#555); }
      details.inner-section { background: rgba(120,120,120,0.05); border: 1px solid var(--divider-color,#444); border-radius: 6px; margin: 0 16px 16px 16px; }
      /* A column so that the order property means something: the fold whose
         part is in hand on the canvas comes first, however far down it sits. */
      .folds { display: flex; flex-direction: column; }
      details.inner-section.wanted { order: -1; border-color: var(--primary-color,#03a9f4); }
      .field-note { font-size: 11px; line-height: 1.4; color: var(--secondary-text-color); }
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
      .sector-btn:hover { background: var(--primary-color, #03a9f4); opacity: 0.7; }
      .sector-btn.active { background: var(--primary-color, #03a9f4); box-shadow: 0 0 4px rgba(3,169,244,0.5); }

      /* A custom tick is a row of small fields, which is a bar's own shape. */
      .stop-row { display: flex; align-items: center; gap: 5px; background: rgba(255,255,255,0.04); padding: 4px 6px; border-radius: 4px; }
      .stop-row input[type="color"] { width: 32px; height: 26px; padding: 0; border: none; background: none; cursor: pointer; flex-shrink: 0; }
      .stop-row input[type="text"], .stop-row input[type="number"] { font-size: 11px; }
      .stop-row .del-btn { background: none; border: none; color: #f44; cursor: pointer; font-size: 14px; padding: 0; }
    `];
  }

  _addProgressbar(bars) {
    const newBars = structuredClone(bars);
    newBars.push(newProgressbarEntry());
    this._expanded[`pb_${newBars.length - 1}`] = true;
    this.commitFn('progressbars', newBars);
  }

  _removeProgressbar(idx, bars) {
    const newBars = structuredClone(bars);
    newBars.splice(idx, 1);
    this.commitFn('progressbars', newBars);
  }

  _renderField(field, cfg, updateDirect, updateDebounced, idx, updateMany) {
    if (field.condition && !field.condition(cfg, this.slot)) return html``;
    // This editor draws its own fields, so the rule the shared renderer
    // applies has to be asked for by name here - not written out a second
    // time, or the two would drift.
    if (SC.fieldFramed(field, cfg, new Set(this.framed || []))) return html``;
    let content;
    const val = cfg[field.id];

    switch (field.type) {
      case 'colour_pattern':
        // The pattern layer is the bar's backdrop - track, fill and pill draw
        // over it. Pump is left out: it would scale that backdrop alone, under
        // a bar that stays where it is.
        content = html`
          <sc-color-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                          .switchless=${true} .noPump=${true}
                          .label=${'Background pattern & animation'}
                          .target=${'elm_progressbar_' + idx}></sc-color-panel>`;
        break;
      case 'section':
        content = html`<div class="section-title">${field.icon
          ? html`<span class="field-icon">${field.icon}</span>` : ''}${field.label}</div>`;
        break;
      // Not a control: the line that stands in for a row the canvas has taken
      // over, so a fold that has lost most of itself does not read as one that
      // is missing something.
      case 'note':
        return html`<div class="field-note">${field.icon
          ? html`<span class="field-icon">${field.icon}</span>` : ''}${field.label}</div>`;
      case 'checkbox':
        content = html`
          <div class="row">
            <label>${field.label}</label>
            <label class="toggle">
              <input type="checkbox" .checked=${val === true} @change=${e => updateDirect(e.target.checked)}>
              <span class="toggle-slider"></span>
            </label>
          </div>`;
        break;
      case 'select':
        content = html`
          <div class="row">
            <label>${field.label}</label>
            <select @change=${e => updateDirect(e.target.value)}>
              ${SC.fieldOptions(field, cfg, this).map(opt => html`<option value="${opt.value}" ?selected=${val === opt.value}>${opt.label}</option>`)}
            </select>
          </div>`;
        break;
      case '9-sector': {
        const sectors = ['top-left','top-center','top-right','center-left','center','center-right','bottom-left','bottom-center','bottom-right'];
        content = html`
          <div class="col">
            <label>${field.label}</label>
            <div class="sector-grid">
              ${sectors.map(s => html`<div class="sector-btn ${val === s ? 'active' : ''}" title="${s}" @click=${() => updateDirect(s)}></div>`)}
            </div>
          </div>`;
        break;
      }
      case 'range': {
        // A dynamic step is fine-grained below ten and whole above it, and it
        // has to follow the value as it is dragged, not only per render.
        const shown = val ?? field.placeholder ?? 0;
        const step = field.dynamic_step ? (shown < 10 ? '0.1' : '1') : (field.step ?? 1);
        content = SC.sliderField(field.label, shown, v => updateDirect(v),
          { min: field.min ?? 0, max: field.max ?? 100, step,
            shown: val ?? field.placeholder ?? '', dynamicStep: !!field.dynamic_step });
        break;
      }
      case 'color':
        content = html`
          <div class="col">
            <label>${field.label}</label>
            ${SC.colorRow(val || '', updateDirect, { fallback: '#000000',
              placeholder: field.placeholder || '', onText: updateDebounced })}
          </div>`;
        break;
      // A length and the unit it is in, the way a surface's corner is set.
      case 'length':
        content = SC.lengthField(field.label, val, updateDirect,
          { dflt: field.dflt, placeholder: field.placeholder,
            min: field.min, max: field.max, step: field.step });
        break;
      case 'ramp':
        content = updateMany
          ? SC.rampGrid(id => updateMany(gradientPresetPatch(id, 'bar')))
          : html``;
        break;
      case 'gradient-stops':
        content = html`
          <div class="col">
            <label>${field.label}</label>
            <sc-gradient-stops .onUpdate=${n => updateDirect(n)}
              .stops=${Array.isArray(val) && val.length ? val
                : [{ color: cfg.color1 || '#2196f3', pos: 0 },
                   { color: cfg.color2 || '#4caf50', pos: 100 }]}></sc-gradient-stops>
          </div>`;
        break;
      case 'custom-ticks': {
        const ct = Array.isArray(val) ? val : [];
        const updCt = n => updateDirect(n);
        content = html`
          <div class="col">
            <label>${field.label}</label>
            ${ct.map((t, ti) => html`
              <div class="stop-row" style="flex-wrap:wrap; gap:6px; margin-bottom:4px; padding:8px; background:rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.05); border-radius:6px;">
                <div style="display:flex; align-items:center; gap:4px;">
                  <span style="font-size:10px; color:var(--secondary-text-color);">Value</span>
                  <input type="number" placeholder="Value" style="width:40px" .value=${t.value ?? 50} @input=${e => updCt(ct.map((x,i) => i===ti ? {...x, value: parseFloat(e.target.value)||0} : x))}>
                </div>
                <div style="display:flex; align-items:center; gap:4px;">
                  <input type="color" .value=${t.color || '#ff0000'} @input=${e => updCt(ct.map((x,i) => i===ti ? {...x, color: e.target.value} : x))}>
                </div>
                <div style="display:flex; align-items:center; gap:4px;">
                  <span style="font-size:10px; color:var(--secondary-text-color);">Width</span>
                  <input type="text" style="width:40px" placeholder="W(px/%)" .value=${t.width || '2px'} @input=${e => updCt(ct.map((x,i) => i===ti ? {...x, width: e.target.value} : x))}>
                </div>
                <div style="display:flex; align-items:center; gap:4px;">
                  <span style="font-size:10px; color:var(--secondary-text-color);">Length</span>
                  <input type="text" style="width:45px" placeholder="main" title="Empty or 'main' for main tick length" .value=${t.length || ''} @input=${e => updCt(ct.map((x,i) => i===ti ? {...x, length: e.target.value} : x))}>
                </div>
                <div style="display:flex; align-items:center; gap:4px; flex:1;">
                  <select style="width:100%; font-size:11px; padding:2px;" @change=${e => updCt(ct.map((x,i) => i===ti ? {...x, align: e.target.value} : x))}>
                    <option value="main" ?selected=${!t.align || t.align === 'main'}>Pos: Same as main</option>
                    <option value="center" ?selected=${t.align === 'center'}>Pos: Centred</option>
                    <option value="start" ?selected=${t.align === 'start'}>Pos: Edge 1</option>
                    <option value="end" ?selected=${t.align === 'end'}>Pos: Edge 2</option>
                    <option value="full" ?selected=${t.align === 'full'}>Pos: Full</option>
                  </select>
                </div>
                ${(t.align === 'start' || t.align === 'end') ? html`
                  <div style="display:flex; align-items:center; gap:2px;" title="Mirror to other side">
                    <input type="checkbox" .checked=${!!t.mirror} @change=${e => updCt(ct.map((x,i) => i===ti ? {...x, mirror: e.target.checked} : x))}>
                    <span style="font-size:10px; opacity:0.8;">${icon('flip-vertical')}</span>
                  </div>
                ` : ''}
                <button class="del-btn" @click=${() => updCt(ct.filter((_,i) => i !== ti))}>${icon('trash-2')}</button>
              </div>`)}
            <button type="button" class="add-btn" style="margin-top:4px; padding:6px;"
              @click=${() => updCt([...ct, { value: 50, color: '#ff0000', width: '2px', length: '', align: 'main', mirror: false }])}>${icon('plus')} Add custom tick</button>
          </div>`;
        break;
      }
      default:
        content = html`
          <div class="col">
            <label>${field.label}</label>
            <input type=${field.type === 'number' ? 'number' : 'text'} .value=${val ?? ''} placeholder="${field.placeholder || ''}"
              @input=${e => updateDebounced(field.type === 'number' ? parseFloat(e.target.value) : e.target.value)}>
          </div>`;
        break;
    }
    return html`<div class="field-wrapper">${content}</div>`;
  }

  _renderFieldsGroup(fields, cfg, idx, bars) {
    let timeout;
    const updateDirect    = (key, val) => {
      const next = SC.withPatch(bars, idx, key, val);
      if (key === 'orientation') {
        // A ring is square-locked on the canvas, and the canvas squares a box
        // only when someone edits it. Picking the orientation is that edit, so
        // the box follows now instead of staying a letterbox until the next
        // drag. One commit for both: `_commit` clones the config and Home
        // Assistant writes it back asynchronously, so two in a tick lose one.
        const canvas = squareBarOnCanvas(this.slot?.canvas, idx, val);
        if (canvas && canvas !== this.slot.canvas) {
          this.commitFn('__merge__', { progressbars: next, canvas });
          return;
        }
      }
      this.commitFn('progressbars', next);
    };
    const updateDebounced = (key, val) => { clearTimeout(timeout); timeout = setTimeout(() => updateDirect(key, val), 400); };
    // One press, several keys: a ramp is its colours *and* the switch that
    // says the fill is one. Written in a single commit, because `_commit`
    // clones the config and Home Assistant writes it back asynchronously -
    // two commits in a tick silently lose the first.
    const updateMany = patch => {
      if (!patch) return;
      const next = structuredClone(bars);
      Object.assign(next[idx], patch);
      this.commitFn('progressbars', next);
    };

    const groups = [];
    let cur = null;
    fields.forEach(f => {
      if (f.type === 'section') { if (cur) groups.push(cur); cur = { id: f.id, icon: f.icon, label: f.label.replace('── ', ''), fields: [] }; }
      else if (cur) cur.fields.push(f);
    });
    if (cur) groups.push(cur);

    return html`
      <div class="folds">
      ${groups.map(g => {
        const visibleFields = g.fields.filter(f => !f.condition || f.condition(cfg, this.slot));
        if (visibleFields.length === 0) return html``;

        const sKey = `s_${idx}_${g.label}`;
        if (this._expanded[sKey] === undefined) this._expanded[sKey] = false;
        // The fold the part in hand lives in is opened and pulled to the top.
        // The numbers on the canvas are the ones reached for first; the rest
        // of what a part can be given is in here, and it used to be eight
        // folds down - far enough that reaching it scrolled the canvas, and a
        // frame that cannot be seen cannot be dragged.
        const wanted = !!g.id && this.priority === g.id;
        return html`
          <details class="inner-section ${wanted ? 'wanted' : ''}" data-section=${g.id || ''}
            ?open=${this._expanded[sKey] || wanted}
            @toggle=${e => { this._expanded[sKey] = e.target.open; this.requestUpdate(); }}>
            <summary style="display:flex; justify-content:space-between; align-items:center;">
              <span style="flex: 1;">${g.icon
                  ? html`<span class="field-icon">${g.icon}</span>` : ''}${g.label}</span>
              <span style="font-size:12px; display:inline-flex; opacity:.6;">${icon('chevron-down')}</span>
            </summary>
            <div class="inner-content">
              ${g.fields.map(f => this._renderField(f, cfg, v => updateDirect(f.id, v), v => updateDebounced(f.id, v), idx, updateMany))}
            </div>
          </details>`;
      })}
      </div>`;
  }

  _renderBarPanel(entry, idx, bars) {
    const { entity: resolvedEntity, match: aliasObj } = SC.resolveAlias(this.slot?.global_entities, entry);
    const isAlias = !!aliasObj;

    let title = '';
    if (isAlias) {
      const s = resolvedEntity ? this.hass?.states[resolvedEntity] : null;
      const friendly = s ? (s.attributes.friendly_name || resolvedEntity) : (resolvedEntity || 'Unnamed');
      let val = s ? (aliasObj.attribute ? s.attributes[aliasObj.attribute] : s.state) : '-';
      const uom = (s && !aliasObj.attribute && s.attributes.unit_of_measurement) ? ` ${s.attributes.unit_of_measurement}` : '';
      title = `[${aliasObj.alias || 'Alias'}] ${friendly}`;
      if (aliasObj.attribute) title += ` (${aliasObj.attribute})`;
      title += ` ➔ ${val}${uom}`;
    } else {
      title = entry.label_text || '';
      if (!title && resolvedEntity && this.hass?.states[resolvedEntity]) {
        title = this.hass.states[resolvedEntity].attributes.friendly_name || resolvedEntity;
      } else if (!title) {
        title = `Bar ${idx + 1}`;
      }
    }

    const stateKey = `pb_${idx}`;
    if (this._expanded[stateKey] === undefined) this._expanded[stateKey] = false;
    const updateEntry = (key, val) => { this.commitFn('progressbars', SC.withPatch(bars, idx, key, val)); };

    return html`
      <details class="inner-section" ?open=${this._expanded[stateKey]} @toggle=${e => this._expanded[stateKey] = e.target.open}>
        <summary style="opacity: ${entry.active !== false ? '1' : '0.6'};">
          <span>${title}</span>
          <div style="display:flex; gap:12px; align-items:center;" @click=${e => e.stopPropagation()}>
            <ha-switch
              .checked=${entry.active !== false}
              title="Enable / disable bar"
              style="margin-right: 4px;"
              @change=${e => updateEntry('active', e.target.checked)}>
            </ha-switch>
            <button title="Clone"
              style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--primary-color);padding:0;"
              @click=${e => {
                e.preventDefault();
                const n = structuredClone(bars);
                const clone = structuredClone(n[idx]);
                if(clone.label_text) clone.label_text += ' (Copy)';
                n.splice(idx + 1, 0, clone);
                this.commitFn('progressbars', n);
                this._expanded[`pb_${idx + 1}`] = true;
                this.requestUpdate();
              }}>${icon('copy')}</button>
            <button title="Move up" ?disabled=${idx === 0}
              style="background:none;border:none;cursor:${idx===0?'default':'pointer'};font-size:14px;color:${idx===0?'var(--divider-color,#555)':'var(--primary-text-color)'};padding:0;"
              @click=${e => { e.preventDefault(); if(idx===0) return; const n=structuredClone(bars); const t=n[idx-1]; n[idx-1]=n[idx]; n[idx]=t; this.commitFn('progressbars',n); }}>${icon('chevron-up')}</button>
            <button title="Move down" ?disabled=${idx === bars.length-1}
              style="background:none;border:none;cursor:${idx===bars.length-1?'default':'pointer'};font-size:14px;color:${idx===bars.length-1?'var(--divider-color,#555)':'var(--primary-text-color)'};padding:0;"
              @click=${e => { e.preventDefault(); if(idx===bars.length-1) return; const n=structuredClone(bars); const t=n[idx+1]; n[idx+1]=n[idx]; n[idx]=t; this.commitFn('progressbars',n); }}>${icon('chevron-down')}</button>
            <button title="Remove"
              style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--error-color,#f44);padding:0;"
              @click=${e => { e.preventDefault(); this._removeProgressbar(idx, bars); }}>${icon('trash-2')}</button>
          </div>
        </summary>
        ${this._renderBarBody(entry, idx, bars)}
      </details>`;
  }

  /**
   * One bar's fields, without the panel around them.
   *
   * Its own section renders it inside a `<details>` that names the entry; the
   * canvas editor renders it alone, under the element the user has selected,
   * where the element list above it has already said which bar this is.
   */
  _renderBarBody(entry, idx, bars) {
    const updateEntry = (key, val) => { this.commitFn('progressbars', SC.withPatch(bars, idx, key, val)); };
    return html`
        <div class="inner-content">
          <div class="entity-row">
            <label>Internal name / manual label</label>
            <input type="text" .value=${entry.label_text || ''} placeholder="Shown on the bar (if active)"
              ?disabled=${entry.use_alias_name && entry.global_id && entry.global_id !== 'manual'}
              style=${entry.use_alias_name && entry.global_id && entry.global_id !== 'manual' ? 'opacity: 0.5;' : ''}
              @input=${e => updateEntry('label_text', e.target.value)}>
          </div>

          <div class="entity-row" style="margin-top: 4px; margin-bottom: 4px;">
            <label>Data source</label>
            <select style="width: 100%;" @change=${e => updateEntry('global_id', e.target.value)}>
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

          ${(entry.global_id && entry.global_id !== 'manual') ? html`
            <div class="row" style="margin-bottom: 8px; background: rgba(3, 169, 244, 0.1); padding: 6px 8px; border-radius: 4px; border: 1px solid rgba(3, 169, 244, 0.2);">
              <label style="color: var(--primary-color);">Use alias name as bar label</label>
              <label class="toggle">
                <input type="checkbox" .checked=${!!entry.use_alias_name}
                  @change=${e => updateEntry('use_alias_name', e.target.checked)}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          ` : html`
            <div style="background:rgba(0,0,0,0.15); padding:10px; border-radius:8px; border:1px solid var(--divider-color,#333); margin-bottom:8px;">
              <div class="entity-row" style="margin-bottom: 8px;">
                <label>Source</label>
                <ha-entity-picker .hass=${this.hass} .allowCustomEntity=${false} .value=${entry.entity || ''} @value-changed=${e => updateEntry('entity', e.detail.value)}></ha-entity-picker>
              </div>
              <div class="entity-row">
                <label>Attribute</label>
                <ha-selector .hass=${this.hass} .selector=${{ attribute: { entity_id: entry.entity || this.slot?.entity || '' } }} .value=${entry.attribute || ''} @value-changed=${e => updateEntry('attribute', e.detail.value || '')}></ha-selector>
              </div>
            </div>
          `}

          ${bars.length > 1 ? html`
            <div class="row" style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--divider-color,#444);">
              <label>Copy style from...</label>
              <select style="width:60%" @change=${e => {
                const srcIdx = parseInt(e.target.value);
                if (isNaN(srcIdx)) return;
                const n = structuredClone(bars);
                const src = n[srcIdx];
                n[idx] = { ...src, entity: n[idx].entity, attribute: n[idx].attribute, label_text: n[idx].label_text, global_id: n[idx].global_id };
                this.commitFn('progressbars', n);
                e.target.value = '';
              }}>
                <option value="" selected disabled>Please select...</option>
                ${bars.map((b,i) => i !== idx ? html`<option value=${i}>Bar ${i+1}${b.label_text?' — '+b.label_text:(b.entity?' — '+b.entity.split('.')[1]:'')}</option>` : '')}
              </select>
            </div>` : ''}
          ${this._renderFieldsGroup(STYLE_FIELDS, entry, idx, bars)}
          <div class="fx-slot">
            <sc-fx-glass-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                               .target=${'elm_progressbar_' + idx}></sc-fx-glass-panel>
          </div>
          <div class="fx-slot">
            <sc-push-panel .hass=${this.hass} .slot=${this.slot} .commitFn=${this.commitFn}
                           .target=${'progressbar_' + idx}></sc-push-panel>
          </div>
        </div>`;
  }

  render() {
    if (!this.slot) return html``;
    const bars = Array.isArray(this.slot.progressbars) ? this.slot.progressbars : [];
    // One entry alone, for the canvas editor: no section, no switch, no add
    // button - the canvas has already chosen which bar is being edited.
    if (typeof this.only === 'number') {
      return bars[this.only] ? this._renderBarBody(bars[this.only], this.only, bars) : html``;
    }
    if (this._expanded['_main'] === undefined) this._expanded['_main'] = false;

    return html`
      <details class="inner-section" ?open=${this._expanded['_main']}
        @toggle=${e => { this._expanded['_main'] = e.target.open; this.requestUpdate(); }}>
        <summary>${icon('chart-gantt')} Progressbars
          <div style="display:flex; align-items:center; gap:8px; margin-left:auto;">
            <span style="font-size:10px; opacity:.6; font-weight:400;">
              ${bars.length} Bar${bars.length !== 1 ? 's' : ''}
            </span>
            <ha-switch
              .checked=${!!this.slot.progressbar_active}
              @click=${e => e.stopPropagation()}
              @change=${e => this.commitFn('progressbar_active', e.target.checked)}>
            </ha-switch>
          </div>
        </summary>
        <div class="inner-content">
          ${!this.slot.progressbar_active ? html`
            <div style="font-size:12px; color:var(--secondary-text-color); text-align:center; padding:8px 0;">
              Module disabled
            </div>` : html`
            ${bars.map((entry, idx) => this._renderBarPanel(entry, idx, bars))}
            <button type="button" class="add-btn" @click=${() => this._addProgressbar(bars)}>
              ${icon('plus')} Add new progressbar
            </button>`}
        </div>
      </details>`;
  }
}
if (!customElements.get('sc-progressbar-editor')) customElements.define('sc-progressbar-editor', ScProgressbarEditor);

// ==========================================
// THE EDITOR HALF OF THE MODULE
// ==========================================
window.SupercardModules['progressbar'] = window.SupercardModules['progressbar'] || {};
Object.assign(window.SupercardModules['progressbar'], (() => {

  function editorFields() { return []; }

  let _cachedEditor = null;
  function renderCustomBlock(commitFn, hass, slot) {
    if (!_cachedEditor) _cachedEditor = document.createElement('sc-progressbar-editor');
    _cachedEditor.commitFn = commitFn;
    _cachedEditor.hass = hass;
    _cachedEditor.slot = slot;
    return _cachedEditor;
  }

  // See the gauge's: the canvas asks this which fold a part took its rows
  // from, to know whether its panel should point at the form below.
  return /** @type {SupercardModule} */ ({ editorFields, renderCustomBlock,
                                           newEntry: newProgressbarEntry,
                                           formFields: () => STYLE_FIELDS,
                                           ownedByCanvas: true });
})());
