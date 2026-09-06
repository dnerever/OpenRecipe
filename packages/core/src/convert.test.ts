import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  convertFrontmatter,
  convertIngredient,
  convertQuantity,
  detectSystem,
  roundQuantity,
} from './convert.ts';
import { parseRecipe } from './parse.ts';

describe('convertQuantity', () => {
  it('converts within a dimension', () => {
    assert.equal(convertQuantity(1, 'kg', 'g'), 1000);
    assert.equal(convertQuantity(2, 'cup', 'ml'), 473);
    assert.equal(convertQuantity(3, 'tsp', 'tbsp'), 1);
  });

  it('refuses to turn mass into volume — that needs a density we do not have', () => {
    assert.equal(convertQuantity(100, 'g', 'ml'), null);
    assert.equal(convertQuantity(1, 'cup', 'g'), null);
  });

  it('returns null for a unit it does not know', () => {
    assert.equal(convertQuantity(2, 'knob', 'g'), null);
    assert.equal(convertQuantity(2, 'clove', 'ea'), null);
  });
});

describe('convertIngredient', () => {
  const metric = (ing: Parameters<typeof convertIngredient>[0]) => convertIngredient(ing, 'metric');
  const us = (ing: Parameters<typeof convertIngredient>[0]) => convertIngredient(ing, 'us');

  it('climbs the ladder as the amount grows', () => {
    assert.deepEqual(metric({ qty: 2000, unit: 'g', item: 'flour' }), {
      qty: 2,
      unit: 'kg',
      item: 'flour',
    });
    assert.deepEqual(metric({ qty: 1500, unit: 'ml', item: 'stock' }), {
      qty: 1.5,
      unit: 'l',
      item: 'stock',
    });
  });

  it('crosses systems both ways', () => {
    assert.deepEqual(us({ qty: 250, unit: 'ml', item: 'milk' }), {
      qty: 1,
      unit: 'cup',
      item: 'milk',
    });
    assert.deepEqual(metric({ qty: 8, unit: 'oz', item: 'butter' }), {
      qty: 227,
      unit: 'g',
      item: 'butter',
    });
  });

  it('picks the unit a cook would reach for, not the biggest one', () => {
    assert.equal(us({ qty: 15, unit: 'ml', item: 'oil' }).unit, 'tbsp');
    assert.equal(us({ qty: 5, unit: 'ml', item: 'vanilla' }).unit, 'tsp');
  });

  it('never converts a spoon away — every kitchen owns a teaspoon', () => {
    const tsp = { qty: 1, unit: 'tsp', item: 'baking soda' };
    const tbsp = { qty: 2, unit: 'tbsp', item: 'sugar' };
    assert.equal(metric(tsp), tsp);
    assert.equal(metric(tbsp), tbsp);
    assert.equal(us(tsp), tsp);
  });

  it('leaves alone what it cannot honestly convert', () => {
    const cloves = { qty: 2, unit: 'clove', item: 'garlic' };
    assert.equal(metric(cloves), cloves);
    const toTaste = { qty: null, item: 'salt' };
    assert.equal(us(toTaste), toTaste);
    const knob = { qty: 1, unit: 'knob', item: 'butter' };
    assert.equal(metric(knob), knob);
  });

  it('returns the same object when the unit is already the right one', () => {
    const ing = { qty: 500, unit: 'g', item: 'flour' };
    assert.equal(metric(ing), ing);
  });

  it('never rounds a real quantity away to nothing', () => {
    assert.ok((us({ qty: 0.2, unit: 'ml', item: 'extract' }).qty ?? 0) > 0);
  });
});

describe('convertFrontmatter', () => {
  const doc = parseRecipe(`---
schema: 1
title: Pancakes
yield: { count: 12, unit: pancake }
ingredients:
  - { qty: 250, unit: g, item: flour }
  - { qty: 300, unit: ml, item: milk }
  - { qty: 2, item: eggs }
---

Mix.
`);

  it('converts every ingredient and nothing else', () => {
    const converted = convertFrontmatter(doc.frontmatter, 'us');
    assert.deepEqual(
      converted.ingredients.map((i) => i.unit),
      ['oz', 'cup', undefined],
    );
    assert.deepEqual(converted.yield, doc.frontmatter.yield);
    assert.equal(converted.title, 'Pancakes');
  });

  it('does not mutate the original', () => {
    const before = JSON.stringify(doc.frontmatter);
    convertFrontmatter(doc.frontmatter, 'us');
    assert.equal(JSON.stringify(doc.frontmatter), before);
  });
});

describe('roundQuantity', () => {
  it('snaps spoons and cups to the fractions the measures are marked in', () => {
    assert.equal(roundQuantity(1.057, 'cup'), 1);
    assert.equal(roundQuantity(0.66, 'tsp'), 0.667);
  });

  it('loses precision as magnitude grows', () => {
    assert.equal(roundQuantity(236.588, 'ml'), 237);
    assert.equal(roundQuantity(44.36, 'ml'), 44.4);
    assert.equal(roundQuantity(2.4644, 'ml'), 2.46);
  });
});

describe('detectSystem', () => {
  const of = (ingredients: string) =>
    detectSystem(
      parseRecipe(`---\nschema: 1\ntitle: T\ningredients:\n${ingredients}---\n\nCook.\n`)
        .frontmatter,
    );

  it('reads the kitchen off the units the author used', () => {
    assert.equal(of('  - { qty: 500, unit: g, item: flour }\n'), 'metric');
    assert.equal(of('  - { qty: 2, unit: cups, item: flour }\n'), 'us');
    assert.equal(of('  - { qty: 8, unit: oz, item: butter }\n'), 'us');
  });

  it('does not let a teaspoon of vanilla make a metric recipe American', () => {
    assert.equal(
      of('  - { qty: 1, unit: tsp, item: vanilla }\n  - { qty: 500, unit: g, item: flour }\n'),
      'metric',
    );
  });

  it('goes with the majority when a recipe mixes systems', () => {
    assert.equal(
      of(
        '  - { qty: 2, unit: cups, item: flour }\n' +
          '  - { qty: 1, unit: cup, item: milk }\n' +
          '  - { qty: 20, unit: g, item: salt }\n',
      ),
      'us',
    );
  });

  it('falls back to metric when nothing says otherwise', () => {
    assert.equal(of('  - { qty: 2, unit: cloves, item: garlic }\n'), 'metric');
    assert.equal(of('  - { qty: null, item: salt }\n'), 'metric');
  });
});
