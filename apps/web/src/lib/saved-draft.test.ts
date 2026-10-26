import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clearSavedDraft, readSavedDraft, savedWhen, writeSavedDraft } from './saved-draft.ts';

/** Just enough `Storage` for these functions. */
function memory(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe('saved drafts', () => {
  it('come back while the recipe is still the one they were written against', () => {
    const store = memory();
    writeSavedDraft(store, 'edit:a/b', { content: 'mine', base: 'v1', savedAt: 1 });
    assert.equal(readSavedDraft(store, 'edit:a/b', 'v1')?.content, 'mine');
    // The recipe moved on; restoring would undo what changed.
    assert.equal(readSavedDraft(store, 'edit:a/b', 'v2'), null);
  });

  it('are gone once cleared, and garbage is ignored', () => {
    const store = memory();
    writeSavedDraft(store, 'k', { content: 'x', base: 'b', savedAt: 1 });
    clearSavedDraft(store, 'k');
    assert.equal(readSavedDraft(store, 'k', 'b'), null);
    store.setItem('openrecipe:draft:k', '{not json');
    assert.equal(readSavedDraft(store, 'k', 'b'), null);
  });

  it('survive having no storage at all', () => {
    writeSavedDraft(null, 'k', { content: 'x', base: 'b', savedAt: 1 });
    assert.equal(readSavedDraft(null, 'k', 'b'), null);
  });
});

describe('savedWhen', () => {
  const now = Date.UTC(2026, 9, 25, 12, 0);
  it('speaks in minutes for the recent past', () => {
    assert.equal(savedWhen(now - 10_000, now), 'a moment ago');
    assert.equal(savedWhen(now - 60_000, now), '1 minute ago');
    assert.equal(savedWhen(now - 12 * 60_000, now), '12 minutes ago');
  });
});
