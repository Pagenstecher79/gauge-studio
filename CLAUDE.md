# Gauge, Progressbar, Custom Card Studio

A custom Lovelace card for Home Assistant: gauges and progress bars, arranged in
a grid, configured entirely in the visual card editor.

Vanilla JS + LitElement, no framework, no transpile step beyond Vite's bundling.

## Commands

```bash
npm run build      # src/index.js -> dist/gauge-studio.js (Vite lib mode)
npm run watch      # same, rebuilding on change
npm run typecheck  # tsc -p jsconfig.json --noEmit   (NOT `npx tsc`, see below)
npm run ha         # real Home Assistant in Docker (docker/README.md)
```

**Testing happens in that one Docker instance, at <http://127.0.0.1:8123/>.**
One is enough and one is all there should be: a second container, a second
port or a second browser profile splits the dashboards, the storage and the
resource entry, and then a build that works in one and not the other says
nothing about the card. `npm run build` restarts the container onto the new
bundle, so the address stays the same from one build to the next - open it
and reload rather than looking for a fresh URL. Synthetic pages under
`.claude/bench/` stay what they are: a place to measure one mechanism in
isolation, never the proof that the card works.

`npm run ha` starts a real Home Assistant in Docker with the card registered
as a Lovelace resource and a demo dashboard seeded - see `docker/README.md`.
Use it for anything a synthetic page cannot show: the editor running inside
HA's config dialog, a commit surviving the round trip through HA storage, drag
and drop, `unavailable` entities, and whether an animation is actually smooth.
Without Docker, copy `dist/gauge-studio.js` over the installed file on an
instance (HACS puts it at `/hacsfiles/gauge-studio/gauge-studio.js`) and
hard-refresh - and delete any `gauge-studio.js.gz` sitting next to it, because
Home Assistant serves the compressed sibling in preference and the instance
will keep running the old build however often you reload. Do not add a second
resource entry for a test build either, see the registration note below.

A hard refresh is not always enough on its own: Home Assistant registers a
service worker on `/`, which can keep serving the previous bundle for the
resource URL it already has. The cure is to repoint the existing resource to
the same file under a new query string (`/local/gauge-studio.js?v=2`) - still
one resource entry, just a URL the worker has never seen.

`package.json`'s `"version"` is **not** the version of record and has read
`1.0.0` across every release so far. The version is the git tag: `hacs.json`
names the card and the asset to install but carries no version of its own, so
HACS reads the tag. Do not bump the field expecting it to matter, and do not
trust it when identifying a build.

The project is MIT licensed - `LICENSE` at the root, and `"license": "MIT"` in
`package.json`. `docker/LICENSE` is a separate notice: the machinery under
`docker/` is adapted from another MIT project and reproduces its copyright as
that licence requires. `LICENSES/lucide.txt` is a third: the editor's icons
are Lucide, inlined into `src/icons.js`, and ISC asks for the same. An icon
added from another set needs its notice added there in the same change.

`npm test` runs vitest. Almost nothing here is unit-tested, and that is not a
gap to close indiscriminately: the modules register custom elements and read
`window` at import time, so they cannot be imported in Node at all.

What *is* tested is the one thing worth it - `src/canvas-model.js`, the pure
layout migration, where a wrong number silently moves every element on
someone's dashboard. Files outside the `supercard-NN-*` naming are pure
helpers with no side effects, importable and testable; keep them that way, and
put new arithmetic there rather than inside a module.

For everything else, verify by building and driving the real components (see
*Verifying a change*).

There is no `tsconfig.json` - the project is typed through `jsconfig.json`, so
type-checking must name it explicitly. `npm run typecheck` does. A bare
`tsc --noEmit` or `npx tsc --noEmit` finds no project, prints the CLI help, and
checks nothing.

## Architecture

`src/index.js` imports every module in order; that order matters, because
`supercard-01-core.js` populates `window.SupercardUtils` and every other module
destructures from it at module scope.

The build entry is `src/index.js`. A new module has to be imported there or it
is simply absent from the bundle - nothing warns you.

Modules register themselves on `window.SupercardModules[name]` and implement any
subset of the `SupercardModule` contract in `src/types/global.d.ts`:
`update`, `onAfterRender`, `editorFields`, `renderCustomBlock`. The card renders
them in the fixed order in `moduleOrder` (`supercard-01-core.js`).

`supercard-10-debug.js` is **deliberately not imported**. It is a developer
panel for inspecting which modules loaded, kept out of the bundle for design
reasons. `moduleOrder` still lists `debug`, so adding the import to
`src/index.js` locally is all it takes to use it. Do not "fix" the missing
import.

