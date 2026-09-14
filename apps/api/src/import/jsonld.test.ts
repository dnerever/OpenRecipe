import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { safeParseRecipe } from '@openrecipe/core';
import {
  findRecipeNode,
  imageFrom,
  instructionsFrom,
  isoMinutes,
  NotARecipeError,
  plainText,
  tagsFrom,
  tidyIngredientLine,
  toRecipeDocument,
  yieldFrom,
} from './jsonld.ts';

/**
 * The fixtures are the JSON-LD three real sites actually served, saved so these
 * tests never touch the network. Between them they cover the three instruction
 * shapes in the wild.
 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, `${name}.html`), 'utf8');

function convert(name: string, url: string) {
  const node = findRecipeNode(fixture(name));
  assert.ok(node, `no Recipe node in ${name}`);
  return toRecipeDocument(node, { url });
}

describe('finding the recipe in a page', () => {
  it('reads a WP Recipe Maker page', () => {
    const node = findRecipeNode(fixture('itdoesnttastelikechicken'));
    assert.equal(node?.['name'], 'Baked Tofu Bites');
  });

  it('digs the recipe out of an @graph', () => {
    const node = findRecipeNode(fixture('sweetpeasandsaffron'));
    assert.equal(node?.['name'], 'Blueberry Baked Oatmeal');
  });

  it('is null for a page with no recipe on it', () => {
    assert.equal(findRecipeNode('<html><body><p>Just a blog post.</p></body></html>'), null);
  });

  it('survives a page whose JSON-LD does not parse', () => {
    const html = `<script type="application/ld+json">{ oops </script>
      <script type="application/ld+json">{"@type":"Recipe","name":"Fine"}</script>`;
    assert.equal(findRecipeNode(html)?.['name'], 'Fine');
  });

  it('follows an author @id to the name elsewhere in the graph', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@graph': [
        { '@type': 'Person', '@id': 'https://x.test/#me', name: 'Sam Cook' },
        {
          '@type': 'Recipe',
          name: 'Stew',
          author: { '@id': 'https://x.test/#me' },
          recipeIngredient: ['a'],
        },
      ],
    })}</script>`;
    const author = findRecipeNode(html)?.['author'] as Record<string, unknown> | undefined;
    assert.equal(author?.['name'], 'Sam Cook');
  });

  it('credits the cook rather than the domain on a real Yoast page', () => {
    const author = findRecipeNode(fixture('itdoesnttastelikechicken'))?.['author'] as
      Record<string, unknown> | undefined;
    assert.equal(typeof author?.['name'], 'string');
    assert.ok((author?.['name'] as string).length > 0);
  });

  it('prefers the node with the most ingredients when a page has several', () => {
    const html = `<script type="application/ld+json">${JSON.stringify([
      { '@type': 'Recipe', name: 'Mentioned in passing', recipeIngredient: ['salt'] },
      { '@type': 'Recipe', name: 'The actual recipe', recipeIngredient: ['a', 'b', 'c'] },
    ])}</script>`;
    assert.equal(findRecipeNode(html)?.['name'], 'The actual recipe');
  });
});

describe('instructions', () => {
  it('reads HowToStep objects', () => {
    const steps = instructionsFrom([
      { '@type': 'HowToStep', text: 'Preheat the oven.' },
      { '@type': 'HowToStep', text: 'Bake.' },
    ]);
    assert.deepEqual(steps, ['Preheat the oven.', 'Bake.']);
  });

  it('reads a list of bare strings', () => {
    assert.deepEqual(instructionsFrom(['Mix.', 'Rest.']), ['Mix.', 'Rest.']);
  });

  /**
   * The one that silently loses a whole method if it is not handled: a recipe
   * written in parts nests its steps one level down.
   */
  it('flattens HowToSection, rather than dropping the method', () => {
    const steps = instructionsFrom([
      {
        '@type': 'HowToSection',
        name: 'For the cake',
        itemListElement: [
          { '@type': 'HowToStep', text: 'Cream the butter.' },
          { '@type': 'HowToStep', text: 'Fold in the flour.' },
        ],
      },
      {
        '@type': 'HowToSection',
        name: 'For the icing',
        itemListElement: [{ '@type': 'HowToStep', text: 'Beat until smooth.' }],
      },
    ]);
    assert.deepEqual(steps, ['Cream the butter.', 'Fold in the flour.', 'Beat until smooth.']);
  });

  it('strips the markup sites leave in step text', () => {
    assert.equal(
      plainText('Bake at <strong>350&deg;F</strong> &amp; rest.<br>Serve.'),
      'Bake at 350°F & rest. Serve.',
    );
  });
});

