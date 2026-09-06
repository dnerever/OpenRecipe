import { detectSystem } from '@openrecipe/core';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { ForkButton } from '../components/ForkButton.tsx';
import { ForkedFrom } from '../components/ForkedFrom.tsx';
import { ProposeButton } from '../components/ProposeButton.tsx';
import { ProposeForm } from '../components/ProposeForm.tsx';
import { RecipeView } from '../components/RecipeView.tsx';
import { ScaleControl } from '../components/ScaleControl.tsx';
import { ShoppingList } from '../components/ShoppingList.tsx';
import { StarButton } from '../components/StarButton.tsx';
import { VisibilityToggle } from '../components/VisibilityToggle.tsx';
import { ApiError, fetchRecipe, rawUrl } from '../lib/api.ts';
import {
  applyCookOptions,
  formatFactor,
  optionsFromSearch,
  searchFromOptions,
  type CookOptions,
} from '../lib/cook-options.ts';

export function RecipePage() {
  const { handle, slug } = useParams({ from: '/$handle/$slug' });
  const search = useSearch({ from: '/$handle/$slug' });
  const navigate = useNavigate();
  const [showShopping, setShowShopping] = useState(false);
  const [proposing, setProposing] = useState('propose' in search && search.propose === true);
  const [menuOpen, setMenuOpen] = useState(false);

  const { data, isPending, error } = useQuery({
    queryKey: ['recipe', handle, slug],
    queryFn: () => fetchRecipe(handle, slug),
    retry: false,
  });

  const frontmatter = data?.doc.frontmatter;
  /** The kitchen the author wrote in, which is the units this reader starts in. */
  const native = useMemo(() => (frontmatter ? detectSystem(frontmatter) : 'metric'), [frontmatter]);

  if (isPending) return <p className="muted">Loading…</p>;

  if (error) {
    // A private recipe is indistinguishable from one that never existed, by design.
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <section className="panel">
        <h2>{notFound ? 'Not found' : 'Something went wrong'}</h2>
        <p className="muted">
          {notFound ? 'There is no recipe at this address, or it is private.' : error.message}
        </p>
      </section>
    );
  }

  const { recipe, version, doc } = data;
  const options = optionsFromSearch(search, native);
  const shown = applyCookOptions(doc.frontmatter, options, native);

  /**
   * `replace`, because scaling is a way of looking at one page rather than a
   * series of pages: twelve taps on ×2 must not become twelve back-presses.
   */
  const setOptions = (next: CookOptions) =>
    void navigate({
      to: '/$handle/$slug',
      params: { handle, slug },
      search: searchFromOptions(next, native),
      replace: true,
    });

  const closeMenu = () => setMenuOpen(false);

  return (
    <article>
      <header className="recipe-head">
        <p className="crumb">
          <Link to="/$handle" params={{ handle: recipe.owner.handle }}>
            @{recipe.owner.handle}
          </Link>
          <span> / </span>
          <strong>{recipe.slug}</strong>
          {recipe.visibility === 'private' && <span className="badge">Private</span>}
        </p>

        <h1>{recipe.title}</h1>
        {recipe.forkedFrom && <ForkedFrom from={recipe.forkedFrom} />}
        {recipe.description && <p className="lede">{recipe.description}</p>}
        {options.scale !== 1 && (
          <p className="print-only">
            Printed at {formatFactor(options.scale)} the original quantities.
          </p>
        )}

        {/*
         * Three actions and a drawer. Everything else a recipe can do is real
         * but occasional — forking, history, raw, visibility — and a reader who
         * came here to cook should not have to read past eight buttons to find
         * the ingredients.
         */}
        <div className="row">
          <Link
            className="button"
            to="/$handle/$slug/cook"
            params={{ handle, slug }}
            search={search}
          >
            Cook
          </Link>
          {recipe.canEdit && (
            <Link className="button secondary" to="/$handle/$slug/edit" params={{ handle, slug }}>
              Edit
            </Link>
          )}
          <StarButton
            handle={handle}
            slug={slug}
            starred={recipe.viewerHasStarred}
            count={recipe.starCount}
          />
          {/*
            Two ways in, because they are two different situations. On a fork
            you own, the change is already written and the only question left is
            the covering note. On somebody else's recipe there is nothing to
            offer yet, so the button has to make you a copy first.
          */}
          {recipe.canEdit && recipe.forkedFrom?.visible && (
            <button
              type="button"
              className="secondary"
              aria-expanded={proposing}
              onClick={() => setProposing((was) => !was)}
            >
              Propose changes
            </button>
          )}
          {!recipe.canEdit && <ProposeButton handle={handle} slug={slug} />}

          <details
            className="more"
            open={menuOpen}
            onToggle={(e) => setMenuOpen(e.currentTarget.open)}
          >
            <summary className="button secondary">More</summary>
            <div className="more-menu">
              <button
                type="button"
                className="secondary"
                aria-expanded={showShopping}
                onClick={() => {
                  setShowShopping((open) => !open);
                  closeMenu();
                }}
              >
                {showShopping ? 'Hide shopping list' : 'Shopping list'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  closeMenu();
                  window.print();
                }}
              >
                Print
              </button>
              <Link
                className="button secondary"
                to="/$handle/$slug/proposals"
                params={{ handle, slug }}
              >
                Proposals
              </Link>
              <Link
                className="button secondary"
                to="/$handle/$slug/history"
                params={{ handle, slug }}
              >
                History
              </Link>
              <Link
                className="button secondary"
                to="/$handle/$slug/forks"
                params={{ handle, slug }}
              >
                Forks{recipe.forkCount > 0 && ` (${recipe.forkCount})`}
              </Link>
              <ForkButton handle={handle} slug={slug} visibility={recipe.visibility} />
              <a
                className="button secondary"
                href={rawUrl(handle, slug)}
                target="_blank"
                rel="noreferrer"
              >
                View raw
              </a>
              {recipe.canEdit && (
                <VisibilityToggle
                  handle={handle}
                  slug={slug}
                  visibility={recipe.visibility}
                  forkCount={recipe.forkCount}
                />
              )}
            </div>
          </details>
        </div>

        {recipe.visibility === 'private' && recipe.canEdit && (
          <p className="notice">Only you can see this recipe.</p>
        )}
      </header>

      {proposing && recipe.forkedFrom && (
        <ProposeForm
          sourceRecipeId={recipe.id}
          forkedFrom={recipe.forkedFrom}
          defaultTitle={version.message === 'Update recipe' ? recipe.title : version.message}
          onCancel={() => setProposing(false)}
        />
      )}

      <RecipeView
        frontmatter={shown}
        phases={doc.phases}
        scaleControl={
          <ScaleControl
            frontmatter={doc.frontmatter}
            options={options}
            native={native}
            onChange={setOptions}
          />
        }
        shoppingList={
          showShopping ? (
            <ShoppingList
              frontmatter={shown}
              title={`${recipe.title} — shopping list`}
              slug={slug}
            />
          ) : null
        }
      />

      <footer className="version-line muted">
        <Link to="/$handle/$slug/history" params={{ handle, slug }}>
          Version {version.id.slice(0, 8)}
        </Link>{' '}
        · {version.message} · {new Date(version.createdAt).toLocaleString()}
      </footer>
    </article>
  );
}