Stacking is governed by the `SC_LAYERS` dictionary in `supercard-01-core.js`.
Use those constants; never write a bare `z-index` number.

### Component contracts

| Kind | Properties it receives |
|---|---|
| Renderer (`sc-progressbar`, `sc-gauge`) | `hass`, `config`, `globalEntities` (`sc-progressbar` also takes `rootConfig`) |
| Editor (`sc-*-editor`) | `hass`, `slot`, `commitFn` |

`slot` is `config.gauge_studio` - the card's own config sub-object, not the
Lovelace card config.

That key was `config.supercard` until the card was renamed. Dashboards written
before the rename still carry the old one, and `migrateSlotKey` in
`config-cleanup.js` translates it in `setConfig` - both of them, the card's and
the editor's. That is the only place either name is decided: read `slot`
everywhere else, and never add a second read path for the old key.

### Shared helpers - use these, do not re-implement

`window.SupercardUtils` (defined in `supercard-01-core.js`):

- `safeFloat(v, d)`
- `hexToRgb` / `rgbToHex`
- `toRgb(value, { resolveVars })` - **the** colour reader: `[r,g,b]` arrays,
  `#rgb`, `#rrggbb`, `rgb()`/`rgba()`
- `resolveVar(v)` - looks up a `var(--x)` against the document root
- `sampleGradient(stops, pct)`
- `getAvailableElements(slot)` - flat `{id: label}` target map, canvas
  surfaces included
- `listElements(slot)` - which gauges and bars a slot contains
- `resolveAlias(list, cfg, entityKey?, attrKey?)` - resolves entity/attribute
  through `global_entities`
- `withPatch(list, idx, key, value)` - immutable single-field edit
- `colorRow(value, onInput, opts)` / `colorField(label, ...)` - **the** colour
  control: swatch plus text, `hexOnly` where only `#rrggbb` will do
- `slider(value, onInput, opts)` / `sliderRow(label, ...)` / `sliderField(label, ...)`
  - the range control, beside its label or under it with the value read out
- `renderField(field, ctx)` / `renderFields(fields, ctx)` - one field of an
  editor's field array, and all of them; `ctx` is
  `{ entry, slot, hass, set(id, value) }`
- `editorStyles` / `formStyles` - the two shared editor stylesheets

Add a helper here as soon as a second module needs it, and extend
`SupercardUtilsApi` in `src/types/global.d.ts` in the same change.

`var()` deserves care: a `var()` handed straight to CSS keeps following the
theme. Only resolve one when you need a concrete number *now* (contrast maths,
gradient sampling). Resolving early freezes the current theme into the markup.

## Conventions

**Objects and elements.** A thing on the canvas is an **object** - a gauge, a
bar, a surface, the main icon. The pieces an object is drawn from are its
**elements** - a pointer, a centre point, a tick, a tick label, a pill. Both
used to be called elements, so "element" in the older code means two things a
line apart. Every word a user reads says object or element in the sense above,
and so do the docs; internal identifiers follow where they are touched anyway,
not as a sweep. The config key stays `elements` - it is written into people's
dashboards, and renaming it buys tidiness at the price of a migration carried
for years. See `docs/backlog.md`.

**Config reads.** `this._get(key, default)` in components that define it.
Never read `this.config[key]` directly when `_get` exists.

**Config writes are immutable.** Clone, change, commit - never mutate the live
config. Use `SC.withPatch(list, idx, key, value)`, or the editor's own
`this._set(list, idx, key, value)` where one exists.

**Committing from an editor.** Call `commitFn(key, value)`, or
`commitFn('__merge__', { ...several keys })`. The card's `_commit` merges
`__merge__` payloads into `config.gauge_studio` and fires `config-changed`.

`commitFn('__card__', { ...keys })` writes the **Lovelace card config** instead
of the slot, for the few settings that are Home Assistant's rather than ours -
`grid_options` is the only one so far. A key set to `undefined` is deleted.
Use it so a setting HA already owns stays one value in both editors; do not
mirror such a value into `config.gauge_studio`.

`commitFn('__batch__', [[key, value], ...])` applies several of those in one
commit. **One edit that has to touch both the card config and the slot must
use it**: `_commit` clones `this.config`, and Home Assistant writes that back
asynchronously, so two commits in the same tick silently lose the first.

