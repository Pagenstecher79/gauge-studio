import { normalizeStops } from "./gradient-stops.js";

/**
 * Settings that saved cards still carry and nothing reads any more.
 *
 * A field can be taken out of an editor in one line; the value it already
 * wrote into people's dashboards is the part that outlives it. Leaving those
 * behind is not harmless - the next person to read the YAML has no way to
 * tell a setting that does nothing from one that does, and a key that looks
 * like a setting eventually gets "fixed" by someone wiring it back up to
 * something it never meant.
 *
 * So a dead key is listed here and removed on the next edit the card's editor
 * commits, rather than in a migration of its own: a card nobody opens is not
 * hurt by the key, and a card somebody edits is being rewritten anyway.
 */

/**
 * Dead keys by the slot list whose entries carry them.
 *
 * `position_mode`, `offset_x` and `offset_y` placed a progressbar inside the
 * cell it was drawn in, back when a bar's position was a property of the bar.
 * The canvas replaced that: an element's box *is* where it sits, and you drag
 * it. Nothing has read the three since - not the renderer, not the layout
 * module - and off the canvas they were already only shown, never used.
 *
 * `width` and `height` are deliberately not here: a bar can be a 20px line
 * inside a taller box, which its box cannot say.
 *
 * `debug_mask` outlined the element in green and the glass in dashed pink, so
 * you could see whether the two lined up. They do - measured, in fx-glass's
 * note at `showManualControls` - so the switch went. Its neighbour under the
 * same heading, `manual_override`, is deliberately not here: the sliders it
 * reveals are not only a correction, they are how a glass is made larger than
 * the element it sits on.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
/**
 * Dead keys on the slot itself.
 *
 * `hide_tips` hid every explanation in every editor at once, back when an
 * explanation was a line of prose under its control and a menu full of them
 * was hard to read. Prose is now a balloon on the label's own mark, which
 * costs no room until it is asked for, so there is nothing left to hide.
 *
 * @type {readonly string[]}
 */
export const DEAD_SLOT_KEYS = Object.freeze(['hide_tips']);

export const DEAD_ENTRY_KEYS = Object.freeze({
  progressbars: Object.freeze(['position_mode', 'offset_x', 'offset_y']),
  // A gauge's needle could be made to turn about a point other than the
  // gauge's centre. Nothing drew a better dial for it and everything that
  // measures a part against the middle had to carry the offset - the editor's
  // ring geometry in three places, the frames, the live needle - so the pivot
  // is the centre again and the two keys are left over.
  gauges: Object.freeze(['pivot_offset_x', 'pivot_offset_y']),
  fx_glass_patterns: Object.freeze(['debug_mask']),
});

/**
 * Glass patterns whose target the card will not paint.
 *
 * A dead key leaves an entry that still does something; a pattern aimed at one
 * of these does nothing at all, and an entry nobody can see is also an entry
 * nobody can find to delete - the editor stopped offering these targets, so
 * the list no longer shows them either.
 *
 * `elm_name` and `elm_state` are here because both are text nodes that shrink
 * to their glyphs: the box drawn for one on the canvas is 253x33, the node
 * inside it 29x14, and the glass followed the node. See fx-glass, which reads
 * this list to decide what to offer.
 *
 * @type {readonly string[]}
 */
export const DEAD_PATTERN_TARGETS = Object.freeze(['elm_name', 'elm_state']);

/**
 * Keys that are dead wherever they sit inside an entry of a list.
 *
 * `_isOpen` said whether a colour stop, a custom tick or a sector was
 * unfolded in the gauge editor - and because it lived on the stop, clicking a
 * triangle was a config change, saved through Home Assistant into somebody's
 * dashboard. The editor now keeps that where it belongs, in itself, so the
 * key is left over. It is listed here rather than beside the shallow ones
 * because a gauge carries it three levels down: on a stop, on a tick, on a
 * sector, and on a sector's own stops.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const DEAD_DEEP_KEYS = Object.freeze({
  gauges: Object.freeze(['_isOpen']),
});

/**
 * The value with `keys` gone from it and from everything inside it.
 *
 * Returns the value itself when nothing changed, so a caller can tell an
 * untouched entry from a rebuilt one by identity and leave the config alone.
 *
 * @param {any} value
 * @param {readonly string[]} keys
 * @returns {any}
 */
