import { describe, it, expect } from 'vitest';
import { gaugeScale, rangeTiers, tickMultiplier, multiplierParts, NO_TIER_STATE } from './gauge-scale.js';

const run = (steps, cfg) => {
  let state = NO_TIER_STATE;
  return steps.map((value) => {
    const out = gaugeScale({ ...cfg, value, state });
    state = out.state;
    return out;
  });
};

describe('gaugeScale - nothing switched on', () => {
  it('is the user’s own range', () => {
    const out = gaugeScale({ value: 1234, min: 300, max: 2500 });
    expect(out).toMatchObject({ min: 300, max: 2500, val: 1234, unitPrefix: '', tierBase: 1 });
  });

  it('falls back to 0..100 for a blank range', () => {
    expect(gaugeScale({ value: 5, min: NaN, max: NaN })).toMatchObject({ min: 0, max: 100 });
  });
});

describe('auto-scale', () => {
  it('divides by a thousand per tier and names it', () => {
    expect(gaugeScale({ value: 2_500_000, min: 0, max: 10_000_000, autoScale: true }))
      .toMatchObject({ val: 2.5, min: 0, max: 10, unitPrefix: 'M', tierBase: 1e6 });
  });

  it('steps up only once the value has cleared the boundary by the margin', () => {
    const [a, b] = run([999, 1050], { min: 0, max: 10_000, autoScale: true, hysteresis: 10 });
    expect(a.unitPrefix).toBe('');
    expect(b.unitPrefix).toBe('');
    expect(run([999, 1200], { min: 0, max: 10_000, autoScale: true, hysteresis: 10 })[1].unitPrefix)
      .toBe('k');
  });

  it('steps back down at the same boundary it came up over', () => {
    // The old code compared against the floor of the tier being entered, so a
    // gauge that had reached M stayed there until the value fell below 900 -
    // two whole decades late.
    const [, dip] = run([2_000_000, 800_000], { min: 0, max: 10_000_000, autoScale: true, hysteresis: 10 });
    expect(dip.unitPrefix).toBe('k');
    const [, hold] = run([2_000_000, 950_000], { min: 0, max: 10_000_000, autoScale: true, hysteresis: 10 });
    expect(hold.unitPrefix).toBe('M');
  });

  it('never runs past the prefixes it has', () => {
    expect(gaugeScale({ value: 1e30, min: 0, max: 1e30, autoScale: true }).unitPrefix).toBe('P');
  });

  it('leaves the range alone', () => {
    const out = gaugeScale({ value: 5000, min: 1000, max: 9000, autoScale: true });
    expect(out.min).toBe(1);
    expect(out.max).toBe(9);
  });
});

describe('dynamic max', () => {
  it('grows the maximum to hold a value that has gone past it', () => {
    expect(gaugeScale({ value: 150, min: 0, max: 100, dynamicMax: true }).max).toBe(150);
  });

  it('keeps the user’s own minimum', () => {
    // It is the *maximum* that is dynamic. The old code zeroed the minimum
    // too, so a 300..2500 dial became 0..2500 the moment it was switched on.
    expect(gaugeScale({ value: 1200, min: 300, max: 2500, dynamicMax: true }))
      .toMatchObject({ min: 300, max: 2500 });
  });

  it('is symmetric where the user’s range reaches below zero', () => {
    expect(gaugeScale({ value: -150, min: -100, max: 100, dynamicMax: true }))
      .toMatchObject({ min: -150, max: 150 });
  });

  it('does not shrink the range below the user’s maximum', () => {
    expect(gaugeScale({ value: 5, min: 0, max: 100, dynamicMax: true }).max).toBe(100);
  });
});

describe('auto-range', () => {
  it('shows the decade the value is in', () => {
    expect(gaugeScale({ value: 30, min: 0, max: 1_000_000, autoRange: true }))
      .toMatchObject({ min: 0, max: 100 });
  });

  it('holds the rung until the value has cleared it by the margin', () => {
    const [, held] = run([30, 105], { min: 0, max: 1_000_000, autoRange: true, hysteresis: 10 });
    expect(held.max).toBe(100);
    const [, moved] = run([30, 130], { min: 0, max: 1_000_000, autoRange: true, hysteresis: 10 });
    expect(moved.max).toBe(1000);
  });

  it('stops at the user’s maximum on its own', () => {
    expect(gaugeScale({ value: 5000, min: 0, max: 1000, autoRange: true }).max).toBe(1000);
  });

  it('grows past it when dynamic max is on as well', () => {
    // The two switches used to cancel: dynamic max was skipped whenever
    // auto-range was on, so the needle sat at the end stop.
    expect(gaugeScale({ value: 5000, min: 0, max: 1000, autoRange: true, dynamicMax: true }).max)
      .toBe(5000);
  });
});

