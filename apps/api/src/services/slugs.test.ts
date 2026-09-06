import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RESERVED_SLUGS, slugify, validateSlug } from './slugs.ts';

describe('slugify', () => {
  const cases: [string, string][] = [
    ['Tartine Country Loaf', 'tartine-country-loaf'],
    ['Ragù alla Bolognese', 'ragu-alla-bolognese'],
    ['  Spaced   Out  ', 'spaced-out'],
    ['Century Egg & Pork Congee', 'century-egg-pork-congee'],
    ['粥', 'recipe'],
    ['', 'recipe'],
    ['---', 'recipe'],
    ['100% Whole Wheat', '100-whole-wheat'],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      assert.equal(slugify(input), expected);
    });
  }

  it('strips diacritics rather than dropping the letters', () => {
    assert.equal(slugify('Crème Brûlée'), 'creme-brulee');
  });

  it('never ends on a hyphen after truncation', () => {
    const slug = slugify('a'.repeat(59) + ' tail');
    assert.ok(slug.length <= 60);
    assert.ok(!slug.endsWith('-'));
  });
});

describe('validateSlug', () => {
  it('accepts a normal slug', () => {
    const result = validateSlug('tartine-country-loaf');
    assert.ok(result.ok);
    assert.equal(result.slug, 'tartine-country-loaf');
  });

  const bad: [string, RegExp][] = [
    ['', /needs a slug/],
    ['Has Spaces', /lowercase letters/],
    ['-leading', /start and end/],
    ['double--hyphen', /two hyphens/],
    ['raw', /reserved/],
    ['x'.repeat(61), /at most 60/],
  ];
  for (const [input, pattern] of bad) {
    it(`rejects ${JSON.stringify(input.slice(0, 20))}`, () => {
      const result = validateSlug(input);
      assert.ok(!result.ok);
      assert.match(result.reason, pattern);
    });
  }

  it('reserves the sub-routes a recipe owns', () => {
    for (const route of ['raw', 'edit', 'versions', 'forks', 'proposals']) {
      assert.ok(RESERVED_SLUGS.has(route), `${route} must be reserved`);
    }
  });
});
