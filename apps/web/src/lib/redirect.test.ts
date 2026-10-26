import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { safeRedirect } from './redirect.ts';

describe('safeRedirect', () => {
  it('keeps a path on this site, query and all', () => {
    assert.equal(safeRedirect('/alice/loaf?scale=2'), '/alice/loaf?scale=2');
    assert.equal(safeRedirect('/new'), '/new');
  });

  it('refuses anything a browser would take to another host', () => {
    for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', 'evil.test', '']) {
      assert.equal(safeRedirect(value), undefined, value);
    }
  });

  it('refuses the sign-in page itself, and anything that is not a string', () => {
    assert.equal(safeRedirect('/signin'), undefined);
    assert.equal(safeRedirect('/signin?redirect=/new'), undefined);
    assert.equal(safeRedirect(['/new']), undefined);
    assert.equal(safeRedirect(undefined), undefined);
  });
});
