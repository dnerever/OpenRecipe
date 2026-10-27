import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { LoadFailure, Loading } from '../components/LoadState.tsx';
import { When } from '../components/When.tsx';
import {
  ApiError,
  fetchAdminFeedback,
  fetchAdminReports,
  resolveFeedback,
  resolveReport,
  type ReportStatus,
  type ResolveAction,
} from '../lib/api.ts';
import { useTitle } from '../lib/use-title.ts';

const REPORTS_KEY = (status: ReportStatus) => ['admin-reports', status] as const;

/**
 * The whole moderation surface: reports, and three ways to act on one — and
 * beside them, what people have said about the site itself. No
 * queue assignment, no history beyond a report's own `resolvedAt` — a site
 * this size has one moderator, not a team to route work between.
 */
export function AdminPage() {
  useTitle('Reports');
  const [status, setStatus] = useState<ReportStatus | 'feedback'>('open');
  const queryClient = useQueryClient();
  const reportStatus = status === 'feedback' ? 'open' : status;
  const { data, isPending, error } = useQuery({
    queryKey: REPORTS_KEY(reportStatus),
    queryFn: () => fetchAdminReports(reportStatus),
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
        {(['open', 'resolved', 'feedback'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`tab${status === s ? ' active' : ''}`}
            onClick={() => setStatus(s)}
          >
            {s === 'open' ? 'Open' : s === 'resolved' ? 'Resolved' : 'Feedback'}
          </button>
        ))}
      </div>

      {status === 'feedback' ? (
        <FeedbackInbox />
      ) : isPending ? (
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
                <When date={report.createdAt} />
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

/** Notes about the site, newest first; "Done" moves one out of the way. */
function FeedbackInbox() {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ['admin-feedback'],
    queryFn: () => fetchAdminFeedback('open'),
  });
  const done = useMutation({
    mutationFn: (id: string) => resolveFeedback(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-feedback'] }),
  });

  if (error) return <p className="bad">{error.message}</p>;
  if (isPending) return <Loading />;
  if (data.feedback.length === 0) return <p className="muted">No new feedback.</p>;

  return (
    <ul className="cards">
      {data.feedback.map((note) => (
        <li key={note.id} className="card">
          <p className="feedback-note">{note.message}</p>
          <p className="card-foot">
            <span>
              {note.from ? `@${note.from.handle}` : (note.contact ?? 'Signed out, no email')}
            </span>
            {note.page && <a href={note.page}>{note.page}</a>}
            <When date={note.createdAt} />
          </p>
          <div className="row">
            <button type="button" disabled={done.isPending} onClick={() => done.mutate(note.id)}>
              Done
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
