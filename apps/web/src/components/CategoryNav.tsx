import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { fetchTags } from '../lib/api.ts';
import { tintForTag } from '../lib/categories.ts';

/**
 * The most-used tags, in the header, each in its colour: the way in for
 * someone who came to browse rather than to look for something by name.
 * Shares the tag query and cache with the search page and the home page.
 *
 * "vegan" is left out because nearly everything here is vegan; as a category
 * it narrows nothing.
 */
export function CategoryNav() {
  const { data } = useQuery({ queryKey: ['tags'], queryFn: () => fetchTags(30) });
  const tags = (data?.tags ?? [])
    .map((t) => t.tag)
    .filter((t) => t !== 'vegan')
    .slice(0, 6);
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