**The card's height.** `getGridOptions()` reports `rows: "auto"` for a canvas
card and the fixed default for a row/cell one (`reportedRows`). A canvas has a
ratio, not a height, and the width needed to turn one into the other is a
layout result the card cannot see. When someone does set a row count, the
canvas letterboxes inside it - never `max-height`, which would keep the width
at 100% and break the ratio. See `docs/canvas-layout.md` §5.

**The card's shape.** `canvasFromGrid` turns `grid_options` (columns x rows)
into the canvas shape that box wants, so a migration reproduces the card that
is already on the dashboard instead of imposing a default. `gridColumnsToPx`
uses a *reference* section width, because a section's real width is a viewport
result; only the ratio against `gridRowsToPx` is used. `canvasFromBox` is the
same thing from a box that has been measured, which is what the card itself
can offer. The canvas editor sets columns and rows itself and reshapes the
canvas with `rescaleCanvas` when they change - but only on a user's edit,
never on render.

With auto height the shape is the user's: the canvas decides how tall the card
is, so a change of width says nothing about it and nothing is reshaped. Only a
card that has never been drawn on needs a shape from nowhere, and
`defaultShapeRows` is it - as near a square as whole rows allow, read against
the reference width so the same card is the same shape on every viewport. A
row count of the user's own means fixed rows, which is a height in pixels and
is matched against the *measured* width instead. That measurement is taken by
walking up out of the editor to the section being edited, so it has to be
*remembered*: Home Assistant's dialog renders one tab at a time, and a size
set in its Layout tab reaches an editor that is no longer in the document.
The snap grid is stored as a per cent of the canvas for the same reason - a
grid in units does not survive the next reshape. See §7.

**One gradient shape, one gradient editor.** A colour stop is
`{pos, color}` - `pos` in per cent, or on the entity's scale where a gauge
says so, and `null` for a colour nobody placed, which CSS then spreads
itself. `gradient-stops.js` holds the arithmetic and `<sc-gradient-stops>`
(`supercard-09-gradient-stops.js`) is the only editor for such a list: the
gauge's stops, a bar's gradient and a colour pattern's colours are all that
one element, told what its add button should say. Saved cards still carry the
older shapes - a gauge's `{value, color}`, a pattern's parallel `colors` and
`stops` - so readers go through `normalizeStops`, and `stripDeadConfig`
rewrites them on the next edit. Do not add a fourth stop editor, and do not
read a stop list without `normalizeStops`.

**One layout model.** The canvas is the only one. The rows-and-cells model it
replaced had its renderer and its editor removed in v2.1.0, but its
configurations are on people's dashboards, so `layout_rows` is still *read*:
`rows-compat.js` answers with the canvas those rows describe, in memory, once
per render, and `_drawnSlot` in the core hands that one answer to every module
so none of them sees two models. Nothing is written back - a Lovelace card
cannot persist its own config outside the editor - so the editor stages the
same canvas as an ordinary edit when it opens such a card. Do not add a second
read path for `layout_rows`. A card that never had a layout is migrated only
when there is nothing to arrange: `contentRowArranges` counts the elements the
canvas would hold, and one, or none, comes along on its own - the single
element fills the card exactly as the content row drew it. Several are stacked
into bands that nobody chose, which is a new arrangement however faithful the
contents, so that card keeps its offer and its button. See
`docs/canvas-layout.md` §3.

**One control, drawn once.** A colour is `SC.colorRow`/`SC.colorField` and a
range is `SC.slider`/`SC.sliderRow`/`SC.sliderField`, in every editor, whether
it is built from a field array or writes its own markup. Each of those used to
be written out per module, which is how the same setting ended up 50% wide in
one menu and 60% in the next, and the swatch three different sizes. A call site
passes only what genuinely differs (`width`, `hexOnly`, `int`, a debounced
`onText`); if a new one needs something else, add the option here rather than a
second copy of the control there.

**Editor styles.** Start from a shared stylesheet and add only what differs:

```js
static get styles() {
  return [SC.editorStyles, css`
    .row { gap: 8px; }          /* only the deltas */
  `];
}
```

Use `editorStyles` for pattern/card-list editors (the `ha-switch` look) -
colour, labels, glass, interaction - and `formStyles` for the config forms
(the hand-rolled `.toggle` look): core's two editors, the gauge and the bar.
The gauge and the bar are the same kind of form and look the same; the bar
used to start from the other stylesheet, which is the only reason they ever
differed. Do not paste a full stylesheet into a new module.

**Field visibility.** A predicate on the field definition:

```js
{ id: 'value_color', label: 'Value colour', type: 'color',
  condition: cfg => cfg.show_value && isLin(cfg) }
```

