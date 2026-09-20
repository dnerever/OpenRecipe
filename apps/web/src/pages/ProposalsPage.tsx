import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { fetchProposals, type ProposalState, type ProposalSummary } from '../lib/api.ts';
import { LoadFailure, Loading, NO_SUCH_RECIPE } from '../components/LoadState.tsx';

const STATE_LABEL: Record<ProposalState, string> = {
  open: 'Open',
  merged: 'Merged',
  closed: 'Closed',
};

/**
 * Every proposal against this recipe, open ones first — which is what the
 * server's ordering already gives, since a settled proposal stops being
 * touched. No filter tabs yet: a recipe with enough proposals to need them is a
 * problem worth having first.
 */
export function ProposalsPage() {
  const { handle, slug } = useParams({ from: '/$handle/$slug/proposals' });

  const { data, isPending, error } = useQuery({
    queryKey: ['proposals', handle, slug],
    queryFn: () => fetchProposals(handle, slug),
    retry: false,
  });

  if (isPending) return <Loading />;

  if (error) return <LoadFailure error={error} missing={NO_SUCH_RECIPE} />;

  const open = data.proposals.filter((p) => p.state === 'open');
  const settled = data.proposals.filter((p) => p.state !== 'open');

  return (
    <section>
      <p className="crumb">
        <Link to="/$handle/$slug" params={{ handle, slug }}>
          @{handle}/{slug}
        </Link>
      </p>
      <h1>Proposals</h1>

      {data.proposals.length === 0 ? (
        <p className="empty muted">
          No proposals yet. Fork this recipe, change something, and offer it back.
        </p>
      ) : (
        <>
          <ProposalList handle={handle} slug={slug} proposals={open} />
          {settled.length > 0 && (
            <>
              <h2 className="settled-head">Settled</h2>
              <ProposalList handle={handle} slug={slug} proposals={settled} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function ProposalList({
  handle,
  slug,
  proposals,
}: {
  handle: string;
  slug: string;
  proposals: ProposalSummary[];
}) {
  if (proposals.length === 0) return null;

  return (
    <ul className="proposal-list">
      {proposals.map((proposal) => (
        <li key={proposal.id}>
          <p className="proposal-title">
            <Link
              to="/$handle/$slug/proposals/$number"
              params={{ handle, slug, number: String(proposal.number) }}
            >
              {proposal.title}
            </Link>
            <span className={`state ${proposal.state}`}>{STATE_LABEL[proposal.state]}</span>
          </p>
          <p className="entry-meta muted">
            #{proposal.number} · @{proposal.author.handle} · from{' '}
            <Link
              to="/$handle/$slug"
              params={{ handle: proposal.source.owner.handle, slug: proposal.source.slug }}
            >
              @{proposal.source.owner.handle}/{proposal.source.slug}
            </Link>{' '}
            · {new Date(proposal.createdAt).toLocaleDateString()}
          </p>
        </li>
      ))}
    </ul>
  );
}
