import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { LoadFailure, Loading } from '../components/LoadState.tsx';
import {
  ApiError,
  fetchAdminReports,
  resolveReport,
  type ReportStatus,
  type ResolveAction,
} from '../lib/api.ts';

const REPORTS_KEY = (status: ReportStatus) => ['admin-reports', status] as const;

/**
 * The whole moderation surface: reports, and three ways to act on one. No
 * queue assignment, no history beyond a report's own `resolvedAt` — a site
 * this size has one moderator, not a team to route work between.
 */
export function AdminPage() {
  const [status, setStatus] = useState<ReportStatus>('open');
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: REPORTS_KEY(status),
    queryFn: () => fetchAdminReports(status),
  });

  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: ResolveAction }) =>
      resolveReport(id, action),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-reports'] }),
  });

  const [blocked, setBlocked] = useState<string | null>(null);

  function act(id: string, action: ResolveAction) {
    setBlocked(null);
    resolve.mutate(
      { id, action },
      {
        onError: (err) => {
          if (err instanceof ApiError && err.message === 'has_descendants') setBlocked(id);
        },
      },
    );
  }

  if (error) {
    return <LoadFailure error={error} missingTitle="Not found" missing="There is nothing here." />;
  }

  return (
    <section>
      <h1>Reports</h1>

      <div className="tabs">
        {(['open', 'resolved'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`tab${status === s ? ' active' : ''}`}
            onClick={() => setStatus(s)}
          >
            {s === 'open' ? 'Open' : 'Resolved'}
          </button>
        ))}
      </div>

      {isPending ? (
        <Loading />
      ) : data.reports.length === 0 ? (
        <p className="muted">Nothing {status === 'open' ? 'open' : 'resolved yet'}.</p>
      ) : (
        <ul className="cards">
          {data.reports.map((report) => (
            <li key={report.id} className="card">
              <h3>
                <Link
                  to="/$handle/$slug"
                  params={{ handle: report.recipe.handle, slug: report.recipe.slug }}
                >
                  {report.recipe.title}
                </Link>{' '}
                <span className="hint">by @{report.recipe.handle}</span>
                {report.recipe.visibility === 'private' && <span className="badge">Private</span>}
              </h3>
              <p>{report.reason}</p>
              <p className="card-foot">
                <span>Reported by @{report.reporter.handle}</span>
                <span>{new Date(report.createdAt).toLocaleString()}</span>
              </p>

              {status === 'open' && (
                <div className="row">
                  <button
                    type="button"
                    disabled={resolve.isPending}
                    onClick={() => act(report.id, 'dismiss')}
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    disabled={resolve.isPending}
                    onClick={() => act(report.id, 'make_private')}
                  >
                    Make private
                  </button>
                  <button
                    type="button"
                    className="secondary danger"
                    disabled={resolve.isPending}
                    onClick={() => act(report.id, 'remove_recipe')}
                  >
                    Remove recipe
                  </button>
                </div>
              )}
              {blocked === report.id && (
                <p className="bad">
                  Somebody has forked this, so removing it would take their history too. Use “Make
                  private” instead.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
