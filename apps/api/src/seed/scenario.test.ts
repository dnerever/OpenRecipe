import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyChange, fixture, simulate } from './scenario.ts';

describe('the demo seed scenario', () => {
  it('replays cleanly against the current fixtures', () => {
    const { proposals } = simulate();
    assert.deepEqual(
      proposals.map((p) => [p.of, p.merge]),
      [
        ['tartine-country-loaf', false],
        ['focaccia', true],
      ],
    );
  });

  it('makes the open proposal a real three-way merge, not a fast-forward', () => {
    const loaf = simulate().proposals.find((p) => p.of === 'tartine-country-loaf');
    assert.equal(loaf?.kind, 'merged');
  });

  it('refuses an edit that does not match exactly once', () => {
    assert.throws(
      () =>
        applyChange(
          fixture('focaccia'),
          { message: 'x', edits: [{ find: 'nowhere', replace: 'y' }] },
          'focaccia',
        ),
      /expected exactly one "nowhere", found 0/,
    );
  });

  it('refuses a change that leaves the recipe as it was', () => {
    assert.throws(
      () =>
        applyChange(
          fixture('focaccia'),
          {
            message: 'noop',
            edits: [{ find: 'title: Overnight Focaccia', replace: 'title: Overnight Focaccia' }],
          },
          'focaccia',
        ),
      /changes nothing/,
    );
  });
});
