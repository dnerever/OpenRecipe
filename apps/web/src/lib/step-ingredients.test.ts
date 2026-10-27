import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ingredientsInStep, statedAmount } from './step-ingredients.ts';

const LOAF = [
  { item: 'mature starter', group: 'Levain' },
  { item: 'bread flour', group: 'Levain' },
  { item: 'water', group: 'Levain' },
  { item: 'bread flour', group: 'Dough' },
  { item: 'whole wheat flour', group: 'Dough' },
  { item: 'water', group: 'Dough' },
  { item: 'fine sea salt', group: 'Dough' },
];

const names = (set: Set<number>) => [...set].sort((a, b) => a - b);

describe('ingredientsInStep', () => {
  it('keeps to the group a section is named after', () => {
    const found = ingredientsInStep(
      'Mix the starter, flour and water in a small tub.',
      'Levain',
      LOAF,
    );
    assert.deepEqual(names(found), [0, 1, 2]);
  });

  it('matches a plural, and by last word when no full name is used', () => {
    const found = ingredientsInStep(
      'Combine both flours with 700g of the water.',
      'Autolyse',
      LOAF,
      ['Levain', 'Autolyse', 'Mix'],
    );
    // The dough's flours and water; the levain's went into the Levain step.
    assert.deepEqual(names(found), [3, 4, 5]);
  });

  it('prefers the full name when the step uses one', () => {
    const found = ingredientsInStep('Add the whole wheat flour, then the salt.', undefined, LOAF);
    assert.ok(found.has(4));
    assert.ok(found.has(6));
    assert.ok(!found.has(1), 'plain bread flour was not mentioned');
  });

  it('does not match inside another word', () => {
    const found = ingredientsInStep('A flourish of salt on top.', undefined, [{ item: 'flour' }]);
    assert.equal(found.size, 0);
  });
});

describe('ingredientsInStep — an ingredient with no amount', () => {
  it('is matched by its full name only', () => {
    const dough = [
      { item: 'bread flour', qty: 900 },
      { item: 'rice flour', qty: null },
    ];
    assert.deepEqual(names(ingredientsInStep('Combine both flours.', undefined, dough)), [0]);
    assert.deepEqual(names(ingredientsInStep('Dust with rice flour.', undefined, dough)), [1]);
  });
});

describe('statedAmount', () => {
  it('finds the amount a step gives for an ingredient', () => {
    assert.equal(statedAmount('Combine both flours with 700g of the water.', 'water')?.qty, 700);
    assert.equal(statedAmount('Add the salt with the remaining 50g water.', 'water')?.qty, 50);
  });

  it('does not lend one ingredient the amount of another', () => {
    assert.equal(
      statedAmount('Combine both flours with 700g of the water.', 'bread flour'),
      undefined,
    );
    assert.equal(statedAmount('Whisk in 2 tbsp olive oil.', 'water'), undefined);
  });
});
