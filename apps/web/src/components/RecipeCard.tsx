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
        // Not a link of its own: the title's link already covers the whole
        // card, photo included, and a second unnamed link to the same place
        // is one more stop for a keyboard and a blank one for a screen reader.
        <div className="card-photo">
          {/* The thumbnail, not the full image: a browse page of full-size
              photos is a browse page nobody waits for. */}
          <img src={thumbUrlFor(recipe.imageUrl)} alt="" loading="lazy" />
        </div>
      )}

      <h2>
        <Link to="/$handle/$slug" params={{ handle, slug: recipe.slug }}>
          {recipe.title}
        </Link>
      </h2>

      {/* Without this, a fork beside its original reads as a duplicate. */}
      {recipe.isFork && (
        <p className="card-fork">
          Fork of{' '}
          {recipe.forkedFrom ? (
            <Link
              to="/$handle/$slug"
              params={{ handle: recipe.forkedFrom.handle, slug: recipe.forkedFrom.slug }}
            >
              @{recipe.forkedFrom.handle}/{recipe.forkedFrom.slug}
            </Link>
          ) : (
            'another recipe'
          )}
        </p>
      )}

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
