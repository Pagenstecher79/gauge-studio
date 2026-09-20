import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { compactCssPlugin, minifyBundle } from './build/slim-bundle.js';

// Written by the editor build, which npm runs first. Its name carries a
// content hash, and `getConfigElement` imports exactly that file.
let editorChunk;
try {
  editorChunk = readFileSync('dist/.editor-chunk', 'utf8').trim();
} catch {
  throw new Error(
    'The editor bundle has not been built. This build writes its name into ' +
    'the card, so the two go together: run `npm run build` (or `npm run ' +
    'watch`), not `vite build` on its own.');
}

export default defineConfig({
  // Vite leaves an `es` library unminified on the assumption that something
  // downstream will bundle it again; Home Assistant serves this file to the
  // browser as it is. See `build/slim-bundle.js`.
  plugins: [compactCssPlugin(), minifyBundle()],
  define: {
    // The only place the editor bundle is named. See `docs/editor-split.md`.
    __SC_EDITOR_CHUNK__: JSON.stringify(editorChunk),
  },
  build: {
    lib: {
      entry: './src/index.js',
      name: 'GaugeStudio',
      fileName: 'gauge-studio',
      formats: ['es']
    },
    outDir: 'dist',
    // The editor build ran first and cleared the directory; clearing it again
    // would delete the file this one imports.
    emptyOutDir: false,
    rollupOptions: {
      // The editor is a build of its own, so there is nothing here to resolve:
      // the name is a file beside this one at runtime, not a module to pull in.
      external: [`./${editorChunk}`]
    }
  }
});
