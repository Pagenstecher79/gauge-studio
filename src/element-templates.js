/**
 * Ready-made gauges and progressbars to start an element from.
 *
 * An empty gauge is a correct gauge and a useless picture: no range, no
 * colours, a needle parked at zero. Everything that makes one readable - where
 * the scale starts, how many ticks, which colour means bad - is a decision
 * about the *quantity*, not about the person's dashboard, and the same seven
 * or eight decisions come back for every temperature in the world. So the menu
 * offers them already made, and what is left for the person to do is pick the
 * entity.
 *
 * A template is an ordinary entry - the same object `newEntry` returns, with
 * more keys set. It is handed to `addElement` exactly where an empty one would
 * be, so nothing downstream knows a template was involved.
 *
 * **No template names an entity.** Entity ids belong to the dashboard the card
 * lands on, and a template that shipped one would either point at nothing or,
 * worse, at something. `previewFor` below adds a synthetic one for the
 * miniature in the menu, and that entity never leaves this file.
 *
 * The values are honest starting points rather than the last word: a
 * temperature that never leaves a cellar wants a different range, and every
 * key here is in the element's own editor.
 */

/**
 * @typedef {object} ElementTemplate
 * @property {string} id      stable key, used by `templateEntry`
 * @property {string} label   what the menu calls it
 * @property {string} hint    the one line under the label
 * @property {number} sample  a plausible reading, for the preview only
 * @property {number} [aspect] the box shape it wants, width over height
 * @property {Record<string, any>} entry  the config the template lays down
 */

/**
 * What every gauge template agrees on: a 270-degree face with a closed ring,
 * a triangle pointer and an adaptive tick colour, so the templates differ in
 * what is actually about the quantity - range, decimals, unit, colours.
 *
 * Sizes are the gauge's own viewBox units, not pixels: a gauge on the canvas
 * is the size of its box, and these numbers keep their proportions at any of
 * them.
 */
export const GAUGE_FACE = Object.freeze({
  gauge_type: 'semi',
  gauge_scale: 0.9,
  // `gauge_scale` is how far out the gauge reaches - the outermost thing it
  // draws, with the frame ring and the gap subtracted from there inwards.
  // Cards written before that read it as the radius of the value ring alone,
  // with the frame stacked on top, so they are translated on the way in
  // rather than rewritten; this says which of the two this card means.
  scale_from_outer: true,
  frame_ring_active: true,
  frame_ring_closed: true,
  frame_ring_width: 0.3,
  frame_ring_gap: 0.5,
  frame_ring_color_type: 'adaptive',
  stroke_width: 1,
  gradient_resolution: 'auto',

  // The pointer crosses the face. `pointer_length` is measured back from the
  // tip, and the tip starts one unit inside a ring that is about 21 units
  // out, so 26 puts the tail a few units past the hub - the counterweight a
  // moving-coil needle has, and the thing that makes the difference between a
  // pointer and a marker riding the rim.
  pointer_type: 'triangle',
  pointer_length: 26,
  pointer_offset: 1,
  pointer_width: 1.4,
  pointer_center_radius: 2,
  // Both of these default to a fixed white, which is a white marker on a
  // white card for anyone on a light theme. Nothing the card draws should be
  // one theme's colour: it is the reader's theme that decides what is legible,
  // so every mark and every figure here follows `--primary-text-color`.
  pointer_color_type: 'adaptive',
  pointer_dot_color_type: 'adaptive',
  // A pointer without a shadow is painted on the dial; with one it lies above
  // it. Off the vertical, because a shadow straight down reads as a printing
  // mistake rather than as a light source.
  pointer_shadow_type: 'adaptive',
  pointer_shadow_distance: 1.25,
  pointer_shadow_angle: 40,
  pointer_shadow_blur: 0.3,

  animation_duration: 2,

  // A name across the middle and the reading beneath it, at the bottom of the
  // dial. Not decoration: with the pointer sweeping the whole face there is
  // no middle left to put a number in, and the two lines together are what
  // makes a gauge legible in a grid of them - the name says which one this
  // is, and the figure is read after it, not instead of it.
  //
  // The two sizes and the two distances are read off a dial that was arranged
  // by hand until it looked right - the demo's CO2 gauge - rather than picked
  // one at a time. A name at 6 units crowds the hub on a semicircle and a
  // reading at 5.5 runs into the scale beneath it; these are the numbers that
  // leave both of them room.
  gauge_label_active: true,
  gauge_label_font_size: 4.1,
  gauge_label_offset_y: 10.7,
  gauge_label_color_type: 'adaptive',

  show_value: true,
  value_font_size: 4.9,
  value_offset_y: 20,
  value_color_type: 'adaptive',
  // With no entity there is no unit to inherit, so the template carries its
  // own in `value_custom_unit` - which this switch is what reads.
  value_show_raw_unit: true,

  // The same dial's scale: marks a touch longer than they are far from the
  // ring, numbers small enough that a dozen of them do not touch, and far
  // enough in that they sit on the face rather than on the arc.
  show_tick_labels: true,
  tick_width: 0.3,
  tick_length: 1.8,
  tick_offset: -0.9,
  tick_color_type: 'adaptive',
  tick_label_font_size: 2.5,
  tick_label_offset: -4.5,
  tick_label_step: 2,
  tick_label_extra_length: 0.5,
  tick_label_color_type: 'adaptive',
  sub_tick_count: 4,
  sub_tick_width: 0.1,
  sub_tick_offset: -1.2,
  sub_tick_length: 0.8,
  sub_tick_color_type: 'adaptive',
});

