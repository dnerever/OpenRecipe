import { humanizeDuration } from '@openrecipe/core';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { thumbUrlFor, type RecipeSummary } from '../lib/api.ts';
import { TagList } from './TagList.tsx';

/**
 * Everything here comes from denormalized columns — no YAML is parsed to render
 * a card. That is the whole reason `tags_cache` and `total_time_minutes` exist.
 */
export function RecipeCard({
  recipe,
  handle,
  showOwner = true,
  action,
}: {
  recipe: RecipeSummary;
  handle: string;
  showOwner?: boolean;
  /** A control belonging to the listing, not the recipe — "Remove", say. */
  action?: ReactNode;
}) {
  return (
    <li className={`card${recipe.imageUrl ? ' has-photo' : ''}`}>
      {recipe.imageUrl && (
        <Link className="card-photo" to="/$handle/$slug" params={{ handle, slug: recipe.slug }}>
          {/* The thumbnail, not the full image: a browse page of full-size
              photos is a browse page nobody waits for. */}
          <img src={thumbUrlFor(recipe.imageUrl)} alt="" loading="lazy" />
        </Link>
      )}

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
        {recipe.starCount > 0 && <span className="card-stars">★ {recipe.starCount}</span>}
        {recipe.visibility === 'private' && <span className="badge">Private</span>}
        {action && <span className="card-action">{action}</span>}
      </div>

      <TagList tags={recipe.tags.slice(0, 4)} small />
    </li>
  );
}
