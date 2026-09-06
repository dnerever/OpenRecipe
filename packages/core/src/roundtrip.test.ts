import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { hashContent } from './hash.ts';
import { safeParseRecipe } from './parse.ts';
import { serializeRecipe } from './serialize.ts';
import { countSteps, deriveSteps } from './steps.ts';

const dir = fileURLToPath(new URL('./__fixtures__/', import.meta.url));
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.md'))
  .map((name) => ({ name, text: readFileSync(dir + name, 'utf8') }));

describe('fixture corpus', () => {
  it('has a corpus worth trusting', () => {
    assert.ok(fixtures.length >= 20, `expected >= 20 fixtures, found ${fixtures.length}`);
  });

  for (const { name, text } of fixtures) {
    describe(name, () => {
      it('parses', () => {
        const result = safeParseRecipe(text);
        if (!result.ok) {
          assert.fail(
            `${name} failed to parse:\n${result.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`,
          );
        }
      });

      it('round-trips to an identical document', () => {
        const result = safeParseRecipe(text);
        assert.ok(result.ok);
        const reparsed = safeParseRecipe(serializeRecipe(result.doc));
        assert.ok(reparsed.ok);
        assert.deepEqual(reparsed.doc, result.doc, 'parse(serialize(doc)) must equal doc');
      });

      it('serializes idempotently', () => {
        const result = safeParseRecipe(text);
        assert.ok(result.ok);
        const once = serializeRecipe(result.doc);
        const reparsed = safeParseRecipe(once);
        assert.ok(reparsed.ok);
        assert.equal(serializeRecipe(reparsed.doc), once, 'serialization must be a fixed point');
      });

      it('hashes stably across a reformat', async () => {
        const result = safeParseRecipe(text);
        assert.ok(result.ok);
        const once = serializeRecipe(result.doc);
        const reparsed = safeParseRecipe(once);
        assert.ok(reparsed.ok);
        assert.equal(await hashContent(once), await hashContent(serializeRecipe(reparsed.doc)));
      });

      it('derives at least one step', () => {
        const result = safeParseRecipe(text);
        assert.ok(result.ok);
        assert.ok(countSteps(result.doc) > 0, 'every recipe should yield at least one step');
        for (const phase of deriveSteps(result.doc)) {
          for (const step of phase.steps) {
            assert.ok(step.text.trim().length > 0, 'no empty steps');
          }
        }
      });

      it('has a title and at least one ingredient', () => {
        const result = safeParseRecipe(text);
        assert.ok(result.ok);
        assert.ok(result.doc.frontmatter.title.length > 0);
        assert.ok(result.doc.frontmatter.ingredients.length > 0);
      });
    });
  }
});
