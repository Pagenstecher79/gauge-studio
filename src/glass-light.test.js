import { describe, it, expect } from 'vitest';
import { lightParams, bevelShadow, px, isRoundTarget, isReliefTarget, reliefPattern, reliefShadow, reliefLayers, boxRingMask, isCircleRadius } from './glass-light.js';

/**
 * The formula exactly as it stood inside fx-glass before it moved here.
 *
 * Kept verbatim rather than rewritten: the point of this test is that the
 * move changed nothing, and a reference tidied up on the way over would only
 * prove that two tidied versions agree.
 */
function before(pat, u) {
  const shadowStyle = pat.shadow_style || 'frosted';
  const bWidth = pat.bevel_width ?? pat.bevel_size ?? 2;
  const gThick = pat.glass_thickness ?? 5;
  const lBright = pat.light_brightness ?? 0.4;
  const sAngle = pat.shadow_angle ?? 90;
  const sDist = pat.shadow_distance ?? 1;
  const sRad = sAngle * Math.PI / 180;
  const shadowX = sDist * Math.cos(sRad);
  const shadowY = sDist * Math.sin(sRad);
  const lightX = -shadowX;
  const lightY = -shadowY;
  const steepness = gThick / (bWidth > 0 ? bWidth : 1);
  const edgeLight = Math.min(1, lBright * (1 + steepness * 0.4));
  const edgeShadow = Math.min(1, (lBright * 0.5) * (1 + steepness * 0.4));

  let mainShadow = 'none';
  if (shadowStyle === 'frosted') {
    const s1 = bWidth - 0.5 < 0 ? 0 : bWidth - 0.5;
    mainShadow = `
      inset ${u(lightX * s1)} ${u(lightY * s1)} ${u(bWidth)} 0px rgba(255, 255, 255, ${edgeLight}),
      inset ${u(shadowX * bWidth)} ${u(shadowY * bWidth)} ${u(bWidth + 1)} 0px rgba(0, 0, 0, ${edgeShadow * 0.5}),
      inset 0 0 0 ${u(bWidth)} rgba(255, 255, 255, 0.05)
    `;
  } else if (shadowStyle === 'liquid') {
    mainShadow = `
      inset ${u(lightX * bWidth)} ${u(lightY * bWidth)} ${u(bWidth)} rgba(255,255,255,${edgeLight * 0.6}),
      inset ${u(shadowX * bWidth)} ${u(shadowY * bWidth)} ${u(bWidth)} rgba(0,0,0,${edgeShadow * 0.4}),
      inset ${u(lightX * (bWidth + 1))} ${u(lightY * (bWidth + 1))} ${u(1)} rgba(255,255,255,${edgeLight}),
      inset ${u(shadowX * (bWidth + 1))} ${u(shadowY * (bWidth + 1))} ${u(1)} rgba(0,0,0,${edgeShadow})
    `;
  }
  return mainShadow;
}

/** Only the whitespace differs by design, and CSS cannot tell. */
const flat = s => s.trim().replace(/\s+/g, ' ');

// Every value a slider can reach at its ends, plus the ones that used to be
// special: a bevel of 0 (the division), a distance of 0 (the dead centre of
// the pad) and an angle past 180 (the sun on the other side).
const STYLES = ['none', 'frosted', 'liquid', undefined];
const NUMBERS = [0, 0.1, 1, 2, 5.5, 30];
const ANGLES = [0, 45, 90, 179, 180, 271, 360];

describe('lightParams and the card\'s light', () => {
  const pat = { shadow_angle: 200, shadow_distance: 3, bevel_width: 4, glass_thickness: 8 };

  it('draws by the pattern\'s own sun while the card has none', () => {
    const l = lightParams(pat, {});
    expect(l.angle).toBe(200);
    expect(l.distance).toBe(3);
  });

  it('takes the card\'s sun over the pattern\'s', () => {
    const l = lightParams(pat, { light_angle: 30, light_distance: 1.5 });
    expect(l.angle).toBe(30);
    expect(l.distance).toBe(1.5);
  });

  it('leaves everything about the glass itself with the pattern', () => {
    const l = lightParams(pat, { light_angle: 30 });
    expect(l.bevelWidth).toBe(4);
    expect(l.glassThickness).toBe(8);
  });

  it('is what it always was when nobody passes a card', () => {
    expect(lightParams(pat).angle).toBe(200);
    expect(lightParams({}).angle).toBe(90);
    expect(lightParams({}).distance).toBe(1);
  });

  it('turns the shadow round with the card\'s sun, both components', () => {
    const l = lightParams({}, { light_angle: 0, light_distance: 2 });
    expect(l.shadowX).toBeCloseTo(2);
    expect(l.shadowY).toBeCloseTo(0);
    expect(l.lightX).toBeCloseTo(-2);
  });
});