The predicate is called `(entry, slot)`, so a field can also be hidden by
something about the card rather than the entry - `condition: (cfg, slot) =>
!slot?.canvas` is how the gauge's size controls disappear on a canvas, where
the element's box is the size. Ignore the second argument when you do not need
it; all three call sites pass it.

**Custom element registration is global and single-shot.** Always guard:

```js
if (!customElements.get('sc-thing')) customElements.define('sc-thing', ScThing);
```

Two builds of the card cannot coexist on one page - the first one loaded wins.
To test a build, repoint the existing Home Assistant resource entry rather than
adding a second one.

**Comments explain why, not what.** The code says what it does. Reserve a
comment for the reason a non-obvious choice was made - a performance
constraint, a browser quirk, an invariant that is not visible locally.

## Where the code still differs from itself

The codebase grew over time and under several hands, so competing patterns for
the same job used to sit side by side. The commit path, the expansion-state
name and the field-visibility mechanism have since been unified - the
*Conventions* above are what the code does, not an aspiration. Do not
reintroduce a second way of doing any of them.

One split remains, and it is intentional: the target lists. `SC.listElements`
answers which gauges and bars exist; each editor formats that answer its own
way, because they genuinely differ - `SC.getAvailableElements` is a flat
`{id: label}` map for colour/fx-glass/interaction, while `getLayoutTargets` in
layout groups them and adds four sub-targets per label.

One larger thing is **deliberately** not unified, because the cost outweighs
the gain:

- **The two editor look-and-feels.** `editorStyles` and `formStyles` are
  genuinely different visual languages. Merging them is a product decision.

**One editor architecture.** An editor is a field array: a field is a record -
`{ id, label, type }` plus what its type needs - and `SC.renderField` turns it
into a control. Every editor of a list is written that way - the gauge, the
bar, labels, interaction, colour and the glass. The canvas editor is not a
list of fields at all and stays as it is. Do not add a hand-written field to
an editor that has a field array, and do not invent a second renderer: a block
that is not a field - a preview, a picker grid, a datalist - is
`type: 'custom'` and hands the markup back through `render(ctx)`.

**Settings that the drawing expresses belong on the drawing**, and the form
has to let go of them in the same change. `field.framedBy` names the part whose
frame replaces a field, and the field disappears while that part is framed;
`field.framedWhen` is its mirror, the line that stands in for what has gone, so
a fold that has lost most of its rows does not read as one that is missing
something. Both are in `SC.renderField`, so every field array has them, and a
`framedBy` may be a function of the entry where whether a setting is on the
drawing depends on the entry. Two live controls for one value is worse than one
badly placed control.

Which elements can be worked on that way is `INNER_KINDS` in
`supercard-04-layout.js`: a kind says where its config lives, which parts it
has, how its drawing is measured, and which editor holds its settings, and
nothing else in the canvas editor knows one kind from another. A new kind is an
entry there, not a second copy of the frames, the chips and the numbers.
`docs/canvas-editing.md` is the guide to the rest of it: what may be a control
on a canvas, the hit-testing and stacking rules, how the zoom belongs to the
mode, why a corner grip does the arithmetic it does, and how to know any of it
works.

A folded section is `type: 'details'`, drawn the same everywhere - the gauge
and the bar build theirs from a `'section'` field instead, because their own
renderers split a flat list into sections, but the fold looks the same. Every
section heading opens with an icon, which is what makes a folded list readable
at a glance; the gauge's and the bar's keep the `── ` prefix on the label, a
marker their renderers strip before drawing.

**Icons are `src/icons.js`, never a character.** `icon('name')` gives back the
drawing, sized by the font size beside it and coloured by `currentColor`, and
`field.icon` is where a heading's goes - beside the label, not inside it, so
the label stays a string for the fold to be keyed by. A `::before` cannot hold
an element, so the two badges on the canvas use `iconMask` instead. Do not
reach for a Unicode glyph or an emoji: they were what the set replaced, and
one of them back in a row of icons is the thing that made the old menus look
assembled rather than drawn.

## Performance

Progress bars are the hot path: many can animate at once, and the cost is
layout/paint, not JS. Two things dominate and are already gated - keep them
gated:

- `backdrop-filter` re-samples and re-blurs the backdrop every frame. It is only
  visible through a translucent pill; skip it when the pill is opaque.
- `filter: url(#sc-goo-filter)` re-rasterises the whole fill layer every frame.
  Only apply it when there is actually a pill to merge into the fill.

