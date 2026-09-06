import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveSteps, safeParseRecipe, serializeRecipe } from '@openrecipe/core';
import { STARTER_RECIPE } from './starter-recipe.ts';

describe('the starter recipe', () => {
  it('parses — otherwise /new opens on a screen of errors', () => {
    const result = safeParseRecipe(STARTER_RECIPE);
    if (!result.ok) {
      assert.fail(result.issues.map((i) => `${i.path}: ${i.message}`).join('\n'));
    }
  });

  it('is already canonical, so the editor does not silently reformat it', () => {
    const result = safeParseRecipe(STARTER_RECIPE);
    assert.ok(result.ok);
    assert.equal(serializeRecipe(result.doc), STARTER_RECIPE);
  });

  it('shows off the format: yield, times, groups-free ingredients, phases', () => {
    const result = safeParseRecipe(STARTER_RECIPE);
    assert.ok(result.ok);
    const fm = result.doc.frontmatter;
    assert.ok(fm.yield, 'a beginner should see how yield is written');
    assert.ok(fm.time?.total, 'and how a total time is written');
    assert.ok(fm.ingredients.length >= 4);
    assert.ok(
      fm.ingredients.some((i) => i.qty === null),
      'should demonstrate a non-scalable ingredient',
    );
    assert.ok(deriveSteps(result.doc).length >= 2, 'should demonstrate `##` phases');
  });

  it('contains no animal products', () => {
    const result = safeParseRecipe(STARTER_RECIPE);
    assert.ok(result.ok);

    const animal =
      /\b(butter|egg|eggs|milk|cream|honey|cheese|lard|gelatin|yoghurt|yogurt|whey|casein)\b/i;
    const offending = result.doc.frontmatter.ingredients.filter((i) => animal.test(i.item));
    assert.deepEqual(offending, [], 'starter recipe should stay vegan');
    assert.doesNotMatch(result.doc.body, animal, 'the method text mentions an animal product');
  });
});
