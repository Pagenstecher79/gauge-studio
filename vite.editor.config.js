import { writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { compactCssPlugin, minifyBundle } from './build/slim-bundle.js';

/**
 * The editor bundle, built on its own and before the card.
 *
 * On its own, and not as a dynamic chunk of the card's build, because a chunk
 * would import the shared modules back out of `gauge-studio.js` by that bare
 * name - and the card is never loaded under that name. Home Assistant serves
 * it as `/local/gauge-studio.js?v=...` and HACS as `?hacstag=...`, so the
 * import would resolve to a URL the browser has not seen, fetch the whole card
 * a second time and run a second copy of every module in it.
 *
 * Two builds mean the helpers both halves use are written into both files.
 * Measured at about 40 kB, all of it on the editor's side, which the dashboard
 * never fetches - against 183 kB fetched twice, which it would.
 *
 * The name carries a content hash, and the card's build reads it from
 * `dist/.editor-chunk` to know what to import. Only the *resource* URL gets a
 * cache buster - HACS appends `?hacstag=`, the dev instance `?v=` - so a file
 * the card fetches itself has to carry its own, or `/hacsfiles/` and
 * `/local/`, both served with a month of `Cache-Control`, would go on handing
 * out last month's editor.
 */
export default defineConfig({
  plugins: [
    compactCssPlugin(),
    minifyBundle(),
    {
      name: 'sc-name-the-editor-chunk',
      writeBundle(_options, bundle) {
        const entry = Object.values(bundle).find(
          (/** @type {any} */ f) => f.type === 'chunk' && f.isEntry);
        if (entry) writeFileSync('dist/.editor-chunk', entry.fileName);
      },
    },
  ],
  build: {
    lib: {
      entry: './src/editor.js',
      name: 'GaugeStudioEditor',
      formats: ['es'],
    },
    outDir: 'dist',
    // First of the two builds, so this is the one that clears the directory.
    emptyOutDir: true,
    rollupOptions: {
      preserveEntrySignatures: false,
      output: { entryFileNames: 'gauge-studio-editor-[hash].js' },
    },
  },
});
