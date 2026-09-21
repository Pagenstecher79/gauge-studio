# Handover: the pointer shadow redesign

Branch `feat/47-spherical-refraction`, pushed at `e272929`, PR #93 open.
`Checks` green. Step 1 of four is done; steps 2-4 are below.

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

## Step 2 - card light

- One light value on the slot, set through the existing `<sc-shadow-pad>`,
  which moves from per-pattern to the card.
- A *Light* entry in the `canvas-settings` row, `supercard-04-layout-editor.js`
  around line 8193 (beside Grid/snap, Live preview, Highlight) - **not** a
  third canvas button, and **not** in the fx-glass menu. The user excluded the
  fx-glass placement explicitly.
- Both readers fall back to their old per-object key while the card has no
  light: `src/glass-light.js:46-47` (`shadow_angle`, `shadow_distance`) and
  `src/supercard-05-gauge.js:1021` (`pointer_shadow_angle`).
- The fx-glass pad call site is `src/supercard-07-fx-glass-editor.js:354-371`.

## Step 3 - renderer and editor

- Renderer `src/supercard-05-gauge.js:1005-1050`. It currently reads
  `pointer_shadow_type` (1012), `_blur` (1015), `_distance` with the
  `_offset_y` fallback (1020), `_angle` (1021), `_color` (1032), `_opacity`
  (1036) and builds an `feGaussianBlur` filter `p-shadow-<entity>_<idx>`.
  Replace with `needleLift`; the old keys stay readable.
- Editor fields `src/supercard-05-gauge-editor.js:288-296`, six down to two.
- Canvas chips `src/supercard-04-layout-editor.js:1124-1140`, same. The "has a
  shadow" test at line 508 (`pointer_shadow_type !== 'none'`) becomes a height
  test.

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

Nothing here is open any more, and nothing draws from it yet. **Step 2, the
card light, is next.**

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
- PR #93 awaits a merge decision. HACS Validation is red for the known reason.
