/** A position in the original document text. 1-based, as humans count. */
export type Position = { line: number; column: number };

export type RecipeIssue = {
  /** Dotted path into the frontmatter, e.g. `ingredients.2.qty`. Empty at the root. */
  path: string;
  message: string;
  /** Absent when the offending value can't be located in the source. */
  position?: Position;
};

/**
 * Thrown by `parseRecipe`. Carries every issue found, not just the first, so a
 * UI can underline all of them in one pass.
 */
export class RecipeParseError extends Error {
  readonly issues: readonly RecipeIssue[];

  constructor(issues: readonly RecipeIssue[]) {
    super(RecipeParseError.summarize(issues));
    this.name = 'RecipeParseError';
    this.issues = issues;
  }

  private static summarize(issues: readonly RecipeIssue[]): string {
    const first = issues[0];
    if (!first) return 'Recipe is not valid.';
    const where = first.position ? ` (line ${first.position.line})` : '';
    const rest = issues.length > 1 ? ` — and ${issues.length - 1} more issue(s)` : '';
    const at = first.path ? `${first.path}: ` : '';
    return `${at}${first.message}${where}${rest}`;
  }

  /** Multi-line rendering suitable for a CLI or an error panel. */
  format(): string {
    return this.issues
      .map((i) => {
        const pos = i.position ? `${i.position.line}:${i.position.column}` : '?';
        return `  ${pos}  ${i.path ? `${i.path} — ` : ''}${i.message}`;
      })
      .join('\n');
  }
}
