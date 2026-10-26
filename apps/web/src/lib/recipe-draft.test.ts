import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRecipe, safeParseRecipe } from '@openrecipe/core';
import {
  blankDraft,
  draftFromDoc,
  draftToSource,
  ingredientPaths,
  parseQty,
} from './recipe-draft.ts';
import { STARTER_RECIPE } from './starter-recipe.ts';

const GROUPED = `---
schema: 1
title: Country Loaf
image: /api/media/abc
yield: { count: 2, unit: loaves }
time: { prep: 45m, total: 24h }
ingredients:
  - { qty: 100, unit: g, item: starter, group: Levain }
  - { qty: 100, unit: g, item: water, group: Levain }
  - { qty: 900, unit: g, item: bread flour, note: high protein, group: Dough }
  - { qty: null, item: rice flour, note: for dusting }
equipment: [dutch oven, banneton]
tags: [bread]
source: { url: "https://example.com/loaf", attribution: Tartine }
license: CC-BY-4.0
---

## Levain

Mix and rest overnight.

## Dough

Combine everything.

Fold every 30 minutes.
`;

describe('the form draft', () => {
  it('round-trips a canonical recipe to the identical text', () => {
    for (const text of [STARTER_RECIPE, GROUPED]) {
      const canonical = draftToSource(draftFromDoc(parseRecipe(text)));
      assert.equal(canonical, draftToSource(draftFromDoc(parseRecipe(canonical))));
      assert.deepEqual(parseRecipe(canonical), parseRecipe(text));
    }
  });

  it('keeps ingredient groups, in order, as consecutive runs', () => {
    const draft = draftFromDoc(parseRecipe(GROUPED));
    assert.deepEqual(
      draft.groups.map((g) => [g.name, g.items.length]),
      [
        ['Levain', 2],
        ['Dough', 1],
        ['', 1],
      ],
    );
  });

  it('carries fields it has no inputs for through untouched', () => {
    const doc = parseRecipe(draftToSource(draftFromDoc(parseRecipe(GROUPED))));
    assert.equal(doc.frontmatter.image, '/api/media/abc');
    assert.equal(doc.frontmatter.license, 'CC-BY-4.0');
    assert.deepEqual(doc.frontmatter.source, {
      url: 'https://example.com/loaf',
      attribution: 'Tartine',
    });
  });

  it('shows a body the step editor would change as Markdown instead', () => {
    const body = 'Mix.\n\n```\nline one\n\nline two\n```';
    const doc = parseRecipe(`---\nschema: 1\ntitle: T\n---\n\n${body}\n`);
    // The blank line inside the fence belongs to the step; one step per
    // paragraph cannot write it back without splitting the step in two.
    assert.equal(draftFromDoc(doc).method.kind, 'markdown');
  });

  it('a blank draft is not yet a recipe, and says why', () => {
    const result = safeParseRecipe(draftToSource(blankDraft()));
    assert.ok(!result.ok);
    assert.ok(result.issues.some((i) => i.path === 'title'));
  });

  it('a filled-in draft is a valid recipe, blank rows dropped', () => {
    const draft = blankDraft();
    draft.title = 'Toast';
    draft.time.prep = '5';
    const first = draft.groups[0]!.items[0]!;
    first.qty = '1 1/2';
    first.unit = 'slices';
    first.item = 'bread';
    draft.groups[0]!.items.push({ key: 'x', qty: '', unit: '', item: '', note: '' });
    assert.equal(draft.method.kind, 'steps');
    if (draft.method.kind === 'steps') draft.method.sections[0]!.steps[0]!.text = 'Toast it.';

    const doc = parseRecipe(draftToSource(draft));
    assert.equal(doc.frontmatter.ingredients.length, 1);
    assert.equal(doc.frontmatter.ingredients[0]!.qty, 1.5);
    assert.equal(doc.frontmatter.time?.prep, 5);
    assert.equal(doc.body, 'Toast it.');
  });

  it('a quantity it cannot read reaches the parser as typed, which rejects it', () => {
    const draft = blankDraft();
    draft.title = 'Toast';
    draft.groups[0]!.items[0]!.qty = 'a handful';
    draft.groups[0]!.items[0]!.item = 'bread';
    const result = safeParseRecipe(draftToSource(draft));
    assert.ok(!result.ok);
    assert.ok(result.issues.some((i) => i.path === 'ingredients.0.qty'));
  });

  it('maps ingredient indexes past blank rows', () => {
    const draft = draftFromDoc(parseRecipe(GROUPED));
    draft.groups[0]!.items.unshift({ key: 'blank', qty: '', unit: '', item: '', note: '' });
    const paths = ingredientPaths(draft);
    assert.equal(paths.get(0), draft.groups[0]!.items[1]!.key);
    assert.equal(paths.size, 4);
  });
});

describe('parseQty', () => {
  it('reads what cooks write', () => {
    assert.equal(parseQty('2'), 2);
    assert.equal(parseQty('1.5'), 1.5);
    assert.equal(parseQty('1,5'), 1.5);
    assert.equal(parseQty('1/2'), 0.5);
    assert.equal(parseQty('1 1/2'), 1.5);
    assert.equal(parseQty('1½'), 1.5);
    assert.equal(parseQty('¼'), 0.25);
  });

  it('blank is no quantity; nonsense is not a quantity', () => {
    assert.equal(parseQty('  '), null);
    assert.equal(parseQty('some'), undefined);
    assert.equal(parseQty('1/0'), undefined);
    assert.equal(parseQty('-2'), undefined);
  });
});
