import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { fetchVersions } from '../lib/api.ts';
import { counted } from '../lib/words.ts';
import { When } from './When.tsx';

/**
 * The last few versions, beside the ingredients: a recipe here has a history,
 * and this is where a reader sees that without going looking for it.
 */
export function RecipeHistory({
  handle,
  slug,
  canEdit,
}: {
  handle: string;
  slug: string;
  canEdit: boolean;
}) {
  const { data } = useQuery({
    queryKey: ['versions', handle, slug],
    queryFn: () => fetchVersions(handle, slug),
    retry: false,
  });
  if (!data) return null;
  const shown = data.versions.slice(0, 3);

  return (
    <section className="recipe-history" aria-labelledby="history-head">
      <div className="panel-head">
        <h2 id="history-head">History</h2>
        <Link to="/$handle/$slug/history" params={{ handle, slug }}>
          {data.versions.length > 1 ? `All ${counted(data.versions.length, 'version')}` : 'Open'}
        </Link>
      </div>
      <ol>
        {shown.map((version) => (
          <li
            key={version.id}
            className={version.id === data.headVersionId ? 'is-head' : undefined}
          >
            <span className="history-dot" aria-hidden="true" />
            <div>
              <p className="history-message">{version.message}</p>
              <p className="history-meta">
                @{version.author.handle} · <When date={version.createdAt} />
                {version.id === data.headVersionId && ' · current'}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {!canEdit && (
        <p className="history-prompt">
          Cooked it differently? Fork it, change what you like, and propose the change back.
        </p>
      )}
    </section>
  );
}
