import type { Phase, RecipeDoc, Step } from './types.ts';

/**
 * Steps are derived from the Markdown body, never authored as data. Cooks write
 * prose; cook mode still gets structure.
 *
 * `##` headings open a phase. Inside a phase, an ordered or unordered list item
 * is a step; if a phase has no list, each paragraph is a step. Fenced code
 * blocks and block quotes are left intact and attached to the step they follow.
 */
export function deriveSteps(doc: RecipeDoc): Phase[] {
  const phases: Phase[] = [];
  let current: { title: string; blocks: string[] } = { title: '', blocks: [] };
  let counter = 0;

  const flush = () => {
    if (current.title === '' && current.blocks.length === 0) return;
    const steps: Step[] = current.blocks.map((text) => ({ number: ++counter, text }));
    phases.push({ title: current.title, steps });
  };

  for (const section of splitOnHeadings(doc.body)) {
    flush();
    current = { title: section.title, blocks: toBlocks(section.content) };
  }
  flush();

  return phases;
}

export function countSteps(doc: RecipeDoc): number {
  return deriveSteps(doc).reduce((n, p) => n + p.steps.length, 0);
}

function splitOnHeadings(body: string): { title: string; content: string }[] {
  const sections: { title: string; content: string }[] = [];
  let title = '';
  let buffer: string[] = [];
  let inFence = false;

  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;

    const heading = !inFence ? /^(#{2,6})\s+(.*)$/.exec(line) : null;
    if (heading) {
      if (title !== '' || buffer.join('\n').trim() !== '') {
        sections.push({ title, content: buffer.join('\n') });
      }
      title = (heading[2] ?? '').trim();
      buffer = [];
      continue;
    }
    buffer.push(line);
  }

  if (title !== '' || buffer.join('\n').trim() !== '') {
    sections.push({ title, content: buffer.join('\n') });
  }
  return sections;
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

function toBlocks(content: string): string[] {
  const lines = content.split('\n');
  const hasList = lines.some((l) => LIST_ITEM.test(l));
  const blocks: string[] = [];
  let buffer: string[] = [];
  let inFence = false;

  const push = () => {
    const text = buffer.join('\n').trim();
    if (text !== '') blocks.push(text);
    buffer = [];
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      buffer.push(line);
      continue;
    }
    if (inFence) {
      buffer.push(line);
      continue;
    }

    if (hasList) {
      // A new list item starts a new step; continuation lines stay attached.
      if (LIST_ITEM.test(line)) {
        push();
        buffer.push(line.replace(LIST_ITEM, ''));
        continue;
      }
      if (line.trim() === '') continue;
      buffer.push(line.trim());
    } else {
      if (line.trim() === '') {
        push();
        continue;
      }
      buffer.push(line);
    }
  }
  push();

  return blocks;
}
