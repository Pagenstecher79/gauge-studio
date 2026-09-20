/**
 * Two build steps that take a third off the shipped bundle without moving a
 * line of the card.
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
 *
 * `compactCssPlugin` is the part esbuild cannot do at all. Nothing touches
 * the inside of a template literal, so every stylesheet this card writes went
 * out with its indentation and its comments - 34 kB in the canvas editor's
 * stylesheet alone, where two thirds of the block is prose. It runs over the
 * source, where a `css` tag is still spelled `css`, rather than over the
 * bundle, where it is a two-letter name and indistinguishable from `html`.
 */

import { transform } from 'esbuild';

/**
 * The end of the template literal that starts at `from` (the backtick).
 *
 * Counts `${...}` so a brace inside an interpolation does not end the scan,
 * and steps over escapes so a `\`` does not end the literal.
 *
 * @param {string} s
 * @param {number} from index of the opening backtick
 * @returns {number} index of the closing backtick, or `s.length`
 */
function endOfTemplate(s, from) {
  let depth = 0;
  for (let i = from + 1; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '$' && s[i + 1] === '{') { depth++; i++; continue; }
    if (ch === '}' && depth) { depth--; continue; }
    if (ch === '`' && !depth) return i;
  }
  return s.length;
}

/**
 * One stretch of CSS text with its comments removed and its whitespace
 * collapsed to single spaces.
 *
 * Quoted strings are stepped over whole: `content: "  "` means those spaces.
 * Nothing else is touched - in particular no space is removed from beside a
 * `:` or a `{`, because in a selector a space there is a combinator and
 * losing it changes which elements the rule matches.
 *
 * @param {string} css
 * @returns {string}
 */
export function compactCss(css) {
  let out = '';
  // A space is only ever written where there is not one already, so a
  // comment that sat on its own line between two rules leaves one space
  // behind rather than the three its surrounding newlines would give.
  //
  // A leading one is written too, though it looks like waste: this runs over
  // one stretch between two interpolations at a time, and `${a} ${b}` is two
  // values with a space between them that closing it up would make one.
  const space = () => { if (!out.endsWith(' ')) out += ' '; };
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      let j = i + 1;
      while (j < css.length && css[j] !== q) { if (css[j] === '\\') j++; j++; }
      out += css.slice(i, Math.min(j + 1, css.length));
      i = j;
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 1;
      // A space, not nothing: a comment separates the tokens on either side
      // of it, and `wid/**/th` is not `width`.
      space();
      continue;
    }
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
      space();
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Every ``css`...` `` literal in a module, compacted.
 *
 * The interpolations are copied across untouched: one of them is a whole
 * nested stylesheet (`${SC.editorStyles}`) and another is a number that has
 * to keep its own spacing inside a `calc()`.
 *
 * @param {string} code
 * @returns {string}
 */
export function compactCssTemplates(code) {
  let out = '';
  let at = 0;
  const re = /(^|[^\w$.])css`/g;
  let m;
  while ((m = re.exec(code))) {
    const open = m.index + m[0].length - 1;
    const close = endOfTemplate(code, open);
    out += code.slice(at, open + 1);
    const body = code.slice(open + 1, close);
    // Split on interpolations so only the literal parts are rewritten.
    let k = 0;
    while (k < body.length) {
      const hole = body.indexOf('${', k);
      if (hole === -1) { out += compactCss(body.slice(k)); break; }
      out += compactCss(body.slice(k, hole));
      let depth = 1;
      let j = hole + 2;
      for (; j < body.length && depth; j++) {
        if (body[j] === '{') depth++;
        else if (body[j] === '}') depth--;
      }
      out += body.slice(hole, j);
      k = j;
    }
    out += '`';
    at = close + 1;
    re.lastIndex = at;
  }
  return out + code.slice(at);
}

/** @returns {import('vite').Plugin} */
export function compactCssPlugin() {
  return {
    name: 'sc-compact-css',
    enforce: 'pre',
    // Only when building the card. Vitest reads this same config, and the
    // rewrite has no business running over a test file - least of all over
    // this one, which carries `css` templates as test data.
    apply: 'build',
    transform(code, id) {
      if (!/\/src\/[^/]+\.js$/.test(id) || /\.test\.js$/.test(id)) return null;
      if (!code.includes('css`')) return null;
      return { code: compactCssTemplates(code), map: null };
    },
  };
}

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
