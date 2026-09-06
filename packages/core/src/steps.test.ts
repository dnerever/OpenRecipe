import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRecipe } from './parse.ts';
import { countSteps, deriveSteps } from './steps.ts';

const wrap = (body: string) =>
  parseRecipe(`---\nschema: 1\ntitle: T\ningredients: []\n---\n\n${body}\n`);

describe('deriveSteps', () => {
  it('treats `##` headings as phases', () => {
    const phases = deriveSteps(wrap('## Prep\nChop it.\n\n## Cook\nFry it.'));
    assert.deepEqual(
      phases.map((p) => p.title),
      ['Prep', 'Cook'],
    );
  });

  it('numbers steps continuously across phases', () => {
    const phases = deriveSteps(wrap('## A\nOne.\n\nTwo.\n\n## B\nThree.'));
    assert.deepEqual(
      phases.flatMap((p) => p.steps.map((s) => s.number)),
      [1, 2, 3],
    );
    assert.equal(phases[1]?.steps[0]?.text, 'Three.');
  });

  it('splits ordered list items into steps and strips the marker', () => {
    const phases = deriveSteps(wrap('1. Do this.\n2. Then this.\n3. Finally this.'));
    assert.deepEqual(
      phases[0]?.steps.map((s) => s.text),
      ['Do this.', 'Then this.', 'Finally this.'],
    );
  });

  it('splits unordered list items too', () => {
    const phases = deriveSteps(wrap('- First.\n- Second.'));
    assert.deepEqual(
      phases[0]?.steps.map((s) => s.text),
      ['First.', 'Second.'],
    );
  });

  it('keeps a wrapped list item as one step', () => {
    const phases = deriveSteps(
      wrap('1. A long instruction that\n   wraps across lines.\n2. Short one.'),
    );
    assert.equal(phases[0]?.steps.length, 2);
    assert.equal(phases[0]?.steps[0]?.text, 'A long instruction that\nwraps across lines.');
  });

  it('falls back to paragraphs when there is no list', () => {
    const phases = deriveSteps(wrap('First paragraph.\n\nSecond paragraph.'));
    assert.equal(phases[0]?.steps.length, 2);
  });

  it('handles a body with no headings at all', () => {
    const phases = deriveSteps(wrap('Just do it.'));
    assert.equal(phases.length, 1);
    assert.equal(phases[0]?.title, '');
    assert.equal(phases[0]?.steps[0]?.text, 'Just do it.');
  });

  it('keeps a fenced code block intact and ignores headings inside it', () => {
    const phases = deriveSteps(
      wrap(
        '## Schedule\n\n```\n20:00 mix\n## not a heading\n21:00 fold\n```\n\n## Method\nMix it.',
      ),
    );
    assert.deepEqual(
      phases.map((p) => p.title),
      ['Schedule', 'Method'],
    );
    assert.match(phases[0]?.steps[0]?.text ?? '', /## not a heading/);
  });

  it('produces no empty steps from stray blank lines', () => {
    const phases = deriveSteps(wrap('## A\n\n\nOne.\n\n\n\nTwo.\n\n'));
    assert.equal(countSteps(wrap('## A\n\n\nOne.\n\n\n\nTwo.\n\n')), 2);
    for (const step of phases.flatMap((p) => p.steps)) {
      assert.notEqual(step.text.trim(), '');
    }
  });

  it('counts zero steps for an empty body', () => {
    assert.equal(countSteps(parseRecipe('---\nschema: 1\ntitle: T\ningredients: []\n---\n')), 0);
  });
});
