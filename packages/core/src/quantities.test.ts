import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findQuantities, restateQuantity } from './quantities.ts';

const found = (text: string) => findQuantities(text).map((q) => [q.text, q.qty, q.unit, q.item]);
const restated = (text: string, factor: number, system: 'metric' | 'us' | null = null) =>
  findQuantities(text).map((q) => restateQuantity(q, factor, system));

describe('findQuantities', () => {
  it('reads the amounts a method names', () => {
    assert.deepEqual(found('Combine both flours with 700g of the water.'), [
      ['700g', 700, 'g', 'water'],
    ]);
    assert.deepEqual(found('Add the salt with the remaining 50 g water.'), [
      ['50 g', 50, 'g', 'water'],
    ]);
    assert.deepEqual(found('Whisk in 2 tbsp. olive oil'), [['2 tbsp', 2, 'tbsp', 'olive oil']]);
  });

  it('reads fractions however they are typed', () => {
    assert.deepEqual(
      findQuantities('Add ½ cup stock, then 1 1/2 cups more, then 1½ cups.').map((q) => q.qty),
      [0.5, 1.5, 1.5],
    );
  });

  it('spells units out or not, singular or plural', () => {
    assert.deepEqual(
      findQuantities('2 tablespoons, 3 teaspoons, 1 litre, 2 quarts, 4 ounces').map((q) => q.unit),
      ['tbsp', 'tsp', 'l', 'quart', 'oz'],
    );
  });

  it('keeps a range as one amount', () => {
    const [q] = findQuantities('Add 20–25 g of salt.');
    assert.equal(q?.qty, 20);
    assert.equal(q?.maxQty, 25);
    assert.equal(q?.text, '20–25 g');
  });

  it('leaves counts, temperatures, lengths and times alone', () => {
    assert.deepEqual(
      found('Make 6 wells. Bake at 450°F for 20 minutes. Score 1cm deep. Add 2 garlic cloves.'),
      [],
    );
    assert.deepEqual(found('Cut 1 large onion.'), []);
  });
});

describe('restateQuantity', () => {
  it('says exactly what the author wrote when nothing is asked of it', () => {
    assert.deepEqual(restated('with 700g of the water', 1), ['700g']);
  });

  it('scales with the ingredient list', () => {
    assert.deepEqual(restated('with 700g of the water', 2), ['1400 g']);
    assert.deepEqual(restated('the remaining 50g water', 0.5), ['25 g']);
    assert.deepEqual(restated('Add 20–25 g of salt.', 2), ['40–50 g']);
  });

  it('converts with it too — and water goes into a cup, not onto a scale', () => {
    assert.deepEqual(restated('with 700g of the water', 1, 'us'), ['3 cups']);
    assert.deepEqual(restated('with 700g of the flour', 1, 'us'), ['1½ lb']);
    assert.deepEqual(restated('1 cup milk', 1, 'metric'), ['237 ml']);
  });

  it('leaves spoons as spoons', () => {
    assert.deepEqual(restated('2 tbsp oil', 2, 'metric'), ['4 tbsp']);
  });
});