function withoutKeysDeep(value, keys) {
  if (Array.isArray(value)) {
    let touched = false;
    const next = value.map(item => {
      const stripped = withoutKeysDeep(item, keys);
      if (stripped !== item) touched = true;
      return stripped;
    });
    return touched ? next : value;
  }
  if (!value || typeof value !== 'object') return value;

  let touched = false;
  /** @type {Record<string, any>} */
  const next = {};
  for (const [k, v] of Object.entries(value)) {
    if (keys.includes(k)) { touched = true; continue; }
    const stripped = withoutKeysDeep(v, keys);
    if (stripped !== v) touched = true;
    next[k] = stripped;
  }
  return touched ? next : value;
}


/**
 * The bar texts whose weight was a checkbox, and the key that holds it now.
 *
 * `label_bold` and `value_bold` were normal or bold, nothing between. Both
 * have the gauge's three weights now, so a saved checkbox is turned into the
 * weight it drew and taken away. The renderer still reads the checkbox,
 * because a card nobody edits is never rewritten and has to keep drawing what
 * it drew; this is what stops the two from sitting in one config, each
 * looking like the setting.
 *
 * @type {Readonly<Record<string, string>>}
 */
const BOLD_TO_WEIGHT = Object.freeze({
  label_bold: 'label_font_weight',
  value_bold: 'value_font_weight',
});

/**
 * A bar's texts with their weight written the one way it is read.
 *
 * A text that already carries a weight keeps it: the checkbox cannot have
 * been what drew it.
 *
 * @param {any} slot
 * @returns {any[]|null} the rewritten bars, or null where nothing changed
 */
function withLabelWeights(slot) {
  const list = slot?.progressbars;
  if (!Array.isArray(list)) return null;
  let touched = false;
  const next = list.map(bar => {
    if (!bar || typeof bar !== 'object') return bar;
    const olds = Object.keys(BOLD_TO_WEIGHT).filter(k => k in bar);
    if (!olds.length) return bar;
    touched = true;
    const copy = { ...bar };
    for (const old of olds) {
      const key = BOLD_TO_WEIGHT[old];
      const bold = copy[old];
      delete copy[old];
      if (!(key in copy)) copy[key] = bold ? '700' : '400';
    }
    return copy;
  });
  return touched ? next : null;
}

/**
 * A gauge's scale label with its unit written the one way it is read.
 *
 * The scale label asked two questions where the value asks three: a unit was
 * shown or not, and a custom unit, where one was typed, always replaced the
 * entity's own. The value's switch for that - `replace_unit` - is now the
 * scale label's too, so one rule covers both texts. A card that carries a
 * custom unit was replacing with it, and says so here; a card that carries
 * none was not, and nothing is written, so the switch stays off.
 *
 * A gauge that already answers the question keeps its answer: the switch
 * cannot have been what put the custom unit there.
 *
 * @param {any} gauge
 * @returns {any} the rewritten gauge, or the gauge itself where nothing changed
 */
function withScaleLabelUnit(gauge) {
  if (!gauge || typeof gauge !== 'object') return gauge;
  if ('scale_label_replace_unit' in gauge) return gauge;
  const custom = gauge.scale_label_custom_unit;
  if (typeof custom !== 'string' || !custom) return gauge;
  return { ...gauge, scale_label_replace_unit: true };
}

/**
 * The slot with every gauge's scale label migrated, itself where none was.
 *
 * Both places a gauge can live: the `gauges` list, and - on a card written
 * before that list existed - the slot itself.
 *
 * @param {any} slot
 * @returns {any}
 */
function withScaleLabelUnits(slot) {
  let next = slot;
  const list = slot?.gauges;
  if (Array.isArray(list)) {
    const gauges = list.map(withScaleLabelUnit);
    if (gauges.some((g, i) => g !== list[i])) next = { ...next, gauges };
  }
  return withScaleLabelUnit(next);
}

