/**
 * The one light that falls on a card, and where a reader finds it.
 *
 * Every lit thing the card draws - the bevel on a glass pattern, the relief on
 * a segmented ring, the shadow a needle stands off its dial in - is lit from
 * somewhere, and until now each of them carried its own sun. Six patterns and
 * four gauges on a card meant ten suns, and nothing kept them in step: a card
 * read as ten photographs rather than as one object. Two synchronised sliders
 * would not have fixed it either - two read paths let a hand-edited YAML bring
 * the divergence straight back.
 *
 * So the light is one value on the slot, and a part that wants to know where
 * the sun is asks here. `fallback` is what that part used to carry itself, and
 * it is what answers while the card has no light of its own - a card saved
 * before this existed keeps the light it was drawn under, pattern by pattern,
 * until somebody moves the sun.
 *
 * Pure, and in a module of its own because both halves read it: the renderers
 * draw by it and the editor's pad sets it. See `docs/handover-pointer-shadow.md`.
 */

/** The sun straight overhead, which is where a shadow falls plumb down. */
export const LIGHT_ANGLE = 90;

/**
 * How far out the sun stands, as a multiple of whatever the part being lit is
 * thick - a bevel's width, not a length. Moving the sun out has to mean more
 * offset on a thick edge than on a thin one, or one angle reads differently on
 * every pattern.
 */
export const LIGHT_DISTANCE = 1;

/**
 * The angles a light can stand at, as the direction of the shadow it throws:
 * clockwise from three o'clock, screen coordinates, so 90 is straight down and
 * the sun that cast it is straight up.
 *
 * The whole circle. It was half of one for a while, on the argument that a
 * card lit from underneath reads as a mistake - which is true of a card that
 * did not mean it, and a rule about what looks right is not a rule about what
 * may be set. The pad still draws the horizon, so a sun below it is a thing
 * somebody chose rather than a thing that happened.
 */
export const ARC_MIN = 0;
export const ARC_MAX = 360;

/**
 * An angle brought into 0..360, and nothing else.
 *
 * It folded onto the upper half until the horizon was opened; the name is
 * kept because it is still what every call site wants - one reading of an
 * angle, wherever the number came from.
 *
 * @param {number} deg
 * @returns {number} an angle between `ARC_MIN` and `ARC_MAX`
 */
export function clampLightAngle(deg) {
  // `Infinity % 360` is NaN, and an angle of NaN puts a shadow nowhere at all.
  // The folding this used to do caught that by accident; this has to say it.
  const n = Number(deg);
  if (!Number.isFinite(n)) return LIGHT_ANGLE;
  return (n % 360 + 360) % 360;
}

/**
 * Where the sun is for one part, and how far out it stands.
 *
 * The card's own light wins; `fallback` is the part's own pair, read only
 * while the card has none. The card's angle is folded onto the arc and the
 * fallback is not - the fallback was set under the old rule, and quietly
 * turning somebody's shadow round on the way past is not a migration anybody
 * asked for. It moves only when they move it.
 *
 * @param {any} slot the card's own config
 * @param {{angle?: any, distance?: any}} [fallback] the part's own light
 * @returns {{angle: number, distance: number, fromCard: boolean}}
 */
export function cardLight(slot, fallback) {
  // A number or a string that is one, and nothing else. `Number([])` is 0 and
  // perfectly finite, so a looser test reads an empty array as a light from
  // three o'clock - and a config that has been through a YAML editor and a
  // round of storage can hand back very nearly anything.
  const has = (/** @type {any} */ v) =>
    (typeof v === 'number' || (typeof v === 'string' && v.trim() !== ''))
    && Number.isFinite(Number(v));
  const cardAngle = slot?.light_angle;
  const cardDistance = slot?.light_distance;
  const fromCard = has(cardAngle) || has(cardDistance);
  if (fromCard) {
    return {
      angle: has(cardAngle) ? clampLightAngle(Number(cardAngle)) : LIGHT_ANGLE,
      distance: has(cardDistance) ? Math.max(0, Number(cardDistance)) : LIGHT_DISTANCE,
      fromCard: true,
    };
  }
  return {
    angle: has(fallback?.angle) ? Number(fallback?.angle) : LIGHT_ANGLE,
    distance: has(fallback?.distance) ? Number(fallback?.distance) : LIGHT_DISTANCE,
    fromCard: false,
  };
}

/**
 * Whether the card has a light of its own yet.
 *
 * The editor asks, so that the line standing in for a pad that has moved can
 * say whether a pattern is still drawing its own light or has already been
 * taken over by the card's.
 *
 * @param {any} slot
 */
export function hasCardLight(slot) {
  return cardLight(slot).fromCard;
}
