import { LitElement, html, css, unsafeCSS } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";
import { reportedRows, isHeightPinned, canvasFromGrid, defaultShapeRows } from "./canvas-model.js";
import { migrateSlotKey } from "./config-cleanup.js";
import { rowsAsCanvas } from "./rows-compat.js";

// --- CENTRAL LAYER DICTIONARY ---
export const SC_LAYERS = {
  BG_NATIVE: 0,
  BG_STATIC: 100,
  BG_ANIMATED: 200,
  LAYOUT_GRID: 500,
  ELM_BASE: 700,
  ELM_STATIC: 800,
  ELM_DYNAMIC: 900,
  ELM_FLOAT: 1000,
  FX_FILTERS: 1300,
  FX_GLASS: 1400,
  INT_BASE: 1700,
  INT_EVENTS: 1800
};

window.SupercardModules = window.SupercardModules || {};

// --- SHARED UTILS (number/color helpers used by multiple modules) ---
// The editor's own half of this object - every control, both stylesheets -
// is in `supercard-01-core-editor.js` and is assigned onto the same object
// when the editor bundle loads. A dashboard that only draws the card never
// loads it.
window.SupercardUtils = window.SupercardUtils || {};
Object.assign(window.SupercardUtils, (() => {
  /** @type {(v: any, d: number) => number} */
  const safeFloat = (v, d) => { const f = parseFloat(v); return isNaN(f) ? d : f; };

  /** @type {(hex: string) => [number, number, number] | null} */
  const hexToRgb = hex => {
    if (!hex || typeof hex !== 'string') return null;
    const h = hex.replace('#', '');
    if (h.length === 3) return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
    if (h.length === 6) return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
    return null;
  };

  /** @type {(r: number, g: number, b: number) => string} */
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

  /**
   * Look up a `var(--x)` against the document root. Anything else is handed
   * back untouched. Split out from toRgb because a var() that stays a var()
   * keeps following the theme, so only callers that need a concrete number
   * right now (contrast maths, gradient sampling) should resolve one.
   * @type {(v: string) => string}
   */
  const resolveVar = v => {
    if (typeof v !== 'string' || !v.startsWith('var(')) return v;
    const m = v.match(/var\(([^),]+)/);
    return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1].trim()).trim() : v;
  };

  /**
   * The one colour reader. Accepts everything the editors can produce - an
   * [r,g,b] array, #rgb / #rrggbb, or an rgb()/rgba() string - and returns
   * [r,g,b], or null when the value is not a colour we can read.
   * @param {any} value
   * @param {{ resolveVars?: boolean }} [opts]
   * @returns {[number, number, number] | null}
   */
  function toRgb(value, opts = {}) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return null;
    let v = value.trim();
    if (opts.resolveVars) v = resolveVar(v);
    if (v.startsWith('#')) return hexToRgb(v);
    if (v.startsWith('rgb')) {
      const m = v.match(/\d+/g);
      if (m && m.length >= 3) return [parseInt(m[0]), parseInt(m[1]), parseInt(m[2])];
    }
    return null;
  }

  /**
   * A copy of `list` with one field of one entry replaced. The editors are
   * built on immutable commits - clone, change, hand the new list to the
   * commit function - and writing that out by hand at every input meant a
   * hundred chances to forget the clone and mutate the live config instead.
   * @template T
   * @param {T[]} list
   * @param {number} idx
   * @param {string} key
   * @param {any} value
   * @returns {T[]}
   */
  function withPatch(list, idx, key, value) {
    const next = structuredClone(list);
    next[idx][key] = value;
    return next;
  }

  /**
   * Whether a gauge sizes itself from the box it is in rather than from a
   * pixel figure of its own.
   *
   * On a canvas the answer is always yes: the element *is* the size control
   * there, and a second one in the gauge editor could only contradict it. Off
   * the canvas it is the gauge's own setting.
   *
   * Both the renderer and fx-glass have to reach the same answer - fx-glass
   * picks `cqmin` or `px` units from it - so it is decided once, here.
   *
   * The string "true" counts, which a hand-written config can carry where the
   * editor's checkbox would have written a boolean. Both editor controls have
   * always read it that way - the checkbox shows such a card as switched on,
   * and the pixel field hides itself - so only the renderer disagreed, and a
   * card in that state offered no size control while still drawing at
   * `gauge_size_px`. Everything now goes through this one test.
   *
   * @param {any} gaugeConfig one entry of `gauges`
   * @param {boolean} [onCanvas] whether the card renders from a canvas
   * @returns {boolean}
   */
  function gaugeIsResponsive(gaugeConfig, onCanvas) {
    if (onCanvas) return true;
    const v = gaugeConfig?.gauge_size_responsive;
    return v === true || v === 'true';
  }

  // The card's own measured size, published by its resize observer. Each entry
  // is a length, so `calc()` can take a percentage of it.
  const CARD_SIDES = {
    width:  'var(--sc-avail-w, 100px)',
    height: 'var(--sc-avail-h, 100px)',
    min:    'var(--sc-avail-min, 100px)',
    max:    'max(var(--sc-avail-w, 100px), var(--sc-avail-h, 100px))',
  };

  /**
   * Whether the card draws from a canvas.
   *
   * A `canvas` key alone is not enough: `layout_active` gates the renderer, so
   * a card with the layout switched off draws the plain content row whatever
   * canvas it is still carrying - the same reading showsElement takes. What
   * the card actually draws is what decides its shape and which of the two
   * sets of dimension controls the editor offers.
   *
   * @param {any} slot
   * @returns {boolean}
   */
  function onCanvas(slot) {
    return !!(slot?.layout_active && slot?.canvas);
  }

  /**
   * Whether the card draws itself as a pill.
   *
   * A canvas card never does. Its elements are placed in a rectangle and the
   * shape control is not offered there, so honouring a `pill` left over from
   * the card's rows days would give it a shape nothing in the editor could
   * change. The renderer, a full-card colour or glass pattern and a bar's edge
   * indent all have to reach the same answer, so it is decided once, here.
   *
   * @param {any} slot
   * @returns {boolean}
   */
  function cardIsPill(slot) {
    return !onCanvas(slot) && slot?.layout_shape !== 'rectangle';
  }

  /**
   * The card's corner radius as a CSS length, or null when the card has not
   * set one - what to draw instead differs per caller, so that stays theirs.
   *
   * A percentage needs a side to be a percentage of, and `border-radius: 10%`
   * is not it: it resolves horizontally against the width and vertically
   * against the height, which draws an elliptical corner rather than a round
   * one. So the reference side is named and read from the card's measured
   * size, which is why those lengths are published on the host - a custom
   * property inherits down, and the container's style attribute belongs to lit.
   *
   * @param {any} slot
   * @returns {string | null}
   */
  function cardRadius(slot) {
    if (cardIsPill(slot)) return '999px';
    // A canvas card that still says `pill` and has never had a unit written to
    // it was a pill before the canvas took the shape control away: half the
    // shorter side is that same stadium, so the corner such a card has on
    // someone's dashboard right now is kept rather than squared off by an
    // update they did not ask for. The unit key is what dates the card - it
    // did not exist before this - and setting a radius in the editor retires
    // `layout_shape` besides, because that is the answer to the shape question
    // the canvas no longer asks.
    if (onCanvas(slot) && slot?.layout_shape !== 'rectangle'
        && slot?.border_radius_unit === undefined) {
      return `calc(${CARD_SIDES.min} * 50 / 100)`;
    }
    const v = slot?.border_radius;
    if (v === undefined || v === null || v === '') return null;
    // A radius written before the unit existed is a pixel one, so an absent
    // unit has to go on meaning px: reading it as a percentage would resize
    // the corners of every card that has ever set one.
    if (slot.border_radius_unit !== '%') return `${v}px`;
    return `calc(${CARD_SIDES[slot.border_radius_ref] || CARD_SIDES.min} * ${safeFloat(v, 0)} / 100)`;
  }

  /**
   * Resolve a config entry's entity/attribute through the global alias list.
   * Every module that can be pointed at a global entity needs this, so it
   * lives here rather than being re-typed per module. `match` is the alias
   * record itself for callers that also want its name.
   *
   * @param {{ id: string, entity: string, attribute: string, alias?: string }[]} list
   * @param {any} cfg
   * @param {string} [entityKey]
   * @param {string} [attrKey]
   */
  function resolveAlias(list, cfg, entityKey = 'entity', attrKey = 'attribute') {
    const id = cfg?.global_id;
    if (id && id !== 'manual') {
      const found = (list || []).find(g => g.id === id);
      if (found) return { entity: found.entity, attribute: found.attribute, alias: found.alias || '', match: found };
    }
    return { entity: cfg?.[entityKey], attribute: cfg?.[attrKey], alias: '', match: null };
  }

  /**
   * @param {{ pos: number, color: string }[]} stops
   * @param {number} pct
   * @returns {string}
   */
  function sampleGradient(stops, pct) {
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    const pos = pct * 100;
    if (pos <= sorted[0].pos) return sorted[0].color;
    if (pos >= sorted[sorted.length - 1].pos) return sorted[sorted.length - 1].color;
    for (let i = 0; i < sorted.length - 1; i++) {
      const lo = sorted[i], hi = sorted[i + 1];
      if (pos >= lo.pos && pos <= hi.pos) {
        const t = (pos - lo.pos) / (hi.pos - lo.pos);
        const [r1, g1, b1] = hexToRgb(lo.color) || [128, 128, 128];
        const [r2, g2, b2] = hexToRgb(hi.color) || [128, 128, 128];
        return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
      }
    }
    return sorted[sorted.length - 1].color;
  }

  /**
   * The gauges and progress bars a slot contains, as {id, label} records.
   * The target lists differ per editor - flat here, grouped in layout, with
   * extra per-label sub-targets there - but *which* gauges and bars exist is
   * one question with one answer, so it is answered once.
   * @param {any} slot
   */
  function listElements(slot) {
    const gaugeCount = Array.isArray(slot.gauges) ? slot.gauges.length : (slot.gauge_active ? 1 : 0);
    const gauges = Array.from({ length: gaugeCount }, (_, i) => ({ id: `gauge_${i}`, label: `Gauge ${i + 1}` }));
    const bars = (Array.isArray(slot.progressbars) ? slot.progressbars : [])
      .map((pb, i) => ({ id: `progressbar_${i}`, label: pb?.label_text || `Progressbar ${i + 1}` }));
    return { gauges, bars };
  }

  /**
   * What to call an element in front of a person, or '' when the card knows
   * nothing better than its id.
   *
   * `gauge_0` says where an element is in the config, which is the right name
   * for a glass target and the wrong one for a list of what is on the canvas:
   * three gauges on a card are three rooms, and the id says which of them is
   * which only to whoever put them there.
   *
   * The order is the same one every panel in this card already uses to title
   * an entry - the name the user typed, then the alias they gave the entity,
   * then Home Assistant's friendly name, then the entity id without its
   * domain. Nothing here invents a name: an element with no entity and no
   * label keeps its id, and the caller decides what to draw instead.
   *
   * @param {any} slot the card's `config.gauge_studio`
   * @param {any} hass
   * @param {string} id an element id, as the canvas and the target lists use it
   * @param {string} [cardEntity] the card's own entity, which icon/name/state show
   * @returns {string}
   */
  function elementLabel(slot, hass, id, cardEntity) {
    const states = hass?.states || {};
    const ofEntity = (entity) => {
      if (!entity || typeof entity !== 'string') return '';
      return states[entity]?.attributes?.friendly_name || entity.split('.')[1] || entity;
    };
    // An entry's own text first, then whatever the entity it points at is
    // called - through the alias list, because a card that names its entities
    // there has said what it wants them called.
    const ofEntry = (entry, textKey) => {
      const own = typeof entry?.[textKey] === 'string' ? entry[textKey].trim() : '';
      if (own) return own;
      const { entity, alias } = resolveAlias(slot?.global_entities, entry);
      return alias || ofEntity(entity);
    };

    const at = (list, i) => (Array.isArray(list) ? list[i] : null);
    const idx = (prefix) => parseInt(id.slice(prefix.length), 10);

    if (id.startsWith('gauge_')) {
      // Without a `gauges` array the card is the one gauge it draws, so its
      // settings are the slot itself - the shape listElements counts.
      const entry = Array.isArray(slot?.gauges) ? at(slot.gauges, idx('gauge_')) : slot;
      return entry ? ofEntry(entry, 'gauge_label_text') : '';
    }
    if (id.startsWith('progressbar_')) {
      const entry = at(slot?.progressbars, idx('progressbar_'));
      return entry ? ofEntry(entry, 'label_text') : '';
    }
    if (id.startsWith('label_')) {
      const entry = at(slot?.labels_list, idx('label_'));
      return entry ? ofEntry(entry, 'label_text') : '';
    }
    // The three that draw the card's own entity rather than one of their own.
    if (id === 'icon' || id === 'name' || id === 'state') return ofEntity(cardEntity);
    return '';
  }

  /**
   * The selector for the box the layout renderer draws an element in.
   *
   * Every element box the renderer draws gets a shadow part named after its
   * id - a surface included, which is the only thing a surface *is*. That box
   * is the region a layout cell used to be, so it is what colour and fx-glass
   * paint. Rows name their cells as parts too, and their item boxes by this
   * same name, because a label is drawn in the renderer's shadow on either
   * model and card-level CSS has no other way in.
   * @param {string} id
   * @returns {string}
   */
  function elementPartSelector(id) {
    return `sc-layout-renderer::part(element-${id})`;
  }

  /**
   * Whether the card actually shows the element with this id.
   *
   * On the canvas model the canvas is the whole answer. `onAfterRender` moves
   * exactly the elements the canvas names into the renderer, so one that is
   * not on it is never moved - it stays in the card's own flow and draws at
   * its natural size, which for a gauge is most of the card. Removing an
   * element from the canvas is what the editor's remove button does, so this
   * is the difference between "removed" and "still in the list but unplaced".
   *
   * Every other model draws everything the lists contain, and a card whose
   * layout is switched off draws them in the plain content row - so both
   * answer yes regardless of what a leftover `canvas` key says.
   * @param {any} config
   * @param {string} id
   * @returns {boolean}
   */
  function showsElement(config, id) {
    const els = config?.canvas?.elements;
    if (!config?.layout_active || !Array.isArray(els)) return true;
    return els.some(el => el?.id === id);
  }

  /**
   * Flat {id: label} map of elements available for targeting (color patterns,
   * fx-glass, interactions). The layout editor builds its own grouped list
   * from listElements instead, because it also offers per-label sub-targets.
   * @param {any} slot
   * @returns {Record<string, string>}
   */
  function getAvailableElements(slot) {
    const elements = { 'empty': 'Empty', 'icon': 'Icon', 'name': 'Entity name', 'state': 'State (value)' };
    const { gauges, bars } = listElements(slot);
    for (const g of gauges) elements[g.id] = g.label;
    for (const b of bars) elements[b.id] = b.label;
    if (Array.isArray(slot.labels_list)) {
      slot.labels_list.forEach((l, idx) => {
        elements[`label_${idx}`] = `Label: ${l.label_text || l.entity || idx + 1}`;
      });
    }
    // A surface is in none of the lists above: it has no entity and no config
    // of its own, and exists only as a box on the canvas. Being painted is the
    // whole reason it exists, so it has to be offerable as a target - without
    // this, migration created surfaces that no editor could then address.
    if (Array.isArray(slot?.canvas?.elements)) {
      for (const el of slot.canvas.elements) {
        if (!el?.surface || typeof el.id !== 'string') continue;
        const n = /^surface_(\d+)$/.exec(el.id);
        elements[el.id] = n ? `Surface ${Number(n[1]) + 1}` : 'Surface';
      }
    }
    return elements;
  }
  /**
   * Every part a renderer marks, and so every part that can be in hand.
   * They all say it the same way, because they are all the same thing to the
   * eye: the mark you are working on, blinking.
   */
  const HL_PARTS = ['gauge_ring', 'frame_ring', 'ticks', 'sub_ticks',
                    'pointer', 'pointer_center', 'pill', 'indicator_line',
                    'tick_labels', 'gauge_label', 'value', 'scale_label',
                    'multiplier', 'label'];

  /**
   * How each part is painted, and so which property the highlight ink has to
   * take over. A pulse says something is in hand; the ink says which. A tick
   * two pixels wide among twenty of its kind is not found by dimming it by
   * half - it is found by it being the orange one.
   *
   * The lists are by drawing technique, not by kind: a gauge draws its ticks
   * as SVG lines and the bar draws its as divs, and both are `ticks` here.
   *
   * `pill` and `pointer` are in neither list. The pill is a filled surface
   * and the value stands on it, so inking it would hide the thing being set;
   * the pointer carries no mark of its own. Both still breathe.
   */
  const INK_STROKE = ['gauge_ring', 'frame_ring', 'ticks', 'sub_ticks'];
  const INK_FILL = ['tick_labels', 'gauge_label', 'value', 'scale_label',
                    'multiplier', 'pointer_center'];
  const INK_TEXT = ['label', 'tick_labels'];
  const INK_PAINT = ['ticks', 'sub_ticks'];
  // `pointer_center` is in both this list and INK_FILL, because it has two
  // drawings: a <circle> while it is plain, and a <div> once it is glass,
  // which `backdrop-filter` makes it have to be. Neither property reaches
  // the other's drawing, so one entry each covers both.
  const INK_BG = ['indicator_line', 'pointer_center'];

  /**
   * Which part of its drawing an element is showing as the one in hand.
   *
   * The canvas puts the part's name on the renderer as data-sc-hl, and the
   * renderer answers for it here, because only the renderer's own stylesheet
   * can reach inside its shadow root. The marks are the ones the editor
   * already presses by - data-sc-part - so nothing new has to be drawn or
   * named for a part to be able to say so.
   *
   * The part blinks, and nothing is drawn around it: no frame, no halo. A
   * frame is a second shape to read and it lands where the drawing has no
   * room, and a halo changes what a colour looks like, which is usually the
   * very setting the hand is on. Fading the mark itself leaves both alone -
   * it keeps its colour, its weight and its place, and the eye still goes
   * straight to the one thing that is moving.
   *
   * It is a breath, not a flash: 47 per cent of its strength given up and
   * taken back over 2.3 seconds. A mark that disappears is a mark you cannot judge
   * while it is in hand, and anything quicker or deeper is read as an error
   * rather than as a pointer. What
   * makes one mark stand out is that it is the only thing moving at all, not
   * how far it moves. The pair here was chosen at the canvas, against real
   * drawings, with a slider on both numbers; that slider has been taken back
   * out, so change them here and nowhere else.
   *
   * A few of these marks carry an opacity of their own - a gauge's frame
   * ring, the bar's circular label - and an animation on the property would
   * overrule it and make the mark jump to full strength the moment it was
   * taken in hand. So the keyframes multiply instead of setting: whoever
   * draws a mark with an opacity of its own puts the same number in
   * --sc-hl-own, and the mark breathes from where it already was.
   *
   * This was a filter first - opacity() multiplies by itself, with nothing
   * to declare. Safari computes such an animation and then does not paint
   * it: CSS filter reaches the outermost <svg> there and not the <line> and
   * <text> inside it, so the ticks sat still while the values changed. The
   * opacity property is painted on an SVG child everywhere.
   *
   * Nothing is highlighted while data-sc-hl is absent, which is also how the
   * canvas stands out of the way for a few seconds after a colour is changed.
   */
  const partHighlight = (() => {
    // `~=` and not `=`: a mark can belong to two parts at once. The bar's
    // indicator line is drawn under the pill and is switched on with it, so
    // the pill's chip sets both - but the line has settings of its own, and
    // while one of those is being held it is the line alone that should
    // answer. So the line carries `pill indicator_line`, and a token match
    // lets either name find it.
    const mark = (/** @type {string} */ p) =>
      `:host([data-sc-hl="${p}"]) [data-sc-part~="${p}"]`;
    const group = (/** @type {string[]} */ ps, /** @type {string} */ suffix = '') =>
      unsafeCSS(ps.map(p => mark(p) + suffix).join(',\n      '));
    const all = unsafeCSS(HL_PARTS.map(mark).join(',\n'));
    return css`
      ${all} {
        animation: sc-hl-blink 2.3s ease-in-out infinite;
      }
      /* The ink the part in hand is lent. A default here and not only on the
         host, so a renderer that is told the part but not the colour still
         draws something rather than losing the property altogether - an
         unresolvable var() takes a stroke or a fill with it. The canvas
         overrules it on the host, where an inline style outranks :host. */
      :host { --sc-hl-ink: #ff9100; }
      ${group(INK_STROKE)} { stroke: var(--sc-hl-ink) !important; }
      ${group(INK_FILL)} { fill: var(--sc-hl-ink) !important; }
      /* The bar draws the same three parts in HTML: a tick is a div with a
         background and a tick label a span with a colour, both written
         inline. The properties do not overlap with the SVG ones above, so
         one rule each covers both drawings - a <line> has no children to
         reach, and a div ignores a stroke. */
      ${group(INK_TEXT)}, ${group(INK_TEXT, ' *')} { color: var(--sc-hl-ink) !important; }
      ${group(INK_PAINT, ' > *')} { background: var(--sc-hl-ink) !important; }
      /* A mark that is nothing but its own fill - the bar's indicator line is
         a div with a background and no children to reach. */
      ${group(INK_BG)} { background: var(--sc-hl-ink) !important; }
      /* A gradient ring is painted by a masked picture, and the arc that
         data-sc-part names is drawn in nothing at all so a press can find
         it. Inking that arc would cover the gradient with a solid band, so
         here the ring stays its own picture and only breathes. */
      :host([data-sc-hl="gauge_ring"]) .g-ring [data-sc-part="gauge_ring"] {
        stroke: transparent !important;
      }
      /* A gradient ring is a picture behind a mask, and the arc that names it
         for the editor is drawn in nothing at all - fading that would fade
         nothing. The group holds both, so the ring blinks as the group. */
      :host([data-sc-hl="gauge_ring"]) .g-ring {
        animation: sc-hl-blink 2.3s ease-in-out infinite;
      }
      @keyframes sc-hl-blink {
        0%, 100% { opacity: calc(var(--sc-hl-own, 1) * 1); }
        50%      { opacity: calc(var(--sc-hl-own, 1) * 0.53); }
      }
    `;
  })();
