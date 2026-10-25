# Gauge, Progressbar, Custom Card Studio

A custom Lovelace card for Home Assistant: gauges and progress bars, arranged in
a grid, configured entirely in the visual card editor.

Vanilla JS + LitElement, no framework, no transpile step beyond Vite's bundling.

## Commands

```bash
npm run build      # src/index.js + src/editor.js -> dist/ (Vite lib mode)
npm run watch      # same, rebuilding on change
npm run typecheck  # tsc -p jsconfig.json --noEmit   (NOT `npx tsc`, see below)
npm run ha         # real Home Assistant in Docker (docker/README.md)
```

**The build does its own minifying**, in `build/slim-bundle.js`. Vite turns
esbuild's whitespace pass off for an `es` library on the assumption that
something downstream will bundle it again; Home Assistant serves the file as
it is, so the card used to ship its indentation, its method names and 117 kB
of comments. One plugin runs that pass, and a second compacts the inside of
every ``css` `` literal, which esbuild does not look into at all. Together:
857 kB to 564 kB, 232 kB to 157 kB gzipped. Two things follow. A new
``css` `` literal is compacted like every other, so do not hand-minify one -
write it readably. And an ``html` `` literal is *not* touched, because a
space between two text nodes is a space between two words.

**The build makes two files**, and a dashboard fetches one of them:
`dist/gauge-studio.js` is the card, 159 kB, and
`dist/gauge-studio-editor-<hash>.js` is everything that configures it, 431 kB,
fetched by `getConfigElement()` the first time somebody opens the settings.
They are two *builds*, editor first - `npm run build` runs both, and the
editor's build writes its own hashed name into `dist/.editor-chunk` for the
card's build to import. Not one build with two chunks: Rollup would have the
editor chunk import the card back as `./gauge-studio.js`, a name under which
Home Assistant never serves it, and the whole card would load twice. `npm run
watch` rebuilds both for the same reason; a bare `vite build` now refuses.
The hash is in the name because only the *resource* URL carries a cache
buster. A manual install copies both files, and so does HACS - every asset
of the release lands in the card's directory. See
`docs/editor-split.md`, and the two-stage registration under *Architecture*.

**Testing happens in that one Docker instance, at <http://192.168.2.150:8123/>**
- on the Mac mini M2 Pro in the LAN (`ssh m2`), which is where server services
are being moved one by one and where LM Studio already runs. The build still
happens here; `docker/.remote` (gitignored, see `docker/remote.mjs`) points
`postbuild` at that host, so `npm run build` ships `dist/` there and restarts
the container, and `npm run ha` refuses to start a local one. The local
`docker/config` is left over from before the move and serves only as staging
for the resource entry - the dashboards being edited are the ones on the M2.
One is enough and one is all there should be: a second container, a second
host, a second port or a second browser profile splits the dashboards, the
storage and the resource entry, and then a build that works in one and not
the other says nothing about the card. `npm run build` restarts the container
onto the new bundle, so the address stays the same from one build to the
next - open it and reload rather than looking for a fresh URL. Should the
instance ever move again, it moves whole - stop the old one in the same step.
Synthetic pages under `.claude/bench/` stay what they are: a place to measure
one mechanism in isolation, never the proof that the card works.

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

**Every module is two modules.** `supercard-NN-thing.js` draws and
`supercard-NN-thing-editor.js` configures, and they are bundled separately:
`src/index.js` imports the first kind, `src/editor.js` the second, and
`getConfigElement()` in `supercard-01-core.js` is the only place the editor
bundle is named. A new module has to be imported in the entry that matches its
half or it is simply absent - nothing warns you. See `docs/editor-split.md`.

Both entries import their modules in order, and that order matters, because
`supercard-01-core.js` populates `window.SupercardUtils` and every other module
destructures from it at module scope.

Modules register themselves on `window.SupercardModules[name]` and implement any
subset of the `SupercardModule` contract in `src/types/global.d.ts`. The split
is exactly that contract: **`update` and `onAfterRender` belong to the runtime
half, `editorFields`, `renderCustomBlock`, `newEntry`, `formFields` and
`ownedByCanvas` to the editor half.** Both halves `Object.assign` onto an entry
created with `|| {}`, so neither cares which loaded first. The card renders
them in the fixed order in `moduleOrder` (`supercard-01-core-editor.js`).

So a renderer must never read an editor helper - it would work in the editor,
where both halves are loaded, and be `undefined` on a dashboard. Put a helper
both halves need in a pure module of its own (`item-typography.js` is one), not
in either half.

`supercard-10-debug.js` is **deliberately not imported**. It is a developer
panel for inspecting which modules loaded, kept out of the bundle for design
reasons. `moduleOrder` still lists `debug`, so adding the import to
`src/editor.js` locally is all it takes to use it. Do not "fix" the missing
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

`window.SupercardUtils`, which is two halves of one object: the runtime one in
`supercard-01-core.js`, always there, and the editor's - every control, both
stylesheets - in `supercard-01-core-editor.js`, there only once the editor
bundle has loaded. The types say which is which (`SupercardUtilsRuntime` /
`SupercardUtilsEditor`):

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

**Canvas height, shape, gradients, layout model:** skill `gauge-studio-canvas`

**One control, drawn once.** A colour is `SC.colorRow`/`SC.colorField` and a
range is `SC.slider`/`SC.sliderRow`/`SC.sliderField`, in every editor, whether
it is built from a field array or writes its own markup. Each of those used to
be written out per module, which is how the same setting ended up 50% wide in
one menu and 60% in the next, and the swatch three different sizes. A call site
passes only what genuinely differs (`width`, `hexOnly`, `int`, a debounced
`onText`); if a new one needs something else, add the option here rather than a
second copy of the control there.

A `select`'s list is `SC.fieldOptions(field, entry, ctx)` for the same reason.
It may be a list or a function of the entry, and three editors read the key
straight - so the first field that answered with a function threw a `.map` on
a function inside a render, and a throw in a render takes the whole editor
with it: the menus below the canvas stopped opening, in a way that named
neither the field nor the editor. One reader, everywhere.

**One list reorder, and it answers a finger.** A list with a grip is
reordered through `ListReorder` (`list-reorder.js`): `pointerdown` on the
grip, pointer capture, the row under the pointer is where it lands, and
`indexAtY` is the whole of the arithmetic. The grip needs `touch-action:
none`, or the browser takes the gesture for a scroll before the first move
arrives and the dialog slides away under the hand. Do not reach for HTML5
drag and drop - `draggable` armed on `mousedown` is what five of these
editors did, and it answers a mouse and nothing else, so a dashboard edited
on a tablet could not be reordered at all. Where a list is filtered before it
is drawn - the glass editor hides what has its own switch - the controller
speaks in rows on the screen and the host translates to the stored list; a
position is not an index.

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

**Settings on the drawing, `INNER_KINDS`, folds:** skill `gauge-studio-canvas`; guide in `docs/canvas-editing.md`.

**Icons are `src/icons.js`, never a character.** `icon('name')` gives back the
drawing, sized by the font size beside it and coloured by `currentColor`, and
`field.icon` is where a heading's goes - beside the label, not inside it, so
the label stays a string for the fold to be keyed by. A `::before` cannot hold
an element, so the two badges on the canvas use `iconMask` instead. Do not
reach for a Unicode glyph or an emoji: they were what the set replaced, and
one of them back in a row of icons is the thing that made the old menus look
assembled rather than drawn.

## Performance

Progress bars are the hot path; keep `backdrop-filter` and the goo filter gated, and every `backdrop-filter` through `var(--sc-glass-suspend, ...)`. Details and measurements: skill `gauge-studio-performance`.

## Verifying a change

No test suite beyond `canvas-model.js`: compare against the previous build. Procedure: skill `gauge-studio-pruefen`; taste questions: skill `bench-stufen`.

## Releasing

Never commit build output; never tag without an explicit go-ahead.
Everything else (HACS tags, beta channel, English notes, hacs.json traps):
skill `gauge-studio-release` - load it before any tag or release.
