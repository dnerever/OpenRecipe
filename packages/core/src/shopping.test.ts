import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRecipe } from './parse.ts';
import { buildShoppingList, formatShoppingItem, formatShoppingList } from './shopping.ts';

const doc = parseRecipe(`---
schema: 1
title: Dinner
ingredients:
  - { qty: 500, unit: g, item: bread flour, group: Dough }
  - { qty: 250, unit: g, item: bread flour, group: Levain }
  - { qty: 2, unit: cloves, item: garlic }
  - { qty: 1, unit: clove, item: garlic }
  - { qty: null, item: salt, note: to taste }
  - { qty: 3, item: eggs }
  - { qty: 2, unit: tbsp, item: olive oil }
  - { qty: 100, unit: ml, item: olive oil }
---

Cook.
`);

const list = buildShoppingList(doc.frontmatter);
const find = (item: string) => list.find((i) => i.item.toLowerCase() === item);

describe('buildShoppingList', () => {
  it('collapses the groups a recipe needs and a shop does not', () => {
    assert.deepEqual(find('bread flour')?.amounts, [{ qty: 750, unit: 'g' }]);
  });

  it('sums across spellings of the same unit', () => {
    assert.deepEqual(find('garlic')?.amounts, [{ qty: 3, unit: 'clove' }]);
    assert.equal(formatShoppingItem(find('garlic') as never), '3 cloves garlic');
  });

  it('sums compatible units into one amount, in the kitchen the first one was written in', () => {
    assert.deepEqual(find('olive oil')?.amounts, [{ qty: 8.75, unit: 'tbsp' }]);
    assert.deepEqual(buildShoppingList(doc.frontmatter, 'metric').at(-1)?.amounts, [
      { qty: 130, unit: 'ml' },
    ]);
  });

  it('keeps mass and volume of the same thing apart', () => {
    const mixed = parseRecipe(`---
schema: 1
title: T
ingredients:
  - { qty: 100, unit: g, item: yoghurt }
  - { qty: 200, unit: ml, item: yoghurt }
---

Mix.
`);
    assert.deepEqual(buildShoppingList(mixed.frontmatter)[0]?.amounts, [
      { qty: 100, unit: 'g' },
      { qty: 200, unit: 'ml' },
    ]);
  });

  it('carries an unmeasured ingredient through with its note', () => {
    assert.equal(find('salt')?.unmeasured, true);
    assert.deepEqual(find('salt')?.amounts, []);
    assert.deepEqual(find('salt')?.notes, ['to taste']);
  });

  it('handles a bare count', () => {
    assert.deepEqual(find('eggs')?.amounts, [{ qty: 3 }]);
  });

  it('keeps the author’s order and spelling', () => {
    assert.deepEqual(
      list.map((i) => i.item),
      ['bread flour', 'garlic', 'salt', 'eggs', 'olive oil'],
    );
  });

  it('re-expresses everything in one system when asked', () => {
    const us = buildShoppingList(doc.frontmatter, 'us');
    assert.equal(us.find((i) => i.item === 'bread flour')?.amounts[0]?.unit, 'lb');
    assert.equal(us.find((i) => i.item === 'garlic')?.amounts[0]?.unit, 'clove');
  });
});

describe('formatShoppingList', () => {
  it('writes one line per item', () => {
    const text = formatShoppingList(list, 'Dinner');
    assert.match(text, /^Dinner\n\n- 750 g bread flour\n/);
    assert.match(text, /- 3 cloves garlic\n/);
    assert.match(text, /- 3 eggs\n/);
  });

  it('says what an unmeasured ingredient is, in the author’s own words', () => {
    assert.equal(formatShoppingItem(find('salt') as never), 'salt (to taste)');

    const garnish = parseRecipe(`---
schema: 1
title: T
ingredients:
  - { qty: null, item: rosemary, note: optional }
---

Cook.
`);
    assert.equal(
      formatShoppingItem(buildShoppingList(garnish.frontmatter)[0] as never),
      'rosemary (optional)',
    );
  });

  it('adds "plus more to taste" when an ingredient is both measured and not', () => {
    const both = parseRecipe(`---
schema: 1
title: T
ingredients:
  - { qty: 1, unit: tsp, item: salt }
  - { qty: null, item: salt, note: to taste }
---

Mix.
`);
    assert.equal(
      formatShoppingItem(buildShoppingList(both.frontmatter)[0] as never),
      '1 tsp salt, plus more to taste',
    );
  });
});