// Entity ids referenced anywhere in a card config. Used by shouldUpdate to tell
// a relevant hass update apart from the ones HA fires for every other entity.
const SC_ENTITY_ID_RE = /^[a-z_]+\.[a-z0-9_]+$/;
function collectEntityIds(node, out = new Set(), depth = 0) {
  if (node == null || depth > 8) return out;
  if (typeof node === 'string') {
    if (SC_ENTITY_ID_RE.test(node)) out.add(node);
  } else if (Array.isArray(node)) {
    for (const v of node) collectEntityIds(v, out, depth + 1);
  } else if (typeof node === 'object') {
    for (const v of Object.values(node)) collectEntityIds(v, out, depth + 1);
  }
  return out;
}


/**
 * Whether a new `hass` can change what a component that reads `ids` draws.
 *
 * Home Assistant replaces the whole `hass` object on every state change in
 * the instance, so without this a card of sixteen gauges re-renders all
 * sixteen because one of them ticked - and on a dashboard of two dozen such
 * cards that is most of the work the page does.
 *
 * Themes, locale and language are in here because a formatter reads them and
 * nothing else would notice they changed.
 *
 * @param {any} oldHass
 * @param {any} newHass
 * @param {Iterable<string>} ids
 * @returns {boolean}
 */
function hassInputsChanged(oldHass, newHass, ids) {
  if (!oldHass || !newHass) return true;
  if (oldHass.themes !== newHass.themes
    || oldHass.locale !== newHass.locale
    || oldHass.language !== newHass.language) return true;
  for (const id of ids) {
    if (oldHass.states[id] !== newHass.states[id]) return true;
  }
  return false;
}

  return /** @type {SupercardUtilsRuntime} */ ({
    safeFloat, hexToRgb, rgbToHex, toRgb, resolveVar, sampleGradient,
    getAvailableElements, listElements, elementLabel, showsElement, elementPartSelector,
    resolveAlias, withPatch, gaugeIsResponsive, onCanvas, cardIsPill, cardRadius,
    collectEntityIds, hassInputsChanged, partHighlight
  });
})());

