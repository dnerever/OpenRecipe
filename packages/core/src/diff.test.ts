import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeChange } from './describe-change.ts';
import { diffHunks, diffRecipes, diffText, hydration, scaleFactor, summarizeDiff } from './diff.ts';
import { parseRecipe } from './parse.ts';
import { scaleRecipe } from './scale.ts';
import { serializeRecipe } from './serialize.ts';
import type { SemanticChange } from './diff.ts';

const loaf = (overrides = '') =>
  parseRecipe(`---
schema: 1
title: Country Loaf
description: A sourdough loaf.
yield: { count: 2, unit: loaf }
time: { prep: 45m, total: 24h }
ingredients:
  - { qty: 900, unit: g, item: bread flour }
  - { qty: 100, unit: g, item: whole wheat flour }
  - { qty: 750, unit: g, item: water }
  - { qty: 20, unit: g, item: fine sea salt }
tags: [bread, sourdough]
equipment: [dutch oven]
---

## Mix

Combine the flours and water.

## Bake

Bake at 500°F for 20 minutes.
${overrides}`);

const kinds = (changes: SemanticChange[]) => changes.map((c) => c.kind);
const find = <K extends SemanticChange['kind']>(changes: SemanticChange[], kind: K) =>
  changes.find((c) => c.kind === kind) as Extract<SemanticChange, { kind: K }> | undefined;

describe('diffText', () => {
  it('reports identical documents as one context block', () => {
    const text = serializeRecipe(loaf());
    const result = diffText(text, text);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.type, 'context');
  });

  it('isolates a single changed line', () => {
    const before = serializeRecipe(loaf());
    const after = before.replace(
      'qty: 750, unit: g, item: water',
      'qty: 780, unit: g, item: water',
    );
    const changes = diffText(before, after).filter((c) => c.type === 'change');
    assert.equal(changes.length, 1);
    assert.match((changes[0] as { removed: string[] }).removed[0] ?? '', /750/);
    assert.match((changes[0] as { added: string[] }).added[0] ?? '', /780/);
  });

  it('collapses long runs of unchanged lines in the hunk view', () => {
    const before = serializeRecipe(loaf());
    const after = before.replace('Country Loaf', 'Country Bread');
    const collapsed = diffHunks(before, after, 2);
    assert.ok(
      collapsed.some(
        (c) => c.type === 'context' && c.lines.some((l) => l.includes('unchanged lines')),
      ),
    );
  });
});

