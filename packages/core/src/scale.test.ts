import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRecipe } from './parse.ts';
import {
  formatQuantity,
  formatUnit,
  ingredientFactor,
  scalableIngredients,
  scaleFrontmatter,
  scaleRecipe,
  scaleToIngredient,
  scaleToYield,
  yieldFactor,
} from './scale.ts';

const doc = parseRecipe(`---
schema: 1
title: Dough
yield: { count: 2, unit: loaf }
time: { total: 24h }
ingredients:
  - { qty: 500, unit: g, item: bread flour }
  - { qty: 350, unit: g, item: water }
  - { qty: 10, unit: g, item: salt }
  - { qty: null, item: rice flour, note: for dusting }
---

Mix.
`);

describe('scaleRecipe', () => {
  it('multiplies quantities and the yield count', () => {
    const doubled = scaleRecipe(doc, 2);
    assert.equal(doubled.frontmatter.yield?.count, 4);
    assert.deepEqual(
      doubled.frontmatter.ingredients.map((i) => i.qty),
      [1000, 700, 20, null],
    );
  });

  it('leaves to-taste ingredients alone', () => {
    assert.equal(scaleRecipe(doc, 3).frontmatter.ingredients[3]?.qty, null);
  });

  it('does not touch times — doubling a loaf does not double the ferment', () => {
    assert.deepEqual(scaleRecipe(doc, 2).frontmatter.time, doc.frontmatter.time);
  });

  it('returns the same document for a factor of 1', () => {
    assert.equal(scaleRecipe(doc, 1), doc);
  });

  it('rounds to two decimals so floating point noise stays out of the file', () => {
    assert.equal(scaleRecipe(doc, 1 / 3).frontmatter.ingredients[0]?.qty, 166.67);
  });

  it('rejects a non-positive factor', () => {
    assert.throws(() => scaleRecipe(doc, 0), RangeError);
    assert.throws(() => scaleRecipe(doc, -1), RangeError);
    assert.throws(() => scaleRecipe(doc, Number.NaN), RangeError);
  });

  it('does not mutate the original', () => {
    const before = JSON.stringify(doc);
    scaleRecipe(doc, 5);
    assert.equal(JSON.stringify(doc), before);
  });
});

describe('scaleToYield', () => {
  it('hits the requested yield', () => {
    assert.equal(scaleToYield(doc, 3).frontmatter.yield?.count, 3);
    assert.equal(scaleToYield(doc, 3).frontmatter.ingredients[0]?.qty, 750);
  });

  it('refuses when the recipe has no yield', () => {
    const noYield = parseRecipe('---\nschema: 1\ntitle: T\ningredients: []\n---\n\nStep.\n');
    assert.throws(() => scaleToYield(noYield, 4), /no `yield`/);
  });
});

describe('scaleToIngredient', () => {
  it('scales the whole recipe off one ingredient — the baker’s percentage move', () => {
    const scaled = scaleToIngredient(doc, 'bread flour', 700);
    assert.equal(scaled.frontmatter.ingredients[0]?.qty, 700);
    assert.equal(scaled.frontmatter.ingredients[1]?.qty, 490);
    assert.equal(scaled.frontmatter.yield?.count, 2.8);
  });

  it('matches case-insensitively', () => {
    assert.doesNotThrow(() => scaleToIngredient(doc, 'BREAD FLOUR', 700));
  });

  it('refuses an unknown or unscalable ingredient', () => {
    assert.throws(() => scaleToIngredient(doc, 'saffron', 10), /No scalable ingredient/);
    assert.throws(() => scaleToIngredient(doc, 'rice flour', 10), /No scalable ingredient/);
  });
});

describe('formatQuantity', () => {
  it('uses fractions for spoons and cups', () => {
    assert.equal(formatQuantity(0.5, 'cup'), '½');
    assert.equal(formatQuantity(1.5, 'tsp'), '1½');
    assert.equal(formatQuantity(0.25, 'tbsp'), '¼');
    assert.equal(formatQuantity(2, 'cup'), '2');
  });

  it('uses decimals for mass', () => {
    assert.equal(formatQuantity(166.67, 'g'), '166.67');
    assert.equal(formatQuantity(500, 'g'), '500');
  });

  it('renders nothing for a to-taste quantity', () => {
    assert.equal(formatQuantity(null, 'g'), '');
  });
});

describe('scaleFrontmatter', () => {
  it('scales without a body, which is all the read view has', () => {
    const fm = scaleFrontmatter(doc.frontmatter, 2);
    assert.equal(fm.yield?.count, 4);
    assert.equal(fm.ingredients[0]?.qty, 1000);
  });

  it('returns the same frontmatter for a factor of 1', () => {
    assert.equal(scaleFrontmatter(doc.frontmatter, 1), doc.frontmatter);
  });

  it('rejects a non-positive factor', () => {
    assert.throws(() => scaleFrontmatter(doc.frontmatter, 0), RangeError);
  });
});

describe('factors', () => {
  it('resolves a yield to the multiplier it implies', () => {
    assert.equal(yieldFactor(doc.frontmatter, 3), 1.5);
  });

  it('resolves an ingredient target to the multiplier it implies', () => {
    assert.equal(ingredientFactor(doc.frontmatter, 'bread flour', 750), 1.5);
  });

  it('offers only the ingredients that can anchor a scale', () => {
    assert.deepEqual(
      scalableIngredients(doc.frontmatter).map((i) => i.item),
      ['bread flour', 'water', 'salt'],
    );
  });
});

describe('formatUnit', () => {
  it('pluralizes spelled-out units', () => {
    assert.equal(formatUnit('cup', 2), 'cups');
    assert.equal(formatUnit('clove', 3), 'cloves');
    assert.equal(formatUnit('pinch', 2), 'pinches');
  });

  it('leaves abbreviations alone — `2 gs` reads as a bug', () => {
    assert.equal(formatUnit('g', 500), 'g');
    assert.equal(formatUnit('tbsp', 4), 'tbsp');
    assert.equal(formatUnit('ml', 60), 'ml');
  });

  it('keeps the singular for one, and for a quantity there is none of', () => {
    assert.equal(formatUnit('cup', 1), 'cup');
    assert.equal(formatUnit('cup', null), 'cup');
    assert.equal(formatUnit(undefined, 2), '');
  });
});
