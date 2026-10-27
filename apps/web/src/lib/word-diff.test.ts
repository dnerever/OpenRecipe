import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sideOf, wordDiff } from './word-diff.ts';

describe('wordDiff', () => {
  it('marks only the word that changed', () => {
    const parts = wordDiff(
      'Combine both flours with 700g of the water.',
      'Combine both flours with 730g of the water.',
    );
    assert.deepEqual(parts, [
      { kind: 'same', text: 'Combine both flours with ' },
      { kind: 'removed', text: '700g' },
      { kind: 'added', text: '730g' },
      { kind: 'same', text: ' of the water.' },
    ]);
  });

  it('keeps both sides intact', () => {
    const before = 'Preheat the oven. Score, bake covered 20 minutes.';
    const after = 'Preheat the oven to 500°F. Score about 1cm deep, bake covered 20 minutes.';
    const parts = wordDiff(before, after);
    assert.equal(sideOf(parts, 'before'), before);
    assert.equal(sideOf(parts, 'after'), after);
  });

  it('marks an insertion with nothing removed', () => {
    const parts = wordDiff('Rest the dough.', 'Rest the dough overnight.');
    assert.ok(parts.some((p) => p.kind === 'added' && p.text.includes('overnight')));
    assert.ok(!parts.some((p) => p.kind === 'removed'));
  });

  it('says nothing changed when nothing did', () => {
    assert.deepEqual(wordDiff('Same.', 'Same.'), [{ kind: 'same', text: 'Same.' }]);
  });
});
