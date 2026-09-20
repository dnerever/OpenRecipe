import { parseRecipe, safeParseRecipe } from '@openrecipe/core';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseNotionPage, splitBody, toRecipe } from './notion.ts';

const IMPORTED_ON = '2026-09-06';

function convert(text: string) {
  return toRecipe(parseNotionPage(text), { importedOn: IMPORTED_ON });
}

describe('parseNotionPage', () => {
  it('reads the title and the property block', () => {
    const page = parseNotionPage(
      [
        '# Dal Recipe',
        '',
        'Tags: Dinner, Vegan',
        'Link: https://example.com/dal',
        'Rating: 5',
        '',
        'Body text.',
      ].join('\n'),
    );
    assert.equal(page.title, 'Dal Recipe');
    assert.deepEqual(page.props, {
      Tags: 'Dinner, Vegan',
      Link: 'https://example.com/dal',
      Rating: '5',
    });
    assert.equal(page.body, 'Body text.');
  });

  it('stops the property block at the first line that is not a column', () => {
    // The bread-machine page really does start `Water: 240 ml`. Treating any
    // `Key: value` line as a property loses the entire ingredient list.
    const page = parseNotionPage(
      [
        '# Bread',
        '',
        'Tags: Bread',
        'Made: Yes',
        '',
        'Water: 240 ml',
        '',
        'Bread Flour: 480 g',
      ].join('\n'),
    );
    assert.deepEqual(page.props, { Tags: 'Bread', Made: 'Yes' });
    assert.match(page.body, /^Water: 240 ml/);
  });

  it('ignores empty property values', () => {
    const page = parseNotionPage(['# X', '', 'Tags: Vegan', 'Rating: ', '', 'Body.'].join('\n'));
    assert.deepEqual(page.props, { Tags: 'Vegan' });
  });
});

