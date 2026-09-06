import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashContent } from './hash.ts';
import { parseRecipe } from './parse.ts';
import { serializeRecipe } from './serialize.ts';

describe('serializeRecipe', () => {
  it('emits fields in canonical order regardless of input order', () => {
    const scrambled = `---
license: MIT
tags: [b, a]
ingredients:
  - { item: salt, unit: g, qty: 5 }
title: Scrambled
schema: 1
yield: { unit: serving, count: 2 }
---

Step.
`;
    const out = serializeRecipe(parseRecipe(scrambled));
    const keys = out
      .split('\n')
      .filter((l) => /^[a-z]+:/.test(l))
      .map((l) => l.split(':')[0]);
    assert.deepEqual(keys, ['schema', 'title', 'yield', 'ingredients', 'tags', 'license']);
  });

  it('puts ingredient keys in a fixed order, one per line', () => {
    const doc = parseRecipe(`---
schema: 1
title: T
ingredients:
  - { group: Dough, item: water, note: warm, unit: g, qty: 750 }
---

Step.
`);
    assert.match(
      serializeRecipe(doc),
      /- \{ qty: 750, unit: g, item: water, note: warm, group: Dough \}/,
    );
  });

  it('always writes an explicit qty: null for to-taste ingredients', () => {
    const doc = parseRecipe(`---
schema: 1
title: T
ingredients:
  - { item: salt, note: to taste }
---

Step.
`);
    assert.match(serializeRecipe(doc), /\{ qty: null, item: salt, note: to taste \}/);
  });

  it('quotes scalars only when YAML needs it', () => {
    const doc = parseRecipe(`---
schema: 1
title: "yes"
description: "1:30 in the morning, maybe"
ingredients: []
---

Step.
`);
    const out = serializeRecipe(doc);
    assert.match(out, /title: "yes"/, 'a bare yes is a boolean under YAML 1.1');
    // Block context needs no quoting here; a bare `1:30` would, and does.
    assert.equal(parseRecipe(out).frontmatter.description, '1:30 in the morning, maybe');
    assert.deepEqual(parseRecipe(out).frontmatter.title, 'yes');
  });

  it('quotes a bare sexagesimal inside a flow value', () => {
    const doc = parseRecipe(`---
schema: 1
title: T
ingredients:
  - { qty: 1, unit: ea, item: egg, note: "1:30" }
---

Step.
`);
    assert.match(serializeRecipe(doc), /note: "1:30"/);
  });

  it('survives commas and braces inside flow values', () => {
    const doc = parseRecipe(`---
schema: 1
title: T
ingredients:
  - { qty: 1, unit: ea, item: "onion, halved", note: "or {two} shallots" }
---

Step.
`);
    const out = serializeRecipe(doc);
    assert.equal(parseRecipe(out).frontmatter.ingredients[0]?.item, 'onion, halved');
    assert.equal(parseRecipe(out).frontmatter.ingredients[0]?.note, 'or {two} shallots');
  });

  it('normalizes whitespace churn away, so the hash does not move', async () => {
    const base = `---
schema: 1
title: T
ingredients:
  - { qty: 1, unit: g, item: salt }
---

Step one.

Step two.
`;
    const churned = `---
schema: 1
title: T
ingredients:
  - {qty: 1, unit: g, item: salt}
---



Step one.   



Step two.

`;
    const a = serializeRecipe(parseRecipe(base));
    const b = serializeRecipe(parseRecipe(churned));
    assert.equal(a, b);
    assert.equal(
      await hashContent(a),
      await hashContent(b),
      'reformatting must not mint a new version',
    );
  });

  it('handles an empty ingredient list', () => {
    const doc = parseRecipe('---\nschema: 1\ntitle: T\ningredients: []\n---\n\nStep.\n');
    assert.match(serializeRecipe(doc), /^ingredients: \[\]$/m);
  });

  it('ends with exactly one newline', () => {
    const doc = parseRecipe('---\nschema: 1\ntitle: T\ningredients: []\n---\n\nStep.\n');
    const out = serializeRecipe(doc);
    assert.ok(out.endsWith('Step.\n'));
    assert.ok(!out.endsWith('\n\n'));
  });
});
