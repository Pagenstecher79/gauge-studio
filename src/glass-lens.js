/**
 * The displacement maps that make glass bend what is behind it.
 *
 * `backdrop-filter: blur()` softens a backdrop; it does not bend one, and
 * bending is what separates glass from frosted plastic. An SVG
 * `feDisplacementMap` bends it: the filter reads a shift out of two channels
 * of one image, 128 meaning "leave this pixel where it is" and 0 and 255 the
 * extremes either way. Red carries the horizontal shift, green the vertical,
 * so a single image does both axes and the filter is one primitive plus one
 * fetch.
 *
 * The field is drawn, not described. A gradient can only ramp along a line or
 * out from a point; the shape that actually reads as a thick pane is a
 * superellipse - almost flat across the middle, then rising hard at the rim -
 * and no gradient draws one. A few thousand pixels of `ImageData` do, once
 * per profile for the lifetime of the page.
 *
 * Two profiles:
 *
 * - `dome` is the pane: the shift points inward and grows with
 *   `|x|^6 + |y|^6`, so the middle magnifies imperceptibly and the rim
 *   gathers the backdrop the way a thick edge does. Content under the middle
 *   stays readable; the edge is where the glass announces itself.
 * - `disc` is the gauge: the shift is radial and confined to the outer ring,
 *   so the dial reads straight while its edge curls like a watch glass.
 *
 * The map is deliberately tiny. The field is smooth, `feImage` scales it to
 * the pane with bilinear filtering, and sampling a smooth function at 64x64
 * costs the same as at 512x512 once it is stretched. (The shader this profile
 * was taken from spends 81 texture fetches per pixel on a two-pixel blur; the
 * lesson is the one that saves.)
 *
 * `lensField` is pure and testable; everything that needs a canvas sits in
 * `lensMapUri`, which caches its two results.
 */

/** How many pixels across each map is drawn. A smooth field needs no more. */
const MAP_SIZE = 64;

/**
 * The profiles, as the two numbers that separate them: the exponent of the
 * superellipse the shift follows, and where - as a share of the radius - the
 * shift is allowed to start. A ring of 0 means the whole surface takes part.
 */
const PROFILES = {
  dome: { power: 6, ringFrom: 0 },
  disc: { power: 2, ringFrom: 0.55 },
};

/**
 * One displacement map, as raw RGBA bytes.
 *
 * The shift always points at the centre of the pane: a pixel of backdrop is
 * fetched from nearer the middle than where it lands, which is magnification,
 * which is what a lens does. Strength is what the profile decides.
 *
 * @param {'dome' | 'disc'} profile
 * @param {number} [size] edge length in pixels
 * @returns {Uint8ClampedArray} `size * size * 4` bytes, RGBA
 */
export function lensField(profile, size = MAP_SIZE) {
  const { power, ringFrom } = PROFILES[profile] || PROFILES.dome;
  const out = new Uint8ClampedArray(size * size * 4);
  for (let j = 0; j < size; j++) {
    // Sample pixel centres, or the two edge columns sit half a pixel short of
    // the rim and the strongest part of the field never gets drawn.
    const py = ((j + 0.5) / size) * 2 - 1;
    for (let i = 0; i < size; i++) {
      const px = ((i + 0.5) / size) * 2 - 1;
      let amount;
      if (ringFrom) {
        const r = Math.sqrt(px * px + py * py);
        amount = Math.min(1, Math.max(0, (r - ringFrom) / (1 - ringFrom)));
      } else {
        amount = Math.min(1, Math.pow(Math.abs(px), power) + Math.pow(Math.abs(py), power));
      }
      const k = (i + j * size) * 4;
      out[k] = 128 - px * amount * 127;
      out[k + 1] = 128 - py * amount * 127;
      out[k + 2] = 0;
      out[k + 3] = 255;
    }
  }
  return out;
}

const mapCache = new Map();

/**
 * The map for a profile, as a data URI `feImage` can load.
 *
 * Cached: the field never changes, and every pane on a dashboard that uses
 * the same profile uses the same bytes.
 *
 * @param {'dome' | 'disc'} profile
 * @returns {string} empty where there is no canvas to draw on
 */
