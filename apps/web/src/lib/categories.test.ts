import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tintForRecipe, tintForTag } from './categories.ts';

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