describe('ingredient lines', () => {
  it('collapses a doubled parenthetical to one', () => {
    assert.equal(
      tidyIngredientLine('½ teaspoon crushed red pepper flakes ((optional for kick))'),
      '½ teaspoon crushed red pepper flakes (optional for kick)',
    );
  });

  it('folds a leading inner group into the note rather than splitting it', () => {
    assert.equal(
      tidyIngredientLine(
        '1 1/4 pounds mixed mushrooms ((such as oyster, king oyster, cremini, shiitake, or portobello), torn or sliced)',
      ),
      '1 1/4 pounds mixed mushrooms (such as oyster, king oyster, cremini, shiitake, or portobello, torn or sliced)',
    );
  });

  it('turns a group further in into a clause of the note', () => {
    assert.equal(
      tidyIngredientLine("1 397g box frozen puff pastry (thawed (check to make sure it's vegan))"),
      "1 397g box frozen puff pastry (thawed, check to make sure it's vegan)",
    );
  });

  it('leaves an ordinary line alone', () => {
    assert.equal(tidyIngredientLine('4 shallots (finely chopped)'), '4 shallots (finely chopped)');
    assert.equal(tidyIngredientLine('Peanut butter (75g)'), 'Peanut butter (75g)');
    assert.equal(tidyIngredientLine('2 cups flour'), '2 cups flour');
  });

  it('gives the parser a line it can read end to end', () => {
    const { content } = toRecipeDocument(
      {
        '@type': 'Recipe',
        name: 'Mussels',
        recipeIngredient: [
          '1 1/4 pounds mixed mushrooms ((such as oyster, king oyster, cremini, shiitake, or portobello), torn or sliced)',
        ],
        recipeInstructions: ['Cook.'],
      },
      { url: 'https://x.test/mussels' },
    );
    const parsed = safeParseRecipe(content);
    assert.ok(parsed.ok);
    const [ingredient] = parsed.doc.frontmatter.ingredients;
    assert.equal(ingredient?.qty, 1.25);
    assert.equal(ingredient?.unit, 'lb');
    assert.equal(ingredient?.item, 'mixed mushrooms');
    assert.match(ingredient?.note ?? '', /king oyster/);
    assert.match(ingredient?.note ?? '', /torn or sliced/);
  });
});

describe('durations', () => {
  it('reads ISO 8601', () => {
    assert.equal(isoMinutes('PT40M'), 40);
    assert.equal(isoMinutes('PT3H0M'), 180);
    assert.equal(isoMinutes('PT1H30M'), 90);
    assert.equal(isoMinutes('P1DT2H'), 1560);
  });

  it('is null for nonsense rather than zero', () => {
    assert.equal(isoMinutes('soon'), null);
    assert.equal(isoMinutes('PT0M'), null);
    assert.equal(isoMinutes(undefined), null);
  });
});

describe('yield', () => {
  it('treats a bare number as servings', () => {
    assert.deepEqual(yieldFrom(['4']), { count: 4, unit: 'serving' });
  });

  it('takes the unit the site wrote, singular', () => {
    assert.deepEqual(yieldFrom(['12 muffins']), { count: 12, unit: 'muffin' });
    assert.deepEqual(yieldFrom(['16 servings', 'one 8” two-layer cake']), {
      count: 16,
      unit: 'serving',
    });
  });

  it('drops a yield with no number rather than inventing one', () => {
    assert.equal(yieldFrom(['a big bowl']), null);
    assert.equal(yieldFrom(undefined), null);
  });
});

describe('images and tags', () => {
  it('finds a URL in any of the containers sites use', () => {
    assert.equal(imageFrom('https://x.test/a.jpg'), 'https://x.test/a.jpg');
    assert.equal(imageFrom(['https://x.test/b.jpg']), 'https://x.test/b.jpg');
    assert.equal(
      imageFrom({ '@type': 'ImageObject', url: 'https://x.test/c.jpg' }),
      'https://x.test/c.jpg',
    );
  });

  it('splits keywords on commas and on semicolons', () => {
    assert.deepEqual(tagsFrom({ keywords: 'vegan, tofu' }), ['vegan', 'tofu']);
    assert.deepEqual(tagsFrom({ keywords: 'Layer cake;;Chocolate' }), ['layer cake', 'chocolate']);
  });

  it('drops the SEO sentences that share the keywords field', () => {
    const tags = tagsFrom({ keywords: 'tofu, how to cook tofu in the oven for beginners' });
    assert.deepEqual(tags, ['tofu']);
  });
});