export function lensMapUri(profile) {
  const key = profile === 'disc' ? 'disc' : 'dome';
  if (mapCache.has(key)) return mapCache.get(key);
  let uri = '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = MAP_SIZE;
    canvas.height = MAP_SIZE;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(MAP_SIZE, MAP_SIZE);
    img.data.set(lensField(key));
    ctx.putImageData(img, 0, 0);
    uri = canvas.toDataURL('image/png');
  } catch (_) { uri = ''; }
  mapCache.set(key, uri);
  return uri;
}

/**
 * How far a pane bends its backdrop, as a share of its own short side.
 *
 * A pane's size is a layout result - a gauge is drawn in `cqmin`, a surface
 * gets whatever the dashboard gives it - so a displacement in pixels is a
 * different effect on every card, and the slider has to mean a *share* of the
 * pane instead. `primitiveUnits="objectBoundingBox"` would express that
 * without measuring anything, but it resolves a scalar against the box's
 * diagonal: on a 492x69 bar that is five times what the same slider does to a
 * 54px gauge, which is not one effect. The share is taken against the short
 * side instead, and `lensGeometry` turns it into pixels once the pane has
 * been measured. (The indicator pill sizes itself from its font rather than
 * from a layout, and scales its lens from that; see `pill-glass.js`.)
 *
 * The ceiling is 12 %: past that the rim stops looking like glass and starts
 * looking like a fisheye lens.
 *
 * @param {unknown} refraction 0-100, as the editor's slider writes it
 * @returns {number} 0 when there is nothing to do
 */
export function lensScaleFraction(refraction) {
  const pct = Number(refraction);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.round(Math.min(100, pct) * 0.12) / 100;
}

/**
 * The filter, as SVG markup ready to drop into the card's overlay.
 *
 * The map and the displacement are left without geometry on purpose: both
 * need the pane's size in pixels, and a pane is a layout result. The markup
 * carries the share and the selector of the element it belongs to instead,
 * and `lensGeometry` fills the numbers in once that element has been laid
 * out - see `applyLensGeometry`.
 *
 * @param {string} id the filter's id, unique per pattern
 * @param {'dome' | 'disc'} profile
 * @param {number} fraction from `lensScaleFraction`
 * @param {string} forSelector the CSS selector of the element the pane sits on
 * @param {string} [pseudo] the pseudo-element the pane is drawn as, where it
 *   is one - a pane painted as an `::after` has no box of its own to measure
 * @returns {string}
 */
export function lensFilterMarkup(id, profile, fraction, forSelector, pseudo) {
  const map = fraction ? lensMapUri(profile) : '';
  if (!map) return '';
  // The region is oversized because a displaced pixel can come from outside
  // the pane's own box - at the rim, that is the entire point. The map
  // itself must still be pinned to the box: an `feImage` with no geometry
  // fills the whole oversized region instead, which stretches the field to
  // 170 % and squeezes the rim - the only part that bends - into the outer
  // 2 % of the pane, where nobody can see it.
  return '<filter id="' + id + '" color-interpolation-filters="sRGB"'
    + ' data-sc-lens="' + fraction + '" data-sc-lens-for="' + escapeAttr(forSelector) + '"'
    + (pseudo ? ' data-sc-lens-pseudo="' + escapeAttr(pseudo) + '"' : '')
    + ' x="-35%" y="-35%" width="170%" height="170%">'
    + '<feImage result="lmap" preserveAspectRatio="none" href="' + map + '"/>'
    + '<feDisplacementMap in="SourceGraphic" in2="lmap" scale="0"'
    + ' xChannelSelector="R" yChannelSelector="G"/>'
    + '</filter>';
}

/**
 * The same filter as a live SVG element, for a renderer that builds its
 * markup with lit rather than by string.
 *
 * lit accepts a DOM node as a value, so the filter can be handed to a
 * template without a second copy of the markup and without pulling in the
 * `unsafe-svg` directive - which would come from npm while the rest of lit
 * comes from the CDN, and two lit instances in one bundle is a worse trade
 * than a parse.
 *
 * Memoised **per owner**, and that is not a detail. A node is in one place
 * at a time: memoised on the markup alone, the second component to render
 * the same filter was handed the very node the first one had already put in
 * its shadow root, and inserting it there took it back out of the first -
 * so on a card with several of them, all but the last lost their refraction
 * silently. Measured on twelve gauges: only the last one drawn still had a
 * `filter` in its root.
 *
 * So the cache is keyed by the component, weakly, and each one keeps its own
 * node for as long as the markup is unchanged - which is what the memo was
 * for: a renderer calls this on every render, and handing lit a new node
 * each time would replace the filter in the DOM on every frame.
 *
 * @param {object} [owner] the component this filter belongs to. Without one
 *   there is nothing safe to memoise against, so a fresh node is returned.
 * @returns {Element | null} null where there is nothing to bend, or no DOM
 */
