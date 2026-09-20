import { defineConfig } from 'vite';
import { compactCssPlugin, minifyBundle } from './build/slim-bundle.js';

export default defineConfig({
  // Vite leaves an `es` library unminified on the assumption that something
  // downstream will bundle it again; Home Assistant serves this file to the
  // browser as it is. See `build/slim-bundle.js`.
  plugins: [compactCssPlugin(), minifyBundle()],
  build: {
    lib: {
      entry: './src/index.js',
      name: 'GaugeStudio',
      fileName: 'gauge-studio',
      formats: ['es']
    },
    outDir: 'dist',
    emptyOutDir: true
  }
});
