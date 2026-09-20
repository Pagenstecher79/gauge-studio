// The card as a dashboard draws it. Every module here is a renderer: nothing
// in this bundle knows what an editor looks like.
//
// The editor half is `editor.js`, fetched by `getConfigElement()` the first
// time someone opens the card's settings. See `docs/editor-split.md`.
import './supercard-01-core.js';
import './supercard-02-color.js';
import './supercard-03-progressbar.js';
import './supercard-04-layout.js';
import './supercard-05-gauge.js';
import './supercard-06-labels.js';
import './supercard-07-fx-glass.js';
import './supercard-08-interaction.js';
