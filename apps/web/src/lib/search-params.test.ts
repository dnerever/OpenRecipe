import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSearch, stringifySearch } from './search-params.ts';

describe('search params', () => {
  it('writes a tag filter the way a person would', () => {
    assert.equal(stringifySearch({ q: '', tag: ['bread'] }), '?tag=bread');
    assert.equal(stringifySearch({ q: 'rye loaf', tag: ['a', 'b'] }), '?q=rye+loaf&tag=a&tag=b');
  });

  it('leaves out what is empty', () => {
    assert.equal(stringifySearch({ q: '', tag: [], sort: undefined }), '');
  });

  it('writes numbers and flags as plain text', () => {
    assert.equal(
      stringifySearch({ scale: 2, units: 'us', propose: true }),
      '?scale=2&units=us&propose=true',
    );
  });

  it('reads one value as a string and a repeated one as a list', () => {
    assert.deepEqual(parseSearch('?q=rye&tag=a&tag=b&step=3'), {
      q: 'rye',
      tag: ['a', 'b'],
      step: '3',
    });
  });

  it('round-trips', () => {
    const search = { q: 'olive oil & salt', tag: ['one-pan', 'vegan'] };
    assert.deepEqual(parseSearch(stringifySearch(search)), search);
  });
});
