import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attributionFor } from './attribution.ts';

describe('attributionFor', () => {
  it('names a publication it knows', () => {
    assert.equal(attributionFor('https://www.budgetbytes.com/classic-baked-ziti/'), 'Budget Bytes');
    assert.equal(
      attributionFor('https://itdoesnttastelikechicken.com/tofu-bolognese/#recipe'),
      "It Doesn't Taste Like Chicken",
    );
  });

  it('prefers the subdomain’s own name over the parent domain', () => {
    assert.equal(attributionFor('https://cooking.nytimes.com/recipes/1020981'), 'NYT Cooking');
  });

  it('walks up to the registrable domain for a redirector', () => {
    assert.equal(attributionFor('https://r.mealime.com/18824'), 'Mealime');
  });

  it('falls back to the hostname rather than guessing a title', () => {
    // Right and plain beats a made-up title-casing of an unknown domain.
    assert.equal(attributionFor('https://example-food-blog.net/x'), 'example-food-blog.net');
  });

  it('drops www', () => {
    assert.equal(attributionFor('https://www.example.org/x'), 'example.org');
  });

  it('is null for anything that is not an http URL', () => {
    assert.equal(attributionFor('in SA cookbook in Calibre'), null);
    assert.equal(attributionFor('javascript:alert(1)'), null);
    assert.equal(attributionFor(''), null);
  });
});
