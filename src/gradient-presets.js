/**
 * Ready-made colour ramps for a gauge's ring.
 *
 * A gradient is the part of a gauge that says what the number *means*: the
 * same 62 is a fine humidity, a poor power factor and a hot living room, and
 * the ring is where a reader is told which. Mixing that ramp by hand is four
 * or five colours and as many positions, and the same handful of ramps comes
 * back for every dashboard - so they are offered already mixed.
 *
 * The ramps are the ones the demo's showcase settled on, which is why they
 * are not simply green-to-red: a humidity is bad at both ends, air quality
 * runs off into purple where a red has nothing worse left to say, and a
 * throughput is *dark* when nothing is happening rather than green.
 *
 * Every position is a per cent, and a preset writes `threshold_unit:
 * 'percent'` with the stops, so a ramp survives the next change of min and
 * max. A preset is a starting point and not a mode: nothing records which one
 * was picked, every stop it writes stays as editable as one typed by hand,
 * and the next preset simply overwrites them.
 */

/** @typedef {{ pos: number, color: string }} Stop */

/**
 * @typedef {object} GradientPreset
 * @property {string} id     stable key, used by `gradientPresetPatch`
 * @property {string} label  what the menu calls it
 * @property {string} hint   what it is for - the reason to pick this one
 * @property {readonly Stop[]} stops
 */

const stops = (/** @type {[number, string][]} */ ...pairs) =>
  Object.freeze(pairs.map(([pos, color]) => Object.freeze({ pos, color })));

/** @type {readonly GradientPreset[]} */
export const GRADIENT_PRESETS = Object.freeze([
  Object.freeze({
    id: 'traffic',
    label: 'Traffic light',
    hint: 'More is worse: load, CPU, memory, tank pressure',
    stops: stops([0, '#4caf50'], [33.3, '#fdd835'], [66.7, '#fb8c00'], [100, '#f44336']),
  }),
  Object.freeze({
    id: 'traffic_up',
    label: 'Traffic light, reversed',
    hint: 'More is better: battery, signal, fill level, PV yield',
    stops: stops([0, '#f44336'], [25, '#fb8c00'], [50, '#fdd835'], [100, '#4caf50']),
  }),
  Object.freeze({
    id: 'band',
    label: 'Good in the middle',
    hint: 'Both ends are the fault: mains voltage, frequency, pH, pressure',
    stops: stops([0, '#ff3a30'], [20, '#ffcc02'], [38, '#32c759'],
                 [62, '#32c759'], [80, '#ffcc02'], [100, '#ff3a30']),
  }),
  Object.freeze({
    id: 'temperature',
    label: 'Cold to hot',
    hint: 'Temperatures: room, outdoor, flow - green sits where it should',
    stops: stops([0, '#2c1376'], [33, '#00a3d7'], [52, '#008f00'],
                 [75, '#fec700'], [100, '#e32400']),
  }),
  Object.freeze({
    id: 'humidity',
    label: 'Dry to damp',
    hint: 'Humidity and soil moisture: red is dry, blue is wet, green is right',
    stops: stops([0, '#b51a00'], [30, '#fec700'], [45, '#669c35'],
                 [60, '#669c35'], [75, '#00c7fc'], [100, '#0042aa']),
  }),
  Object.freeze({
    id: 'air',
    label: 'Fresh to stuffy',
    hint: 'CO₂ and VOC: past red it goes purple, because red is not the worst',
    stops: stops([0, '#4f7a28'], [30, '#ffaa00'], [50, '#b51a00'], [80, '#61177c']),
  }),
  Object.freeze({
    id: 'aqi',
    label: 'Air-quality bands',
    hint: 'PM2.5, PM10, AQI: the first band is wide, the bad ones are narrow',
    stops: stops([0, '#4e7a27'], [12, '#d58400'], [35, '#b51a00'],
                 [55, '#61177c'], [100, '#2e073e']),
  }),
  Object.freeze({
    id: 'throughput',
    label: 'Idle to busy',
    hint: 'Throughput and traffic: nothing happening is the dark end, not the good one',
    stops: stops([7, '#b51a00'], [20, '#ffaa00'], [47, '#4f7a28'], [70, '#96d35f']),
  }),
  Object.freeze({
    id: 'depth',
    label: 'One hue, light to deep',
    hint: 'Quantities with no good or bad: rainfall, price, brightness, water level',
    stops: stops([0, '#b3e5fc'], [50, '#03a9f4'], [100, '#01579b']),
  }),
]);

/** A preset by id, or null - a menu that has been left on its own first row. */
export function gradientPreset(/** @type {string} */ id) {
  return GRADIENT_PRESETS.find(p => p.id === id) || null;
}

/**
 * What a ramp writes onto the gauge it is dropped on.
 *
 * The stop list is rebuilt rather than handed over: the presets are frozen, and
 * the list it lands in is edited in place by the stop editor the moment
 * someone drags one of them.
 *
 * Unlike a tick preset there is nothing here to spare - a ramp *is* its
 * colours and their positions, so all of it is written, every time.
 *
 * @param {string} id
 * @param {'gauge'|'bar'} [kind] which element's keys the pick is written to
 */
export function gradientPresetPatch(/** @type {string} */ id,
                                    /** @type {string} */ kind = 'gauge') {
  const preset = gradientPreset(id);
  if (!preset) return null;
  const stops = preset.stops.map(s => ({ pos: s.pos, color: s.color }));
  // One catalogue, two sets of keys. A gauge colours a ring it may also
  // colour three other ways, so a ramp has to say which of the four it is;
  // a bar has one fill and a switch that says whether it is a ramp at all,
  // and picking a ramp is asking for that switch to be on.
  return kind === 'bar'
    ? { use_gradient: true, gradient_stops: stops }
    : { gradient_preset: 'manual', threshold_unit: 'percent', manual_stops: stops };
}

/**
 * A preset as one CSS gradient, for the swatch that stands for it.
 *
 * Left to right at the positions the ramp itself carries, so a ramp whose
 * first stop is at 7 % shows that dead band rather than a tidied-up version
 * of itself.
 */
export function gradientPresetCss(/** @type {GradientPreset} */ preset) {
  const list = (preset?.stops || []).map(s => s.color + ' ' + s.pos + '%').join(', ');
  return list ? 'linear-gradient(90deg, ' + list + ')' : 'none';
}
