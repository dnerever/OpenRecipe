import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyCookOptions,
  formatFactor,
  normalizeScale,
  optionsFromSearch,
  parseCookSearch,
  searchFromOptions,
} from './cook-options.ts';

const fm = {
  schema: 1 as const,
  title: 'Dough',
  yield: { count: 2, unit: 'loaf' },
  ingredients: [
    { qty: 500, unit: 'g', item: 'bread flour' },
    { qty: null, item: 'rice flour', note: 'for dusting' },
  ],
};

describe('parseCookSearch', () => {
  it('reads a scale and a unit preference', () => {
    assert.deepEqual(parseCookSearch({ scale: '2', units: 'metric' }), {
      scale: 2,
      units: 'metric',
    });
  });

  it('drops anything that is not a usable factor', () => {
    for (const scale of ['abc', '0', '-1', '', null, undefined, NaN]) {
      assert.deepEqual(parseCookSearch({ scale }), {});
    }
  });

  it('drops a unit system it does not have', () => {
    assert.deepEqual(parseCookSearch({ units: 'imperial' }), {});
  });

  it('clamps a factor nobody is cooking at', () => {
    assert.equal(normalizeScale(1e9), 100);
    assert.equal(normalizeScale(0.0001), 0.05);
  });

  it('treats ×1 as no scale at all, so it stays out of the URL', () => {
    assert.equal(normalizeScale(1), undefined);
    assert.deepEqual(searchFromOptions({ scale: 1, units: 'metric' }, 'metric'), {});
  });

  it('keeps the recipe’s own system out of the URL, and the other one in it', () => {
    assert.deepEqual(searchFromOptions({ scale: 1, units: 'metric' }, 'us'), { units: 'metric' });
    assert.deepEqual(optionsFromSearch({}, 'us'), { scale: 1, units: 'us' });
  });

  it('round-trips through the URL', () => {
    const options = optionsFromSearch(parseCookSearch({ scale: '0.5', units: 'us' }), 'metric');
    assert.deepEqual(options, { scale: 0.5, units: 'us' });
    assert.deepEqual(searchFromOptions(options, 'metric'), { scale: 0.5, units: 'us' });
  });
});

describe('applyCookOptions', () => {
  it('scales and converts in that order', () => {
    const applied = applyCookOptions(fm, { scale: 2, units: 'us' }, 'metric');
    assert.deepEqual(applied.ingredients[0], { qty: 2.25, unit: 'lb', item: 'bread flour' });
    assert.equal(applied.yield?.count, 4);
  });

  it('leaves the document alone when nothing is asked of it', () => {
    assert.equal(applyCookOptions(fm, { scale: 1, units: 'metric' }, 'metric'), fm);
  });

  it('does not re-ladder a recipe into its own system', () => {
    const big = { ...fm, ingredients: [{ qty: 1500, unit: 'g', item: 'bread flour' }] };
    assert.equal(
      applyCookOptions(big, { scale: 1, units: 'metric' }, 'metric').ingredients[0]?.unit,
      'g',
    );
  });

  it('does not mutate the original', () => {
    const before = JSON.stringify(fm);
    applyCookOptions(fm, { scale: 3, units: 'us' }, 'metric');
    assert.equal(JSON.stringify(fm), before);
  });
});

describe('formatFactor', () => {
  it('uses fractions where they are exact', () => {
    assert.equal(formatFactor(0.5), '×½');
    assert.equal(formatFactor(1.5), '×1½');
    assert.equal(formatFactor(1 / 3), '×⅓');
  });

  it('never rounds a factor to a prettier one', () => {
    assert.equal(formatFactor(1.1), '×1.1');
    assert.equal(formatFactor(2), '×2');
  });
});