/**
 * What a scale whose numbers run to four digits needs on top of the face.
 *
 * Eleven four-digit labels around a 270-degree arc touch each other, and a
 * scale whose numbers touch is read as no scale at all - so there are fewer of
 * them. Not smaller: the face's size is already one that four digits are read
 * at, and shrinking the numbers as well would buy room nobody needs at the
 * cost of the one thing the scale is for.
 *
 * Only the scale. The reading is at the bottom of the dial, where it has the
 * whole width to itself and nothing to collide with.
 */
const WIDE_NUMBERS = Object.freeze({
  tick_label_step: 4,
});


/**
 * A thin needle on a visible hub, in place of the tapered pointer.
 *
 * `GAUGE_FACE` already sweeps the whole face; this is the other shape that
 * sweep can have. The wedge is the pointer of a modern dial - it has a
 * direction and a width, and the width is part of how you read it. A needle
 * is the pointer of an instrument: almost no width at all, so it picks out a
 * single graduation rather than a region, on a hub big enough to see.
 *
 * Which is the same as saying it is for the scales where the reading is a
 * number somebody will act on, not a band somebody will glance at.
 */
const ANALOG_NEEDLE = Object.freeze({
  pointer_type: 'needle',
  pointer_width: 0.5,
  pointer_center_radius: 2.5,
  pointer_shadow_blur: 0.2,
  // The one colour in the templates that is not the theme's. A hub this size
  // in `--primary-text-color` is a blob the eye goes to before the needle -
  // and the hub is not the reading. Mid-grey is the machined-metal cap of the
  // thing being imitated, and it is also the one value that stays legible on
  // a light theme and a dark one without following either.
  pointer_dot_color_type: 'fixed',
  pointer_dot_color: '#7a7a7a',
});

/**
 * A small triangle riding the rim, in place of a pointer that crosses the face.
 *
 * The third shape, and the one that is not an instrument at all. A needle or a
 * wedge asks to be read against a graduation; a marker asks only *where on the
 * band am I*, which is the honest question for a percentage whose colours
 * already say what the number means. It also leaves the middle of the dial
 * empty, so the name and the reading stand on their own.
 *
 * The apex sits at the arc and the base a couple of units inside it, and there
 * is no hub, because a hub is the thing a pointer turns about and this does not
 * turn about anything - it slides.
 */
const RIM_MARKER = Object.freeze({
  pointer_type: 'triangle',
  pointer_length: 2.6,
  pointer_offset: 1.2,
  pointer_width: 2.6,
  pointer_center_radius: 0,
  pointer_shadow_distance: 0.8,
  pointer_shadow_blur: 0.25,
});

/**
 * A scale of 0 to 100 with every twentieth labelled.
 *
 * The face labels every second tick, which over 21 of them puts a 40 and a 50
 * on either side of twelve o'clock with nothing between them. Six labels leave
 * the top of the arc empty, which is where the needle spends its time.
 */
const HUNDRED = Object.freeze({
  min: 0,
  max: 100,
  tick_count: 21,
  tick_label_step: 4,
});

/**
 * A manual stop list, from pairs of percent and colour.
 *
 * `threshold_unit: 'percent'` on every template that uses stops, because a
 * percent list survives a change of range: someone who moves a temperature
 * gauge from -10..50 to 15..25 keeps a blue bottom and a red top, where a list
 * in degrees would put every colour off the left edge.
 */
