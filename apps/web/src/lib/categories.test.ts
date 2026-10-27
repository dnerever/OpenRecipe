import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { headerCategories, tintForRecipe, tintForTag } from './categories.ts';

describe('category tints', () => {
  it('gives a tag the same colour every time, whatever its case', () => {
    assert.equal(tintForTag('Mystery'), tintForTag('mystery'));
  });

  it('colours a recipe by its most telling tag, not by "vegan"', () => {
    assert.equal(tintForRecipe(['vegan', 'soup']), tintForTag('soup'));
    assert.equal(tintForRecipe(['bread', 'vegan']), tintForTag('bread'));
  });

  it('falls back to yolk for a recipe with no tags', () => {
    assert.equal(tintForRecipe([]), '#ffd98a');
  });
});

describe('headerCategories', () => {
  it('offers kinds of dish in a fixed order, not whatever is most used', () => {
    assert.deepEqual(
      headerCategories(['vegan', 'burrito', 'bread', 'freezer-friendly', 'breakfast', 'soup']),
      ['breakfast', 'bread', 'soup'],
    );
  });

  it('stops at the limit', () => {
    assert.equal(headerCategories(['breakfast', 'bread', 'weeknight', 'soup'], 2).length, 2);
  });
});
