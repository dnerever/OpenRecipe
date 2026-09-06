import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { RecipeCard } from '../components/RecipeCard.tsx';
import { fetchTags, searchRecipes, type SearchSort } from '../lib/api.ts';

const SORTS: { value: SearchSort; label: string }[] = [
  { value: 'relevance', label: 'Best match' },
  { value: 'recent', label: 'Newest' },
  { value: 'popular', label: 'Most starred' },
];

/**
 * The URL is the state. Every control writes to the query string and the page
 * reads back from it, so a search is a link someone can send — which is most of
 * what "discovery" means for an archive.
 */
export function SearchPage() {
  const { q = '', tag = [], sort } = useSearch({ from: '/search' });
  const navigate = useNavigate();
  const [draft, setDraft] = useState(q);

  // The box follows the URL when the URL changes from elsewhere — a tag chip, a
  // link, the back button — but is otherwise the reader's to type in.
  useEffect(() => setDraft(q), [q]);

  // Built whole rather than merged, because the route's search type is total —
  // a partial update would drop `tag` on every sort change.
  const update = (next: { q?: string; tag?: string[]; sort?: SearchSort }) => {
    const chosen = next.sort ?? sort;
    void navigate({
      to: '/search',
      search: {
        q: next.q ?? q,
        tag: next.tag ?? tag,
        ...(chosen ? { sort: chosen } : {}),
      },
    });
  };

  const results = useInfiniteQuery({
    queryKey: ['search', q, tag, sort],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      searchRecipes({ q, tags: tag, ...(sort ? { sort } : {}), offset: pageParam }),
    getNextPageParam: (last) => last.nextOffset,
  });

  const pages = results.data?.pages ?? [];
  const found = pages.flatMap((page) => page.recipes);
  const total = pages[0]?.total ?? 0;

  const tags = useQuery({ queryKey: ['tags'], queryFn: () => fetchTags(30) });

  const activeSort = pages[0]?.sort ?? sort ?? (q ? 'relevance' : 'recent');
  const toggleTag = (t: string) =>
    update({ tag: tag.includes(t) ? tag.filter((x) => x !== t) : [...tag, t] });

  return (
    <section>
      <h1>Search</h1>

      <form
        className="searchbar"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: draft.trim() });
        }}
      >
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="rye, 30 minutes, one pot…"
          aria-label="Search recipes"
          autoComplete="off"
        />
        <button type="submit">Search</button>
      </form>

      {tag.length > 0 && (
        <ul className="tags active-tags">
          {tag.map((t) => (
            <li key={t} className="on">
              <button type="button" onClick={() => toggleTag(t)} aria-label={`Remove tag ${t}`}>
                {t} ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="result-head">
        <p className="muted">
          {results.isPending ? 'Searching…' : `${total} ${total === 1 ? 'recipe' : 'recipes'}`}
        </p>
        <div className="tabs">
          {SORTS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`tab${activeSort === option.value ? ' active' : ''}`}
              // Relevance needs something to be relevant to.
              disabled={option.value === 'relevance' && !q}
              onClick={() => update({ sort: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {results.error && <p className="bad">{results.error.message}</p>}

      {results.isSuccess && found.length === 0 && (
        <p className="lede">
          Nothing matched. Try a single word, or <Link to="/">browse everything</Link>.
        </p>
      )}

      {found.length > 0 && (
        <ul className="cards">
          {found.map((recipe) => (
            <RecipeCard
              key={`${recipe.owner.handle}/${recipe.slug}`}
              recipe={recipe}
              handle={recipe.owner.handle}
            />
          ))}
        </ul>
      )}

      {results.hasNextPage && (
        <div className="row">
          <button
            type="button"
            className="secondary"
            disabled={results.isFetchingNextPage}
            onClick={() => void results.fetchNextPage()}
          >
            {results.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {tags.data && tags.data.tags.length > 0 && (
        <>
          <h2>Browse by tag</h2>
          <ul className="tags">
            {tags.data.tags.map(({ tag: t, count }) => (
              <li key={t} className={tag.includes(t) ? 'on' : undefined}>
                <button type="button" onClick={() => toggleTag(t)}>
                  {t} <span className="count">{count}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