/**
 * The keys whose value is a list of gradient stops.
 *
 * All three used to be written `{value, color}` by the gauge and
 * `{pos, color}` by the progressbar. One shape is read now
 * (`gradient-stops.js`), so the other one is rewritten on the next edit.
 *
 * @type {readonly string[]}
 */
const STOP_LIST_KEYS = Object.freeze(['manual_stops', 'bg_manual_stops', 'gradient_stops']);

/**
 * The value with every stop list in the one shape, itself when nothing changed.
 *
 * Two shapes are translated: a stop that carries `value` where the reader now
 * looks for `pos`, and a colour pattern's parallel `colors` / `stops` arrays,
 * which become one `gradient_stops` list. Both are lossless - a colour keeps
 * its position, and a colour nobody positioned keeps saying so with `null`.
 *
 * @param {any} value
 * @returns {any}
 */
function withStopShapes(value) {
  if (Array.isArray(value)) {
    let touched = false;
    const next = value.map(item => {
      const shaped = withStopShapes(item);
      if (shaped !== item) touched = true;
      return shaped;
    });
    return touched ? next : value;
  }
  if (!value || typeof value !== 'object') return value;

  let touched = false;
  /** @type {Record<string, any>} */
  const next = {};
  for (const [k, v] of Object.entries(value)) {
    if (STOP_LIST_KEYS.includes(k) && Array.isArray(v)) {
      const stops = v.map(st => {
        if (!st || typeof st !== 'object' || 'pos' in st || !('value' in st)) return st;
        const { value: pos, ...rest } = st;
        return { pos, ...rest };
      });
      if (stops.some((st, i) => st !== v[i])) { touched = true; next[k] = stops; continue; }
      next[k] = v;
      continue;
    }
    const shaped = withStopShapes(v);
    if (shaped !== v) touched = true;
    next[k] = shaped;
  }

  // A colour pattern only: `bg_type` is what says this object is one, and
  // nothing else in a slot carries a bare list of colours.
  if (Array.isArray(next.colors) && 'bg_type' in next && !Array.isArray(next.gradient_stops)) {
    const { colors, stops, ...rest } = next;
    return { ...rest, gradient_stops: normalizeStops({ colors, stops }, { fill: false }) };
  }

  return touched ? next : value;
}

/**
 * Entries a list still holds that name something the card cannot use.
 *
 * @type {Readonly<Record<string, (entry: any) => boolean>>}
 */
const DEAD_ENTRIES = Object.freeze({
  fx_glass_patterns: (entry) => DEAD_PATTERN_TARGETS.includes(entry?.target),
});

/**
 * The slot with every dead key and dead entry gone, or null when it had none.
 *
 * Null rather than an unchanged copy, so a caller can tell "nothing to do"
 * from "here is your config back" without comparing two objects - almost
 * every commit is the former.
 *
 * Pure: the slot it is given is not touched, and only the entries that
 * actually lose a key are rebuilt.
 *
 * @param {any} slot the card's `config.gauge_studio`
 * @returns {any | null}
 */
