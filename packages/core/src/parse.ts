import { LineCounter, parseDocument, type Node } from 'yaml';
import { normalizeBody } from './body.ts';
import { RecipeParseError, type Position, type RecipeIssue } from './errors.ts';
import { FrontmatterSchema } from './schema.ts';
import type { Frontmatter, RecipeDoc } from './types.ts';

export type ParseResult = { ok: true; doc: RecipeDoc } | { ok: false; issues: RecipeIssue[] };

const DELIMITER = /^(?:---|\.\.\.)\s*$/;

/** Parse without throwing. Prefer this in request handlers and editors. */
export function safeParseRecipe(text: string): ParseResult {
  const source = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const lines = source.split('\n');

  if (lines[0]?.trim() !== '---') {
    return {
      ok: false,
      issues: [
        {
          path: '',
          message: 'A recipe must start with a `---` frontmatter block.',
          position: { line: 1, column: 1 },
        },
      ],
    };
  }

  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (DELIMITER.test(lines[i] ?? '')) {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex === -1) {
    return {
      ok: false,
      issues: [
        {
          path: '',
          message: 'The frontmatter block is never closed. Add a `---` line after it.',
          position: { line: lines.length, column: 1 },
        },
      ],
    };
  }

  const yamlSource = lines.slice(1, closeIndex).join('\n');
  const body = lines.slice(closeIndex + 1).join('\n');

  // The YAML we hand to the parser starts on file line 2.
  const lineOffset = 1;
  const lineCounter = new LineCounter();
  const yamlDoc = parseDocument(yamlSource, { lineCounter, keepSourceTokens: true });

  const at = (offset: number | undefined): Position | undefined => {
    if (offset === undefined) return undefined;
    const pos = lineCounter.linePos(offset);
    return { line: pos.line + lineOffset, column: pos.col };
  };

  if (yamlDoc.errors.length > 0) {
    return {
      ok: false,
      issues: yamlDoc.errors.map((err) => ({
        path: '',
        message: err.message,
        position: at(err.pos[0]) ?? { line: 1 + lineOffset, column: 1 },
      })),
    };
  }

  const raw: unknown = yamlDoc.toJS({ mapAsMap: false });
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      issues: [
        {
          path: '',
          message: 'Frontmatter must be a set of `key: value` fields.',
          position: { line: 1 + lineOffset, column: 1 },
        },
      ],
    };
  }

  const parsed = FrontmatterSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => {
        const path = issue.path.join('.');
        let position = at(nodeOffset(yamlDoc, issue.path));
        // Unknown-key errors point at the parent; the key itself is more useful.
        if (!position && issue.path.length > 0) {
          position = at(nodeOffset(yamlDoc, issue.path.slice(0, -1)));
        }
        return {
          path,
          message: explain(issue, raw, issue.path),
          ...(position ? { position } : {}),
        };
      }),
    };
  }

  const frontmatter = parsed.data as Frontmatter;
  return { ok: true, doc: { frontmatter, body: normalizeBody(body) } };
}

/** Parse or throw a `RecipeParseError` carrying every issue found. */
export function parseRecipe(text: string): RecipeDoc {
  const result = safeParseRecipe(text);
  if (!result.ok) throw new RecipeParseError(result.issues);
  return result.doc;
}

/**
 * The commonest authoring mistake by a wide margin: an unquoted comma inside a
 * flow map, which YAML reads as the start of another key.
 *
 *     - { qty: 400, unit: ml, item: coconut milk, note: full fat, unshaken }
 *                                                                ^^^^^^^^ a key
 *
 * Zod can only say "unrecognized key", which tells the author nothing. The
 * tell is that a comma-split fragment has no value at all, where a genuine typo
 * (`quantity: 100`) does — so we can separate the two and say what to fix.
 *
 * The key names come from `issue.keys` rather than Zod's own message, which
 * carries no names under `zod/mini` — and naming them is the whole point.
 */
function explain(
  issue: { code: string; message: string; keys?: string[] },
  raw: unknown,
  path: readonly PropertyKey[],
): string {
  if (issue.code !== 'unrecognized_keys') return issue.message;

  const keys = issue.keys ?? [];
  if (keys.length === 0) return issue.message;
  const named = keys.map((k) => `\`${k}\``).join(', ');
  const notFields =
    keys.length === 1 ? `${named} is not a recipe field` : `${named} are not recipe fields`;

  const parent = valueAt(raw, path);
  if (parent === undefined) return `${notFields}.`;

  const orphans = keys.filter((k) => {
    const value = (parent as Record<string, unknown>)[k];
    return value === null || value === undefined;
  });
  if (orphans.length === 0) {
    return `${notFields}. Check the spelling, or remove it.`;
  }

  const fragment = orphans.join(', ');
  return (
    `"${fragment}" was read as a field name, not text. A comma inside a ` +
    `\`{ ... }\` value starts a new field — wrap the whole value in quotes, ` +
    `e.g. note: "…, ${orphans[0]}".`
  );
}

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function nodeOffset(
  doc: ReturnType<typeof parseDocument>,
  path: readonly PropertyKey[],
): number | undefined {
  if (path.length === 0) return doc.contents?.range?.[0];
  try {
    const node = doc.getIn(path as (string | number)[], true) as Node | undefined;
    return node?.range?.[0];
  } catch {
    return undefined;
  }
}
