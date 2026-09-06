/**
 * @openrecipe/core — pure recipe-document logic.
 *
 * No I/O, no database, no network. Everything here is a pure function over a
 * recipe document, so the parser and (from Slice 7) the merge engine stay cheap
 * to test and reusable by a future CLI. Keep it that way.
 */

export { SCHEMA_VERSION, FrontmatterSchema, type ParsedFrontmatter } from './schema.ts';
export { RecipeParseError, type Position, type RecipeIssue } from './errors.ts';
export { parseRecipe, safeParseRecipe, type ParseResult } from './parse.ts';
export { serializeRecipe } from './serialize.ts';
export { hashContent, hashRecipe } from './hash.ts';
export { deriveSteps, countSteps } from './steps.ts';
export {
  diffText,
  diffHunks,
  diffRecipes,
  summarizeDiff,
  hydration,
  scaleFactor,
  isUnchanged,
  type LineChange,
  type SemanticChange,
  type IngredientField,
} from './diff.ts';
export { describeChange, isHeadline } from './describe-change.ts';
export { scaleRecipe, scaleToYield, scaleToIngredient, formatQuantity } from './scale.ts';
export { parseDuration, formatDuration, humanizeDuration } from './duration.ts';
export { normalizeUnit, unitSystem, prefersFractions, type UnitSystem } from './units.ts';
export { normalizeBody } from './body.ts';
export type {
  Frontmatter,
  Ingredient,
  Phase,
  RecipeDoc,
  Source,
  Step,
  Times,
  Yield,
} from './types.ts';
