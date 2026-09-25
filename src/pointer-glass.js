/**
 * Glass for the needle and the centre point, as numbers and as one CSS
 * string per part.
 *
 * The pill's glass (`pill-glass.js`) is the model, but a needle is not a
 * pill: it turns. Measured on `.claude/bench/pointer-glass.html` against a
 * 120 Hz budget of 8.3 ms, and written up in `docs/perf-cpu.md`, the cost of
 * glass here is the *movement* and nothing else. A needle sits on its own
 * layer so that its rotation is a compositor transform and the dial beneath
 * it never repaints; a `backdrop-filter` takes that away, because the layer
 * then has to re-read and re-filter the dial at every angle it passes
 * through. Parked, a glassed needle costs nothing at 64 gauges; turning, it
 * costs a third of the frame rate.
 *
 * Three things follow, and they are what this module is shaped by:
 *
 * - **The centre point is free.** It does not move. Glass on the hub alone,
 *   with the needle turning beside it, measured 120.0 fps at 64 gauges, so
 *   it is offered without a gate and without a warning.
 * - **The look is in the cheap parts.** A translucent body and a lit rim are
 *   a background and a `box-shadow`, and they cost nothing at all. They are
 *   what reads as glass at this size, so they are what `glass` is.
 * - **The bend is the expensive half of the look.** It re-reads the dial at
 *   every angle the needle passes through, so it stays a second effect that
 *   has to be asked for - `glass_liquid` rather than `glass` - and it says
 *   what it costs. It is no longer withheld from a thin needle: a rod bends
 *   a large share of its own width, and the share is what was wrong, not
 *   the needle. See `POINTER_LENS_FRACTION`.
 *
 * The blur is offered too, because a user may want frost rather than glass,
 * but it is the half that breaks first - 32 turning needles cost a quarter
 * of the frame rate - so it is a slider that starts at zero and says so. At
 * zero it must produce **no `blur()` at all**: a `blur(0px)` is not a
 * no-op, it still promotes the element to a backdrop root and pays for the
 * re-sampling, which is the whole of what costs here.
 *
 * Pure, so it is testable and so the editor could preview the same parts.
 */

import { suspendable } from './glass-suspend.js';

/** The effects a pointer or a centre point can carry. */
export const POINTER_GLASS_EFFECTS = Object.freeze(['none', 'glass', 'glass_liquid']);

/**
 * How far a rod bends what is behind it, as a share of its own width.
 *
 * Not the pill's 0.12. That share was measured on a slab: a wide pane whose
 * middle is flat and whose bevel is a narrow band at the edge, so the shift
 * is a small part of a large box. A needle has no flat middle. It is a rod,
 * curved across its whole width, and a rod displaces a far larger share of
 * itself - which is why a pen laid behind a glass tube is not nudged but
 * visibly broken.
 *
 * The gauge's viewBox is 50 across, so a unit is 2 % of the gauge. At this
 * share a needle of two units - the default, a fine one - shifts its
 * backdrop by about a third of its own width, which is three pixels on the
 * 280 px gauge this was judged on and holds down to about half that.
 *
 * This replaces a width gate. The old rule offered the lens only above four
 * units, on the ground that 12 % of a thin needle is half a pixel - true of
 * the share, not of the needle. The gate also measured the wrong thing: it
 * counted units of the dial, while whether a bend can be seen is a count of
 * pixels, and the same four units are 16 px on a small gauge and 50 on a
 * large one. Nothing that was saved changes, because below four units the
 * option could not be chosen at all.
 */
export const POINTER_LENS_FRACTION = 0.34;

/**
 * @param {unknown} effect
 * @returns {boolean} whether anything is drawn as glass at all
 */
export function isPointerGlass(effect) {
  return effect === 'glass' || effect === 'glass_liquid';
}

/**
 * How far a glassed part bends what is behind it, as a share of its shorter
 * side - the same share `glass-lens.js` turns into pixels once the part has
 * been laid out.
 *
 * The needle and the hub are both rods seen end on, so both get
 * `POINTER_LENS_FRACTION`; there is no width below which the lens is
 * withheld, and see that constant for why there used to be.
 *
 * @param {unknown} effect
 * @returns {number} 0 where nothing is bent
 */
