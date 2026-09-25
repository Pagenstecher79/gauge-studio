/**
 * How high a needle stands, as everything that says so.
 *
 * A pointer's shadow used to be six settings - a type, a colour, a distance
 * from minus five to plus five, an angle over the full circle, a blur and an
 * opacity - and between them they describe a great many things no light can
 * do. An angle of 270 puts the shadow above the needle. A distance of five on
 * a 280 px dial throws it most of the way to the rim. Worst of all the three
 * that belong together were free of each other, so the ordinary mistake was a
 * shadow far away and fully opaque, which reads as a second needle rather
 * than as one lifted off the face.
 *
 * So the settings are two, and they are the two a physical instrument has:
 * how far the needle stands off the dial, and how soft the light is. Offset,
 * penumbra and darkness all follow, and none of them can be driven anywhere a
 * real shadow could not go. That is the point of the envelope, not tidiness:
 * every combination this hands back is a shadow somebody could photograph.
 *
 * `glass-light.js` argues the same case for a glass edge, and its distance is
 * a multiple of the bevel width rather than a length, so that one angle does
 * not read differently on every pattern. A needle's offset is a multiple of
 * the needle's own width for exactly that reason: a hair-thin pointer and a
 * broad one at the same height should look like the same height.
 *
 * ## Why a shadow is not enough
 *
 * On a dark dial there is barely any light for the needle to take away, so a
 * drop shadow there is not subtle, it is absent - and painting one anyway is
 * what makes a dark gauge look wrong. What still tells the eye that something
 * stands off a black surface is the other two:
 *
 * - the **rim light** along the lit edge, which is additive and therefore
 *   works on black exactly as well as on white, and
 * - the **contact shadow**, the tight dark hugging the needle where it comes
 *   nearest the face. It kills the surface's sheen rather than its light, so
 *   it survives where a cast shadow cannot.
 *
 * The one height slider spends its budget on whichever of the three the
 * surface can actually show. That is what `adaptive` should have meant all
 * along, and it is still one slider.
 *
 * Pure, so the curves can be tested and so the editor's preview and the
 * renderer cannot drift apart.
 */

import { luminance } from './highlight-ink.js';

/** Both settings run 0 to 1. Neither is a length, and neither may leave it. */
export const MAX_HEIGHT = 1;
export const MAX_DIFFUSION = 1;

/**
 * The softest light this slider reaches, as a share of the model's own scale.
 *
 * An overcast sky really does erase a needle's shadow, so a diffusion axis
 * that runs all the way there ends in nothing - and a slider whose last
 * stretch is indistinguishable from its end is a slider that lies about what
 * it has left. The far end is therefore pulled back to the softest light a
 * shadow still says something under, judged against a row of fixed steps: 0.6
 * of the way was still a shadow, the whole way was not.
 *
 * Applied once, to the input, rather than to the four constants that read it -
 * blur, core, offset and rim all describe the same light and have to agree
 * about how soft its far end is. Moving this number moves all four together,
 * which is what makes it safe to move.
 */
const DIFFUSION_REACH = 0.6;

/**
 * At full height the shadow lies a quarter of a needle width away.
 *
 * Judged by eye rather than derived, and twice over so that one impression
 * could not carry it: freely, against a dial at half height, and again
 * against a row of fixed steps. The two answers were 0.30 and 0.21 needle
 * widths, so the number between them is this one.
 *
 * A whole width, which this was at first, is too far - the shadow separates
 * and reads as a second needle. It is also more than an instrument does: a
 * broad pointer sits a few millimetres off its dial, not a whole pointer's
 * width, and only a low sun would stretch that into an offset as long as the
 * needle is wide.
 */
export const DROP_PER_WIDTH = 0.25;

/** Diffuse light has less direction, so the shadow creeps back underneath. */
const DROP_DIFFUSE_PULL = 0.35;

/** The penumbra, in needle widths: a floor, then height, then softness. */
const BLUR_FLOOR = 0.04;
const BLUR_PER_HEIGHT = 0.25;
const BLUR_PER_DIFFUSION = 0.18;

/** A needle lying on its dial, under a hard light. Nothing is darker. */
export const DARKEST = 0.55;
/**
 * What spreading the same occlusion over more area costs the core.
 *
 * Only what the blur does not already take. A Gaussian of width s leaves
 * `erf(w / (2s√2))` at the centre of a strip of width w, so softening a
 * shadow lightens its core whether or not anything here says so, and the
 * first draft said so a second time: over the diffusion slider's travel the
 * visible core fell by a factor of four, and everything past the first
 * quarter of it was too faint to see at all. A slider whose upper half does
 * nothing but disappear is the same fault this module was written to fix.
 *
 * Height keeps its full share - a shadow thrown further really does spread -
 * and diffusion keeps only the part the blur cannot account for.
 */
const SPREAD_HEIGHT = 1.2;
const SPREAD_DIFFUSION = 0.3;

/** The contact dark, which is strongest where the needle nearly touches. */
const CONTACT_DARKEST = 0.45;
const CONTACT_FADE = 0.75;
const CONTACT_BLUR = 0.18;

