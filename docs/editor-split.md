# Two bundles: the card, and its editor

A dashboard draws cards. It opens an editor perhaps once a month, and then
for one card. Until v2.5.0 every dashboard that drew this card fetched the
whole of it - and 64 % of that was editor: field arrays, forms, the canvas
editor and both editor stylesheets, none of which draws anything.

Now there are two files.

| File | What it is | Fetched |
|---|---|---|
| `gauge-studio.js` | the card as a dashboard draws it | always, 159 kB (50 kB gzipped) |
| `gauge-studio-editor-<hash>.js` | everything that configures it | the first time someone opens the settings, 431 kB |

Against 564 kB (157 kB gzipped) before: a dashboard now fetches 28 % of what
it used to.

## How a module is two modules

`src/index.js` imports the runtime halves, `src/editor.js` the editor halves,
and `getConfigElement()` in `supercard-01-core.js` is the only place the
second is named:

```js
static async getConfigElement() {
  await import(/* @vite-ignore */ './' + __SC_EDITOR_CHUNK__);
  return document.createElement('supercard-modular-editor');
}
```

Home Assistant awaits that call already, so nothing else had to change for it.

## Why two builds and not one build with two chunks

`__SC_EDITOR_CHUNK__` is written in at build time, from `dist/.editor-chunk`,
which the editor build leaves behind. Two builds, run in that order - the
editor first, so the card knows its name - and they share no module.

A single build with a dynamic import would be the obvious thing, and it is
wrong here. Rollup would hoist what both halves use into the entry chunk and
have the editor chunk import it back by its bare name, `./gauge-studio.js`.
The card is never loaded under that name: Home Assistant serves it as
`/local/gauge-studio.js?v=...` and HACS as `/hacsfiles/.../gauge-studio.js?hacstag=...`.
A specifier relative to the *editor* chunk carries no query, so it resolves to
a URL the browser has not seen, and the whole card is fetched and evaluated a
second time - a second `watchModalSuspend` watcher, every module registered
twice, 159 kB fetched for nothing.

The price of two builds is that the modules both halves use are written into
both files. Measured at about 23 kB, all of it on the editor's side, which a
dashboard never fetches.

Registration on `window.SupercardModules` is therefore **two-stage**. The
runtime half registers what the card renders with:

```js
window.SupercardModules['labels'] = window.SupercardModules['labels'] || {};
Object.assign(window.SupercardModules['labels'], (() => {
  function update({ hass, config }) { /* ... */ }
  return /** @type {SupercardModule} */ ({ update });
})());
```

and the editor half adds what the editor asks for - `editorFields`,
`renderCustomBlock`, `newEntry`, `formFields`, `ownedByCanvas` - onto the same
object. Both are `Object.assign` onto an entry created with `|| {}`, so
neither cares which loaded first, and every key of the `SupercardModule`
contract is optional. The split is exactly the contract: **`update` and
`onAfterRender` are the card's, everything else is the editor's**, and nothing
outside an editor reads the rest.

`window.SupercardUtils` is split the same way, and that is the one place where
the order does matter. `supercard-01-core.js` builds the runtime half -
`safeFloat`, `toRgb`, `listElements`, `partHighlight` - and
`supercard-01-core-editor.js` assigns the other half onto the same object:
every control (`colorRow`, `slider`, `renderField`) and both editor
stylesheets. The types say so too: `SupercardUtilsRuntime` and
`SupercardUtilsEditor` in `src/types/global.d.ts`, with `SupercardUtilsApi`
their intersection, because a call site only ever runs once its own half is
there.

**So a renderer must never read an editor helper.** It would work in the
editor, where both halves are loaded, and be `undefined` on a dashboard.
`SC.partHighlight` is the one that looks like an editor thing and is not: the
attribute is set by the canvas editor, but the stylesheet has to be adopted by
the renderer, because only a renderer's own shadow root can reach its parts.

One helper is genuinely shared and belongs to neither: `item-typography.js`,
which the card puts on the slot it draws an element into and the canvas editor
puts on the box it previews that element in. A pure module of its own, the way
every shared helper here is.

## Why the chunk's name carries a hash

Only the *resource* URL gets a cache buster: HACS appends `?hacstag=`, the dev
instance appends `?v=<hash>`. A file the card fetches itself gets neither, and
both `/hacsfiles/` and `/local/` are served with a month of `Cache-Control`.
At a fixed name an updated card would go on running last month's editor
against this month's renderers, and say nothing about it. With the content
hash in the name there is nothing to invalidate - a changed editor is a new
URL.

## Why HACS needs no zip, and must not have one

`hacs.json` says `filename: gauge-studio.js` and nothing else. That one key
does two jobs in HACS: `update_filenames()` makes it `data.file_name`, and
`generate_dashboard_resource_url()` builds the Lovelace resource from
`data.file_name`. So `filename` is the file a dashboard loads as a module.

`zip_release` uses the same key for the asset to fetch and unzip, and there is
no second key for the resource name. Setting both is what v2.5.0 did, and HACS
duly registered `/hacsfiles/gauge-studio/gauge-studio.zip` as a JavaScript
module. The card was dead on every dashboard that updated; v2.5.1 is the fix.

Two files need no zip. Without `content_in_root`, `download_content` takes
`release_contents` - every asset of the release - and downloads all of them
into the card's directory. So the editor chunk arrives beside the card on its
own, and the resource points at the card.

A manual install copies the same **both** files, side by side. The card alone
is a card whose editor 404s.

## Verifying it

The two-build comparison in `CLAUDE.md` still applies, with one change: the
new build is two files, so the harness page imports both. What it cannot show
is the lazy path itself - that the card draws before the editor exists, and
that the editor bundle arrives when the dialog opens. `.claude/bench/lazy-editor.html`
is that check: it loads the runtime bundle alone, draws a card, asserts that
`window.SupercardUtils.colorRow` is still `undefined` and that every module
carries only `update`/`onAfterRender`, then awaits `getConfigElement()` and
asserts the other half is there. It also counts resource fetches, because the
failure the two builds exist to prevent is silent: the card still works, it is
merely there twice.

`.claude/bench/lazy-query.html` is the same check under a cache-busting URL -
`sc-runtime.js?v=deadbeef12`, the shape Home Assistant actually serves - and
asserts the runtime is still fetched exactly once.
