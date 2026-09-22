import { Link } from '@tanstack/react-router';

/**
 * Describes what the app actually does today, not a boilerplate policy —
 * each paragraph maps to a real table or service (better-auth's users/
 * sessions/accounts, the media pipeline's EXIF stripping, Resend for reset
 * emails). Update this alongside Slice 19 once error monitoring and
 * analytics land; until then there's nothing here to disclose beyond what's
 * already true.
 */
export function PrivacyPage() {
  return (
    <section>
      <h1>Privacy Policy</h1>
      <p className="lede">Last updated 2026-09-21.</p>

      <h2>What we collect</h2>
      <p>
        Creating an account collects your email, a password (stored hashed, never in plain text), a
        display name, and a handle. A bio and avatar are optional and yours to add. If you sign in
        with GitHub instead, we receive your basic public profile from GitHub rather than collecting
        a password.
      </p>
      <p>
        Recipes, images, lists, proposals, comments, and stars are the content you choose to create.
        Photos you upload have their EXIF metadata — including GPS location — stripped before
        storage, on purpose: a recipe photo is usually taken in someone's kitchen.
      </p>

      <h2>What we don't collect</h2>
      <p>
        No advertising trackers, no third-party analytics cookies, no data sold to anyone. The only
        cookie is the one that keeps you signed in — it's necessary for the app to function, not for
        tracking, which is why there's no cookie-consent banner.
      </p>

      <h2>Who else sees it</h2>
      <p>
        A public recipe, profile, or list is visible to anyone, including search engines. A private
        one is visible only to you — see the visibility rules in <Link to="/terms">the Terms</Link>{' '}
        for what that promise does and doesn't cover across forks.
      </p>
      <p>
        If you flag a recipe, an admin sees the report and the recipe in question in order to act on
        it.
      </p>

      <h2>Third parties we rely on</h2>
      <p>
        Resend delivers password-reset emails. Our hosting provider (Render) and database provider
        (Neon) process data as part of running the service. Object storage for images is MinIO in
        development and S3-compatible storage (such as R2) in production. None of these receive your
        data for any purpose beyond operating OpenRecipe.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Your data is kept as long as your account exists. Deleting your account (
        <Link to="/settings">Settings</Link>) removes your recipes and their images — but only if
        none of them have been forked by someone else. A forked recipe's version history is depended
        on by that fork, so its account can't be deleted while the fork exists, the same rule that
        blocks deleting that one recipe on its own; making it private doesn't change this, since
        visibility and fork history are unrelated facts about a recipe.
      </p>

      <h2>Your choices</h2>
      <p>
        You can edit your profile, change a recipe's visibility, or delete your account at any time
        from <Link to="/settings">Settings</Link>. There's no separate opt-out to manage, because
        there's no tracking to opt out of.
      </p>
    </section>
  );
}