const stops = (...pairs) => pairs.map(([pos, color]) => ({ pos, color }));

/**
 * What a gauge looks like before anyone has chosen anything about it.
 *
 * An empty gauge used to be the renderer's own fallbacks, and those are not a
 * design - they are what each field does when nobody has answered it. No ticks
 * at all, a stubby pointer twice as wide as it should be, and a tick label
 * offset of +10, which puts the numbers outside the gradient ring rather than
 * inside it. Someone who adds a gauge and then switches the labels on is shown
 * a scale that has fallen off the dial, and their first job is to put it back.
 *
 * So the same face the templates wear, with the three things a template would
 * otherwise have supplied: a range, a tick count that suits it, and a
 * gradient. It is not a template and does not appear in the menu - it is what
 * *any* new gauge starts as, including one a template is about to overwrite.
 *
 * No frame ring: the gradient arc is already the ring, and a second one around
 * it is a decision about the card rather than about a gauge that has no entity
 * yet. The ticks and their labels sit *inside* that arc, which is the whole
 * point - `tick_offset` and `tick_label_offset` are measured outward from the
 * ring, so both are negative.
 */
export const GAUGE_DEFAULT = Object.freeze({
  ...GAUGE_FACE,
  frame_ring_active: false,

  min: 0,
  max: 100,

  // A slightly heavier arc than a template's, because there is no frame ring
  // outside it to give the dial an edge.
  stroke_width: 1.25,
  gradient_resolution: 'superfine',

  // Thin enough to pick out one graduation rather than a region: with 21 of
  // them there is a mark to point at, and a wedge would cover three.
  pointer_width: 0.7,

  // How many marks is the one thing a template answers for itself; the shape
  // of them is the face's, and repeating it here is how the two drifted apart.
  tick_count: 21,

  // Green through to red across the range, in per cent so the colours survive
  // the first change of min and max - the same reasoning as the templates'.
  gradient_preset: 'manual',
  threshold_unit: 'percent',
  manual_stops: stops([0, '#4caf50'], [33.3, '#fdd835'],
                      [66.7, '#fb8c00'], [100, '#f44336']),
});

