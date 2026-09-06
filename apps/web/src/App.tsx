import { useEffect, useState } from 'react';

type Health = {
  status: string;
  database: 'up' | 'down';
  schemaVersion: number;
  uptimeSeconds: number;
};

type State =
  { kind: 'loading' } | { kind: 'ok'; health: Health } | { kind: 'error'; message: string };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as Health;
        setState({ kind: 'ok', health: body });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <p className="eyebrow">Slice 0 · foundations</p>
      <h1>OpenRecipe</h1>
      <p className="lede">Version control for recipes.</p>

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
        {state.kind === 'ok' && (
          <dl>
            <dt>Status</dt>
            <dd className={state.health.database === 'up' ? 'good' : 'bad'}>
              {state.health.status}
            </dd>
            <dt>Database</dt>
            <dd className={state.health.database === 'up' ? 'good' : 'bad'}>
              {state.health.database}
            </dd>
            <dt>Doc schema</dt>
            <dd>v{state.health.schemaVersion}</dd>
            <dt>Uptime</dt>
            <dd>{state.health.uptimeSeconds}s</dd>
          </dl>
        )}
      </section>
    </main>
  );
}