export function stripDeadConfig(slot) {
  if (!slot || typeof slot !== 'object') return null;

  /** @type {Record<string, any[]>} */
  const lists = {};
  for (const [key, dead] of Object.entries(DEAD_ENTRY_KEYS)) {
    const list = slot[key];
    if (!Array.isArray(list)) continue;
    let touched = false;
    const next = list.map(entry => {
      if (!entry || typeof entry !== 'object') return entry;
      const gone = dead.filter(k => k in entry);
      if (!gone.length) return entry;
      touched = true;
      const copy = { ...entry };
      for (const k of gone) delete copy[k];
      return copy;
    });
    if (touched) lists[key] = next;
  }

  for (const [key, dead] of Object.entries(DEAD_DEEP_KEYS)) {
    const list = lists[key] ?? slot[key];
    if (!Array.isArray(list)) continue;
    const next = withoutKeysDeep(list, dead);
    if (next !== list) lists[key] = next;
  }

  // After the keys, because a list the pass above rebuilt is the one to filter.
  for (const [key, isDead] of Object.entries(DEAD_ENTRIES)) {
    const list = lists[key] ?? slot[key];
    if (!Array.isArray(list)) continue;
    const next = list.filter(entry => !isDead(entry));
    if (next.length !== list.length) lists[key] = next;
  }

  const weighted = withLabelWeights(lists.progressbars ? { progressbars: lists.progressbars } : slot);
  if (weighted) lists.progressbars = weighted;

  let cleaned = Object.keys(lists).length ? { ...slot, ...lists } : slot;

  const deadSlotKeys = DEAD_SLOT_KEYS.filter(k => k in cleaned);
  if (deadSlotKeys.length) {
    cleaned = { ...cleaned };
    for (const k of deadSlotKeys) delete cleaned[k];
  }
  const shaped = withStopShapes(cleaned);
  if (shaped !== cleaned) cleaned = shaped;
  const united = withScaleLabelUnits(cleaned);
  if (united !== cleaned) cleaned = united;
  return cleaned === slot ? null : cleaned;
}

/**
 * The card's own config sub-object used to be `config.supercard`; since the
 * card was renamed it is `config.gauge_studio`.
 *
 * Dashboards written before the rename still carry the old key, so it is
 * translated here - at `setConfig`, the single point every config passes
 * through - rather than by teaching every reader both names. Everything
 * downstream then sees one key, and the first edit the editor commits writes
 * the migrated config back to storage.
 *
 * A config that already carries the new key is returned untouched, old key
 * and all: two slots mean a hand-edited YAML, and picking one of them would
 * silently throw the other away.
 *
 * Pure: the config it is given is not modified.
 *
 * @param {any} config the Lovelace card config
 * @returns {any}
 */
export function migrateSlotKey(config) {
  if (!config || typeof config !== 'object') return config;
  if (!('supercard' in config) || 'gauge_studio' in config) return config;
  const { supercard, ...rest } = config;
  return { ...rest, gauge_studio: supercard };
}

/**
 * The lists whose entries name the thing they act on, and are nothing without
 * it: the paint, the glass and the push.
 *
 * All three say `target`. The paint and the glass write an element's id as
 * `elm_<id>`; the push writes it bare, because its own list never held
 * anything but elements. Both spellings are the same element, so both go.
 *
 * @type {readonly string[]}
 */
export const TARGET_LISTS = Object.freeze(['color_patterns', 'fx_glass_patterns', 'interactions']);

/**
 * The lists that lose an entry acting on one of `ids`, as a patch to merge,
 * or null when there was none.
 *
 * For a surface, and only for a surface. Everything else a canvas holds keeps
 * its own config somewhere else - a gauge taken off the canvas is still in
 * `gauges`, and its paint is still the paint of that gauge - but a surface
 * *is* its box: there is no list it lives in and nothing about it survives
 * the box being deleted except, until now, what was painted on it. So the
 * next `surface_0` drawn on the canvas came up wearing the last one's
 * colours, its glass and its push, which is not a new surface at all.
 *
 * Pure: the slot it is given is not touched, and only the lists that actually
 * lose an entry are rebuilt.
 *
 * @param {any} slot the card's `config.gauge_studio`
 * @param {readonly string[]} ids element ids, as the canvas writes them
 * @returns {Record<string, any[]> | null}
 */
export function withoutElementConfig(slot, ids) {
  if (!slot || typeof slot !== 'object' || !ids?.length) return null;
  const gone = new Set(ids.flatMap(id => [id, 'elm_' + id]));
  /** @type {Record<string, any[]>} */
  const lists = {};
  for (const key of TARGET_LISTS) {
    const list = slot[key];
    if (!Array.isArray(list)) continue;
    const next = list.filter(entry => !gone.has(entry?.target));
    if (next.length !== list.length) lists[key] = next;
  }
  return Object.keys(lists).length ? lists : null;
}