describe('diffRecipes', () => {
  it('sees a rename', () => {
    const change = find(
      diffRecipes(
        loaf(),
        parseRecipe(serializeRecipe(loaf()).replace('Country Loaf', 'Country Bread')),
      ),
      'title',
    );
    assert.deepEqual([change?.from, change?.to], ['Country Loaf', 'Country Bread']);
  });

  it('sees an ingredient added and removed', () => {
    const before = loaf();
    const after = parseRecipe(
      serializeRecipe(before).replace(
        '  - { qty: 20, unit: g, item: fine sea salt }',
        '  - { qty: 20, unit: g, item: fine sea salt }\n  - { qty: 50, unit: g, item: rye flour }',
      ),
    );
    assert.ok(kinds(diffRecipes(before, after)).includes('ingredient-added'));
    assert.ok(kinds(diffRecipes(after, before)).includes('ingredient-removed'));
  });

  it('matches ingredients by name, so a quantity edit is a change not a swap', () => {
    const before = loaf();
    const after = parseRecipe(
      serializeRecipe(before).replace(
        'qty: 20, unit: g, item: fine sea salt',
        'qty: 22, unit: g, item: fine sea salt',
      ),
    );
    const change = find(diffRecipes(before, after), 'ingredient-changed');
    assert.ok(change);
    assert.deepEqual(change.fields, ['qty']);
    assert.equal(change.to.item, 'fine sea salt');
    assert.ok(!kinds(diffRecipes(before, after)).includes('ingredient-removed'));
  });

  it('distinguishes a note edit from a quantity edit', () => {
    const before = loaf();
    const after = parseRecipe(
      serializeRecipe(before).replace('item: water }', 'item: water, note: warm }'),
    );
    const change = find(diffRecipes(before, after), 'ingredient-changed');
    assert.deepEqual(change?.fields, ['note']);
  });

  it('sees tag and equipment changes', () => {
    const before = loaf();
    const after = parseRecipe(
      serializeRecipe(before)
        .replace('tags: [bread, sourdough]', 'tags: [bread, artisan]')
        .replace('equipment: [dutch oven]', 'equipment: [dutch oven, banneton]'),
    );
    const result = kinds(diffRecipes(before, after));
    assert.ok(
      result.includes('tag-added') &&
        result.includes('tag-removed') &&
        result.includes('equipment-added'),
    );
  });

  it('reports a reworded step rather than a delete plus an add', () => {
    const before = loaf();
    const after = parseRecipe(
      serializeRecipe(before).replace(
        'Bake at 500°F for 20 minutes.',
        'Bake at 475°F for 25 minutes.',
      ),
    );
    const result = diffRecipes(before, after);
    assert.ok(kinds(result).includes('step-reworded'));
    assert.ok(!kinds(result).includes('step-removed'));
  });

  it('reports an added phase', () => {
    const before = loaf();
    const after = parseRecipe(`${serializeRecipe(before)}\n## Cool\n\nCool completely.\n`);
    assert.ok(kinds(diffRecipes(before, after)).includes('phase-added'));
  });

  it('finds nothing when nothing changed', () => {
    assert.deepEqual(diffRecipes(loaf(), loaf()), []);
  });

  /**
   * Regression: identity used to be the item name alone, which collapsed the
   * two `bread flour` entries in a real levain-and-dough recipe. The Dough
   * flour then matched the Levain flour and a simple edit reported nonsense.
   */
  it('keeps ingredients distinct when the same item appears in two groups', () => {
    const grouped = `---
schema: 1
title: Levain Loaf
ingredients:
  - { qty: 100, unit: g, item: bread flour, group: Levain }
  - { qty: 100, unit: g, item: water, group: Levain }
  - { qty: 900, unit: g, item: bread flour, group: Dough }
  - { qty: 700, unit: g, item: water, group: Dough }
---

## Mix

Combine.
`;
    const before = parseRecipe(grouped);
    const after = parseRecipe(
      grouped.replace(
        '{ qty: 700, unit: g, item: water, group: Dough }',
        '{ qty: 750, unit: g, item: water, group: Dough }',
      ),
    );

    const changes = diffRecipes(before, after);
    const ingredientChanges = changes.filter((c) => c.kind === 'ingredient-changed');
    assert.equal(ingredientChanges.length, 1, 'only the Dough water moved');

    const change = find(changes, 'ingredient-changed');
    assert.equal(change?.from.group, 'Dough');
    assert.equal(change?.from.qty, 700);
    assert.equal(change?.to.qty, 750);
    assert.ok(!kinds(changes).includes('ingredient-removed'), 'nothing was removed');
    assert.ok(!kinds(changes).includes('ingredient-added'), 'nothing was added');
  });

  it('counts hydration across every group, levain included', () => {
    const doc = parseRecipe(`---
schema: 1
title: Levain Loaf
ingredients:
  - { qty: 100, unit: g, item: bread flour, group: Levain }
  - { qty: 100, unit: g, item: water, group: Levain }
  - { qty: 900, unit: g, item: bread flour, group: Dough }
  - { qty: 700, unit: g, item: water, group: Dough }
---

## Mix

Combine.
`);
    // 800g water over 1000g flour, not the Dough's 700/900 alone.
    assert.equal(hydration(doc.frontmatter.ingredients), 80);
  });
});

