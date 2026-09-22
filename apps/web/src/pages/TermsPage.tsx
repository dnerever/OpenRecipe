import { Link } from '@tanstack/react-router';

/**
 * Three things live here, deliberately kept separate — see docs/PLAN.md §10,
 * Slice 17: the platform grant that makes forking/proposing/merging legal at
 * all, the recipe-content license that governs reuse outside the app, and the
 * ordinary account/conduct terms. Conflating the first two would make the
 * content license do a job it was never meant to.
 */
export function TermsPage() {
  return (
    <section>
      <h1>Terms of Service</h1>
      <p className="lede">Last updated 2026-09-21.</p>

      <h2>The account</h2>
      <p>
        You need an account only to publish; reading is open to everyone. You're responsible for
        what you publish under your account, and for having the right to publish it — this matters
        especially if you import a recipe from somewhere else, which is why imports are private by
        default until you decide to share them.
      </p>

      <h2>Forking, editing, and proposing changes</h2>
      <p>
        OpenRecipe's whole purpose is letting people fork, edit, and propose changes back to recipes
        they didn't write. Publishing a recipe as public means you grant every other user the right
        to fork it, edit their fork, and propose merging their changes back — within the app —
        regardless of what license the recipe itself carries. Without this, forking wouldn't have a
        legal basis; it's the same principle GitHub's own terms use to let anyone fork a public
        repository without that being a statement about the code's license.
      </p>
      <p>
        This grant doesn't extend to using a recipe's content outside the app — that's governed
        separately by the recipe's own license, below.
      </p>

      <h2>The license on recipe content</h2>
      <p>
        Every public recipe's prose and photos are licensed{' '}
        <a
          href="https://creativecommons.org/licenses/by-sa/4.0/"
          rel="noreferrer noopener"
          target="_blank"
        >
          CC BY-SA 4.0
        </a>{' '}
        unless the recipe explicitly states a different license — an imported recipe may carry its
        source page's own terms instead. CC BY-SA 4.0 means anyone may reuse or adapt the content
        outside OpenRecipe as long as they credit the author and license their own adaptation under
        the same terms.
      </p>
      <p>
        This is a statement about the prose and photos, not the ingredients and quantities
        themselves — a list of ingredients and amounts generally isn't something copyright covers in
        the first place.
      </p>
      <p>Private recipes carry no public license — they aren't published to anyone but you.</p>

      <h2>Reports and moderation</h2>
      <p>
        You can flag a recipe you believe violates these terms or someone else's rights. We may
        remove content, make it private, or take other action we judge necessary — removal is
        refused for a recipe with existing forks, the same restriction that applies to deleting your
        own recipe, since forks depend on the version history staying intact.
      </p>

      <h2>Account deletion</h2>
      <p>
        You can delete your account from <Link to="/settings">Settings</Link> at any time, which
        deletes every recipe you solely own. It's refused, in full, if any recipe you own has been
        forked — deleting it would break the version history someone else's fork depends on, the
        same rule that blocks deleting that one recipe on its own. This isn't fixed by making the
        recipe private first: visibility and fork history are independent, so a private recipe with
        a fork still blocks deletion. If this applies to you, the account isn't deletable until
        that's no longer true.
      </p>

      <h2>The code itself</h2>
      <p>
        OpenRecipe's source is publicly viewable but proprietary — no license is granted to use,
        copy, or redistribute it. See the repository's <code>LICENSE</code> file. This is entirely
        separate from the recipe-content license above.
      </p>

      <h2>No warranty</h2>
      <p>
        OpenRecipe is provided as-is, without warranty of any kind. We aren't liable for content
        other users publish, or for any damages arising from your use of the service.
      </p>

      <p className="muted">
        Questions about these terms? See <Link to="/privacy">the Privacy Policy</Link> for how we
        handle your data.
      </p>
    </section>
  );
}
