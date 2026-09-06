import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AuthPanel } from '../components/AuthPanel.tsx';
import { fetchHealth, fetchUserRecipes } from '../lib/api.ts';
import { useSession } from '../lib/auth.ts';

export function HomePage() {
  const { data: session } = useSession();
  const handle = (session?.user as { handle?: string } | undefined)?.handle;

  const { data: health } = useQuery({ queryKey: ['health'], queryFn: fetchHealth, retry: false });
  const { data: mine } = useQuery({
    queryKey: ['user-recipes', handle],
    queryFn: () => fetchUserRecipes(handle as string),
    enabled: Boolean(handle),
    retry: false,
  });

  return (
    <>
      <h1>OpenRecipe</h1>
      <p className="lede">
        Version control for recipes. Fork someone’s country loaf, push the hydration to 78%, and
        propose the change back.
      </p>

      {handle ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Your recipes</h2>
            <Link className="button" to="/new">
              New recipe
            </Link>
          </div>

          {!mine ? (
            <p className="muted">Loading…</p>
          ) : mine.recipes.length === 0 ? (
            <p className="muted">Nothing yet. Write your first one.</p>
          ) : (
            <ul className="recipe-list">
              {mine.recipes.map((recipe) => (
                <li key={recipe.slug}>
                  <Link to="/$handle/$slug" params={{ handle, slug: recipe.slug }}>
                    {recipe.title}
                  </Link>
                  {recipe.visibility === 'private' && <span className="badge">Private</span>}
                  {recipe.description && <p className="muted">{recipe.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <AuthPanel health={health ?? null} />

      {health && (
        <section className="panel">
          <h2>API health</h2>
          <dl>
            <dt>Status</dt>
            <dd className={health.database === 'up' ? 'good' : 'bad'}>{health.status}</dd>
            <dt>Database</dt>
            <dd className={health.database === 'up' ? 'good' : 'bad'}>{health.database}</dd>
            <dt>Doc schema</dt>
            <dd>v{health.schemaVersion}</dd>
          </dl>
        </section>
      )}
    </>
  );
}
