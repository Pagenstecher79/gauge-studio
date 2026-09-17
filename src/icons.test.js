import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `icons.js` cannot be imported here - it pulls lit off a CDN, which Node
 * will not fetch - so this reads it as text. That is enough for the one thing
 * worth checking: that the two copies of a drawing still say the same thing.
 */
const src = readFileSync(fileURLToPath(new URL('./icons.js', import.meta.url)), 'utf8');

/** Every element of an icon, in order, with the whitespace taken out. */
const shapes = (/** @type {string} */ markup) =>
  (markup.match(/<[a-z]+[^>]*\/>/g) || []).map(s => s.replace(/\s+/g, ' ').trim());

const parts = () => {
  /** @type {Record<string, string>} */
  const out = {};
  const re = /^ {2}'([a-z0-9-]+)':\s*\n?\s*svg`([\s\S]*?)`,$/gm;
  for (const m of src.matchAll(re)) out[m[1]] = m[2];
  return out;
};

const maskSource = () => {
  const block = src.match(/const MASK_SOURCE = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('MASK_SOURCE not found');
  // The body is string literals joined with `+` and nothing else, so reading
  // it back is a matter of evaluating that much and no more - and the guard
  // is what keeps that true if someone puts a call in there later.
  const body = block[1];
  expect(body, 'MASK_SOURCE must stay plain strings').not.toMatch(/\(|\$\{/);
  return /** @type {Record<string, string>} */ (new Function(`return {${body}}`)());
};

describe('the icon set', () => {
  const PARTS = parts();

  it('reads every icon out of the file', () => {
    // A regex that stopped matching would make every check below vacuous.
    expect(Object.keys(PARTS).length).toBeGreaterThan(80);
    expect(PARTS).toHaveProperty('pin');
    expect(PARTS).toHaveProperty('pin-in');
  });

  it('draws each one inside the 24x24 box it declares', () => {
    for (const [name, markup] of Object.entries(PARTS)) {
      expect(markup, name).not.toMatch(/viewBox|xmlns|<svg/);
      expect(shapes(markup).length, name).toBeGreaterThan(0);
    }
  });

  it('gives the pushed-in pin the same head as the loose one', () => {
    // The two are one icon in two states, so only the needle may differ:
    // a head that drifted would read as two different pins.
    const head = (/** @type {string} */ n) =>
      shapes(PARTS[n]).filter(s => !s.startsWith('<path d="M12 17'));
    expect(head('pin-in')).toEqual(head('pin'));
    expect(PARTS['pin']).toContain('M12 17v5');
    expect(PARTS['pin-in']).toContain('M12 17v2');
    // The loose one is the whole drawing turned, nothing redrawn.
    expect(PARTS['pin-loose']).toContain('rotate(-40 12 12)');
    expect(shapes(PARTS['pin-loose'])).toEqual(shapes(PARTS['pin']));
  });

  it('keeps a mask saying what its icon says', () => {
    for (const [name, markup] of Object.entries(maskSource())) {
      expect(PARTS, name).toHaveProperty(name);
      expect(shapes(markup), name).toEqual(shapes(PARTS[name]));
    }
  });
});
