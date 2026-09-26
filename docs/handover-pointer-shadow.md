# Handover: the pointer shadow redesign

Steps 1 and 2 of four are done and on `main`'s line of development; steps 3
and 4 are below. **Step 3, the renderer and the editor, is next.**

## What was decided

Six pointer-shadow controls become two: **height** (how far the needle stands
off the face) and **diffusion** (how soft the light is). `pointer_shadow_type`
and `pointer_shadow_color` go away entirely - height 0 is no shadow. The
offset is a multiple of the needle's own width, never a length.

The light direction stops being per-object and becomes **one value on the
card**, with an arc limited to angles a light can actually stand at. Not
synchronised per-pattern sliders: two read paths would let hand-edited YAML
bring the divergence back.

On a dark dial a drop shadow physically cannot show. The same height therefore
spends its budget on **rim light** (additive, reads on black) and **contact
occlusion** (kills sheen rather than light), gated by `markBackdrop` from
`adaptive-ink.js`.

## Step 1 - done (`e272929`)

`src/pointer-shadow.js`, pure, imports only `luminance` from
`highlight-ink.js`. Exports `MAX_HEIGHT`, `MAX_DIFFUSION`, `DROP_PER_WIDTH`,
`DARKEST`, `shadowRoom(backdrop)` and `needleLift({height, diffusion, width,
angle, backdrop})`, which answers `{drop:{dx,dy,blur,opacity},
contact:{blur,opacity}, rim:{dx,dy,opacity}}`.
`src/pointer-shadow.test.js`, 22 tests over an 11x11 grid of the two inputs:
the envelope (offset never over one needle width, opacity never over
`DARKEST`), monotonicity in both inputs, the backdrop trade, width scaling,
and the adversarial values. Nothing draws from it yet.

## Step 2 - card light - done

`src/card-light.js`, pure, 16 tests. `light_angle` and `light_distance` on the
slot; `cardLight(slot, fallback)` is the only reader, and `fallback` is the
per-object pair it answers with while the card has no light of its own - so a
card saved before this keeps every shadow exactly where it was until somebody
moves the sun. A card's own angle is folded onto the arc, a fallback is not:
that value was set under the old rule, and turning somebody's shadow round on
the way past is not a migration anybody asked for.

The arc is the upper half, `ARC_MIN` 0 to `ARC_MAX` 180 in shadow angles, and
it needed no bench page - past either end the sun is under the card. The pad
draws the other half as ground and `clampLightAngle` folds to the *nearer*
end, so a finger carried past the edge slides the sun along the horizon
instead of throwing it across the sky.

- The *Light* entry is in the `canvas-settings` row beside Grid/snap, Live
  preview and Highlight: `<sc-shadow-pad compact>` - 34 px, no sample, no
  preview switch - and a number field for the angle. The canvas under it is
  the preview, which is why the sample went: it is drawn at the size things
  really are, and a thumbnail is not.
- `lightParams(pat, slot)` in `glass-light.js` is the glass reader. Callers:
  `supercard-07-fx-glass.js` (`config` is the slot), `supercard-03-progressbar.js`
  twice (`this.rootConfig`), and the pad's own preview, which passes no slot
  because its live angle is ahead of any commit.
- `sc-gauge` now takes `rootConfig`, the same property and the same object
  `sc-progressbar` takes. Passed at both real call sites; the template
  thumbnail passes none and gets the default sun, which is right for a
  preview that is on no card.
- The per-pattern pad is **gone**, replaced by `sunLine` in
  `supercard-07-fx-glass-editor.js` - a line that names where the light is set
  and says which sun this pattern is drawing by. Two controls for one value is
  the thing this step exists to end.

`ScShadowPad` stayed in the fx-glass editor and is rendered from the canvas
editor, the way `<sc-gradient-stops>` is rendered from four editors. It gained
`compact` (reflected) and the arc.

## Step 3 - renderer and editor - done 2026-09-25

The gauge now draws the three layers `needleLift` describes. One key,
`pointer_lift`, 0..1.

