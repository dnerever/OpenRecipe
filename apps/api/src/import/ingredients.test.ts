import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { knownUnit, parseIngredientLine, toNumber } from './ingredients.ts';

/** Terser than repeating the null check at every call site. */
function parse(line: string) {
  const ing = parseIngredientLine(line);
  assert.ok(ing, `expected "${line}" to parse`);
  return ing;
}

describe('toNumber', () => {
  it('reads whole numbers, decimals, fractions and mixed numbers', () => {
    assert.equal(toNumber('3'), 3);
    assert.equal(toNumber('0.5'), 0.5);
    assert.equal(toNumber('1/2'), 0.5);
    assert.equal(toNumber('2 1/2'), 2.5);
    assert.equal(toNumber('1/3'), 0.333);
  });

  it('refuses anything that is not a number', () => {
    assert.equal(toNumber('a few'), null);
    assert.equal(toNumber('1/0'), null);
    assert.equal(toNumber(''), null);
  });
});

describe('knownUnit', () => {
  it('canonicalizes units core already knows', () => {
    assert.equal(knownUnit('Tablespoons'), 'tbsp');
    assert.equal(knownUnit('grams'), 'g');
    assert.equal(knownUnit('oz.'), 'oz');
  });

  it('accepts the hand-typed spellings core does not carry', () => {
    assert.equal(knownUnit('Tbs'), 'tbsp');
    assert.equal(knownUnit('tsps'), 'tsp');
  });

  it('rejects words that are not units, which is what keeps items intact', () => {
    assert.equal(knownUnit('avocados'), null);
    assert.equal(knownUnit('handful'), null);
  });
});

describe('parseIngredientLine', () => {
  it('reads a leading amount', () => {
    assert.deepEqual(parse('450 grams rolled oats'), { qty: 450, unit: 'g', item: 'rolled oats' });
    assert.deepEqual(parse('200g vegan ground meat'), {
      qty: 200,
      unit: 'g',
      item: 'vegan ground meat',
    });
  });

  it('leaves a count with no unit rather than inventing one', () => {
    assert.deepEqual(parse('3 avocados'), { qty: 3, item: 'avocados' });
  });

  it('reads the colon form a bread-machine list uses', () => {
    assert.deepEqual(parse('Bread Flour: 480 g'), { qty: 480, unit: 'g', item: 'Bread Flour' });
  });

  it('reads the dash form', () => {
    assert.deepEqual(parse('Oats - 40g'), { qty: 40, unit: 'g', item: 'Oats' });
  });

  it('reads a trailing parenthetical as the amount when nothing else supplied one', () => {
    assert.deepEqual(parse('Peanut butter (75g)'), { qty: 75, unit: 'g', item: 'Peanut butter' });
    assert.deepEqual(parse('Medjool Dates (3)'), { qty: 3, item: 'Medjool Dates' });
  });

  it('keeps a parenthetical as a note when the line already had an amount', () => {
    assert.deepEqual(parse('1 cup white wheat flour (120g)'), {
      qty: 1,
      unit: 'cup',
      item: 'white wheat flour',
      note: '120g',
    });
  });

  it('keeps a parenthetical that is not an amount as a note', () => {
    assert.deepEqual(parse('Cinnamon (A few dashes)'), {
      qty: null,
      note: 'A few dashes',
      item: 'Cinnamon',
    });
  });

  it('unwraps markdown links so affiliate URLs stay out of the item', () => {
    assert.deepEqual(parse('1 cup [red lentils](https://www.amazon.com/x?a=1&b=2) masoor dal'), {
      qty: 1,
      unit: 'cup',
      item: 'red lentils masoor dal',
    });
    // Without this the trailing `(url)` reads as the note and the item is `[Salt]`.
    assert.deepEqual(parse('3/4 tsp [turmeric](https://www.amazon.com/y?q=1)'), {
      qty: 0.75,
      unit: 'tsp',
      item: 'turmeric',
    });
  });

  it('takes the first of two restated amounts in one parenthetical', () => {
    assert.deepEqual(parse('Chickpea Flour (60g, 1/2 cup)'), {
      qty: 60,
      unit: 'g',
      item: 'Chickpea Flour',
      note: '1/2 cup',
    });
  });

  it('strips checkbox and bullet furniture', () => {
    assert.deepEqual(parse('- [ ]  Chia Seeds (10g)'), { qty: 10, unit: 'g', item: 'Chia Seeds' });
    assert.equal(parseIngredientLine('- [ ]  ▢'), null);
    assert.equal(parseIngredientLine('-'), null);
  });

  it('understands LaTeX and vulgar fractions', () => {
    assert.deepEqual(parse('Rolled Oats ($\\frac{1}{2}$ Cup)'), {
      qty: 0.5,
      unit: 'cup',
      item: 'Rolled Oats',
    });
    assert.deepEqual(parse('¾ teaspoon turmeric'), { qty: 0.75, unit: 'tsp', item: 'turmeric' });
    assert.deepEqual(parse('1½ cups water'), { qty: 1.5, unit: 'cup', item: 'water' });
  });

  it('does not split on a comma inside parentheses', () => {
    assert.deepEqual(parseIngredientLine('2 cups chickpeas (drained, rinsed), divided'), {
      qty: 2,
      unit: 'cup',
      item: 'chickpeas (drained, rinsed)',
      note: 'divided',
    });
  });

  it('splits the prep clause off an item, but only once an amount is known', () => {
    assert.deepEqual(parse('1 onion, diced'), { qty: 1, item: 'onion', note: 'diced' });
    // No amount, so the comma is left alone — it may be a list, not a prep note.
    assert.deepEqual(parse('Salt, pepper and oil'), { qty: null, item: 'Salt, pepper and oil' });
  });

  it('records a range without pretending to a single number', () => {
    assert.deepEqual(parse('3-4 ounces snow peas'), {
      qty: 3,
      unit: 'oz',
      item: 'snow peas',
      note: 'up to 4',
    });
  });

  it('drops a leading article left behind by the quantity', () => {
    assert.deepEqual(parse('1/2 a red onion'), { qty: 0.5, item: 'red onion' });
  });

  it('never lets a date read as a fraction', () => {
    assert.deepEqual(parse('5/30/23 (Detroit Style)'), {
      qty: null,
      note: 'Detroit Style',
      item: '5/30/23',
    });
  });

  it('keeps an unreadable line whole instead of guessing', () => {
    assert.deepEqual(parse('A lot - Salt'), { qty: null, item: 'A lot - Salt' });
    assert.deepEqual(parse('Tabasco?'), { qty: null, item: 'Tabasco?' });
    assert.deepEqual(parse('(Optional) Honey/syrup/brown sugar'), {
      qty: null,
      item: '(Optional) Honey/syrup/brown sugar',
    });
  });

  it('never emits a unit without a quantity, which the schema rejects', () => {
    for (const line of ['Salt to taste', 'a pinch of cinnamon', 'Handful of Fresh Blueberries']) {
      const ing = parse(line);
      if (ing.qty === null) assert.equal(ing.unit, undefined, line);
    }
  });
});