describe('splitBody', () => {
  it('divides on explicit headings', () => {
    const split = splitBody(
      [
        '### Ingredients',
        '',
        '- 1 cup flour',
        '- 2 tsp salt',
        '',
        '### Instructions',
        '',
        '- Mix.',
        '- Bake.',
      ].join('\n'),
    );
    assert.deepEqual(split.ingredients, [
      { qty: 1, unit: 'cup', item: 'flour' },
      { qty: 2, unit: 'tsp', item: 'salt' },
    ]);
    assert.equal(split.body, '- Mix.\n- Bake.');
  });

  it('does not name a phase after a bare Instructions heading', () => {
    const split = splitBody(['## Instructions', '', 'Mix it.'].join('\n'));
    assert.equal(split.body, 'Mix it.');
  });

  it('keeps a named phase heading', () => {
    const split = splitBody(
      ['## Instructions', '', 'Mix.', '', '## Nutrition', '', '500 kcal'].join('\n'),
    );
    assert.match(split.body, /## Nutrition/);
  });

  it('turns a sub-heading inside the ingredients into a group', () => {
    const split = splitBody(
      [
        '### Ingredients',
        '',
        '### Dal',
        '',
        '- 1 cup lentils',
        '',
        'Tempering:',
        '',
        '- 2 tbsp oil',
      ].join('\n'),
    );
    assert.deepEqual(split.ingredients, [
      { qty: 1, unit: 'cup', item: 'lentils', group: 'Dal' },
      { qty: 2, unit: 'tbsp', item: 'oil', group: 'Tempering' },
    ]);
  });

  it('rejects a group name that is an annotation rather than a name', () => {
    const split = splitBody(['Ingredients x2 (Ordered) 825 kcal:', '', '- 100g oats'].join('\n'));
    assert.equal(split.ingredients[0]?.group, undefined);
  });

  it('reads an unheaded list as ingredients when most lines carry a quantity', () => {
    const split = splitBody(['3 avocados', '1 Roma tomato', '1/2 red onion', '2 limes'].join('\n'));
    assert.equal(split.ingredients.length, 4);
    assert.equal(split.body, '');
  });

  it('reads a single quantified line as an ingredient', () => {
    const split = splitBody('Rice: 270g');
    assert.deepEqual(split.ingredients, [{ qty: 270, unit: 'g', item: 'Rice' }]);
  });

  it('leaves a single unquantified line as prose', () => {
    const split = splitBody('ChatGPT recommendation');
    assert.deepEqual(split.ingredients, []);
    assert.equal(split.body, 'ChatGPT recommendation');
  });

  it('reads an unheaded block as prose when most lines do not', () => {
    // A cooking log, not an ingredient list. Per-line guessing turns
    // "Wheat 50%ish mix" into an ingredient; deciding over the block does not.
    const split = splitBody(
      [
        '- 5/30/23 (Detroit Style): shortcuts taken.',
        '    - Wheat 50%ish mix',
        '    - Turned out well!',
      ].join('\n'),
    );
    assert.deepEqual(split.ingredients, []);
    assert.match(split.body, /Wheat 50%ish mix/);
  });

  it('keeps a preamble as prose when a real ingredients heading follows', () => {
    const split = splitBody(
      ['vegan_high_protein', '', '## Ingredients', '', '- 200g pasta'].join('\n'),
    );
    assert.equal(split.body, 'vegan_high_protein');
    assert.equal(split.ingredients.length, 1);
  });

  it('keeps text that trailed the heading on the same line', () => {
    const split = splitBody(
      ['Ingredients 200g vegan ground meat', '', '1 carrot, diced'].join('\n'),
    );
    assert.deepEqual(split.ingredients, [
      { qty: 200, unit: 'g', item: 'vegan ground meat' },
      { qty: 1, item: 'carrot', note: 'diced' },
    ]);
  });
});

describe('toRecipe', () => {
  const page = [
    '# Sourdough Discard Granola',
    '',
    'Tags: Vegan, Breakfast',
    'Link: https://example.com/granola',
    'Tools: Bread Machine, Crockpot',
    'Fastest time (min): 45',
    'Description: Big clusters.',
    'Effort: 3',
    'Made: Yes',
    'Rating: 9',
    '',
    '- 450 grams rolled oats',
    '- 1/2 cup pure maple syrup',
    '',
    '### Instructions',
    '',
    '1. Preheat oven to 350F.',
    '2. Bake 40 minutes.',
  ].join('\n');

  it('maps the Notion columns onto frontmatter', () => {
    const { doc } = convert(page);
    assert.equal(doc.frontmatter.title, 'Sourdough Discard Granola');
    assert.equal(doc.frontmatter.description, 'Big clusters.');
    assert.deepEqual(doc.frontmatter.tags, ['Vegan', 'Breakfast']);
    assert.deepEqual(doc.frontmatter.equipment, ['Bread Machine', 'Crockpot']);
    assert.deepEqual(doc.frontmatter.time, { total: 45 });
    assert.deepEqual(doc.frontmatter.source, {
      url: 'https://example.com/granola',
      attribution: 'example.com',
    });
    assert.equal(doc.frontmatter.ingredients.length, 2);
  });

  it('produces a document the core parser accepts', () => {
    const { content } = convert(page);
    const result = safeParseRecipe(content);
    assert.ok(result.ok, JSON.stringify(result.ok ? [] : result.issues));
  });

  it('round-trips through the serializer unchanged', () => {
    const { content } = convert(page);
    assert.equal(parseRecipe(content).frontmatter.title, 'Sourdough Discard Granola');
  });

  it('records the cook’s own tracking data in a trailing Notes block', () => {
    const { doc } = convert(page);
    assert.match(
      doc.body,
      /## Notes\n\nCooked: yes · Rating 9 · Effort 3 · Imported from Notion on 2026-09-06\./,
    );
  });

  it('writes the notes as plain text, since a step renders no markdown', () => {
    // `StepText` renders the author's sentence verbatim, so a blockquote marker
    // would show up as a literal ">" at the head of the last step.
    assert.doesNotMatch(convert(page).doc.body, /^>/m);
  });

  it('strips markdown links from the method as well as the ingredients', () => {
    const { doc } = convert(
      [
        '# Dal',
        '',
        'Tags: Dinner',
        'Made: Yes',
        '',
        '### Ingredients',
        '',
        '- 1 cup [red lentils](https://www.amazon.com/x?tag=aff) masoor dal',
        '',
        '### Instructions',
        '',
        '- Drain in a [colander](https://www.amazon.com/y?tag=aff) and rinse.',
      ].join('\n'),
    );
    assert.equal(doc.frontmatter.ingredients[0]?.item, 'red lentils masoor dal');
    assert.match(doc.body, /Drain in a colander and rinse\./);
    assert.doesNotMatch(doc.body, /amazon\.com/);
  });

  it('cites the publication alongside the link', () => {
    const { doc } = convert(
      page.replace('https://example.com/granola', 'https://www.budgetbytes.com/granola/'),
    );
    assert.deepEqual(doc.frontmatter.source, {
      url: 'https://www.budgetbytes.com/granola/',
      attribution: 'Budget Bytes',
    });
  });

  it('keeps a link that is not a URL as attribution, and says so', () => {
    const { doc, warnings } = convert(
      [
        '# Kabsa',
        '',
        'Tags: Vegan',
        'Link: in SA cookbook in Calibre',
        'Made: No',
        '',
        '- 2 cups rice',
      ].join('\n'),
    );
    assert.deepEqual(doc.frontmatter.source, { attribution: 'in SA cookbook in Calibre' });
    assert.ok(warnings.some((w) => /not a URL/.test(w)));
  });

  it('strips attachments the zip holds and names them in the notes', () => {
    const { doc, assets } = convert(
      [
        '# Steel Cut Oats',
        '',
        'Tags: Breakfast',
        'Made: Yes',
        '',
        '![1000006318.jpg](Steel%20Cut%20Oats/1000006318.jpg)',
      ].join('\n'),
    );
    assert.deepEqual(assets, ['1000006318.jpg']);
    assert.match(doc.body, /1 attachment\(s\) not imported: 1000006318\.jpg/);
    assert.doesNotMatch(doc.body, /!\[/);
  });

  it('strips an attachment whose folder name contains brackets', () => {
    // Notion names the asset folder after the page, so the href is not
    // paren-free and a lazy path pattern stops in the middle of it.
    const { assets, isStub } = convert(
      [
        '# French Baguette (Food Processor)',
        '',
        'Tags: Baked Good',
        'Made: Yes',
        '',
        '![1000005843.jpg](French%20Baguette%20(Food%20Processor)/1000005843.jpg)',
      ].join('\n'),
    );
    assert.deepEqual(assets, ['1000005843.jpg']);
    assert.equal(isStub, true);
  });

  it('calls a page that held only an attachment a stub, not a recipe', () => {
    assert.equal(convert('# Steel Cut Oats\n\nTags: Breakfast\nMade: Yes\n').isStub, true);
    assert.equal(convert('# Guac\n\nTags: Vegan\nMade: No\n\n3 avocados\n2 limes\n').isStub, false);
    assert.equal(
      convert('# Note\n\nTags: Vegan\nMade: No\n\nUses volume measures.\n').isStub,
      false,
    );
  });

  it('calls a page complete only when it has ingredients and a method', () => {
    assert.equal(convert(page).isComplete, true);

    const ingredientsOnly = convert('# Guac\n\nTags: Vegan\nMade: No\n\n3 avocados\n2 limes\n');
    assert.equal(ingredientsOnly.isComplete, false);
    assert.equal(ingredientsOnly.isStub, false, 'ingredients-only is content, not a bookmark');

    const noteOnly = convert('# Idea\n\nTags: Vegan\nMade: No\n\nChatGPT recommendation\n');
    assert.equal(noteOnly.isComplete, false);
  });

  it('warns rather than failing when a page yields no ingredients', () => {
    const { doc, warnings } = convert(['# Trail mix', '', 'Tags: Snack', 'Made: Yes'].join('\n'));
    assert.deepEqual(doc.frontmatter.ingredients, []);
    assert.ok(warnings.includes('no ingredients found'));
    assert.ok(
      safeParseRecipe(
        toRecipe(parseNotionPage('# X\n\nTags: a\n'), { importedOn: IMPORTED_ON }).content,
      ).ok,
    );
  });
});