export function pointerLensFraction(effect) {
  return effect === 'glass_liquid' ? POINTER_LENS_FRACTION : 0;
}

/**
 * The blur, in pixels, as the renderer should apply it.
 *
 * Zero and anything that is not a number mean no blur - not `blur(0px)`,
 * which still costs a backdrop root.
 *
 * @param {unknown} px
 * @returns {number} 0, or a positive number of pixels
 */
export function pointerBlurPx(px) {
  const v = Number(px);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * The `backdrop-filter` value for a glassed part, or '' where there is
 * nothing to filter.
 *
 * Both halves are optional and either may be alone. They are only ever
 * stacked because a user asked for both; nothing here adds a blur of its own
 * to a lens, for the reason the pill gives - a lens that also frosts its
 * backdrop reads as frost, and the bending is the point.
 *
 * @param {string} filterId the lens filter in the component's shadow root,
 *   or '' where the part does not bend
 * @param {number} blurPx from `pointerBlurPx`
 * @returns {string} already wrapped for `glass-suspend`
 */
export function pointerBackdrop(filterId, blurPx) {
  const parts = [];
  if (blurPx > 0) parts.push('blur(' + blurPx + 'px)');
  if (filterId) parts.push('url(#' + filterId + ')');
  return suspendable(parts.join(' '));
}

/**
 * The paint that makes a part read as glass: a translucent body, a lit rim,
 * and a shadow under it.
 *
 * The tint is the part's own colour thinned down rather than plain white, so
 * a red needle stays a red needle when it turns to glass - the colour is a
 * setting the user made and glass is a material, not a repaint.
 *
 * Thinned with `color-mix` and not by resolving the colour to numbers: the
 * colour may be a `var()` off the theme, and resolving one freezes the
 * current theme into the markup. `color-mix` leaves it following.
 *
 * `strong` is the liquid effect: the same shading further apart, because a
 * rim that stands further from the middle has more to bend through it. It is
 * the pill's rule and it is what separates the two effects when the lens
 * itself is too small to see.
 *
 * `rim` is the hairline and the drop shadow, and it is withheld from a shape
 * that is cut out with `clip-path`. A `box-shadow` is drawn against the
 * border box and knows nothing of the cut: on a triangle the two inset lines
 * run across the middle of the shape instead of along its slanted edges, and
 * the outer shadow is clipped away entirely. Gradients are painted into the
 * background and are cut with everything else, so they are all a clipped
 * shape gets - and one more of them, standing in for the lost lower rim.
 *
 * @param {string} effect
 * @param {string} color the part's colour, as CSS - a `var()` included
 * @param {{ rim?: boolean }} [opts]
 * @returns {string} declarations, ready to drop into an inline style
 */
export function pointerGlassPaint(effect, color, { rim: wantRim = true } = {}) {
  const strong = effect === 'glass_liquid';
  const body = 'color-mix(in srgb, ' + color + ' ' + (strong ? 22 : 30) + '%, transparent)';

  // Along the needle rather than across it: a needle is lit from the side it
  // faces, and a gradient across a 2 px bar is one colour.
  const dome = strong
    ? 'linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 55%), '
      + 'radial-gradient(120% 200% at 50% 130%, rgba(255,255,255,0.28), transparent 62%)'
    : 'linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0) 60%)';

  const rim = strong
    ? [
        'inset 0 1px 0 rgba(255,255,255,0.85)',
        'inset 0 -1px 0 rgba(255,255,255,0.4)',
        'inset 0 0 0 0.5px rgba(255,255,255,0.35)',
        '0 1px 3px rgba(0,0,0,0.45)',
      ]
    : [
        'inset 0 1px 0 rgba(255,255,255,0.7)',
        'inset 0 0 0 0.5px rgba(255,255,255,0.28)',
        '0 1px 2px rgba(0,0,0,0.4)',
      ];

  if (!wantRim) {
    return 'background-color: ' + body + '; background-image: '
      + 'linear-gradient(0deg, rgba(0,0,0,0.35), rgba(0,0,0,0) 45%), ' + dome + ';';
  }
  return 'background-color: ' + body + '; background-image: ' + dome + '; '
    + 'box-shadow: ' + rim.join(', ') + ';';
}

/**
 * Everything a glassed part needs as one inline style, geometry included.
 *
 * The geometry comes in the gauge's own units and leaves as per cent of the
 * layer, because the layer is the square the viewBox is letterboxed into -
 * the same square the SVG shape would have been drawn on, so the HTML part
 * lands exactly where the shape did.
 *
 * HTML and not SVG because `backdrop-filter` does not apply to an SVG shape
 * in any engine. That is the one reason a glassed needle is a `<div>` and a
 * plain one is a `<line>`.
 *
 * @param {object} spec
 * @param {string} spec.effect
 * @param {string} spec.color the part's colour, as CSS
 * @param {number} spec.x left edge, in gauge units
 * @param {number} spec.y top edge, in gauge units
 * @param {number} spec.w width, in gauge units
 * @param {number} spec.h height, in gauge units
 * @param {number} spec.size the viewBox's edge
 * @param {string} [spec.filterId] the lens filter, where the part bends
 * @param {number} [spec.blurPx] from `pointerBlurPx`
 * @param {'round' | 'circle' | 'triangle'} [spec.shape] how the box is cut
 * @returns {string}
 */
export function pointerGlassStyle(spec) {
  const { effect, color, x, y, w, h, size, filterId = '', blurPx = 0, shape = 'round' } = spec;
  const pct = (/** @type {number} */ v) => (v / size * 100).toFixed(4) + '%';
  const backdrop = pointerBackdrop(filterId, blurPx);

  const cut = shape === 'circle' ? 'border-radius: 50%;'
    : shape === 'triangle' ? 'clip-path: polygon(100% 50%, 0 0, 0 100%);'
    : 'border-radius: ' + pct(h / 2) + ' / 50%;';

  return 'position: absolute; left: ' + pct(x) + '; top: ' + pct(y) + '; '
    + 'width: ' + pct(w) + '; height: ' + pct(h) + '; ' + cut
    + (backdrop ? ' backdrop-filter: ' + backdrop + '; -webkit-backdrop-filter: ' + backdrop + ';' : '')
    + ' ' + pointerGlassPaint(effect, color);
}

/**
 * A glassed part as the one or two boxes it has to be drawn with.
 *
 * `backdrop-filter` is clipped by a border radius and not by a `clip-path`:
 * Chromium samples and filters the whole border box, so a glass triangle
 * comes out a glass rectangle with a corner drawn on it. A clip on an
 * *ancestor* does cut the result, so a cut-out shape is two boxes - the outer
 * one carries the geometry and the cut, the inner one the glass.
 *
 * A shape that is a border radius stays one box; there is nothing to fix and
 * a second element would be a second thing to lay out every frame.
 *
 * @param {Parameters<typeof pointerGlassStyle>[0]} spec
 * @returns {{ outer: string, inner: string|null }} `inner` is null for one box
 */
export function pointerGlassBox(spec) {
  if (spec.shape !== 'triangle') return { outer: pointerGlassStyle(spec), inner: null };
  const { effect, color, x, y, w, h, size, filterId = '', blurPx = 0 } = spec;
  const pct = (/** @type {number} */ v) => (v / size * 100).toFixed(4) + '%';
  const backdrop = pointerBackdrop(filterId, blurPx);
  return {
    outer: 'position: absolute; left: ' + pct(x) + '; top: ' + pct(y) + '; '
      + 'width: ' + pct(w) + '; height: ' + pct(h) + '; '
      + 'clip-path: polygon(100% 50%, 0 0, 0 100%);',
    inner: 'position: absolute; inset: 0;'
      + (backdrop ? ' backdrop-filter: ' + backdrop + '; -webkit-backdrop-filter: ' + backdrop + ';' : '')
      + ' ' + pointerGlassPaint(effect, color, { rim: false }),
  };
}