/** @type {readonly ElementTemplate[]} */
export const GAUGE_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'temperature',
    label: 'Temperature',
    hint: '-10 to 50 °C, cold blue to hot red',
    sample: 21.4,
    entry: Object.freeze({
      ...GAUGE_FACE,
      // A placeholder, and the first thing to overwrite: the label is where
      // a room or a phase goes once the element has an entity. It ships as
      // the quantity so that a gauge picked from the menu is already saying
      // something true about itself.
      gauge_label_text: 'Temp',
      min: -10, max: 50,
      value_decimals: 1,
      value_custom_unit: '°C',
      tick_count: 13,
      gradient_preset: 'manual',
      threshold_unit: 'percent',
      // 0 % is -10 °C and 100 % is 50 °C, so the green sits at about 21 - the
      // temperature a living room is aiming at, and the one the eye should
      // read as "right" without stopping to work it out.
      manual_stops: stops([0, '#2c1376'], [33, '#00a3d7'], [52, '#008f00'],
                          [75, '#fec700'], [100, '#e32400']),
    }),
  }),
  Object.freeze({
    id: 'humidity',
    label: 'Humidity',
    hint: '0 to 100 %, comfortable in the middle',
    sample: 54,
    entry: Object.freeze({
      ...GAUGE_FACE,
      // A placeholder, and the first thing to overwrite: the label is where
      // a room or a phase goes once the element has an entity. It ships as
      // the quantity so that a gauge picked from the menu is already saying
      // something true about itself.
      gauge_label_text: 'Hum',
      ...HUNDRED,
      // Nobody acts on the third digit of a humidity: the question is dry,
      // comfortable or damp, and the arc answers it in colour. So the pointer
      // is a marker on the band rather than a needle over a graduation.
      ...RIM_MARKER,
      value_decimals: 1,
      value_custom_unit: '%',
      gradient_preset: 'manual',
      threshold_unit: 'percent',
      // Both ends are the problem here and the middle is the good place, which
      // is why this one cannot borrow the temperature ramp: dry air is as bad
      // as wet, so red is at 0 and deep blue at 100.
      manual_stops: stops([0, '#b51a00'], [30, '#fec700'], [45, '#669c35'],
                          [60, '#669c35'], [75, '#00c7fc'], [100, '#0042aa']),
    }),
  }),
  Object.freeze({
    id: 'co2',
    label: 'CO₂',
    hint: '400 to 2400 ppm, fresh air to stuffy',
    sample: 812,
    entry: Object.freeze({
      ...GAUGE_FACE,
      // A placeholder, and the first thing to overwrite: the label is where
      // a room or a phase goes once the element has an entity. It ships as
      // the quantity so that a gauge picked from the menu is already saying
      // something true about itself.
      gauge_label_text: 'CO₂',
      ...WIDE_NUMBERS,
      // Round on both ends and divisible by the tick count, so every label the
      // scale prints is a number somebody could have chosen.
      min: 400, max: 2400,
      value_decimals: 0,
      value_custom_unit: 'ppm',
      tick_count: 21,
      // A needle rather than the rim marker: this is one of the two scales
      // where the reading people care about is a threshold, not a region, and
      // a needle points at a number. It also solves this template's own
      // problem - four digits and a three-letter unit is the widest reading
      // of the seven, and at the face's usual height its right end reaches
      // the label at 2000 - because a needle sends the reading down anyway.
      ...ANALOG_NEEDLE,
      gradient_preset: 'manual',
      threshold_unit: 'percent',
      // The stops are the usual indoor-air advice read as percent of the
      // range: 1000 ppm (30 %) is where a room starts to feel closed,
      // 1400 (50 %) where it is worth opening a window, 2000 (80 %) where
      // concentration measurably suffers.
      manual_stops: stops([0, '#4f7a28'], [30, '#ffaa00'], [50, '#b51a00'],
                          [80, '#61177c']),
    }),
  }),
  Object.freeze({
    id: 'pm25',
    label: 'PM2.5',
    hint: '0 to 100 µg/m³, air-quality bands',
    sample: 17,
    entry: Object.freeze({
      ...GAUGE_FACE,
      // A placeholder, and the first thing to overwrite: the label is where
      // a room or a phase goes once the element has an entity. It ships as
      // the quantity so that a gauge picked from the menu is already saying
      // something true about itself.
      gauge_label_text: 'PM2.5',
      ...HUNDRED,
      // The same reading as the humidity, for the same reason: the band is
      // the message.
      ...RIM_MARKER,
      value_decimals: 0,
      value_custom_unit: 'µg/m³',
      gradient_preset: 'manual',
      threshold_unit: 'percent',
      // The published air-quality breakpoints - 12, 35 and 55 µg/m³ - which on
      // a 0..100 scale are the percent figures themselves.
      manual_stops: stops([0, '#4e7a27'], [12, '#d58400'], [35, '#b51a00'],
                          [55, '#61177c'], [100, '#2e073e']),
    }),
  }),
  Object.freeze({
    id: 'voltage',
    label: 'Voltage',
    hint: '206 to 254 V, green in the middle',
    sample: 231.2,
    entry: Object.freeze({
      ...GAUGE_FACE,
      // A placeholder, and the first thing to overwrite: the label is where
      // a room or a phase goes once the element has an entity. It ships as
      // the quantity so that a gauge picked from the menu is already saying
      // something true about itself.
      gauge_label_text: 'Volt',
      // A round 48 V around a round 230, rather than the 207..253 the +/- 10 %
      // tolerance works out to: the tolerance is what the colours say, and a
      // scale whose every label ends in a 4 or a 9 says nothing at all.
      min: 206, max: 254,
      value_decimals: 1,
      value_custom_unit: 'V',
      tick_count: 13,
      // Seven labels, none of which starts with a 1 that could be dropped:
      // they need the room that a scale counting from zero does not, so these
      // are the one set drawn a little larger than the face's.
      tick_label_font_size: 2.8,
      // The one template that is a whole instrument rather than a dial: mains
      // voltage is the reading people read off a moving-coil meter, and it is
      // also the clearest place to show that the pointer can be one.
      ...ANALOG_NEEDLE,
      gradient_preset: 'manual',
      threshold_unit: 'percent',
      // Both edges are red, because on mains the interesting reading is how
      // near an edge the needle is, not how high it is. Green is 224..236 V.
      manual_stops: stops([0, '#ff3a30'], [20, '#ffcc02'], [38, '#32c759'],
                          [62, '#32c759'], [80, '#ffcc02'], [100, '#ff3a30']),
    }),
  }),
  Object.freeze({
    id: 'current',
    label: 'Current',
    hint: '0 to 16 A, one household circuit',
    sample: 6.4,
    entry: Object.freeze({
      ...GAUGE_FACE,
      // A placeholder, and the first thing to overwrite: the label is where
      // a room or a phase goes once the element has an entity. It ships as
      // the quantity so that a gauge picked from the menu is already saying
      // something true about itself.
      gauge_label_text: 'Amp',
      min: 0, max: 16,
      value_decimals: 1,
      value_custom_unit: 'A',
      tick_count: 17,
      // Nothing is special about any current between nothing and the fuse, so
      // this one is the plain three-colour ramp rather than a stop list.
      gradient_preset: 'linear',
      color1: '#4f7a28',
      color2: '#d58400',
      color3: '#ff4013',
    }),
  }),
  Object.freeze({
    id: 'power',
    label: 'Power',
    hint: '0 to 3500 W, whole-flat draw',
    sample: 1240,
    entry: Object.freeze({
      ...GAUGE_FACE,
      // A placeholder, and the first thing to overwrite: the label is where
      // a room or a phase goes once the element has an entity. It ships as
      // the quantity so that a gauge picked from the menu is already saying
      // something true about itself.
      gauge_label_text: 'Watt',
      ...WIDE_NUMBERS,
      min: 0, max: 3500,
      value_decimals: 0,
      value_custom_unit: 'W',
      tick_count: 15,
      gradient_preset: 'linear',
      color1: '#4f7a28',
      color2: '#d58400',
      color3: '#ff4013',
    }),
  }),
]);

