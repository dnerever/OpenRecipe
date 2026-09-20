import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTicked, tickKey } from './use-ticked.ts';

describe('parseTicked', () => {
  it('reads back the ticks it was given', () => {
    assert.deepEqual([...parseTicked('{"n":4,"ticked":[0,2]}', 4)], [0, 2]);
  });

  it('starts clean when this browser has never seen the recipe', () => {
    assert.equal(parseTicked(null, 4).size, 0);
  });

  /**
   * The case the count is there for: an edit inserts an ingredient, every
   * index after it now means a different line, and a tick against the wrong
   * line is worse than no tick at all.
   */
  it('drops the lot when the list is no longer the length it was', () => {
    assert.equal(parseTicked('{"n":4,"ticked":[0,2]}', 5).size, 0);
  });

  it('ignores an index that is not on the list', () => {
    assert.deepEqual([...parseTicked('{"n":3,"ticked":[-1,0,3,99]}', 3)], [0]);
  });

  it('survives a key someone has edited by hand', () => {
    for (const raw of ['', 'null', '[]', '{}', 'not json', '{"n":3,"ticked":"all"}']) {
      assert.equal(parseTicked(raw, 3).size, 0, raw);
    }
  });

  it('ignores entries that are not indices', () => {
    assert.deepEqual([...parseTicked('{"n":3,"ticked":[0,"1",null,1.5,2]}', 3)], [0, 2]);
  });

  it('keys one recipe apart from another', () => {
    assert.notEqual(tickKey('ada', 'loaf'), tickKey('bob', 'loaf'));
    assert.equal(tickKey('ada', 'loaf'), 'ticked:ada/loaf');
  });
});