/** The lit edge. Some of it is always there; the rest is what the dark owes. */
const RIM_BRIGHTEST = 0.55;
const RIM_ALWAYS = 0.35;
const RIM_OFFSET = 0.22;
/** Soft light has no bright edge to catch. */
const RIM_DIFFUSE_LOSS = 0.5;

const clamp01 = (/** @type {number} */ v) =>
  Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;

/**
 * How much of a cast shadow a surface can show, 0 to 1.
 *
 * Perceptual lightness rather than luminance, because the question is not how
 * much light the surface returns but whether an eye will see any of it go
 * missing - the same L* curve `adaptive-ink.js` chooses its ink by.
 *
 * A null backdrop means the caller could not say what the needle is drawn on.
 * That is answered with full room rather than none: not knowing is no reason
 * to take somebody's shadow away, and the caller that does know - the gauge,
 * which can read its own background and the card's - passes it in.
 *
 * @param {[number, number, number]|null|undefined} backdrop
 * @returns {number}
 */
export function shadowRoom(backdrop) {
  if (!Array.isArray(backdrop) || backdrop.length !== 3) return 1;
  const y = luminance(/** @type {[number, number, number]} */ (backdrop));
  // Linear at the very bottom, where the cube root is not defined well enough
  // to use - as in `adaptive-ink.js`, and for the same reason.
  const lstar = y <= 0.008856 ? y * 903.3 : 116 * Math.cbrt(y) - 16;
  return clamp01(lstar / 100);
}

/**
 * @typedef {object} NeedleLift
 * @property {{dx: number, dy: number, blur: number, opacity: number}} drop
 *   the cast shadow, in the units `width` was given in
 * @property {{blur: number, opacity: number}} contact
 *   the dark hugging the needle; no offset, it does not travel
 * @property {{dx: number, dy: number, opacity: number}} rim
 *   the lit edge, offset towards the light
 */

/**
 * Everything that says how high the needle stands.
 *
 * @param {object} o
 * @param {number} o.height 0 lying on the dial, 1 as high as one stands
 * @param {number} [o.diffusion] 0 a hard sun, 1 an overcast sky
 * @param {number} o.width the needle's width, in whatever unit the caller
 *   paints in; every length handed back is in that unit
 * @param {number} [o.angle] where the light throws the shadow, in degrees
 * @param {[number, number, number]|null} [o.backdrop] what the needle is
 *   drawn on, from `markBackdrop` - null where the caller cannot say
 * @returns {NeedleLift}
 */
export function needleLift({ height, diffusion = 0, width, angle = 90, backdrop = null }) {
  const h = clamp01(height);
  const d = clamp01(diffusion) * DIFFUSION_REACH;
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const room = shadowRoom(backdrop);
  const rad = (Number.isFinite(angle) ? angle : 90) * Math.PI / 180;

  const dist = h * w * DROP_PER_WIDTH * (1 - DROP_DIFFUSE_PULL * d);
  // The same occlusion spread over more area, so the core lightens as the
  // shadow grows. This is the pair that used to be free of each other, and
  // free of each other is how a shadow ends up reading as a second needle.
  const core = DARKEST / (1 + SPREAD_HEIGHT * h + SPREAD_DIFFUSION * d);

  return {
    drop: {
      dx: dist * Math.cos(rad),
      dy: dist * Math.sin(rad),
      blur: w * (BLUR_FLOOR + BLUR_PER_HEIGHT * h + BLUR_PER_DIFFUSION * d),
      opacity: core * room,
    },
    contact: {
      blur: w * CONTACT_BLUR,
      opacity: CONTACT_DARKEST * (1 - CONTACT_FADE * h),
    },
    rim: {
      dx: -h * w * RIM_OFFSET * Math.cos(rad),
      dy: -h * w * RIM_OFFSET * Math.sin(rad),
      // What the cast shadow cannot say on a dark face, the lit edge says
      // instead - and a share of it is there on any face, because an edge
      // turned towards the light is lit whatever lies underneath.
      opacity: h * RIM_BRIGHTEST * (RIM_ALWAYS + (1 - RIM_ALWAYS) * (1 - room))
               * (1 - RIM_DIFFUSE_LOSS * d),
    },
  };
}

/**
 * The lift that reproduces an old six-key shadow, as near as one number can.
 *
 * Only the offset is carried. Blur, colour and opacity were free of one
 * another under the old keys, and their being free of one another is exactly
 * what `needleLift` removes - a light at a height decides all three - so
 * reading them back in would be inventing a shadow nobody configured. The
 * distance is what somebody actually looked at and nudged, so it is the one
 * worth keeping: `dist = height * width * DROP_PER_WIDTH` inverted, and the
 * sign dropped, because a negative distance was the old way of throwing the
 * shadow the other way and the light's angle says that now.
 *
 * @param {{ distance?: number|string, width?: number }} legacy
 * @returns {number} a height in 0..1
 */
export function liftFromLegacy({ distance, width }) {
  const w = Number(width);
  const d = Number(distance);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(d)) return 0;
  return clamp01(Math.abs(d) / (w * DROP_PER_WIDTH));
}
