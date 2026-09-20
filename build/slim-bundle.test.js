import { describe, it, expect } from 'vitest';
import { compactCss, compactCssTemplates } from './slim-bundle.js';

describe('compactCss', () => {
  it('folds indentation into single spaces', () => {
    expect(compactCss('\n  .a {\n    color: red;\n  }\n')).toBe(' .a { color: red; } ');
  });

  it('drops comments', () => {
    expect(compactCss('.a { /* why */ color: red; }')).toBe('.a { color: red; }');
  });

  it('drops a comment that spans lines without joining the rules', () => {
    expect(compactCss('.a{}\n/* one\n   two */\n.b{}')).toBe('.a{} .b{}');
  });

  // A space in a selector is a combinator: `div :first-child` and
  // `div:first-child` match different elements.
  it('keeps the single space a descendant combinator is made of', () => {
    expect(compactCss('div :first-child { top: 0 }')).toBe('div :first-child { top: 0 }');
  });

  it('leaves the inside of a string alone', () => {
    expect(compactCss('.a::before { content: "  /* x */  "; }'))
      .toBe('.a::before { content: "  /* x */  "; }');
  });

  it('leaves an escaped quote inside a string alone', () => {
    expect(compactCss(`.a { content: '\\'  '; }`)).toBe(`.a { content: '\\'  '; }`);
  });
});

describe('compactCssTemplates', () => {
  it('rewrites a css literal and nothing around it', () => {
    const src = 'const x = 1;\nconst s = css`\n  .a {\n    color: red;\n  }\n`;\n';
    expect(compactCssTemplates(src)).toBe('const x = 1;\nconst s = css` .a { color: red; } `;\n');
  });

  it('copies an interpolation across untouched', () => {
    const src = 'css`\n  .a { top: calc(${ a + b }px  +  1px); }\n`';
    expect(compactCssTemplates(src)).toBe('css` .a { top: calc(${ a + b }px + 1px); } `');
  });

  it('copies a nested stylesheet across untouched', () => {
    const src = 'css`${SC.editorStyles}\n  .a {  top: 0 }\n`';
    expect(compactCssTemplates(src)).toBe('css`${SC.editorStyles} .a { top: 0 } `');
  });

  it('leaves an html literal as it was', () => {
    const src = 'html`\n  <b>  a  </b>\n`';
    expect(compactCssTemplates(src)).toBe(src);
  });

  it('is not fooled by a tag that ends in css', () => {
    const src = 'unsafeCSS`\n  a  b\n`';
    expect(compactCssTemplates(src)).toBe(src);
  });

  it('handles two literals in one file', () => {
    const src = 'css`  a  ` + css`  b  `';
    expect(compactCssTemplates(src)).toBe('css` a ` + css` b `');
  });
});
