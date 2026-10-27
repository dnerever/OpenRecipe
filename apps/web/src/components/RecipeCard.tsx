import { humanizeDuration } from '@openrecipe/core';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { thumbUrlFor, type RecipeSummary } from '../lib/api.ts';
import { tintForRecipe } from '../lib/categories.ts';
import { counted } from '../lib/words.ts';
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
  changes,
}: {
  recipe: RecipeSummary;
  handle: string;
  showOwner?: boolean;
  /** A control belonging to the listing, not the recipe — "Remove", say. */
  action?: ReactNode;
  /**
   * On the forks page: how this fork differs from the original, in place of
   * the "Fork of" line, which the page has already said.
   */
  changes?: { lines: string[]; count: number };
}) {
  return (
    <li className="card">
      {/*
        Not a link of its own: the title's link already covers the whole
        card, picture included, and a second unnamed link to the same place
        is one more stop for a keyboard and a blank one for a screen reader.

        A recipe without a photo gets its category's colour with its name set
        large, so every card has the same shape and none looks unfinished.
        There the name on the colour *is* the heading — set again underneath,
        it read as the same thing twice on every card.
      */}
      {recipe.imageUrl ? (
        <div className="card-photo">
          {/* The thumbnail, not the full image: a browse page of full-size
              photos is a browse page nobody waits for. */}
          <img src={thumbUrlFor(recipe.imageUrl)} alt="" loading="lazy" />
        </div>
      ) : (
        <div className="card-photo">
          <h2 className="card-type" style={{ background: tintForRecipe(recipe.tags) }}>
            <Link to="/$handle/$slug" params={{ handle, slug: recipe.slug }}>
              {recipe.title}
            </Link>
          </h2>
        </div>
      )}

      {recipe.imageUrl && (
        <h2>
          <Link to="/$handle/$slug" params={{ handle, slug: recipe.slug }}>
            {recipe.title}
          </Link>
        </h2>
      )}

      {changes && (
        <div className="card-changes">
          {changes.count === 0 ? (
            <p>Same as the original.</p>
          ) : (
            <ul>
              {changes.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {changes.count > changes.lines.length && (
                <li className="muted">and {changes.count - changes.lines.length} more</li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* Without this, a fork beside its original reads as a duplicate. */}
      {recipe.isFork && !changes && (
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
          <span className="card-time" title="Total time">
            <ClockIcon />
            <span className="sr">Total time </span>
            {humanizeDuration(recipe.totalTimeMinutes)}
          </span>
        )}
        {recipe.starCount > 0 && (
          <span className="card-stars" title={counted(recipe.starCount, 'star')}>
            ★ {recipe.starCount}
            <span className="sr"> {recipe.starCount === 1 ? 'star' : 'stars'}</span>
          </span>
        )}
        {/* The front page lists originals only; this is how their copies show. */}
        {recipe.forkCount > 0 && !recipe.isFork && (
          <span className="card-forks" title={counted(recipe.forkCount, 'fork')}>
            <ForkIcon />
            {recipe.forkCount}
            <span className="sr"> {recipe.forkCount === 1 ? 'fork' : 'forks'}</span>
          </span>
        )}
        {recipe.visibility === 'private' && <span className="badge">Private</span>}
        {recipe.versionCount !== undefined && <VersionBars count={recipe.versionCount} />}
        {action && <span className="card-action">{action}</span>}
      </div>

      <TagList tags={recipe.tags.slice(0, 4)} small />
    </li>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" className="card-icon">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 4.5V8l2.5 1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Two branches from one stem — the same mark a fork gets everywhere. */
function ForkIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" className="card-icon">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="4.5" cy="3.5" r="1.5" />
        <circle cx="11.5" cy="3.5" r="1.5" />
        <circle cx="8" cy="12.5" r="1.5" />
        <path d="M4.5 5v1.5c0 1.5 1 2.5 3.5 2.5s3.5-1 3.5-2.5V5M8 9v2" />
      </g>
    </svg>
  );
}

/**
 * One short bar per version, up to six: how much a recipe has been worked on,
 * at a glance. The count itself is in the label.
 */
function VersionBars({ count }: { count: number }) {
  return (
    <span className="card-versions" title={counted(count, 'version')}>
      <span className="bars" aria-hidden="true">
        {Array.from({ length: Math.min(count, 6) }, (_, i) => (
          <span key={i} />
        ))}
      </span>
      <span className="sr">{counted(count, 'version')}</span>
    </span>
  );
}