describe('the document it produces', () => {
  it('parses as a valid recipe, from every fixture', () => {
    for (const [name, url] of [
      ['itdoesnttastelikechicken', 'https://itdoesnttastelikechicken.com/baked-tofu-bites/'],
      ['kingarthurbaking', 'https://www.kingarthurbaking.com/recipes/classic-birthday-cake-recipe'],
      ['sweetpeasandsaffron', 'https://sweetpeasandsaffron.com/blueberry-baked-oatmeal/'],
    ] as const) {
      const { content } = convert(name, url);
      const parsed = safeParseRecipe(content);
      assert.ok(parsed.ok, `${name}: ${parsed.ok ? '' : JSON.stringify(parsed.issues)}`);
    }
  });

  it('carries the whole recipe across', () => {
    const { content, title } = convert(
      'itdoesnttastelikechicken',
      'https://itdoesnttastelikechicken.com/baked-tofu-bites/',
    );
    assert.equal(title, 'Baked Tofu Bites');

    const parsed = safeParseRecipe(content);
    assert.ok(parsed.ok);
    const fm = parsed.doc.frontmatter;
    assert.equal(fm.ingredients.length, 5);
    assert.deepEqual(fm.yield, { count: 4, unit: 'serving' });
    assert.equal(fm.time?.total, 40);
    assert.match(parsed.doc.body, /^1\. Oven: Preheat/);
    assert.equal(parsed.doc.body.split(/\n\n/).length, 5);
  });

  it('records where it came from, so attribution survives', () => {
    const { content } = convert(
      'kingarthurbaking',
      'https://www.kingarthurbaking.com/recipes/classic-birthday-cake-recipe',
    );
    const parsed = safeParseRecipe(content);
    assert.ok(parsed.ok);
    assert.equal(
      parsed.doc.frontmatter.source?.url,
      'https://www.kingarthurbaking.com/recipes/classic-birthday-cake-recipe',
    );
    // The byline the page published, not the domain guess.
    assert.equal(parsed.doc.frontmatter.source?.attribution, 'Charlotte Rutledge');
  });

  it('reads a site that writes its steps as bare strings', () => {
    const { content } = convert(
      'kingarthurbaking',
      'https://www.kingarthurbaking.com/recipes/classic-birthday-cake-recipe',
    );
    const parsed = safeParseRecipe(content);
    assert.ok(parsed.ok);
    assert.equal(parsed.doc.body.split(/\n\n/).length, 17);
    assert.equal(parsed.doc.frontmatter.ingredients.length, 16);
  });

  it('prefers the name the person saved it under over the page title', () => {
    const node = findRecipeNode(fixture('itdoesnttastelikechicken'));
    assert.ok(node);
    const { title, content } = toRecipeDocument(node, {
      url: 'https://itdoesnttastelikechicken.com/baked-tofu-bites/',
      title: 'Tofu Bites',
    });
    assert.equal(title, 'Tofu Bites');
    const parsed = safeParseRecipe(content);
    assert.ok(parsed.ok);
    assert.equal(parsed.doc.frontmatter.title, 'Tofu Bites');
  });

  it('keeps the tags the bookmark already carried', () => {
    const node = findRecipeNode(fixture('itdoesnttastelikechicken'));
    assert.ok(node);
    const { content } = toRecipeDocument(node, {
      url: 'https://itdoesnttastelikechicken.com/baked-tofu-bites/',
      tags: ['Vegan'],
    });
    const parsed = safeParseRecipe(content);
    assert.ok(parsed.ok);
    assert.ok(parsed.doc.frontmatter.tags?.includes('vegan'));
  });

  it('refuses a page with no method, which is what a roundup looks like', () => {
    assert.throws(
      () =>
        toRecipeDocument(
          { '@type': 'Recipe', name: 'Five great dinners', recipeIngredient: ['a', 'b'] },
          { url: 'https://x.test/roundup' },
        ),
      NotARecipeError,
    );
  });

  it('refuses a page with no ingredients', () => {
    assert.throws(
      () =>
        toRecipeDocument(
          { '@type': 'Recipe', name: 'Vibes', recipeInstructions: ['Cook it.'] },
          { url: 'https://x.test/vibes' },
        ),
      NotARecipeError,
    );
  });

  it('keeps an unreadable ingredient line whole rather than inventing an amount', () => {
    const { content, warnings } = toRecipeDocument(
      {
        '@type': 'Recipe',
        name: 'Loose',
        recipeIngredient: ['2 cups flour', 'salt, to taste'],
        recipeInstructions: ['Mix.'],
      },
      { url: 'https://x.test/loose' },
    );
    const parsed = safeParseRecipe(content);
    assert.ok(parsed.ok);
    const loose = parsed.doc.frontmatter.ingredients.find((i) => i.qty === null);
    assert.ok(loose, 'the unparsed line should survive with no quantity');
    assert.match(loose.item, /salt/);
    assert.ok(warnings.some((w) => w.includes('no quantity')));
  });
});
