import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { fetchTags } from '../lib/api.ts';
import { headerCategories, tintForTag } from '../lib/categories.ts';

/**
 * Kinds of dish, in the header, each in its colour: the way in for someone
 * who came to browse rather than to look for something by name. Only the ones
 * with recipes show (`headerCategories`). Shares the tag query and cache with
 * the search page and the home page.
 */
export function CategoryNav() {
  const { data } = useQuery({ queryKey: ['tags'], queryFn: () => fetchTags(30) });
  const tags = headerCategories((data?.tags ?? []).map((t) => t.tag));
  if (tags.length === 0) return null;

  return (
    <nav className="category-nav" aria-label="Categories">
      <ul>
        {tags.map((tag) => (
          <li key={tag}>
            <Link
              to="/search"
              search={{ q: '', tag: [tag] }}
              style={{ background: tintForTag(tag) }}
            >
              {tag}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