const SC_UTILS = window.SupercardUtils;

class SupercardCore extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object }
    };
  }

  static getLayoutOptions() {
    return { grid_columns: 3, grid_rows: 3, grid_min_columns: 1, grid_min_rows: 1 };
  }

  // What Home Assistant's sections grid asks the card for. The config's own
  // `grid_options` is spread over this by hui-card, so everything here is a
  // default the layout tab may override - which is the whole point: it is the
  // same value in both places, and the canvas editor writes the same key.
  getGridOptions() {
    const slot = this.config?.gauge_studio || {};
    return {
      columns: slot.grid_columns || 3,
      rows: reportedRows(slot),
      min_columns: 1,
      min_rows: 1
    };
  }

  setConfig(config) {
    // FIX: No longer requires an entity!
    this.config = migrateSlotKey(config);
  }

  // HA replaces the whole hass object on every state change in the instance, so
  // without this the card would re-render - and re-run every module - for entities
  // it never reads. Cached per config object; a new config recollects.
  _relevantEntityIds() {
    if (this._entityIdSource !== this.config) {
      this._entityIdSource = this.config;
      this._entityIds = SC_UTILS.collectEntityIds(this.config);
    }
    return this._entityIds;
  }

  shouldUpdate(changedProps) {
    if (!this.hasUpdated) return true;
    if (changedProps.size > 1 || !changedProps.has('hass')) return true;
    return SC_UTILS.hassInputsChanged(changedProps.get('hass'), this.hass, this._relevantEntityIds());
  }

  getCardSize() { return 3; }
  /**
   * The editor, and the two thirds of this card that only the editor needs.
   *
   * It is a file of its own, fetched the first time someone opens the card's
   * settings, so a dashboard that only draws cards never sees it. Home
   * Assistant awaits this call already, and the import is cached afterwards.
   *
   * The name is written in at build time - it carries a content hash, so the
   * browser is never handed a stale editor - and the URL is relative to this
   * file, which is wherever the Lovelace resource points: `/hacsfiles/...`,
   * `/local/...`, either way the editor sits beside it. See
   * `docs/editor-split.md`.
   */
  static async getConfigElement() {
    await import(/* @vite-ignore */ './' + __SC_EDITOR_CHUNK__);
    return document.createElement('supercard-modular-editor');
  }
  /**
   * A new card starts on the canvas, and starts empty.
   *
   * Reaching it used to take four steps in the model the canvas replaces -
   * switch the layout section on, add a row, add a cell, assign content, then
   * convert - none of which a card added a moment ago has any reason to know
   * about.
   *
   * Only the shape is taken from the card's grid box; nothing is placed on it.
   * The icon, the name and the state are what the card draws by default, but a
   * default is not a decision: placed for you they are three boxes to move or
   * delete before the canvas is yours, and the editor already offers all three
   * under "Add element" for as long as they are not on it.
   *
   * No `layout_shape`: the shape control belongs to the rows model, and a
   * canvas card is a rectangle with a corner radius. That radius is a
   * percentage of the shorter side here, so it follows the card when Home
   * Assistant's layout gives it a different box.
   *
   * The full width of the section, and the row count a card that wide starts
   * at - `defaultShapeRows`, which is as near a square as whole rows allow at
   * any width. Square because the first thing put on an empty canvas is a
   * gauge or a ring, and a strip is the one shape that cannot hold one.
   * `full` rather than the twelve that equals it today, so a section made
   * wider later takes the card with it.
   *
   * Home Assistant's own default box is three columns by three rows, and empty
   * that is a tall blank rectangle in a quarter-width column.
   *
   * No `rows` in `grid_options`. The row count describes the canvas' *shape*,
   * not the card's height: a number there would pin the height in pixels while
   * the width goes on following the viewport, and the canvas would sit in the
   * middle of it with bands down the sides. Reporting `rows: "auto"` instead
   * makes the ratio the height, so the card scales and nothing letterboxes.
   */
  static getStubConfig() {
    const slot = { layout_active: true, border_radius: 12,
                   border_radius_unit: '%', border_radius_ref: 'min' };
    const grid_options = { columns: 'full' };
    const rows = defaultShapeRows('full');
    const shape = canvasFromGrid({ grid_options: { ...grid_options, rows } }, slot);
    return { entity: '', grid_options, gauge_studio: { ...slot,
      // A grid in per cent, because the canvas is reshaped whenever the card's
      // columns change and a grid in units would not survive it.
      canvas: { w: shape.w, h: shape.h, grid: 2.5, grid_unit: 'pct', elements: [] } } };
  }

  static get styles() {
    return css`
      :host {
        display: grid !important;
        width: 100% !important;
        height: var(--sc-explicit-height, 100%) !important;
        grid-template-columns: 100% !important;
        grid-template-rows: 100% !important;
        box-sizing: border-box !important;
      }

      /*
       * The card's whole z-index scale lives inside this box.
       *
       * SC_LAYERS counts to 1800, and the colour and glass modules pin the
       * content container at 500 so the backgrounds they inject can sit under
       * it. None of that is meant to be seen from outside - but ha-card is
       * only position: relative, which is no stacking context, so every one
       * of those numbers was being read against whatever context happened to
       * be above the card. Home Assistant's own header is a fixed box at
       * z-index 4, so a card that says 500 scrolls over the navigation and
       * takes the dashboard's tabs with it.
       *
       * isolation: isolate makes this the context they are all measured in.
       * The card itself then stands where an ordinary card stands, and the
       * header is above it again.
       */
      ha-card {
        isolation: isolate;
        display: grid !important;
        grid-template-columns: 100% !important;
        grid-template-rows: 100% !important;
        width: 100% !important;
        height: 100% !important;
        min-width: 0 !important;
        min-height: 0 !important;
        background: none !important;
        border: none !important;
        box-shadow: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      /* --- SUPERCARD RENDER PIPELINE --- */
      .supercard-container {
        display: grid !important;
        grid-template-areas: "stack" !important;
        width: 100% !important;
        height: 100% !important;
        background-color: var(--card-background-color, #1c1c1c);
        overflow: hidden !important;
        isolation: isolate;
        cursor: pointer;
        position: relative;
        z-index: ${SC_LAYERS.BG_NATIVE};
      }

      .supercard-container::before {
        content: "";
        grid-area: stack;
        position: absolute;
        inset: 0;
        background-color: var(--uc-color, transparent);
        z-index: ${SC_LAYERS.BG_STATIC};
        pointer-events: none;
        opacity: var(--uc-opacity, 0);
        transition: background-color 0.6s ease, opacity 0.6s ease;
        border-radius: var(--ha-card-border-radius, 12px);
      }

      .supercard-background { display: none !important; }

      .sc-content-row, #module-overlay-slot {
        grid-area: stack;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
      }

      .sc-content-row {
        display: flex;
        align-items: center;
        gap: calc(16px * var(--sc-scale, 1));
        padding: calc(12px * var(--sc-scale, 1)) calc(16px * var(--sc-scale, 1));
        z-index: ${SC_LAYERS.LAYOUT_GRID};
      }

      #module-overlay-slot {
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: ${SC_LAYERS.ELM_BASE};
        pointer-events: none;
      }

      .supercard-icon-container, .sub-button {
        background-color: rgba(255,255,255,0.1) !important;
        border: 1px solid rgba(255,255,255,0.1) !important;
        display: flex;
        align-items: center;
        justify-content: center;
        width: calc(42px * var(--sc-scale, 1));
        height: calc(42px * var(--sc-scale, 1));
        border-radius: 50%;
        flex-shrink: 0;
        z-index: ${SC_LAYERS.ELM_STATIC};
        position: relative;
      }

      /* The plate taken away, not the box: the border goes transparent rather
         than away, because the container is content-box in the content row
         and a border that stops existing takes two pixels of width with it -
         the icon would shift the moment the plate was switched off. Both
         declarations need an !important of their own to beat the ones above,
         which carry it to get past the theme. */
      .supercard-icon-container.no-plate {
        background-color: transparent !important;
        border-color: transparent !important;
      }

     .layer-elm-dynamic {
        z-index: ${SC_LAYERS.ELM_DYNAMIC};
        position: relative;
        will-change: opacity, transform;
      }

      /* --sc-icon-glyph is the canvas' way in: ::slotted() reaches the icon
         container but not the ha-icon inside it, and a rule here on the
         element itself would beat anything inherited. Unset everywhere else,
         so the content row keeps the size it always had. */
      ha-icon { --mdc-icon-size: var(--sc-icon-glyph, calc(24px * var(--sc-scale, 1))); }
      .text-container { display: flex; flex-direction: column; flex-grow: 1; min-width: 0; }
    `;
  }

  firstUpdated() {
    if (!this._resizeObserver) {
      this._resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.contentRect.width;
          const h = entry.contentRect.height;
          if (w > 0 && h > 0) {
            const minDim = Math.min(w, h);
            // On the host, not on #main-container: lit owns that element's
            // style attribute and rewrites it whole on every render, which
            // would drop these until the next resize. A custom property
            // inherits down, so everything inside still reads them - and the
            // corner radius, which is a percentage of one of these lengths,
            // cannot afford to lose them mid-render.
            this.style.setProperty('--sc-avail-w', w + 'px');
            this.style.setProperty('--sc-avail-h', h + 'px');
            this.style.setProperty('--sc-avail-min', minDim + 'px');

            // The rows compatibility path needs the card's real shape, and
            // the first render happens before this observer has ever fired.
            // So the numbers are kept, and that first render is asked for
            // again once there is a box to read - once, because after that
            // the ratio is already the one the canvas was built with.
            const hadBox = this._boxW > 0 && this._boxH > 0;
            this._boxW = w;
            this._boxH = h;
            if (!hadBox) this.requestUpdate();

            const slot = this._drawnSlot();
            // The scale exists for the plain content row, which a canvas card
            // does not draw - so the responsive switches are not offered
            // there, and a leftover one must not scale a placed icon either.
            if (!SC_UTILS.onCanvas(slot) && (slot.card_height_responsive || slot.card_width_responsive)) {
              const scale = Math.max(0.3, minDim / 70);
              this.style.setProperty('--sc-scale', scale.toFixed(3));
            } else {
              this.style.setProperty('--sc-scale', '1');
            }
          }
        }
      });
      this._resizeObserver.observe(this);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  updated(changedProps) {
    super.updated(changedProps);
    Object.values(window.SupercardModules).forEach(module => {
      if (typeof module.onAfterRender === 'function') {
        module.onAfterRender(this.renderRoot, this._drawnSlot(), { overlayChanged: true });
      }
    });
  }

  /**
   * The slot as the card draws it: a leftover rows layout is read as the
   * canvas it describes, so every consumer sees one model.
   *
   * Memoised on the slot object and the measured box, because `render` runs on
   * every state update the card is subscribed to and the migration walks every
   * row, cell and pattern. The slot is replaced rather than mutated on an
   * edit, so its identity is a sound cache key.
   *
   * @returns {any}
   */
  _drawnSlot() {
    const slot = this.config?.gauge_studio || {};
    if (this._drawnFor === slot && this._drawnW === this._boxW && this._drawnH === this._boxH) {
      return this._drawnSlotCache;
    }
    const compat = rowsAsCanvas(slot, this._boxW, this._boxH);
    this._drawnFor = slot;
    this._drawnW = this._boxW;
    this._drawnH = this._boxH;
    this._drawnSlotCache = compat ? { ...slot, ...compat } : slot;
    return this._drawnSlotCache;
  }

  render() {
    if (!this.config || !this.hass) return html``;

    const slot = this.config.gauge_studio || {};
    const drawnSlot = this._drawnSlot();
    const entityId = slot.entity || this.config.entity;

    const stateObj = entityId ? this.hass.states[entityId] : null;

    /*
     * The main entity is optional, and an entity that has gone missing does
     * not take the card with it.
     *
     * The card grew out of one entity, and for a while that was the whole
     * card - so a name Home Assistant did not know was a card with nothing
     * to show, and the red box was the honest answer. It has not been the
     * whole card for a long time: gauges, bars and labels each name their
     * own entity, and this one is left feeding the icon, name and state
     * elements plus the fallback for a tap action. A renamed sensor used by
     * none of those would blank a dashboard's worth of gauges that are all
     * still reporting, which is a worse answer than showing them.
     *
     * So the parts that depend on it say so - the state shows a dash - and
     * the editor names the entity as missing where it can be fixed.
     */
    const missing = !!entityId && !stateObj;

    let stateVal = missing ? '—' : (stateObj ? stateObj.state : '');
    if (stateObj && slot.entity_attribute && stateObj.attributes[slot.entity_attribute] !== undefined) {
      stateVal = stateObj.attributes[slot.entity_attribute];
    }

    const val = parseFloat(stateVal);
    const isNum = !isNaN(val);

    let combinedStyles = '';
    let htmlSlots = [];
    let overlaySlots = [];
    let moduleData = {};

    // Modules are handed the slot, not the card config, so the one fact about
    // the card's box that the layout renderer needs travels with it.
    //
    // A card still carrying a rows layout is answered with the canvas that
    // layout describes - see rows-compat.js. It is spread in ahead of the two
    // private keys and behind the slot, so the repointed pattern lists reach
    // the colour and glass modules the same way the canvas reaches the layout
    // one: every module reads this object and none of them reads the slot.
    const renderConfig = { ...drawnSlot, __moduleData: moduleData,
                           __heightPinned: isHeightPinned(this.config) };

    Object.entries(window.SupercardModules).forEach(([modKey, module]) => {
      if (typeof module.update !== 'function') return;
      const res = module.update({ stateObj, stateVal, val, isNum, config: renderConfig, hass: this.hass });

      if (res?.moduleData) {
        moduleData[modKey] = res.moduleData;
      }

      if (res?.cssVars) {
        for (const [k, v] of Object.entries(res.cssVars)) {
          if(v) combinedStyles += `${k}: ${v}; `;
        }
      }

      if (res?.html !== undefined) htmlSlots.push(html`<div class="sc-html-wrap-${modKey}" style="display:contents" .innerHTML=${res.html}></div>`);
      else if (res?.litHtml !== undefined) htmlSlots.push(html`<div class="sc-html-wrap-${modKey}" style="display:contents">${res.litHtml}</div>`);

      if (res?.litOverlay !== undefined) overlaySlots.push(html`<div class="sc-overlay-wrap-${modKey}" style="display:contents">${res.litOverlay}</div>`);
      else if (res?.htmlOverlay !== undefined) overlaySlots.push(html`<div class="sc-overlay-wrap-${modKey}" style="display:contents" .innerHTML=${res.htmlOverlay}></div>`);
    });

    // FIX: The critical change! Optional chaining (?.) protects against crashes when stateObj is null.
    const uom = stateObj?.attributes?.unit_of_measurement ? ' ' + stateObj.attributes.unit_of_measurement : '';
    const headerText = slot.entity_name_override || stateObj?.attributes?.friendly_name || entityId || 'Unnamed card';
    // The entity's own icon, unless the canvas was told otherwise: an entity
    // put on a card to mean something else needs a say, and its chip is the
    // only place there is one.
    const iconId = slot.icon_override || stateObj?.attributes?.icon || 'mdi:bookmark';

    combinedStyles += `border-radius: ${SC_UTILS.cardRadius(slot) ?? '12px'}; `;

    if (slot.card_height_responsive !== true && slot.card_height) {
      combinedStyles += `--sc-explicit-height: ${slot.card_height}px; `;
    } else {
      combinedStyles += `--sc-explicit-height: 100%; `;
    }

    const handleTouchOrClick = (e) => {
      const path = e.composedPath();
      const isSubElement = path.some(el => el.classList && (el.classList.contains('sub-button') || el.classList.contains('supercard-icon-container')));

      if (isSubElement) {
        return;
      }

      e.stopPropagation();

      // No longer exposed in the editor - the interaction module covers this and
      // more, per element rather than for the whole card. The key is still
      // honoured so existing configurations keep their detail view.
      if (!slot.enable_click) return;

      if (this.config) {
        const event = new Event('hass-action', { bubbles: true, composed: true });
        event.detail = {
          config: this.config,
          action: 'tap'
        };
        this.dispatchEvent(event);
      }
    };

    return html`
      <ha-card>
        <div class="supercard-container" id="main-container" style="${combinedStyles}" @click=${handleTouchOrClick} @touchstart=${handleTouchOrClick}>

          <div class="sc-content-row">
            <div class="supercard-icon-container ${slot.hide_icon_background ? 'no-plate' : ''}" id="icon" style="display: ${slot.hide_icon ? 'none' : ''}">
              <ha-icon icon="${iconId}"></ha-icon>
            </div>

            <div class="text-container">
              <div class="supercard-header" id="header" style="display: ${slot.hide_entity_name ? 'none' : ''}">${headerText}</div>
              <div class="supercard-state" id="state" style="display: ${slot.hide_entity_state ? 'none' : ''}">${stateVal}${uom}</div>
              <div id="module-html-slot">${htmlSlots}</div>
            </div>
          </div>

          <div id="module-overlay-slot">${overlaySlots}</div>

        </div>
      </ha-card>
    `;
  }
}

if (!customElements.get('gauge-studio-core')) customElements.define('gauge-studio-core', SupercardCore);

window.customCards = window.customCards || [];
if (!window.customCards.find(c => c.type === 'gauge-studio-core')) {
  window.customCards.push({
    type: 'gauge-studio-core', name: 'Gauge, Progressbar, Custom Card Studio', description: 'Gauges and progress bars for your dashboard, arranged and configured in the card editor', preview: false, documentationURL: ''
  });
}
