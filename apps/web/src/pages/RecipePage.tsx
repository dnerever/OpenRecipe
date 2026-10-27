import { detectSystem } from '@openrecipe/core';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { AddToListButton } from '../components/AddToListButton.tsx';
import { DeleteRecipeButton } from '../components/DeleteRecipeButton.tsx';
import { ForkButton } from '../components/ForkButton.tsx';
import { ForkedFrom } from '../components/ForkedFrom.tsx';
import { LoadFailure, Loading, NO_SUCH_RECIPE } from '../components/LoadState.tsx';
import { ProposeButton } from '../components/ProposeButton.tsx';
import { ProposeForm } from '../components/ProposeForm.tsx';
import { RecipeActivity } from '../components/RecipeActivity.tsx';
import { RecipeView } from '../components/RecipeView.tsx';
import { ReportButton } from '../components/ReportButton.tsx';
import { ScaleControl } from '../components/ScaleControl.tsx';
import { ShoppingList } from '../components/ShoppingList.tsx';
import { StarButton } from '../components/StarButton.tsx';
import { VisibilityToggle } from '../components/VisibilityToggle.tsx';
import { When } from '../components/When.tsx';
import { fetchRecipe, rawUrl } from '../lib/api.ts';
import { useDismiss } from '../lib/use-dismiss.ts';
import { tickKey } from '../lib/use-ticked.ts';
import {
  applyCookOptions,
  formatFactor,
  optionsFromSearch,
  searchFromOptions,
  type CookOptions,
} from '../lib/cook-options.ts';
import { useTitle } from '../lib/use-title.ts';

export function RecipePage() {
  const { handle, slug } = useParams({ from: '/$handle/$slug' });
  const search = useSearch({ from: '/$handle/$slug' });
  const navigate = useNavigate();
  const [showShopping, setShowShopping] = useState(false);
  const [proposing, setProposing] = useState('propose' in search && search.propose === true);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const menuRef = useDismiss(menuOpen, closeMenu);

  const { data, isPending, error } = useQuery({
    queryKey: ['recipe', handle, slug],
    queryFn: () => fetchRecipe(handle, slug),
    retry: false,
  });
  useTitle(data?.recipe.title ?? `${handle}/${slug}`);

  const frontmatter = data?.doc.frontmatter;
  /** The kitchen the author wrote in, which is the units this reader starts in. */
  const native = useMemo(() => (frontmatter ? detectSystem(frontmatter) : 'metric'), [frontmatter]);

  if (isPending) return <Loading shape="recipe" />;

  // A private recipe is indistinguishable from one that never existed, by design.
  if (error) return <LoadFailure error={error} missing={NO_SUCH_RECIPE} />;

  const { recipe, version, doc } = data;
  const options = optionsFromSearch(search, native);
  const shown = applyCookOptions(doc.frontmatter, options, native);

  /**
   * `replace`, because scaling is a way of looking at one page rather than a
   * series of pages: twelve taps on ×2 must not become twelve back-presses.
   *
   * `resetScroll: false` for the same reason. The reader is usually halfway
   * down the ingredients when they reach for ×2 or Metric, and the router's
   * default — treat every navigation as arriving at a new page, and start at
   * the top — would throw them back to the title on every tap. Nothing about
   * the page changed except the numbers in front of them.
   */
  const setOptions = (next: CookOptions) =>
    void navigate({
      to: '/$handle/$slug',
      params: { handle, slug },
      search: searchFromOptions(next, native),
      replace: true,
      resetScroll: false,
    });

  return (
    /* The class is the page's only say in its own width: `main` is capped at a
       measure that suits prose, and the wide layout lifts that cap for this
       route alone. */
    <article className="recipe-page">
      <header className="recipe-head">
        <p className="crumb">
          <Link to="/$handle" params={{ handle: recipe.owner.handle }}>
            @{recipe.owner.handle}
          </Link>
          {recipe.visibility === 'private' && <span className="badge">Private</span>}
        </p>

        <h1>{recipe.title}</h1>
        {recipe.forkedFrom && <ForkedFrom from={recipe.forkedFrom} />}
        {recipe.description && <p className="lede">{recipe.description}</p>}
        <RecipeActivity
          handle={handle}
          slug={slug}
          versionCount={recipe.versionCount}
          forkCount={recipe.forkCount}
          openProposalCount={recipe.openProposalCount}
        />
        {options.scale !== 1 && (
          <p className="print-only">
            Printed at {formatFactor(options.scale)} the original quantities.
          </p>
        )}

        {/*
         * The things a reader does here, and a drawer. Everything else a recipe
         * can do is real but occasional — printing, raw text, visibility — and
         * a reader who came here to cook should not have to read past eight
         * buttons to find the ingredients. Fork is out here because it is what
         * the site is for.
         *
         * Saving to a list earns its place beside starring for the same reason
         * starring did: it is a thought you have while reading, and burying it
         * in the drawer is what would make people not bother.
         */}
        <div className="row recipe-actions">
          <Link
            className="button cook-button"
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
          <AddToListButton handle={handle} slug={slug} recipeId={recipe.id} />
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
          {!recipe.canEdit && (
            <ForkButton handle={handle} slug={slug} visibility={recipe.visibility} />
          )}
          {!recipe.canEdit && <ProposeButton handle={handle} slug={slug} />}

          {/*
            Grouped by what the reader is after: using the recipe, and
            changing it. History, forks and proposals have the line under the
            title. Links that go elsewhere close the menu; actions that happen
            here leave it open, so their result or refusal is still in view.
          */}
          <details
            ref={menuRef}
            className="more"
            open={menuOpen}
            onToggle={(e) => setMenuOpen(e.currentTarget.open)}
          >
            <summary className="button secondary">More</summary>
            <div className="more-menu">
              <p className="more-label">Use it</p>
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
              <a
                className="button secondary"
                href={rawUrl(handle, slug)}
                target="_blank"
                rel="noreferrer"
                onClick={closeMenu}
              >
                View as text
              </a>

              <hr className="more-rule" />
              {/* Your own recipe, forked: a second version to try alongside it. */}
              {recipe.canEdit && (
                <ForkButton handle={handle} slug={slug} visibility={recipe.visibility} />
              )}
              {!recipe.canEdit && <ReportButton handle={handle} slug={slug} />}
              {recipe.canEdit && (
                <VisibilityToggle
                  handle={handle}
                  slug={slug}
                  visibility={recipe.visibility}
                  forkCount={recipe.forkCount}
                />
              )}
              {/*
                Last in the drawer, and the only destructive thing in the app.
                A refused delete points at the visibility toggle directly above
                it, which is the thing the owner actually wanted.
              */}
              {recipe.canEdit && (
                <DeleteRecipeButton
                  handle={handle}
                  slug={slug}
                  onBlocked={() => setMenuOpen(true)}
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
        storageKey={tickKey(handle, slug)}
        visibility={recipe.visibility}
        scaleControl={
          <ScaleControl
            frontmatter={doc.frontmatter}
            options={options}
            native={native}
            onChange={setOptions}
          />
        }
        cookLink={
          <Link
            className="button"
            to="/$handle/$slug/cook"
            params={{ handle, slug }}
            search={search}
          >
            Cook
          </Link>
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

      {/* When and why it last changed, in words; the version id is for the
          history page, where versions are compared, not for a reader. */}
      <footer className="version-line muted">
        Last changed <When date={version.createdAt} /> — “{version.message}” ·{' '}
        <Link to="/$handle/$slug/history" params={{ handle, slug }}>
          See all changes
        </Link>
      </footer>
    </article>
  );
}