/**
 * What every progressbar template agrees on.
 *
 * 0..100 % rather than a quantity, because a bar is the shape people reach for
 * when the number already *is* a fraction - battery, humidity, a disk. The
 * three templates differ in shape, which is the thing the submenu is being
 * asked to choose.
 */
const BAR_SCALE = Object.freeze({
  // A bar's own size inside its box, which is not the box: left alone it is a
  // 20px line, and a template dropped on the canvas should fill what it was
  // drawn as. Both are still in the editor, for the 20px line somebody wants.
  width: '100%',
  height: '100%',
  // Every size below is a percentage of the bar's shortest edge rather than a
  // pixel count, so a template looks the same in a box of any size - and so
  // the miniature in the menu is a true preview of the big one.
  base_unit: 'cqmin',
  min: 0,
  max: 100,
  value_unit: '%',
  value_decimals: 0,
  animation_duration: 2,
  use_gradient: true,
  gradient_as_solid: true,
  // Cool at the bottom, warm at the top, and stopping short of red: these
  // three differ in shape, not in what they measure, so the colour must not
  // claim that a full bar is a bad one. A battery, a tank and a disk are all
  // fuller the better. Red is one stop away in the editor for the person whose
  // number does mean trouble when it climbs.
  gradient_stops: Object.freeze([
    Object.freeze({ color: '#0061ff', pos: 0 }),
    Object.freeze({ color: '#00c7a0', pos: 50 }),
    Object.freeze({ color: '#8ac926', pos: 100 }),
  ]),
  show_value: true,
  value_bold: true,
  value_animated: true,
  value_color_adaptive_bar: true,
});