describe('the two tiers do not share one memory', () => {
  it('auto-range keeps its rung while auto-scale changes prefix', () => {
    // Both on: the rung is an index into a ladder and the prefix is a power
    // of a thousand. Writing both to one field made each read the other's.
    const steps = [30_000, 2_000_000, 30_000];
    const out = run(steps, { min: 0, max: 1e9, autoScale: true, autoRange: true, hysteresis: 10 });
    expect(out.map(o => o.unitPrefix)).toEqual(['k', 'M', 'k']);
    expect(out.map(o => o.max * o.tierBase)).toEqual([100_000, 10_000_000, 100_000]);
  });

  it('gives auto-scale its hysteresis back when auto-range is on', () => {
    const [, held] = run([2_000_000, 950_000],
                         { min: 0, max: 1e9, autoScale: true, autoRange: true, hysteresis: 10 });
    expect(held.unitPrefix).toBe('M');
  });
});

describe('rangeTiers', () => {
  it('is every decade up to the maximum, and the maximum', () => {
    expect(rangeTiers(2500)).toEqual([10, 100, 1000, 2500]);
    expect(rangeTiers(100)).toEqual([10, 100]);
    expect(rangeTiers(5)).toEqual([5]);
  });

  it('never has a rung of zero', () => {
    expect(rangeTiers(0)).toEqual([1]);
  });

  it('grows past the top only when asked', () => {
    expect(rangeTiers(1000, 5000, false)).toEqual([10, 100, 1000]);
    expect(rangeTiers(1000, 5000, true)).toEqual([10, 100, 1000, 2000, 5000]);
  });

  it('grows by round numbers, so the rung lands near the value', () => {
    // A decade of growth put the needle wherever it happened to fall: a dial
    // of 300M asked to show 614M was drawn to 3G and read at a fifth.
    const tiers = rangeTiers(3e8, 6.143e8, true);
    expect(tiers.slice(-3)).toEqual([3e8, 5e8, 1e9]);
    expect(gaugeScale({ value: 6.143e8, min: 0, max: 3e8,
                        autoRange: true, dynamicMax: true }).max).toBe(1e9);
  });

  it('stops at the first round rung above the value', () => {
    expect(rangeTiers(5e7, 1.844e8, true).slice(-3)).toEqual([5e7, 1e8, 2e8]);
    expect(gaugeScale({ value: 1.844e8, min: 0, max: 5e7,
                        autoRange: true, dynamicMax: true }).max).toBe(2e8);
  });
});

describe('what the tick labels are divided by', () => {
  it('is the power of ten the step between two ticks contains', () => {
    expect(tickMultiplier(1000, 11)).toBe(100);
    expect(tickMultiplier(100, 11)).toBe(10);
    expect(tickMultiplier(100, 21)).toBe(1);
  });

  it('keeps a half-decade range labelling in whole numbers', () => {
    // Taken from a fifth of the range this was 100, which labelled the
    // eleven ticks of a 500 dial 0, 0.5, 1 - and, at no decimals, 0, 1, 1.
    expect(tickMultiplier(500, 11)).toBe(10);
    const step = 500 / 10 / tickMultiplier(500, 11);
    expect(Number.isInteger(step)).toBe(true);
  });

  it('answers 1 where there is no range to divide', () => {
    expect(tickMultiplier(0, 11)).toBe(1);
    expect(tickMultiplier(NaN, 11)).toBe(1);
    expect(tickMultiplier(100, 1)).toBe(100);
  });
});

describe('a hysteresis that is not a number', () => {
  it('is the default rather than NaN', () => {
    // Every comparison against NaN is false, which left the hold switched on
    // in one direction and off in the other.
    const [, held] = run([999, 1050], { min: 0, max: 1e6, autoScale: true, hysteresis: NaN });
    expect(held.unitPrefix).toBe('');
  });
});


describe('how a multiplier caption is written', () => {
  it('steps the prefix down rather than writing a fraction of one', () => {
    // A 2000 W dial under a k prefix divides its labels by 100, which used to
    // be captioned "x0.1k".
    expect(multiplierParts(0.1, 1)).toEqual({ factor: 100, prefix: '' });
    expect(multiplierParts(0.01, 2)).toEqual({ factor: 10, prefix: 'k' });
  });

  it('leaves a factor of one or more where it is', () => {
    expect(multiplierParts(100, 2)).toEqual({ factor: 100, prefix: 'M' });
    expect(multiplierParts(1, 0)).toEqual({ factor: 1, prefix: '' });
  });

  it('cannot step below the plain unit', () => {
    expect(multiplierParts(0.001, 0)).toEqual({ factor: 0.001, prefix: '' });
  });

  it('does not loop on a factor that is not a number', () => {
    expect(multiplierParts(0, 2)).toEqual({ factor: 0, prefix: 'M' });
    expect(multiplierParts(NaN, 2).prefix).toBe('M');
  });
});