- `liftFromLegacy({ distance, width })` in `src/pointer-shadow.js` inverts
  `dist = height * width * DROP_PER_WIDTH`. Only the distance is carried:
  blur, colour and opacity were free of one another, and their being free of
  one another is what this removes, so reading them back would be inventing a
  shadow nobody set. The sign is dropped - a negative distance was the old way
  of throwing the shadow the other way, and the light's angle says that now.
- Renderer `src/supercard-05-gauge.js`. `castAt` draws one layer and `castsOf`
  the three, bottom to top: the cast shadow, the contact shadow, and the lit
  edge - which goes *under* the needle, offset towards the sun, so only the
  sliver the needle does not cover shows. The silhouette is painted in
  `currentColor` and the group carries the colour, so one silhouette serves
  all three. `backdrop` is `markBackdrop(inkArgs)`, the same argument object
  the dial's `adaptiveInk` is built from.
- The six form fields and the six canvas chips are one each. `hasShadow` is
  gone with them.
- `SHADOW_MODE` is gone; height 0 is no shadow.
- `element-templates.js` is on the new keys. Both templates that set a
  distance translate to a lift of 1: the shadow they asked for was thrown
  further than a light at that needle's width can throw one, which is the
  clearest evidence there is that the six keys could contradict each other.
  `pointer_shadow_angle: 40` stays in the default as the per-gauge fallback
  for a card with no light of its own.

Answered at the dial, 2026-09-25: the softness slider does not earn a row.
Over its whole travel it moved the visible core by about five points, and it
was per gauge while the sun that sets it is per card. `needleLift` still takes
a diffusion - the arithmetic is right and the bench page rests on it - and the
renderer passes none.

## Step 4 - cleanup

`stripDeadConfig` in `src/config-cleanup.js:306` clears the dead keys on the
next edit.

## The numbers that were open - answered 2026-09-21/22

Judged against `.claude/bench/needle-height.html`, a page of fixed steps
rather than sliders; CLAUDE.md *A number nobody can derive is asked, not
chosen* describes the method and why it is worth repeating.

- **`DROP_PER_WIDTH` 1 -> 0.25.** A whole width separates the shadow and it
  reads as a second needle. Two independent readings, 0.30 and 0.21, met at
  0.25. Confirmed afterwards over the whole height row.
- **`SPREAD_DIFFUSION` 1.8 -> 0.3.** Double counting: a Gaussian already
  leaves only `erf(w / 2s sqrt2)` at the centre, so the constant lightened a
  second time what the blur had lightened once. The visible core used to fall
  22% -> 6% over the slider's travel, with everything past the first quarter
  invisible.
- **`BLUR_PER_DIFFUSION` 0.5 -> 0.18**, same reading.
- **`DIFFUSION_REACH = 0.6`, new.** Even corrected, the far end was still too
  soft - 15% visible, and the user rejected it while accepting 17%. Rather
  than nudge four constants that all describe the same light, the input is
  scaled once, so blur, core, offset and rim stay in agreement. The slider now
  runs 22% -> 17% visible with the penumbra growing 4.9 px -> 6.8 px on a
  17 px needle.

Nothing here is open any more. `needleLift` still draws nothing - step 3 is
where it is wired up.

One thing to watch rather than to decide now: over its travel the diffusion
slider moves the visible core by five points and the penumbra by 39%. That is
a real difference at half height (2.8 px -> 4.6 px of blur) but a quiet one at
full height. If it reads as doing nothing once the renderer is wired up, the
honest answer is one slider, not two - ask the user then rather than widening
the range, which is what made it unusable in the first place.

## Loose ends

- `docker/config/packages/demo_instruments.yaml` still pins
  `sensor.demo_carbon_dioxide` to `"700"`. The original expression is backed up
  in the session scratchpad; decide whether to restore it.
- HACS Validation is red for the known reason, until `v2.5.0`.
- `stripDeadConfig` still leaves `shadow_angle` and `shadow_distance` on every
  pattern. They are read as the fallback, so they cannot be cleared until the
  card carries a light - which is step 4's problem, not a loose end here.
