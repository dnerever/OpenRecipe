import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changedLineNumbers } from './change-lines.ts';

const BASE = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].join('\n');

describe('the editor change gutter', () => {
  it('marks nothing when the draft still matches what was saved', () => {
    const { edited, deletedBefore } = changedLineNumbers(BASE, BASE);
    assert.equal(edited.size, 0);
    assert.equal(deletedBefore.size, 0);
  });

  it('marks nothing when there is no baseline — a new recipe has no history', () => {
    assert.equal(changedLineNumbers('', BASE).edited.size, 0);
  });

  it('marks the edited line, not its neighbours', () => {
    const doc = BASE.replace('charlie', 'CHARLIE');
    assert.deepEqual([...changedLineNumbers(BASE, doc).edited], [3]);
  });

  it('marks an inserted line and leaves the lines above it alone', () => {
    const doc = ['alpha', 'bravo', 'NEW', 'charlie', 'delta', 'echo'].join('\n');
    assert.deepEqual([...changedLineNumbers(BASE, doc).edited], [3]);
  });

  it('counts positions in the new document, so later edits do not drift', () => {
    // Two lines added up top, then a change at what used to be line 4.
    const doc = ['one', 'two', 'alpha', 'bravo', 'charlie', 'DELTA', 'echo'].join('\n');
    const { edited } = changedLineNumbers(BASE, doc);
    assert.ok(edited.has(6), `expected the changed line at 6, got ${[...edited]}`);
    assert.ok(!edited.has(4), 'must not mark the line at the pre-insert position');
  });

  it('puts a deletion marker on the line that closed the gap', () => {
    const doc = ['alpha', 'bravo', 'delta', 'echo'].join('\n');
    const { edited, deletedBefore } = changedLineNumbers(BASE, doc);
    assert.equal(edited.size, 0, 'a pure deletion adds no lines to mark');
    assert.deepEqual([...deletedBefore], [3]);
  });

  it('reports a trailing deletion one past the end, for the caller to drop', () => {
    const doc = ['alpha', 'bravo', 'charlie', 'delta'].join('\n');
    const { deletedBefore } = changedLineNumbers(BASE, doc);
    assert.deepEqual([...deletedBefore], [5]);
    assert.ok(5 > doc.split('\n').length, 'past the end of a 4-line document');
  });
});