describe('hydration', () => {
  it('is water over total flour, by weight', () => {
    // 750g water / 1000g flour
    assert.equal(hydration(loaf().frontmatter.ingredients), 75);
  });

  it('surfaces the change a text diff cannot explain', () => {
    const before = loaf();
    const after = parseRecipe(
      serializeRecipe(before).replace(
        'qty: 750, unit: g, item: water',
        'qty: 780, unit: g, item: water',
      ),
    );
    const change = find(diffRecipes(before, after), 'hydration');
    assert.ok(change, 'expected a hydration change');
    assert.equal(change.from, 75);
    assert.equal(change.to, 78);
    assert.equal(describeChange(change), 'Hydration 75% → 78%');
  });

  it('stays quiet when there is no flour and water to speak of', () => {
    const cocktail = parseRecipe(
      '---\nschema: 1\ntitle: Negroni\ningredients:\n  - { qty: 30, unit: ml, item: gin }\n---\n\nStir.\n',
    );
    assert.equal(hydration(cocktail.frontmatter.ingredients), null);
    assert.ok(!kinds(diffRecipes(cocktail, cocktail)).includes('hydration'));
  });

  it('ignores volume measures rather than inventing a density', () => {
    const cups = parseRecipe(
      '---\nschema: 1\ntitle: X\ningredients:\n  - { qty: 3, unit: cup, item: flour }\n  - { qty: 1, unit: cup, item: water }\n---\n\nMix.\n',
    );
    assert.equal(hydration(cups.frontmatter.ingredients), null);
  });
});

describe('scaleFactor', () => {
  it('recognises a doubling', () => {
    const before = loaf();
    const after = scaleRecipe(before, 2);
    assert.equal(scaleFactor(before.frontmatter.ingredients, after.frontmatter.ingredients), 2);
  });

  it('tolerates the rounding the scaler applies', () => {
    const before = loaf();
    const after = scaleRecipe(before, 1.5);
    assert.equal(scaleFactor(before.frontmatter.ingredients, after.frontmatter.ingredients), 1.5);
  });

  it('returns null when only one ingredient moved', () => {
    const before = loaf();
    const after = parseRecipe(
      serializeRecipe(before).replace(
        'qty: 750, unit: g, item: water',
        'qty: 780, unit: g, item: water',
      ),
    );
    assert.equal(scaleFactor(before.frontmatter.ingredients, after.frontmatter.ingredients), null);
  });

  it('returns null when an ingredient was added', () => {
    const before = loaf();
    // Append inside the ingredient list — field order puts `tags` last, so
    // inserting before it would land after `equipment` and not parse.
    const after = parseRecipe(
      serializeRecipe(before).replace(
        '  - { qty: 20, unit: g, item: fine sea salt }',
        '  - { qty: 20, unit: g, item: fine sea salt }\n  - { qty: 5, unit: g, item: diastatic malt }',
      ),
    );
    assert.equal(after.frontmatter.ingredients.length, before.frontmatter.ingredients.length + 1);
    assert.equal(scaleFactor(before.frontmatter.ingredients, after.frontmatter.ingredients), null);
  });
});

describe('summarizeDiff', () => {
  it('collapses a rescale into one statement instead of four quantity edits', () => {
    const before = loaf();
    const after = scaleRecipe(before, 2);
    const raw = diffRecipes(before, after);
    assert.ok(raw.filter((c) => c.kind === 'ingredient-changed').length >= 4);

    const summary = summarizeDiff(raw, before, after);
    assert.equal(summary[0]?.kind, 'scaled');
    assert.equal(summary.filter((c) => c.kind === 'ingredient-changed').length, 0);
    assert.equal(describeChange(summary[0] as SemanticChange), 'Scaled the whole recipe 2×');
  });

  it('leaves an ordinary edit alone', () => {
    const before = loaf();
    const after = parseRecipe(serializeRecipe(before).replace('Country Loaf', 'Country Bread'));
    const raw = diffRecipes(before, after);
    assert.deepEqual(summarizeDiff(raw, before, after), raw);
  });
});

describe('describeChange', () => {
  it('renders every change kind as a sentence', () => {
    const before = loaf();
    const after = parseRecipe(
      serializeRecipe(before)
        .replace('Country Loaf', 'Country Bread')
        .replace('qty: 750, unit: g, item: water', 'qty: 800, unit: g, item: water')
        .replace('tags: [bread, sourdough]', 'tags: [bread]')
        .replace('Bake at 500°F for 20 minutes.', 'Bake at 460°F for 30 minutes.'),
    );
    for (const change of diffRecipes(before, after)) {
      const sentence = describeChange(change);
      assert.ok(sentence.length > 0, `${change.kind} produced nothing`);
      assert.ok(!sentence.includes('undefined'), `${change.kind}: ${sentence}`);
      assert.ok(!sentence.includes('[object'), `${change.kind}: ${sentence}`);
    }
  });
});
