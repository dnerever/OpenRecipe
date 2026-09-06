import type { SemanticChange } from './diff.ts';
import { humanizeDuration } from './duration.ts';
import { formatQuantity } from './scale.ts';
import type { Ingredient } from './types.ts';

/**
 * One line of English per change.
 *
 * Lives in core rather than the web app because it is pure string work over the
 * document model, and a future CLI wants exactly the same sentences.
 */
export function describeChange(change: SemanticChange): string {
  switch (change.kind) {
    case 'title':
      return `Renamed from “${change.from}” to “${change.to}”`;
    case 'description':
      if (change.from === null) return 'Added a description';
      if (change.to === null) return 'Removed the description';
      return 'Reworded the description';
    case 'image':
      if (change.from === null) return 'Added a photo';
      if (change.to === null) return 'Removed the photo';
      return 'Changed the photo';
    case 'yield':
      if (change.from === null) return `Yield set to ${change.to}`;
      if (change.to === null) return 'Removed the yield';
      return `Yield ${change.from} → ${change.to}`;
    case 'time': {
      if (change.from === null)
        return `${change.field} time set to ${humanizeDuration(change.to ?? 0)}`;
      if (change.to === null) return `Removed the ${change.field} time`;
      return `${change.field} time ${humanizeDuration(change.from)} → ${humanizeDuration(change.to)}`;
    }
    case 'ingredient-added':
      return `Added ${amount(change.ingredient)}`;
    case 'ingredient-removed':
      return `Removed ${amount(change.ingredient)}`;
    case 'ingredient-changed': {
      const parts: string[] = [];
      if (change.fields.includes('qty') || change.fields.includes('unit')) {
        parts.push(`${quantity(change.from)} → ${quantity(change.to)}`);
      }
      if (change.fields.includes('note')) parts.push(noteChange(change.from, change.to));
      if (change.fields.includes('group')) parts.push(`moved to ${change.to.group ?? 'no group'}`);
      return `${change.to.item}: ${parts.join(', ')}`;
    }
    case 'tag-added':
      return `Tagged ${change.tag}`;
    case 'tag-removed':
      return `Untagged ${change.tag}`;
    case 'equipment-added':
      return `Now needs ${change.item}`;
    case 'equipment-removed':
      return `No longer needs ${change.item}`;
    case 'phase-added':
      return `Added the “${change.title}” step`;
    case 'phase-removed':
      return `Removed the “${change.title}” step`;
    case 'step-added':
      return `${change.phase || 'Method'}: added a step`;
    case 'step-removed':
      return `${change.phase || 'Method'}: removed a step`;
    case 'step-reworded':
      return `${change.phase || 'Method'}: reworded a step`;
    case 'hydration':
      return `Hydration ${change.from}% → ${change.to}%`;
    case 'scaled':
      return `Scaled the whole recipe ${change.factor}×`;
  }
}

/**
 * Changes worth surfacing above the fold. Hydration and a rescale are
 * conclusions rather than edits — they are what the reader is deciding about.
 */
export function isHeadline(change: SemanticChange): boolean {
  return change.kind === 'hydration' || change.kind === 'scaled' || change.kind === 'title';
}

function quantity(ing: Ingredient): string {
  if (ing.qty === null) return 'to taste';
  return `${formatQuantity(ing.qty, ing.unit)}${ing.unit ? ` ${ing.unit}` : ''}`;
}

function amount(ing: Ingredient): string {
  return ing.qty === null ? ing.item : `${quantity(ing)} ${ing.item}`;
}

function noteChange(from: Ingredient, to: Ingredient): string {
  if (!from.note) return `noted “${to.note}”`;
  if (!to.note) return 'dropped the note';
  return `note “${from.note}” → “${to.note}”`;
}
