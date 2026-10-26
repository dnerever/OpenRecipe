import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pageTitle } from './use-title.ts';

describe('pageTitle', () => {
  it('names the page first and the site last', () => {
    assert.equal(pageTitle('Tartine Country Loaf'), 'Tartine Country Loaf · OpenSkillet');
  });

  it('is just the site while there is nothing more specific', () => {
    assert.equal(pageTitle(undefined), 'OpenSkillet');
    assert.equal(pageTitle(''), 'OpenSkillet');
  });
});