/** @type {readonly ElementTemplate[]} */
export const PROGRESSBAR_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'horizontal',
    label: 'Horizontal',
    hint: 'Linear, filling left to right, with a scale',
    sample: 62,
    entry: Object.freeze({
      ...BAR_SCALE,
      orientation: 'horizontal',
      border_radius: 8,
      value_position: 'center',
      value_font_size: '45',
      // Ticks but no numbers on them. A bar is a picture of a fraction, so the
      // scale only has to say where the fifths are - and the numbers, at the
      // size a bar this shape leaves for them, would land on top of the one
      // number that matters. Both switches are in the editor for the person
      // who has the room.
      show_ticks: true,
      tick_count: 11,
      tick_color_adaptive: true,
      tick_align: 'start',
      tick_length: '25%',
      tick_width: '1.5',
      show_subticks: true,
      subtick_count: 4,
      subtick_color_adaptive: true,
      subtick_length: '60%',
      subtick_width: '1',
      tick_hide_last: true,
    }),
  }),
  Object.freeze({
    id: 'vertical',
    label: 'Vertical',
    hint: 'Linear, filling bottom to top, with a value pill',
    sample: 62,
    // The only three templates that need this: a new element is a wide strip,
    // which is the horizontal bar's shape and nobody else's.
    aspect: 1 / 3,
    entry: Object.freeze({
      ...BAR_SCALE,
      orientation: 'vertical',
      border_radius: 15,
      // The bar is tall and narrow, so the reading rides on the fill line in a
      // pill instead of sitting inside the bar, where it would not fit across.
      show_value: false,
      show_indicator: true,
      indicator_color: '#ffffff',
      indicator_value: true,
      indicator_value_rotation: '0',
      indicator_value_adaptive_mode: 'pill',
      // Small, because this size is a share of the bar's *narrow* edge and the
      // pill has to fit across it.
      indicator_value_font_size: '15',
      indicator_value_decimals: 0,
      show_ticks: true,
      tick_count: 11,
      tick_color_adaptive: true,
      tick_align: 'start',
      tick_length: '35%',
      tick_width: '1',
      show_subticks: true,
      subtick_count: 4,
      subtick_color_adaptive: true,
      subtick_length: '60%',
      subtick_width: '1',
      tick_hide_last: true,
    }),
  }),
  Object.freeze({
    id: 'circular',
    label: 'Circular',
    hint: 'Segmented ring with the value in the middle',
    sample: 62,
    aspect: 1,
    entry: Object.freeze({
      ...BAR_SCALE,
      orientation: 'circular_donut',
      circular_stroke_width: 11,
      circular_scale: 90,
      circular_segmented: true,
      circular_segment_count: 60,
      circular_segment_thickness: 2,
      // A round backdrop under a round bar. The default square one shows at
      // the corners, where there is no ring to explain it.
      circular_border_radius: 50,
      circular_glow: true,
      circular_start_position: '0',
      bg_opacity: 19,
      value_font_size: '22',
      circular_value_offset_y: 0,
    }),
  }),
]);

/** One shared empty list, so a caller can compare identities if it wants to. */
const EMPTY = Object.freeze([]);

/**
 * Which list belongs to which element kind.
 *
 * A Map rather than an object literal, because the kind comes from a caller:
 * a plain object would answer `templatesFor('toString')` with a function, and
 * the menu would then try to render it.
 */
const BY_KIND = new Map([
  ['gauge', GAUGE_TEMPLATES],
  ['progressbar', PROGRESSBAR_TEMPLATES],
]);

/**
 * The templates offered for an element kind, empty for a kind that has none.
 *
 * @param {string} kind
 * @returns {readonly ElementTemplate[]}
 */
export function templatesFor(kind) {
  return BY_KIND.get(kind) || EMPTY;
}

/**
 * A fresh, detached copy of a template's entry, ready to be committed.
 *
 * A copy rather than the template itself: what comes back goes into somebody's
 * config, where the editor then edits it in place - and the catalogue above is
 * frozen, so handing it out directly would either throw or, through a nested
 * object the freeze does not reach, edit the template for every card after.
 *
 * @param {string} kind
 * @param {string} id
 * @returns {Record<string, any> | undefined} undefined for an unknown template
 */
export function templateEntry(kind, id) {
  const tpl = templatesFor(kind).find(t => t.id === id);
  return tpl ? structuredClone(tpl.entry) : undefined;
}

/**
 * The entity the previews read, and nothing else does.
 *
 * A name no real integration produces, because a preview that happened to
 * collide with a state in `hass` would show that state instead of the sample -
 * and would do it on one person's dashboard and nobody else's.
 */
export const PREVIEW_ENTITY = 'sensor.__supercard_template_preview__';

/**
 * A config and a `hass` that render a template's miniature.
 *
 * The sample value is the whole point: a preview at the minimum is a needle
 * lying flat against the left stop on all seven, which says nothing about
 * which one is the temperature. The animation is off, because a miniature that
 * is opened and closed in under a second would otherwise never be seen
 * anywhere but on its way.
 *
 * @param {string} kind
 * @param {string} id
 * @returns {{ config: Record<string, any>, hass: any } | undefined}
 */
export function previewFor(kind, id) {
  const tpl = templatesFor(kind).find(t => t.id === id);
  if (!tpl) return undefined;
  const config = {
    ...structuredClone(tpl.entry),
    entity: PREVIEW_ENTITY,
    animation_duration: 0,
  };
  return {
    config,
    hass: {
      states: {
        [PREVIEW_ENTITY]: {
          entity_id: PREVIEW_ENTITY,
          state: String(tpl.sample),
          attributes: {
            unit_of_measurement: config.value_custom_unit || config.value_unit || '',
          },
        },
      },
    },
  };
}
