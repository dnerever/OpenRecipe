import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RecipeParseError } from './errors.ts';
import { parseRecipe, safeParseRecipe } from './parse.ts';

const ok = `---
schema: 1
title: Test
ingredients:
  - { qty: 1, unit: g, item: salt }
---

Do the thing.
`;

function issuesOf(text: string) {
  const result = safeParseRecipe(text);
  assert.ok(!result.ok, 'expected parse to fail');
  return result.issues;
}

describe('parseRecipe', () => {
  it('accepts a minimal valid document', () => {
    const doc = parseRecipe(ok);
    assert.equal(doc.frontmatter.title, 'Test');
    assert.equal(doc.frontmatter.ingredients.length, 1);
    assert.equal(doc.body, 'Do the thing.');
  });

  it('normalizes CRLF line endings', () => {
    assert.deepEqual(parseRecipe(ok.replace(/\n/g, '\r\n')), parseRecipe(ok));
  });

  it('tolerates a BOM', () => {
    assert.deepEqual(parseRecipe('﻿' + ok), parseRecipe(ok));
  });

  it('accepts an empty body', () => {
    const doc = parseRecipe(ok.replace('\nDo the thing.\n', ''));
    assert.equal(doc.body, '');
  });

  it('requires frontmatter', () => {
    const [issue] = issuesOf('# Just a markdown file\n');
    assert.match(issue!.message, /must start with a `---` frontmatter block/);
    assert.deepEqual(issue!.position, { line: 1, column: 1 });
  });

  it('requires the frontmatter block to close', () => {
    const [issue] = issuesOf('---\nschema: 1\ntitle: X\n');
    assert.match(issue!.message, /never closed/);
  });

  it('reports the schema version when it is missing', () => {
    const issues = issuesOf('---\ntitle: X\ningredients: []\n---\n\nStep.\n');
    assert.ok(issues.some((i) => i.path === 'schema' && /schema must be 1/.test(i.message)));
  });

  it('rejects an unknown frontmatter key with the offending name', () => {
    const issues = issuesOf(ok.replace('title: Test', 'title: Test\nservings: 4'));
    assert.ok(
      issues.some((i) => /servings/.test(i.message)),
      JSON.stringify(issues),
    );
  });

  it('locates a bad duration on its real line', () => {
    const text = `---
schema: 1
title: Test
time: { total: soon }
ingredients:
  - { qty: 1, unit: g, item: salt }
---

Step.
`;
    const issues = issuesOf(text);
    const issue = issues.find((i) => i.path === 'time.total');
    assert.ok(issue, JSON.stringify(issues));
    assert.match(issue.message, /isn't a duration/);
    assert.equal(issue.position?.line, 4, 'should point at the `time:` line');
  });

  it('locates a bad ingredient on its own line', () => {
    const text = `---
schema: 1
title: Test
ingredients:
  - { qty: 1, unit: g, item: salt }
  - { qty: -5, unit: g, item: sugar }
---

Step.
`;
    const issues = issuesOf(text);
    const issue = issues.find((i) => i.path === 'ingredients.1.qty');
    assert.ok(issue, JSON.stringify(issues));
    assert.match(issue.message, /cannot be negative/);
    assert.equal(issue.position?.line, 6);
  });

  it('explains the unquoted-comma trap instead of reporting a phantom key', () => {
    const text = `---
schema: 1
title: Test
ingredients:
  - { qty: 400, unit: ml, item: coconut milk, note: full fat, unshaken }
---

Step.
`;
    const issues = issuesOf(text);
    const issue = issues[0];
    assert.ok(issue);
    assert.match(issue.message, /read as a field name, not text/);
    assert.match(issue.message, /wrap the whole value in quotes/);
    assert.equal(issue.position?.line, 5);
  });

  it('accepts the same note once it is quoted', () => {
    const text = `---
schema: 1
title: Test
ingredients:
  - { qty: 400, unit: ml, item: coconut milk, note: "full fat, unshaken" }
---

Step.
`;
    assert.equal(parseRecipe(text).frontmatter.ingredients[0]?.note, 'full fat, unshaken');
  });

  it('rejects a unit on a to-taste ingredient', () => {
    const text = ok.replace(
      '- { qty: 1, unit: g, item: salt }',
      '- { qty: null, unit: g, item: salt }',
    );
    const issues = issuesOf(text);
    assert.ok(
      issues.some((i) => i.path === 'ingredients.0.unit' && /cannot have a unit/.test(i.message)),
    );
  });

  it('reports malformed YAML with a position', () => {
    const text = '---\nschema: 1\ntitle: [unclosed\n---\n\nStep.\n';
    const [issue] = issuesOf(text);
    assert.ok(issue!.position, 'YAML errors must carry a position');
    assert.ok(issue!.position!.line >= 1);
  });

  it('collects every issue rather than stopping at the first', () => {
    const text = `---
schema: 1
title: ""
time: { total: soon }
ingredients:
  - { qty: -1, unit: g, item: salt }
---

Step.
`;
    assert.ok(issuesOf(text).length >= 3);
  });

  it('throws a RecipeParseError that formats readably', () => {
    try {
      parseRecipe('nope');
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof RecipeParseError);
      assert.match(err.message, /frontmatter/);
      assert.match(err.format(), /1:1/);
    }
  });

  it('lowercases and de-duplicates tags, preserving order', () => {
    const doc = parseRecipe(
      ok.replace('title: Test', 'title: Test\ntags: [Bread, sourdough, BREAD]'),
    );
    assert.deepEqual(doc.frontmatter.tags, ['bread', 'sourdough']);
  });

  it('normalizes unit aliases and leaves unknown units alone', () => {
    const doc = parseRecipe(
      ok.replace(
        '- { qty: 1, unit: g, item: salt }',
        '- { qty: 1, unit: Grams, item: salt }\n  - { qty: 1, unit: knob, item: butter }',
      ),
    );
    assert.equal(doc.frontmatter.ingredients[0]?.unit, 'g');
    assert.equal(doc.frontmatter.ingredients[1]?.unit, 'knob');
  });
});

describe('image', () => {
  const withImage = (value: string) =>
    safeParseRecipe(`---\nschema: 1\ntitle: T\nimage: ${value}\ningredients: []\n---\n\nCook.\n`);

  it('accepts an uploaded path and a full URL', () => {
    assert.equal(withImage('/api/media/8f14e45f').ok, true);
    assert.equal(withImage('https://example.com/loaf.jpg').ok, true);
  });

  it('refuses anything that is not one of those', () => {
    // This string ends up in a `src` on a page other people read.
    assert.equal(withImage('javascript:alert(1)').ok, false);
    assert.equal(withImage('loaf.jpg').ok, false);
    assert.equal(withImage('"data:image/png;base64,AAAA"').ok, false);
  });
});
