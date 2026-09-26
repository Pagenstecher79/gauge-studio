// The card's editor, and nothing a dashboard needs to draw one.
//
// Loaded on demand from `getConfigElement()` in `supercard-01-core.js`, so a
// dashboard that only shows cards never fetches any of it. Every module here
// adds its `editorFields` / `renderCustomBlock` to the entry its runtime half
// already registered on `window.SupercardModules`.
//
// Core first: it carries the other half of `window.SupercardUtils` - every
// control and both stylesheets - which every editor below draws with.
import './supercard-01-core-editor.js';
// Defines <sc-gradient-stops>, which every editor below uses; no module of
// its own, so it sits after core and before the first editor that wants it.
import './supercard-09-gradient-stops.js';
import './supercard-02-color-editor.js';
import './supercard-03-progressbar-editor.js';
import './supercard-04-layout-editor.js';
import './supercard-05-gauge-editor.js';
import './supercard-06-labels-editor.js';
import './supercard-07-fx-glass-editor.js';
import './supercard-08-interaction-editor.js';
// After the glass editor: that is where <sc-shadow-pad> is defined, and the
// card's own light is the one control that uses it now.
import './supercard-11-light-editor.js';
