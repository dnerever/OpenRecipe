import { humanizeDuration } from '@openrecipe/core';
import { Link } from '@tanstack/react-router';
import type { RecipeSummary } from '../lib/api.ts';

/**
 * Everything here comes from denormalized columns — no YAML is parsed to render
 * a card. That is the whole reason `tags_cache` and `total_time_minutes` exist.
 */
export function RecipeCard({
  recipe,
  handle,
  showOwner = true,
}: {
  recipe: RecipeSummary;
  handle: string;
  showOwner?: boolean;
}) {
  return (
    <li className="card">
      <h3>
        <Link to="/$handle/$slug" params={{ handle, slug: recipe.slug }}>
          {recipe.title}
        </Link>
      </h3>

      {recipe.description && <p className="card-desc">{recipe.description}</p>}

      <div className="card-foot">
        {showOwner && (
          <Link className="card-owner" to="/$handle" params={{ handle }}>
            @{handle}
          </Link>
        )}
        {recipe.totalTimeMinutes !== null && (
          <span className="card-time">{humanizeDuration(recipe.totalTimeMinutes)}</span>
        )}
        {recipe.visibility === 'private' && <span className="badge">Private</span>}
      </div>

      {recipe.tags.length > 0 && (
        <ul className="tags small">
          {recipe.tags.slice(0, 4).map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
