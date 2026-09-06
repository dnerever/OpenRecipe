import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashContent, hashRecipe } from './hash.ts';
import { parseRecipe } from './parse.ts';
import { serializeRecipe } from './serialize.ts';

const source = `---
schema: 1
title: T
ingredients:
  - { qty: 1, unit: g, item: salt }
---

Step.
`;

describe('hashContent', () => {
  it('matches the known SHA-256 of an empty string', async () => {
    assert.equal(
      await hashContent(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('is 64 lowercase hex characters', async () => {
    assert.match(await hashContent(source), /^[0-9a-f]{64}$/);
  });

  it('changes when the content changes', async () => {
    assert.notEqual(await hashContent(source), await hashContent(source.replace('salt', 'sugar')));
  });
});

describe('hashRecipe', () => {
  it('hashes the normalized form, not the input text', async () => {
    const messy = source.replace(
      '- { qty: 1, unit: g, item: salt }',
      '- {qty: 1,   unit: g,  item: salt}',
    );
    assert.equal(await hashRecipe(parseRecipe(source)), await hashRecipe(parseRecipe(messy)));
  });

  it('equals hashing the serialized document', async () => {
    const doc = parseRecipe(source);
    assert.equal(await hashRecipe(doc), await hashContent(serializeRecipe(doc)));
  });

  it('moves when a real edit lands', async () => {
    const before = await hashRecipe(parseRecipe(source));
    const after = await hashRecipe(parseRecipe(source.replace('qty: 1', 'qty: 2')));
    assert.notEqual(before, after);
  });
});