describe('bevelShadow', () => {
  it('says exactly what the card said before the formula moved out of it', () => {
    for (const shadow_style of STYLES) {
      for (const bevel_width of NUMBERS) {
        for (const glass_thickness of NUMBERS) {
          for (const shadow_angle of ANGLES) {
            for (const light_brightness of [0, 0.4, 1]) {
              for (const shadow_distance of [0, 1, 5]) {
                const pat = { shadow_style, bevel_width, glass_thickness,
                              shadow_angle, light_brightness, shadow_distance };
                expect(flat(bevelShadow(lightParams(pat), px)))
                  .toBe(flat(before(pat, px)));
              }
            }
          }
        }
      }
    }
  });

  it('reads the old name a saved card still carries', () => {
    expect(lightParams({ bevel_size: 7 }).bevelWidth).toBe(7);
    expect(lightParams({ bevel_size: 7, bevel_width: 3 }).bevelWidth).toBe(3);
  });

  it('falls back to the card defaults for an empty pattern', () => {
    expect(flat(bevelShadow(lightParams({}), px)))
      .toBe(flat(before({}, px)));
  });

  it('paints nothing for a flat pattern', () => {
    expect(bevelShadow(lightParams({ shadow_style: 'none' }), px)).toBe('none');
  });

  it('keeps the unit the caller paints in', () => {
    const cq = v => (v === 0 ? '0px' : `calc(${v} * 1cqmin)`);
    expect(bevelShadow(lightParams({ bevel_width: 4 }), cq)).toContain('1cqmin');
  });

  it('puts the light opposite the shadow', () => {
    const l = lightParams({ shadow_angle: 90, shadow_distance: 2 });
    expect(l.lightX).toBeCloseTo(-l.shadowX);
    expect(l.lightY).toBeCloseTo(-l.shadowY);
  });

  it('does not divide by a bevel of zero', () => {
    const l = lightParams({ bevel_width: 0, glass_thickness: 5 });
    expect(Number.isFinite(l.edgeLight)).toBe(true);
    expect(l.edgeLight).toBeLessThanOrEqual(1);
  });
});

describe('isRoundTarget', () => {
  it('calls a gauge and the card icon round', () => {
    expect(isRoundTarget('elm_gauge_0')).toBe(true);
    expect(isRoundTarget('elm_gauge_12')).toBe(true);
    expect(isRoundTarget('elm_icon')).toBe(true);
  });

  it('calls everything the card draws with corners square', () => {
    for (const t of ['elm_progressbar_0', 'elm_label_3', 'elm_name', 'elm_state',
                     'elm_surface_0', 'main', 'r1c2', 'none']) {
      expect(isRoundTarget(t), t).toBe(false);
    }
  });

  // A pattern with no target at all reaches the pad while a new one is being
  // set up, and a missing target is a box, not a crash.
  it('survives a target that is not a string', () => {
    for (const t of [undefined, null, 0, '', {}, ['elm_gauge_0']]) {
      expect(isRoundTarget(/** @type {any} */ (t))).toBe(false);
    }
  });

  // `elm_gauge_` is a prefix, not a word: a target that merely starts with
  // the letters of another one must not borrow its shape.
  it('does not round a target that only looks like one', () => {
    expect(isRoundTarget('elm_gauges')).toBe(false);
    expect(isRoundTarget('elm_icon_ring')).toBe(false);
    expect(isRoundTarget('gauge_0')).toBe(false);
  });
});

describe('isReliefTarget', () => {
  const slot = (bar) => ({ progressbars: [bar] });

  it('is a circular bar, segmented or drawn as one stroke', () => {
    expect(isReliefTarget('elm_progressbar_0',
      slot({ orientation: 'circular_donut', circular_segmented: true }))).toBe(true);
    expect(isReliefTarget('elm_progressbar_0',
      slot({ orientation: 'circular_donut' }))).toBe(true);
    expect(isReliefTarget('elm_progressbar_0',
      slot({ orientation: 'circular_speedo', circular_segmented: false }))).toBe(true);
  });

  it('is not a straight bar, segments or no segments', () => {
    expect(isReliefTarget('elm_progressbar_0',
      slot({ orientation: 'vertical', circular_segmented: true }))).toBe(false);
    expect(isReliefTarget('elm_progressbar_0', slot({ orientation: 'horizontal' }))).toBe(false);
  });

  it('reads the bar the target names', () => {
    const two = { progressbars: [
      { orientation: 'horizontal' },
      { orientation: 'circular_donut' },
    ] };
    expect(isReliefTarget('elm_progressbar_0', two)).toBe(false);
    expect(isReliefTarget('elm_progressbar_1', two)).toBe(true);
  });

  it('answers no without a slot, and to anything that is not a bar', () => {
    expect(isReliefTarget('elm_progressbar_0')).toBe(false);
    expect(isReliefTarget('elm_gauge_0', slot({ orientation: 'circular' }))).toBe(false);
    expect(isReliefTarget('main', {})).toBe(false);
    expect(isReliefTarget(null, {})).toBe(false);
  });
});

