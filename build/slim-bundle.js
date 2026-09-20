/**
 * The minification Vite leaves out.
 *
 * Vite builds this card as a library in `es` format, and for that shape it
 * turns esbuild's whitespace minification off on purpose - the assumption
 * being that whoever consumes the library will bundle it again and do that
 * pass themselves. Home Assistant does not: the file it is handed is the file
 * it serves to the browser. esbuild ties comment removal to that same switch,
 * so the card shipped 117 kB of prose to every dashboard that drew it, and
 * the bundle was 857 kB where 618 kB says the same thing.
 *
 * Identifiers are safe to rename here: nothing in `src` reads a function's or
 * a class's `name`, and every custom element is registered by a string.
 * Property names esbuild never touches by default, so the module contract in
 * `src/types/global.d.ts` survives whole.
 */

import { transform } from 'esbuild';

/** @returns {import('vite').Plugin} */
export function minifyBundle() {
  return {
    name: 'sc-minify-bundle',
    enforce: 'post',
    apply: 'build',
    // `generateBundle`, not `renderChunk`: Vite's own esbuild pass is a
    // renderChunk hook in the same 'post' bucket, and it re-prints whatever
    // it is handed with whitespace minification off - a chunk minified there
    // comes back out pretty, and the build looks like it did nothing.
    async generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue;
        const res = await transform(file.code, {
          minify: true, format: 'esm', target: 'es2020', legalComments: 'none',
        });
        file.code = res.code;
      }
    },
  };
}
