import { useEffect, useState } from 'react';
import { AuthPanel } from './components/AuthPanel.tsx';
import { fetchHealth, type Health } from './lib/api.ts';

type State =
  { kind: 'loading' } | { kind: 'ok'; health: Health } | { kind: 'error'; message: string };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth()
      .then((health) => setState({ kind: 'ok', health }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, []);

  const health = state.kind === 'ok' ? state.health : null;

  return (
    <main>
      <p className="eyebrow">Slice 2 · identity</p>
      <h1>OpenRecipe</h1>
      <p className="lede">Version control for recipes.</p>

      <AuthPanel health={health} />

      <section className="panel">
        <h2>API health</h2>
        {state.kind === 'loading' && <p className="muted">Checking…</p>}
        {state.kind === 'error' && (
          <p className="bad">
            Can’t reach the API. Is it running? <code>npm run dev</code>
            <br />
            <span className="muted">{state.message}</span>
          </p>
        )}
        {health && (
          <dl>
            <dt>Status</dt>
            <dd className={health.database === 'up' ? 'good' : 'bad'}>{health.status}</dd>
            <dt>Database</dt>
            <dd className={health.database === 'up' ? 'good' : 'bad'}>{health.database}</dd>
            <dt>Doc schema</dt>
            <dd>v{health.schemaVersion}</dd>
            <dt>Sign-in</dt>
            <dd>
              {[health.auth.emailPassword && 'email', health.auth.github && 'github']
                .filter(Boolean)
                .join(', ')}
            </dd>
            <dt>Uptime</dt>
            <dd>{health.uptimeSeconds}s</dd>
          </dl>
        )}
      </section>
    </main>
  );
}