describe('reliefPattern', () => {
  const bar = { orientation: 'circular_donut', circular_segmented: true };
  const other = { orientation: 'horizontal' };
  const pat = (over) => ({ enabled: true, target: 'elm_progressbar_1', segment_relief: true, ...over });

  it('finds the pattern that asks for relief on this bar', () => {
    const p = pat();
    expect(reliefPattern({ progressbars: [other, bar], fx_glass_patterns: [p] }, bar)).toBe(p);
  });

  it('counts the bar by identity, so a canvas bar needs no index', () => {
    const twin = { ...bar };
    const p = pat();
    const slot = { progressbars: [other, bar, twin], fx_glass_patterns: [p] };
    expect(reliefPattern(slot, bar)).toBe(p);
    // the twin is bar 2, and nothing targets it - equal config, different bar
    expect(reliefPattern(slot, twin)).toBe(null);
  });

  it('ignores a pattern that is off, aimed elsewhere, or not asking', () => {
    const slot = (p) => ({ progressbars: [other, bar], fx_glass_patterns: [p] });
    expect(reliefPattern(slot(pat({ enabled: false })), bar)).toBe(null);
    expect(reliefPattern(slot(pat({ target: 'elm_progressbar_0' })), bar)).toBe(null);
    expect(reliefPattern(slot(pat({ target: 'main' })), bar)).toBe(null);
    expect(reliefPattern(slot(pat({ segment_relief: false })), bar)).toBe(null);
  });

  it('is null when there is nothing to read', () => {
    expect(reliefPattern(undefined, bar)).toBe(null);
    expect(reliefPattern({}, bar)).toBe(null);
    expect(reliefPattern({ progressbars: [bar] }, bar)).toBe(null);
    expect(reliefPattern({ progressbars: [bar], fx_glass_patterns: [pat()] }, other)).toBe(null);
  });
});

describe('reliefShadow', () => {
  const light = lightParams({ shadow_angle: 90, shadow_distance: 1 });

  it('is nothing at no depth', () => {
    expect(reliefShadow(light, { segment_relief_depth: 0 })).toBe('none');
    expect(reliefShadow(light, { segment_relief_depth: -1 })).toBe('none');
  });

  it('raised carries the highlight towards the sun and casts away from it', () => {
    const out = reliefShadow(light, { segment_relief_depth: 2 }, (v) => `${Math.round(v * 1000) / 1000}px`);
    const [lit, dark, cast] = out.split('), ').map(s => s + ')');
    expect(lit).toContain('inset');
    expect(lit).toContain('255, 255, 255');
    expect(dark).toContain('inset');
    expect(dark).toContain('rgba(0, 0, 0');
    // the cast shadow is the one that is not inset, and it is opposite the light
    expect(cast.startsWith('inset')).toBe(false);
    expect(cast).toContain('rgba(0, 0, 0');
  });

  it('engraved is that picture inside out', () => {
    // A sun straight overhead has a cosine of 6e-17 rather than of 0, so the
    // offsets are read through a rounding unit - which is what the card hands
    // in anyway, and what this test is about is the signs and the colours.
    const round = (v) => `${Math.round(v * 1000) / 1000}px`;
    const raised = reliefShadow(light, { segment_relief_depth: 2, segment_relief_mode: 'raised' }, round);
    const sunk = reliefShadow(light, { segment_relief_depth: 2, segment_relief_mode: 'engraved' }, round);
    expect(sunk).not.toBe(raised);
    // the lit wall of one is the dark wall of the other, on the same side
    expect(raised.startsWith('inset 0px -2px 2px rgba(255, 255, 255')).toBe(true);
    expect(sunk.startsWith('inset 0px -2px 2px rgba(0, 0, 0')).toBe(true);
    // and what stands outside the pill is a lit lip rather than a cast shadow
    expect(sunk.split('), ').pop()).toContain('255, 255, 255');
    expect(raised.split('), ').pop()).toContain('rgba(0, 0, 0');
    // only the groove has a floor to darken, which is the fourth shadow
    expect(sunk.split('), ').length).toBe(4);
    expect(raised.split('), ').length).toBe(3);
    expect(sunk).toContain('inset 0px 0px 2px 1px');
  });

  it('takes the direction of the light but not its distance', () => {
    const near = lightParams({ shadow_angle: 40, shadow_distance: 1 });
    const far = lightParams({ shadow_angle: 40, shadow_distance: 5 });
    const of = (l) => reliefShadow(l, { segment_relief_depth: 2 });
    // `shadow_distance` is a multiple of the bevel width, and a bevel is wider
    // than the pill this sits on: scaled by it, the highlight misses.
    expect(of(far)).toBe(of(near));
  });

  it('defaults to a depth of 0.6 and writes lengths in the caller unit', () => {
    const out = reliefShadow(light, {}, (v) => (v === 0 ? '0px' : `${v}cqmin`));
    expect(out).toContain('cqmin');
    expect(out).toContain('0.6cqmin');
  });
});