export function lensFilterElement(id, profile, fraction, forSelector, pseudo, owner) {
  const markup = lensFilterMarkup(id, profile, fraction, forSelector, pseudo);
  if (!markup) return null;
  let mine = owner ? elementCache.get(owner) : null;
  if (mine && mine.has(markup)) return mine.get(markup);
  let el = null;
  try {
    const doc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg">' + markup + '</svg>', 'image/svg+xml');
    el = doc.documentElement.firstElementChild;
    if (el) el = document.importNode(el, true);
  } catch (_) { el = null; }
  if (owner) {
    if (!mine) { mine = new Map(); elementCache.set(owner, mine); }
    // One markup at a time per owner: a filter that has changed leaves a
    // node nothing will ask for again.
    mine.clear();
    mine.set(markup, el);
  }
  return el;
}

/** @type {WeakMap<object, Map<string, Element | null>>} */
const elementCache = new WeakMap();

const escapeAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * The pixel geometry a measured pane needs: where its maps go, and - when the
 * caller wants the shift taken off the pane rather than declared - how far
 * the rim bends.
 *
 * @param {number} fraction from `lensScaleFraction`, or 0 to leave the
 *   declared shift alone
 * @param {number} width the pane's width in px
 * @param {number} height the pane's height in px
 * @returns {{width: number, height: number, scale: number | null} | null}
 *   null when the pane has no box to measure
 */
export function lensGeometry(fraction, width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const scale = fraction ? Math.round(fraction * Math.min(w, h) * 100) / 100 : null;
  return { width: w, height: h, scale };
}

/**
 * The element a pane's selector names.
 *
 * A cell's pane is addressed through `::part()`, which no `querySelector` can
 * match - a pseudo-element is not an element. The part lives one shadow root
 * further in, and that is where it is looked up.
 *
 * @param {ShadowRoot | Element} root
 * @param {string} selector
 * @returns {Element | null}
 */
function resolveTarget(root, selector) {
  const part = selector.match(/^(.*)::part\(([^)]+)\)$/);
  if (!part) return root.querySelector(selector);
  const host = root.querySelector(part[1]);
  return host && host.shadowRoot ? host.shadowRoot.querySelector('[part~="' + part[2] + '"]') : null;
}

/**
 * Fill in every lens filter in a shadow root from the panes they belong to.
 *
 * Both the maps and, where the filter asks for it, the shift are pixel
 * lengths of a box that only exists after layout. A pane drawn as an
 * `::after` has no box to call `getBoundingClientRect` on - but its used
 * width and height are readable off the computed style, and that is the box
 * the filter runs in.
 *
 * @param {ShadowRoot | Element} root
 * @param {(el: Element, pseudo: string | null) => {width: string, height: string}} [readStyle]
 */
export function applyLensGeometry(root, readStyle) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const styleOf = readStyle || ((el, pseudo) => (
    pseudo ? getComputedStyle(el, pseudo) : boxOf(el)
  ));
  root.querySelectorAll('filter[data-sc-lens-for]').forEach((filter) => {
    const fraction = parseFloat(filter.getAttribute('data-sc-lens') || '0') || 0;
    const pseudo = filter.getAttribute('data-sc-lens-pseudo');
    let host = null;
    try { host = resolveTarget(root, filter.getAttribute('data-sc-lens-for') || ''); } catch (_) { return; }
    if (!host) return;
    const cs = styleOf(host, pseudo);
    const geom = lensGeometry(fraction, parseFloat(cs.width), parseFloat(cs.height));
    if (!geom) return;
    filter.querySelectorAll('feImage').forEach((img) => {
      img.setAttribute('x', '0');
      img.setAttribute('y', '0');
      img.setAttribute('width', String(geom.width));
      img.setAttribute('height', String(geom.height));
    });
    const disp = geom.scale === null ? null : filter.querySelector('feDisplacementMap');
    if (disp && disp.getAttribute('scale') !== String(geom.scale)) {
      disp.setAttribute('scale', String(geom.scale));
    }
  });
}

const boxOf = (el) => {
  const r = el.getBoundingClientRect();
  return { width: r.width + 'px', height: r.height + 'px' };
};