A lens - `backdrop-filter: url(#...)` over an `feDisplacementMap` - is not a
third expensive thing. Measured on the demo at 120 Hz: 16 refracting gauge
panes cost 119.3 fps against 119.9 with no glass at all, and 12 bars with
refracting pills cost nothing against the same bars with a flat dark pill.
What does cost is *stacking* it on a blur: 16 panes doing both fell to 118.8
fps with a p99 of 16.0 ms, because the pane then re-samples the backdrop
twice. The gate is the same one the blur already has - an opaque pane bends
nothing, so it gets no filter.

The map behind that lens is a 64x64 bitmap drawn once per profile, not a
stack of gradients, and it carries both axes in one image - so the filter is
one `feImage` and one `feDisplacementMap`, with nothing to composite. Keep it
that way: the field is smooth, and a bigger map buys nothing that bilinear
scaling does not already give.

A pane's `backdrop-filter` is also why the editor dialog flickers, and that
one is not a cost but a correctness bug in the browser: for content in the
top layer the backdrop root is the whole document, and Chromium sometimes
presents the intermediate render without the top layer - the dialog and its
dimming vanish for one to three frames and you see the dashboard through the
editor. Measured with a per-frame recorder on the demo: in the second before
each sighting there was not one DOM mutation anywhere, no long task, and a
steady 114-120 fps, so nothing this card renders causes it. Glass everywhere:
5 sightings. Glass nowhere: 0 in 7.0 min. Glass only inside the dialog: 0 in
6.2 min.

`glass-suspend.js` is that last line: every `backdrop-filter` this card
writes goes through `var(--sc-glass-suspend, ...)`, and one watcher per page
sets the property to `none` on the document root while a modal dialog is
open, exempting the dialog itself with `initial`. Do not inline a
`backdrop-filter` past that wrapper, and do not "simplify" the watcher away -
the flicker comes back, and it comes back only sporadically, which is the
worst way for a bug to come back.

Before claiming a rendering change is faster, measure it. Frame budget is
1000/refresh-rate ms - 8.3 ms on a 120 Hz display, not 16.6.

## Verifying a change

There is no test suite, so behaviour-preserving refactors are verified by
comparing against the previous build:

1. Build the current `HEAD` in a git worktree, and the working tree as usual.
2. Load both bundles in a page that instantiates every editor and renderer with
   a fixed synthetic `hass` and config.
3. Compare `shadowRoot.innerHTML` byte for byte, and compare what each editor
   commits when every control in it is driven.

Normalise the three known sources of nondeterminism first: lit's per-load
marker ids (`lit$<digits>$`), the per-instance random SVG filter ids, and
fx-glass's keyframe names, which carry a random suffix per pattern
(`sc-glass-awake-<pattern id>-<random>`). Freeze animations
(`animation_duration: 0`) or the snapshot catches a bar mid-flight.

All three are per-load, so they differ between two runs of the *same* build.
If a comparison shows a handful of differences that are equal in number and
position and differ only in an id, look for a fourth such source before
reading it as a behaviour change.

That comparison covers rendering and committed values. It cannot cover the
editor inside HA's config dialog, drag and drop, or whether an animation looks
smooth - for those, `npm run ha` and click.

When you replace one pure mechanism with another - a visibility rule, a
formatter - do not just eyeball the translation. Run both side by side in the
build, over configurations that include the adversarial values (`undefined`,
`null`, `''`, `0`, `1`, `'true'`, `'false'`), and assert they never disagree
before deleting the old one. That is how the `showIf` to `condition` move was
done, and it caught two silent behaviour changes that reading the diff did
not.

## Releasing

**HACS installs from tags, not from `main`.** Pushing a `v*.*.*` tag fires
`.github/workflows/release.yml`, which builds `dist/gauge-studio.js` and publishes
a GitHub release - live, immediately, to everyone who has the card installed.

Never commit, push, or tag on your own initiative. Build locally, report what
you found, and wait for an explicit go-ahead.

The release body is the **annotated tag's message**, with GitHub's generated
notes appended under a rule. So write the tag message for users:
`git tag -a vX.Y.Z -m "..."`. A lightweight tag yields no intro - the workflow
guards against falling back to the commit message.

**Release notes are written in English**, whatever language the work was
discussed in - the tag message and the release body both. v2.1.7 to v2.2.1 were
written in German by following the previous release's language; their release
bodies have since been translated back, but the tag messages those bodies came
from are still German, because force-pushing a tag re-fires the release
workflow and ships a new build to everyone.

`dist/` is gitignored; the release workflow builds it. Never commit build output.