describe('reliefLayers', () => {
  const light = lightParams({ shadow_angle: 90, light_brightness: 0.4 });

  it('has nothing to paint without depth', () => {
    expect(reliefLayers(light, { segment_relief_depth: 0 })).toEqual([]);
  });

  it('lays a raised relief out as two walls and a cast shadow', () => {
    const layers = reliefLayers(light, { segment_relief_depth: 2 });
    expect(layers.map(l => l.inset)).toEqual([true, true, false]);
    expect(layers.map(l => l.light)).toEqual([true, false, false]);
    // The walls sit on opposite sides of the same line.
    expect(layers[0].dy).toBeCloseTo(-layers[1].dy);
    expect(layers.every(l => l.spread === 0)).toBe(true);
  });

  it('turns an engraved one inside out and fills its floor', () => {
    const layers = reliefLayers(light, { segment_relief_depth: 2, segment_relief_mode: 'engraved' });
    expect(layers.map(l => l.light)).toEqual([false, true, false, true]);
    // Only the floor spreads; the walls are edges, not fills.
    expect(layers.map(l => l.spread)).toEqual([0, 0, 1, 0]);
    expect(layers[2].dx).toBe(0);
    expect(layers[2].dy).toBe(0);
  });

  it('is one box-shadow per layer, in order', () => {
    const pat = { segment_relief_depth: 1.5, segment_relief_mode: 'engraved' };
    const shadows = reliefShadow(light, pat).split('rgba').length - 1;
    expect(shadows).toBe(reliefLayers(light, pat).length);
  });
});

describe('isCircleRadius', () => {
  it('is a radius that makes a circle', () => {
    expect(isCircleRadius('50%')).toBe(true);
    expect(isCircleRadius(' 50.0% ')).toBe(true);
  });

  it('is not a box radius, however round', () => {
    expect(isCircleRadius('4px')).toBe(false);
    expect(isCircleRadius('20%')).toBe(false);
    expect(isCircleRadius('999rem')).toBe(false);
    expect(isCircleRadius('var(--pb-radius, 4px)')).toBe(false);
    expect(isCircleRadius('calc(5 * 1cqmin)')).toBe(false);
  });
});

describe('boxRingMask', () => {
  it('keeps the rim by subtracting the box inside the padding', () => {
    const css = boxRingMask('6px', 0);
    expect(css).toContain('padding: 6px !important');
    expect(css).toContain('mask-clip: border-box, content-box !important');
    expect(css).toContain('mask-composite: exclude !important');
    // Fully opaque inner layer, so nothing of the middle survives.
    expect(css).toContain('linear-gradient(rgba(0,0,0,1) 0 0), linear-gradient(rgba(0,0,0,1) 0 0)');
  });

  it('leaves as much glass in the middle as the centre opacity asks for', () => {
    expect(boxRingMask('4px', 0.25)).toContain('linear-gradient(rgba(0,0,0,0.75) 0 0)');
    expect(boxRingMask('4px', 1)).toContain('linear-gradient(rgba(0,0,0,0) 0 0)');
  });

  it('carries the prefixed spelling Safari needs', () => {
    const css = boxRingMask('4px', 0);
    expect(css).toContain('-webkit-mask-composite: xor !important');
    expect(css).toContain('-webkit-mask-clip: border-box, content-box !important');
  });

  it('has nothing to do with an opacity outside the range', () => {
    expect(boxRingMask('4px', -1)).toContain('rgba(0,0,0,1) 0 0), linear-gradient(rgba(0,0,0,1)');
    expect(boxRingMask('4px', 4)).toContain('linear-gradient(rgba(0,0,0,0) 0 0)');
  });
});
